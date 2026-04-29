import type { LLMToolCall } from '@lucid-fin/contracts';
import { parseCanonicalToolName } from '@lucid-fin/contracts';
import type { CommanderError } from '@lucid-fin/contracts';
import type { AgentToolRegistry, AgentTool, ToolResult } from './tool-registry.js';
import type { StreamEmit } from './stream-emit.js';
import type { ContextGraph } from './graph/context-graph.js';
import { getToolCompactionCategory } from '@lucid-fin/shared-utils';
import { safeStringify, trimObjectStrings, truncateString } from './context-manager.js';
import { ToolCatalog } from './tool-catalog.js';
import { inferErrorCodeFromMessage } from './error-inference.js';

function commanderErrorFromMessage(message: string): CommanderError {
  return { code: inferErrorCodeFromMessage(message), params: { message } };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SMALL_RESULT_LIMIT = 500;
/** Hard ceiling for any single tool result. */
export const RESULT_HARD_LIMIT = 20000;
const MUTATION_ACTION_PREFIXES = [
  'add',
  'cancel',
  'clear',
  'connect',
  'create',
  'cut',
  'delete',
  'disconnect',
  'generate',
  'import',
  'move',
  'pause',
  'remove',
  'rename',
  'reorder',
  'restore',
  'resume',
  'retry',
  'save',
  'select',
  'set',
  'toggle',
  'update',
];

// ---------------------------------------------------------------------------
// Pre-execution argument validation
// ---------------------------------------------------------------------------

export interface ArgValidationError {
  field: string;
  expected: string;
  actual: string;
}

/**
 * Validate tool call arguments against the tool's JSON Schema before
 * execution. Checks required fields, type correctness, and enum membership.
 * Returns an array of errors — empty means valid.
 *
 * This is lightweight and intentionally does NOT do deep nested validation
 * or entity existence lookups (those would require DB access). It catches
 * the most common LLM mistakes: missing required fields, wrong types, and
 * invalid enum values.
 */
export function validateArgs(tool: AgentTool, args: Record<string, unknown>): ArgValidationError[] {
  const errors: ArgValidationError[] = [];
  const schema = tool.parameters;

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in args) || args[field] === undefined || args[field] === null) {
        const prop = schema.properties[field];
        const expected = prop ? `${prop.type} (${prop.description})` : 'required';
        errors.push({ field, expected, actual: 'missing' });
      }
    }
  }

  // Check type correctness and enum values for provided fields
  for (const [field, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    const prop = schema.properties[field];
    if (!prop) continue; // Unknown field — tools may accept extra args

    // Type check
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (prop.type === 'array' && !Array.isArray(value)) {
      errors.push({ field, expected: 'array', actual: actualType });
    } else if (prop.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
      errors.push({ field, expected: 'object', actual: actualType });
    } else if (
      (prop.type === 'string' && typeof value !== 'string') ||
      (prop.type === 'number' && typeof value !== 'number') ||
      (prop.type === 'boolean' && typeof value !== 'boolean')
    ) {
      errors.push({ field, expected: prop.type, actual: actualType });
    }

    // Enum check (only for strings)
    if (prop.enum && typeof value === 'string' && !prop.enum.includes(value)) {
      errors.push({
        field,
        expected: `one of [${prop.enum.join(', ')}]`,
        actual: value,
      });
    }
  }

  return errors;
}

/**
 * Format validation errors into a structured error message for the LLM.
 */
