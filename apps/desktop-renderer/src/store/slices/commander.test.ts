import { describe, expect, it } from 'vitest';

import {
  addInjectedMessage,
  addUserMessage,
  appendFinalizedAssistantMessage,
  clearHistory,
  compactLocalContext,
  commanderSlice,
  dequeueMessage,
  editQueuedMessage,
  enqueueMessage,
  ensureActiveSession,
  ensureSession,
  finishStreaming,
  loadSessionsFromDB,
  loadSession,
  minimizeCommander,
  newSession,
  removeQueuedMessage,
  setCommanderOpen,
  setContextWindowTokens,
  setMaxOutputTokens,
  setPosition,
  setProviderId,
  setRunResourceBudget,
  setSize,
  startStreaming,
  streamError,
  toggleCommander,
  unassignSessionsFromCanvas,
  upsertFinalizedAssistantMessage,
  type CommanderMessage,
  type CommanderState,
} from './commander.js';

const SESSION_ID = 'session-1';

function withSession(id = SESSION_ID, defaultCanvasId: string | null = null): CommanderState {
  return commanderSlice.reducer(undefined, ensureActiveSession({ id, defaultCanvasId }));
}

function getSession(state: CommanderState, id = SESSION_ID) {
  const session = state.sessions.find((candidate) => candidate.id === id);
  if (!session) throw new Error(`Missing test session: ${id}`);
  return session;
}

function makeFinalized(runId: string, content: string): CommanderMessage {
  return {
    id: `assistant-run-${runId}`,
    role: 'assistant',
    content,
    runMeta: {
      status: 'completed',
      collapsed: true,
      startedAt: 0,
      completedAt: 10,
      summary: { excerpt: content, toolCount: 0, failedToolCount: 0, durationMs: 10 },
    },
    timestamp: 10,
  };
}

function seedWithFinalized(): CommanderState {
  let state = withSession();
  state = commanderSlice.reducer(state, startStreaming(SESSION_ID));
  state = commanderSlice.reducer(
    state,
    appendFinalizedAssistantMessage({
      sessionId: SESSION_ID,
      message: makeFinalized('r-1', 'x'),
      runId: 'r-1',
    }),
  );
  expect(getSession(state).runtime.finalizedRunIds).toEqual(['r-1']);
  return state;
}

