import { createListenerMiddleware } from '@reduxjs/toolkit';

export const listenerMiddleware = createListenerMiddleware();

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