function formatArgValidationErrors(toolName: string, errors: ArgValidationError[]): string {
  const lines = errors.map((e) => `  - ${e.field}: expected ${e.expected}, got ${e.actual}`);
  return `Argument validation failed for ${toolName}:\n${lines.join('\n')}\nFix the arguments and retry. Use tool.get('${toolName}') to check the schema.`;
}

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/**
 * Tier policy (see each tool's `tier:` field for assignments).
 *
 * - tier 1 = read-only (list/get/inspect). Never confirmed except in `strict`.
 * - tier 2 = safe mutation (edit name, rename, reposition). Confirmed only in `strict`.
 * - tier 3 = destructive OR costly mutation (delete, batch, generate one node).
 *            Confirmed in `strict` and `normal`; NOT confirmed in `auto`.
 *            Rationale: a user in `auto` mode has opted into automated flow;
 *            rejecting a single `canvas.generate` would break the whole
 *            batch. Deletes are also tier 3 because the snapshot system
 *            provides rollback (see snapshot-tools.ts).
 * - tier 4 = expensive one-shot OR irreversible project-scope action
 *            (render.start, provider.removeCustom, workflow.expandIdea,
 *            canvas.deleteCanvas, job.create). Confirmed in EVERY mode.
 *            Rationale: these burn significant money or destroy the
 *            top-level artifact; always worth one click.
 */
