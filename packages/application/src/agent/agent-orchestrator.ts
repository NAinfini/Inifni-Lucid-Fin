import type {
  LLMAdapter,
  LLMMessage,
  LLMCompletionResult,
  LLMToolDefinition,
  LLMToolParameter,
} from '@lucid-fin/contracts';
import { LucidError } from '@lucid-fin/contracts';
import type { AgentToolRegistry, ToolResult } from './tool-registry.js';

export interface AgentContext {
  page?: string;
  sceneId?: string;
  keyframeId?: string;
  segmentId?: string;
  characterId?: string;
  extra?: Record<string, unknown>;
}

export interface AgentEvent {
  type: 'tool_call' | 'tool_result' | 'stream_chunk' | 'error' | 'done' | 'tool_confirm' | 'tool_question';
  toolName?: string;
  toolCallId?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  content?: string;
  error?: string;
  tier?: number;
  question?: string;
  options?: Array<{ label: string; description?: string }>;
  startedAt?: number;
  completedAt?: number;
}

export interface AgentOptions {
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
}

/**
 * A single entry in the conversation history passed across turns.
 * Text-only entries (backward-compatible) have just role + content.
 * Rich entries include toolCalls (assistant role) or toolCallId (tool role).
 */
export type HistoryEntry =
  | { role: 'user' | 'assistant'; content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }
  | { role: 'tool'; content: string; toolCallId: string };

export interface AgentExecutionOptions {
  history?: HistoryEntry[];
  isAborted?: () => boolean;
  permissionMode?: 'auto' | 'normal' | 'strict';
  onLLMRequest?: (diagnostics: AgentLLMRequestDiagnostics) => void;
  /** Pre-seed tools into the active set (e.g. from a resumed session). */
  discoveredTools?: string[];
}

export interface AgentLLMRequestDiagnostics {
  step: number;
  toolCount: number;
  toolSchemaChars: number;
  messageCount: number;
  messageChars: number;
  systemPromptChars: number;
  promptGuideChars: number;
}

const HISTORY_TOKEN_BUDGET = 200000;
const ESTIMATED_CHARS_PER_TOKEN = 4;
const HISTORY_CHAR_BUDGET = HISTORY_TOKEN_BUDGET * ESTIMATED_CHARS_PER_TOKEN;

// ---------------------------------------------------------------------------
// Token estimation — uses js-tiktoken if available, else chars/4 heuristic
// ---------------------------------------------------------------------------
let _tikEncoder: { encode(text: string): { length: number } } | null | undefined;

function estimateTokens(text: string): number {
  if (_tikEncoder === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('js-tiktoken') as {
        encodingForModel: (m: string) => { encode(t: string): { length: number } };
      };
      _tikEncoder = mod.encodingForModel('gpt-4o');
    } catch {
      _tikEncoder = null;
    }
  }
  if (_tikEncoder) return _tikEncoder.encode(text).length;
  return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
}

function measureMessageTokens(messages: Array<{ content: string }>): number {
  // ~4 overhead tokens per message for role/metadata
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}
// ---------------------------------------------------------------------------
/** Max chars for in-loop messages (system + history + tool rounds). Triggers mid-loop pruning. */
const DEFAULT_IN_LOOP_CHAR_BUDGET = 120000;
const SMALL_RESULT_LIMIT = 500;
/** Hard ceiling for any single tool result.  If exceeded, the orchestrator
 *  returns a truncation notice asking the LLM to use pagination / narrower
 *  parameters.  This is a safety valve, NOT the normal path — tools should
 *  enforce reasonable defaults (e.g. limit=20) so results stay well under. */
const RESULT_HARD_LIMIT = 20000;
const CONTEXT_EXTRA_VALUE_CHAR_LIMIT = 600;
/** Tools not used within this many steps get their descriptions stripped. */
const TOOL_STRIP_AFTER_STEPS = 3;
/** Tools not used within this many steps get evicted entirely (re-loadable via tool.get). */
const TOOL_EVICT_AFTER_STEPS = 6;
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

/** Tools always loaded regardless of discovery — the LLM gets these in every request. */
const ALWAYS_LOADED_TOOLS = [
  'tool.list', 'tool.get', 'tool.compact', 'commander.askUser',
  'canvas.getState', 'canvas.listNodes', 'canvas.getNode',
  'guide.list', 'guide.get',
] as const;

function needsConfirmation(tier: number, mode: string): boolean {
  if (mode === 'auto') return tier === 4;
  if (mode === 'strict') return tier >= 1;
  // normal: tier >= 3
  return tier >= 3;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncateString(value: string, maxLength = 160): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ success: false, error: 'Failed to serialize tool result' });
  }
}

function summarizeScalar(value: unknown): unknown {
  if (typeof value === 'string') {
    return truncateString(value);
  }
  return value;
}

/** Recursively shorten strings > limit in an object while keeping ALL keys.
 *  This is the lightest possible trim — structure is fully preserved. */
function trimObjectStrings(value: unknown, limit = 300, depth = 0): unknown {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return truncateString(value, limit);
  if (depth > 4) return typeof value === 'string' ? truncateString(value, 80) : value;
  if (Array.isArray(value)) return value.map((item) => trimObjectStrings(item, limit, depth + 1));
  if (!isRecord(value)) return String(value);
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = trimObjectStrings(val, limit, depth + 1);
  }
  return result;
}

