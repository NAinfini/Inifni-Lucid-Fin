import type { Middleware } from '@reduxjs/toolkit';
import { getAPI } from '../../utils/api.js';
import { addLog } from '../slices/logger.js';
import type { RootState } from '../index.js';
import type { Canvas } from '@lucid-fin/contracts';
import { diffCanvas, shouldUsePatch } from './canvas-differ.js';
import { buildSparseSettings } from '../slices/settings.js';
// eslint-disable-next-line no-restricted-imports -- Phase C (LRUCache relocation to shared-utils) will fix this
import { LRUCache } from '@lucid-fin/application/dist/lru-cache.js';

// Canvas actions that are UI-only or transient and should NOT trigger a persist save.
// Every canvas/ action NOT in this set automatically persists — this prevents future
// omissions when new reducers are added (blocklist is safer than allowlist).
const CANVAS_NO_PERSIST = new Set([
  'canvas/setCanvases',
  'canvas/addCanvas',
  'canvas/removeCanvas',
  'canvas/setActiveCanvas',
  'canvas/setSelection',
  'canvas/clearSelection',
  'canvas/updateViewport',
  'canvas/updateContainerSize',
  'canvas/setLoading',
  'canvas/copyNodes',
  'canvas/setClipboard',
  'canvas/setNodeGenerating',
  'canvas/setNodeProgress',
  'canvas/setNodeGenerationFailed',
  'canvas/clearNodeGenerationStatus',
  'canvas/restore',
]);

const DEBOUNCE_MS = 500;

let canvasTimer: ReturnType<typeof setTimeout> | null = null;
let settingsTimer: ReturnType<typeof setTimeout> | null = null;
// Guard: don't persist settings until the initial restore from disk has run.
// Without this, early settings/* actions (usage tracking, daily active, etc.)
// would save default/empty provider state, overwriting the real settings.json.
let settingsRestoredFromDisk = false;

/**
 * Interaction gate: while the user is actively dragging a node or
 * panning/zooming the viewport, we queue a save intent but don't fire
 * the IPC (`canvas:save` / `canvas:patch`) until the interaction ends.
 * This prevents per-frame diff+IPC overhead during drags, which shows
 * up as visible lag on larger canvases.
 *
 * CanvasWorkspace calls `setCanvasInteracting(true)` on drag/pan start
 * and `setCanvasInteracting(false)` on end; the latter flushes any
 * pending save.
 */
let isInteracting = false;
let pendingSave = false;
let flushPendingSave: (() => void) | null = null;
let interactionTimeout: ReturnType<typeof setTimeout> | null = null;
const INTERACTION_SAFETY_MS = 10_000;

/** Timestamp of the last successful canvas save. StatusBar reads this. */
let lastCanvasSavedAt = 0;
/** Whether there are unsaved canvas changes pending. */
let hasPendingChanges = false;
/** Mutex: when a save IPC is in-flight, further flushes queue behind it. */
let saveInFlight: Promise<void> | null = null;
let saveQueuedAfterFlight = false;

export function getCanvasSaveStatus(): { lastSavedAt: number; pending: boolean } {
  return {
    lastSavedAt: lastCanvasSavedAt,
    pending: hasPendingChanges || pendingSave || canvasTimer !== null,
  };
}

export function setCanvasInteracting(value: boolean): void {
  isInteracting = value;
  if (interactionTimeout) {
    clearTimeout(interactionTimeout);
    interactionTimeout = null;
  }
  if (value) {
    interactionTimeout = setTimeout(() => {
      interactionTimeout = null;
      if (isInteracting) {
        isInteracting = false;
        if (pendingSave && flushPendingSave) {
          pendingSave = false;
          flushPendingSave();
        }
      }
    }, INTERACTION_SAFETY_MS);
  } else if (pendingSave && flushPendingSave) {
    pendingSave = false;
    flushPendingSave();
  }
}

/**
 * Cancel any debounced canvas save and run it synchronously now. Used by
 * the Commander before sending a user message — we need the main-process
 * canvas cache to reflect the very latest Redux state so `canvas.getState`
 * and friends don't read stale data the user already sees on screen.
 * Returns true if a save was flushed, false if nothing was pending.
 */
export function flushPendingCanvasSave(): boolean {
  if (canvasTimer) {
    clearTimeout(canvasTimer);
    canvasTimer = null;
  }
  if (!flushPendingSave) return false;
  const run = flushPendingSave;
  // Clear flushPendingSave so a later interaction-end flush doesn't double-run.
  flushPendingSave = null;
  pendingSave = false;
  run();
  return true;
}

