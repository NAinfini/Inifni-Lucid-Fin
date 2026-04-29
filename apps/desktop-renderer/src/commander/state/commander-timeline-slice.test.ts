/**
 * Phase C — timeline slice reducer tests.
 *
 * Covers: seq monotonicity, out-of-order drop, currentRunId tracking,
 * byRunId indexing. Phase D consumers rely on these invariants.
 */

import { describe, expect, it } from 'vitest';
import { commanderTimelineSlice, appendEvent, resetTimeline } from './commander-timeline-slice.js';
import type { TimelineEvent } from '@lucid-fin/contracts';

function mkEvent(runId: string, seq: number, overrides?: Partial<TimelineEvent>): TimelineEvent {
  return {
    kind: 'assistant_text',
    runId,
    step: 0,
    seq,
    emittedAt: Date.now(),
    content: 'x',
    isDelta: true,
    ...(overrides as object),
  } as TimelineEvent;
}

describe('commanderTimelineSlice', () => {
  it('appends monotonically and indexes by runId', () => {
    const reducer = commanderTimelineSlice.reducer;
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(
      state,
      appendEvent(mkEvent('r1', 0, { kind: 'run_start', intent: 'hi' } as never)),
    );
    state = reducer(state, appendEvent(mkEvent('r1', 1)));
    state = reducer(state, appendEvent(mkEvent('r1', 2)));

    expect(state.events).toHaveLength(3);
    expect(state.byRunId['r1']).toEqual([0, 1, 2]);
    expect(state.currentRunId).toBe('r1');
  });

  it('drops out-of-order events within a run', () => {
    const reducer = commanderTimelineSlice.reducer;
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(state, appendEvent(mkEvent('r1', 5)));
    state = reducer(state, appendEvent(mkEvent('r1', 3))); // should drop
    state = reducer(state, appendEvent(mkEvent('r1', 6)));

    expect(state.events).toHaveLength(2);
    expect(state.events.map((e) => e.seq)).toEqual([5, 6]);
    expect(state.droppedOutOfOrder).toBe(1);
  });

  it('clears currentRunId on run_end', () => {
    const reducer = commanderTimelineSlice.reducer;
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(
      state,
      appendEvent(mkEvent('r1', 0, { kind: 'run_start', intent: 'x' } as never)),
    );
    expect(state.currentRunId).toBe('r1');
    state = reducer(
      state,
      appendEvent(mkEvent('r1', 1, { kind: 'run_end', status: 'completed' } as never)),
    );
    expect(state.currentRunId).toBeNull();
  });

  it('clears currentRunId on cancelled', () => {
    const reducer = commanderTimelineSlice.reducer;
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(
      state,
      appendEvent(mkEvent('r1', 0, { kind: 'run_start', intent: 'x' } as never)),
    );
    state = reducer(
      state,
      appendEvent(
        mkEvent('r1', 1, {
          kind: 'cancelled',
          reason: 'user',
          completedToolCalls: 0,
          pendingToolCalls: 0,
        } as never),
      ),
    );
    expect(state.currentRunId).toBeNull();
  });

  it('keeps two runs independent in byRunId', () => {
    const reducer = commanderTimelineSlice.reducer;
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(
      state,
      appendEvent(mkEvent('r1', 0, { kind: 'run_start', intent: 'a' } as never)),
    );
    state = reducer(state, appendEvent(mkEvent('r1', 1)));
    state = reducer(
      state,
      appendEvent(mkEvent('r2', 0, { kind: 'run_start', intent: 'b' } as never)),
    );
    state = reducer(state, appendEvent(mkEvent('r2', 1)));

    expect(state.byRunId['r1']).toEqual([0, 1]);
    expect(state.byRunId['r2']).toEqual([2, 3]);
  });

  it('resetTimeline wipes everything', () => {
    const reducer = commanderTimelineSlice.reducer;
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(
      state,
      appendEvent(mkEvent('r1', 0, { kind: 'run_start', intent: 'x' } as never)),
    );
    state = reducer(state, resetTimeline());
    expect(state.events).toHaveLength(0);
    expect(state.byRunId).toEqual({});
    expect(state.currentRunId).toBeNull();
  });

  describe('Phase F — orphan cleanup on terminal events', () => {
    it('synthesizes tool_result with RUN_ENDED_BEFORE_RESULT on run_end for pending tool_calls', () => {
      const reducer = commanderTimelineSlice.reducer;
      let state = reducer(undefined, { type: '@@INIT' });
      state = reducer(
        state,
        appendEvent(mkEvent('r1', 0, { kind: 'run_start', intent: 'x' } as never)),
      );
      state = reducer(
        state,
        appendEvent(
          mkEvent('r1', 1, {
            kind: 'tool_call',
            toolCallId: 'tc-1',
            toolRef: { domain: 'canvas', action: 'list' },
            args: {},
          } as never),
        ),
      );
      state = reducer(
        state,
        appendEvent(
          mkEvent('r1', 2, {
            kind: 'tool_call',
            toolCallId: 'tc-2',
            toolRef: { domain: 'canvas', action: 'get' },
            args: {},
          } as never),
        ),
      );
      // One tool gets a real result
      state = reducer(
        state,
        appendEvent(
          mkEvent('r1', 3, {
            kind: 'tool_result',
            toolCallId: 'tc-1',
            result: 'ok',
            durationMs: 10,
          } as never),
        ),
      );
      // Terminal — should synthesize for tc-2 only.
      state = reducer(
        state,
        appendEvent(mkEvent('r1', 4, { kind: 'run_end', status: 'failed' } as never)),
      );

      const results = state.events.filter((e) => e.kind === 'tool_result');
      expect(results).toHaveLength(2);
      const synthetic = results.find((r) => (r as { synthetic?: boolean }).synthetic);
      expect(synthetic).toBeDefined();
      expect((synthetic as { toolCallId: string }).toolCallId).toBe('tc-2');
      expect((synthetic as { error?: { code: string } }).error?.code).toBe(
        'RUN_ENDED_BEFORE_RESULT',
      );
    });

    it('also fires on cancelled terminal event', () => {
      const reducer = commanderTimelineSlice.reducer;
      let state = reducer(undefined, { type: '@@INIT' });
      state = reducer(
        state,
        appendEvent(mkEvent('r1', 0, { kind: 'run_start', intent: 'x' } as never)),
      );
      state = reducer(
        state,
        appendEvent(
          mkEvent('r1', 1, {
            kind: 'tool_call',
            toolCallId: 'tc-1',
            toolRef: { domain: 'canvas', action: 'list' },
            args: {},
          } as never),
        ),
      );
      state = reducer(
        state,
        appendEvent(
          mkEvent('r1', 2, {
            kind: 'cancelled',
            reason: 'user',
            completedToolCalls: 0,
            pendingToolCalls: 0,
          } as never),
        ),
      );
      const synthetics = state.events.filter(
        (e) => e.kind === 'tool_result' && (e as { synthetic?: boolean }).synthetic,
      );
      expect(synthetics).toHaveLength(1);
    });

    it('does nothing when every tool_call already has a tool_result', () => {
      const reducer = commanderTimelineSlice.reducer;
      let state = reducer(undefined, { type: '@@INIT' });
      state = reducer(
        state,
        appendEvent(mkEvent('r1', 0, { kind: 'run_start', intent: 'x' } as never)),
      );
      state = reducer(
        state,
        appendEvent(
          mkEvent('r1', 1, {
            kind: 'tool_call',
            toolCallId: 'tc-1',
            toolRef: { domain: 'canvas', action: 'list' },
            args: {},
          } as never),
        ),
      );
      state = reducer(
        state,
        appendEvent(
          mkEvent('r1', 2, {
            kind: 'tool_result',
            toolCallId: 'tc-1',
            result: 'ok',
            durationMs: 5,
          } as never),
        ),
      );
      const before = state.events.length;
      state = reducer(
        state,
        appendEvent(mkEvent('r1', 3, { kind: 'run_end', status: 'completed' } as never)),
      );
      // Only +1 for run_end, no synthetic appended.
      expect(state.events.length).toBe(before + 1);
    });
  });
});
