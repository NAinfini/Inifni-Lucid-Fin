import { describe, expect, it } from 'vitest';
import {
  addUserMessage,
  addInjectedMessage,
  appendFinalizedAssistantMessage,
  clearHistory,
  commanderSlice,
  finishStreaming,
  loadSession,
  minimizeCommander,
  newSession,
  resolveQuestion,
  setCommanderOpen,
  setPendingQuestion,
  setProviderId,
  setPosition,
  setSize,
  startStreaming,
  streamError,
  switchCanvas,
  toggleCommander,
  upsertFinalizedAssistantMessage,
  type CommanderMessage,
  type CommanderState,
} from './commander.js';

function makeFinalized(runId: string, content: string): CommanderMessage {
  return {
    id: 'assistant-run-' + runId,
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

describe('commander slice', () => {
  it('toggleCommander and setCommanderOpen update open state', () => {
    let state = commanderSlice.reducer(undefined, toggleCommander());
    expect(state.open).toBe(true);

    state = commanderSlice.reducer(state, setCommanderOpen(false));
    expect(state.open).toBe(false);
  });

  it('addUserMessage appends a user turn and forces the panel open', () => {
    let state = commanderSlice.reducer(undefined, toggleCommander());
    state = commanderSlice.reducer(state, minimizeCommander());
    state = commanderSlice.reducer(state, addUserMessage('hi'));
    expect(state.open).toBe(true);
    expect(state.minimized).toBe(false);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: 'user', content: 'hi' });
  });

  it('startStreaming forces open and unminimized', () => {
    let state = commanderSlice.reducer(undefined, toggleCommander());
    state = commanderSlice.reducer(state, minimizeCommander());
    state = commanderSlice.reducer(state, startStreaming());
    expect(state.open).toBe(true);
    expect(state.minimized).toBe(false);
    expect(state.phase.kind).not.toBe('idle');
  });

  describe('appendFinalizedAssistantMessage', () => {
    it('pushes message and records runId in finalizedRunIds', () => {
      let state = commanderSlice.reducer(undefined, startStreaming());
      const msg = makeFinalized('run-1', 'done');
      state = commanderSlice.reducer(
        state,
        appendFinalizedAssistantMessage({ message: msg, runId: 'run-1' }),
      );
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].id).toBe('assistant-run-run-1');
      expect(state.finalizedRunIds).toEqual(['run-1']);
    });

    it('is a no-op when runId already in finalizedRunIds (dedup)', () => {
      let state = commanderSlice.reducer(undefined, startStreaming());
      const msg = makeFinalized('run-1', 'first');
      state = commanderSlice.reducer(
        state,
        appendFinalizedAssistantMessage({ message: msg, runId: 'run-1' }),
      );
      const second = makeFinalized('run-1', 'second');
      state = commanderSlice.reducer(
        state,
        appendFinalizedAssistantMessage({ message: second, runId: 'run-1' }),
      );
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].content).toBe('first');
    });
  });

  describe('upsertFinalizedAssistantMessage', () => {
    it('replaces an existing message with matching id (preserves position)', () => {
      let state = commanderSlice.reducer(undefined, addUserMessage('u1'));
      const first = makeFinalized('run-1', 'first');
      state = commanderSlice.reducer(
        state,
        appendFinalizedAssistantMessage({ message: first, runId: 'run-1' }),
      );
      state = commanderSlice.reducer(state, addUserMessage('u2'));

      const second = makeFinalized('run-1', 'second');
      state = commanderSlice.reducer(
        state,
        upsertFinalizedAssistantMessage({ message: second, runId: 'run-1' }),
      );

      expect(state.messages).toHaveLength(3);
      expect(state.messages[1].content).toBe('second');
      expect(state.messages[2].content).toBe('u2');
    });

    it('appends if no existing message has the matching id', () => {
      let state = commanderSlice.reducer(undefined, addUserMessage('u1'));
      const msg = makeFinalized('run-42', 'late');
      state = commanderSlice.reducer(
        state,
        upsertFinalizedAssistantMessage({ message: msg, runId: 'run-42' }),
      );
      expect(state.messages).toHaveLength(2);
      expect(state.messages[1].id).toBe('assistant-run-run-42');
      expect(state.finalizedRunIds).toContain('run-42');
    });
  });

  describe('finalizedRunIds lifecycle', () => {
    function seedWithFinalized(): CommanderState {
      let state = commanderSlice.reducer(undefined, startStreaming());
      const msg = makeFinalized('r-1', 'x');
      state = commanderSlice.reducer(
        state,
        appendFinalizedAssistantMessage({ message: msg, runId: 'r-1' }),
      );
      expect(state.finalizedRunIds).toEqual(['r-1']);
      return state;
    }

    it('is cleared by newSession', () => {
      const state = commanderSlice.reducer(seedWithFinalized(), newSession());
      expect(state.finalizedRunIds).toEqual([]);
    });

    it('is cleared by clearHistory', () => {
      const state = commanderSlice.reducer(seedWithFinalized(), clearHistory());
      expect(state.finalizedRunIds).toEqual([]);
    });

    it('is cleared by loadSession', () => {
      let state = seedWithFinalized();
      // add a fake session to load
      state = {
        ...state,
        sessions: [
          {
            id: 'sess-1',
            canvasId: null,
            title: 'x',
            messages: [],
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      };
      state = commanderSlice.reducer(state, loadSession({ id: 'sess-1' }));
      expect(state.finalizedRunIds).toEqual([]);
    });

    it('is cleared by switchCanvas', () => {
      const state = commanderSlice.reducer(seedWithFinalized(), switchCanvas('canvas-new'));
      expect(state.finalizedRunIds).toEqual([]);
    });

    it('is cleared by restore', () => {
      const seeded = seedWithFinalized();
      // simulate an old persisted payload with stale transient fields
      const payload = {
        ...seeded,
        finalizedRunIds: ['leftover'],
        currentStreamContent: 'stale',
        currentToolCalls: [],
        currentSegments: [],
      } as unknown as CommanderState;
      const state = commanderSlice.reducer(seeded, {
        type: 'commander/restore',
        payload,
      });
      expect(state.finalizedRunIds).toEqual([]);
      expect((state as unknown as Record<string, unknown>).currentStreamContent).toBeUndefined();
    });
  });

  describe('streamError', () => {
    it('pushes a failed assistant message with minimal shape (D4)', () => {
      let state = commanderSlice.reducer(undefined, addUserMessage('hello'));
      state = commanderSlice.reducer(state, startStreaming());
      state = commanderSlice.reducer(state, streamError('boom'));

      expect(state.error).toBe('boom');
      expect(state.phase.kind).toBe('idle');
      expect(state.messages).toHaveLength(2);
      const errMsg = state.messages[1];
      expect(errMsg.role).toBe('assistant');
      expect(errMsg.content).toBe('boom');
      expect(errMsg.runMeta?.status).toBe('failed');
      // No segments / toolCalls on the minimal streamError message.
      expect(errMsg.segments).toBeUndefined();
      expect(errMsg.toolCalls).toBeUndefined();

      state = commanderSlice.reducer(state, clearHistory());
      expect(state.messages).toEqual([]);
    });

    it('commits pending injected messages before resetting transient state', () => {
      let state = commanderSlice.reducer(undefined, addUserMessage('hello'));
      state = commanderSlice.reducer(state, startStreaming());
      state = commanderSlice.reducer(state, addInjectedMessage('mid'));
      state = commanderSlice.reducer(state, streamError('boom'));
      const userMsgs = state.messages.filter((m) => m.role === 'user');
      expect(userMsgs).toHaveLength(2);
      expect(userMsgs[1].content).toBe('mid');
      expect(state.pendingInjectedMessages).toHaveLength(0);
    });
  });

  describe('finishStreaming', () => {
    it('takes no payload and resets transient run state', () => {
      let state = commanderSlice.reducer(undefined, startStreaming());
      state = commanderSlice.reducer(state, finishStreaming());
      expect(state.phase.kind).toBe('idle');
      expect(state.currentRunStartedAt).toBeNull();
    });

    it('commits pending injected messages', () => {
      let state = commanderSlice.reducer(undefined, startStreaming());
      state = commanderSlice.reducer(state, addInjectedMessage('inject-1'));
      state = commanderSlice.reducer(state, finishStreaming());
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toMatchObject({ role: 'user', content: 'inject-1' });
      expect(state.pendingInjectedMessages).toHaveLength(0);
    });
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

  it('resolveQuestion stores structured question history before the user answer', () => {
    let state = commanderSlice.reducer(
      undefined,
      setPendingQuestion({
        toolCallId: 'q-1',
        question: 'Which one?',
        options: [
          { label: 'A', description: 'first' },
          { label: 'B', description: 'second' },
        ],
      }),
    );
    state = commanderSlice.reducer(state, resolveQuestion({ answer: 'A' }));
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].role).toBe('assistant');
    expect(state.messages[0].questionMeta).toEqual({
      question: 'Which one?',
      options: [
        { label: 'A', description: 'first' },
        { label: 'B', description: 'second' },
      ],
    });
    expect(state.messages[1]).toMatchObject({ role: 'user', content: 'A' });
    expect(state.pendingQuestion).toBeNull();
  });

  describe('toggleCommander state machine', () => {
    it('closed → opens', () => {
      const state = commanderSlice.reducer(undefined, toggleCommander());
      expect(state.open).toBe(true);
      expect(state.minimized).toBe(false);
    });

    it('open minimized → closes (not restores)', () => {
      let state = commanderSlice.reducer(undefined, toggleCommander());
      state = commanderSlice.reducer(state, minimizeCommander());
      state = commanderSlice.reducer(state, toggleCommander());
      expect(state.open).toBe(false);
      expect(state.minimized).toBe(false);
    });
  });
});
