/**
 * Unified message gateway for LLM requests.
 *
 * `buildMessagesForRequest` — called before every LLM API call.
 *   Enforces budget (system prompt + history + tools within context window),
 *   sanitizes tool names if required by the provider profile, and returns
 *   a **snapshot copy** of the messages array (never mutates the accumulator).
 *
 * `destructLLMResponse` — called after every LLM API response.
 *   Un-sanitizes tool names and deduplicates tool call IDs.
 */

import type {
  LLMMessage,
  LLMToolDefinition,
  LLMCompletionResult,
  ProviderProfile,
} from '@lucid-fin/contracts';
import { DEFAULT_PROVIDER_PROFILE } from '@lucid-fin/contracts';
import type { ToolResultCache } from './tool-result-cache.js';

// ---------------------------------------------------------------------------
// MessageBuildContext — shared between constructor and destructor
// ---------------------------------------------------------------------------

export interface MessageBuildContext {
  readonly profile: ProviderProfile;
  /** sanitized tool name → original tool name */
  readonly toolNameReverseMap: ReadonlyMap<string, string>;
  /** Estimated total tokens used (system + history + tools) */
  readonly estimatedTokensUsed: number;
  /** Number of history messages dropped due to budget */
  readonly historyMessagesTrimmed: number;
}

// ---------------------------------------------------------------------------
// buildMessagesForRequest (constructor)
// ---------------------------------------------------------------------------

export interface BuildMessagesInput {
  /** Full accumulated messages array (system + history + in-flight). NOT mutated. */
  messages: readonly LLMMessage[];
  /** Tool definitions (already compacted/evicted by adaptiveToolCompaction). */
  tools: LLMToolDefinition[];
  /** Provider-specific profile. Falls back to DEFAULT_PROVIDER_PROFILE. */
  profile?: ProviderProfile;
  /** Effective context window in tokens. */
  contextWindowTokens: number;
  /** Tokens reserved for output generation. Default 4096. */
  reserveTokensForOutput?: number;
  /** Tool result cache — serialized and injected as system prompt addendum. */
  cache?: ToolResultCache;
  /** Parameter names auto-injected by the executor — stripped from schemas sent to the LLM. */
  injectedParams?: string[];
}

export interface BuildMessagesResult {
  /** Budget-enforced snapshot of messages. Tool names sanitized if needed. */
  wireMessages: LLMMessage[];
  /** Sanitized tool definitions (if profile.sanitizeToolNames). */
  wireTools: LLMToolDefinition[];
  /** Context for the destructor. */
  buildCtx: MessageBuildContext;
}

function estimateTokens(chars: number, charsPerToken: number): number {
  return Math.ceil(chars / charsPerToken);
}

/**
 * Strip context-injected parameters from a tool schema.
 * These parameters are auto-supplied by the tool executor at runtime,
 * so the LLM should not see or fill them — saves tokens and eliminates
 * a class of "required field missing" errors.
 */
function stripInjectedParams(
  tool: LLMToolDefinition,
  params: string[],
): LLMToolDefinition {
  const props = tool.parameters.properties;
  const hasAny = params.some((p) => p in props);
  if (!hasAny) return tool;

  const newProps = { ...props };
  for (const p of params) delete newProps[p];
  const newRequired = tool.parameters.required?.filter((r) => !params.includes(r));
  return {
    ...tool,
    parameters: {
      ...tool.parameters,
      properties: newProps,
      required: newRequired?.length ? newRequired : undefined,
    },
  };
}

function messageChars(m: LLMMessage): number {
  let c = m.content.length;
  if (m.toolCalls) {
    for (const tc of m.toolCalls) {
      c += JSON.stringify(tc.arguments).length;
      // tool call name + id overhead
      c += (tc.name?.length ?? 0) + (tc.id?.length ?? 0) + 20;
    }
  }
  return c;
}

function isProcessPromptMessage(message: LLMMessage): boolean {
  return message.role === 'system' && message.content.startsWith('[[process-prompt:');
}

const SANITIZE_RE = /\./g;
function sanitizeName(name: string): string {
  return name.replace(SANITIZE_RE, '_');
}

