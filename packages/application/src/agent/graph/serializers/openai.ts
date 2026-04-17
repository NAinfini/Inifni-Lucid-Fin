/**
 * OpenAI serializer for ContextGraph — Phase G2a-4.
 *
 * Translates a ContextGraph into the message array format expected by
 * OpenAI's chat/completions API. Respects the TokenBudget by dropping
 * the oldest non-protected items if the serialized total exceeds the limit.
 *
 * Mapping rules:
 *   user-message      → { role: 'user', content: … }
 *   assistant-turn    → { role: 'assistant', content: …, tool_calls?: … }
 *   tool-result       → { role: 'tool', content: stringify(content), tool_call_id: … }
 *   entity-snapshot   → { role: 'system', content: renderEntityBrief(snapshot) }
 *   guide             → prepended as { role: 'system', … } at start
 *   system-message    → emitted INLINE as { role: 'system', content: … } in position
 *   session-summary   → { role: 'system', content: '<summary>…</summary>' }
 *   reference         → resolve via graph.get() and render the referenced item
 */

import type { LLMMessage } from '@lucid-fin/contracts';
import type {
  ContextItem,
  ContextItemId,
  TokenBudget,
} from '@lucid-fin/contracts';
import type { ContextGraph } from '../context-graph.js';

export interface SerializeOptions {
  /**
   * Transform tool names before emission (e.g. sanitize dots to underscores
   * when the provider profile requires it). Applied to assistant-turn
   * `toolCalls[].name`. Identity by default.
   */
  sanitizeToolName?: (name: string) => string;
}

// ── Internal wire types (OpenAI format) ────────────────────────
// (OpenAI format mapping is applied inline during serialization)

/** Build a system message from entity-snapshot content. */
function renderEntityBrief(snapshot: unknown): string {
  try {
    return `[Entity snapshot] ${JSON.stringify(snapshot)}`;
  } catch {
    return '[Entity snapshot] (unserializable)';
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'Failed to serialize content' });
  }
}

/**
 * Estimate the token footprint of a single wire message. Includes tool-call
 * metadata (ids, names, serialized arguments) on assistant entries, since
 * those bytes are sent to the provider and consume prompt tokens.
 */
function estimateMessageTokens(msg: LLMMessage, charsPerToken: number): number {
  let chars = msg.content.length;
  if (msg.role === 'assistant' && msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      chars += tc.id.length + tc.name.length;
      try {
        chars += JSON.stringify(tc.arguments).length;
      } catch {
        // ignore unserializable args — conservative undercount is safe-ish
      }
    }
  }
  return Math.ceil(chars / charsPerToken);
}

/**
 * Serialize a single ContextItem to one or more LLMMessage entries.
 * Returns an empty array for item kinds that produce no messages,
 * or if the referenced item cannot be resolved.
 */
function serializeItem(
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
      // Guides are collected separately and prepended — handled in serializeForOpenAI
      return [];

    case 'system-message':
      return [{ role: 'system', content: item.content }];

    case 'session-summary':
      return [{ role: 'system', content: `<summary>\n${item.content}\n</summary>` }];

    case 'reference': {
      if (visited.has(item.referencedItemId)) {
        // Cycle guard
        return [];
      }
      visited.add(item.referencedItemId);
      const referenced = graph.get(item.referencedItemId);
      if (!referenced) return [];
      return serializeItem(referenced, graph, visited, sanitizeToolName);
    }

    default:
      return [];
  }
}

/**
 * Serialize a ContextGraph into an OpenAI message array, respecting
 * the token budget. Guides are always prepended as system messages.
 * Oldest non-guide, non-summary items are dropped when over budget.
 */
export function serializeForOpenAI(
  graph: ContextGraph,
  budget: TokenBudget,
  options: SerializeOptions = {},
): LLMMessage[] {
  const charsPerToken = budget.charsPerToken ?? 4;
  const maxTokens = budget.tokens;
  const sanitizeToolName = options.sanitizeToolName ?? ((name) => name);

  const items = [...graph];

  // Separate guides (always first) from the rest
  const guideMessages: LLMMessage[] = [];
  const bodyItems: ContextItem[] = [];

  for (const item of items) {
    if (item.kind === 'guide') {
      guideMessages.push({ role: 'system', content: item.content });
    } else {
      bodyItems.push(item);
    }
  }

  // Estimate guide token cost
  const guideCost = guideMessages.reduce(
    (sum, m) => sum + estimateMessageTokens(m, charsPerToken),
    0,
  );
  const remainingBudget = Math.max(0, maxTokens - guideCost);

  // Build body messages in insertion order. Walk backward from end to
  // find the cut point (drop oldest to stay within budget).
  const serialized: Array<{ messages: LLMMessage[]; tokens: number; index: number }> = [];
  for (let i = 0; i < bodyItems.length; i++) {
    const item = bodyItems[i]!;
    const msgs = serializeItem(item, graph, new Set<ContextItemId>(), sanitizeToolName);
    const tokens = msgs.reduce((sum, m) => sum + estimateMessageTokens(m, charsPerToken), 0);
    serialized.push({ messages: msgs, tokens, index: i });
  }

  // Walk backwards keeping as many items as fit
  let usedTokens = 0;
  let cutFromIndex = serialized.length; // start keeping from this index

  for (let i = serialized.length - 1; i >= 0; i--) {
    const entry = serialized[i]!;
    if (usedTokens + entry.tokens > remainingBudget) {
      cutFromIndex = i + 1;
      break;
    }
    usedTokens += entry.tokens;
    cutFromIndex = i;
  }

  // Assemble final message array
  const bodyMessages: LLMMessage[] = [];
  for (let i = cutFromIndex; i < serialized.length; i++) {
    for (const msg of serialized[i]!.messages) {
      bodyMessages.push(msg);
    }
  }

  // Validate: don't start with a dangling tool message
  let startIdx = 0;
  while (startIdx < bodyMessages.length && bodyMessages[startIdx]!.role === 'tool') {
    startIdx++;
  }
  const trimmed = bodyMessages.slice(startIdx);

  // Validate: drop any `role: 'tool'` whose toolCallId has no matching
  // assistant tool-call id earlier in the retained window. Budget trimming
  // can cut the originating assistant turn while keeping the tool result,
  // which would cause an OpenAI request-validation failure.
  const announcedCallIds = new Set<string>();
  const validated: LLMMessage[] = [];
  for (const msg of trimmed) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) announcedCallIds.add(tc.id);
    }
    if (msg.role === 'tool') {
      const callId = msg.toolCallId;
      if (!callId || !announcedCallIds.has(callId)) {
        continue; // orphaned tool message — drop
      }
    }
    validated.push(msg);
  }

  return [...guideMessages, ...validated];
}
