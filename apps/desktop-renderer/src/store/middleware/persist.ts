import type { Middleware } from '@reduxjs/toolkit';
import { getAPI } from '../../utils/api.js';
import { addLog } from '../slices/logger.js';
import { t } from '../../i18n.js';
import { enqueueToast } from '../slices/toast.js';
import type { RootState } from '../index.js';
import type { Canvas, OrderedDeliverySequence } from '@lucid-fin/contracts';
import { diffCanvas, shouldUsePatch } from './canvas-differ.js';
import { buildSparseSettings } from '../slices/settings.js';
import { withRetry } from '../../utils/ipc-retry.js';
import { LRUCache } from '@lucid-fin/shared-utils';
import { synchronizeDeliverySequenceRevision } from '../slices/canvas/canvas.js';
import { DeliveryPersistenceController } from './delivery-persistence.js';
import { flushPendingCommanderSessionSaves } from './commander-session-persistence.js';

// Canvas actions that are UI-only or transient and should NOT trigger a persist save.
// Every canvas/ action NOT in this set automatically persists — this prevents future
// omissions when new reducers are added (blocklist is safer than allowlist).
const CANVAS_NO_PERSIST = new Set([
  'canvas/setCanvases',
  'canvas/addCanvas',
  'canvas/removeCanvas',
  'canvas/archiveCanvas',
  'canvas/restoreCanvas',
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
  'canvas/addDeliveryItem',
  'canvas/replaceDeliveryItem',
  'canvas/reorderDeliveryItem',
  'canvas/trimDeliveryItem',
  'canvas/setDeliveryEmbeddedAudio',
  'canvas/removeDeliveryItems',
  'canvas/synchronizeDeliverySequenceRevision',
]);

const DELIVERY_MUTATION_ACTIONS = new Set([
  'canvas/addDeliveryItem',
  'canvas/replaceDeliveryItem',
  'canvas/reorderDeliveryItem',
  'canvas/trimDeliveryItem',
  'canvas/setDeliveryEmbeddedAudio',
  'canvas/removeDeliveryItems',
]);

const DEBOUNCE_MS = 500;

let canvasTimer: ReturnType<typeof setTimeout> | null = null;
let settingsTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSettingsSaveRunner: (() => Promise<void>) | null = null;
let drainSettingsSaves: (() => Promise<void>) | null = null;
let settingsSaveInFlight: Promise<void> | null = null;
// Guard: don't persist settings until the initial SQL restore has run.
// Without this, early settings/* actions (usage tracking, daily active, etc.)
// would save default/empty provider state over the restored app settings.
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
const pendingCanvasSnapshots = new Map<string, Canvas>();
let drainCanvasSaves: (() => Promise<void>) | null = null;
let interactionTimeout: ReturnType<typeof setTimeout> | null = null;
const INTERACTION_SAFETY_MS = 10_000;

/** Timestamp of the last successful canvas save. StatusBar reads this. */
let lastCanvasSavedAt = 0;
let canvasSaveInFlight: Promise<void> | null = null;

export function getCanvasSaveStatus(): { lastSavedAt: number; pending: boolean } {
  return {
    lastSavedAt: lastCanvasSavedAt,
    pending:
      pendingCanvasSnapshots.size > 0 ||
      canvasSaveInFlight !== null ||
      canvasTimer !== null ||
      [...deliveryPersistenceControllers.values()].some((controller) => controller.isPending),
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
        if (pendingCanvasSnapshots.size > 0) void drainCanvasSaves?.();
      }
    }, INTERACTION_SAFETY_MS);
  } else if (pendingCanvasSnapshots.size > 0) {
    void drainCanvasSaves?.();
  }
}

/**
 * Cancel any debounced canvas save and start it immediately. Used by
 * the Commander before sending a user message — we need the main-process
 * canvas cache to reflect the very latest Redux state so `canvas.getInfo`
 * and friends don't read stale data the user already sees on screen.
 * Returns true if a save was flushed, false if nothing was pending.
 */
export function flushPendingCanvasSave(): boolean {
  if (canvasTimer) {
    clearTimeout(canvasTimer);
    canvasTimer = null;
  }
  if (pendingCanvasSnapshots.size === 0) return false;
  void drainCanvasSaves?.();
  return true;
}

export function flushPendingDeliverySave(): boolean {
  const pending = [...deliveryPersistenceControllers.values()].filter(
    (controller) => controller.isPending,
  );
  if (pending.length === 0) return false;
  for (const controller of pending) void controller.flush();
  return true;
}

export function flushPendingSettingsSave(): boolean {
  if (settingsTimer) {
    clearTimeout(settingsTimer);
    settingsTimer = null;
  }
  if (!pendingSettingsSaveRunner) return false;
  void drainSettingsSaves?.();
  return true;
}

