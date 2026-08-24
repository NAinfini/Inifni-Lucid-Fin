import type { LLMToolCall, RunBlocker } from '@lucid-fin/contracts';
import { parseCanonicalToolName } from '@lucid-fin/contracts';
import type { CommanderErrorCode } from '@lucid-fin/contracts';
import {
  InvalidToolOutputError,
  validateToolSchema,
  type ToolRegistry,
  type ToolDefinition,
  type ToolCategory,
  type ToolResult,
  type PublicToolProjection,
  type ToolResourceContext,
} from './tool-registry.js';
import { emitWithRecovery, type StreamEmit } from './stream-emit.js';
import type { ContextGraph } from './graph/context-graph.js';
import { getToolCompactionCategory } from '@lucid-fin/shared-utils';
import { safeStringify, trimObjectStrings, truncateString } from './context-manager.js';
import { inferErrorCodeFromMessage } from './error-inference.js';
import { getTaskListToolDenial, type TaskListToolPolicy } from './task-list-tool-policy.js';
import {
  RunResourceBudgetController,
  type ResourceMeasurement,
  type ResourceQuote,
  type ResourceStateSnapshot,
} from './run-resource-budget.js';
import {
  describeToolProgram,
  executeToolProgram,
  ToolProgramBlockedError,
  ToolProgramCancelledError,
  type ToolProgramChildCall,
  type ToolProgramChildResult,
} from './tool-program.js';
import type { SubagentToolHost } from './subagent-tools.js';
import type { CanonicalJsonValue } from './event-context-projector.js';

export type ToolProgramChildOutcome =
  | { status: 'completed' | 'failed' | 'cancelled' }
  | { status: 'blocked'; blocker: RunBlocker };

export interface ToolProgramChildLifecycleRequest {
  parentRunId: string;
  displayName: string;
  objective: string;
  resourceController: RunResourceBudgetController;
}

export interface ToolProgramChildLifecycle {
  runId: string;
  emit: StreamEmit;
  beforeDispatch: () => Promise<'ready' | 'cancelled'>;
  isCancelled: () => boolean;
  finalize: (outcome: ToolProgramChildOutcome) => Promise<void> | void;
}

export type ToolProgramChildLifecycleFactory = (
  request: ToolProgramChildLifecycleRequest,
) => Promise<ToolProgramChildLifecycle> | ToolProgramChildLifecycle;