describe('commander slice', () => {
  it('moves every chat from a permanently deleted Canvas to Unassigned', () => {
    let state = withSession('session-a', 'canvas-a');
    state = commanderSlice.reducer(
      state,
      ensureSession({ id: 'session-b', defaultCanvasId: 'canvas-a' }),
    );
    state = commanderSlice.reducer(
      state,
      ensureSession({ id: 'session-c', defaultCanvasId: 'canvas-b' }),
    );

    state = commanderSlice.reducer(state, unassignSessionsFromCanvas('canvas-a'));

    expect(getSession(state, 'session-a').defaultCanvasId).toBeNull();
    expect(getSession(state, 'session-b').defaultCanvasId).toBeNull();
    expect(getSession(state, 'session-c').defaultCanvasId).toBe('canvas-b');
  });

  it('consumes a large per-session queue with amortized cursor advancement', () => {
    const queued = Array.from({ length: 10_000 }, (_, index) => ({
      id: `queue-${index}`,
      content: `message-${index}`,
    }));
    let state = withSession();
    state = {
      ...state,
      sessions: state.sessions.map((session) =>
        session.id === SESSION_ID
          ? { ...session, runtime: { ...session.runtime, messageQueue: queued } }
          : session,
      ),
    };

    for (let index = 0; index < 64; index += 1) {
      state = commanderSlice.reducer(state, dequeueMessage(SESSION_ID));
    }

    let runtime = getSession(state).runtime;
    expect(runtime.messageQueueCursor).toBe(64);
    expect(runtime.messageQueue).toHaveLength(10_000);
    expect(runtime.messageQueue[runtime.messageQueueCursor]?.content).toBe('message-64');

    state = commanderSlice.reducer(
      state,
      editQueuedMessage({ sessionId: SESSION_ID, index: 0, content: 'edited-message-64' }),
    );
    state = commanderSlice.reducer(state, removeQueuedMessage({ sessionId: SESSION_ID, index: 1 }));
    runtime = getSession(state).runtime;
    expect(
      runtime.messageQueue
        .slice(runtime.messageQueueCursor, runtime.messageQueueCursor + 2)
        .map((item) => item.content),
    ).toEqual(['edited-message-64', 'message-66']);

    state = commanderSlice.reducer(
      state,
      enqueueMessage({ sessionId: SESSION_ID, content: 'message-10000' }),
    );
    expect(getSession(state).runtime.messageQueue.at(-1)?.content).toBe('message-10000');
  });

  it('keeps the context window and output limits independent', () => {
    let state = commanderSlice.reducer(undefined, setContextWindowTokens(1_000_000));
    state = commanderSlice.reducer(state, setMaxOutputTokens(2_048));

    expect(state.contextWindowTokens).toBe(200_000);
    expect(state.maxOutputTokens).toBe(2_048);
  });

  it('stores optional per-run resource limits and preserves explicit zeroes', () => {
    const state = commanderSlice.reducer(
      undefined,
      setRunResourceBudget({
        maxTokens: 120_000,
        maxToolCalls: 0,
        maxWallTimeMs: 15 * 60_000,
        maxCostUsd: 0,
      }),
    );

    expect(state.resourceBudget).toEqual({
      maxTokens: 120_000,
      maxToolCalls: 0,
      maxWallTimeMs: 15 * 60_000,
      maxCostUsd: 0,
    });
  });

  it('never rewrites a session transcript for local context compaction', () => {
    let state = withSession();
    state = commanderSlice.reducer(
      state,
      addUserMessage({ sessionId: SESSION_ID, content: 'a'.repeat(500_000) }),
    );
    state = commanderSlice.reducer(
      state,
      addUserMessage({ sessionId: SESSION_ID, content: 'b'.repeat(500_000) }),
    );
    const before = getSession(state).messages.map((message) => ({ ...message }));

    const compacted = commanderSlice.reducer(state, compactLocalContext());

    expect(getSession(compacted).messages).toEqual(before);
  });

  it('toggleCommander and setCommanderOpen update open state', () => {
    let state = commanderSlice.reducer(undefined, toggleCommander());
    expect(state.open).toBe(true);

    state = commanderSlice.reducer(state, setCommanderOpen(false));
    expect(state.open).toBe(false);
  });

  it('adds a user turn to only its session and restores the panel', () => {
    let state = withSession();
    state = commanderSlice.reducer(state, toggleCommander());
    state = commanderSlice.reducer(state, minimizeCommander());
    state = commanderSlice.reducer(state, addUserMessage({ sessionId: SESSION_ID, content: 'hi' }));

    expect(state.open).toBe(true);
    expect(state.minimized).toBe(false);
    expect(getSession(state).messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'hi' }),
    ]);
  });

  it('starts streaming for only the addressed session', () => {
    let state = withSession();
    state = commanderSlice.reducer(state, minimizeCommander());
    state = commanderSlice.reducer(state, startStreaming(SESSION_ID));

    expect(state.open).toBe(true);
    expect(state.minimized).toBe(false);
    expect(getSession(state).runtime.phase.kind).not.toBe('idle');
  });

  it('deduplicates finalized assistant messages within one session', () => {
    let state = withSession();
    const first = makeFinalized('run-1', 'first');
    state = commanderSlice.reducer(
      state,
      appendFinalizedAssistantMessage({ sessionId: SESSION_ID, message: first, runId: 'run-1' }),
    );
    state = commanderSlice.reducer(
      state,
      appendFinalizedAssistantMessage({
        sessionId: SESSION_ID,
        message: makeFinalized('run-1', 'second'),
        runId: 'run-1',
      }),
    );

    expect(getSession(state).messages).toEqual([first]);
    expect(getSession(state).runtime.finalizedRunIds).toEqual(['run-1']);
  });

  it('upserts a finalized message without changing transcript order', () => {
    let state = withSession();
    state = commanderSlice.reducer(state, addUserMessage({ sessionId: SESSION_ID, content: 'u1' }));
    state = commanderSlice.reducer(
      state,
      appendFinalizedAssistantMessage({
        sessionId: SESSION_ID,
        message: makeFinalized('run-1', 'first'),
        runId: 'run-1',
      }),
    );
    state = commanderSlice.reducer(state, addUserMessage({ sessionId: SESSION_ID, content: 'u2' }));
    state = commanderSlice.reducer(
      state,
      upsertFinalizedAssistantMessage({
        sessionId: SESSION_ID,
        message: makeFinalized('run-1', 'second'),
        runId: 'run-1',
      }),
    );

    expect(getSession(state).messages.map((message) => message.content)).toEqual([
      'u1',
      'second',
      'u2',
    ]);
  });

  it('keeps an existing session runtime isolated when a new chat is created', () => {
    const seeded = seedWithFinalized();
    const state = commanderSlice.reducer(seeded, newSession(null));

    expect(getSession(state).runtime.finalizedRunIds).toEqual(['r-1']);
    const active = state.sessions.find((session) => session.id === state.activeSessionId);
    expect(active?.id).not.toBe(SESSION_ID);
    expect(active?.runtime.finalizedRunIds).toEqual([]);
  });

  it('never evicts active background sessions when enforcing the local history limit', () => {
    let state = withSession('running-session');
    state = commanderSlice.reducer(state, startStreaming('running-session'));
    state = commanderSlice.reducer(
      state,
      ensureActiveSession({ id: 'foreground-session', defaultCanvasId: null }),
    );

    for (let index = 0; index < 60; index += 1) {
      state = commanderSlice.reducer(
        state,
        ensureSession({ id: `idle-${index}`, defaultCanvasId: null }),
      );
    }

    expect(getSession(state, 'running-session').runtime.phase.kind).not.toBe('idle');
    expect(state.activeSessionId).toBe('foreground-session');
    expect(state.sessions).toHaveLength(50);

    const dbSessions = Array.from({ length: 60 }, (_, index) => ({
      ...getSession(state, 'idle-59'),
      id: `db-${index}`,
      title: `DB ${index}`,
      createdAt: 100 + index,
      updatedAt: 100 + index,
    }));
    state = commanderSlice.reducer(state, loadSessionsFromDB(dbSessions));

    expect(getSession(state, 'running-session').runtime.phase.kind).not.toBe('idle');
    expect(state.sessions).toHaveLength(50);
  });

  it('clears only the addressed session history and runtime', () => {
    const state = commanderSlice.reducer(seedWithFinalized(), clearHistory(SESSION_ID));

    expect(getSession(state).messages).toEqual([]);
    expect(getSession(state).runtime.finalizedRunIds).toEqual([]);
  });

  it('selecting a different chat does not reset the previous chat runtime', () => {
    let state = seedWithFinalized();
    state = commanderSlice.reducer(
      state,
      ensureActiveSession({ id: 'session-2', defaultCanvasId: 'canvas-2' }),
    );
    state = commanderSlice.reducer(state, loadSession({ id: 'session-2' }));

    expect(state.activeSessionId).toBe('session-2');
    expect(getSession(state).runtime.finalizedRunIds).toEqual(['r-1']);
  });

  it('keeps a complete local transcript when its SQLite summary has the same timestamp', () => {
    let state = withSession();
    state = commanderSlice.reducer(
      state,
      addUserMessage({ sessionId: SESSION_ID, content: 'kept locally' }),
    );
    const local = getSession(state);
    state = commanderSlice.reducer(
      state,
      loadSessionsFromDB([{ ...local, messages: [], messageCount: local.messageCount }]),
    );

    expect(getSession(state).messages.map((message) => message.content)).toEqual(['kept locally']);
  });

  it('records a stream error and pending injected messages in the owning session', () => {
    let state = withSession();
    state = commanderSlice.reducer(
      state,
      addUserMessage({ sessionId: SESSION_ID, content: 'hello' }),
    );
    state = commanderSlice.reducer(state, startStreaming(SESSION_ID));
    state = commanderSlice.reducer(
      state,
      addInjectedMessage({ sessionId: SESSION_ID, content: 'mid' }),
    );
    state = commanderSlice.reducer(state, streamError({ sessionId: SESSION_ID, error: 'boom' }));

    const session = getSession(state);
    expect(session.runtime.error).toBe('boom');
    expect(session.runtime.phase.kind).toBe('idle');
    expect(session.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'hello'],
      ['assistant', 'boom'],
      ['user', 'mid'],
    ]);
    expect(session.messages[1]?.runMeta?.status).toBe('failed');
    expect(session.runtime.pendingInjectedMessages).toEqual([]);
  });

  it('finishes only one session and commits its injected messages', () => {
    let state = withSession();
    state = commanderSlice.reducer(state, startStreaming(SESSION_ID));
    state = commanderSlice.reducer(
      state,
      addInjectedMessage({ sessionId: SESSION_ID, content: 'inject-1' }),
    );
    state = commanderSlice.reducer(state, finishStreaming(SESSION_ID));

    const session = getSession(state);
    expect(session.runtime.phase.kind).toBe('idle');
    expect(session.runtime.currentRunStartedAt).toBeNull();
    expect(session.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'inject-1' }),
    ]);
  });

  it('setPosition and setSize update panel geometry', () => {
    let state = commanderSlice.reducer(undefined, setPosition({ x: 100, y: 120 }));
    state = commanderSlice.reducer(state, setSize({ width: 480, height: 640 }));
    expect(state.position).toEqual({ x: 100, y: 120 });
    expect(state.size).toEqual({ width: 480, height: 640 });
  });

  it('stores the commander-selected provider independently from settings', () => {
    const state = commanderSlice.reducer(undefined, setProviderId('claude'));
    expect(state.providerId).toBe('claude');
  });

  describe('toggleCommander state machine', () => {
    it('opens a closed panel', () => {
      const state = commanderSlice.reducer(undefined, toggleCommander());
      expect(state.open).toBe(true);
      expect(state.minimized).toBe(false);
    });

    it('closes an open minimized panel', () => {
      let state = commanderSlice.reducer(undefined, toggleCommander());
      state = commanderSlice.reducer(state, minimizeCommander());
      state = commanderSlice.reducer(state, toggleCommander());
      expect(state.open).toBe(false);
      expect(state.minimized).toBe(false);
    });
  });
});
