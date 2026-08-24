import type { LLMAdapter, LLMMessage } from '@lucid-fin/contracts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HISTORY_TOKEN_BUDGET = 200000;
const ESTIMATED_CHARS_PER_TOKEN = 3.5;
const HISTORY_CHAR_BUDGET = Math.floor(HISTORY_TOKEN_BUDGET * ESTIMATED_CHARS_PER_TOKEN);
const CONTEXT_EXTRA_VALUE_CHAR_LIMIT = 600;
/** Max chars for in-loop messages. Triggers mid-loop pruning. */
const DEFAULT_IN_LOOP_CHAR_BUDGET = 120000;
const COMPACT_RESULT_THRESHOLD = 300;
const COMPACT_KEEP_RECENT_GROUPS = 4;

const QUERY_TOOL_PATTERN =
  /\.(list|get|getNode|listNodes|listEdges|describe|getInfo|previewPrompt|resolveResolution)/;

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
  | { role: 'system'; content: string }
  | {
      role: 'user' | 'assistant';
      content: string;
      reasoning?: string;
      toolCalls?: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        thoughtSignature?: string;
      }>;
    }
  | { role: 'tool'; content: string; toolCallId: string };

export function pruneHistory(
  history: readonly HistoryEntry[] | undefined,
  charBudget = HISTORY_CHAR_BUDGET,
): HistoryEntry[] {
  if (!history || history.length === 0) return [];

  const entrySize = (e: HistoryEntry): number => {
    let n = e.content.length + ('reasoning' in e ? (e.reasoning?.length ?? 0) : 0);
    if ('toolCalls' in e && Array.isArray(e.toolCalls)) {
      for (const tc of e.toolCalls) n += safeStringify(tc.arguments).length;
    }
    return n;
  };

  const newestFirst: HistoryEntry[] = [];
  let totalChars = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    const entryChars = entrySize(entry);

    if (newestFirst.length > 0 && totalChars + entryChars > charBudget) break;
    newestFirst.push(entry);
    totalChars += entryChars;
    if (totalChars >= charBudget) break;
  }

  let pruned = newestFirst.reverse();

  // Ensure we don't start with a dangling tool result
  let startIndex = 0;
  while (pruned[startIndex]?.role === 'tool') startIndex += 1;
  if (startIndex > 0) pruned = pruned.slice(startIndex);

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
        let dropCount = 0;
        while (
          dropCount < pruned.length &&
          (pruned[dropCount]!.role === 'assistant' || pruned[dropCount]!.role === 'tool')
        ) {
          const dropped = pruned[dropCount]!;
          if (
            dropped.role === 'assistant' &&
            !(dropped as { toolCalls?: unknown[] }).toolCalls?.length
          ) {
            break;
          }
          dropCount += 1;
        }
        if (dropCount > 0) pruned = pruned.slice(dropCount);
      }
    }
  }

  return structuredClone(pruned);
}

// ---------------------------------------------------------------------------
// Mid-loop context compaction
// ---------------------------------------------------------------------------

export function measureMessageChars(messages: readonly LLMMessage[]): number {
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
    toolName.startsWith('runChecklist.')
  );
}

export interface ToolTruncationResult {
  view: LLMMessage[];
  truncated: number;
}