function pruneHistory(
  history: HistoryEntry[] | undefined,
  charBudget = HISTORY_CHAR_BUDGET,
): HistoryEntry[] {
  if (!history || history.length === 0) {
    return [];
  }

  const pruned: HistoryEntry[] = [];
  let totalChars = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    const entryChars = entry.content.length;

    if (pruned.length > 0 && totalChars + entryChars > charBudget) {
      break;
    }

    pruned.unshift(entry);
    totalChars += entryChars;

    if (totalChars >= HISTORY_CHAR_BUDGET) {
      break;
    }
  }

  // Ensure we don't start with a dangling tool result (role='tool') without its
  // preceding assistant message that contains the corresponding toolCalls.
  while (pruned.length > 0 && pruned[0].role === 'tool') {
    pruned.shift();
  }

  // If the first message is an assistant with toolCalls, ensure ALL referenced
  // tool results are present. LLM APIs require a tool result for every toolCall.
  // If any are missing (budget cut mid-group), drop the entire tool exchange.
  if (pruned.length > 0 && pruned[0].role === 'assistant') {
    const first = pruned[0] as { toolCalls?: Array<{ id: string }> };
    if (first.toolCalls && first.toolCalls.length > 0) {
      const requiredIds = new Set(first.toolCalls.map((tc) => tc.id));
      const presentIds = new Set(
        pruned
          .filter((e): e is { role: 'tool'; content: string; toolCallId: string } => e.role === 'tool')
          .map((e) => e.toolCallId),
      );
      const allPresent = [...requiredIds].every((id) => presentIds.has(id));
      if (!allPresent) {
        // Drop the assistant + any orphaned tool results until we hit a clean entry
        while (pruned.length > 0 && (pruned[0].role === 'assistant' || pruned[0].role === 'tool')) {
          const dropped = pruned.shift()!;
          if (dropped.role !== 'tool' && dropped.role !== 'assistant') break;
          if (dropped.role === 'assistant' && !(dropped as { toolCalls?: unknown[] }).toolCalls?.length) {
            // This is a clean assistant message without tool calls — put it back
            pruned.unshift(dropped);
            break;
          }
        }
      }
    }
  }

  return pruned;
}

/**
 * Mid-loop context compaction: when in-flight messages exceed the char budget,
 * compress the oldest tool-call/result exchanges into concise summaries.
 * Keeps system prompt, user messages, and the most recent tool rounds intact.
 * Similar to how Codex and Claude Code compact conversation context.
 */
function pruneInLoopMessages(messages: LLMMessage[], charBudget: number): void {
  const totalChars = measureMessageChars(messages);
  if (totalChars <= charBudget) return;

  // Identify tool exchange groups: assistant (with toolCalls) + following tool results
  const groups: Array<{
    startIndex: number;
    endIndex: number;
    chars: number;
    toolNames: string[];
    assistantText: string;
    outcomes: string[];
  }> = [];

  let index = 1; // skip system prompt
  while (index < messages.length) {
    const msg = messages[index];
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      const groupStart = index;
      let groupChars = msg.content.length;
      const toolNames = msg.toolCalls.map((tc) => tc.name);
      const outcomes: string[] = [];
      index++;
      while (index < messages.length && messages[index].role === 'tool') {
        groupChars += messages[index].content.length;
        // Extract success/error from tool result for summary
        try {
          const parsed = JSON.parse(messages[index].content) as Record<string, unknown>;
          if (parsed.success === false) {
            outcomes.push(`${toolNames[outcomes.length] ?? 'tool'}: failed`);
          } else {
            outcomes.push(`${toolNames[outcomes.length] ?? 'tool'}: ok`);
          }
        } catch {
          outcomes.push(`${toolNames[outcomes.length] ?? 'tool'}: ok`);
        }
        index++;
      }
      groups.push({
        startIndex: groupStart,
        endIndex: index - 1,
        chars: groupChars,
        toolNames,
        assistantText: msg.content,
        outcomes,
      });
    } else {
      index++;
    }
  }

  // Compress oldest groups into summaries until under budget (keep last 3 groups intact)
  let currentChars = totalChars;
  const minKeepGroups = 3;
  const summaryParts: string[] = [];
  const indicesToRemove: number[] = [];

  for (let g = 0; g < groups.length - minKeepGroups && currentChars > charBudget; g++) {
    const group = groups[g];

    // Build a one-line summary for this exchange
    const toolList = group.toolNames.join(', ');
    const outcomeList = group.outcomes.join('; ');
    const thought = group.assistantText ? truncateString(group.assistantText, 80) : '';
    const parts = [`[${toolList}] → ${outcomeList}`];
    if (thought) parts.push(`(${thought})`);
    summaryParts.push(parts.join(' '));

    for (let i = group.startIndex; i <= group.endIndex; i++) {
      indicesToRemove.push(i);
    }
    currentChars -= group.chars;
  }

  if (summaryParts.length > 0) {
    const removeSet = new Set(indicesToRemove);
    const firstDropIdx = indicesToRemove[0];

    // Remove from end to preserve indices
    for (let i = messages.length - 1; i >= 0; i--) {
      if (removeSet.has(i)) {
        messages.splice(i, 1);
      }
    }

    // Insert a compressed summary of all dropped exchanges
    const summaryContent = `[Context compacted — ${summaryParts.length} earlier step(s) summarized]\n${summaryParts.join('\n')}`;
    const summaryChars = summaryContent.length;
    currentChars += summaryChars;

    const summaryMsg: LLMMessage = { role: 'user', content: summaryContent };
    messages.splice(Math.min(firstDropIdx, messages.length), 0, summaryMsg);
  }
}