export function needsConfirmation(tier: number, mode: string): boolean {
  if (mode === 'auto') return tier === 4;
  if (mode === 'strict') return tier >= 1;
  return tier >= 3;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Error classification & recovery
// ---------------------------------------------------------------------------

type ErrorClass = 'transient' | 'not_found' | 'validation' | 'permission' | 'fatal';

/**
 * Node / fetch / HTTP error codes mapped to classes. Checked BEFORE any
 * message-text matching so localized errors from non-English providers are
 * classified by their typed code, not their translated message.
 *
 * Extend this table when you see a real error code slipping through to the
 * fatal fallback — do NOT add new keyword strings to the fallback below
 * just to handle localized messages.
 */
const ERROR_CODE_TO_CLASS: Record<string, ErrorClass> = {
  // Transient — network / transport / rate-limit
  ETIMEDOUT: 'transient',
  ECONNABORTED: 'transient',
  ECONNREFUSED: 'transient',
  ECONNRESET: 'transient',
  EAI_AGAIN: 'transient',
  ENETUNREACH: 'transient',
  EHOSTUNREACH: 'transient',
  EPIPE: 'transient',
  UND_ERR_CONNECT_TIMEOUT: 'transient',
  UND_ERR_HEADERS_TIMEOUT: 'transient',
  UND_ERR_BODY_TIMEOUT: 'transient',
  UND_ERR_SOCKET: 'transient',
  // Permission / auth
  EACCES: 'permission',
  EPERM: 'permission',
  // Not found
  ENOENT: 'not_found',
};

const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const NOT_FOUND_HTTP_STATUS = new Set([404, 410]);
const PERMISSION_HTTP_STATUS = new Set([401, 403]);
const VALIDATION_HTTP_STATUS = new Set([400, 422]);

function classifyByCodeOrStatus(source: unknown): ErrorClass | null {
  if (!isRecord(source)) return null;

  // Node / fetch / provider SDKs commonly expose `code` as a string constant.
  if (typeof source.code === 'string') {
    const byCode = ERROR_CODE_TO_CLASS[source.code];
    if (byCode) return byCode;
  }

  // HTTP status can live on .status (fetch Response, many SDKs) or
  // .statusCode (Node http). Classify by range — typed, locale-independent.
  const rawStatus =
    typeof source.status === 'number'
      ? source.status
      : typeof source.statusCode === 'number'
        ? source.statusCode
        : null;
  if (rawStatus !== null) {
    if (TRANSIENT_HTTP_STATUS.has(rawStatus)) return 'transient';
    if (NOT_FOUND_HTTP_STATUS.has(rawStatus)) return 'not_found';
    if (PERMISSION_HTTP_STATUS.has(rawStatus)) return 'permission';
    if (VALIDATION_HTTP_STATUS.has(rawStatus)) return 'validation';
  }

  return null;
}

function classifyError(err: unknown, toolResult?: ToolResult): ErrorClass {
  // Typed signals first. Tools that know why they failed set `errorClass`
  // on the result, and thrown exceptions commonly carry `.code` or
  // `.status` — both are locale-independent.
  if (toolResult?.errorClass) return toolResult.errorClass;
  // A TypedToolError thrown from a validator helper carries the class
  // directly — accept it without running through the code/status probes.
  if (isRecord(err) && typeof (err as { errorClass?: unknown }).errorClass === 'string') {
    const tagged = (err as { errorClass: string }).errorClass;
    if (
      tagged === 'transient' ||
      tagged === 'not_found' ||
      tagged === 'validation' ||
      tagged === 'permission' ||
      tagged === 'fatal'
    ) {
      return tagged;
    }
  }
  const typed = classifyByCodeOrStatus(err);
  if (typed) return typed;
  // Fetch Response / HTTPError style — error exposes a nested cause or
  // response object.
  if (isRecord(err)) {
    const nested = classifyByCodeOrStatus(err.cause) ?? classifyByCodeOrStatus(err.response);
    if (nested) return nested;
  }

  // Last-resort fallback: English substring match. Retained only because
  // many older tools still return free-text error strings with no typed
  // code. When adding new tools, set `errorClass` on the ToolResult or
  // throw an error with a typed `.code` — don't rely on this path.
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const lower = msg.toLowerCase();

  if (
    lower.includes('timeout') ||
    lower.includes('rate limit') ||
    lower.includes('service unavailable') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('503') ||
    lower.includes('429')
  ) {
    return 'transient';
  }
  if (
    lower.includes('not found') ||
    lower.includes('does not exist') ||
    lower.includes('no such') ||
    (toolResult && !toolResult.success && toolResult.error?.toLowerCase().includes('not found'))
  ) {
    return 'not_found';
  }
  if (
    lower.includes('invalid') ||
    lower.includes('required') ||
    lower.includes('must be') ||
    lower.includes('type error') ||
    lower.includes('expected')
  ) {
    return 'validation';
  }
  if (
    lower.includes('permission') ||
    lower.includes('denied') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden')
  ) {
    return 'permission';
  }
  return 'fatal';
}

function buildRecoveryHint(errorClass: ErrorClass, toolName: string, _errMsg: string): string {
  const domain = toolName.split('.')[0];
  switch (errorClass) {
    case 'transient':
      return `Transient error (network/rate limit). The system will retry automatically. If the issue persists, try a different approach.`;
    case 'not_found':
      return `The entity may have been deleted or the ID is stale. Call ${domain}.list to refresh your view and verify the ID.`;
    case 'validation':
      return `Parameter validation failed. Check the tool schema with tool.get('${toolName}') for correct parameter types and required fields.`;
    case 'permission':
      return `The user denied this action. Do not retry the same tool call. Ask the user for guidance or try an alternative approach.`;
    case 'fatal':
      return `Unexpected error. Report this to the user and consider a different approach.`;
  }
}

// ---------------------------------------------------------------------------
// Tool result summarization
// ---------------------------------------------------------------------------

function summarizeScalar(value: unknown): unknown {
  if (typeof value === 'string') return truncateString(value);
  return value;
}

function summarizeMutationResult(value: unknown): unknown {
  if (!isRecord(value)) return trimObjectStrings(value, 160);

  const summary: Record<string, unknown> = {};
  for (const key of [
    'id',
    'title',
    'name',
    'nodeTitle',
    'nodeId',
    'canvasId',
    'characterId',
    'equipmentId',
    'locationId',
    'status',
  ]) {
    if (key in value && value[key] != null) {
      summary[key] = summarizeScalar(value[key]);
    }
  }

  return Object.keys(summary).length > 0 ? summary : trimObjectStrings(value, 160);
}

export function summarizeToolResult(
  toolName: string,
  result: ToolResult,
  maxResultChars?: number,
): string {
  const serialized = safeStringify(result);
  if (serialized.length <= SMALL_RESULT_LIMIT) return serialized;

  // Never truncate meta tool results
  const entry = (ToolCatalog.byKey as Readonly<Record<string, { category: string }>>)[toolName];
  if (entry?.category === 'meta') return serialized;

  const hardLimit = maxResultChars ?? RESULT_HARD_LIMIT;

  if (serialized.length <= hardLimit) return serialized;

  // Over the hard limit: trim long string fields but preserve structure.
  const [, action = ''] = toolName.split('.');
  if (MUTATION_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix))) {
    return safeStringify({ success: result.success, data: summarizeMutationResult(result.data) });
  }

  const trimmed = trimObjectStrings(result.data);
  const trimmedStr = safeStringify({ success: result.success, data: trimmed });

  if (trimmedStr.length > hardLimit) {
    return safeStringify({
      success: result.success,
      data: trimmed,
      _hint:
        'Result was trimmed. Use offset/limit parameters for pagination, or narrow your query.',
    });
  }

  return trimmedStr;
}

