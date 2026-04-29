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
/** Tools not used within this many steps get their descriptions stripped. */
const TOOL_STRIP_AFTER_STEPS = 3;
/** Tools not used within this many steps get evicted entirely (re-loadable via tool.get). */
const TOOL_EVICT_AFTER_STEPS = 6;
/** Max chars for in-loop messages. Triggers mid-loop pruning. */
const DEFAULT_IN_LOOP_CHAR_BUDGET = 120000;
const COMPACT_RESULT_THRESHOLD = 300;
const COMPACT_KEEP_RECENT_GROUPS = 3;

/** Tools always loaded regardless of discovery or context. */
export const ALWAYS_LOADED_TOOLS = [
  'tool.get',
  'tool.compact',
  'commander.askUser',
  'canvas.getState',
  'canvas.listNodes',
  'canvas.getNode',
  'canvas.getSettings',
  'guide.get',
  'logger.list',
  'todo.set',
  'todo.update',
] as const;

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

export function pruneInLoopMessages(messages: LLMMessage[], charBudget: number): void {
  const totalChars = measureMessageChars(messages);
  if (totalChars <= charBudget) return;

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

  let currentChars = totalChars;
  const minKeepGroups = 3;
  const summaryParts: string[] = [];
  const indicesToRemove: number[] = [];

  for (let g = 0; g < groups.length - minKeepGroups && currentChars > charBudget; g++) {
    const group = groups[g];
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

    for (let i = messages.length - 1; i >= 0; i--) {
      if (removeSet.has(i)) messages.splice(i, 1);
    }

    const summaryContent = `[Context compacted — ${summaryParts.length} earlier step(s) summarized]\n${summaryParts.join('\n')}`;
    const summaryMsg: LLMMessage = { role: 'user', content: summaryContent };
    messages.splice(Math.min(firstDropIdx, messages.length), 0, summaryMsg);
  }
}

// ---------------------------------------------------------------------------
// Old tool result truncation
// ---------------------------------------------------------------------------