/**
 * Truncate old tool result messages in-place to free context space.
 * Keeps the last `keepRecent` tool exchange groups intact.
 * For older tool results over `threshold` chars, replaces content with a compact
 * summary preserving success/error status and key identifiers.
 * Returns the number of tool results truncated.
 */
const COMPACT_RESULT_THRESHOLD = 300;
const COMPACT_KEEP_RECENT_GROUPS = 3;

function truncateOldToolResults(messages: LLMMessage[]): number {
  // Identify tool exchange groups to find the "recent" boundary
  const groups: Array<{ startIndex: number; endIndex: number }> = [];
  let idx = 1; // skip system prompt
  while (idx < messages.length) {
    const msg = messages[idx];
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      const start = idx;
      idx++;
      while (idx < messages.length && messages[idx].role === 'tool') {
        idx++;
      }
      groups.push({ startIndex: start, endIndex: idx - 1 });
    } else {
      idx++;
    }
  }

  // Determine which indices belong to recent groups (protected from truncation)
  const recentIndices = new Set<number>();
  const keepFrom = Math.max(0, groups.length - COMPACT_KEEP_RECENT_GROUPS);
  for (let g = keepFrom; g < groups.length; g++) {
    for (let i = groups[g].startIndex; i <= groups[g].endIndex; i++) {
      recentIndices.add(i);
    }
  }

  let truncatedCount = 0;
  for (let i = 1; i < messages.length; i++) {
    if (recentIndices.has(i)) continue;
    const msg = messages[i];

    // Compact old assistant tool call arguments
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        const argStr = safeStringify(tc.arguments);
        if (argStr.length > COMPACT_RESULT_THRESHOLD) {
          // Keep only key identifiers from arguments
          const kept: Record<string, unknown> = {};
          for (const key of ['canvasId', 'nodeId', 'id', 'name', 'title']) {
            if (key in tc.arguments && tc.arguments[key] != null) {
              kept[key] = tc.arguments[key];
            }
          }
          tc.arguments = Object.keys(kept).length > 0
            ? { ...kept, _compacted: true }
            : { _compacted: true };
          truncatedCount++;
        }
      }
      // Also truncate old assistant text
      if (msg.content.length > 500) {
        msg.content = msg.content.slice(0, 200) + '... [compacted]';
      }
      continue;
    }

    if (msg.role !== 'tool') continue;
    if (msg.content.length <= COMPACT_RESULT_THRESHOLD) continue;

    // Truncate: parse JSON, keep success + key fields, drop bulk data
    try {
      const parsed = JSON.parse(msg.content) as Record<string, unknown>;
      const compact: Record<string, unknown> = { success: parsed.success ?? true };

      // Preserve key identifiers from data
      if (isRecord(parsed.data)) {
        const kept: Record<string, unknown> = {};
        for (const key of ['id', 'title', 'name', 'nodeId', 'count', 'total', 'status', 'error']) {
          if (key in parsed.data && parsed.data[key] != null) {
            kept[key] = summarizeScalar(parsed.data[key]);
          }
        }
        // For list results, keep the count
        if (Array.isArray(parsed.data)) {
          compact.data = `[${parsed.data.length} items]`;
        } else if (Object.keys(kept).length > 0) {
          compact.data = kept;
        } else {
          compact.data = '[compacted]';
        }
      } else if (Array.isArray(parsed.data)) {
        compact.data = `[${parsed.data.length} items]`;
      } else if (parsed.error) {
        compact.error = truncateString(String(parsed.error), 120);
      } else {
        compact.data = '[compacted]';
      }

      msg.content = safeStringify(compact);
      truncatedCount++;
    } catch {
      // Not JSON — just hard-truncate
      msg.content = msg.content.slice(0, 200) + '... [compacted]';
      truncatedCount++;
    }
  }

  // Phase 2: Collapse fully-compacted old groups into single summary messages.
  // When all tool results in an old group are small stubs ("[compacted]", "{...}"),
  // replace the entire assistant+tool block with one compact user summary.
  // This reduces message count dramatically for long conversations.
  const MAX_COMPACTED_GROUP_CHARS = 120; // a tool result stub is typically <80 chars
  const collapsibleGroups: Array<{ startIndex: number; endIndex: number }> = [];

  for (let g = 0; g < groups.length - COMPACT_KEEP_RECENT_GROUPS; g++) {
    const group = groups[g];
    let allSmall = true;
    for (let i = group.startIndex; i <= group.endIndex; i++) {
      const m = messages[i];
      if (m.role === 'tool' && m.content.length > MAX_COMPACTED_GROUP_CHARS) {
        allSmall = false;
        break;
      }
      if (m.role === 'assistant' && m.content.length > 300) {
        allSmall = false;
        break;
      }
    }
    if (allSmall) collapsibleGroups.push(group);
  }

  // Collapse from end to preserve indices
  for (let g = collapsibleGroups.length - 1; g >= 0; g--) {
    const group = collapsibleGroups[g];
    const assistantMsg = messages[group.startIndex];
    const toolCount = group.endIndex - group.startIndex;
    const summary = `[${toolCount} tool calls compacted]`;
    // Replace the entire group with a single user-role summary
    messages.splice(group.startIndex, group.endIndex - group.startIndex + 1, {
      role: 'user',
      content: `[Compacted block] ${assistantMsg.content.slice(0, 100)}... — ${summary}`,
    });
    truncatedCount += toolCount;
  }

  return truncatedCount;
}

