import type {
  LLMAdapter,
  LLMMessage,
  LLMToolDefinition,
  LLMToolParameter,
} from '@lucid-fin/contracts';
import type { AgentToolRegistry } from './tool-registry.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HISTORY_TOKEN_BUDGET = 200000;
const ESTIMATED_CHARS_PER_TOKEN = 3.5;
const HISTORY_CHAR_BUDGET = Math.floor(HISTORY_TOKEN_BUDGET * ESTIMATED_CHARS_PER_TOKEN);
const CONTEXT_EXTRA_VALUE_CHAR_LIMIT = 600;
/** v2: Tools not used within this many steps get evicted (binary: loaded or evicted). */
const TOOL_EVICT_AFTER_STEPS = 5;
/** Max chars for in-loop messages. Triggers mid-loop pruning. */
const DEFAULT_IN_LOOP_CHAR_BUDGET = 120000;
const COMPACT_RESULT_THRESHOLD = 300;
const COMPACT_KEEP_RECENT_GROUPS = 4;

const QUERY_TOOL_PATTERN =
  /\.(list|get|getNode|listNodes|listEdges|describe|getInfo|previewPrompt)/;

/**
 * Tier A: Tools always loaded regardless of discovery or context.
 * All core read + write tools the AI needs for canvas/entity/generation work.
 * Remaining tools are discoverable via `tool.get`.
 */
export const TIER_A_TOOLS = [
  // ── Meta (3) ──────────────────────────────────────────────────
  'tool.get',
  'commander.askUser',
  'guide.get',

  // ── Canvas reads (4) ──────────────────────────────────────────
  'canvas.getInfo',
  'canvas.listNodes',
  'canvas.getNode',
  'canvas.listEdges',

  // ── Canvas mutation (7) ───────────────────────────────────────
  'canvas.createNodes',
  'canvas.updateNodes',
  'canvas.deleteNode',
  'canvas.connectNodes',
  'canvas.manage',
  'canvas.setNodeRefs',
  'canvas.configureNode',

  // ── Canvas generation (4) ─────────────────────────────────────
  'canvas.generation',
  'canvas.setMediaParams',
  'canvas.previewPrompt',
  'canvas.presetTracks',

  // ── Entity (5) ────────────────────────────────────────────────
  'entity.list',
  'entity.create',
  'entity.update',
  'entity.delete',
  'entity.generateRefImage',

  // ── Domain manage (3) ─────────────────────────────────────────
  'preset.manage',
  'provider.manage',
  // Primary application entrypoint; do not make one-line video ideas depend
  // on a successful discovery round-trip before they can be persisted.
  'workflow.manage',
  // Filtered by the host-derived workflow phase before every model request.
  'workflow.visual',
  'workflow.media',
  'workflow.finalExport',
] as const;

/** @deprecated Use TIER_A_TOOLS instead. Alias kept for backward compatibility during migration. */
export const ALWAYS_LOADED_TOOLS = TIER_A_TOOLS;

export { ESTIMATED_CHARS_PER_TOKEN, DEFAULT_IN_LOOP_CHAR_BUDGET };

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

let _tikEncoder: { encode(text: string): { length: number } } | null | undefined;

void (async () => {
  try {
    const modPath = 'js-tiktoken';
    const mod = (await import(/* webpackIgnore: true */ modPath)) as {
      encodingForModel: (m: string) => { encode(t: string): { length: number } };
    };
    _tikEncoder = mod.encodingForModel('gpt-4o');
  } catch {
    /* js-tiktoken not available */
    _tikEncoder = null;
  }
})();

function estimateTokens(text: string): number {
  if (_tikEncoder) return _tikEncoder.encode(text).length;
  return Math.ceil(text.length / ESTIMATED_CHARS_PER_TOKEN);
}

// Exported for external usage (if needed)
export function _measureMessageTokens(messages: Array<{ content: string }>): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function truncateString(value: string, maxLength = 160): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ success: false, error: 'Failed to serialize tool result' });
  }
}

function summarizeScalar(value: unknown): unknown {
  if (typeof value === 'string') return truncateString(value);
  return value;
}