export function truncateOldToolResults(messages: LLMMessage[]): number {
  const groups: Array<{ startIndex: number; endIndex: number }> = [];
  let idx = 1;
  while (idx < messages.length) {
    const msg = messages[idx];
    if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      const start = idx;
      idx++;
      while (idx < messages.length && messages[idx].role === 'tool') idx++;
      groups.push({ startIndex: start, endIndex: idx - 1 });
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
  for (let i = 1; i < messages.length; i++) {
    if (recentIndices.has(i)) continue;
    const msg = messages[i];

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
    if (msg.content.length <= COMPACT_RESULT_THRESHOLD) continue;

    try {
      const parsed = JSON.parse(msg.content) as Record<string, unknown>;
      const compact: Record<string, unknown> = { success: parsed.success ?? true };

      if (isRecord(parsed.data)) {
        const kept: Record<string, unknown> = {};
        for (const key of ['id', 'title', 'name', 'nodeId', 'count', 'total', 'status', 'error']) {
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
      } else if (parsed.error) {
        compact.error = truncateString(String(parsed.error), 120);
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
 * Progressively compact tools when total request size exceeds budget.
 *
 * Tier 0: Tools not yet used start as name-only stubs (progressive loading).
 * Tier 1: Strip descriptions + param details from tools not used recently.
 * Tier 2: Evict tools not used for longer (they can be re-loaded via tool.get).
 * Always-loaded tools are never evicted or stripped.
 */
export function adaptiveToolCompaction(
  tools: LLMToolDefinition[],
  toolLastUsedStep: Map<string, number>,
  currentStep: number,
  messageChars: number,
  charBudget: number,
): { tools: LLMToolDefinition[]; evictedNames: string[] } {
  const alwaysLoaded = new Set<string>(ALWAYS_LOADED_TOOLS);
  const evictedNames: string[] = [];

  // Tier 0: Start non-always-loaded tools that were never used as name-only stubs
  let result = tools.map((tool) => {
    if (alwaysLoaded.has(tool.name)) return tool;
    const lastUsed = toolLastUsedStep.get(tool.name);
    // Never-used tools → name-only stub (progressive loading)
    if (lastUsed === undefined || lastUsed === 0) {
      const stepsAgo = currentStep;
      if (stepsAgo >= TOOL_STRIP_AFTER_STEPS) {
        return {
          name: tool.name,
          description: '',
          parameters: {
            type: 'object' as const,
            required: tool.parameters.required,
            properties: {},
          },
        };
      }
    }
    return tool;
  });

  const toolChars = safeStringify(result).length;
  const totalChars = messageChars + toolChars;
  if (totalChars <= charBudget) return { tools: result, evictedNames };

  // Tier 1: Strip stale tools to name-only stubs
  result = result.map((tool) => {
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

  if (messageChars + safeStringify(result).length <= charBudget) {
    return { tools: result, evictedNames };
  }

  // Tier 2: Evict tools not used for a while
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
 * All fields are cheap scalars derived from the `AgentContext.extra` bag
 * and the classified `RunIntent`, so the function remains pure and fast.
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
  /** Raw user message text (for keyword-based heuristics). */
  userMessage: string;
  /** Classified intent kind: 'execution' | 'informational' | 'browse' | 'mixed'. */
  intentKind: string;
  /** Optional detected workflow hint (e.g. 'character-ref-image', 'story-to-video'). */
  intentWorkflow?: string;
}

/** @internal — mutating helper, avoids repetitive `.add()` chains. */
function addToolNames(set: Set<string>, names: readonly string[]): void {
  for (const name of names) set.add(name);
}

// ── Keyword regexes ──────────────────────────────────────────────────────
// Compiled once at module load. Language-neutral where practical — CJK
// workflow triggers come from intent classification, not message scanning.
const RE_GENERATION_VERBS = /generat|render|creat.*image|creat.*video|produce|make.*shot/i;
const RE_SCRIPT_KEYWORDS = /script|novel|story|screenplay|fountain|import.*script/i;
const RE_RENDER_KEYWORDS = /render|export|publish|output|deliver/i;
const RE_PROVIDER_KEYWORDS = /provider|api.?key|model|switch.*provider|change.*model/i;
const RE_PRESET_KEYWORDS = /preset|style|color.?style/i;

/**
 * Return a set of tool names that should be fully loaded (schema + description)
 * on step 1, given the workspace state and user intent. Tools NOT in this set
 * are still discoverable via `tool.get` and become name-only stubs in the
 * adaptive-compaction tier-0 path.
 *
 * Pure function — no side-effects, no registry mutation.
 */
export function selectContextualToolSet(input: ToolSelectionInput): Set<string> {
  const tools = new Set<string>(ALWAYS_LOADED_TOOLS);
  const msg = input.userMessage.toLowerCase();

  // ── Informational / browse intents → read-only minimum ─────────────
  if (input.intentKind === 'informational' || input.intentKind === 'browse') {
    addToolNames(tools, [
      'canvas.listEdges',
      'character.list',
      'location.list',
      'equipment.list',
      'snapshot.list',
      'preset.list',
      'preset.get',
      'series.get',
      'series.listEpisodes',
      'provider.list',
      'provider.getActive',
      'provider.getCapabilities',
      'prompt.get',
      'vision.describeImage',
    ]);
    return tools;
  }

  // ── Canvas empty → creation-focused ────────────────────────────────
  if (input.nodeCount === 0) {
    addToolNames(tools, [
      'canvas.addNode',
      'canvas.batchCreate',
      'canvas.importWorkflow',
      'canvas.renameCanvas',
      'canvas.layout',
      'canvas.setSettings',
      'character.create',
      'character.list',
      'location.create',
      'location.list',
      'equipment.create',
      'equipment.list',
      'script.read',
      'script.write',
      'script.import',
      'workflow.control',
      'workflow.expandIdea',
      'snapshot.create',
    ]);
  }

  // ── Canvas has nodes → editing + graph tools ───────────────────────
  if (input.nodeCount > 0) {
    addToolNames(tools, [
      'canvas.addNode',
      'canvas.batchCreate',
      'canvas.updateNodes',
      'canvas.deleteNode',
      'canvas.connectNodes',
      'canvas.deleteEdge',
      'canvas.swapEdgeDirection',
      'canvas.disconnectNode',
      'canvas.setNodeLayout',
      'canvas.layout',
      'canvas.duplicateNodes',
      'canvas.undo',
      'canvas.redo',
      'canvas.listEdges',
      'canvas.renameCanvas',
      'canvas.addNote',
      'canvas.updateNote',
      'character.list',
      'location.list',
      'equipment.list',
      'snapshot.create',
      'snapshot.list',
      'snapshot.restore',
    ]);

    // Entities needed if canvas has nodes but no entities yet
    if (input.entityCount === 0) {
      addToolNames(tools, ['character.create', 'location.create', 'equipment.create']);
    }
  }

  // ── Entities exist → ref management + updates ──────────────────────
  if (input.entityCount > 0) {
    addToolNames(tools, [
      'canvas.setNodeRefs',
      'character.update',
      'character.list',
      'character.generateRefImage',
      'character.setRefImage',
      'character.setRefImageFromNode',
      'location.update',
      'location.list',
      'location.generateRefImage',
      'location.setRefImage',
      'location.setRefImageFromNode',
      'equipment.update',
      'equipment.list',
      'equipment.generateRefImage',
      'equipment.setRefImage',
      'equipment.setRefImageFromNode',
    ]);
  }

  // ── Style plate not set → settings tools ───────────────────────────
  if (!input.hasStylePlate) {
    tools.add('canvas.setSettings');
  }

  // ── Generation verbs in message ────────────────────────────────────
  if (RE_GENERATION_VERBS.test(msg)) {
    addToolNames(tools, [
      'canvas.generate',
      'canvas.cancelGeneration',
      'canvas.selectVariant',
      'canvas.estimateCost',
      'canvas.previewPrompt',
      'canvas.setImageParams',
      'canvas.setVideoParams',
      'canvas.setAudioParams',
      'canvas.setNodeProvider',
      'canvas.readNodePresetTracks',
      'canvas.writeNodePresetTracks',
      'canvas.writePresetTracksBatch',
      'canvas.applyShotTemplate',
      'canvas.setVideoFrames',
    ]);
  }

  // ── Script / novel keywords ────────────────────────────────────────
  if (RE_SCRIPT_KEYWORDS.test(msg)) {
    addToolNames(tools, ['script.read', 'script.write', 'script.import', 'text.transform']);
  }

  // ── Render / export keywords ───────────────────────────────────────
  if (RE_RENDER_KEYWORDS.test(msg)) {
    addToolNames(tools, [
      'render.start',
      'render.cancel',
      'render.exportBundle',
      'job.list',
      'job.control',
      'canvas.exportWorkflow',
    ]);
  }

  // ── Provider keywords ──────────────────────────────────────────────
  if (RE_PROVIDER_KEYWORDS.test(msg)) {
    addToolNames(tools, [
      'provider.list',
      'provider.getActive',
      'provider.getCapabilities',
      'provider.setActive',
      'provider.setKey',
      'provider.update',
      'provider.addCustom',
      'provider.removeCustom',
    ]);
  }

  // ── Preset / style keywords ────────────────────────────────────────
  if (RE_PRESET_KEYWORDS.test(msg)) {
    addToolNames(tools, [
      'preset.list',
      'preset.get',
      'preset.create',
      'preset.update',
      'preset.delete',
      'preset.reset',
      'colorStyle.list',
      'colorStyle.save',
      'colorStyle.delete',
      'canvas.readNodePresetTracks',
      'canvas.writeNodePresetTracks',
    ]);
  }

  // ── Selected nodes → likely editing or generating those ────────────
  if (input.hasSelectedNodes) {
    addToolNames(tools, [
      'canvas.generate',
      'canvas.updateNodes',
      'canvas.setImageParams',
      'canvas.setVideoParams',
      'canvas.setNodeRefs',
      'canvas.setNodeLayout',
      'canvas.readNodePresetTracks',
      'canvas.writeNodePresetTracks',
      'canvas.applyShotTemplate',
      'canvas.deleteNode',
      'canvas.previewPrompt',
      'canvas.selectVariant',
    ]);
  }

  // ── Workflow-specific loading ──────────────────────────────────────
  if (input.intentWorkflow) {
    const wf = input.intentWorkflow.toLowerCase();
    if (wf.includes('character') || wf.includes('ref-image')) {
      addToolNames(tools, [
        'character.create',
        'character.update',
        'character.list',
        'character.generateRefImage',
        'character.setRefImage',
        'character.setRefImageFromNode',
        'character.deleteRefImage',
      ]);
    }
    if (wf.includes('location')) {
      addToolNames(tools, [
        'location.create',
        'location.update',
        'location.list',
        'location.generateRefImage',
        'location.setRefImage',
        'location.setRefImageFromNode',
      ]);
    }
    if (wf.includes('equipment')) {
      addToolNames(tools, [
        'equipment.create',
        'equipment.update',
        'equipment.list',
        'equipment.generateRefImage',
        'equipment.setRefImage',
        'equipment.setRefImageFromNode',
      ]);
    }
    if (wf.includes('story') || wf.includes('video')) {
      addToolNames(tools, [
        'canvas.addNode',
        'canvas.batchCreate',
        'canvas.generate',
        'canvas.connectNodes',
        'canvas.layout',
        'canvas.setImageParams',
        'canvas.setVideoParams',
        'script.read',
        'script.write',
        'script.import',
        'workflow.control',
        'workflow.expandIdea',
      ]);
    }
  }

  return tools;
}

// ---------------------------------------------------------------------------
// ContextManager class
// ---------------------------------------------------------------------------

export interface ContextManagerOptions {
  maxContextChars?: number;
}

export class ContextManager {
  private _compactInstructions: string | null = null;
  private _scratchpad: string | null = null;
  private _lastCompactTime = 0;
  /** Minimum interval between auto-compactions in milliseconds. */
  private static readonly COMPACT_MIN_INTERVAL_MS = 5_000;

  /**
   * Unified compaction throttle. Returns true if a compaction is allowed.
   * @param explicit — true for user-triggered compactNow (always allowed)
   */
  private _canCompact(explicit = false): boolean {
    if (explicit) return true;
    const now = Date.now();
    if (now - this._lastCompactTime < ContextManager.COMPACT_MIN_INTERVAL_MS) {
      return false;
    }
    this._lastCompactTime = now;
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

  buildSystemPrompt(
    context: AgentContext,
    step?: number,
    processPrompts?: Array<{ key: string; displayName: string; content: string }>,
  ): string {
    // ── STATIC portion (identity + rules + tool discovery) ───────────
    // This section is byte-identical across all requests in a session,
    // enabling Anthropic prompt caching when the adapter splits on the
    // CACHE_BREAK marker.
    let prompt = this.resolvePrompt('agent-system');

    // After step 5, abbreviate: strip prompt guide content (tools are known)
    if (step && step > 5) {
      // Remove any prompt guide sections to save tokens
      const guideMarker = '## Prompt Guides';
      const guideIdx = prompt.indexOf(guideMarker);
      if (guideIdx !== -1) {
        const nextSection = prompt.indexOf('\n## ', guideIdx + guideMarker.length);
        prompt =
          nextSection !== -1
            ? prompt.slice(0, guideIdx) + prompt.slice(nextSection)
            : prompt.slice(0, guideIdx);
      }
    }

    // ── CACHE_BREAK — everything above is static, everything below is
    // dynamic (changes per request: context, snapshot, guides, process
    // prompts). The Claude adapter splits on this marker to place a
    // cache_control breakpoint.
    prompt += '\n\n<!-- CACHE_BREAK -->\n';

    // ── DYNAMIC portion (context + snapshot + guides + process prompts) ─

    // MASTER INDEX — the catalog of every guide/skill/process-prompt
    // Commander can reach. Moved to the dynamic section because its
    // content may vary when the user attaches or detaches guides between
    // requests. Dropped after step 5 (tools are known by then).
    if (!step || step <= 5) {
      const masterIndex = context.extra?.masterIndex;
      if (typeof masterIndex === 'string' && masterIndex.trim().length > 0) {
        prompt += `\n\n${masterIndex}`;
      }
    }

    const contextLines: string[] = [];
    if (context.page) contextLines.push(`Current page: ${context.page}`);
    if (context.characterId) contextLines.push(`Active character ID: ${context.characterId}`);
    if (context.extra) {
      for (const [k, v] of Object.entries(context.extra)) {
        // masterIndex is rendered as its own section above — don't re-emit
        // it as a single "key: value" line.
        if (k === 'masterIndex') continue;
        // workspaceSnapshot is rendered as its own section below — the full
        // text (3-5k chars) must not be truncated to the 600-char value limit.
        if (k === 'workspaceSnapshot') continue;
        // autoInjectGuides are rendered as their own section below.
        if (k === 'autoInjectGuides') continue;
        // On first step, include full context. After step 5, skip verbose entries.
        if (step && step > 5 && k === 'promptGuides') continue;
        // classifiedIntent gets a descriptive label.
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

    // Workspace snapshot — rendered verbatim as its own section so the full
    // 3-5k chars are visible to the LLM without truncation.
    const workspaceSnapshot = context.extra?.workspaceSnapshot;
    if (typeof workspaceSnapshot === 'string' && workspaceSnapshot.trim().length > 0) {
      prompt += `\n\n## Workspace Snapshot\n${workspaceSnapshot}`;
    }

    // Scratchpad — persistent across compaction. Contains current todo state,
    // key creative decisions, and failure traces. Always rendered when present.
    if (this._scratchpad && this._scratchpad.trim().length > 0) {
      prompt += `\n\n## Scratchpad\n${this._scratchpad}`;
    }

    // Auto-injected guides — guide content the user attached, rendered in
    // the system prompt so the LLM sees them without calling guide.get.
    // Budget-limited to 8k chars in the handler; overflow guides are
    // discovery-only via availablePromptGuides.
    const autoInjectGuides = context.extra?.autoInjectGuides;
    if (Array.isArray(autoInjectGuides) && autoInjectGuides.length > 0) {
      prompt += '\n\n## Auto-Injected Guides';
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

    // Active process prompts — consolidated into the system prompt as a
    // structured section instead of separate system messages (1I).
    if (Array.isArray(processPrompts) && processPrompts.length > 0) {
      prompt += '\n\n## Active Process Guides';
      for (const pp of processPrompts) {
        prompt += `\n\n### [${pp.key}] ${pp.displayName}\n${pp.content}`;
      }
    }

    return prompt;
  }

  /**
   * Phase 1 only: fast rule-based compaction (truncate old tool results).
   * No LLM call. Used proactively at 80% utilization.
   * Returns true if any changes were made.
   */
  compactPhase1(messages: LLMMessage[]): boolean {
    if (!this._canCompact(false)) return false;
    const before = measureMessageChars(messages);
    truncateOldToolResults(messages);
    return measureMessageChars(messages) < before;
  }

  /**
   * Full-replacement context compaction -- modeled after Claude Code / Codex CLI.
   */
  async compactWithLLM(messages: LLMMessage[], charBudget: number): Promise<boolean> {
    const totalChars = measureMessageChars(messages);
    if (totalChars <= charBudget) return false;
    if (!this._canCompact(false)) return false;

    // Phase 1: Truncate old tool outputs first
    this.compactPhase1(messages);

    const afterTruncation = measureMessageChars(messages);
    if (afterTruncation <= charBudget) return true;

    // Phase 2: Identify boundary between "old" and "recent" content.
    const COMPACT_KEEP_RECENT_CHARS = 80_000;
    let keptChars = 0;
    let keepFromIndex = messages.length;
    for (let i = messages.length - 1; i > 0; i--) {
      const msgChars = messages[i].content.length;
      if (keptChars + msgChars > COMPACT_KEEP_RECENT_CHARS) break;
      keptChars += msgChars;
      keepFromIndex = i;
    }

    // Ensure at least the last 3 complete tool exchange groups intact
    const minKeepGroups = 3;
    let groupCount = 0;
    for (let i = messages.length - 1; i > 0; i--) {
      if (
        messages[i].role === 'assistant' &&
        messages[i].toolCalls &&
        messages[i].toolCalls!.length > 0
      ) {
        groupCount++;
        if (groupCount >= minKeepGroups && i < keepFromIndex) {
          keepFromIndex = i;
          break;
        }
      }
    }

    // Also preserve all recent user messages
    for (let i = keepFromIndex - 1; i > 0; i--) {
      if (messages[i].role === 'user') {
        keepFromIndex = i;
        break;
      }
    }

    const oldMessages = messages.slice(1, keepFromIndex);
    if (oldMessages.length === 0) return false;

    try {
      const compactionInput = oldMessages
        .map((m) => {
          const role = m.role === 'tool' ? 'tool_result' : m.role;
          const content = m.content.length > 600 ? m.content.slice(0, 600) + '...' : m.content;
          return `[${role}] ${content}`;
        })
        .join('\n');

      const compactionPrompt =
        'You are performing a CONTEXT CHECKPOINT COMPACTION. Create a structured handoff summary for the AI that will continue this task.\n\n' +
        'Use EXACTLY these section tags:\n' +
        '[done] What was accomplished successfully (include entity IDs, node IDs, canvas IDs, file paths, key results)\n' +
        '[failed] What was attempted and why it failed (include error reasons, tool names, error messages)\n' +
        '[skipped] What the user declined or the agent decided to skip (include reasons)\n' +
        '[pending] What remains to be done (clear next steps)\n' +
        '[decisions] Key creative decisions confirmed by the user\n\n' +
        'Rules:\n' +
        '- Preserve ALL entity IDs, file paths, and confirmed creative choices\n' +
        '- For failures, include the tool name and error reason so the next AI can avoid repeating the same mistake\n' +
        '- Be concise and actionable — the next AI should be able to continue without re-reading the full transcript\n' +
        '- Output ONLY the tagged sections, no extra headings or markdown formatting\n\n' +
        (this._compactInstructions ? `FOCUS: ${this._compactInstructions}\n\n` : '') +
        (this._scratchpad ? `SCRATCHPAD (preserve this context):\n${this._scratchpad}\n\n` : '') +
        compactionInput;

      const summary = await this.llm.complete([{ role: 'user', content: compactionPrompt }], {
        temperature: 0,
        maxTokens: 800,
      });

      messages.splice(1, keepFromIndex - 1, {
        role: 'user',
        content:
          `[Context compacted — ${oldMessages.length} messages summarized by AI]\n` +
          'The AI assistant previously worked on this task and produced the following summary. ' +
          'Use this to build on the work already done and avoid duplicating effort.\n\n' +
          summary,
      });

      return true;
    } catch {
      // LLM call failed -- fall back to rule-based compaction
      pruneInLoopMessages(messages, charBudget);
      return true;
    }
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

    if (!this._canCompact(true)) {
      return { freedChars: 0, messageCount: messages.length, toolCount: 0 };
    }

    if (instructions) this._compactInstructions = instructions;

    const before = measureMessageChars(messages);

    // Phase 1: truncate old tool results in-place
    const truncated = truncateOldToolResults(messages);

    // Phase 2: full-replacement LLM compaction if still over budget
    const afterPhase1 = measureMessageChars(messages);
    const targetBudget = Math.floor(before * 0.5);
    if (afterPhase1 > targetBudget) {
      await this.compactWithLLM(messages, targetBudget);
    }

    const after = measureMessageChars(messages);
    return {
      freedChars: Math.max(0, before - after),
      messageCount: messages.length,
      toolCount: truncated,
    };
  }
}