function stringifyContextExtraValue(value: unknown): string {
  const serialized = typeof value === 'string' ? value : safeStringify(value);
  return truncateString(serialized, CONTEXT_EXTRA_VALUE_CHAR_LIMIT);
}

function compactToolParameter(parameter: LLMToolParameter): LLMToolParameter {
  const compacted: LLMToolParameter = {
    type: parameter.type,
    description: '',
  };

  if (parameter.enum?.length) {
    compacted.enum = [...parameter.enum];
  }
  if (parameter.properties) {
    compacted.properties = Object.fromEntries(
      Object.entries(parameter.properties).map(([key, value]) => [key, compactToolParameter(value)]),
    );
  }
  if (parameter.items) {
    compacted.items = compactToolParameter(parameter.items);
  }

  return compacted;
}

function compactNamedToolDefinitions(
  tools: AgentToolRegistry,
  toolNames: string[],
  contextPage?: string,
): LLMToolDefinition[] {
  const sourceTools = contextPage ? tools.forContext(contextPage) : tools.list();
  return sourceTools
    .filter((tool) => toolNames.includes(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        required: tool.parameters.required,
        properties: Object.fromEntries(
          Object.entries(tool.parameters.properties).map(([key, value]) => [key, compactToolParameter(value)]),
        ),
      },
    }));
}

/**
 * Progressively compact tools when total request size exceeds budget.
 *
 * Tier 1: Strip descriptions + param details from tools not used recently → name-only stubs.
 * Tier 2: Evict tools not used for longer (they can be re-loaded via tool.get).
 * Always-loaded tools are never evicted.
 */
function adaptiveToolCompaction(
  tools: LLMToolDefinition[],
  toolLastUsedStep: Map<string, number>,
  currentStep: number,
  messageChars: number,
  charBudget: number,
): { tools: LLMToolDefinition[]; evictedNames: string[] } {
  const toolChars = safeStringify(tools).length;
  const totalChars = messageChars + toolChars;

  if (totalChars <= charBudget) {
    return { tools, evictedNames: [] };
  }

  const alwaysLoaded = new Set<string>(ALWAYS_LOADED_TOOLS);
  const evictedNames: string[] = [];

  // Tier 1: Strip stale tools to name-only stubs (keep name, minimal params)
  let result = tools.map((tool) => {
    if (alwaysLoaded.has(tool.name)) return tool;
    const lastUsed = toolLastUsedStep.get(tool.name) ?? 0;
    const stepsAgo = currentStep - lastUsed;
    if (stepsAgo >= TOOL_STRIP_AFTER_STEPS) {
      return {
        name: tool.name,
        description: '',
        parameters: { type: 'object' as const, required: tool.parameters.required, properties: {} },
      };
    }
    return tool;
  });

  // Check if tier 1 was enough
  if (messageChars + safeStringify(result).length <= charBudget) {
    return { tools: result, evictedNames };
  }

  // Tier 2: Evict tools not used for a while (not always-loaded)
  result = result.filter((tool) => {
    if (alwaysLoaded.has(tool.name)) return true;
    const lastUsed = toolLastUsedStep.get(tool.name) ?? 0;
    const stepsAgo = currentStep - lastUsed;
    if (stepsAgo >= TOOL_EVICT_AFTER_STEPS) {
      evictedNames.push(tool.name);
      return false;
    }
    return true;
  });

  return { tools: result, evictedNames };
}

function measureMessageChars(messages: LLMMessage[]): number {
  return messages.reduce((total, message) => {
    let chars = message.content.length;
    // Include tool call arguments in the measurement
    if (message.role === 'assistant' && message.toolCalls) {
      for (const tc of message.toolCalls) {
        chars += safeStringify(tc.arguments).length;
      }
    }
    return total + chars;
  }, 0);
}

function summarizeMutationResult(value: unknown): unknown {
  if (!isRecord(value)) {
    return trimObjectStrings(value, 160);
  }

  const summary: Record<string, unknown> = {};
  for (const key of ['id', 'title', 'name', 'nodeTitle', 'nodeId', 'canvasId', 'characterId', 'equipmentId', 'locationId', 'status']) {
    if (key in value && value[key] != null) {
      summary[key] = summarizeScalar(value[key]);
    }
  }

  return Object.keys(summary).length > 0 ? summary : trimObjectStrings(value, 160);
}

/** Meta tools (tool.list, tool.get, guide.*) must never be truncated — they are
 *  the LLM's only way to discover capabilities. Truncating them blinds the agent. */
const META_TOOL_PREFIXES = ['tool.', 'guide.'];

function summarizeToolResult(toolName: string, result: ToolResult, maxResultChars?: number): string {
  const serialized = safeStringify(result);
  if (serialized.length <= SMALL_RESULT_LIMIT) {
    return serialized;
  }

  // Never truncate meta tool results — discovery data must be complete
  if (META_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix))) {
    return serialized;
  }

  const hardLimit = maxResultChars ?? RESULT_HARD_LIMIT;

  // Under the hard limit: return as-is. Tools already paginate and control
  // their own output size — the orchestrator trusts their defaults.
  if (serialized.length <= hardLimit) {
    return serialized;
  }

  // Over the hard limit: trim long string fields but preserve structure.
  // Tell the LLM to use pagination if there's more data.
  const [, action = ''] = toolName.split('.');
  if (MUTATION_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix))) {
    return safeStringify({ success: result.success, data: summarizeMutationResult(result.data) });
  }

  const trimmed = trimObjectStrings(result.data);
  const trimmedStr = safeStringify({ success: result.success, data: trimmed });

  // If still over limit after trimming, add a pagination hint
  if (trimmedStr.length > hardLimit) {
    return safeStringify({
      success: result.success,
      data: trimmed,
      _hint: 'Result was trimmed. Use offset/limit parameters for pagination, or narrow your query.',
    });
  }

  return trimmedStr;
}