/** Recursively shorten strings > limit in an object while keeping ALL keys. */
export function trimObjectStrings(value: unknown, limit = 300, depth = 0): unknown {
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

// ---------------------------------------------------------------------------
// History pruning
// ---------------------------------------------------------------------------

export type HistoryEntry =
  | {
      role: 'user' | 'assistant';
      content: string;
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    }
  | { role: 'tool'; content: string; toolCallId: string };

export function pruneHistory(
  history: HistoryEntry[] | undefined,
  charBudget = HISTORY_CHAR_BUDGET,
): HistoryEntry[] {
  if (!history || history.length === 0) return [];

  const entrySize = (e: HistoryEntry): number => {
    let n = e.content.length;
    if ('toolCalls' in e && Array.isArray(e.toolCalls)) {
      for (const tc of e.toolCalls) n += safeStringify(tc.arguments).length;
    }
    return n;
  };

  const pruned: HistoryEntry[] = [];
  let totalChars = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    const entryChars = entrySize(entry);

    if (pruned.length > 0 && totalChars + entryChars > charBudget) break;
    pruned.unshift(entry);
    totalChars += entryChars;
    if (totalChars >= charBudget) break;
  }

  // Ensure we don't start with a dangling tool result
  while (pruned.length > 0 && pruned[0].role === 'tool') {
    pruned.shift();
  }

  // If first message is assistant with toolCalls, ensure ALL referenced
  // tool results are present. Drop the entire exchange if any are missing.
  if (pruned.length > 0 && pruned[0].role === 'assistant') {
    const first = pruned[0] as { toolCalls?: Array<{ id: string }> };
    if (first.toolCalls && first.toolCalls.length > 0) {
      const requiredIds = new Set(first.toolCalls.map((tc) => tc.id));
      const presentIds = new Set(
        pruned
          .filter(
            (e): e is { role: 'tool'; content: string; toolCallId: string } => e.role === 'tool',
          )
          .map((e) => e.toolCallId),
      );
      const allPresent = [...requiredIds].every((id) => presentIds.has(id));
      if (!allPresent) {
        while (pruned.length > 0 && (pruned[0].role === 'assistant' || pruned[0].role === 'tool')) {
          const dropped = pruned.shift()!;
          if (dropped.role !== 'tool' && dropped.role !== 'assistant') break;
          if (
            dropped.role === 'assistant' &&
            !(dropped as { toolCalls?: unknown[] }).toolCalls?.length
          ) {
            pruned.unshift(dropped);
            break;
          }
        }
      }
    }
  }

  return pruned;
}

// ---------------------------------------------------------------------------
// Mid-loop context compaction
// ---------------------------------------------------------------------------

export function measureMessageChars(messages: LLMMessage[]): number {
  return messages.reduce((total, message) => {
    let chars = message.content.length;
    if (message.role === 'assistant' && message.toolCalls) {
      for (const tc of message.toolCalls) {
        chars += safeStringify(tc.arguments).length;
      }
    }
    return total + chars;
  }, 0);
}

// ---------------------------------------------------------------------------
// v2 Tier 1: Smart truncation (rule-based, no LLM)
// Keeps last COMPACT_KEEP_RECENT_GROUPS groups intact.
// Old query tool results → removed entirely (LLM can re-call Tier A).
// Old mutation tool results → {success, id, error} summaries.
// ---------------------------------------------------------------------------

function isQueryTool(toolName: string): boolean {
  return (
    QUERY_TOOL_PATTERN.test(toolName) ||
    toolName.startsWith('tool.') ||
    toolName.startsWith('guide.') ||
    toolName.startsWith('todo.')
  );
}