export function buildMessagesForRequest(input: BuildMessagesInput): BuildMessagesResult {
  const profile = input.profile ?? DEFAULT_PROVIDER_PROFILE;
  const cpt = profile.charsPerToken;
  const reserveTokens = input.reserveTokensForOutput ?? profile.outputReserveTokens ?? 4096;
  const totalBudgetTokens = Math.max(0, input.contextWindowTokens - reserveTokens);

  // --- Strip context-injected parameters from tool schemas ---
  let baseTools = input.tools;
  if (input.injectedParams?.length) {
    baseTools = input.tools.map((t) => stripInjectedParams(t, input.injectedParams!));
  }

  // --- Build tool name sanitization map ---
  const toolNameReverseMap = new Map<string, string>();
  let wireTools = baseTools;
  if (profile.sanitizeToolNames) {
    wireTools = baseTools.map((t) => {
      const sanitized = sanitizeName(t.name);
      if (sanitized !== t.name) {
        toolNameReverseMap.set(sanitized, t.name);
      }
      return { ...t, name: sanitized };
    });
  }

  // --- Estimate tool schema size ---
  const toolSchemaChars = wireTools.reduce((sum, t) => {
    return sum + t.name.length + t.description.length + JSON.stringify(t.parameters).length + 40;
  }, 0);
  const toolSchemaTokens = estimateTokens(toolSchemaChars, cpt);

  const msgs = input.messages;
  const hasPrimarySystem = msgs.length > 0 && msgs[0].role === 'system';
  const primarySystemMessage = hasPrimarySystem ? msgs[0] : null;
  const historyStart = hasPrimarySystem ? 1 : 0;

  // Active process prompts are budgeted separately and take priority over history.
  const processPromptBudgetChars = 30_000;
  const processPromptMessages: LLMMessage[] = [];
  let processPromptChars = 0;
  for (let i = msgs.length - 1; i >= historyStart; i--) {
    if (!isProcessPromptMessage(msgs[i])) continue;
    const chars = messageChars(msgs[i]);
    if (processPromptMessages.length > 0 && processPromptChars + chars > processPromptBudgetChars) {
      continue;
    }
    processPromptMessages.unshift({ ...msgs[i] });
    processPromptChars += chars;
  }
  const processPromptTokens = processPromptChars > 0
    ? estimateTokens(processPromptChars, cpt)
    : 0;

  // --- Estimate primary system prompt size ---
  const primarySystemTokens = primarySystemMessage
    ? estimateTokens(primarySystemMessage.content.length, cpt)
    : 0;

  // --- Pre-compute cache size BEFORE history trimming ---
  const cacheContent = input.cache?.entryCount ? input.cache.serialize() : '';
  const cacheTokens = cacheContent ? estimateTokens(cacheContent.length, cpt) : 0;

  // --- Available budget for history (cache subtracted before trim) ---
  const historyBudgetTokens = Math.max(
    0,
    totalBudgetTokens - primarySystemTokens - processPromptTokens - toolSchemaTokens - cacheTokens,
  );
  const historyBudgetChars = historyBudgetTokens * cpt;

  // --- Build a set of tool call IDs belonging to fully-stubbed assistant groups ---
  // An assistant+tool group is "fully stubbed" when EVERY toolCall has a
  // corresponding tool message with content === STUB_CONTENT.
  // We pre-compute this so both the budget walk and the assembly loop
  // can skip entire groups atomically (never leaving orphan references).
  const STUB_CONTENT = '{"_cached":true}';
  const shouldPreserveAssistantToolGroup = (assistantIndex: number): boolean => {
    const toolCallIds = new Set(msgs[assistantIndex].toolCalls?.map((toolCall) => toolCall.id) ?? []);
    for (let i = assistantIndex + 1; i < msgs.length; i++) {
      const message = msgs[i];
      if (message.role === 'system') continue;
      if (message.role === 'tool' && message.toolCallId && toolCallIds.has(message.toolCallId)) continue;
      return false;
    }
    return true;
  };

  const fullySkippedToolCallIds = new Set<string>();
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'assistant' || !msgs[i].toolCalls?.length) continue;
    const tcs = msgs[i].toolCalls!;
    const allStubbed = tcs.every((tc) => {
      // Scan ALL remaining messages (not just contiguous block) — dupMap
      // can push tool results after non-tool messages.
      for (let j = i + 1; j < msgs.length; j++) {
        if (msgs[j].role === 'tool' && msgs[j].toolCallId === tc.id) {
          return msgs[j].content === STUB_CONTENT;
        }
      }
      return false;
    });
    const allCached = !shouldPreserveAssistantToolGroup(i)
      && !!input.cache
      && tcs.every((tc) => input.cache!.hasCoverage(tc.name, tc.arguments as Record<string, unknown>));
    if (allStubbed || allCached) {
      for (const tc of tcs) fullySkippedToolCallIds.add(tc.id);
    }
  }

  let historyChars = 0;
  let cutIndex = 1; // default: keep from index 1 (skip system at 0)

  // If first message is system, history starts at index 1
  // Walk backwards from the end
  for (let i = msgs.length - 1; i >= historyStart; i--) {
    if (isProcessPromptMessage(msgs[i])) continue;
    // Skip stubbed tool messages from fully-stubbed groups
    if (msgs[i].role === 'tool' && msgs[i].toolCallId && fullySkippedToolCallIds.has(msgs[i].toolCallId!)) {
      continue;
    }
    // Skip fully-stubbed assistant messages
    if (msgs[i].role === 'assistant' && msgs[i].toolCalls?.length) {
      if (msgs[i].toolCalls!.every((tc) => fullySkippedToolCallIds.has(tc.id))) continue;
    }
    const mc = messageChars(msgs[i]);
    if (historyChars + mc > historyBudgetChars && i !== msgs.length - 1) {
      // Can't fit this message; cut here
      cutIndex = i + 1;
      break;
    }
    historyChars += mc;
    cutIndex = i;
  }

  // Ensure we don't start with a dangling tool result
  while (cutIndex < msgs.length && msgs[cutIndex].role === 'tool') {
    cutIndex++;
  }

  // If first kept message is assistant with toolCalls, verify all tool results present
  if (cutIndex < msgs.length && msgs[cutIndex].role === 'assistant' && msgs[cutIndex].toolCalls?.length) {
    const requiredIds = new Set(msgs[cutIndex].toolCalls!.map((tc) => tc.id));
    const presentIds = new Set<string>();
    // Scan the full remaining range (not just contiguous block) — dupMap can push results later
    for (let i = cutIndex + 1; i < msgs.length; i++) {
      if (msgs[i].role === 'tool' && msgs[i].toolCallId) presentIds.add(msgs[i].toolCallId!);
    }
    // Exclude fully-stubbed tool call IDs — those are intentionally omitted
    for (const id of fullySkippedToolCallIds) {
      requiredIds.delete(id);
    }
    const allPresent = [...requiredIds].every((id) => presentIds.has(id));
    if (!allPresent) {
      // Drop this broken exchange
      while (cutIndex < msgs.length && (msgs[cutIndex].role === 'assistant' || msgs[cutIndex].role === 'tool')) {
        cutIndex++;
      }
    }
  }

  const trimmedCount = cutIndex - historyStart;

  // --- Assemble wire messages ---
  const wireMessages: LLMMessage[] = [];

  if (primarySystemMessage) {
    wireMessages.push({ ...primarySystemMessage });
  }

  for (const systemMessage of processPromptMessages) {
    wireMessages.push(systemMessage);
  }

  // History (trimmed, skip fully-stubbed groups)
  for (let i = cutIndex; i < msgs.length; i++) {
    const m = msgs[i];
    if (isProcessPromptMessage(m)) continue;
    // Skip tool messages from fully-stubbed groups
    if (m.role === 'tool' && m.toolCallId && fullySkippedToolCallIds.has(m.toolCallId)) continue;
    // Skip fully-stubbed assistant messages
    if (m.role === 'assistant' && m.toolCalls?.length) {
      if (m.toolCalls.every((tc) => fullySkippedToolCallIds.has(tc.id))) continue;
    }
    if (profile.sanitizeToolNames) {
      wireMessages.push(sanitizeMessage(m, toolNameReverseMap));
    } else {
      wireMessages.push({ ...m });
    }
  }

  // Inject cache as system prompt addendum
  if (cacheContent && wireMessages.length > 0 && wireMessages[0].role === 'system') {
    wireMessages[0] = { ...wireMessages[0], content: wireMessages[0].content + '\n\n' + cacheContent };
  }

  const estimatedTokensUsed = primarySystemTokens + processPromptTokens + toolSchemaTokens + cacheTokens +
    estimateTokens(historyChars, cpt);

  return {
    wireMessages,
    wireTools,
    buildCtx: {
      profile,
      toolNameReverseMap,
      estimatedTokensUsed,
      historyMessagesTrimmed: Math.max(0, trimmedCount),
    },
  };
}

