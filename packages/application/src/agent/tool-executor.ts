import type { LLMToolCall } from '@lucid-fin/contracts';
import type { AgentToolRegistry, ToolResult } from './tool-registry.js';
import type { AgentEvent } from './agent-orchestrator.js';
import { safeStringify, trimObjectStrings, truncateString } from './context-manager.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SMALL_RESULT_LIMIT = 500;
/** Hard ceiling for any single tool result. */
export const RESULT_HARD_LIMIT = 20000;
const MUTATION_ACTION_PREFIXES = [
  'add', 'cancel', 'clear', 'connect', 'create', 'cut', 'delete',
  'disconnect', 'generate', 'import', 'move', 'pause', 'remove',
  'rename', 'reorder', 'restore', 'resume', 'retry', 'save',
  'select', 'set', 'toggle', 'update',
];
/** Meta tools must never be truncated. */
const META_TOOL_PREFIXES = ['tool.', 'guide.'];

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

export function needsConfirmation(tier: number, mode: string): boolean {
  if (mode === 'auto') return tier === 4;
  if (mode === 'strict') return tier >= 1;
  return tier >= 3;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  for (const key of ['id', 'title', 'name', 'nodeTitle', 'nodeId', 'canvasId', 'characterId', 'equipmentId', 'locationId', 'status']) {
    if (key in value && value[key] != null) {
      summary[key] = summarizeScalar(value[key]);
    }
  }

  return Object.keys(summary).length > 0 ? summary : trimObjectStrings(value, 160);
}

export function summarizeToolResult(toolName: string, result: ToolResult, maxResultChars?: number): string {
  const serialized = safeStringify(result);
  if (serialized.length <= SMALL_RESULT_LIMIT) return serialized;

  // Never truncate meta tool results
  if (META_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix))) return serialized;

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
      _hint: 'Result was trimmed. Use offset/limit parameters for pagination, or narrow your query.',
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
}

export interface ToolExecutorOptions {
  permissionMode?: 'auto' | 'normal' | 'strict';
}

export class ToolExecutor {
  /** Adaptive concurrency window (1 = sequential, max 8). */
  adaptiveConcurrency = 3;

  constructor(
    private tools: AgentToolRegistry,
    private _opts?: ToolExecutorOptions,
  ) {}

  /** Check if a tool is always-loaded or discovered. */
  isToolActive(name: string, activeToolNames: Set<string>): boolean {
    return activeToolNames.has(name);
  }

  /** Execute a single tool call, handling errors and result summarization. */
  async executeSingle(
    tc: LLMToolCall,
    activeToolNames: Set<string>,
    discoveredToolNames: Set<string>,
    emit: (event: AgentEvent) => void,
  ): Promise<ToolExecutionEntry> {
    const tool = this.tools.get(tc.name);

    // Block unloaded tools
    if (tool && !activeToolNames.has(tc.name)) {
      const unloadedPayload = {
        success: false,
        error: `Tool '${tc.name}' exists but is not loaded. Call tool.get('${tc.name}') first to load its schema.`,
      };
      emit({ type: 'tool_result', toolCallId: tc.id, toolName: tc.name, result: unloadedPayload });
      return { tc, resultContent: safeStringify(unloadedPayload), success: false };
    }

    const startedAt = Date.now();
    emit({ type: 'tool_call', toolName: tc.name, toolCallId: tc.id, arguments: tc.arguments, startedAt });

    try {
      const toolResult = await this.tools.execute(tc.name, tc.arguments);
      const completedAt = Date.now();
      const toolMaxResult = this.tools.get(tc.name)?.maxResultChars;
      const resultContent = summarizeToolResult(tc.name, toolResult, toolMaxResult);

      // tool.get discovery
      if (tc.name === 'tool.get' && toolResult.success && toolResult.data != null) {
        const data = toolResult.data;
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          if (isRecord(item) && typeof item.name === 'string' && this.tools.get(item.name)) {
            discoveredToolNames.add(item.name);
          }
        }
      }
      emit({ type: 'tool_result', toolCallId: tc.id, toolName: tc.name, result: toolResult, startedAt, completedAt });
      return { tc, resultContent, success: toolResult.success !== false };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const completedAt = Date.now();
      const resultContent = safeStringify({ success: false, error: errMsg });
      emit({ type: 'error', toolCallId: tc.id, error: errMsg, startedAt, completedAt });
      return { tc, resultContent, success: false };
    }
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
    emit: (event: AgentEvent) => void,
    messages: Array<{ role: string; content: string; toolCallId?: string }>,
    isCancelledOrAborted: () => boolean,
    pendingResolvers: Map<string, (approved: boolean) => void>,
    pendingQuestionResolvers: Map<string, (answer: string) => void>,
  ): Promise<{ cancelled: boolean; dupMap: Map<string, string> }> {
    const mode = this._opts?.permissionMode ?? 'normal';

    // Deduplicate identical tool calls
    const deduped = new Map<string, string>(); // signature -> first tc.id
    const dupMap = new Map<string, string>();   // duplicate tc.id -> first tc.id
    const uniqueToolCalls: LLMToolCall[] = [];
    for (const tc of toolCalls) {
      const sig = `${tc.name}::${safeStringify(tc.arguments)}`;
      const existing = deduped.get(sig);
      if (existing) {
        dupMap.set(tc.id, existing);
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
          const questionOptions = rawOptions.map((opt: unknown) => {
            const option = opt as { label?: string; description?: string };
            return { label: option.label ?? '', description: option.description };
          });
          emit({ type: 'tool_question', toolName: tc.name, toolCallId: tc.id, question, options: questionOptions });
          const answer = await new Promise<string>((resolve) => {
            pendingQuestionResolvers.set(tc.id, resolve);
          });
          const answerPayload = { success: true, data: { answer } };
          emit({ type: 'tool_result', toolCallId: tc.id, toolName: tc.name, result: answerPayload });
          messages.push({ role: 'tool', content: safeStringify(answerPayload), toolCallId: tc.id });
        } else {
          // needs-confirmation path
          const tool = this.tools.get(tc.name);
          const tier = tool?.tier ?? 1;
          emit({ type: 'tool_confirm', toolName: tc.name, toolCallId: tc.id, arguments: tc.arguments, tier });
          const approved = await new Promise<boolean>((resolve) => {
            pendingResolvers.set(tc.id, resolve);
          });
          if (!approved) {
            const skippedPayload = { success: false, error: 'Tool execution skipped by user' };
            emit({ type: 'tool_result', toolCallId: tc.id, toolName: tc.name, result: skippedPayload });
            messages.push({ role: 'tool', content: safeStringify(skippedPayload), toolCallId: tc.id });
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
    const tier = tool?.tier ?? 1;
    return needsConfirmation(tier, mode);
  }
}
