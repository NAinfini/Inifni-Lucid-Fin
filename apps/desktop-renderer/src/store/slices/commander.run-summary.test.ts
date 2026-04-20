import { describe, expect, it, vi } from 'vitest';
import {
  addToolCall,
  appendStreamChunk,
  appendThinking,
  commanderSlice,
  finishStreaming,
  resolveQuestion,
  resolveToolCall,
  setPendingQuestion,
  startStreaming,
  streamError,
} from './commander.js';

describe('commander run summaries', () => {
  it('stores compact run metadata for completed assistant runs', () => {
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2400);

    let state = commanderSlice.reducer(undefined, startStreaming());
    state = commanderSlice.reducer(state, appendThinking('Planning tool sequence'));
    state = commanderSlice.reducer(state, appendStreamChunk('Created the requested layout and verified the nodes.'));
    state = commanderSlice.reducer(
      state,
      addToolCall({
        id: 'tool-1',
        name: 'canvas.createNode',
        arguments: { type: 'image' },
        startedAt: 1200,
      }),
    );
    state = commanderSlice.reducer(
      state,
      resolveToolCall({
        id: 'tool-1',
        result: { success: true, data: { id: 'node-1' } },
        completedAt: 1800,
      }),
    );
    state = commanderSlice.reducer(state, finishStreaming(undefined));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        runMeta: expect.objectContaining({
          status: 'completed',
          collapsed: true,
          startedAt: 1000,
          completedAt: 2400,
          summary: expect.objectContaining({
            toolCount: 1,
            failedToolCount: 0,
            durationMs: 1400,
          }),
        }),
      }),
    );
    // Thinking is now a first-class segment on the finalized message.
    expect(state.messages[0].segments?.some((seg) => seg.kind === 'thinking')).toBe(true);

    nowSpy.mockRestore();
  });

  it('stores failed run metadata when streaming aborts', () => {
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(5000)
      .mockReturnValueOnce(5000)
      .mockReturnValueOnce(6500);

    let state = commanderSlice.reducer(undefined, startStreaming());
    state = commanderSlice.reducer(state, appendStreamChunk('Tried to update the canvas.'));
    state = commanderSlice.reducer(
      state,
      addToolCall({
        id: 'tool-2',
        name: 'canvas.updateNode',
        arguments: { id: 'node-1' },
        startedAt: 5200,
      }),
    );
    state = commanderSlice.reducer(
      state,
      resolveToolCall({
        id: 'tool-2',
        error: 'Node not found',
        completedAt: 6000,
      }),
    );
    state = commanderSlice.reducer(state, streamError('Node not found'));

    expect(state.messages[0]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        runMeta: expect.objectContaining({
          status: 'failed',
          collapsed: true,
          startedAt: 5000,
          completedAt: 6500,
          summary: expect.objectContaining({
            toolCount: 1,
            failedToolCount: 1,
            durationMs: 1500,
          }),
        }),
      }),
    );

    nowSpy.mockRestore();
  });

  it('stores structured question history for assistant prompts', () => {
    let state = commanderSlice.reducer(
      undefined,
      setPendingQuestion({
        toolCallId: 'tool-3',
        question: 'Choose the render strategy',
        options: [
          { label: 'Fast', description: 'Use the preview preset' },
          { label: 'Quality', description: 'Use the max detail preset' },
        ],
      }),
    );

    state = commanderSlice.reducer(state, resolveQuestion({ answer: 'Quality' }));

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        questionMeta: {
          question: 'Choose the render strategy',
          options: [
            { label: 'Fast', description: 'Use the preview preset' },
            { label: 'Quality', description: 'Use the max detail preset' },
          ],
        },
        content: 'Choose the render strategy\n\n- Fast: Use the preview preset\n- Quality: Use the max detail preset',
      }),
    );
    expect(state.messages[1]).toEqual(
      expect.objectContaining({
        role: 'user',
        content: 'Quality',
      }),
    );
  });

  it('segmentizes text → tool → text into three segments (no bleed across boundaries)', () => {
    let state = commanderSlice.reducer(undefined, startStreaming());
    state = commanderSlice.reducer(state, appendStreamChunk('Plan first.'));
    state = commanderSlice.reducer(
      state,
      addToolCall({
        id: 'tool-a',
        name: 'canvas.createNode',
        arguments: {},
        startedAt: 10,
      }),
    );
    state = commanderSlice.reducer(state, appendStreamChunk('Then answer.'));

    const kinds = state.currentSegments.map((s) => s.kind);
    expect(kinds).toEqual(['text', 'tool', 'text']);
  });

  it('upserts duplicate tool-call dispatches rather than silently dropping the second event', () => {
    let state = commanderSlice.reducer(undefined, startStreaming());
    state = commanderSlice.reducer(
      state,
      addToolCall({
        id: 'tool-dup',
        name: 'canvas.createNode',
        arguments: { draft: true },
        startedAt: 10,
      }),
    );
    // Second dispatch with updated arguments — must merge, not drop.
    state = commanderSlice.reducer(
      state,
      addToolCall({
        id: 'tool-dup',
        name: 'canvas.createNode',
        arguments: { draft: false, id: 'node-42' },
        startedAt: 12,
      }),
    );

    expect(state.currentToolCalls).toHaveLength(1);
    expect(state.currentToolCalls[0].arguments).toEqual({ draft: false, id: 'node-42' });
    expect(state.currentToolCalls[0].startedAt).toBe(12);
  });
});
