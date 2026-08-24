import { describe, expect, it } from 'vitest';

import {
  addInjectedMessage,
  appendFinalizedAssistantMessage,
  commanderSlice,
  finishStreaming,
  newSession,
  startStreaming,
} from './commander.js';

describe('Commander per-session runtime', () => {
  it('finalizes a background session without changing the selected running session', () => {
    const reducer = commanderSlice.reducer;
    let state = reducer(undefined, { type: '@@INIT' });

    const first = newSession('canvas-a');
    state = reducer(state, first);
    state = reducer(state, startStreaming(first.payload.id));
    state = reducer(
      state,
      addInjectedMessage({ sessionId: first.payload.id, content: 'follow up' }),
    );

    const second = newSession(null);
    state = reducer(state, second);
    state = reducer(state, startStreaming(second.payload.id));

    state = reducer(
      state,
      appendFinalizedAssistantMessage({
        sessionId: first.payload.id,
        runId: 'run-a',
        message: {
          id: 'run-run-a',
          role: 'assistant',
          content: 'finished in background',
          timestamp: 3,
        },
      }),
    );
    state = reducer(state, finishStreaming(first.payload.id));

    const firstSession = state.sessions.find((session) => session.id === first.payload.id)!;
    const secondSession = state.sessions.find((session) => session.id === second.payload.id)!;

    expect(state.activeSessionId).toBe(second.payload.id);
    expect(firstSession.messages.map((message) => message.content)).toEqual([
      'finished in background',
      'follow up',
    ]);
    expect(firstSession.runtime.phase.kind).toBe('idle');
    expect(secondSession.runtime.phase.kind).toBe('awaiting_model');
    expect(secondSession.messages).toEqual([]);
  });
});
