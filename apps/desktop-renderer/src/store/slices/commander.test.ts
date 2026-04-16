import { describe, expect, it, vi } from 'vitest';
import {
  addToolCall,
  addUserMessage,
  addInjectedMessage,
  appendStreamChunk,
  clearHistory,
  commanderSlice,
  finishStreaming,
  minimizeCommander,
  resolveQuestion,
  resolveToolCall,
  setCommanderOpen,
  setPendingQuestion,
  setProviderId,
  setPosition,
  setSize,
  startStreaming,
  streamError,
  toggleCommander,
} from './commander.js';

describe('commander slice', () => {
  it('toggleCommander and setCommanderOpen update open state', () => {
    let state = commanderSlice.reducer(undefined, toggleCommander());
    expect(state.open).toBe(true);

    state = commanderSlice.reducer(state, setCommanderOpen(false));
    expect(state.open).toBe(false);
  });

  it('addUserMessage, startStreaming, appendStreamChunk, and finishStreaming create assistant message', () => {
    let state = commanderSlice.reducer(undefined, addUserMessage('hello'));
    state = commanderSlice.reducer(state, startStreaming());
    state = commanderSlice.reducer(state, appendStreamChunk('part 1'));
    state = commanderSlice.reducer(state, appendStreamChunk(' + part 2'));
    state = commanderSlice.reducer(state, finishStreaming());

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toEqual(expect.objectContaining({ role: 'user', content: 'hello' }));
    expect(state.messages[1]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content: 'part 1 + part 2',
      }),
    );
    expect(state.streaming).toBe(false);
  });

  it('addToolCall and resolveToolCall manage pending tool calls', () => {
    let state = commanderSlice.reducer(undefined, startStreaming());
    state = commanderSlice.reducer(
      state,
      addToolCall({
        name: 'canvas.addNode',
        id: 'tool-1',
        arguments: { type: 'text' },
      }),
    );
    state = commanderSlice.reducer(
      state,
      resolveToolCall({
        id: 'tool-1',
        result: { success: true },
      }),
    );
    state = commanderSlice.reducer(state, finishStreaming());

    expect(state.messages[0].toolCalls).toEqual([
      expect.objectContaining({
        id: 'tool-1',
        name: 'canvas.addNode',
        status: 'done',
        result: { success: true },
      }),
    ]);
  });

  it('preserves event-provided tool timing data for elapsed display', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(9999);

    let state = commanderSlice.reducer(undefined, startStreaming());
    state = commanderSlice.reducer(
      state,
      addToolCall({
        name: 'canvas.listNodes',
        id: 'tool-timing',
        arguments: {},
        startedAt: 1000,
      } as never),
    );
    state = commanderSlice.reducer(
      state,
      resolveToolCall({
        id: 'tool-timing',
        result: { success: true },
        completedAt: 2600,
      } as never),
    );
    state = commanderSlice.reducer(state, finishStreaming());

    expect(state.messages[0].toolCalls).toEqual([
      expect.objectContaining({
        id: 'tool-timing',
        startedAt: 1000,
        completedAt: 2600,
      }),
    ]);

    nowSpy.mockRestore();
  });

  it('streamError clears streaming state and persists error as message', () => {
    let state = commanderSlice.reducer(undefined, addUserMessage('hello'));
    state = commanderSlice.reducer(state, startStreaming());
    state = commanderSlice.reducer(state, streamError('boom'));

    expect(state.error).toBe('boom');
    expect(state.streaming).toBe(false);
    // Error is persisted as an assistant message
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].role).toBe('assistant');
    expect(state.messages[1].content).toContain('boom');

    state = commanderSlice.reducer(state, clearHistory());
    expect(state.messages).toEqual([]);
    expect(state.error).toBeNull();
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
    it('closed → opens (open=false, minimized=false)', () => {
      const state = commanderSlice.reducer(undefined, toggleCommander());
      expect(state.open).toBe(true);
      expect(state.minimized).toBe(false);
    });

    it('open normal → closes (open=true, minimized=false)', () => {
      let state = commanderSlice.reducer(undefined, toggleCommander());
      state = commanderSlice.reducer(state, toggleCommander());
      expect(state.open).toBe(false);
      expect(state.minimized).toBe(false);
    });

    it('open minimized → closes, not just restores (open=true, minimized=true)', () => {
      let state = commanderSlice.reducer(undefined, toggleCommander()); // open
      state = commanderSlice.reducer(state, minimizeCommander()); // minimize
      expect(state.open).toBe(true);
      expect(state.minimized).toBe(true);
      // toolbar toggle while minimized should CLOSE, not just restore
      state = commanderSlice.reducer(state, toggleCommander());
      expect(state.open).toBe(false);
      expect(state.minimized).toBe(false);
    });

    it('close → reopen works correctly', () => {
      let state = commanderSlice.reducer(undefined, toggleCommander()); // open
      state = commanderSlice.reducer(state, toggleCommander()); // close
      state = commanderSlice.reducer(state, toggleCommander()); // reopen
      expect(state.open).toBe(true);
      expect(state.minimized).toBe(false);
    });
  });

  describe('setCommanderOpen', () => {
    it('always clears minimized regardless of value', () => {
      let state = commanderSlice.reducer(undefined, toggleCommander()); // open
      state = commanderSlice.reducer(state, minimizeCommander()); // minimize
      state = commanderSlice.reducer(state, setCommanderOpen(true));
      expect(state.open).toBe(true);
      expect(state.minimized).toBe(false);
    });
  });

  describe('minimizeCommander', () => {
    it('is a no-op when panel is closed', () => {
      const state = commanderSlice.reducer(undefined, minimizeCommander());
      expect(state.open).toBe(false);
      expect(state.minimized).toBe(false);
    });
  });

  describe('addUserMessage and startStreaming restore from minimized', () => {
    it('addUserMessage forces open and unminimized', () => {
      let state = commanderSlice.reducer(undefined, toggleCommander());
      state = commanderSlice.reducer(state, minimizeCommander());
      state = commanderSlice.reducer(state, addUserMessage('hi'));
      expect(state.open).toBe(true);
      expect(state.minimized).toBe(false);
    });

    it('startStreaming forces open and unminimized', () => {
      let state = commanderSlice.reducer(undefined, toggleCommander());
      state = commanderSlice.reducer(state, minimizeCommander());
      state = commanderSlice.reducer(state, startStreaming());
      expect(state.open).toBe(true);
      expect(state.minimized).toBe(false);
    });
  });

  describe('addInjectedMessage during streaming', () => {
    it('queues messages that are committed after finishStreaming', () => {
      let state = commanderSlice.reducer(undefined, addUserMessage('hello'));
      state = commanderSlice.reducer(state, startStreaming());
      state = commanderSlice.reducer(state, appendStreamChunk('AI reply'));
      // User injects messages during streaming
      state = commanderSlice.reducer(state, addInjectedMessage('followup 1'));
      state = commanderSlice.reducer(state, addInjectedMessage('followup 2'));

      // Pending messages are stored separately, not in messages[]
      expect(state.pendingInjectedMessages).toHaveLength(2);
      expect(state.messages).toHaveLength(1); // only the initial user message

      state = commanderSlice.reducer(state, finishStreaming());

      // After finish: assistant message + both injected user messages committed
      expect(state.messages).toHaveLength(4);
      expect(state.messages[0]).toEqual(expect.objectContaining({ role: 'user', content: 'hello' }));
      expect(state.messages[1]).toEqual(expect.objectContaining({ role: 'assistant', content: 'AI reply' }));
      expect(state.messages[2]).toEqual(expect.objectContaining({ role: 'user', content: 'followup 1' }));
      expect(state.messages[3]).toEqual(expect.objectContaining({ role: 'user', content: 'followup 2' }));
      expect(state.pendingInjectedMessages).toHaveLength(0);
    });

    it('commits injected messages on streamError too', () => {
      let state = commanderSlice.reducer(undefined, addUserMessage('hello'));
      state = commanderSlice.reducer(state, startStreaming());
      state = commanderSlice.reducer(state, addInjectedMessage('mid-stream'));
      state = commanderSlice.reducer(state, streamError('something broke'));

      // user msg + injected user msg + error msg
      const userMsgs = state.messages.filter((m) => m.role === 'user');
      expect(userMsgs).toHaveLength(2);
      expect(userMsgs[1].content).toBe('mid-stream');
      expect(state.pendingInjectedMessages).toHaveLength(0);
    });
  });

  it('resolveQuestion stores structured question history before the user answer', () => {
    let state = commanderSlice.reducer(
      undefined,
      setPendingQuestion({
        toolCallId: 'question-1',
        question: 'Which direction should we use?',
        options: [
          { label: 'Campus Yuri', description: 'Light and gentle' },
          { label: 'Urban Yuri', description: 'Adult and restrained' },
        ],
      }),
    );

    state = commanderSlice.reducer(state, resolveQuestion({ answer: 'Campus Yuri' }));

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content:
          'Which direction should we use?\n\n- Campus Yuri: Light and gentle\n- Urban Yuri: Adult and restrained',
      }),
    );
    expect(
      (state.messages[0] as {
        questionMeta?: {
          question: string;
          options: Array<{ label: string; description?: string }>;
        };
      }).questionMeta,
    ).toEqual({
      question: 'Which direction should we use?',
      options: [
        { label: 'Campus Yuri', description: 'Light and gentle' },
        { label: 'Urban Yuri', description: 'Adult and restrained' },
      ],
    });
    expect(state.messages[1]).toEqual(expect.objectContaining({ role: 'user', content: 'Campus Yuri' }));
    expect(state.pendingQuestion).toBeNull();
  });
});
