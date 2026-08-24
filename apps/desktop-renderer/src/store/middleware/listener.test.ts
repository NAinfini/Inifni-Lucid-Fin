import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';

import { canvasReducer, setActiveCanvas, setCanvases } from '../slices/canvas/canvas.js';
import {
  commanderSlice,
  ensureActiveSession,
  requestDurableMediaCancellation,
  requestDurableMediaTask,
} from '../slices/commander.js';
import { appendEvent } from '../../commander/state/commander-timeline-slice.js';
import { commanderTimelineSlice } from '../../commander/state/commander-timeline-slice.js';
import { loggerSlice } from '../slices/logger.js';
import { taskListsSlice } from '../slices/task-lists.js';
import { toastSlice } from '../slices/toast.js';
import { getAPI } from '../../utils/api.js';
import { listenerMiddleware } from './listener.js';

vi.mock('../../utils/api.js', () => ({ getAPI: vi.fn() }));

function createCanvas(): Canvas {
  return {
    id: 'canvas-1',
    name: 'Canvas',
    nodes: [
      {
        id: 'node-1',
        type: 'image',
        title: 'Image',
        position: { x: 0, y: 0 },
        bypassed: false,
        locked: false,
        data: { status: 'empty', variants: [], selectedVariantIndex: 0 },
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    edges: [],
    notes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: 1,
    updatedAt: 1,
  };
}

function createStore() {
  const store = configureStore({
    reducer: {
      canvas: canvasReducer,
      commander: commanderSlice.reducer,
      commanderTimeline: commanderTimelineSlice.reducer,
      logger: loggerSlice.reducer,
      taskLists: taskListsSlice.reducer,
      toast: toastSlice.reducer,
    },
    middleware: (defaults) =>
      defaults({ serializableCheck: false, immutableCheck: false }).prepend(
        listenerMiddleware.middleware,
      ),
  });
  store.dispatch(setCanvases([createCanvas()]));
  store.dispatch(setActiveCanvas('canvas-1'));
  return store;
}

describe('durable media Commander request listener', () => {
  afterEach(() => vi.clearAllMocks());

  it('does not queue or send a media request when saving the canvas fails', async () => {
    const save = vi.fn().mockRejectedValue(new Error('disk unavailable'));
    vi.mocked(getAPI).mockReturnValue({ canvas: { save } } as never);
    const store = createStore();

    store.dispatch(
      requestDurableMediaTask({
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        providerId: 'openai-image',
        variantCount: 2,
        seed: 42,
      }),
    );

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    expect(store.getState().commander.open).toBe(false);
    expect(store.getState().commander.sessions).toEqual([]);
  });

  it('creates one Commander session identity before starting its media Task List', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const startMedia = vi.fn().mockResolvedValue({
      taskListId: 'task-list-1',
      promptAssemblyId: 'assembly-1',
    });
    vi.mocked(getAPI).mockReturnValue({
      canvas: { save },
      taskLists: {
        startMedia,
        list: vi.fn().mockResolvedValue([]),
        getTasks: vi.fn().mockResolvedValue([]),
      },
    } as never);
    const store = createStore();

    store.dispatch(
      requestDurableMediaTask({
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        providerId: 'openai-image',
        variantCount: 1,
        seed: 7,
      }),
    );

    await vi.waitFor(() => expect(startMedia).toHaveBeenCalledTimes(1));
    const sessionId = store.getState().commander.activeSessionId;
    expect(sessionId).toBeTruthy();
    expect(startMedia).toHaveBeenCalledWith(
      expect.objectContaining({ commanderSessionId: sessionId }),
    );
  });

  it('creates a canvas-owned chat instead of attaching media work to another canvas chat', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const startMedia = vi.fn().mockResolvedValue({
      taskListId: 'task-list-1',
      promptAssemblyId: 'assembly-1',
    });
    vi.mocked(getAPI).mockReturnValue({
      canvas: { save },
      taskLists: {
        startMedia,
        list: vi.fn().mockResolvedValue([]),
        getTasks: vi.fn().mockResolvedValue([]),
      },
    } as never);
    const store = createStore();
    store.dispatch(ensureActiveSession({ id: 'other-chat', defaultCanvasId: 'other-canvas' }));

    store.dispatch(
      requestDurableMediaTask({
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        providerId: 'openai-image',
        variantCount: 1,
        seed: 7,
      }),
    );

    await vi.waitFor(() => expect(startMedia).toHaveBeenCalledTimes(1));
    const state = store.getState().commander;
    expect(state.activeSessionId).not.toBe('other-chat');
    expect(
      state.sessions.find((session) => session.id === state.activeSessionId)?.defaultCanvasId,
    ).toBe('canvas-1');
    expect(startMedia).toHaveBeenCalledWith(
      expect.objectContaining({ commanderSessionId: state.activeSessionId }),
    );
  });

  it('cancels only the media Task List owned by the active Commander session', async () => {
    const cancelMedia = vi.fn().mockResolvedValue({
      ok: true,
      taskListId: 'task-list-1',
      status: 'cancelled',
    });
    vi.mocked(getAPI).mockReturnValue({
      taskLists: {
        cancelMedia,
        list: vi.fn().mockResolvedValue([]),
        getTasks: vi.fn().mockResolvedValue([]),
      },
    } as never);
    const store = createStore();
    store.dispatch(ensureActiveSession({ id: 'session-1', defaultCanvasId: 'canvas-1' }));

    store.dispatch(
      requestDurableMediaCancellation({ canvasId: 'canvas-1', nodeId: 'node-1' }),
    );

    await vi.waitFor(() => expect(cancelMedia).toHaveBeenCalledTimes(1));
    expect(cancelMedia).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      commanderSessionId: 'session-1',
    });
  });
});

describe('canvas navigation', () => {
  it('does not cancel a run, switch chat, or change its default canvas', async () => {
    const cancel = vi.fn();
    vi.mocked(getAPI).mockReturnValue({ commander: { cancel } } as never);
    const store = createStore();
    store.dispatch(ensureActiveSession({ id: 'session-1', defaultCanvasId: 'canvas-1' }));
    store.dispatch(
      appendEvent({
        sessionId: 'session-1',
        event: {
          kind: 'run_start',
          workType: 'agent',
          runId: 'run-1',
          step: 0,
          seq: 0,
          emittedAt: 1,
          intent: 'keep running',
          resourceBudget: {},
        },
      }),
    );

    store.dispatch(setActiveCanvas(null));
    await Promise.resolve();

    expect(cancel).not.toHaveBeenCalled();
    expect(store.getState().commander.activeSessionId).toBe('session-1');
    expect(store.getState().commander.sessions[0]?.defaultCanvasId).toBe('canvas-1');
    expect(store.getState().commanderTimeline.currentRunIdBySessionId['session-1']).toBe('run-1');
  });
});
