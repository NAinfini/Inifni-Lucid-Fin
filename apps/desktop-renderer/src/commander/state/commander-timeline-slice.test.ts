import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@lucid-fin/contracts';
import { appendEvent, commanderTimelineSlice, resetTimeline } from './commander-timeline-slice.js';

function event(runId: string, seq: number, overrides?: Partial<TimelineEvent>): TimelineEvent {
  return {
    kind: 'assistant_text',
    runId,
    step: 0,
    seq,
    emittedAt: seq,
    content: 'x',
    isDelta: true,
    ...(overrides as object),
  } as TimelineEvent;
}

const append = (sessionId: string, value: TimelineEvent) =>
  appendEvent({ sessionId, event: value });

describe('commanderTimelineSlice', () => {
  it('indexes monotonically by run and session', () => {
    const reducer = commanderTimelineSlice.reducer;
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(
      state,
      append('session-a', event('run-a', 0, { kind: 'run_start', intent: 'a' } as never)),
    );
    state = reducer(state, append('session-a', event('run-a', 1)));
    state = reducer(state, append('session-a', event('run-a', 1)));

    expect(state.byRunId['run-a']).toEqual([0, 1]);
    expect(state.sessionIdByRunId['run-a']).toBe('session-a');
    expect(state.currentRunIdBySessionId['session-a']).toBe('run-a');
    expect(state.droppedOutOfOrder).toBe(1);
  });

  it('keeps two sessions active and clears only the run_end owner', () => {
    const reducer = commanderTimelineSlice.reducer;
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(
      state,
      append('session-a', event('run-a', 0, { kind: 'run_start', intent: 'a' } as never)),
    );
    state = reducer(
      state,
      append('session-b', event('run-b', 0, { kind: 'run_start', intent: 'b' } as never)),
    );
    state = reducer(
      state,
      append(
        'session-a',
        event('run-a', 1, { kind: 'run_end', status: 'completed' } as never),
      ),
    );

    expect(state.currentRunIdBySessionId).toEqual({ 'session-b': 'run-b' });
    expect(state.byRunId['run-a']).toEqual([0, 2]);
    expect(state.byRunId['run-b']).toEqual([1]);
  });

  it('keeps a cancelled run active until run_end', () => {
    const reducer = commanderTimelineSlice.reducer;
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(
      state,
      append('session-a', event('run-a', 0, { kind: 'run_start', intent: 'a' } as never)),
    );
    state = reducer(
      state,
      append(
        'session-a',
        event('run-a', 1, {
          kind: 'cancelled',
          reason: 'user',
          completedToolCalls: 0,
          pendingToolCalls: 0,
        } as never),
      ),
    );

    expect(state.currentRunIdBySessionId['session-a']).toBe('run-a');
  });

  it('resets only the requested session', () => {
    const reducer = commanderTimelineSlice.reducer;
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(
      state,
      append('session-a', event('run-a', 0, { kind: 'run_start', intent: 'a' } as never)),
    );
    state = reducer(
      state,
      append('session-b', event('run-b', 0, { kind: 'run_start', intent: 'b' } as never)),
    );
    state = reducer(state, resetTimeline('session-a'));

    expect(state.byRunId['run-a']).toBeUndefined();
    expect(state.byRunId['run-b']).toEqual([0]);
    expect(state.currentRunIdBySessionId).toEqual({ 'session-b': 'run-b' });
  });

  it('isolates locally resolved prompts by session and run', () => {
    let state = commanderTimelineSlice.reducer(undefined, {
      type: 'commanderTimeline/markConfirmationResolvedLocally',
      payload: { sessionId: 'session-a', runId: 'run-a', toolCallId: 'tool-1' },
    });
    state = commanderTimelineSlice.reducer(state, {
      type: 'commanderTimeline/markConfirmationResolvedLocally',
      payload: { sessionId: 'session-b', runId: 'run-b', toolCallId: 'tool-1' },
    });

    expect(state.locallyResolvedConfirmationsBySessionId).toEqual({
      'session-a': { 'run-a': ['tool-1'] },
      'session-b': { 'run-b': ['tool-1'] },
    });
  });

  it('synthesizes orphan tool results without affecting another run', () => {
    const reducer = commanderTimelineSlice.reducer;
    let state = reducer(undefined, { type: '@@INIT' });
    state = reducer(
      state,
      append('session-a', event('run-a', 0, { kind: 'run_start', intent: 'a' } as never)),
    );
    state = reducer(
      state,
      append(
        'session-a',
        event('run-a', 1, {
          kind: 'tool_call',
          toolCallId: 'tool-a',
          toolRef: { domain: 'canvas', action: 'list' },
          args: {},
        } as never),
      ),
    );
    state = reducer(
      state,
      append(
        'session-a',
        event('run-a', 2, { kind: 'run_end', status: 'failed' } as never),
      ),
    );

    const synthetic = state.events.find(
      (candidate) => candidate.kind === 'tool_result' && candidate.synthetic,
    );
    expect(synthetic).toMatchObject({ runId: 'run-a', toolCallId: 'tool-a' });
  });
});