export function truncateOldToolResults(
  messages: readonly LLMMessage[],
): ToolTruncationResult {
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

  const truncatedView = messages.map((msg, index) => {
    if (recentIndices.has(index)) return cloneMessage(msg);

    // Compact old assistant arguments.
    if (msg.role === 'assistant' && msg.toolCalls) {
      const toolCalls = msg.toolCalls.map((toolCall) => {
        if (safeStringify(toolCall.arguments).length <= COMPACT_RESULT_THRESHOLD) {
          return structuredClone(toolCall);
        }

        const kept: Record<string, unknown> = {};
        for (const key of ['canvasId', 'nodeId', 'id', 'name', 'title']) {
          if (key in toolCall.arguments && toolCall.arguments[key] != null) {
            kept[key] = structuredClone(toolCall.arguments[key]);
          }
        }
        truncatedCount++;
        return {
          ...structuredClone(toolCall),
          arguments:
            Object.keys(kept).length > 0 ? { ...kept, _compacted: true } : { _compacted: true },
        };
      });
      return {
        ...cloneMessage(msg),
        content:
          msg.content.length > 500 ? msg.content.slice(0, 200) + '... [compacted]' : msg.content,
        toolCalls,
      };
    }

    if (msg.role !== 'tool') return cloneMessage(msg);

    const toolName = msg.toolCallId ? toolCallIdToName.get(msg.toolCallId) : undefined;
    if (toolName && isQueryTool(toolName)) {
      truncatedCount++;
      return {
        ...cloneMessage(msg),
        content: `{"_removed":"query result compacted","tool":"${toolName}"}`,
      };
    }

    if (msg.content.length <= COMPACT_RESULT_THRESHOLD) return cloneMessage(msg);

    let content: string;
    try {
      const parsed = JSON.parse(msg.content) as Record<string, unknown>;
      const compact: Record<string, unknown> = { success: parsed.success ?? true };

      if (parsed.error) compact.error = truncateString(String(parsed.error), 200);

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
        compact.data = Object.keys(kept).length > 0 ? kept : '[compacted]';
      } else if (Array.isArray(parsed.data)) {
        compact.data = `[${parsed.data.length} items]`;
      } else {
        compact.data = '[compacted]';
      }
      content = safeStringify(compact);
    } catch {
      content = msg.content.slice(0, 200) + '... [compacted]';
    }
    truncatedCount++;
    return { ...cloneMessage(msg), content };
  });

  // Phase 2: Collapse fully-compacted old groups into single summary messages.
  const MAX_COMPACTED_GROUP_CHARS = 120;
  const collapsibleGroups: Array<{ startIndex: number; endIndex: number }> = [];

  for (let g = 0; g < groups.length - COMPACT_KEEP_RECENT_GROUPS; g++) {
    const group = groups[g];
    let allSmall = true;
    for (let i = group.startIndex; i <= group.endIndex; i++) {
      const m = truncatedView[i];
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

  const collapsibleByStart = new Map(collapsibleGroups.map((group) => [group.startIndex, group]));
  const view: LLMMessage[] = [];
  for (let index = 0; index < truncatedView.length; index++) {
    const group = collapsibleByStart.get(index);
    if (!group) {
      view.push(truncatedView[index]!);
      continue;
    }

    const assistantMsg = truncatedView[group.startIndex]!;
    const toolCount = group.endIndex - group.startIndex;
    view.push({
      role: 'user',
      content: `[Compacted block] ${assistantMsg.content.slice(0, 100)}... — [${toolCount} tool calls compacted]`,
    });
    truncatedCount += toolCount;
    index = group.endIndex;
  }

  return { view, truncated: truncatedCount };
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

export interface ContextCompactionResult {
  changed: boolean;
  truncated: number;
  /** False when no attempt ran (already under budget or auto-throttled). */
  attempted: boolean;
  /** Provider-ready derived view. The source messages are never mutated. */
  view: LLMMessage[];
}

class PostCompactReloadError extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original));
    this.name = 'PostCompactReloadError';
  }
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
        if (k === 'taskListManifest') continue;
        if (k === 'autoInjectGuides') continue;
        if (step && step > 5 && k === 'promptGuides') continue;
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

    const taskListManifest = context.extra?.taskListManifest;
    if (typeof taskListManifest === 'string' && taskListManifest.trim().length > 0) {
      prompt += `\n\n## Persistent Task List Manifest\n${taskListManifest}`;
    }

    // ── Layer 3: Scratchpad (persistent across compaction) ──────────
    if (this._scratchpad && this._scratchpad.trim().length > 0) {
      prompt += `\n\n## Scratchpad\n${this._scratchpad}`;
    }

    // ── Layer 4: User guides (auto-injected, budget-limited) ────────
    // After the opening steps retain only task-list-critical guides. Selection
    // and the hard character budget are enforced by the host context builder.
    const stripGuides = step != null && step > 5;
    const rawAutoInjectGuides = context.extra?.autoInjectGuides;
    const autoInjectGuides =
      stripGuides && Array.isArray(rawAutoInjectGuides)
        ? rawAutoInjectGuides.filter(
            (guide) =>
              guide &&
              typeof guide === 'object' &&
              (guide as { retention?: unknown }).retention === 'task_list',
          )
        : rawAutoInjectGuides;
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
   * No LLM call. Used proactively at 75% utilization.
   * Returns the derived view and compaction statistics.
   */
  compactPhase1(
    messages: readonly LLMMessage[],
    currentTurn?: number,
  ): ContextCompactionResult {
    const sourceView = cloneMessages(messages);
    if (!this._beginAutoCompaction(currentTurn)) {
      return { changed: false, truncated: 0, attempted: false, view: sourceView };
    }
    const before = measureMessageChars(messages);
    const truncation = truncateOldToolResults(messages);
    const after = measureMessageChars(truncation.view);
    if (before <= 0 || (before - after) / before < ContextManager.MIN_COMPACTION_YIELD) {
      return { changed: false, truncated: 0, attempted: true, view: sourceView };
    }
    return {
      changed: true,
      truncated: truncation.truncated,
      attempted: true,
      view: truncation.view,
    };
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
    messages: readonly LLMMessage[],
    charBudget: number,
    currentTurn?: number,
  ): Promise<ContextCompactionResult> {
    return this.compactWithLLMResult(messages, charBudget, currentTurn);
  }

  /** Detailed variant used by the orchestrator to distinguish a real failed
   * recovery attempt from an automatic-compaction throttle no-op. */
  async compactWithLLMResult(
    messages: readonly LLMMessage[],
    charBudget: number,
    currentTurn?: number,
  ): Promise<ContextCompactionResult> {
    return this._compactWithLLM(messages, charBudget, currentTurn, false);
  }

  private async _compactWithLLM(
    messages: readonly LLMMessage[],
    charBudget: number,
    currentTurn: number | undefined,
    explicit: boolean,
  ): Promise<ContextCompactionResult> {
    const sourceView = cloneMessages(messages);
    const totalChars = measureMessageChars(messages);
    if (totalChars <= charBudget) {
      return { changed: false, truncated: 0, attempted: false, view: sourceView };
    }
    if (!explicit && !this._beginAutoCompaction(currentTurn)) {
      return { changed: false, truncated: 0, attempted: false, view: sourceView };
    }
    if (!this._checkpointDurableFacts()) {
      return { changed: false, truncated: 0, attempted: true, view: sourceView };
    }

    // Run Tier 1 in the same attempt. Calling the public method here would
    // consume the throttle twice and silently skip rule-based pruning.
    const truncation = truncateOldToolResults(messages);
    const truncated = truncation.truncated;
    let view = truncation.view;

    const afterTruncation = measureMessageChars(view);
    if (afterTruncation <= charBudget) {
      view = this._appendPostCompactReload(view);
      return this._finishCompactionAttempt(
        view,
        sourceView,
        totalChars,
        truncated,
        false,
        explicit,
      );
    }

    if (this._llmCompactionDisabled && !explicit) {
      return this._finishCompactionAttempt(
        view,
        sourceView,
        totalChars,
        truncated,
        false,
        explicit,
      );
    }

    // Identify boundary between "old" and "recent" content.
    const COMPACT_KEEP_RECENT_CHARS = 80_000;
    let keptChars = 0;
    let keepFromIndex = view.length;
    for (let i = view.length - 1; i > 0; i--) {
      const msgChars = view[i].content.length;
      if (keptChars + msgChars > COMPACT_KEEP_RECENT_CHARS) break;
      keptChars += msgChars;
      keepFromIndex = i;
    }

    // Ensure at least the last 4 complete tool exchange groups intact
    let groupCount = 0;
    for (let i = view.length - 1; i > 0; i--) {
      if (
        view[i].role === 'assistant' &&
        view[i].toolCalls &&
        view[i].toolCalls!.length > 0
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
      if (view[i].role === 'user') {
        keepFromIndex = i;
        break;
      }
    }

    const oldMessages = view.slice(1, keepFromIndex);
    if (oldMessages.length === 0) {
      return this._finishCompactionAttempt(
        view,
        sourceView,
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
        keptCompactionLines.push(line);
        keptCompactionChars += line.length;
      }
      const compactionInput = keptCompactionLines.reverse().join('\n');

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

      view = [
        view[0]!,
        {
          role: 'user',
          content:
            `[Context compacted — ${oldMessages.length} messages summarized by AI]\n` +
            'The AI assistant previously worked on this task and produced the following summary. ' +
            'Use this to build on the work already done and avoid duplicating effort.\n\n' +
            summary +
            reloadSuffix,
        },
        ...view.slice(keepFromIndex),
      ];

      return this._finishCompactionAttempt(
        view,
        sourceView,
        totalChars,
        truncated,
        true,
        explicit,
      );
    } catch (error) {
      if (error instanceof PostCompactReloadError) throw error.original;
      // LLM summary failed. Keep deterministic pruning only when it produced
      // a meaningful reduction; otherwise return the original model view.
      return this._finishCompactionAttempt(
        view,
        sourceView,
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
    } catch (error) {
      throw new PostCompactReloadError(error);
    }
  }

  private _appendPostCompactReload(messages: readonly LLMMessage[]): LLMMessage[] {
    const reloadBlock = this._readPostCompactReload();
    if (!reloadBlock) return [...messages];
    return [
      ...messages,
      {
        role: 'user',
        content: `--- WORKSPACE CONTEXT RELOAD (fresh from current state) ---\n${reloadBlock}`,
      },
    ];
  }

  private _finishCompactionAttempt(
    view: LLMMessage[],
    sourceView: LLMMessage[],
    beforeChars: number,
    truncated: number,
    llmAttempted: boolean,
    explicit: boolean,
  ): ContextCompactionResult {
    const afterChars = measureMessageChars(view);
    const yieldRatio = beforeChars > 0 ? (beforeChars - afterChars) / beforeChars : 0;
    const meaningful = yieldRatio >= ContextManager.MIN_COMPACTION_YIELD;

    if (!meaningful && !explicit) {
      if (llmAttempted) {
        this._lowYieldLlmCompactions += 1;
        if (this._lowYieldLlmCompactions >= 2) this._llmCompactionDisabled = true;
      }
      return { changed: false, truncated: 0, attempted: true, view: sourceView };
    }

    if (meaningful && llmAttempted) this._lowYieldLlmCompactions = 0;
    return { changed: afterChars < beforeChars, truncated, attempted: true, view };
  }

  /**
   * Trigger context compaction from outside (e.g. tool.compact, UI button).
   * Phase 1: derive truncated tool results (fast, no LLM).
   * Phase 2: LLM-based group summarization if still over budget.
   */
  async compactNow(
    messages: readonly LLMMessage[] | null,
    instructions?: string,
  ): Promise<{
    freedChars: number;
    messageCount: number;
    toolCount: number;
    view: LLMMessage[];
  }> {
    if (!messages || messages.length === 0) {
      return { freedChars: 0, messageCount: 0, toolCount: 0, view: [] };
    }

    if (instructions) this._compactInstructions = instructions;

    const before = measureMessageChars(messages);
    const targetBudget = Math.floor(before * 0.5);
    const result = await this._compactWithLLM(messages, targetBudget, undefined, true);

    const after = measureMessageChars(result.view);
    return {
      freedChars: Math.max(0, before - after),
      messageCount: result.view.length,
      toolCount: result.truncated,
      view: result.view,
    };
  }
}

function cloneMessage(message: LLMMessage): LLMMessage {
  return structuredClone(message);
}

function cloneMessages(messages: readonly LLMMessage[]): LLMMessage[] {
  return messages.map(cloneMessage);
}
