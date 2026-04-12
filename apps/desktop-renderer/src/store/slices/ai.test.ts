import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiMessage } from './ai.js';
import {
  addBatchOp,
  addMessage,
  addSuggestion,
  addToolCall,
  aiSlice,
  appendStream,
  clearMessages,
  clearSuggestions,
  clearToolCalls,
  closePopup,
  dismissSuggestion,
  flushStream,
  openPopup,
  removeBatchOp,
  setContext,
  setLoading,
  updateBatchOp,
  updateToolCall,
} from './ai.js';

function makeMessage(overrides: Partial<AiMessage> = {}): AiMessage {
  return {
    id: 'message-1',
    role: 'user',
    content: 'Hello',
    timestamp: 1,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ai slice', () => {
  it('has the expected initial state', () => {
    expect(aiSlice.reducer(undefined, { type: '@@INIT' })).toEqual({
      messages: [],
      loading: false,
      streamBuffer: '',
      contextPage: null,
      contextSceneId: null,
      contextSegmentId: null,
      contextCharacterId: null,
      popupOpen: false,
      popupAnchor: null,
      popupTargetId: null,
      suggestions: [],
      batchOps: [],
      toolCalls: [],
    });
  });

  it('exports action creators with the expected payloads', () => {
    const message = makeMessage();

    expect(addMessage(message)).toMatchObject({ type: 'ai/addMessage', payload: message });
    expect(appendStream('chunk')).toMatchObject({ type: 'ai/appendStream', payload: 'chunk' });
    expect(flushStream()).toMatchObject({ type: 'ai/flushStream' });
    expect(setLoading(true)).toMatchObject({ type: 'ai/setLoading', payload: true });
    expect(setContext({ page: 'storyboard', sceneId: 'scene-1' })).toMatchObject({
      type: 'ai/setContext',
      payload: { page: 'storyboard', sceneId: 'scene-1' },
    });
    expect(clearMessages()).toMatchObject({ type: 'ai/clearMessages' });
    expect(openPopup({ x: 10, y: 20, targetId: 'node-1' })).toMatchObject({
      type: 'ai/openPopup',
      payload: { x: 10, y: 20, targetId: 'node-1' },
    });
    expect(closePopup()).toMatchObject({ type: 'ai/closePopup' });
    expect(
      addSuggestion({
        id: 'suggestion-1',
        type: 'fix',
        title: 'Fix prompt',
        description: 'Needs more detail',
      }),
    ).toMatchObject({
      type: 'ai/addSuggestion',
      payload: {
        id: 'suggestion-1',
        type: 'fix',
        title: 'Fix prompt',
        description: 'Needs more detail',
      },
    });
    expect(dismissSuggestion('suggestion-1')).toMatchObject({
      type: 'ai/dismissSuggestion',
      payload: 'suggestion-1',
    });
    expect(clearSuggestions()).toMatchObject({ type: 'ai/clearSuggestions' });
    expect(
      addBatchOp({
        id: 'batch-1',
        label: 'Generate all',
        targetIds: ['node-1'],
        actionType: 'generate',
        total: 3,
      }),
    ).toMatchObject({
      type: 'ai/addBatchOp',
      payload: {
        id: 'batch-1',
        label: 'Generate all',
        targetIds: ['node-1'],
        actionType: 'generate',
        total: 3,
      },
    });
    expect(updateBatchOp({ id: 'batch-1', status: 'running', progress: 1 })).toMatchObject({
      type: 'ai/updateBatchOp',
      payload: { id: 'batch-1', status: 'running', progress: 1 },
    });
    expect(removeBatchOp('batch-1')).toMatchObject({
      type: 'ai/removeBatchOp',
      payload: 'batch-1',
    });
    expect(
      addToolCall({ id: 'tool-1', name: 'canvas.addNode', arguments: { type: 'text' } }),
    ).toMatchObject({
      type: 'ai/addToolCall',
      payload: { id: 'tool-1', name: 'canvas.addNode', arguments: { type: 'text' } },
    });
    expect(updateToolCall({ id: 'tool-1', status: 'success', result: { ok: true } })).toMatchObject(
      {
        type: 'ai/updateToolCall',
        payload: { id: 'tool-1', status: 'success', result: { ok: true } },
      },
    );
    expect(clearToolCalls()).toMatchObject({ type: 'ai/clearToolCalls' });
  });

  it('adds messages, buffers streams, flushes assistant output, and clears chat state', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    let state = aiSlice.reducer(undefined, addMessage(makeMessage()));
    state = aiSlice.reducer(state, appendStream('Hello'));
    state = aiSlice.reducer(state, appendStream(' world'));
    state = aiSlice.reducer(state, flushStream());
    state = aiSlice.reducer(state, flushStream());
    state = aiSlice.reducer(state, clearMessages());

    expect(state.messages).toEqual([]);
    expect(state.streamBuffer).toBe('');
  });

  it('creates a streamed assistant message with deterministic id and timestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    let state = aiSlice.reducer(undefined, appendStream('Streamed answer'));
    state = aiSlice.reducer(state, flushStream());

    expect(state.messages).toEqual([
      expect.objectContaining({
        id: 'ai-2000',
        role: 'assistant',
        content: 'Streamed answer',
        timestamp: 2000,
      }),
    ]);
    expect(state.streamBuffer).toBe('');
  });

  it('stores loading and clears stale context when the page changes', () => {
    let state = aiSlice.reducer(undefined, setLoading(true));
    state = aiSlice.reducer(
      state,
      setContext({
        page: 'storyboard',
        sceneId: 'scene-1',
        segmentId: 'segment-1',
        characterId: 'character-1',
      }),
    );
    state = aiSlice.reducer(state, setContext({ sceneId: 'scene-2' }));
    state = aiSlice.reducer(
      state,
      setContext({
        page: 'characters',
        characterId: 'character-2',
      }),
    );

    expect(state.loading).toBe(true);
    expect(state.contextPage).toBe('characters');
    expect(state.contextSceneId).toBeNull();
    expect(state.contextSegmentId).toBeNull();
    expect(state.contextCharacterId).toBe('character-2');
  });

  it('opens and closes the inline popup', () => {
    let state = aiSlice.reducer(undefined, openPopup({ x: 12, y: 24, targetId: 'node-1' }));
    state = aiSlice.reducer(state, closePopup());

    expect(state.popupOpen).toBe(false);
    expect(state.popupAnchor).toBeNull();
    expect(state.popupTargetId).toBeNull();
  });

  it('deduplicates suggestions and tracks dismissal state', () => {
    vi.spyOn(Date, 'now').mockReturnValue(3000);
    let state = aiSlice.reducer(
      undefined,
      addSuggestion({
        id: 'suggestion-1',
        type: 'warning',
        title: 'Prompt is vague',
        description: 'Add more scene detail',
      }),
    );
    state = aiSlice.reducer(
      state,
      addSuggestion({
        id: 'suggestion-1',
        type: 'warning',
        title: 'Duplicate',
        description: 'Ignored duplicate',
      }),
    );
    state = aiSlice.reducer(state, dismissSuggestion('suggestion-1'));
    state = aiSlice.reducer(state, dismissSuggestion('missing'));

    expect(state.suggestions).toEqual([
      expect.objectContaining({
        id: 'suggestion-1',
        dismissed: true,
        createdAt: 3000,
      }),
    ]);

    state = aiSlice.reducer(state, clearSuggestions());
    expect(state.suggestions).toEqual([]);
  });

  it('tracks batch operations and tool calls while ignoring missing ids', () => {
    vi.spyOn(Date, 'now').mockReturnValue(4000);
    let state = aiSlice.reducer(
      undefined,
      addBatchOp({
        id: 'batch-1',
        label: 'Generate',
        targetIds: ['node-1', 'node-2'],
        actionType: 'generate',
        total: 2,
      }),
    );
    state = aiSlice.reducer(
      state,
      updateBatchOp({ id: 'batch-1', status: 'running', progress: 1 }),
    );
    state = aiSlice.reducer(
      state,
      updateBatchOp({ id: 'missing', status: 'failed', progress: 99 }),
    );
    state = aiSlice.reducer(
      state,
      addToolCall({ id: 'tool-1', name: 'canvas.addNode', arguments: { type: 'text' } }),
    );
    state = aiSlice.reducer(
      state,
      updateToolCall({
        id: 'tool-1',
        status: 'error',
        error: 'Provider timeout',
      }),
    );
    state = aiSlice.reducer(
      state,
      updateToolCall({
        id: 'missing',
        status: 'success',
      }),
    );

    expect(state.batchOps).toEqual([
      expect.objectContaining({ id: 'batch-1', status: 'running', progress: 1, total: 2 }),
    ]);
    expect(state.toolCalls).toEqual([
      expect.objectContaining({
        id: 'tool-1',
        status: 'error',
        error: 'Provider timeout',
        timestamp: 4000,
      }),
    ]);

    state = aiSlice.reducer(state, removeBatchOp('batch-1'));
    state = aiSlice.reducer(state, removeBatchOp('missing'));
    state = aiSlice.reducer(state, clearToolCalls());

    expect(state.batchOps).toEqual([]);
    expect(state.toolCalls).toEqual([]);
  });
});
