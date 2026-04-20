import { describe, expect, it, vi } from 'vitest';
import { CommanderSessionService } from './CommanderSessionService.js';
import { CommanderTransport } from '../transport/CommanderTransport.js';
import type { AppDispatch, RootState } from '../../store/index.js';

/**
 * Minimal stub of the commander bridge the transport expects. Only the
 * methods the tests exercise are implemented; the rest throw if touched.
 */
function makeStubCommander() {
  const streamListeners: Array<(p: unknown) => void> = [];
  return {
    chat: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    injectMessage: vi.fn(async () => undefined),
    confirmTool: vi.fn(async () => undefined),
    answerQuestion: vi.fn(async () => undefined),
    onStream: vi.fn((cb: (p: unknown) => void) => {
      streamListeners.push(cb);
      return () => {
        const idx = streamListeners.indexOf(cb);
        if (idx >= 0) streamListeners.splice(idx, 1);
      };
    }),
    onCanvasUpdated: vi.fn(() => () => {}),
    onEntitiesUpdated: vi.fn(() => () => {}),
    onSettingsDispatch: vi.fn(() => () => {}),
    onUndoDispatch: vi.fn(() => () => {}),
    emitStream: (payload: unknown) => {
      for (const cb of streamListeners) cb(payload);
    },
  };
}

function makeService(state: Partial<RootState> = {}) {
  const commander = makeStubCommander();
  const transport = new CommanderTransport(commander as never);
  const dispatch = vi.fn() as unknown as AppDispatch;
  const getState = () =>
    ({
      commander: {
        messages: [],
        streaming: false,
        activeSessionId: null,
        activeCanvasId: null,
        sessions: [],
        confirmAutoMode: 'none',
        permissionMode: 'normal',
        providerId: null,
        maxSteps: 50,
        temperature: 0.7,
        maxTokens: 200000,
      },
      canvas: { activeCanvasId: null, canvases: { entities: {} }, selectedNodeIds: [] },
      settings: { bootstrapped: true, llm: { providers: [] }, image: {}, video: {}, audio: {} },
      promptTemplates: { templates: [] },
      workflowDefinitions: { entries: [] },
      ...state,
    }) as RootState;

  const service = new CommanderSessionService({
    transport,
    api: { commander } as never,
    dispatch,
    getState,
    t: (k) => k,
    getLocale: () => 'en',
  });
  return { service, dispatch, commander };
}

describe('CommanderSessionService', () => {
  it('subscribe wires up all push-channel listeners and returns a disposable', () => {
    const { service, commander } = makeService();
    const unsub = service.subscribe();
    expect(commander.onStream).toHaveBeenCalledOnce();
    expect(commander.onCanvasUpdated).toHaveBeenCalledOnce();
    expect(commander.onEntitiesUpdated).toHaveBeenCalledOnce();
    expect(commander.onSettingsDispatch).toHaveBeenCalledOnce();
    expect(commander.onUndoDispatch).toHaveBeenCalledOnce();
    expect(typeof unsub).toBe('function');
  });

  it('routes chunk stream events through dispatch (coalesced via BatchedDispatcher)', () => {
    vi.useFakeTimers();
    try {
      const { service, dispatch, commander } = makeService();
      service.subscribe();
      commander.emitStream({ kind: 'chunk', content: 'hi', runId: 'r1', step: 1, emittedAt: 0 });
      vi.advanceTimersByTime(60);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'commander/appendStreamChunk', payload: 'hi' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes tool_call_started stream events', () => {
    const { service, dispatch, commander } = makeService();
    service.subscribe();
    commander.emitStream({
      kind: 'tool_call_started',
      toolName: 'canvas.getNode',
      toolCallId: 'tc1',
      startedAt: 0,
      runId: 'r1',
      step: 1,
      emittedAt: 0,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'commander/addToolCall',
        payload: expect.objectContaining({
          name: 'canvas.getNode',
          id: 'tc1',
        }),
      }),
    );
  });

  it('routes tool_call_args_complete to updateToolCallArguments', () => {
    const { service, dispatch, commander } = makeService();
    service.subscribe();
    commander.emitStream({
      kind: 'tool_call_args_complete',
      toolCallId: 'tc1',
      arguments: { id: 'n1' },
      runId: 'r1',
      step: 1,
      emittedAt: 0,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'commander/updateToolCallArguments',
        payload: expect.objectContaining({
          id: 'tc1',
          arguments: { id: 'n1' },
        }),
      }),
    );
  });

  it('emits finishStreaming on a done event', () => {
    const { service, dispatch, commander } = makeService();
    service.subscribe();
    commander.emitStream({ kind: 'done', content: 'bye', runId: 'r1', step: 1, emittedAt: 0 });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'commander/finishStreaming', payload: 'bye' }),
    );
  });

  it('cancel finalizes streaming locally even when the main-process session throws', async () => {
    const { service, dispatch, commander } = makeService({
      canvas: { activeCanvasId: 'canvas-1' } as never,
    });
    commander.cancel.mockRejectedValueOnce(new Error('already gone'));
    await service.cancel();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'commander/finishStreaming', payload: undefined }),
    );
    expect(commander.cancel).toHaveBeenCalledWith('canvas-1');
  });

  it('start rejects with a backend-not-ready error when settings are unbootstrapped', async () => {
    const { service, dispatch } = makeService({
      settings: { bootstrapped: false } as never,
    });
    await service.start('hello');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'commander/streamError' }),
    );
  });
});