/** Flush every debounced save and wait for work queued during an in-flight save. */
export async function flushPendingPersistence(): Promise<void> {
  for (;;) {
    flushPendingCanvasSave();
    flushPendingDeliverySave();
    flushPendingSettingsSave();
    await flushPendingCommanderSessionSaves();
    if (
      pendingCanvasSnapshots.size === 0 &&
      !canvasSaveInFlight &&
      ![...deliveryPersistenceControllers.values()].some((controller) => controller.isPending) &&
      !pendingSettingsSaveRunner &&
      !settingsSaveInFlight
    ) {
      return;
    }
    await Promise.all([
      drainCanvasSaves?.() ?? canvasSaveInFlight ?? Promise.resolve(),
      ...[...deliveryPersistenceControllers.values()].map((controller) => controller.flush()),
      drainSettingsSaves?.() ?? settingsSaveInFlight ?? Promise.resolve(),
    ]);
  }
}

// Tracks the last successfully saved canvas state per canvas id for patch diffing
const savedCanvasSnapshots = new LRUCache<string, Canvas>(30);
const persistedDeliverySnapshots = new LRUCache<string, OrderedDeliverySequence | null>(30);
const deliveryPersistenceControllers = new Map<string, DeliveryPersistenceController>();

function copyDeliverySequence(sequence: OrderedDeliverySequence): OrderedDeliverySequence {
  return structuredClone(sequence);
}

function rememberPersistedDelivery(
  canvasId: string,
  sequence: OrderedDeliverySequence | undefined,
): void {
  persistedDeliverySnapshots.set(canvasId, sequence ? copyDeliverySequence(sequence) : null);
  const snapshot = savedCanvasSnapshots.get(canvasId);
  if (!snapshot) return;
  savedCanvasSnapshots.set(canvasId, withPersistedDelivery(snapshot));
}

function withPersistedDelivery(canvas: Canvas): Canvas {
  if (!persistedDeliverySnapshots.has(canvas.id)) return canvas;
  const persisted = persistedDeliverySnapshots.get(canvas.id);
  const snapshot = { ...canvas };
  if (persisted) snapshot.deliverySequence = copyDeliverySequence(persisted);
  else delete snapshot.deliverySequence;
  return snapshot;
}

