/**
 * `commander/service/history-builder.ts` — Phase E split-1.
 *
 * Turns Commander's in-memory `CommanderMessage[]` into the rich chat-history
 * payload the main-process commander expects. Handles the subtle case where
 * an assistant message has tool calls still pending (treat as plain text) or
 * only some calls completed.
 *
 * Extracted verbatim from `hooks/useCommander.ts` — same shape, same rules.
 * Kept as a pure function so the upcoming `CommanderSessionService` can unit-
 * test it without a Redux store.
 */

import type { CommanderMessage } from '../state/types.js';

/** Wire-compatible history entry. Each entry becomes one LLM-role turn. */
export type HistoryEntry = Record<string, unknown>;

export function buildCommanderHistory(messages: CommanderMessage[]): HistoryEntry[] {
  const history: HistoryEntry[] = [];

  for (const entry of messages) {
    if (entry.role === 'assistant' && entry.toolCalls && entry.toolCalls.length > 0) {
      const completedCalls = entry.toolCalls.filter(
        (tc) => tc.status === 'done' || tc.status === 'error',
      );
      if (completedCalls.length > 0) {
        // Push assistant message with tool calls attached
        history.push({
          role: 'assistant',
          content: entry.content,
          toolCalls: completedCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
        });
        // Push corresponding tool result messages
        for (const tc of completedCalls) {
          const resultStr =
            tc.result != null
              ? typeof tc.result === 'string'
                ? tc.result
                : JSON.stringify(tc.result)
              : '';
          history.push({
            role: 'tool',
            content: resultStr,
            toolCallId: tc.id,
          });
        }
      } else if (entry.content.trim().length > 0) {
        // All tool calls still pending — treat as plain text message
        history.push({ role: entry.role, content: entry.content });
      }
    } else if (entry.content.trim().length > 0) {
      history.push({ role: entry.role, content: entry.content });
    }
  }

  return history;
}