// Tracks the last successfully saved canvas state per canvas id for patch diffing
const savedCanvasSnapshots = new LRUCache<string, Canvas>(30);

export const persistMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action);

  if (typeof action === 'object' && action !== null && 'type' in action) {
    const actionType = (action as { type: string }).type;
    const sliceName = actionType.split('/')[0];
    const state = store.getState() as RootState;

    // Project-level save removed — project layer no longer exists.

    // Prune savedCanvasSnapshots when a canvas is removed to prevent memory leak.
    // Without this, deleted canvas objects accumulate in the Map permanently.
    if (actionType === 'canvas/removeCanvas') {
      const removedId = (action as unknown as { payload: string }).payload;
      savedCanvasSnapshots.delete(removedId);
    }

    // Canvas-level save: persist the active canvas on any canvas/ action
    // that isn't in the no-persist blocklist (selection, viewport, loading, etc.)
    if (
      sliceName === 'canvas' &&
      !CANVAS_NO_PERSIST.has(actionType) &&
      state.settings.bootstrapped
    ) {
      const runSave = (): void => {
        if (saveInFlight) {
          saveQueuedAfterFlight = true;
          return;
        }

        const currentState = store.getState() as RootState;
        const { activeCanvasId, canvases, viewport } = currentState.canvas;
        const canvas = activeCanvasId ? canvases.entities[activeCanvasId] : undefined;
        if (!canvas) return;

        const canvasToSave = canvas.viewport === viewport ? canvas : { ...canvas, viewport };

        const api = getAPI();
        if (!api) return;

        const prevSnapshot = savedCanvasSnapshots.get(canvas.id);
        const patch = diffCanvas(prevSnapshot, canvasToSave);

        const onSuccess = (): void => {
          savedCanvasSnapshots.set(canvas.id, canvasToSave);
          lastCanvasSavedAt = Date.now();
          hasPendingChanges = false;
        };

        const onError = (error: unknown, context: string): void => {
          store.dispatch(
            addLog({
              level: 'error',
              category: 'persistence',
              message: context,
              detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
            }),
          );
        };

        const onFinally = (): void => {
          saveInFlight = null;
          if (saveQueuedAfterFlight) {
            saveQueuedAfterFlight = false;
            runSave();
          }
        };

        const doFullSave = (): Promise<void> =>
          api.canvas
            .save(canvasToSave)
            .then(onSuccess)
            .catch((error: unknown) => onError(error, 'Canvas save failed'));

        if (patch && shouldUsePatch(patch, canvasToSave)) {
          saveInFlight = api.canvas
            .patch({ canvasId: canvas.id, patch })
            .then(onSuccess)
            .catch((error: unknown) => {
              store.dispatch(
                addLog({
                  level: 'warn',
                  category: 'persistence',
                  message: 'Canvas patch failed, falling back to full save',
                  detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
                }),
              );
              return doFullSave();
            })
            .finally(onFinally);
        } else {
          saveInFlight = doFullSave().finally(onFinally);
        }
      };

      // While the user is mid-interaction (drag / pan / zoom), defer IPC:
      // remember that a save is pending and register the runner so
      // setCanvasInteracting(false) can flush once at interaction end.
      if (isInteracting) {
        pendingSave = true;
        hasPendingChanges = true;
        flushPendingSave = runSave;
      } else {
        if (canvasTimer) clearTimeout(canvasTimer);
        hasPendingChanges = true;
        flushPendingSave = runSave;
        canvasTimer = setTimeout(() => {
          canvasTimer = null;
          runSave();
        }, DEBOUNCE_MS);
      }
    }

    // Settings save (app-level, independent of project)
    if (sliceName === 'settings') {
      // Mark as loaded once the initial restore from disk completes.
      if (actionType === 'settings/restore') {
        settingsRestoredFromDisk = true;
      }
      // Don't persist until settings have been loaded from disk — otherwise
      // early usage-tracking dispatches would overwrite saved provider keys.
      if (settingsRestoredFromDisk) {
        if (settingsTimer) clearTimeout(settingsTimer);
        settingsTimer = setTimeout(() => {
          settingsTimer = null;
          const currentState = store.getState() as RootState;
          const sparse = buildSparseSettings(currentState.settings);
          getAPI()
            ?.settings.save(sparse)
            .catch((error: unknown) => {
              store.dispatch(
                addLog({
                  level: 'error',
                  category: 'persistence',
                  message: 'Settings save failed',
                  detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
                }),
              );
            });
        }, DEBOUNCE_MS);
      }
    }
  }

  return result;
};
