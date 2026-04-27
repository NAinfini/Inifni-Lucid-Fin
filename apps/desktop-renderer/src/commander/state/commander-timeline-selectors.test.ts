/**
 * Phase F selector tests — `selectRunToolStats`, `selectCancelledEventForRun`.
 *
 * Scope is narrow: verify the per-run counting partition and the cancelled
 * event lookup. Broader selector coverage lives in the slice test and in
 * CommanderSessionService.test.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  selectRunToolStats,
  selectCancelledEventForRun,
} from './commander-timeline-selectors.js';
import type { RootState } from '../../store/index.js';
import type { TimelineEvent } from '@lucid-fin/contracts';

function state(events: TimelineEvent[]): RootState {
  const byRunId: Record<string, number[]> = {};
  events.forEach((e, i) => {
    (byRunId[e.runId] ??= []).push(i);
  });
  return {
    commanderTimeline: {
      events,
      byRunId,
      currentRunId: null,
      droppedOutOfOrder: 0,
      locallyResolvedConfirmations: [],
      locallyResolvedQuestions: [],
    },
  } as unknown as RootState;
}

function mkEvent<K extends string>(
  runId: string,
  seq: number,
  body: Record<string, unknown> & { kind: K },
): TimelineEvent {
  return {
    runId,
    step: 0,
    seq,
    emittedAt: seq * 1000,
    ...body,
  } as unknown as TimelineEvent;
}

describe('selectRunToolStats', () => {
  it('returns zeros for an unknown run', () => {
    expect(selectRunToolStats(state([]), 'missing')).toEqual({
      completed: 0,
      synthetic: 0,
      pending: 0,
    });
  });

  it('partitions tool_calls into completed / synthetic / pending', () => {
    const events: TimelineEvent[] = [
      mkEvent('r1', 0, { kind: 'tool_call', toolCallId: 'a', toolRef: { domain: 'x', action: 'y' }, args: {} }),
      mkEvent('r1', 1, { kind: 'tool_call', toolCallId: 'b', toolRef: { domain: 'x', action: 'y' }, args: {} }),
      mkEvent('r1', 2, { kind: 'tool_call', toolCallId: 'c', toolRef: { domain: 'x', action: 'y' }, args: {} }),
      mkEvent('r1', 3, { kind: 'tool_result', toolCallId: 'a', result: 'ok', durationMs: 1 }),
      mkEvent('r1', 4, { kind: 'tool_result', toolCallId: 'b', error: { code: 'RUN_ENDED_BEFORE_RESULT', params: {} }, durationMs: 0, synthetic: true }),
      // c has no result — pending.
    ];
    expect(selectRunToolStats(state(events), 'r1')).toEqual({
      completed: 1,
      synthetic: 1,
      pending: 1,
    });
  });
});

describe('selectCancelledEventForRun', () => {
  it('returns undefined when no cancelled event', () => {
    const events: TimelineEvent[] = [
      mkEvent('r1', 0, { kind: 'run_start', intent: 'x' }),
    ];
    expect(selectCancelledEventForRun(state(events), 'r1')).toBeUndefined();
  });

  it('returns the cancelled event when present', () => {
    const events: TimelineEvent[] = [
      mkEvent('r1', 0, { kind: 'run_start', intent: 'x' }),
      mkEvent('r1', 1, {
        kind: 'cancelled',
        reason: 'user',
        completedToolCalls: 0,
        pendingToolCalls: 0,
      }),
    ];
    const result = selectCancelledEventForRun(state(events), 'r1');
    expect(result?.kind).toBe('cancelled');
  });
});