function errorCodeFromMessage(message: string): CommanderErrorCode {
  return inferErrorCodeFromMessage(message);
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

const TASK_LIST_GATE_AUTHORIZED_TOOLS = new Set(['task.visual', 'task.media', 'task.delivery']);

// ---------------------------------------------------------------------------
// Pre-execution argument validation
// ---------------------------------------------------------------------------

export interface ArgValidationError {
  field: string;
  expected: string;
  actual: string;
}

export function validateArgs(tool: ToolDefinition, args: Record<string, unknown>): ArgValidationError[] {
  return validateToolSchema(tool.inputSchema, args).map((error) => ({
    ...error,
    field: error.field.replace(/^\$\.?/, '') || '$',
  }));
}

/**
 * Format validation errors into a structured error message for the LLM.
 */
function formatArgValidationErrors(toolName: string, errors: ArgValidationError[]): string {
  const lines = errors.map((e) => `  - ${e.field}: expected ${e.expected}, got ${e.actual}`);
  return `Argument validation failed for ${toolName}:\n${lines.join('\n')}`;
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
 *            rejecting a single `canvas.generation` would break the whole
 *            batch. Deletes are also tier 3 because the snapshot system
 *            provides rollback (see snapshot-tools.ts).
 * - tier 4 = expensive one-shot OR irreversible project-scope action
 *            (provider.removeCustom, canvas.deleteCanvas,
 *            job.create). Confirmed in every mode
 *            except `danger`.
 *            Rationale: these burn significant money or destroy the
 *            top-level artifact; always worth one click.
 */
export function needsConfirmation(tier: number, mode: string): boolean {
  if (mode === 'danger') return false;
  if (mode === 'auto') return tier === 4;
  if (mode === 'strict') return tier >= 1;
  return tier >= 3;
}

/**
 * Resolve the confirmation tier for tools whose risk depends on `action`.
 *
 * Tool registrations retain their declared tier as the default; this narrow
 * overlay keeps a harmless read-style action from inheriting a costly action's
 * confirmation, and prevents destructive sub-actions from inheriting a safe
 * management tool's tier.
 */
export function resolveEffectiveToolTier(
  toolName: string,
  args: Record<string, unknown> | undefined,
  declaredTier: number,
): number {
  const action = typeof args?.action === 'string' ? args.action : undefined;

  if (toolName === 'taskList.manage' && action === 'control') {
    return args?.controlAction === 'cancel' ? 4 : 2;
  }

  if (toolName === 'canvas.generation') {
    if (action === 'submit') return 3;
    if (action === 'status' || action === 'estimate') return 1;
    if (action === 'cancel') return 2;
  }

  if (toolName === 'preset.manage' && (action === 'delete' || action === 'reset')) return 3;
  if (toolName === 'shotTemplate.manage' && action === 'delete') return 3;

  return declaredTier;
}

/** Only deterministic read/query tools may execute concurrently. */
function isPureReadTool(toolName: string): boolean {
  const category = getToolCompactionCategory(toolName);
  return category === 'get' || category === 'list' || category === 'log' || category === 'query';
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
  if (toolResult?.success === false && toolResult.errorClass) return toolResult.errorClass;
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
  category?: ToolCategory,
): string {
  const serialized = safeStringify(result);
  if (serialized.length <= SMALL_RESULT_LIMIT) return serialized;

  // Never truncate meta tool results
  if (category === 'meta') return serialized;

  const hardLimit = maxResultChars ?? RESULT_HARD_LIMIT;

  if (serialized.length <= hardLimit) return serialized;

  if (result.success === false) return safeStringify(trimObjectStrings(result));

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
  /** Resource boundary that stopped this call before a public tool event or side effect. */
  blocked?: RunBlocker;
  /** Normalized outcome reused by dedup mirrors without re-projecting. */
  mirror?: NormalizedToolOutcome;
}

interface NormalizedToolOutcome {
  projection: PublicToolProjection;
  canonicalResult?: ToolResult;
  status: 'succeeded' | 'failed' | 'skipped';
  errorCode?: CommanderErrorCode;
  durationMs: number;
  skipped?: true;
  synthetic?: true;
}

export interface TaskDecisionPersistenceRequest {
  taskListId: string;
  questionId: string;
  decisionKey: string;
  question: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    previewAssetHash?: string;
  }>;
  allowFreeText: boolean;
  policy: TaskListToolPolicy;
}

export interface TaskDecisionPersistenceResult {
  questionId: string;
  status: 'pending' | 'answered' | 'recovery_required';
  answer?: string;
  selectedOptionId?: string;
}

export interface ToolExecutorOptions {
  permissionMode?: 'danger' | 'auto' | 'normal' | 'strict';
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
  /** Host-derived task-list authorization, refreshed from SQLite each step. */
  taskListPolicy?: TaskListToolPolicy;
  /** Host callback that durably reserves task-list-bound AskUser decisions. */
  onTaskDecision?: (
    request: TaskDecisionPersistenceRequest,
  ) => Promise<TaskDecisionPersistenceResult> | TaskDecisionPersistenceResult;
  /** Suspend/resume the Run active-time clock around explicit human waits. */
  onUserWaitState?: (state: 'started' | 'ended') => void;
  /** Per-run resource ledger, owned and wired by the orchestrator. */
  resourceController?: RunResourceBudgetController;
  /** Host-reserved Run identity used by stable Tool Program operation IDs. */
  runId?: string;
  /** Parent Run cooperative pause boundary, checked between Program dispatches. */
  beforeProgramDispatch?: () => Promise<void>;
  /** Host-owned durable child Run boundary for typed Tool Program execution. */
  toolProgramLifecycleFactory?: ToolProgramChildLifecycleFactory;
  /** Model-directed child Run host, scoped by the current parent Run. */
  subagents?: SubagentToolHost;
}

interface ReservedToolResource {
  context: ToolResourceContext;
  operationId: string;
  quote: ResourceQuote;
}

interface ToolExecutionPlan {
  ordinal: number;
  resource?: ReservedToolResource;
  scope?: ToolExecutionScope;
}

interface ToolExecutionScope {
  isCancelledOrAborted: () => boolean;
  pendingResolvers: Map<string, (approved: boolean) => void>;
  pendingQuestionResolvers: Map<string, (answer: string) => void>;
}

interface ToolCallBatchOptions {
  programOperations?: true;
}

function asMeasurement(quote: ResourceQuote): ResourceMeasurement {
  return {
    tokens:
      quote.tokens.knowledge === 'unknown'
        ? { knowledge: 'unknown' }
        : { knowledge: quote.tokens.knowledge, value: quote.tokens.value },
    toolCalls: quote.toolCalls,
    costUsd:
      quote.costUsd.knowledge === 'unknown'
        ? { knowledge: 'unknown' }
        : { knowledge: quote.costUsd.knowledge, value: quote.costUsd.value },
  };
}

function unknownToolQuote(): ResourceQuote {
  return {
    tokens: { knowledge: 'unknown' },
    toolCalls: 0,
    costUsd: { knowledge: 'unknown' },
  };
}

function rawToolQuotaQuote(toolCalls: number): ResourceQuote {
  return {
    tokens: { knowledge: 'known', value: 0, upperBound: true },
    toolCalls,
    costUsd: { knowledge: 'known', value: 0, upperBound: true },
  };
}

/**
 * Max step age for read-through cache hits per tool name. Tighter for
 * canvas state which the model mutates aggressively; looser for stable
 * reference data. Defaults apply to anything not in this table.
 */
const CACHE_MAX_AGE: Record<string, number> = {
  'canvas.getInfo': 1,
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
    private tools: ToolRegistry,
    opts?: ToolExecutorOptions,
  ) {
    this.opts = opts ?? {};
  }

  private async waitForUser<T>(waiter: () => Promise<T>): Promise<T> {
    this.opts.onUserWaitState?.('started');
    try {
      return await waiter();
    } finally {
      this.opts.onUserWaitState?.('ended');
    }
  }

  mergedArgsFor(tc: LLMToolCall): Record<string, unknown> {
    const contextArgs: Record<string, unknown> = {};
    const inputProperties = this.tools.get(tc.name)?.inputSchema.properties;
    if (this.opts.canvasId && inputProperties?.canvasId && tc.arguments.canvasId === undefined) {
      contextArgs.canvasId = this.opts.canvasId;
    }
    const taskListId = this.opts.taskListPolicy?.taskListId;
    if ((tc.name.startsWith('task.') || tc.name === 'taskList.manage') && taskListId) {
      if (inputProperties?.taskListId) contextArgs.taskListId = taskListId;
      if (
        inputProperties?.expectedRowVersion &&
        this.opts.taskListPolicy?.rowVersion !== undefined
      ) {
        contextArgs.expectedRowVersion = this.opts.taskListPolicy.rowVersion;
      }
      if (inputProperties?.taskId && this.opts.taskListPolicy?.currentTaskId) {
        contextArgs.taskId = this.opts.taskListPolicy.currentTaskId;
      }
    }
    return { ...tc.arguments, ...contextArgs };
  }

  private resourceContext(tc: LLMToolCall, ordinal: number): ToolResourceContext {
    return {
      ordinal,
      step: this.opts.currentStep ?? 0,
      toolCallId: tc.id,
    };
  }

  private operationId(tc: LLMToolCall, ordinal: number): string {
    const context = this.resourceContext(tc, ordinal);
    return `tool:${context.step}:${context.ordinal}:${context.toolCallId}`;
  }

  private emitResourceState(state: ResourceStateSnapshot, emit: StreamEmit): void {
    const controller = this.opts.resourceController;
    if (!controller) throw new Error('Tool resource state requires an active resource controller');
    const checkpoint = controller.exportCheckpoint();
    const restored = RunResourceBudgetController.restoreCheckpoint(checkpoint, {
      now: () => 0,
    }).controllers.get(controller.leaseId);
    if (!restored) throw new Error('Resource checkpoint is missing the active tool Run lease');
    const canonicalState = restored.snapshot(state.cause);
    emitWithRecovery(
      emit,
      {
        ...canonicalState,
        clock: { ...canonicalState.clock, changedAt: state.clock.changedAt },
      },
      { kind: 'resource_checkpoint', checkpoint },
    );
  }

  private async reserveToolResource(
    tc: LLMToolCall,
    tool: ToolDefinition | undefined,
    mergedArgs: Record<string, unknown>,
    ordinal: number,
    emit: StreamEmit,
  ): Promise<{ resource?: ReservedToolResource; blocked?: RunBlocker }> {
    const controller = this.opts.resourceController;
    if (!controller || !tool || tool.resource.kind === 'none') return {};

    const context = this.resourceContext(tc, ordinal);
    let quoted: ResourceQuote;
    try {
      quoted = await tool.resource.quote(mergedArgs, context);
    } catch {
      // A failed quote has no verifiable upper bound. Preserve the safety
      // invariant by treating it exactly as an unavailable provider quote.
      quoted = unknownToolQuote();
    }
    // The raw model batch owns the call-count budget. Tool-level resource
    // declarations only account for provider tokens and cost, never a second
    // copy of the same selected call.
    const quote: ResourceQuote = { ...quoted, toolCalls: 0 };
    const operationId = this.operationId(tc, ordinal);
    const reservation = controller.reserve(operationId, 'tool', quote);
    this.emitResourceState(reservation.state, emit);
    if (!reservation.accepted) return { blocked: reservation.blocker };
    return { resource: { context, operationId, quote } };
  }

  private async settleToolResource(
    tool: ToolDefinition | undefined,
    mergedArgs: Record<string, unknown>,
    resource: ReservedToolResource | undefined,
    result: ToolResult,
    emit: StreamEmit,
  ): Promise<void> {
    const controller = this.opts.resourceController;
    if (!controller || !resource) return;

    let measurement = asMeasurement(resource.quote);
    if (tool && tool.resource.kind === 'metered' && tool.resource.measure) {
      try {
        measurement = await tool.resource.measure(result, mergedArgs, resource.context);
      } catch {
        // The retained conservative quote is the only safe settlement when a
        // provider measurement cannot be produced.
      }
    }
    this.emitResourceState(controller.settle(resource.operationId, 'tool', measurement), emit);
  }

  private emitToolCall(
    tc: LLMToolCall,
    mergedArgs: Record<string, unknown>,
    emit: StreamEmit,
  ): void {
    emit({
      kind: 'tool_call',
      toolCallId: tc.id,
      toolRef: parseCanonicalToolName(tc.name),
      args: mergedArgs,
    });
  }

  private emitNormalizedOutcome(
    toolCallId: string,
    outcome: NormalizedToolOutcome,
    emit: StreamEmit,
  ): void {
    const resultEvent: Parameters<StreamEmit>[0] = {
      kind: 'tool_result',
      toolCallId,
      projection: outcome.projection,
      status: outcome.status,
      ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
      durationMs: outcome.durationMs,
      ...(outcome.skipped ? { skipped: true } : {}),
      ...(outcome.synthetic ? { synthetic: true } : {}),
    };
    const context = outcome.status === 'succeeded' ? outcome.projection.context : undefined;
    const recovery = outcome.canonicalResult
      ? {
          kind: 'tool_result' as const,
          result: outcome.canonicalResult as CanonicalJsonValue,
        }
      : undefined;
    if (!context) {
      if (recovery) emitWithRecovery(emit, resultEvent, recovery);
      else emit(resultEvent);
      return;
    }
    emit.batch((firstSeq) => [
      recovery ? { body: resultEvent, recovery } : resultEvent,
      {
        kind: 'context_fact',
        schemaVersion: 1,
        source: { kind: 'tool_result', toolCallId, toolResultSeq: firstSeq },
        completeness: context.completeness,
        facts: context.facts,
      },
    ]);
  }

  private completeOutcome(
    toolCallId: string,
    toolName: string,
    mergedArgs: Record<string, unknown>,
    result: ToolResult,
    status: NormalizedToolOutcome['status'],
    durationMs: number,
    emit: StreamEmit,
    flags?: Pick<NormalizedToolOutcome, 'errorCode' | 'skipped' | 'synthetic'>,
    validatedResult?: ToolResult,
  ): NormalizedToolOutcome {
    const canonicalResult = this.tools.get(toolName)
      ? (validatedResult ?? this.tools.canonicalizeResult(toolName, result))
      : undefined;
    const outcome: NormalizedToolOutcome = {
      projection: this.tools.projectPublicResult(
        toolName,
        mergedArgs,
        canonicalResult ?? result,
      ),
      ...(canonicalResult ? { canonicalResult } : {}),
      status,
      durationMs,
      ...flags,
    };
    this.emitNormalizedOutcome(toolCallId, outcome, emit);
    return outcome;
  }

  private completeInvalidOutput(
    toolCallId: string,
    toolName: string,
    mergedArgs: Record<string, unknown>,
    durationMs: number,
    emit: StreamEmit,
  ): NormalizedToolOutcome {
    const outcome: NormalizedToolOutcome = {
      projection: this.tools.projectPublicCall(toolName, mergedArgs),
      status: 'failed',
      durationMs,
      errorCode: 'INVALID_TOOL_OUTPUT',
    };
    this.emitNormalizedOutcome(toolCallId, outcome, emit);
    return outcome;
  }

  private async executeProgramChildren(
    calls: readonly ToolProgramChildCall[],
    emit: StreamEmit,
    scope: ToolExecutionScope,
    isProgramCancelled: () => boolean = () => false,
  ): Promise<readonly ToolProgramChildResult[]> {
    if (calls.some((call) => call.tool === 'tool.program')) {
      throw new Error('Nested tool.program calls are not allowed');
    }
    const childCalls: LLMToolCall[] = calls.map((call) => ({
      id: call.operationId,
      name: call.tool,
      arguments: call.args,
    }));
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];
    const execution = await this.executeToolCalls(
      childCalls,
      emit,
      messages,
      () => scope.isCancelledOrAborted() || isProgramCancelled(),
      scope.pendingResolvers,
      scope.pendingQuestionResolvers,
      { programOperations: true },
    );
    if (execution.blocked) throw new ToolProgramBlockedError(execution.blocked);
    if (execution.cancelled) throw new ToolProgramCancelledError();

    const contentById = new Map(
      messages
        .filter((message) => message.role === 'tool' && message.toolCallId)
        .map((message) => [message.toolCallId!, message.content]),
    );
    for (const [duplicateId, firstId] of execution.dupMap) {
      const content = contentById.get(firstId);
      if (content !== undefined) contentById.set(duplicateId, content);
    }

    return childCalls.map((call) => {
      const content = contentById.get(call.id);
      if (content === undefined) {
        return {
          operationId: call.id,
          success: false,
          error: `Child tool '${call.name}' returned no result`,
        };
      }
      let parsed: unknown = content;
      try {
        parsed = JSON.parse(content);
      } catch {
        // Canonical executor results may be a bounded string.
      }
      const record =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : undefined;
      const success = record?.success === false ? false : true;
      if (success && this.tools.get(call.name)?.category === 'mutation') {
        this.opts.contextGraph?.invalidateForMutation(call.name, call.arguments);
      }
      return {
        operationId: call.id,
        success,
        ...(success
          ? { value: record && 'data' in record ? record.data : parsed }
          : {
              error:
                typeof record?.error === 'string'
                  ? record.error
                  : `Child tool '${call.name}' failed`,
            }),
      };
    });
  }

  private async executeHostedToolProgram(
    rawProgram: unknown,
    input: Record<string, unknown>,
    parentEmit: StreamEmit,
    scope: ToolExecutionScope,
  ): Promise<ToolResult> {
    const parentRunId = this.opts.runId!;
    const lifecycleFactory = this.opts.toolProgramLifecycleFactory;
    const resourceController = this.opts.resourceController;
    if (!lifecycleFactory || !resourceController) {
      return executeToolProgram(rawProgram, input, {
        runId: parentRunId,
        beforeDispatch: async () => {
          await this.opts.beforeProgramDispatch?.();
          return scope.isCancelledOrAborted() ? 'cancelled' : 'ready';
        },
        dispatch: (calls) => this.executeProgramChildren(calls, parentEmit, scope),
      });
    }

    const lifecycle = await lifecycleFactory({
      parentRunId,
      ...describeToolProgram(rawProgram),
      resourceController,
    });
    let finalized = false;
    const finalize = async (outcome: ToolProgramChildOutcome): Promise<void> => {
      if (finalized) return;
      finalized = true;
      await lifecycle.finalize(outcome);
    };
    const beforeDispatch = async (): Promise<'ready' | 'cancelled'> => {
      const [, childState] = await Promise.all([
        this.opts.beforeProgramDispatch?.(),
        lifecycle.beforeDispatch(),
      ]);
      return scope.isCancelledOrAborted() || lifecycle.isCancelled() || childState === 'cancelled'
        ? 'cancelled'
        : 'ready';
    };

    try {
      const result = await executeToolProgram(rawProgram, input, {
        runId: lifecycle.runId,
        beforeDispatch,
        dispatch: (calls) =>
          this.executeProgramChildren(calls, lifecycle.emit, scope, lifecycle.isCancelled),
      });
      if ((await beforeDispatch()) === 'cancelled') throw new ToolProgramCancelledError();
      await finalize({ status: result.success ? 'completed' : 'failed' });
      return result;
    } catch (error) {
      if (error instanceof ToolProgramBlockedError) {
        await finalize({ status: 'blocked', blocker: error.blocker });
      } else if (error instanceof ToolProgramCancelledError) {
        await finalize({ status: 'cancelled' });
      } else {
        await finalize({ status: 'failed' });
      }
      throw error;
    }
  }

  /** Execute a single tool call, handling errors, retries, and result summarization. */
  async executeSingle(
    tc: LLMToolCall,
    emit: StreamEmit,
    callAlreadyEmitted = false,
    plan: ToolExecutionPlan = { ordinal: 0 },
  ): Promise<ToolExecutionEntry> {
    const tool = this.tools.get(tc.name);
    const mergedArgs = this.mergedArgsFor(tc);

    // Pre-execution argument validation against the tool's JSON Schema.
    // Catches missing required fields, wrong types, and invalid enum values
    // before burning an execution round-trip.
    if (tool) {
      const validationErrors = validateArgs(tool, mergedArgs as Record<string, unknown>);
      if (validationErrors.length > 0) {
        const errorMsg = formatArgValidationErrors(tc.name, validationErrors);
        const validationPayload: ToolResult = {
          success: false,
          error: errorMsg,
          errorClass: 'validation',
        };
        if (!callAlreadyEmitted) this.emitToolCall(tc, mergedArgs, emit);
        const mirror = this.completeOutcome(
          tc.id,
          tc.name,
          mergedArgs,
          validationPayload,
          'skipped',
          0,
          emit,
          { errorCode: errorCodeFromMessage(errorMsg), skipped: true },
        );
        return {
          tc,
          resultContent: safeStringify(validationPayload),
          success: false,
          mirror,
        };
      }
    }

    // Approval gates are enforced at execution time even though the provider
    // sees a stable catalog. This check is independent of permission mode and
    // cannot be confirmed away by the model or chat text.
    const taskListDenial = getTaskListToolDenial(this.opts.taskListPolicy, tc.name, mergedArgs);
    if (taskListDenial) {
      const deniedPayload: ToolResult = { success: false, error: taskListDenial };
      if (!callAlreadyEmitted) this.emitToolCall(tc, mergedArgs, emit);
      const mirror = this.completeOutcome(
        tc.id,
        tc.name,
        mergedArgs,
        deniedPayload,
        'skipped',
        0,
        emit,
        { errorCode: errorCodeFromMessage(taskListDenial), skipped: true },
      );
      return {
        tc,
        resultContent: safeStringify(deniedPayload),
        success: false,
        mirror,
      };
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
          const cachedCandidate: ToolResult =
            typeof parsed === 'object' && parsed !== null && 'success' in (parsed as object)
              ? (parsed as ToolResult)
              : { success: true, data: parsed };
          let cachedResult: ToolResult | undefined;
          try {
            cachedResult = this.tools.canonicalizeResult(tc.name, cachedCandidate);
          } catch (error) {
            if (!(error instanceof InvalidToolOutputError)) throw error;
          }
          if (cachedResult) {
            const toolMaxResult = this.tools.get(tc.name)?.maxResultChars;
            const resultContent = summarizeToolResult(
              tc.name,
              cachedResult,
              toolMaxResult,
              tool?.category,
            );
            const durationMs = Math.max(0, completedAt - startedAt);
            const cachedSuccess = cachedResult.success === true;
            if (!callAlreadyEmitted) this.emitToolCall(tc, mergedArgs, emit);
            const mirror = this.completeOutcome(
              tc.id,
              tc.name,
              mergedArgs,
              cachedResult,
              cachedSuccess ? 'succeeded' : 'failed',
              durationMs,
              emit,
              cachedResult.success === true
                ? undefined
                : { errorCode: errorCodeFromMessage(cachedResult.error) },
              cachedResult,
            );
            return {
              tc,
              resultContent,
              success: cachedSuccess,
              mirror,
            };
          }
        }
      }
    }

    let reservedResource = plan.resource;
    if (!reservedResource) {
      const reservation = await this.reserveToolResource(
        tc,
        tool,
        mergedArgs,
        plan.ordinal,
        emit,
      );
      if (reservation.blocked) {
        return { tc, resultContent: '', success: false, blocked: reservation.blocked };
      }
      reservedResource = reservation.resource;
    }
    // A metered operation is reserved before its public call event, so a
    // budget block cannot leave an orphaned tool_call in the timeline.
    if (!callAlreadyEmitted) this.emitToolCall(tc, mergedArgs, emit);

    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const executionContext =
          (tc.name === 'tool.program' && plan.scope && this.opts.runId) || this.opts.subagents
            ? {
                operationId: this.operationId(tc, plan.ordinal),
                ...(tc.name === 'tool.program' && plan.scope && this.opts.runId
                  ? {
                      executeToolProgram: (program: unknown, input: Record<string, unknown>) =>
                        this.executeHostedToolProgram(program, input, emit, plan.scope!),
                    }
                  : {}),
                ...(this.opts.subagents ? { subagents: this.opts.subagents } : {}),
              }
            : undefined;
        const toolResult = await this.tools.execute(
          tc.name,
          mergedArgs,
          executionContext,
        );
        const completedAt = Date.now();
        const toolMaxResult = this.tools.get(tc.name)?.maxResultChars;

        // Preserve a typed failure fact. The model chooses any next action.
        if (toolResult.success === false) {
          const errorMessage = toolResult.error ?? 'Tool execution failed';
          const errorClass = classifyError(errorMessage, toolResult);
          if (errorClass === 'transient' && attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          const actualResult: ToolResult = { ...toolResult, error: errorMessage, errorClass };
          const resultContent = summarizeToolResult(
            tc.name,
            actualResult,
            toolMaxResult,
            tool?.category,
          );
          const durationMs = Math.max(0, completedAt - startedAt);
          await this.settleToolResource(tool, mergedArgs, reservedResource, actualResult, emit);
          const mirror = this.completeOutcome(
            tc.id,
            tc.name,
            mergedArgs,
            actualResult,
            'failed',
            durationMs,
            emit,
            { errorCode: errorCodeFromMessage(errorMessage) },
          );
          return {
            tc,
            resultContent,
            success: false,
            mirror,
          };
        }

        const resultContent = summarizeToolResult(
          tc.name,
          toolResult,
          toolMaxResult,
          tool?.category,
        );

        const durationMs = Math.max(0, completedAt - startedAt);
        await this.settleToolResource(tool, mergedArgs, reservedResource, toolResult, emit);
        const mirror = this.completeOutcome(
          tc.id,
          tc.name,
          mergedArgs,
          toolResult,
          'succeeded',
          durationMs,
          emit,
          undefined,
          toolResult,
        );
        return {
          tc,
          resultContent,
          success: true,
          mirror,
        };
      } catch (err) {
        if (err instanceof ToolProgramBlockedError) {
          const error = err.message;
          const completedAt = Date.now();
          const actualResult: ToolResult = { success: false, error, errorClass: 'fatal' };
          await this.settleToolResource(tool, mergedArgs, reservedResource, actualResult, emit);
          const mirror = this.completeOutcome(
            tc.id,
            tc.name,
            mergedArgs,
            actualResult,
            'failed',
            Math.max(0, completedAt - startedAt),
            emit,
            { errorCode: errorCodeFromMessage(error) },
          );
          return { tc, resultContent: safeStringify(actualResult), success: false, blocked: err.blocker, mirror };
        }
        const invalidOutput = err instanceof InvalidToolOutputError;
        const errorClass = invalidOutput ? 'fatal' : classifyError(err);
        if (errorClass === 'transient' && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        const completedAt = Date.now();
        const durationMs = Math.max(0, completedAt - startedAt);
        const actualResult: ToolResult = { success: false, error: errMsg, errorClass };
        const resultContent = safeStringify(actualResult);
        await this.settleToolResource(tool, mergedArgs, reservedResource, actualResult, emit);
        const mirror = invalidOutput
          ? this.completeInvalidOutput(tc.id, tc.name, mergedArgs, durationMs, emit)
          : this.completeOutcome(
              tc.id,
              tc.name,
              mergedArgs,
              actualResult,
              'failed',
              durationMs,
              emit,
              { errorCode: errorCodeFromMessage(errMsg) },
            );
        return {
          tc,
          resultContent,
          success: false,
          mirror,
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
    emit: StreamEmit,
    messages: Array<{ role: string; content: string; toolCallId?: string }>,
    isCancelledOrAborted: () => boolean,
    pendingResolvers: Map<string, (approved: boolean) => void>,
    pendingQuestionResolvers: Map<string, (answer: string) => void>,
    batchOptions: ToolCallBatchOptions = {},
  ): Promise<{ cancelled: boolean; dupMap: Map<string, string>; blocked?: RunBlocker }> {
    const mode = this.opts?.permissionMode ?? 'normal';
    const scope: ToolExecutionScope = {
      isCancelledOrAborted,
      pendingResolvers,
      pendingQuestionResolvers,
    };

    // Charge every model-selected call as one atomic quota operation before
    // deduplication or schema validation. Invalid and duplicate calls still
    // consume this bounded model-output entitlement.
    const resourceController = this.opts.resourceController;
    if (resourceController && toolCalls.length > 0) {
      const quotas = batchOptions.programOperations
        ? toolCalls.map((tc) => ({ operationId: tc.id, quote: rawToolQuotaQuote(1) }))
        : [{
            operationId: `tool:${this.opts.currentStep ?? 0}:quota`,
            quote: rawToolQuotaQuote(toolCalls.length),
          }];
      for (const quota of quotas) {
        const reservation = resourceController.reserve(quota.operationId, 'tool', quota.quote);
        this.emitResourceState(reservation.state, emit);
        if (!reservation.accepted) {
          return { cancelled: false, dupMap: new Map(), blocked: reservation.blocker };
        }
        this.emitResourceState(
          resourceController.settle(quota.operationId, 'tool', asMeasurement(quota.quote)),
          emit,
        );
      }
    }

    // Deduplicate identical tool calls
    const deduped = new Map<string, string>(); // signature -> first tc.id
    const dupMap = new Map<string, string>(); // duplicate tc.id -> first tc.id
    const uniqueToolCalls: LLMToolCall[] = [];
    // Track dupes keyed on the winning id so we can mirror its tool_result
    // back out to their cards after execution.
    const dupesByFirstId = new Map<string, LLMToolCall[]>();
    const ordinalById = new Map(toolCalls.map((tc, ordinal) => [tc.id, ordinal]));
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

    // Parallelize only pure reads; mutations and meta tools stay serial to
    // avoid stale write races.
    type Run = {
      kind: 'parallel' | 'serial' | 'interactive';
      calls: LLMToolCall[];
    };
    const runs: Run[] = [];
    for (const tc of uniqueToolCalls) {
      if (this.isInteractive(tc, mode)) {
        runs.push({ kind: 'interactive', calls: [tc] });
      } else if (!isPureReadTool(tc.name)) {
        runs.push({ kind: 'serial', calls: [tc] });
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
        const mergedArgs = this.mergedArgsFor(tc);
        if (tc.name === 'commander.askUser') {
          const tool = this.tools.get(tc.name);
          const validationErrors = tool ? validateArgs(tool, mergedArgs) : [];
          if (validationErrors.length > 0) {
            const error = formatArgValidationErrors(tc.name, validationErrors);
            const payload: ToolResult = { success: false, error, errorClass: 'validation' };
            this.emitToolCall(tc, mergedArgs, emit);
            this.completeOutcome(tc.id, tc.name, mergedArgs, payload, 'skipped', 0, emit, {
              errorCode: errorCodeFromMessage(error),
              skipped: true,
            });
            messages.push({ role: 'tool', content: safeStringify(payload), toolCallId: tc.id });
            continue;
          }
          this.emitToolCall(tc, mergedArgs, emit);
          const question = typeof mergedArgs.question === 'string' ? mergedArgs.question : '';
          const rawOptions = Array.isArray(mergedArgs.options) ? mergedArgs.options : [];
          const allowFreeText =
            typeof mergedArgs.allowFreeText === 'boolean' ? mergedArgs.allowFreeText : true;
          const hasInvalidPreviewHash = rawOptions.some((rawOption: unknown) => {
            if (!rawOption || typeof rawOption !== 'object') return false;
            if (!('previewAssetHash' in rawOption)) return false;
            const previewAssetHash = (rawOption as { previewAssetHash?: unknown }).previewAssetHash;
            return (
              typeof previewAssetHash !== 'string' ||
              !/^[a-f0-9]{64}$/i.test(previewAssetHash.trim())
            );
          });
          if (hasInvalidPreviewHash) {
            const error = 'commander.askUser previewAssetHash must be a SHA-256 CAS asset hash.';
            const payload: ToolResult = { success: false, error, errorClass: 'validation' };
            this.completeOutcome(
              tc.id,
              tc.name,
              mergedArgs,
              payload,
              'failed',
              0,
              emit,
              { errorCode: errorCodeFromMessage(error) },
            );
            messages.push({ role: 'tool', content: safeStringify(payload), toolCallId: tc.id });
            continue;
          }
          const mapped = rawOptions
            .map((opt: unknown) => {
              const option = (opt && typeof opt === 'object' ? opt : {}) as {
                label?: string;
                description?: string;
                previewAssetHash?: string;
              };
              return {
                label: typeof option.label === 'string' ? option.label.trim() : '',
                ...(typeof option.description === 'string' && option.description.trim()
                  ? { description: option.description.trim() }
                  : {}),
                ...(typeof option.previewAssetHash === 'string'
                  ? { previewAssetHash: option.previewAssetHash.trim() }
                  : {}),
              };
            })
            .map((o, idx) => ({
              id: `opt-${idx}`,
              label: o.label,
              ...('description' in o ? { description: o.description } : {}),
              ...('previewAssetHash' in o ? { previewAssetHash: o.previewAssetHash } : {}),
            }));
          if (mapped.length === 0 && !allowFreeText) {
            const error = 'commander.askUser empty option lists require allowFreeText=true.';
            const payload: ToolResult = { success: false, error, errorClass: 'validation' };
            this.completeOutcome(
              tc.id,
              tc.name,
              mergedArgs,
              payload,
              'failed',
              0,
              emit,
              { errorCode: errorCodeFromMessage(error) },
            );
            messages.push({ role: 'tool', content: safeStringify(payload), toolCallId: tc.id });
            continue;
          }
          if (
            mapped.some((option) => option.label.length === 0) ||
            new Set(mapped.map((option) => option.label)).size !== mapped.length
          ) {
            const error = 'commander.askUser requires non-empty options with unique labels.';
            const payload: ToolResult = { success: false, error, errorClass: 'validation' };
            this.completeOutcome(
              tc.id,
              tc.name,
              mergedArgs,
              payload,
              'failed',
              0,
              emit,
              { errorCode: errorCodeFromMessage(error) },
            );
            messages.push({ role: 'tool', content: safeStringify(payload), toolCallId: tc.id });
            continue;
          }
          const taskListId = this.opts.taskListPolicy?.taskListId;
          const decisionKey =
            typeof mergedArgs.decisionKey === 'string' ? mergedArgs.decisionKey.trim() : '';
          let questionId = tc.id;
          let persistedAnswer: string | undefined;
          let persistedSelectedOptionId: string | undefined;
          if (taskListId) {
            if (!decisionKey || !this.opts.onTaskDecision) {
              const error =
                'Task-list-bound commander.askUser requires a stable decisionKey and durable host persistence.';
              const payload = { success: false, error };
              this.completeOutcome(
                tc.id,
                tc.name,
                mergedArgs,
                payload,
                'failed',
                0,
                emit,
                { errorCode: errorCodeFromMessage(error) },
              );
              messages.push({ role: 'tool', content: safeStringify(payload), toolCallId: tc.id });
              continue;
            }
            const persisted = await this.opts.onTaskDecision({
              taskListId,
              questionId: tc.id,
              decisionKey,
              question,
              options: mapped,
              allowFreeText,
              policy: this.opts.taskListPolicy!,
            });
            questionId = persisted.questionId;
            if (persisted.status !== 'pending') {
              persistedAnswer = persisted.answer;
              persistedSelectedOptionId = persisted.selectedOptionId;
            }
          }
          if (persistedAnswer === undefined) {
            emit({
              kind: 'question_prompt',
              questionId,
              prompt: question,
              options: mapped.length > 0 ? mapped : undefined,
              allowFreeText,
            });
          }
          const answer =
            persistedAnswer ??
            (await this.waitForUser(
              () =>
                new Promise<string>((resolve) => {
                  const receiveAnswer = (candidate: string): void => {
                    const normalized = candidate.trim();
                    if (
                      !normalized ||
                      (!allowFreeText && !mapped.some((option) => option.label === normalized))
                    ) {
                      // The host removes the resolver before invoking it. Restore
                      // the same guarded resolver so an invalid IPC answer cannot
                      // close or bypass a closed-choice question.
                      pendingQuestionResolvers.set(questionId, receiveAnswer);
                      return;
                    }
                    resolve(normalized);
                  };
                  pendingQuestionResolvers.set(questionId, receiveAnswer);
                }),
            ));
          // Close the pending-question card on the UI before the tool_result
          // lands. The timeline selector clears `pendingQuestion` when it
          // sees `user_answer` with a matching `questionId`.
          const selectedOption = mapped.find((o) => o.label === answer);
          if (
            !allowFreeText &&
            (!selectedOption ||
              (persistedSelectedOptionId !== undefined &&
                persistedSelectedOptionId !== selectedOption.id))
          ) {
            const error = 'commander.askUser requires one of the listed options.';
            const payload = { success: false, error };
            this.completeOutcome(
              tc.id,
              tc.name,
              mergedArgs,
              payload,
              'failed',
              0,
              emit,
              { errorCode: errorCodeFromMessage(error) },
            );
            messages.push({ role: 'tool', content: safeStringify(payload), toolCallId: tc.id });
            continue;
          }
          emit({
            kind: 'user_answer',
            questionId,
            answer,
            selectedOptionId: persistedSelectedOptionId ?? selectedOption?.id,
          });
          let answerPayload: ToolResult;
          try {
            answerPayload = this.tools.canonicalizeResult(tc.name, {
              success: true,
              data: { answer },
            });
          } catch (error) {
            if (!(error instanceof InvalidToolOutputError)) throw error;
            answerPayload = { success: false, error: error.message, errorClass: 'fatal' };
            this.completeInvalidOutput(tc.id, tc.name, mergedArgs, 0, emit);
            messages.push({
              role: 'tool',
              content: safeStringify(answerPayload),
              toolCallId: tc.id,
            });
            continue;
          }
          this.completeOutcome(
            tc.id,
            tc.name,
            mergedArgs,
            answerPayload,
            'succeeded',
            0,
            emit,
            undefined,
            answerPayload,
          );
          messages.push({ role: 'tool', content: safeStringify(answerPayload), toolCallId: tc.id });
        } else {
          // needs-confirmation path
          const tool = this.tools.get(tc.name);
          const validationErrors = tool ? validateArgs(tool, mergedArgs) : [];
          if (validationErrors.length > 0) {
            const errorMsg = formatArgValidationErrors(tc.name, validationErrors);
            const payload: ToolResult = {
              success: false,
              error: errorMsg,
              errorClass: 'validation',
            };
            this.emitToolCall(tc, mergedArgs, emit);
            this.completeOutcome(tc.id, tc.name, mergedArgs, payload, 'skipped', 0, emit, {
              errorCode: errorCodeFromMessage(errorMsg),
              skipped: true,
            });
            messages.push({ role: 'tool', content: safeStringify(payload), toolCallId: tc.id });
            continue;
          }
          const taskListDenial = getTaskListToolDenial(this.opts.taskListPolicy, tc.name, mergedArgs);
          if (taskListDenial) {
            const payload: ToolResult = { success: false, error: taskListDenial };
            this.emitToolCall(tc, mergedArgs, emit);
            this.completeOutcome(tc.id, tc.name, mergedArgs, payload, 'skipped', 0, emit, {
              errorCode: errorCodeFromMessage(taskListDenial),
              skipped: true,
            });
            messages.push({ role: 'tool', content: safeStringify(payload), toolCallId: tc.id });
            continue;
          }
          // Composite tools can have an action-specific effective tier.
          // Unknown tools remain highest-stakes so the user cannot be
          // surprised by a misleadingly safe label.
          const tier = resolveEffectiveToolTier(tc.name, mergedArgs, tool?.tier ?? 4);
          emit({
            kind: 'tool_confirm_prompt',
            toolCallId: tc.id,
            toolRef: parseCanonicalToolName(tc.name),
            tier,
            args: mergedArgs,
          });
          const approved = await this.waitForUser(
            () =>
              new Promise<boolean>((resolve) => {
                pendingResolvers.set(tc.id, resolve);
              }),
          );
          // Close the pending-confirmation card on the UI. The timeline
          // selector clears `pendingConfirmation` on `user_confirmation`.
          emit({
            kind: 'user_confirmation',
            toolCallId: tc.id,
            approved,
          });
          if (!approved) {
            const skippedPayload: ToolResult = {
              success: false,
              error: 'Tool execution skipped by user',
            };
            this.emitToolCall(tc, mergedArgs, emit);
            this.completeOutcome(
              tc.id,
              tc.name,
              mergedArgs,
              skippedPayload,
              'skipped',
              0,
              emit,
              { errorCode: errorCodeFromMessage('Tool execution declined by user'), skipped: true },
            );
            messages.push({
              role: 'tool',
              content: safeStringify(skippedPayload),
              toolCallId: tc.id,
            });
          } else {
            const res = await this.executeSingle(tc, emit, false, {
              ordinal: ordinalById.get(tc.id) ?? 0,
              scope,
            });
            if (res.blocked) return { cancelled: false, dupMap, blocked: res.blocked };
            messages.push({ role: 'tool', content: res.resultContent, toolCallId: tc.id });
          }
        }
        continue;
      }

      // Pure reads use the adaptive window. Serial runs reuse the same result
      // and duplicate-mirroring path with a fixed window of one.
      const queue = [...run.calls];
      const ordered = new Map<string, string>();
      let idx = 0;

      while (idx < queue.length) {
        if (isCancelledOrAborted()) return { cancelled: true, dupMap };

        const windowSize =
          run.kind === 'serial' ? 1 : Math.max(1, Math.min(concurrency, queue.length - idx));
        const batch = queue.slice(idx, idx + windowSize);
        const plans = new Map<string, ToolExecutionPlan>();
        for (const tc of batch) {
          const plan: ToolExecutionPlan = { ordinal: ordinalById.get(tc.id) ?? 0, scope };
          const tool = this.tools.get(tc.name);
          const mergedArgs = this.mergedArgsFor(tc);
          // Reserve only calls that passed the same local guards as execution.
          // Invalid and denied calls are still charged by the raw batch quota,
          // then emit their paired public outcome from executeSingle below.
          if (
            tool &&
            tool.resource.kind === 'metered' &&
            validateArgs(tool, mergedArgs).length === 0 &&
            !getTaskListToolDenial(this.opts.taskListPolicy, tc.name, mergedArgs)
          ) {
            const reservation = await this.reserveToolResource(
              tc,
              tool,
              mergedArgs,
              plan.ordinal,
              emit,
            );
            if (reservation.blocked) {
              // Earlier reservations in this window did not start execution;
              // settle them to their retained quotes before the typed block.
              if (resourceController) {
                for (const prior of plans.values()) {
                  if (prior.resource) {
                    this.emitResourceState(
                      resourceController.settle(
                        prior.resource.operationId,
                        'tool',
                        asMeasurement(prior.resource.quote),
                      ),
                      emit,
                    );
                  }
                }
              }
              return { cancelled: false, dupMap, blocked: reservation.blocked };
            }
            plan.resource = reservation.resource;
          }
          plans.set(tc.id, plan);
        }
        // All read-window reservations complete before any Promise.all work
        // begins. Mutation windows stay at one call and use this same path.
        const results = await Promise.all(
          batch.map((tc) => this.executeSingle(tc, emit, false, plans.get(tc.id)!)),
        );

        let successes = 0;
        let failures = 0;
        for (const res of results) {
          if (res.blocked) return { cancelled: false, dupMap, blocked: res.blocked };
          ordered.set(res.tc.id, res.resultContent);
          if (res.success) successes++;
          else failures++;

          // Mirror the winner's normalized outcome to each duplicate without
          // invoking the public result projector again.
          const dupes = dupesByFirstId.get(res.tc.id);
          if (dupes && res.mirror) {
            for (const dup of dupes) {
              this.emitToolCall(dup, this.mergedArgsFor(dup), emit);
              this.emitNormalizedOutcome(dup.id, res.mirror, emit);
            }
          }
        }

        // Only concurrent read batches tune the read window. Serial writes
        // should not make a later read batch more aggressive.
        if (run.kind === 'parallel') {
          if (failures === 0 && successes > 0) {
            concurrency = Math.min(concurrency + 1, 8);
          } else if (failures > 0) {
            concurrency = Math.max(1, Math.floor(concurrency * 0.5));
          }
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
    // A stale or forged task-list call cannot become authorized through a
    // confirmation click. Let executeSingle reject it immediately instead of
    // blocking an unattended continuation on a confirmation that can never
    // succeed.
    if (getTaskListToolDenial(this.opts.taskListPolicy, tc.name, tc.arguments)) return false;

    const targetCanvasId =
      typeof tc.arguments.canvasId === 'string' ? tc.arguments.canvasId : undefined;
    const tool = this.tools.get(tc.name);
    // Cross-Canvas writes are always a one-call user decision, including in
    // danger/auto modes and after a task-list gate has been approved.
    if (
      targetCanvasId &&
      tool?.category === 'mutation' &&
      targetCanvasId !== this.opts.canvasId
    ) {
      return true;
    }

    // An exact host-derived task-list gate is the authorization for its bounded
    // phase tool. Strict mode deliberately keeps its per-call confirmation
    // contract; normal and auto may continue the approved task list.
    if (
      (mode === 'normal' || mode === 'auto') &&
      this.opts.taskListPolicy?.taskListId &&
      TASK_LIST_GATE_AUTHORIZED_TOOLS.has(tc.name)
    ) {
      return false;
    }
    // Unknown tool → treat as tier 4 so the highest-stakes confirmation
    // gate triggers. Registered tools always have tier (register() guard).
    const tier = resolveEffectiveToolTier(tc.name, tc.arguments, tool?.tier ?? 4);
    return needsConfirmation(tier, mode);
  }
}