export function truncateOldToolResults(messages: LLMMessage[]): number {
  const groups: Array<{ startIndex: number; endIndex: number; toolNames: string[] }> = [];
  let idx = 1;
  while (idx < messages.length) {
    const msg = messages[idx];
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      const start = idx;
      const toolNames = msg.toolCalls.map((tc) => tc.name);
      idx++;
      while (idx < messages.length && messages[idx].role === 'tool') idx++;
      groups.push({ startIndex: start, endIndex: idx - 1, toolNames });
    } else {
      idx++;
    }
  }

  const recentIndices = new Set<number>();
  const keepFrom = Math.max(0, groups.length - COMPACT_KEEP_RECENT_GROUPS);
  for (let g = keepFrom; g < groups.length; g++) {
    for (let i = groups[g].startIndex; i <= groups[g].endIndex; i++) {
      recentIndices.add(i);
    }
  }

  let truncatedCount = 0;

  // Map from toolCallId to toolName for quick lookup
  const toolCallIdToName = new Map<string, string>();
  for (let i = 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        if (tc.id) toolCallIdToName.set(tc.id, tc.name);
      }
    }
  }

  for (let i = 1; i < messages.length; i++) {
    if (recentIndices.has(i)) continue;
    const msg = messages[i];

    // Compact old assistant arguments
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        const argStr = safeStringify(tc.arguments);
        if (argStr.length > COMPACT_RESULT_THRESHOLD) {
          const kept: Record<string, unknown> = {};
          for (const key of ['canvasId', 'nodeId', 'id', 'name', 'title']) {
            if (key in tc.arguments && tc.arguments[key] != null) {
              kept[key] = tc.arguments[key];
            }
          }
          tc.arguments =
            Object.keys(kept).length > 0 ? { ...kept, _compacted: true } : { _compacted: true };
          truncatedCount++;
        }
      }
      if (msg.content.length > 500) {
        msg.content = msg.content.slice(0, 200) + '... [compacted]';
      }
      continue;
    }

    if (msg.role !== 'tool') continue;

    // Determine if this tool result is from a query tool
    const toolCallId = (msg as { toolCallId?: string }).toolCallId;
    const toolName = toolCallId ? toolCallIdToName.get(toolCallId) : undefined;

    // Query tool results → remove entirely (replace with minimal marker)
    if (toolName && isQueryTool(toolName)) {
      msg.content = `{"_removed":"query result compacted","tool":"${toolName}"}`;
      truncatedCount++;
      continue;
    }

    // Mutation tool results → structured summary with key fields
    if (msg.content.length <= COMPACT_RESULT_THRESHOLD) continue;

    try {
      const parsed = JSON.parse(msg.content) as Record<string, unknown>;
      const compact: Record<string, unknown> = { success: parsed.success ?? true };

      // Preserve error info
      if (parsed.error) {
        compact.error = truncateString(String(parsed.error), 200);
      }

      if (isRecord(parsed.data)) {
        const kept: Record<string, unknown> = {};
        for (const key of [
          'id',
          'nodeId',
          'canvasId',
          'title',
          'name',
          'count',
          'total',
          'status',
          'error',
          'characterId',
          'locationId',
          'equipmentId',
        ]) {
          if (key in parsed.data && parsed.data[key] != null) {
            kept[key] = summarizeScalar(parsed.data[key]);
          }
        }
        if (Array.isArray(parsed.data)) {
          compact.data = `[${parsed.data.length} items]`;
        } else if (Object.keys(kept).length > 0) {
          compact.data = kept;
        } else {
          compact.data = '[compacted]';
        }
      } else if (Array.isArray(parsed.data)) {
        compact.data = `[${parsed.data.length} items]`;
      } else {
        compact.data = '[compacted]';
      }

      msg.content = safeStringify(compact);
      truncatedCount++;
    } catch {
      msg.content = msg.content.slice(0, 200) + '... [compacted]';
      truncatedCount++;
    }
  }

  // Phase 2: Collapse fully-compacted old groups into single summary messages.
  const MAX_COMPACTED_GROUP_CHARS = 120;
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

  for (let g = collapsibleGroups.length - 1; g >= 0; g--) {
    const group = collapsibleGroups[g];
    const assistantMsg = messages[group.startIndex];
    const toolCount = group.endIndex - group.startIndex;
    const summary = `[${toolCount} tool calls compacted]`;
    messages.splice(group.startIndex, group.endIndex - group.startIndex + 1, {
      role: 'user',
      content: `[Compacted block] ${assistantMsg.content.slice(0, 100)}... — ${summary}`,
    });
    truncatedCount += toolCount;
  }

  return truncatedCount;
}

