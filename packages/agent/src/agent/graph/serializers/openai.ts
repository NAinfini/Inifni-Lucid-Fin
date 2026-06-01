/**
 * OpenAI serializer for ContextGraph — Phase G2b-1.
 *
 * Translates a ContextGraph into the message array format expected by
 * OpenAI's chat/completions API, preserving every invariant the legacy
 * `buildMessagesForRequest` pipeline upheld:
 *
 *  1. Subtract `reserveTokensForOutput` + `toolSchemaTokens` from the budget
 *     before trimming history.
 *  2. Process prompts have their own budget (30k chars), take priority over
 *     history, and sit between the primary system prompt and history.
 *  3. The graph's entity-cache projection (when non-empty) is appended to
 *     the primary system prompt. Counted against budget.
 *  4. Fully-stubbed assistant+tool groups (every result === `{"_cached":true}`)
 *     are skipped atomically.
 *  5. Fully-cached assistant+tool groups (every tool call's result is still
 *     in the graph's tool-result index) are also skipped.
 *  6. No dangling tool message at the start of the retained window.
 *  7. If the first kept assistant has `toolCalls`, every referenced tool
 *     result must be present later — otherwise drop the broken exchange.
 *  8. Tool-name sanitization (`.`→`_`) when `profile.sanitizeToolNames`.
 *  9. Orphan tool messages (no matching earlier assistant call id in the
 *     retained window) are dropped.
 */

import type { LLMMessage, LLMToolDefinition, ProviderProfile } from '@lucid-fin/contracts';
import { DEFAULT_PROVIDER_PROFILE } from '@lucid-fin/contracts';
import { getToolCompactionCategory } from '@lucid-fin/shared-utils';
import type { ContextItem, ContextItemId } from '@lucid-fin/contracts';
import type { ContextGraph } from '../context-graph.js';

const STUB_CONTENT = '{"_cached":true}';
const PROCESS_PROMPT_BUDGET_CHARS = 30_000;

export interface SerializeInput {
  graph: ContextGraph;
  /** Full adapter context window in tokens. */
  contextWindowTokens: number;
  /** Tool definitions for schema-size accounting. */
  tools: LLMToolDefinition[];
  /** Provider profile (drives charsPerToken, outputReserveTokens, sanitizeToolNames). */
  profile?: ProviderProfile;
  /** Override for reserved output tokens (else profile.outputReserveTokens). */
  reserveTokensForOutput?: number;
}

export interface SerializeResult {
  wireMessages: LLMMessage[];
  wireTools: LLMToolDefinition[];
  /** Sanitized → original tool name map (empty when sanitizeToolNames is false). */
  toolNameReverseMap: Map<string, string>;
  /** Budget accounting for logging / telemetry. */
  estimatedTokensUsed: number;
}

// ── Shared helpers ────────────────────────────────────────────

function estimateTokens(chars: number, charsPerToken: number): number {
  return Math.ceil(chars / charsPerToken);
}

const SANITIZE_RE = /\./g;
function sanitizeName(name: string): string {
  return name.replace(SANITIZE_RE, '_');
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'Failed to serialize content' });
  }
}

function renderEntityBrief(snapshot: unknown): string {
  try {
    return `[Entity snapshot] ${JSON.stringify(snapshot)}`;
  } catch {
    return '[Entity snapshot] (unserializable)';
  }
}

function messageChars(m: LLMMessage): number {
  let c = m.content.length;
  if (m.toolCalls) {
    for (const tc of m.toolCalls) {
      c += JSON.stringify(tc.arguments).length;
      c += (tc.name?.length ?? 0) + (tc.id?.length ?? 0) + 20;
    }
  }
  return c;
}

// ── Item → LLMMessage translation ──────────────────────────────

/**
 * Serialize a single ContextItem to zero or more LLMMessage entries.
 * `guide` items are handled at the top level (prepended); `system-message`
 * items ride inline at their insertion point.
 */