// ---------------------------------------------------------------------------
// ToolExecutor class
// ---------------------------------------------------------------------------

export interface ToolExecutionEntry {
  tc: LLMToolCall;
  resultContent: string;
  success: boolean;
  /**
   * Mirror payload used to synthesise `tool_call` + `tool_result` events
   * for dedup'd duplicate calls so the UI's tool cards don't hang on a
   * perpetual "pending" state. One of `result` or `error` is set.
   */
  mirror?: {
    result?: ToolResult;
    error?: CommanderError;
    durationMs: number;
  };
}

export interface ToolExecutorOptions {
  permissionMode?: 'auto' | 'normal' | 'strict';
  /**
   * ContextGraph used as read-through cache for idempotent get/list tools.
   * When present, a matching tool-result in the graph's dedup index is
   * served directly without re-executing the tool.
   */
  contextGraph?: ContextGraph;
  /** Current step number — drives the read-through cache freshness gate. */
  currentStep?: number;
  /** Auto-injected into tool arguments so the LLM never needs to provide it. */
  canvasId?: string;
  /**
   * Notification hook — fires whenever a `tool.get` response carries an
   * inline `processCategory` field, so the orchestrator can mark that
   * category primed and skip the pre-flight defer for subsequent calls.
   * Keeps tool.get inline injection and the defer backstop from racing.
   */
  onProcessGuideDiscovered?: (processCategory: string) => void;
}

/**
 * Max step age for read-through cache hits per tool name. Tighter for
 * canvas state which the model mutates aggressively; looser for stable
 * reference data. Defaults apply to anything not in this table.
 */
const CACHE_MAX_AGE: Record<string, number> = {
  'canvas.getState': 1,
  'canvas.getNode': 3,
  'canvas.listNodes': 3,
  'canvas.listEdges': 3,
};
const CACHE_MAX_AGE_DEFAULT_GET = 2;
const CACHE_MAX_AGE_DEFAULT_LIST = 3;

export class ToolExecutor {
  /** Adaptive concurrency window (1 = sequential, max 8). */
  adaptiveConcurrency = 3;
  /** Mutable options — currentStep is updated by the orchestrator each iteration. */
  opts: ToolExecutorOptions;

  constructor(
    private tools: AgentToolRegistry,
    opts?: ToolExecutorOptions,
  ) {
    this.opts = opts ?? {};
  }

  /** Check if a tool is always-loaded or discovered. */
  isToolActive(name: string, activeToolNames: Set<string>): boolean {
    return activeToolNames.has(name);
  }