// ---------------------------------------------------------------------------
// Tool definition compaction
// ---------------------------------------------------------------------------

function compactToolParameter(parameter: LLMToolParameter): LLMToolParameter {
  const compacted: LLMToolParameter = {
    type: parameter.type,
    description: '',
  };
  if (parameter.enum?.length) compacted.enum = [...parameter.enum];
  if (parameter.properties) {
    compacted.properties = Object.fromEntries(
      Object.entries(parameter.properties).map(([key, value]) => [
        key,
        compactToolParameter(value),
      ]),
    );
  }
  if (parameter.items) compacted.items = compactToolParameter(parameter.items);
  return compacted;
}

export function compactNamedToolDefinitions(
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
          Object.entries(tool.parameters.properties).map(([key, value]) => [
            key,
            compactToolParameter(value),
          ]),
        ),
      },
    }));
}

/**
 * v2: Binary tool compaction — tools are either fully loaded or evicted.
 * Tier A tools are never evicted. Other tools are evicted after
 * TOOL_EVICT_AFTER_STEPS steps without use (re-discoverable via tool.get).
 */
export function adaptiveToolCompaction(
  tools: LLMToolDefinition[],
  toolLastUsedStep: Map<string, number>,
  currentStep: number,
  _messageChars: number,
  _charBudget: number,
): { tools: LLMToolDefinition[]; evictedNames: string[] } {
  const tierA = new Set<string>(TIER_A_TOOLS);
  const evictedNames: string[] = [];

  const result = tools.filter((tool) => {
    if (tierA.has(tool.name)) return true;
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

// ---------------------------------------------------------------------------
// Context extra helpers
// ---------------------------------------------------------------------------

function stringifyContextExtraValue(value: unknown): string {
  const serialized = typeof value === 'string' ? value : safeStringify(value);
  return truncateString(serialized, CONTEXT_EXTRA_VALUE_CHAR_LIMIT);
}

// ---------------------------------------------------------------------------
// AgentContext type (re-exported for convenience)
// ---------------------------------------------------------------------------

export interface AgentContext {
  page?: string;
  characterId?: string;
  extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Context-aware tool set selection  (1B)
// ---------------------------------------------------------------------------

/**
 * Workspace-state + user-intent inputs for context-aware tool loading.
 * Kept for API compatibility — the function now returns TIER_A for all
 * inputs (no regex keyword matching, no intent-based filtering).
 */
export interface ToolSelectionInput {
  /** Number of canvas nodes (0 = empty canvas). */
  nodeCount: number;
  /** Total characters + locations + equipment. */
  entityCount: number;
  /** Whether the canvas has a non-empty stylePlate. */
  hasStylePlate: boolean;
  /** Whether the user has selected nodes in the canvas. */
  hasSelectedNodes: boolean;
  /** Raw user message text — no longer used for keyword matching. */
  userMessage: string;
  /** Classified intent kind: 'execution' | 'informational'. */
  intentKind: string;
  /** Optional detected workflow hint. */
  intentWorkflow?: string;
}

/**
 * Return the set of tool names that should be fully loaded on step 1.
 * All core tools live in TIER_A and are always loaded — no regex keyword
 * matching, no intent-based filtering. Remaining tools (series, render,
 * job, asset, admin providers, etc.) are discoverable via `tool.get`.
 *
 * Pure function — no side-effects, no registry mutation.
 */
export function selectContextualToolSet(_input: ToolSelectionInput): Set<string> {
  return new Set<string>(TIER_A_TOOLS);
}

// ---------------------------------------------------------------------------
// ContextManager class
// ---------------------------------------------------------------------------

export interface ContextManagerOptions {
  maxContextChars?: number;
  /** Persist and validate durable facts before an LLM handoff compaction.
   *  Returning false (or throwing) aborts compaction without mutating the
   *  model view. */
  onBeforeCompact?: () => boolean;
  /** Called after LLM compaction completes. Return a string block to inject
   *  into the compacted message (e.g. fresh workspace snapshot). Empty/null
   *  strings are silently skipped. */
  onPostCompact?: () => string | null;
}

export class ContextManager {
  private _compactInstructions: string | null = null;
  private _scratchpad: string | null = null;
  private _lastAutoCompactTime = Number.NEGATIVE_INFINITY;
  private _lastAutoCompactTurn = Number.NEGATIVE_INFINITY;
  private _lowYieldLlmCompactions = 0;
  private _llmCompactionDisabled = false;
  /** Automatic compaction must not thrash within the same working set. */
  private static readonly COMPACT_MIN_INTERVAL_MS = 30_000;
  private static readonly COMPACT_MIN_TURN_DISTANCE = 2;
  private static readonly MIN_COMPACTION_YIELD = 0.15;

  /**
   * Automatic compaction throttle. Explicit user compaction bypasses this
   * guard, while automatic compaction needs both two turns and 30 seconds of
   * distance from the previous attempt.
   */
  private _beginAutoCompaction(currentTurn?: number): boolean {
    const now = Date.now();
    const tooSoonInTime = now - this._lastAutoCompactTime < ContextManager.COMPACT_MIN_INTERVAL_MS;
    const tooSoonInTurns =
      currentTurn !== undefined &&
      Number.isFinite(this._lastAutoCompactTurn) &&
      currentTurn - this._lastAutoCompactTurn < ContextManager.COMPACT_MIN_TURN_DISTANCE;
    if (tooSoonInTime || tooSoonInTurns) {
      return false;
    }
    this._lastAutoCompactTime = now;
    if (currentTurn !== undefined) this._lastAutoCompactTurn = currentTurn;
    return true;
  }

  constructor(
    private llm: LLMAdapter,
    private resolvePrompt: (code: string) => string,
    private _opts?: ContextManagerOptions,
  ) {}

  /** Set custom instructions for LLM compaction. */
  setCompactInstructions(instructions: string): void {
    this._compactInstructions = instructions;
  }

  /** Update the scratchpad content (persists across compaction). */
  setScratchpad(content: string | null): void {
    this._scratchpad = content;
  }

  /** Get the current scratchpad content. */
  getScratchpad(): string | null {
    return this._scratchpad;
  }

  /** A new user turn creates a new working set and re-enables LLM compaction. */
  noteUserInput(): void {
    this._lowYieldLlmCompactions = 0;
    this._llmCompactionDisabled = false;
  }

  buildSystemPrompt(context: AgentContext, step?: number): string {
    // ── Layer 1: Identity & rules (static, Anthropic cacheable) ──────
    let prompt = this.resolvePrompt('agent-system');

    prompt += '\n\n<!-- CACHE_BREAK -->\n';

    // ── Layer 2: Session context (dynamic, compact) ─────────────────
    const contextLines: string[] = [];
    if (context.page) contextLines.push(`Current page: ${context.page}`);
    if (context.characterId) contextLines.push(`Active character ID: ${context.characterId}`);
    if (context.extra) {
      for (const [k, v] of Object.entries(context.extra)) {
        if (k === 'masterIndex') continue;
        if (k === 'workspaceSnapshot') continue;
        if (k === 'workflowManifest') continue;
        if (k === 'autoInjectGuides') continue;
        if (step && step > 5 && k === 'promptGuides') continue;
        if (k === 'classifiedIntent') {
          contextLines.push(`Classified intent: ${String(v)}`);
          continue;
        }
        contextLines.push(`${k}: ${stringifyContextExtraValue(v)}`);
      }
    }
    if (contextLines.length > 0) {
      prompt += `\n\n## Current Context\n${contextLines.join('\n')}`;
    }

    const workspaceSnapshot = context.extra?.workspaceSnapshot;
    if (typeof workspaceSnapshot === 'string' && workspaceSnapshot.trim().length > 0) {
      prompt += `\n\n## Workspace Snapshot\n${workspaceSnapshot}`;
    }

    const workflowManifest = context.extra?.workflowManifest;
    if (typeof workflowManifest === 'string' && workflowManifest.trim().length > 0) {
      prompt += `\n\n## Persistent Workflow Manifest\n${workflowManifest}`;
    }

    // ── Layer 3: Scratchpad (persistent across compaction) ──────────
    if (this._scratchpad && this._scratchpad.trim().length > 0) {
      prompt += `\n\n## Scratchpad\n${this._scratchpad}`;
    }

    // ── Layer 4: User guides (auto-injected, budget-limited) ────────
    // Strip guides after step 5 to free tokens for history.
    const stripGuides = step != null && step > 5;
    const autoInjectGuides = stripGuides ? undefined : context.extra?.autoInjectGuides;
    if (Array.isArray(autoInjectGuides) && autoInjectGuides.length > 0) {
      prompt += '\n\n## User Guides';
      for (const guide of autoInjectGuides) {
        if (
          guide &&
          typeof guide === 'object' &&
          typeof (guide as { name?: unknown }).name === 'string' &&
          typeof (guide as { content?: unknown }).content === 'string'
        ) {
          const g = guide as { name: string; content: string };
          prompt += `\n\n### ${g.name}\n${g.content}`;
        }
      }
    }

    return prompt;
  }

  /**
   * Phase 1 only: fast rule-based compaction (truncate old tool results).
   * No LLM call. Used proactively at 80% utilization.
   * Returns true if any changes were made.
   */
  compactPhase1(messages: LLMMessage[], currentTurn?: number): boolean {
    if (!this._beginAutoCompaction(currentTurn)) return false;
    const before = measureMessageChars(messages);
    const snapshot = cloneMessages(messages);
    truncateOldToolResults(messages);
    const after = measureMessageChars(messages);
    if (before <= 0 || (before - after) / before < ContextManager.MIN_COMPACTION_YIELD) {
      messages.splice(0, messages.length, ...snapshot);
      return false;
    }
    return true;
  }

  /** Flush and validate durable state before a critical deterministic prune. */
  checkpointDurableFacts(): boolean {
    return this._checkpointDurableFacts();
  }

  /**
   * v2 Tier 2: LLM handoff compaction. Produces a structured summary
   * with [entities] section for ID preservation. 1200 token limit.
   */
  async compactWithLLM(
    messages: LLMMessage[],
    charBudget: number,
    currentTurn?: number,
  ): Promise<boolean> {
    const result = await this._compactWithLLM(messages, charBudget, currentTurn, false);
    return result.changed;
  }

  private async _compactWithLLM(
    messages: LLMMessage[],
    charBudget: number,
    currentTurn: number | undefined,
    explicit: boolean,
  ): Promise<{ changed: boolean; truncated: number }> {
    const totalChars = measureMessageChars(messages);
    if (totalChars <= charBudget) return { changed: false, truncated: 0 };
    if (!explicit && !this._beginAutoCompaction(currentTurn)) {
      return { changed: false, truncated: 0 };
    }
    if (!this._checkpointDurableFacts()) {
      return { changed: false, truncated: 0 };
    }

    const snapshot = cloneMessages(messages);

    // Run Tier 1 in the same attempt. Calling the public method here would
    // consume the throttle twice and silently skip rule-based pruning.
    const truncated = truncateOldToolResults(messages);

    const afterTruncation = measureMessageChars(messages);
    if (afterTruncation <= charBudget) {
      this._appendPostCompactReload(messages);
      return this._finishCompactionAttempt(
        messages,
        snapshot,
        totalChars,
        truncated,
        false,
        explicit,
      );
    }

    if (this._llmCompactionDisabled && !explicit) {
      return this._finishCompactionAttempt(
        messages,
        snapshot,
        totalChars,
        truncated,
        false,
        explicit,
      );
    }

    // Identify boundary between "old" and "recent" content.
    const COMPACT_KEEP_RECENT_CHARS = 80_000;
    let keptChars = 0;
    let keepFromIndex = messages.length;
    for (let i = messages.length - 1; i > 0; i--) {
      const msgChars = messages[i].content.length;
      if (keptChars + msgChars > COMPACT_KEEP_RECENT_CHARS) break;
      keptChars += msgChars;
      keepFromIndex = i;
    }

    // Ensure at least the last 4 complete tool exchange groups intact
    let groupCount = 0;
    for (let i = messages.length - 1; i > 0; i--) {
      if (
        messages[i].role === 'assistant' &&
        messages[i].toolCalls &&
        messages[i].toolCalls!.length > 0
      ) {
        groupCount++;
        if (groupCount >= COMPACT_KEEP_RECENT_GROUPS) {
          if (i < keepFromIndex) keepFromIndex = i;
          break;
        }
      }
    }

    // Preserve all recent user messages
    for (let i = keepFromIndex - 1; i > 0; i--) {
      if (messages[i].role === 'user') {
        keepFromIndex = i;
        break;
      }
    }

    const oldMessages = messages.slice(1, keepFromIndex);
    if (oldMessages.length === 0) {
      return this._finishCompactionAttempt(
        messages,
        snapshot,
        totalChars,
        truncated,
        false,
        explicit,
      );
    }

    try {
      // Pre-extract all IDs from full messages before truncation so they
      // survive the 800-char limit. Pattern: UUID-like, or known prefixes.
      const ID_PATTERN =
        /\b(?:char|loc|equip|node|canvas|ent|preset|job|shot|wf)[-_][a-zA-Z0-9_-]{4,64}\b/g;
      const extractedIds = new Set<string>();
      for (const m of oldMessages) {
        for (const match of m.content.matchAll(ID_PATTERN)) {
          extractedIds.add(match[0]);
        }
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            const argStr = safeStringify(tc.arguments);
            for (const match of argStr.matchAll(ID_PATTERN)) {
              extractedIds.add(match[0]);
            }
          }
        }
      }
      const idPreExtract =
        extractedIds.size > 0
          ? `\n\nPRE-EXTRACTED IDs (from full messages before truncation — include ALL in [entities]):\n${[...extractedIds].join('\n')}\n`
          : '';

      const maxCompactionInputChars = Math.max(8_000, Math.min(60_000, charBudget));
      const compactableLines = oldMessages.map((m) => {
        const role = m.role === 'tool' ? 'tool_result' : m.role;
        const content = m.content.length > 800 ? m.content.slice(0, 800) + '...' : m.content;
        return `[${role}] ${content}`;
      });
      const keptCompactionLines: string[] = [];
      let keptCompactionChars = 0;
      for (let index = compactableLines.length - 1; index >= 0; index--) {
        const line = compactableLines[index];
        if (line === undefined) continue;
        if (
          keptCompactionLines.length > 0 &&
          keptCompactionChars + line.length > maxCompactionInputChars
        ) {
          break;
        }
        keptCompactionLines.unshift(line);
        keptCompactionChars += line.length;
      }
      const compactionInput = keptCompactionLines.join('\n');

      const compactionPrompt =
        'You are performing a CONTEXT CHECKPOINT COMPACTION. Create a structured handoff summary.\n\n' +
        'Use EXACTLY these section tags:\n' +
        '[done] What was accomplished (include tool names, entity IDs, node IDs, canvas IDs)\n' +
        '[failed] What failed and why (include tool name, error message, parameter that caused it)\n' +
        '[pending] What remains to be done (clear next steps)\n' +
        '[decisions] Key creative decisions confirmed by the user\n' +
        '[entities] ALL entity IDs mentioned (character IDs, location IDs, equipment IDs, node IDs, canvas IDs) — one per line as `type: id (name)`\n\n' +
        'Rules:\n' +
        '- Preserve ALL IDs — they cannot be recovered after compaction\n' +
        '- For failures, include the EXACT error so the next step can avoid repeating it\n' +
        '- Omit empty sections\n' +
        '- Be concise — the next AI must continue without re-reading the full transcript\n\n' +
        (this._compactInstructions ? `FOCUS: ${this._compactInstructions}\n\n` : '') +
        (this._scratchpad ? `SCRATCHPAD (preserve this context):\n${this._scratchpad}\n\n` : '') +
        idPreExtract +
        compactionInput;

      const summary = await this.llm.complete([{ role: 'user', content: compactionPrompt }], {
        temperature: 0,
        maxTokens: 1200,
      });

      const reloadBlock = this._readPostCompactReload();
      const reloadSuffix =
        reloadBlock && reloadBlock.trim().length > 0
          ? `\n\n--- WORKSPACE CONTEXT RELOAD (fresh from current state) ---\n${reloadBlock}`
          : '';

      messages.splice(1, keepFromIndex - 1, {
        role: 'user',
        content:
          `[Context compacted — ${oldMessages.length} messages summarized by AI]\n` +
          'The AI assistant previously worked on this task and produced the following summary. ' +
          'Use this to build on the work already done and avoid duplicating effort.\n\n' +
          summary +
          reloadSuffix,
      });

      return this._finishCompactionAttempt(
        messages,
        snapshot,
        totalChars,
        truncated,
        true,
        explicit,
      );
    } catch {
      // LLM summary failed. Keep deterministic pruning only when it produced
      // a meaningful reduction; otherwise restore the exact prior model view.
      return this._finishCompactionAttempt(
        messages,
        snapshot,
        totalChars,
        truncated,
        true,
        explicit,
      );
    }
  }

  private _checkpointDurableFacts(): boolean {
    if (!this._opts?.onBeforeCompact) return true;
    try {
      return this._opts.onBeforeCompact() === true;
    } catch {
      return false;
    }
  }

  private _readPostCompactReload(): string | null {
    try {
      const reload = this._opts?.onPostCompact?.();
      return reload && reload.trim().length > 0 ? reload : null;
    } catch {
      return null;
    }
  }

  private _appendPostCompactReload(messages: LLMMessage[]): void {
    const reloadBlock = this._readPostCompactReload();
    if (!reloadBlock) return;
    messages.push({
      role: 'user',
      content: `--- WORKSPACE CONTEXT RELOAD (fresh from current state) ---\n${reloadBlock}`,
    });
  }

  private _finishCompactionAttempt(
    messages: LLMMessage[],
    snapshot: LLMMessage[],
    beforeChars: number,
    truncated: number,
    llmAttempted: boolean,
    explicit: boolean,
  ): { changed: boolean; truncated: number } {
    const afterChars = measureMessageChars(messages);
    const yieldRatio = beforeChars > 0 ? (beforeChars - afterChars) / beforeChars : 0;
    const meaningful = yieldRatio >= ContextManager.MIN_COMPACTION_YIELD;

    if (!meaningful && !explicit) {
      messages.splice(0, messages.length, ...snapshot);
      if (llmAttempted) {
        this._lowYieldLlmCompactions += 1;
        if (this._lowYieldLlmCompactions >= 2) this._llmCompactionDisabled = true;
      }
      return { changed: false, truncated: 0 };
    }

    if (meaningful && llmAttempted) this._lowYieldLlmCompactions = 0;
    return { changed: afterChars < beforeChars, truncated };
  }

  /**
   * Trigger context compaction from outside (e.g. tool.compact, UI button).
   * Phase 1: truncate large tool results in-place (fast, no LLM).
   * Phase 2: LLM-based group summarization if still over budget.
   */
  async compactNow(
    messages: LLMMessage[] | null,
    instructions?: string,
  ): Promise<{ freedChars: number; messageCount: number; toolCount: number }> {
    if (!messages || messages.length === 0) {
      return { freedChars: 0, messageCount: 0, toolCount: 0 };
    }

    if (instructions) this._compactInstructions = instructions;

    const before = measureMessageChars(messages);
    const targetBudget = Math.floor(before * 0.5);
    const result = await this._compactWithLLM(messages, targetBudget, undefined, true);

    const after = measureMessageChars(messages);
    return {
      freedChars: Math.max(0, before - after),
      messageCount: messages.length,
      toolCount: result.truncated,
    };
  }
}

function cloneMessages(messages: LLMMessage[]): LLMMessage[] {
  return messages.map((message) => ({
    ...message,
    toolCalls: message.toolCalls?.map((toolCall) => ({
      ...toolCall,
      arguments: { ...toolCall.arguments },
    })),
  }));
}
