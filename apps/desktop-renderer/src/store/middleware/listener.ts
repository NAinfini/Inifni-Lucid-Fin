import { createListenerMiddleware } from '@reduxjs/toolkit';
import { switchCanvas } from '../slices/commander.js';
import { getAPI } from '../../utils/api.js';

export const listenerMiddleware = createListenerMiddleware();

// ---------------------------------------------------------------------------
// Canvas switch → Commander session binding
// ---------------------------------------------------------------------------
// When the user switches or deletes a canvas, the Commander must save its
// current session and reset/reload state for the new canvas.  Also abort any
// running backend Commander session for the old canvas.
// ---------------------------------------------------------------------------

listenerMiddleware.startListening({
  predicate: (action) => {
    if (typeof action !== 'object' || action === null || !('type' in action)) return false;
    const t = (action as { type: string }).type;
    return t === 'canvas/setActiveCanvas' || t === 'canvas/removeCanvas';
  },
  effect: async (_action, listenerApi) => {
    const state = listenerApi.getState() as {
      canvas: { activeCanvasId: string | null };
      commander: { activeCanvasId: string | null; streaming: boolean };
    };

    const newCanvasId = state.canvas.activeCanvasId;
    const oldCanvasId = state.commander.activeCanvasId;

    // Nothing to do if the canvas didn't actually change
    if (newCanvasId === oldCanvasId) return;

    // Abort running backend session for the old canvas
    if (oldCanvasId && state.commander.streaming) {
      try {
        const api = getAPI();
        await api?.commander?.cancel(oldCanvasId);
      } catch { /* best-effort cancel */ }
    }

    listenerApi.dispatch(switchCanvas(newCanvasId));
  },
});

// When a job updates, recalculate active count
listenerMiddleware.startListening({
  predicate: (action) =>
    typeof action === 'object' &&
    action !== null &&
    'type' in action &&
    (action as { type: string }).type === 'jobs/updateJob',
  effect: async (_action, listenerApi) => {
    const state = listenerApi.getState() as { jobs: { items: Array<{ status: string }> } };
    const running = state.jobs.items.filter((j) => j.status === 'running').length;
    listenerApi.dispatch({ type: 'jobs/setActiveCount', payload: running });
  },
});

// Cascade update: when a character is updated, mark keyframes whose prompt mentions the character
listenerMiddleware.startListening({
  predicate: (action) =>
    typeof action === 'object' &&
    action !== null &&
    'type' in action &&
    (action as { type: string }).type === 'characters/updateCharacter',
  effect: async (action, listenerApi) => {
    const state = listenerApi.getState() as {
      characters: { items: Array<{ id: string; name: string }> };
      storyboard: { keyframes: Array<{ id: string; prompt: string; status: string }> };
    };
    const payload = (
      action as unknown as { payload: { id: string; data: Record<string, unknown> } }
    ).payload;
    const character = state.characters.items.find((c) => c.id === payload.id);
    if (!character) return;

    // Only trigger cascade if appearance-related fields changed
    const changedKeys = Object.keys(payload.data);
    const cascadeFields = ['name', 'appearance', 'description'];
    if (!changedKeys.some((k) => cascadeFields.includes(k))) return;

    // Find keyframes that mention this character by name in their prompt
    const affectedIds = state.storyboard.keyframes
      .filter(
        (kf) =>
          kf.prompt.toLowerCase().includes(character.name.toLowerCase()) &&
          kf.status === 'approved',
      )
      .map((kf) => kf.id);

    if (affectedIds.length > 0) {
      listenerApi.dispatch({ type: 'storyboard/markKeyframesStale', payload: affectedIds });
    }
  },
});