/** Sanitize tool names in a single message (shallow copy). */
function sanitizeMessage(m: LLMMessage, reverseMap: Map<string, string>): LLMMessage {
  const clone: LLMMessage = { ...m };
  if (clone.toolCalls?.length) {
    clone.toolCalls = clone.toolCalls.map((tc) => {
      const sanitized = sanitizeName(tc.name);
      if (sanitized !== tc.name) reverseMap.set(sanitized, tc.name);
      return { ...tc, name: sanitized };
    });
  }
  if (clone.role === 'tool' && clone.toolCallId) {
    // toolCallId references are IDs, not names — no sanitization needed
  }
  return clone;
}

// ---------------------------------------------------------------------------
// destructLLMResponse (destructor)
// ---------------------------------------------------------------------------

/**
 * Un-sanitize tool names and deduplicate tool call IDs in an LLM response.
 * Returns a new LLMCompletionResult (never mutates the input).
 */
export function destructLLMResponse(
  raw: LLMCompletionResult,
  ctx: MessageBuildContext,
): LLMCompletionResult {
  if (!raw.toolCalls || raw.toolCalls.length === 0) return raw;

  const seenIds = new Set<string>();
  const dedupedCalls = [];

  for (const tc of raw.toolCalls) {
    // Deduplicate by ID
    if (seenIds.has(tc.id)) continue;
    seenIds.add(tc.id);

    // Un-sanitize tool name
    let name = tc.name;
    if (ctx.profile.sanitizeToolNames && ctx.toolNameReverseMap.size > 0) {
      name = ctx.toolNameReverseMap.get(tc.name) ?? tc.name;
    }

    dedupedCalls.push({ ...tc, name });
  }

  return {
    ...raw,
    toolCalls: dedupedCalls,
  };
}