function itemToMessages(
  item: ContextItem,
  graph: ContextGraph,
  visited: Set<ContextItemId>,
  sanitizeToolName: (name: string) => string,
): LLMMessage[] {
  switch (item.kind) {
    case 'user-message':
      return [{ role: 'user', content: item.content }];

    case 'assistant-turn': {
      const msg: LLMMessage = { role: 'assistant', content: item.content };
      if (item.toolCalls && item.toolCalls.length > 0) {
        msg.toolCalls = item.toolCalls.map((tc) => ({
          id: tc.id,
          name: sanitizeToolName(tc.name),
          arguments: tc.arguments,
        }));
      }
      return [msg];
    }

    case 'tool-result': {
      // If content is already a string (e.g. seeded from a prior role='tool'
      // message), pass it through as-is. Otherwise stringify the payload.
      const content = typeof item.content === 'string' ? item.content : safeStringify(item.content);
      const toolCallId = item.toolCallId ?? item.itemId;
      return [{ role: 'tool', content, toolCallId }];
    }

    case 'entity-snapshot':
      return [{ role: 'system', content: renderEntityBrief(item.snapshot) }];

    case 'guide':
      // Collected separately and prepended
      return [];

    case 'system-message':
      // Emitted inline at original position; process prompts handled
      // separately at the top level.
      return [{ role: 'system', content: item.content }];

    case 'session-summary':
      return [{ role: 'system', content: `<summary>\n${item.content}\n</summary>` }];

    case 'scratchpad':
      // Rendered as a system message so the model always sees it.
      return [{ role: 'system', content: `<scratchpad>\n${item.content}\n</scratchpad>` }];

    case 'reference': {
      if (visited.has(item.referencedItemId)) return [];
      visited.add(item.referencedItemId);
      const referenced = graph.get(item.referencedItemId);
      if (!referenced) return [];
      return itemToMessages(referenced, graph, visited, sanitizeToolName);
    }

    default:
      return [];
  }
}

// ── Main ──────────────────────────────────────────────────────

/**
 * Serialize a ContextGraph into an OpenAI request payload, preserving every
 * legacy `buildMessagesForRequest` invariant. Returns `wireMessages`,
 * `wireTools`, and the reverse-map needed by `destructLLMResponse`.
 */
