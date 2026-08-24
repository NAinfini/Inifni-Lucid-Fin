import { createListenerMiddleware } from '@reduxjs/toolkit';
import {
  enqueueMediaPromptIntent,
  ensureActiveSession,
  requestDurableMediaCancellation,
  requestDurableMediaTask,
  setCommanderOpen,
} from '../slices/commander.js';
import { loadTaskLists, loadTaskListTasks } from '../slices/task-lists.js';
import { getAPI } from '../../utils/api.js';
import type { RootState } from '../index.js';
import { flushPendingPersistence } from './persist.js';
import { addLog } from '../slices/logger.js';
import { enqueueToast } from '../slices/toast.js';

export const listenerMiddleware = createListenerMiddleware();

function reportDurableMediaRequestFailure(
  dispatch: (action: unknown) => unknown,
  error: unknown,
): void {
  const detail = error instanceof Error ? error.message : String(error);
  dispatch(
    addLog({
      level: 'error',
      category: 'commander',
      message: 'Failed to save canvas before durable media request',
      detail,
    }),
  );
  dispatch(
    enqueueToast({
      variant: 'error',
      title: 'Unable to start media request',
      message: detail,
    }),
  );
}

// ---------------------------------------------------------------------------
// Inspector/node media intent → saved canvas → Commander queue
// ---------------------------------------------------------------------------

listenerMiddleware.startListening({
  actionCreator: requestDurableMediaTask,
  effect: async (action, listenerApi) => {
    try {
      await flushPendingPersistence();
      const state = listenerApi.getState() as RootState;
      const canvas = state.canvas.canvases.entities[action.payload.canvasId];
      if (!canvas || state.canvas.activeCanvasId !== action.payload.canvasId) {
        throw new Error('The requested canvas is no longer active');
      }
      const node = canvas.nodes.find((candidate) => candidate.id === action.payload.nodeId);
      if (!node) {
        throw new Error('The requested canvas node no longer exists');
      }

      const api = getAPI();
      if (!api?.canvas?.save) throw new Error('Canvas persistence API is unavailable');
      const canvasToSave =
        canvas.viewport === state.canvas.viewport ? canvas : { ...canvas, viewport: state.canvas.viewport };
      await api.canvas.save(canvasToSave);

      const latestState = listenerApi.getState() as RootState;
      if (latestState.canvas.activeCanvasId !== action.payload.canvasId) {
        throw new Error('The active canvas changed before the media request was sent');
      }
      const activeSession = latestState.commander.sessions.find(
        (session) => session.id === latestState.commander.activeSessionId,
      );
      const commanderSessionId =
        activeSession?.defaultCanvasId === action.payload.canvasId
          ? activeSession.id
          : crypto.randomUUID();
      listenerApi.dispatch(
        ensureActiveSession({ id: commanderSessionId, defaultCanvasId: action.payload.canvasId }),
      );
      if (!api.taskLists?.startMedia) throw new Error('Media Task API is unavailable');
      const prepared = await api.taskLists.startMedia({
        canvasId: action.payload.canvasId,
        nodeId: action.payload.nodeId,
        commanderSessionId,
        ...(action.payload.providerId ? { providerId: action.payload.providerId } : {}),
        seed: action.payload.seed,
        commanderIntent: node.title,
      });
      listenerApi.dispatch(setCommanderOpen(true));
      listenerApi.dispatch(
        enqueueMediaPromptIntent({
          sessionId: commanderSessionId,
          content: node.title,
          extraCanvasIds: [action.payload.canvasId],
          intent: {
            kind: 'media_prompt_assembly',
            taskListId: prepared.taskListId,
            promptAssemblyId: prepared.promptAssemblyId,
            nodeId: node.id,
            label: node.title,
          },
        }),
      );
      listenerApi.dispatch(loadTaskLists({ entityType: 'canvas' }));
      listenerApi.dispatch(loadTaskListTasks(prepared.taskListId));
    } catch (error) {
      reportDurableMediaRequestFailure(listenerApi.dispatch, error);
    }
  },
});

listenerMiddleware.startListening({
  actionCreator: requestDurableMediaCancellation,
  effect: async (action, listenerApi) => {
    try {
      const api = getAPI();
      if (!api?.taskLists?.cancelMedia) throw new Error('Media Task API is unavailable');
      const commanderSessionId = (listenerApi.getState() as RootState).commander.activeSessionId;
      if (!commanderSessionId) throw new Error('No active Commander session owns this media task');
      const result = await api.taskLists.cancelMedia({
        ...action.payload,
        commanderSessionId,
      });
      if (!result.ok) throw new Error('No active media task was found for this node');
      listenerApi.dispatch(loadTaskLists({ entityType: 'canvas' }));
      listenerApi.dispatch(loadTaskListTasks(result.taskListId));
      listenerApi.dispatch(
        enqueueToast({
          variant: 'success',
          title: 'Media task cancelled',
          message: 'The durable task has stopped.',
        }),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      listenerApi.dispatch(
        enqueueToast({ variant: 'error', title: 'Unable to cancel media task', message: detail }),
      );
    }
  },
});