export class AgentOrchestrator {
  private adapter: LLMAdapter;
  private tools: AgentToolRegistry;
  private resolvePrompt: (code: string) => string;
  private maxSteps: number;
  private temperature: number;
  private maxTokens: number;
  private pendingResolvers = new Map<string, (approved: boolean) => void>();
  private pendingQuestionResolvers = new Map<string, (answer: string) => void>();
  private activeMessages: LLMMessage[] | null = null;
  private _cancelled = false;
  /** Adaptive concurrency window for parallel tool execution (1 = sequential, max 8). */
  private _adaptiveConcurrency = 3;
  /** Optional custom instructions to guide LLM compaction focus (set via tool.compact). */
  private _compactInstructions: string | null = null;
  /** Tracks consecutive compaction calls to detect thrashing loops. */
  private _compactCount = 0;
  private _lastCompactTime = 0;

  constructor(
    adapter: LLMAdapter,
    tools: AgentToolRegistry,
    resolvePrompt: (code: string) => string,
    opts?: AgentOptions,
  ) {
    this.adapter = adapter;
    this.tools = tools;
    this.resolvePrompt = resolvePrompt;
    this.maxSteps = opts?.maxSteps ?? 50;
    this.temperature = opts?.temperature ?? 0.7;
    this.maxTokens = opts?.maxTokens ?? 200000;
  }

  /** Resolve a pending tool confirmation. Called from outside (IPC handler). */
  confirmTool(toolCallId: string, approved: boolean): void {
    const resolver = this.pendingResolvers.get(toolCallId);
    if (resolver) {
      this.pendingResolvers.delete(toolCallId);
      resolver(approved);
    }
  }

  /** Resolve a pending user question. Called from outside (IPC handler). */
  answerQuestion(toolCallId: string, answer: string): void {
    const resolver = this.pendingQuestionResolvers.get(toolCallId);
    if (resolver) {
      this.pendingQuestionResolvers.delete(toolCallId);
      resolver(answer);
    }
  }

  /** Cancel the running agent. Resolves all pending promises so the loop unblocks. */
  cancel(): void {
    this._cancelled = true;
    for (const [id, resolve] of this.pendingResolvers) {
      resolve(false);
      this.pendingResolvers.delete(id);
    }
    for (const [id, resolve] of this.pendingQuestionResolvers) {
      resolve('');
      this.pendingQuestionResolvers.delete(id);
    }
  }

  /**
   * Trigger context compaction from outside (e.g. tool.compact, UI button).
   * Phase 1: truncate large tool results in-place (fast, no LLM).
   * Phase 2: LLM-based group summarization if still over budget.
   * Returns stats about how much was freed.
   */
  async compactNow(instructions?: string): Promise<{ freedChars: number; messageCount: number; toolCount: number }> {
    if (!this.activeMessages || this.activeMessages.length === 0) {
      return { freedChars: 0, messageCount: 0, toolCount: 0 };
    }

    // Anti-thrashing: if we compacted within the last 15 seconds, stop
    const now = Date.now();
    const ANTI_THRASH_WINDOW_MS = 15_000;
    const MAX_COMPACT_PER_WINDOW = 2;
    if (now - this._lastCompactTime < ANTI_THRASH_WINDOW_MS) {
      this._compactCount++;
      if (this._compactCount >= MAX_COMPACT_PER_WINDOW) {
        return { freedChars: 0, messageCount: this.activeMessages.length, toolCount: 0 };
      }
    } else {
      this._compactCount = 0;
    }
    this._lastCompactTime = now;

    // Set custom instructions if provided (used by compactWithLLM)
    if (instructions) {
      this._compactInstructions = instructions;
    }

    const before = measureMessageChars(this.activeMessages);

    // Phase 1: truncate old tool results in-place (cheap cleanup)
    const truncated = truncateOldToolResults(this.activeMessages);

    // Phase 2: full-replacement LLM compaction if still over budget
    const afterPhase1 = measureMessageChars(this.activeMessages);
    const targetBudget = Math.floor(before * 0.5);
    if (afterPhase1 > targetBudget) {
      await this.compactWithLLM(this.activeMessages, targetBudget);
    }

    const after = measureMessageChars(this.activeMessages);
    return {
      freedChars: Math.max(0, before - after),
      messageCount: this.activeMessages.length,
      toolCount: truncated,
    };
  }

