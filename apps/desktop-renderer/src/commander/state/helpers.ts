/**
 * `commander/state/helpers.ts` — Phase E split-1.
 *
 * Pure helpers consumed by the reducers + the service layer. No Redux or
 * localStorage access — those belong to session-persistence / settings-
 * persistence modules. Extracted from `store/slices/commander.ts`.
 */

import { idlePhase } from './run-phase.js';
import type { CommanderMessage, CommanderQuestionOption, CommanderState } from './types.js';

export function createMessageId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createSegmentId(kind: string): string {
  return `seg-${kind}-${crypto.randomUUID()}`;
}

export function formatQuestionTranscript(
  question: string,
  options: CommanderQuestionOption[],
): string {
  const optionLines = options.map((option) =>
    option.description ? `- ${option.label}: ${option.description}` : `- ${option.label}`,
  );

  return optionLines.length > 0 ? `${question}\n\n${optionLines.join('\n')}` : question;
}

export function deriveSessionTitle(messages: CommanderMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg) return 'New session';
  const text = firstUserMsg.content.trim();
  return text.length > 60 ? text.slice(0, 57) + '...' : text;
}

/** A session is worth saving only if the user actually sent at least one message. */
export function hasUserMessage(messages: CommanderMessage[]): boolean {
  return messages.some((m) => m.role === 'user');
}

/** Reset transient per-run state back to idle. Used by finishStreaming / streamError. */
export function resetTransientRunState(state: CommanderState): void {
  state.phase = idlePhase;
  state.currentRunStartedAt = null;
  state.currentStreamContent = '';
  state.currentToolCalls = [];
  state.currentSegments = [];
  state.confirmAutoMode = 'none';
  state.consecutiveConfirmCount = 0;
}