export const persistMiddleware: Middleware = (store) => (next) => (action) => {
  const previousState = store.getState() as RootState;
  const result = next(action);

  if (typeof action === 'object' && action !== null && 'type' in action) {
    const actionType = (action as { type: string }).type;
    const sliceName = actionType.split('/')[0];
    const state = store.getState() as RootState;

    const controllerFor = (
      canvasId: string,
      persistedRevision: number,
    ): DeliveryPersistenceController => {
      const existing = deliveryPersistenceControllers.get(canvasId);
      if (existing) return existing;
      const controller = new DeliveryPersistenceController({
        canvasId,
        persistedRevision,
        transport: {
          update: async (request) => {
            const api = getAPI();
            if (!api?.canvasDelivery) throw new Error('Delivery persistence is unavailable');
            return api.canvasDelivery.update(request);
          },
        },
        onPersisted: (persistedDelivery) => {
          rememberPersistedDelivery(canvasId, persistedDelivery);
          lastCanvasSavedAt = Date.now();
          store.dispatch(
            synchronizeDeliverySequenceRevision({ canvasId, revision: persistedDelivery.revision }),
          );
        },
        onFailure: (error) => {
          store.dispatch(
            addLog({
              level: 'error',
              category: 'persistence',
              message: 'Delivery save failed',
              detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
            }),
          );
          store.dispatch(
            enqueueToast({
              variant: 'error',
              title: t('persistence.saveFailed'),
              message: error instanceof Error ? error.message : undefined,
            }),
          );
        },
        debounceMs: DEBOUNCE_MS,
      });
      deliveryPersistenceControllers.set(canvasId, controller);
      return controller;
    };

    // Project-level save removed — project layer no longer exists.

    // Canvas restoration establishes the persisted base for the dedicated
    // delivery CAS channel. Generic canvas saves must never write a Redux
    // delivery draft back to storage.
    if (actionType === 'canvas/setCanvases') {
      for (const canvas of Object.values(state.canvas.canvases.entities)) {
        if (!canvas) continue;
        rememberPersistedDelivery(canvas.id, canvas.deliverySequence);
        deliveryPersistenceControllers.delete(canvas.id);
      }
    }

    // Prune savedCanvasSnapshots when a canvas is removed to prevent memory leak.
    // Without this, deleted canvas objects accumulate in the Map permanently.
    if (actionType === 'canvas/removeCanvas') {
      const removedId = (action as unknown as { payload: string }).payload;
      savedCanvasSnapshots.delete(removedId);
      pendingCanvasSnapshots.delete(removedId);
      persistedDeliverySnapshots.delete(removedId);
      deliveryPersistenceControllers.delete(removedId);
    }

    // Delivery edits are local drafts. One controller serializes and coalesces
    // them into adjacent CAS revisions; canvas/restore covers delivery undo.
    if (
      state.settings.bootstrapped &&
      (DELIVERY_MUTATION_ACTIONS.has(actionType) || actionType === 'canvas/restore')
    ) {
      const canvasId = state.canvas.activeCanvasId;
      const canvas = canvasId ? state.canvas.canvases.entities[canvasId] : undefined;
      const previousCanvas = canvasId
        ? previousState.canvas.canvases.entities[canvasId]
        : undefined;
      if (
        canvas?.deliverySequence &&
        canvas.deliverySequence !== previousCanvas?.deliverySequence
      ) {
        const persisted = persistedDeliverySnapshots.get(canvas.id);
        const persistedRevision = persisted
          ? persisted.revision
          : persistedDeliverySnapshots.has(canvas.id)
            ? 0
            : (previousCanvas?.deliverySequence?.revision ?? 0);
        controllerFor(canvas.id, persistedRevision).queue(canvas.deliverySequence);
      }
    }

    // Canvas-level save: persist the active canvas on any canvas/ action
    // that isn't in the no-persist blocklist (selection, viewport, loading, etc.)
    if (
      sliceName === 'canvas' &&
      !CANVAS_NO_PERSIST.has(actionType) &&
      state.settings.bootstrapped
    ) {
      const { activeCanvasId, canvases, viewport } = state.canvas;
      const canvas = activeCanvasId ? canvases.entities[activeCanvasId] : undefined;
      if (!canvas) return result;

      // Capture both identity and contents at dispatch time. A later canvas switch
      // must never retarget this delayed save to the newly active canvas.
      const canvasWithViewport = canvas.viewport === viewport ? canvas : { ...canvas, viewport };
      const canvasToSave = withPersistedDelivery(canvasWithViewport);
      pendingCanvasSnapshots.set(canvas.id, canvasToSave);

      const saveSnapshot = async (snapshot: Canvas): Promise<void> => {
        const api = getAPI();
        if (!api) return;

        const prevSnapshot = savedCanvasSnapshots.get(snapshot.id);
        const patch = diffCanvas(prevSnapshot, snapshot);

        const onSuccess = (): void => {
          // A delivery CAS may finish while this generic save is in flight.
          // Refresh the diff baseline from the dedicated persisted delivery state.
          savedCanvasSnapshots.set(snapshot.id, withPersistedDelivery(snapshot));
          lastCanvasSavedAt = Date.now();
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

        const doFullSave = (): Promise<void> =>
          withRetry(async () => {
            try {
              await api.canvas.save(snapshot);
            } catch (error: unknown) {
              onError(error, 'Canvas save failed');
              throw error;
            }
          })
            .then(onSuccess)
            .catch((error: unknown) => {
              store.dispatch(
                enqueueToast({
                  variant: 'error',
                  title: t('persistence.saveFailed'),
                  message: error instanceof Error ? error.message : undefined,
                }),
              );
            });

        if (patch && shouldUsePatch(patch, snapshot)) {
          await withRetry(async () => {
            try {
              await api.canvas.patch({ canvasId: snapshot.id, patch });
            } catch (error: unknown) {
              onError(error, 'Canvas patch failed');
              throw error;
            }
          })
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
            });
        } else {
          await doFullSave();
        }
      };

      drainCanvasSaves = (): Promise<void> => {
        if (canvasSaveInFlight) return canvasSaveInFlight;
        canvasSaveInFlight = (async () => {
          while (pendingCanvasSnapshots.size > 0) {
            const snapshots = [...pendingCanvasSnapshots.values()];
            pendingCanvasSnapshots.clear();
            for (const snapshot of snapshots) await saveSnapshot(snapshot);
          }
        })().finally(() => {
          canvasSaveInFlight = null;
        });
        return canvasSaveInFlight;
      };

      // While the user is mid-interaction (drag / pan / zoom), defer IPC:
      // remember that a save is pending and register the runner so
      // setCanvasInteracting(false) can flush once at interaction end.
      if (isInteracting) {
        // The latest snapshot for each canvas remains queued until interaction end.
      } else {
        if (canvasTimer) clearTimeout(canvasTimer);
        canvasTimer = setTimeout(() => {
          canvasTimer = null;
          void drainCanvasSaves?.();
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
        const sparse = buildSparseSettings(state.settings);
        pendingSettingsSaveRunner = async (): Promise<void> => {
          try {
            await getAPI()?.settings.save(sparse);
          } catch (error: unknown) {
            store.dispatch(
              addLog({
                level: 'error',
                category: 'persistence',
                message: 'Settings save failed',
                detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
              }),
            );
          }
        };
        drainSettingsSaves = (): Promise<void> => {
          if (settingsSaveInFlight) return settingsSaveInFlight;
          settingsSaveInFlight = (async () => {
            while (pendingSettingsSaveRunner) {
              const run = pendingSettingsSaveRunner;
              pendingSettingsSaveRunner = null;
              await run();
            }
          })().finally(() => {
            settingsSaveInFlight = null;
          });
          return settingsSaveInFlight;
        };
        settingsTimer = setTimeout(() => {
          settingsTimer = null;
          void drainSettingsSaves?.();
        }, DEBOUNCE_MS);
      }
    }
  }

  return result;
};