export function serializeForOpenAI(input: SerializeInput): SerializeResult {
  const profile = input.profile ?? DEFAULT_PROVIDER_PROFILE;
  const cpt = profile.charsPerToken;
  const reserveTokens = input.reserveTokensForOutput ?? profile.outputReserveTokens ?? 4096;
  const totalBudgetTokens = Math.max(0, input.contextWindowTokens - reserveTokens);

  const toolNameReverseMap = new Map<string, string>();

  const sanitizeToolName = profile.sanitizeToolNames
    ? (name: string): string => {
        const sanitized = sanitizeName(name);
        if (sanitized !== name) toolNameReverseMap.set(sanitized, name);
        return sanitized;
      }
    : (name: string): string => name;

  // ── 1. Build wireTools + reverse-map (sanitize if required) ──
  let wireTools = input.tools;
  if (profile.sanitizeToolNames) {
    wireTools = input.tools.map((t) => {
      const sanitized = sanitizeName(t.name);
      if (sanitized !== t.name) toolNameReverseMap.set(sanitized, t.name);
      return { ...t, name: sanitized };
    });
  }

  // ── 2. Tool schema chars → tokens ────────────────────────────
  const toolSchemaChars = wireTools.reduce((sum, t) => {
    return sum + t.name.length + t.description.length + JSON.stringify(t.parameters).length + 40;
  }, 0);
  const toolSchemaTokens = estimateTokens(toolSchemaChars, cpt);

  // ── 3. Separate graph items into buckets ─────────────────────
  // Guides → single collected leading system message.
  // system-message (process prompt) → its own budgeted bucket.
  // Everything else → body (history).
  const guideContent: string[] = [];
  const processPromptCandidates: ContextItem[] = [];
  const bodyItems: ContextItem[] = [];

  for (const item of input.graph) {
    if (item.kind === 'guide') {
      guideContent.push(item.content);
    } else if (item.kind === 'system-message' && item.content.startsWith('[[process-prompt:')) {
      processPromptCandidates.push(item);
    } else {
      bodyItems.push(item);
    }
  }

  // ── 4. Process-prompt budget (30k chars cap) ─────────────────
  // Walk newest first; keep newest prompts while within budget. Preserve
  // insertion order in final output.
  const keptProcessPromptIds = new Set<ContextItemId>();
  let processPromptChars = 0;
  for (let i = processPromptCandidates.length - 1; i >= 0; i--) {
    const item = processPromptCandidates[i]!;
    if (item.kind !== 'system-message') continue;
    const chars = item.content.length;
    if (keptProcessPromptIds.size > 0 && processPromptChars + chars > PROCESS_PROMPT_BUDGET_CHARS) {
      continue;
    }
    keptProcessPromptIds.add(item.itemId);
    processPromptChars += chars;
  }
  const processPromptTokens = processPromptChars > 0 ? estimateTokens(processPromptChars, cpt) : 0;

  // ── 5. Identify fully-stubbed + fully-cached assistant groups ─
  // Build a list of (assistant-turn, [tool-result]) groups over bodyItems
  // in insertion order. A group is fully-stubbed/cached if EVERY tool call
  // is satisfied by a stub result or a cache-covered call respectively.
  //
  // Legacy behavior: a group is ONLY preserved (exempt from skip) when it
  // is the trailing assistant+tool block — i.e. everything after it is
  // either the group's own tool-results or system items. A fully-cached
  // group followed by an injected user/assistant message IS skipped, to
  // match `shouldPreserveAssistantToolGroup` in message-constructor.
  const isTrailingAssistantToolGroup = (assistantIdx: number): boolean => {
    const a = bodyItems[assistantIdx]!;
    if (a.kind !== 'assistant-turn' || !a.toolCalls) return false;
    const ownIds = new Set(a.toolCalls.map((tc) => tc.id));
    for (let k = assistantIdx + 1; k < bodyItems.length; k++) {
      const after = bodyItems[k]!;
      // system-message / guide are ignored (they sit alongside without
      // breaking the trailing property)
      if (after.kind === 'system-message' || after.kind === 'guide') continue;
      if (after.kind === 'tool-result' && after.toolCallId && ownIds.has(after.toolCallId))
        continue;
      return false;
    }
    return true;
  };

  // ── 5a. Entity-cache projection (injected into primary system prompt) ─
  // Compute BEFORE the skip loop so `allCached` can gate on what
  // actually fit into the non-truncated addendum. Skipping a group whose
  // data is only in the dedup index — but got trimmed out of the text
  // the model sees — would silently drop context.
  const cacheProjection = input.graph.projectEntityCache();
  const cacheContent = cacheProjection.content;
  const cacheCoveredKeys = cacheProjection.coveredKeys;
  const cacheTokens = cacheContent ? estimateTokens(cacheContent.length, cpt) : 0;

  const skippedToolCallIds = new Set<string>();
  for (let i = 0; i < bodyItems.length; i++) {
    const a = bodyItems[i]!;
    if (a.kind !== 'assistant-turn' || !a.toolCalls || a.toolCalls.length === 0) continue;

    const allStubbed = a.toolCalls.every((tc) => {
      for (let j = i + 1; j < bodyItems.length; j++) {
        const r = bodyItems[j]!;
        if (r.kind !== 'tool-result') continue;
        if (r.toolCallId !== tc.id) continue;
        const c = typeof r.content === 'string' ? r.content : safeStringify(r.content);
        return c === STUB_CONTENT;
      }
      return false;
    });

    // A group is fully-cached only when every tool call is a projected-
    // cache category (get/list) AND its identity made it into the
    // non-truncated entity-cache block the model will actually see.
    // Query-category calls are never indexed; dedup-only membership is
    // insufficient because `serializeEntityCache` may truncate at its
    // char cap, and entries dropped during truncation must not cause
    // the original tool-result to be skipped.
    const allCached = a.toolCalls.every((tc) => {
      const cat = getToolCompactionCategory(tc.name);
      if (cat !== 'get' && cat !== 'list') return false;
      return cacheCoveredKeys.has(`${tc.name}|${safeStringify(tc.arguments)}`);
    });

    // Legacy parity:
    //  - Trailing fully-cached group: PRESERVED (newest execution context).
    //  - Trailing fully-stubbed group: STILL SKIPPED (stubs carry no info).
    //  - Non-trailing fully-stubbed/cached group: SKIPPED.
    if (allStubbed) {
      for (const tc of a.toolCalls) skippedToolCallIds.add(tc.id);
    } else if (allCached && !isTrailingAssistantToolGroup(i)) {
      for (const tc of a.toolCalls) skippedToolCallIds.add(tc.id);
    }
  }

  // ── 7. Primary system (guides concatenated) tokens ───────────
  const primarySystemContent = guideContent.join('\n\n');
  const primarySystemChars = primarySystemContent.length;
  const primarySystemTokens = estimateTokens(primarySystemChars, cpt);

  // ── 8. Compute remaining history budget ──────────────────────
  const historyBudgetTokens = Math.max(
    0,
    totalBudgetTokens - primarySystemTokens - processPromptTokens - toolSchemaTokens - cacheTokens,
  );
  const historyBudgetChars = historyBudgetTokens * cpt;

  // ── 9. Serialize body items (excluding process-prompts handled above) ──
  // and walk backwards from end to find cut point.
  const bodySerialized: Array<{ msgs: LLMMessage[]; chars: number; item: ContextItem }> = [];
  for (const item of bodyItems) {
    // Skip fully-stubbed/cached assistant turns and their tool-result followers
    if (
      item.kind === 'assistant-turn' &&
      item.toolCalls?.length &&
      item.toolCalls.every((tc) => skippedToolCallIds.has(tc.id))
    ) {
      continue;
    }
    if (item.kind === 'tool-result' && item.toolCallId && skippedToolCallIds.has(item.toolCallId)) {
      continue;
    }
    const msgs = itemToMessages(item, input.graph, new Set<ContextItemId>(), sanitizeToolName);
    const chars = msgs.reduce((s, m) => s + messageChars(m), 0);
    bodySerialized.push({ msgs, chars, item });
  }

  // Walk backwards to find the cut point. Legacy parity: the newest raw
  // message (last bodyItem) is always kept — we never drop the most recent
  // user/assistant turn even if it alone exceeds the history budget.
  let historyChars = 0;
  let cutIdx = bodySerialized.length; // default: keep nothing
  for (let i = bodySerialized.length - 1; i >= 0; i--) {
    const entry = bodySerialized[i]!;
    if (i === bodySerialized.length - 1) {
      historyChars += entry.chars;
      cutIdx = i;
      continue;
    }
    if (historyChars + entry.chars > historyBudgetChars) {
      cutIdx = i + 1;
      break;
    }
    historyChars += entry.chars;
    cutIdx = i;
  }

  // ── 10. Dangling-tool guard ──────────────────────────────────
  // Don't start the retained window with a `role:tool` message.
  while (cutIdx < bodySerialized.length) {
    const firstMsgs = bodySerialized[cutIdx]!.msgs;
    if (firstMsgs.length === 0 || firstMsgs[0]!.role !== 'tool') break;
    cutIdx++;
  }

  // ── 11. Tool-call pairing guard ──────────────────────────────
  // If first kept assistant has toolCalls, every required (non-skipped) id
  // must have a matching tool-result later in the retained window.
  if (cutIdx < bodySerialized.length) {
    const firstItem = bodySerialized[cutIdx]!.item;
    if (firstItem.kind === 'assistant-turn' && firstItem.toolCalls?.length) {
      const required = new Set(firstItem.toolCalls.map((tc) => tc.id));
      for (const id of skippedToolCallIds) required.delete(id);
      const present = new Set<string>();
      for (let j = cutIdx + 1; j < bodySerialized.length; j++) {
        const nextItem = bodySerialized[j]!.item;
        if (nextItem.kind === 'tool-result' && nextItem.toolCallId) {
          present.add(nextItem.toolCallId);
        }
      }
      const allPresent = [...required].every((id) => present.has(id));
      if (!allPresent) {
        // Drop ONLY this broken assistant + any tool-results whose
        // toolCallId belongs to it. Do NOT advance through subsequent valid
        // exchanges — those are fine.
        const brokenCallIds = new Set(firstItem.toolCalls.map((tc) => tc.id));
        cutIdx++; // skip the broken assistant
        while (cutIdx < bodySerialized.length) {
          const next = bodySerialized[cutIdx]!.item;
          if (next.kind !== 'tool-result') break;
          if (!next.toolCallId || !brokenCallIds.has(next.toolCallId)) break;
          cutIdx++;
        }
      }
    }
  }

  // ── 12. Assemble wire messages ────────────────────────────────
  const wireMessages: LLMMessage[] = [];

  // Primary system prompt (all guides concatenated + entity cache).
  // Parity with legacy: cache block is only injected when a primary system exists.
  if (primarySystemContent) {
    const systemContent = cacheContent
      ? `${primarySystemContent}\n\n${cacheContent}`
      : primarySystemContent;
    wireMessages.push({ role: 'system', content: systemContent });
  }

  // Process prompts (kept ones, in original insertion order)
  for (const pp of processPromptCandidates) {
    if (keptProcessPromptIds.has(pp.itemId) && pp.kind === 'system-message') {
      wireMessages.push({ role: 'system', content: pp.content });
    }
  }

  // Body (from cut point to end)
  const bodyMessages: LLMMessage[] = [];
  for (let i = cutIdx; i < bodySerialized.length; i++) {
    for (const m of bodySerialized[i]!.msgs) bodyMessages.push(m);
  }

  // ── 13a. Collect toolCallIds with matching tool-results in retained window
  // (needed to filter assistant toolCalls that would be orphaned after
  // graph-level identity dedup)
  const toolResultIds = new Set<string>();
  for (const m of bodyMessages) {
    if (m.role === 'tool' && m.toolCallId) toolResultIds.add(m.toolCallId);
  }

  // ── 13b. Filter assistant toolCalls that have no matching tool-result.
  // Graph dedup by (toolKey, paramsHash) can drop an earlier tool-result
  // while its referencing assistant still lists the original toolCallId.
  // Unmatched ids would cause OpenAI to reject the request.
  const filteredBodyMessages: LLMMessage[] = [];
  for (const m of bodyMessages) {
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const kept = m.toolCalls.filter((tc) => toolResultIds.has(tc.id));
      if (kept.length === 0) {
        // All tool calls were orphaned — drop the assistant turn entirely
        // only if it had no plain content either (otherwise emit without
        // toolCalls to preserve the content).
        if (m.content.length > 0) {
          filteredBodyMessages.push({ role: 'assistant', content: m.content });
        }
        continue;
      }
      if (kept.length < m.toolCalls.length) {
        filteredBodyMessages.push({ ...m, toolCalls: kept });
        continue;
      }
    }
    filteredBodyMessages.push(m);
  }

  // ── 13c. Orphan-tool guard ────────────────────────────────────
  // Drop any `role:tool` whose toolCallId has no matching announced tool-call
  // in the retained+filtered window.
  const announced = new Set<string>();
  for (const m of filteredBodyMessages) {
    if (m.role === 'assistant' && m.toolCalls) {
      for (const tc of m.toolCalls) announced.add(tc.id);
    }
    if (m.role === 'tool') {
      if (!m.toolCallId || !announced.has(m.toolCallId)) continue;
    }
    wireMessages.push(m);
  }

  const estimatedTokensUsed =
    primarySystemTokens +
    processPromptTokens +
    toolSchemaTokens +
    cacheTokens +
    estimateTokens(historyChars, cpt);

  return {
    wireMessages,
    wireTools,
    toolNameReverseMap,
    estimatedTokensUsed,
  };
}