  /** Execute a single tool call, handling errors, retries, and result summarization. */
  async executeSingle(
    tc: LLMToolCall,
    activeToolNames: Set<string>,
    discoveredToolNames: Set<string>,
    emit: StreamEmit,
  ): Promise<ToolExecutionEntry> {
    const tool = this.tools.get(tc.name);

    // Block unloaded tools
    if (tool && !activeToolNames.has(tc.name)) {
      const unloadedPayload = {
        success: false,
        error: `Tool '${tc.name}' exists but is not loaded. Call tool.get('${tc.name}') first to load its schema.`,
      };
      emit({
        kind: 'tool_result',
        toolCallId: tc.id,
        error: commanderErrorFromMessage(unloadedPayload.error),
        durationMs: 0,
        skipped: true,
      });
      return {
        tc,
        resultContent: safeStringify(unloadedPayload),
        success: false,
        mirror: {
          error: commanderErrorFromMessage(unloadedPayload.error),
          durationMs: 0,
        },
      };
    }

    // Pre-execution argument validation against the tool's JSON Schema.
    // Catches missing required fields, wrong types, and invalid enum values
    // before burning an execution round-trip.
    if (tool) {
      const validationErrors = validateArgs(tool, (tc.arguments as Record<string, unknown>) ?? {});
      if (validationErrors.length > 0) {
        const errorMsg = formatArgValidationErrors(tc.name, validationErrors);
        const validationPayload = {
          success: false,
          error: errorMsg,
          _recovery: `Parameter validation failed. Check the tool schema with tool.get('${tc.name}') for correct parameter types and required fields.`,
        };
        const mirrorError = commanderErrorFromMessage(errorMsg);
        emit({
          kind: 'tool_result',
          toolCallId: tc.id,
          error: mirrorError,
          durationMs: 0,
          skipped: true,
        });
        return {
          tc,
          resultContent: safeStringify(validationPayload),
          success: false,
          mirror: {
            error: mirrorError,
            durationMs: 0,
          },
        };
      }
    }

    const startedAt = Date.now();

    // Read-through cache via graph projection: idempotent get/list calls whose
    // (toolKey, paramsHash) identity is already in the graph are served
    // without re-executing the tool. A step-age freshness gate bounds how
    // long a cache entry can serve hits — important when external state
    // (UI edits, background updates, provider state) changes outside the
    // agent's mutation tools and the orchestrator's invalidation cannot
    // see those changes. Mutation invalidation in the orchestrator handles
    // agent-driven staleness.
    const graph = this.opts?.contextGraph;
    const currentStep = this.opts?.currentStep ?? 0;
    if (graph) {
      const category = getToolCompactionCategory(tc.name);
      if (category === 'get' || category === 'list') {
        const paramsHash = safeStringify(tc.arguments);
        const entry = graph.findLatestToolResultEntry(tc.name, paramsHash);
        const maxAge =
          CACHE_MAX_AGE[tc.name] ??
          (category === 'get' ? CACHE_MAX_AGE_DEFAULT_GET : CACHE_MAX_AGE_DEFAULT_LIST);
        if (entry && currentStep - entry.producedAtStep <= maxAge) {
          const completedAt = Date.now();
          let parsed: unknown = entry.content;
          try {
            parsed = JSON.parse(entry.content);
          } catch {
            /* keep raw string */
          }
          const cachedResult: ToolResult =
            typeof parsed === 'object' && parsed !== null && 'success' in (parsed as object)
              ? (parsed as ToolResult)
              : { success: true, data: parsed };
          const toolMaxResult = this.tools.get(tc.name)?.maxResultChars;
          const resultContent = summarizeToolResult(tc.name, cachedResult, toolMaxResult);
          const durationMs = Math.max(0, completedAt - startedAt);
          emit({
            kind: 'tool_call',
            toolCallId: tc.id,
            toolRef: parseCanonicalToolName(tc.name),
            args: {},
          });
          emit({
            kind: 'tool_call',
            toolCallId: tc.id,
            toolRef: parseCanonicalToolName(tc.name),
            args: tc.arguments,
          });
          emit({
            kind: 'tool_result',
            toolCallId: tc.id,
            result: cachedResult,
            durationMs,
          });
          return {
            tc,
            resultContent,
            success: true,
            mirror: { result: cachedResult, durationMs },
          };
        }
      }
    }

    emit({
      kind: 'tool_call',
      toolCallId: tc.id,
      toolRef: parseCanonicalToolName(tc.name),
      args: {},
    });
    emit({
      kind: 'tool_call',
      toolCallId: tc.id,
      toolRef: parseCanonicalToolName(tc.name),
      args: tc.arguments,
    });

    // Auto-inject context-level arguments so the LLM never needs to provide them.
    // This is extensible — any field in `contextArgs` is merged into every tool call,
    // with the tool's own arguments taking precedence.
    const contextArgs: Record<string, unknown> = {};
    if (this.opts.canvasId) contextArgs.canvasId = this.opts.canvasId;
    const mergedArgs = { ...contextArgs, ...tc.arguments };

    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const toolResult = await this.tools.execute(tc.name, mergedArgs);
        const completedAt = Date.now();
        const toolMaxResult = this.tools.get(tc.name)?.maxResultChars;

        // Check for logical failure with recovery hint
        if (toolResult.success === false && toolResult.error) {
          const errorClass = classifyError(toolResult.error, toolResult);
          if (errorClass === 'transient' && attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          const hint = buildRecoveryHint(errorClass, tc.name, toolResult.error);
          const enriched = { ...toolResult, _recovery: hint };
          const resultContent = summarizeToolResult(tc.name, enriched as ToolResult, toolMaxResult);
          const durationMs = Math.max(0, completedAt - startedAt);
          const mirrorError = commanderErrorFromMessage(toolResult.error);
          emit({
            kind: 'tool_result',
            toolCallId: tc.id,
            error: mirrorError,
            durationMs,
          });
          return {
            tc,
            resultContent,
            success: false,
            mirror: { error: mirrorError, durationMs },
          };
        }

        const resultContent = summarizeToolResult(tc.name, toolResult, toolMaxResult);

        // tool.get discovery
        if (tc.name === 'tool.get' && toolResult.success && toolResult.data != null) {
          const data = toolResult.data;
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            if (isRecord(item) && typeof item.name === 'string' && this.tools.get(item.name)) {
              discoveredToolNames.add(item.name);
            }
            // If the tool.get response carried an inline process guide,
            // notify the orchestrator so it can mark the category primed.
            // The defer backstop otherwise wouldn't know the guide already
            // reached the model via discovery, and might re-inject it.
            if (
              isRecord(item) &&
              typeof item.processCategory === 'string' &&
              this.opts.onProcessGuideDiscovered
            ) {
              this.opts.onProcessGuideDiscovered(item.processCategory);
            }
          }
        }
        emit({
          kind: 'tool_result',
          toolCallId: tc.id,
          result: toolResult,
          durationMs: Math.max(0, completedAt - startedAt),
        });
        return {
          tc,
          resultContent,
          success: toolResult.success !== false,
          mirror: {
            result: toolResult,
            durationMs: Math.max(0, completedAt - startedAt),
          },
        };
      } catch (err) {
        const errorClass = classifyError(err);
        if (errorClass === 'transient' && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        const completedAt = Date.now();
        const hint = buildRecoveryHint(errorClass, tc.name, errMsg);
        const resultContent = safeStringify({ success: false, error: errMsg, _recovery: hint });
        const durationMs = Math.max(0, completedAt - startedAt);
        const mirrorError = commanderErrorFromMessage(errMsg);
        emit({
          kind: 'tool_result',
          toolCallId: tc.id,
          error: mirrorError,
          durationMs,
        });
        return {
          tc,
          resultContent,
          success: false,
          mirror: { error: mirrorError, durationMs },
        };
      }
    }

