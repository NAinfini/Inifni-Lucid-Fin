/**
 * `commander/state/run-summary.ts` — Phase E split-1.
 *
 * Turns an in-flight commander run (stream content + tool calls) into a
 * finalized assistant message with a summary. Extracted from the original
 * slice — identical logic, no behavior change.
 */

import { createMessageId, createSegmentId } from './helpers.js';
import type {
  CommanderExitDecisionMeta,
  CommanderRunStatus,
  CommanderRunSummary,
  CommanderState,
  CommanderToolCall,
  MessageSegment,
} from './types.js';

function normalizeRunExcerpt(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

const EXCERPT_MAX_LEN = 320;

function trimRunExcerpt(content: string): string {
  return content.length > EXCERPT_MAX_LEN ? `${content.slice(0, EXCERPT_MAX_LEN - 1)}…` : content;
}

/**
 * Pick the final user-facing "result" text from a run. We want the last
 * assistant text segment — the model's closing answer after any tool calls —
 * rather than an early preamble ("Let me check…") that a head-of-string slice
 * would return. Falls back to the plain content when no segments were
 * captured (e.g. pure text runs with no tools).
 */
function pickResultText(content: string, segments: MessageSegment[] | undefined): string {
  if (segments && segments.length > 0) {
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const seg = segments[i];
      if (seg && seg.kind === 'text') {
        const normalized = normalizeRunExcerpt(seg.content);
        if (normalized) return normalized;
      }
    }
  }
  return normalizeRunExcerpt(content);
}

export function buildRunSummary(
  status: CommanderRunStatus,
  content: string,
  segments: MessageSegment[] | undefined,
  toolCalls: CommanderToolCall[],
  startedAt: number,
  completedAt: number,
  errorMessage?: string,
): CommanderRunSummary {
  const failedToolCount = toolCalls.filter((toolCall) => toolCall.status === 'error').length;
  const toolCount = toolCalls.length;
  const resultText = pickResultText(content, segments);
  const excerptSource =
    resultText ||
    normalizeRunExcerpt(errorMessage ?? '') ||
    (toolCount > 0
      ? `${status === 'failed' ? 'Attempted' : 'Completed'} ${toolCount} tool call${toolCount === 1 ? '' : 's'}.`
      : status === 'failed'
        ? 'Run failed before producing output.'
        : 'Run completed.');

  return {
    excerpt: trimRunExcerpt(excerptSource),
    toolCount,
    failedToolCount,
    durationMs: Math.max(0, completedAt - startedAt),
  };
}

export function finalizeCurrentRunMessage(
  state: CommanderState,
  status: CommanderRunStatus,
  fallbackContent?: string,
  errorMessage?: string,
  exitDecision?: CommanderExitDecisionMeta,
): void {
  const content = state.currentStreamContent || fallbackContent || '';
  const hasSegments = state.currentSegments.length > 0;
  const hasTools = state.currentToolCalls.length > 0;

  if (!content && !hasTools && !hasSegments && !errorMessage) {
    return;
  }

  const completedAt = Date.now();
  const startedAt = state.currentRunStartedAt ?? completedAt;
  const segments: MessageSegment[] | undefined = hasSegments
    ? [...state.currentSegments]
    : content
      ? [{ kind: 'text' as const, id: createSegmentId('text'), content }]
      : undefined;

  state.messages.push({
    id: createMessageId('assistant'),
    role: 'assistant',
    content,
    runMeta: {
      status,
      collapsed: true,
      startedAt,
      completedAt,
      summary: buildRunSummary(
        status,
        content,
        segments,
        state.currentToolCalls,
        startedAt,
        completedAt,
        errorMessage,
      ),
      exitDecision,
    },
    segments,
    toolCalls: hasTools ? [...state.currentToolCalls] : undefined,
    timestamp: completedAt,
  });
}
