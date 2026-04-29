/**
 * `commander/state/context-usage.ts` — Phase E split-3.
 *
 * Pure helper for computing Commander's "how full is the context window?"
 * breakdown. Used by `CommanderPanel` (for the inline indicator) and the
 * auto-compact trigger. Extracted from the panel so the calculation can be
 * unit-tested without mounting React, and so the panel's `useMemo` shrinks
 * to a single call.
 *
 * Two branches:
 *  - When the main process has reported a `context_usage` push payload the
 *    adapter's token numbers are authoritative (they include the system
 *    prompt and tool schemas that the renderer can't see).
 *  - Otherwise we estimate from the locally held messages — less accurate,
 *    but useful before the first LLM round-trip lands.
 *
 * No React, no Redux — all inputs arrive as plain data.
 */

import type { CommanderBackendContextUsage, CommanderMessage, CommanderToolCall } from './types.js';

export interface ContextUsageBreakdown {
  user: number;
  assistant: number;
  toolCalls: number;
  toolResults: number;
}

export interface ContextUsageCounts {
  user: number;
  assistant: number;
  toolCalls: number;
}

export interface ContextUsage {
  pct: number;
  estimatedTokens: number;
  ctxWindow: number;
  breakdown: ContextUsageBreakdown;
  counts: ContextUsageCounts;
  cache: { chars: number; entries: number };
  historyTrimmed: number;
}

export interface ContextUsageInput {
  messages: CommanderMessage[];
  currentStreamContent: string;
  currentToolCalls: CommanderToolCall[];
  maxTokens: number;
  backendContextUsage: CommanderBackendContextUsage | null;
}

const CHARS_PER_TOKEN = 3.5;
const toTokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

interface Tally {
  userChars: number;
  assistantChars: number;
  toolCallChars: number;
  toolResultChars: number;
  userCount: number;
  assistantCount: number;
  toolCallCount: number;
}

function emptyTally(): Tally {
  return {
    userChars: 0,
    assistantChars: 0,
    toolCallChars: 0,
    toolResultChars: 0,
    userCount: 0,
    assistantCount: 0,
    toolCallCount: 0,
  };
}

function accumulateMessages(tally: Tally, messages: CommanderMessage[]): void {
  for (const msg of messages) {
    const contentLen = msg.content?.length ?? 0;
    if (msg.role === 'user') {
      tally.userChars += contentLen;
      tally.userCount++;
    } else {
      tally.assistantChars += contentLen;
      tally.assistantCount++;
    }
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        tally.toolCallChars += JSON.stringify(tc.arguments).length;
        tally.toolCallCount++;
        if (tc.result !== undefined) {
          tally.toolResultChars += JSON.stringify(tc.result).length;
        }
      }
    }
  }
}

function accumulateInFlight(
  tally: Tally,
  currentStreamContent: string,
  currentToolCalls: CommanderToolCall[],
): void {
  tally.assistantChars += currentStreamContent?.length ?? 0;
  for (const tc of currentToolCalls) {
    tally.toolCallChars += JSON.stringify(tc.arguments).length;
    tally.toolCallCount++;
    if (tc.result !== undefined) {
      tally.toolResultChars += JSON.stringify(tc.result).length;
    }
  }
}

export function computeContextUsage(input: ContextUsageInput): ContextUsage {
  const { messages, currentStreamContent, currentToolCalls, maxTokens, backendContextUsage } =
    input;

  const tally = emptyTally();
  accumulateMessages(tally, messages);
  accumulateInFlight(tally, currentStreamContent, currentToolCalls);

  const breakdown: ContextUsageBreakdown = {
    user: toTokens(tally.userChars),
    assistant: toTokens(tally.assistantChars),
    toolCalls: toTokens(tally.toolCallChars),
    toolResults: toTokens(tally.toolResultChars),
  };
  const counts: ContextUsageCounts = {
    user: tally.userCount,
    assistant: tally.assistantCount,
    toolCalls: tally.toolCallCount,
  };

  if (backendContextUsage) {
    const { estimatedTokensUsed, contextWindowTokens } = backendContextUsage;
    const pct = Math.min(100, Math.round((estimatedTokensUsed / contextWindowTokens) * 100));
    return {
      pct,
      estimatedTokens: estimatedTokensUsed,
      ctxWindow: contextWindowTokens,
      breakdown,
      counts,
      cache: {
        chars: backendContextUsage.cacheChars,
        entries: backendContextUsage.cacheEntryCount,
      },
      historyTrimmed: backendContextUsage.historyMessagesTrimmed,
    };
  }

  // Fallback: local estimate (less accurate — missing system prompt + tool schemas)
  const totalChars =
    tally.userChars + tally.assistantChars + tally.toolCallChars + tally.toolResultChars;
  const estimatedTokens = toTokens(totalChars);
  const ctxWindow = maxTokens;
  const pct = ctxWindow > 0 ? Math.min(100, Math.round((estimatedTokens / ctxWindow) * 100)) : 0;
  return {
    pct,
    estimatedTokens,
    ctxWindow,
    breakdown,
    counts,
    cache: { chars: 0, entries: 0 },
    historyTrimmed: 0,
  };
}