    // Unreachable but satisfies TS
    const resultContent = safeStringify({ success: false, error: 'Max retries exceeded' });
    return { tc, resultContent, success: false };
  }

  /**
   * Execute all tool calls for a turn, handling deduplication, interactive tools
   * (askUser / confirm), and adaptive-concurrency parallel execution.
   *
   * Returns the messages to append (tool role) and updated concurrency state.
   */
  async executeToolCalls(
    toolCalls: LLMToolCall[],
    activeToolNames: Set<string>,
    discoveredToolNames: Set<string>,
    emit: StreamEmit,
    messages: Array<{ role: string; content: string; toolCallId?: string }>,
    isCancelledOrAborted: () => boolean,
    pendingResolvers: Map<string, (approved: boolean) => void>,
    pendingQuestionResolvers: Map<string, (answer: string) => void>,
  ): Promise<{ cancelled: boolean; dupMap: Map<string, string> }> {
    const mode = this.opts?.permissionMode ?? 'normal';

    // Deduplicate identical tool calls
    const deduped = new Map<string, string>(); // signature -> first tc.id
    const dupMap = new Map<string, string>(); // duplicate tc.id -> first tc.id
    const uniqueToolCalls: LLMToolCall[] = [];
    // Track dupes keyed on the winning id so we can mirror its tool_result
    // back out to their cards after execution.
    const dupesByFirstId = new Map<string, LLMToolCall[]>();
    for (const tc of toolCalls) {
      const sig = `${tc.name}::${safeStringify(tc.arguments)}`;
      const existing = deduped.get(sig);
      if (existing) {
        dupMap.set(tc.id, existing);
        const list = dupesByFirstId.get(existing) ?? [];
        list.push(tc);
        dupesByFirstId.set(existing, list);
      } else {
        deduped.set(sig, tc.id);
        uniqueToolCalls.push(tc);
      }
    }

    // Partition into interactive and parallel runs
    type Run = { kind: 'parallel' | 'interactive'; calls: LLMToolCall[] };
    const runs: Run[] = [];
    for (const tc of uniqueToolCalls) {
      if (this.isInteractive(tc, mode)) {
        runs.push({ kind: 'interactive', calls: [tc] });
      } else {
        const last = runs[runs.length - 1];
        if (last && last.kind === 'parallel') {
          last.calls.push(tc);
        } else {
          runs.push({ kind: 'parallel', calls: [tc] });
        }
      }
    }

    let concurrency = this.adaptiveConcurrency;

    for (const run of runs) {
      if (isCancelledOrAborted()) return { cancelled: true, dupMap };

      if (run.kind === 'interactive') {
        const tc = run.calls[0];
        if (tc.name === 'commander.askUser') {
          const question = typeof tc.arguments.question === 'string' ? tc.arguments.question : '';
          const rawOptions = Array.isArray(tc.arguments.options) ? tc.arguments.options : [];
          const mapped = rawOptions
            .map((opt: unknown) => {
              const option = opt as { label?: string };
              return { label: option.label ?? '' };
            })
            .filter((o) => o.label.length > 0)
            .map((o, idx) => ({ id: `opt-${idx}`, label: o.label }));
          emit({
            kind: 'question_prompt',
            questionId: tc.id,
            prompt: question,
            options: mapped.length > 0 ? mapped : undefined,
            allowFreeText: false,
          });
          const answer = await new Promise<string>((resolve) => {
            pendingQuestionResolvers.set(tc.id, resolve);
          });
          // Close the pending-question card on the UI before the tool_result
          // lands. The timeline selector clears `pendingQuestion` when it
          // sees `user_answer` with a matching `questionId`.
          const selectedOption = mapped.find((o) => o.label === answer);
          emit({
            kind: 'user_answer',
            questionId: tc.id,
            answer,
            selectedOptionId: selectedOption?.id,
          });
          const answerPayload = { success: true, data: { answer } };
          emit({
            kind: 'tool_result',
            toolCallId: tc.id,
            result: answerPayload,
            durationMs: 0,
          });
          messages.push({ role: 'tool', content: safeStringify(answerPayload), toolCallId: tc.id });
        } else {
          // needs-confirmation path
          const tool = this.tools.get(tc.name);
          // If the tool is registered, trust its declared tier (register()
          // rejects any tool without one). Unknown tools are edge-of-map
          // — show the highest stakes so the user can't be surprised by a
          // misleadingly safe label.
          const tier = tool?.tier ?? 4;
          emit({
            kind: 'tool_confirm_prompt',
            toolCallId: tc.id,
            toolRef: parseCanonicalToolName(tc.name),
            tier,
            args: tc.arguments,
          });
          const approved = await new Promise<boolean>((resolve) => {
            pendingResolvers.set(tc.id, resolve);
          });
          // Close the pending-confirmation card on the UI. The timeline
          // selector clears `pendingConfirmation` on `user_confirmation`.
          emit({
            kind: 'user_confirmation',
            toolCallId: tc.id,
            approved,
          });
          if (!approved) {
            const skippedPayload = { success: false, error: 'Tool execution skipped by user' };
            emit({
              kind: 'tool_result',
              toolCallId: tc.id,
              error: commanderErrorFromMessage('Tool execution declined by user'),
              durationMs: 0,
              skipped: true,
            });
            messages.push({
              role: 'tool',
              content: safeStringify(skippedPayload),
              toolCallId: tc.id,
            });
          } else {
            const res = await this.executeSingle(tc, activeToolNames, discoveredToolNames, emit);
            messages.push({ role: 'tool', content: res.resultContent, toolCallId: tc.id });
          }
        }
        continue;
      }

      // Parallel run with adaptive window
      const queue = [...run.calls];
      const ordered = new Map<string, string>();
      let idx = 0;

      while (idx < queue.length) {
        if (isCancelledOrAborted()) return { cancelled: true, dupMap };

        const windowSize = Math.max(1, Math.min(concurrency, queue.length - idx));
        const batch = queue.slice(idx, idx + windowSize);
        const results = await Promise.all(
          batch.map((tc) => this.executeSingle(tc, activeToolNames, discoveredToolNames, emit)),
        );

        let successes = 0;
        let failures = 0;
        for (const res of results) {
          ordered.set(res.tc.id, res.resultContent);
          if (res.success) successes++;
          else failures++;

          // Mirror the winner's tool_call (final args) + tool_result to any
          // deduplicated dupes so their UI cards don't hang on "pending".
          const dupes = dupesByFirstId.get(res.tc.id);
          if (dupes && res.mirror) {
            for (const dup of dupes) {
              emit({
                kind: 'tool_call',
                toolCallId: dup.id,
                toolRef: parseCanonicalToolName(dup.name),
                args: dup.arguments,
              });
              if (res.mirror.result !== undefined) {
                emit({
                  kind: 'tool_result',
                  toolCallId: dup.id,
                  result: res.mirror.result,
                  durationMs: res.mirror.durationMs,
                });
              } else if (res.mirror.error) {
                emit({
                  kind: 'tool_result',
                  toolCallId: dup.id,
                  error: res.mirror.error,
                  durationMs: res.mirror.durationMs,
                });
              }
            }
          }
        }

        // Adjust concurrency
        if (failures === 0 && successes > 0) {
          concurrency = Math.min(concurrency + 1, 8);
        } else if (failures > 0) {
          concurrency = Math.max(1, Math.floor(concurrency * 0.5));
        }

        idx += windowSize;
      }

      // Push results in original order
      for (const tc of run.calls) {
        const content = ordered.get(tc.id);
        if (content != null) {
          messages.push({ role: 'tool', content, toolCallId: tc.id });
        }
      }
    }

    this.adaptiveConcurrency = concurrency;
    return { cancelled: false, dupMap };
  }

  private isInteractive(tc: LLMToolCall, mode: string): boolean {
    if (tc.name === 'commander.askUser') return true;
    const tool = this.tools.get(tc.name);
    // Unknown tool → treat as tier 4 so the highest-stakes confirmation
    // gate triggers. Registered tools always have tier (register() guard).
    const tier = tool?.tier ?? 4;
    return needsConfirmation(tier, mode);
  }
}