  /**
   * Full-replacement context compaction — modeled after Claude Code / Codex CLI.
   *
   * Strategy (like Codex):
   * 1. Truncate all old tool outputs in-place (cheap, no LLM call)
   * 2. Identify old messages to summarize (everything except system + recent turns)
   * 3. LLM generates a handoff summary of the old content
   * 4. Replace old messages with summary, preserve recent user messages + tool groups
   *
   * Falls back to rule-based pruning if LLM call fails.
   */
  private async compactWithLLM(messages: LLMMessage[], charBudget: number): Promise<boolean> {
    const totalChars = measureMessageChars(messages);
    if (totalChars <= charBudget) return false;

    // Phase 1: Truncate old tool outputs first (cheap cleanup before LLM call)
    truncateOldToolResults(messages);

    const afterTruncation = measureMessageChars(messages);
    if (afterTruncation <= charBudget) return true;

    // Phase 2: Identify the boundary between "old" and "recent" content.
    // Preserve: system prompt (index 0) + recent messages up to COMPACT_KEEP_RECENT_CHARS
    const COMPACT_KEEP_RECENT_CHARS = 80_000; // ~20K tokens of recent context (like Codex's 20K)
    let keptChars = 0;
    let keepFromIndex = messages.length;
    for (let i = messages.length - 1; i > 0; i--) {
      const msgChars = messages[i].content.length;
      if (keptChars + msgChars > COMPACT_KEEP_RECENT_CHARS) break;
      keptChars += msgChars;
      keepFromIndex = i;
    }

    // Ensure we keep at least the last 3 complete tool exchange groups intact
    const minKeepGroups = 3;
    let groupCount = 0;
    for (let i = messages.length - 1; i > 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].toolCalls && messages[i].toolCalls!.length > 0) {
        groupCount++;
        if (groupCount >= minKeepGroups && i < keepFromIndex) {
          keepFromIndex = i;
          break;
        }
      }
    }

    // Also preserve all recent user messages (like Codex keeps last 20K of user messages)
    for (let i = keepFromIndex - 1; i > 0; i--) {
      if (messages[i].role === 'user') {
        keepFromIndex = i;
        break;
      }
    }

    // Old content = everything between system prompt (0) and keepFromIndex
    const oldMessages = messages.slice(1, keepFromIndex);
    if (oldMessages.length === 0) return false;

    try {
      // Build compaction input from old messages
      const compactionInput = oldMessages.map((m) => {
        const role = m.role === 'tool' ? 'tool_result' : m.role;
        const content = m.content.length > 600 ? m.content.slice(0, 600) + '...' : m.content;
        return `[${role}] ${content}`;
      }).join('\n');

      const compactionPrompt =
        'You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for the AI that will continue this task.\n\n'
        + 'Include:\n'
        + '1. Current progress and key decisions made (what was accomplished, which entities/nodes were modified)\n'
        + '2. Important context, constraints, or user preferences discovered\n'
        + '3. What remains to be done (clear next steps)\n'
        + '4. Any critical data: entity IDs, node IDs, canvas IDs, names, settings that were changed\n'
        + '5. Errors encountered and how they were resolved (or still pending)\n\n'
        + 'Be concise, structured, and focused on helping the next AI seamlessly continue the work.\n'
        + 'Output ONLY the summary, no headings or markdown formatting.\n\n'
        + (this._compactInstructions ? `FOCUS: ${this._compactInstructions}\n\n` : '')
        + compactionInput;

      const summary = await this.adapter.complete(
        [{ role: 'user', content: compactionPrompt }],
        { temperature: 0, maxTokens: 800 },
      );

      // Full replacement: remove all old messages, insert summary
      messages.splice(1, keepFromIndex - 1, {
        role: 'user',
        content: `[Context compacted — ${oldMessages.length} messages summarized by AI]\n`
          + 'The AI assistant previously worked on this task and produced the following summary. '
          + 'Use this to build on the work already done and avoid duplicating effort.\n\n'
          + summary,
      });

      return true;
    } catch {
      // LLM call failed — fall back to rule-based compaction
      pruneInLoopMessages(messages, charBudget);
      return true;
    }
  }

  private injectedMessageCount = 0;

  injectMessage(content: string): void {
    const trimmed = content.trim();
    if (!trimmed || !this.activeMessages) {
      return;
    }
    this.activeMessages.push({ role: 'user', content: trimmed });
    this.injectedMessageCount++;
  }

  async execute(
    userMessage: string,
    context: AgentContext,
    emit: (event: AgentEvent) => void,
    options?: AgentExecutionOptions,
  ): Promise<LLMCompletionResult> {
    const loadedToolNames = new Set<string>(ALWAYS_LOADED_TOOLS);
    const discoveredToolNames = new Set<string>(options?.discoveredTools ?? []);
    const systemPrompt = this.buildSystemPrompt(context);

    // Compute context budget from adapter's context window.
    // If js-tiktoken is available, use token-based measurement for accuracy.
    // Budget is expressed in chars for compatibility with pruning functions.
    const detectedCtx = this.adapter.contextWindow;
    const userCtx = this.adapter.userContextWindow;
    const effectiveCtx = this.adapter.effectiveContextWindow;

    // Use the effective context window for history pruning too
    const historyCharBudget = effectiveCtx
      ? effectiveCtx * ESTIMATED_CHARS_PER_TOKEN
      : HISTORY_CHAR_BUDGET;
    const history = pruneHistory(options?.history, historyCharBudget);

    if (userCtx && detectedCtx && userCtx < detectedCtx) {
      emit({
        type: 'stream_chunk',
        content: `[Note: Your configured context window (${userCtx.toLocaleString()} tokens) is smaller than the model's actual context (${detectedCtx.toLocaleString()} tokens). Using your configured value.]\n`,
      });
    }

    // 95% utilization ceiling — compact only when nearly full (like Codex/Claude Code)
    const inLoopTokenBudget = effectiveCtx
      ? Math.floor(effectiveCtx * 0.95)
      : Math.floor(DEFAULT_IN_LOOP_CHAR_BUDGET / ESTIMATED_CHARS_PER_TOKEN);
    const inLoopCharBudget = inLoopTokenBudget * ESTIMATED_CHARS_PER_TOKEN;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((entry): LLMMessage => {
        if (entry.role === 'tool') {
          return { role: 'tool', content: entry.content, toolCallId: entry.toolCallId };
        }
        const msg: LLMMessage = { role: entry.role, content: entry.content };
        if (entry.role === 'assistant' && Array.isArray(entry.toolCalls) && entry.toolCalls.length > 0) {
          msg.toolCalls = entry.toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));
        }
        return msg;
      }),
      { role: 'user', content: userMessage },
    ];

    let steps = 0;
    let lastResult: LLMCompletionResult = { content: '', toolCalls: [], finishReason: 'stop' };
    const toolLastUsedStep = new Map<string, number>();
    // Seed always-loaded tools as "recently used" so they're never evicted
    for (const name of ALWAYS_LOADED_TOOLS) {
      toolLastUsedStep.set(name, 0);
    }

    this.activeMessages = messages;

    // Compact history on load — truncate old tool results and arguments
    // that were preserved from previous sessions
    truncateOldToolResults(messages);
    this.injectedMessageCount = 0;
    this._cancelled = false;
    try {
      while (steps < this.maxSteps) {
        if (this._cancelled || options?.isAborted?.()) {
          emit({ type: 'done', content: 'Cancelled.' });
          return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
        }

        steps++;

        // Mid-loop compaction: use LLM summarization if over budget
        await this.compactWithLLM(messages, inLoopCharBudget);
        // Merge always-loaded + discovered tool names
        const activeToolNames = new Set(loadedToolNames);
        for (const name of discoveredToolNames) {
          activeToolNames.add(name);
        }
        let availableTools = compactNamedToolDefinitions(this.tools, Array.from(activeToolNames), context.page);

        // Adaptive tool compaction: strip or evict tools when context is tight
        const messageChars = measureMessageChars(messages);
        const { tools: compactedTools, evictedNames } = adaptiveToolCompaction(
          availableTools, toolLastUsedStep, steps, messageChars, inLoopCharBudget,
        );
        availableTools = compactedTools;
        for (const evicted of evictedNames) {
          discoveredToolNames.delete(evicted);
        }

        options?.onLLMRequest?.({
          step: steps,
          toolCount: availableTools.length,
          toolSchemaChars: safeStringify(availableTools).length,
          messageCount: messages.length,
          messageChars: measureMessageChars(messages),
          systemPromptChars: systemPrompt.length,
          promptGuideChars: typeof context.extra?.promptGuides === 'string' ? context.extra.promptGuides.length : 0,
        });

        lastResult = await this.completeWithRetry(messages, {
          tools: availableTools.length > 0 ? availableTools : undefined,
          toolChoice: availableTools.length > 0 ? 'auto' : undefined,
          temperature: this.temperature,
          maxTokens: this.maxTokens,
        });

        if (lastResult.content) {
          emit({ type: 'stream_chunk', content: lastResult.content });
        }

        // No tool calls, we're done.
        if (lastResult.toolCalls.length === 0 || lastResult.finishReason !== 'tool_calls') {
          const finalContent = lastResult.content || (lastResult.toolCalls.length === 0 && steps > 1 ? 'Task completed.' : '');
          emit({ type: 'done', content: finalContent });
          return lastResult;
        }

        messages.push({
          role: 'assistant',
          content: lastResult.content,
          toolCalls: lastResult.toolCalls,
        });

        for (const tc of lastResult.toolCalls) {
          toolLastUsedStep.set(tc.name, steps);
        }

        // ──── Deduplicate identical tool calls within this turn ────
        // LLM sometimes emits the same read call multiple times. We detect duplicates
        // (same name + same args JSON) and only execute the first, reusing its result.
        const deduped = new Map<string, string>(); // signature → first tc.id
        const dupMap = new Map<string, string>();   // duplicate tc.id → first tc.id
        const uniqueToolCalls: typeof lastResult.toolCalls = [];
        for (const tc of lastResult.toolCalls) {
          const sig = `${tc.name}::${safeStringify(tc.arguments)}`;
          const existing = deduped.get(sig);
          if (existing) {
            dupMap.set(tc.id, existing);
          } else {
            deduped.set(sig, tc.id);
            uniqueToolCalls.push(tc);
          }
        }
        // Replace toolCalls with deduplicated list for execution
        const toolCallsToExecute = uniqueToolCalls;

        // ──── Adaptive-concurrency tool execution ────
        // Partition tool calls into sequential (interactive) and parallelizable groups.
        // Interactive tools (askUser, needs-confirmation) run one-at-a-time.
        // Normal tools run in adaptive windows: success increases window, failure shrinks it.

        type ToolCallEntry = (typeof lastResult.toolCalls)[number];
        const mode = options?.permissionMode ?? 'normal';

        const isInteractive = (tc: ToolCallEntry): boolean => {
          if (tc.name === 'commander.askUser') return true;
          const tool = this.tools.get(tc.name);
          const tier = tool?.tier ?? 1;
          return needsConfirmation(tier, mode);
        };

        // Split into runs: consecutive parallelizable tools form a batch,
        // interactive tools are solo entries
        type Run = { kind: 'parallel' | 'interactive'; calls: ToolCallEntry[] };
        const runs: Run[] = [];
        for (const tc of toolCallsToExecute) {
          if (isInteractive(tc)) {
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

        // Execute a single tool call (shared logic for both paths)
        const executeSingle = async (tc: ToolCallEntry): Promise<{
          tc: ToolCallEntry; resultContent: string; success: boolean;
        }> => {
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
        };

        // Adaptive concurrency state — persists across runs within this step
        let concurrency = this._adaptiveConcurrency;

        for (const run of runs) {
          if (this._cancelled || options?.isAborted?.()) {
            emit({ type: 'done', content: 'Cancelled.' });
            return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
          }

          if (run.kind === 'interactive') {
            // Sequential interactive handling (askUser / confirm)
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
                this.pendingQuestionResolvers.set(tc.id, resolve);
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
                this.pendingResolvers.set(tc.id, resolve);
              });
              if (!approved) {
                const skippedPayload = { success: false, error: 'Tool execution skipped by user' };
                emit({ type: 'tool_result', toolCallId: tc.id, toolName: tc.name, result: skippedPayload });
                messages.push({ role: 'tool', content: safeStringify(skippedPayload), toolCallId: tc.id });
              } else {
                const res = await executeSingle(tc);
                messages.push({ role: 'tool', content: res.resultContent, toolCallId: tc.id });
              }
            }
            continue;
          }

          // ──── Parallel run with adaptive window ────
          const queue = [...run.calls];
          // Ordered results buffer (preserve LLM ordering for message history)
          const ordered: Map<string, string> = new Map();
          let idx = 0;

          while (idx < queue.length) {
            if (this._cancelled || options?.isAborted?.()) {
              emit({ type: 'done', content: 'Cancelled.' });
              return { content: 'Cancelled.', toolCalls: [], finishReason: 'stop' };
            }

            const windowSize = Math.max(1, Math.min(concurrency, queue.length - idx));
            const batch = queue.slice(idx, idx + windowSize);
            const results = await Promise.all(batch.map(executeSingle));

            let successes = 0;
            let failures = 0;
            for (const res of results) {
              ordered.set(res.tc.id, res.resultContent);
              if (res.success) successes++;
              else failures++;
            }

            // Adjust concurrency: success → grow, failure → shrink
            if (failures === 0 && successes > 0) {
              concurrency = Math.min(concurrency + 1, 8);
            } else if (failures > 0) {
              concurrency = Math.max(1, Math.floor(concurrency * 0.5));
            }

            idx += windowSize;
          }

          // Push results in original LLM-specified order
          for (const tc of run.calls) {
            const content = ordered.get(tc.id);
            if (content != null) {
              messages.push({ role: 'tool', content, toolCallId: tc.id });
            }
          }
        }

        // Persist adaptive concurrency across steps
        this._adaptiveConcurrency = concurrency;

        // Push results for deduplicated tool calls (reuse the first call's result)
        for (const [dupId, firstId] of dupMap) {
          const firstResult = messages.find((m) => m.role === 'tool' && m.toolCallId === firstId);
          if (firstResult) {
            messages.push({ role: 'tool', content: firstResult.content, toolCallId: dupId });
          }
        }

        // Check for user messages injected during tool execution.
        // These are already in the messages array (pushed by injectMessage).
        // Add a system hint so the LLM knows to address them in the next turn.
        if (this.injectedMessageCount > 0) {
          const count = this.injectedMessageCount;
          this.injectedMessageCount = 0;
          messages.push({
            role: 'system',
            content: `[${count} new user message${count > 1 ? 's were' : ' was'} received while you were working. Check the latest user messages above and address them before continuing your current task.]`,
          });
        }
      }

      // Reached maxSteps — notify the user explicitly
      const pendingToolCalls = lastResult.toolCalls.length;
      const limitMsg = pendingToolCalls > 0
        ? `⚠️ Reached the step limit (${this.maxSteps} steps). ${pendingToolCalls} pending tool call(s) were not executed. You can increase "Max Steps" in Settings → Commander, or send a follow-up message to continue.`
        : `Reached the step limit (${this.maxSteps} steps). You can increase "Max Steps" in Settings → Commander if needed.`;
      const finalContent = lastResult.content
        ? `${lastResult.content}\n\n${limitMsg}`
        : limitMsg;
      emit({ type: 'done', content: finalContent });
      return lastResult;
    } finally {
      this.activeMessages = null;
    }
  }

  private async completeWithRetry(
    messages: LLMMessage[],
    opts: Parameters<LLMAdapter['completeWithTools']>[1],
    maxRetries = 2,
  ): Promise<LLMCompletionResult> {
    let lastErr: unknown;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await this.adapter.completeWithTools(messages, opts);
      } catch (err) {
        lastErr = err;
        const isRetryable =
          err instanceof LucidError &&
          (err.code === 'SERVICE_UNAVAILABLE' || err.code === 'RATE_LIMITED');
        if (!isRetryable || i === maxRetries) throw err;
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    throw lastErr;
  }

  private buildSystemPrompt(context: AgentContext): string {
    // Core prompt — always included, kept short
    let prompt = this.resolvePrompt('agent-system');

    // Append context
    const contextLines: string[] = [];
    if (context.page) contextLines.push(`Current page: ${context.page}`);
    if (context.sceneId) contextLines.push(`Active scene ID: ${context.sceneId}`);
    if (context.keyframeId) contextLines.push(`Active keyframe ID: ${context.keyframeId}`);
    if (context.segmentId) contextLines.push(`Active segment ID: ${context.segmentId}`);
    if (context.characterId) contextLines.push(`Active character ID: ${context.characterId}`);
    if (context.extra) {
      for (const [k, v] of Object.entries(context.extra)) {
        contextLines.push(`${k}: ${stringifyContextExtraValue(v)}`);
      }
    }
    if (contextLines.length > 0) {
      prompt += `\n\n## Current Context\n${contextLines.join('\n')}`;
    }

    return prompt;
  }
}
