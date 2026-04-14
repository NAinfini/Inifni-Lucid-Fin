import type { Middleware } from '@reduxjs/toolkit';
import { getAPI } from '../../utils/api.js';
import { addLog } from '../slices/logger.js';
import type { RootState } from '../index.js';
import type { Canvas } from '@lucid-fin/contracts';
import { diffCanvas, shouldUsePatch } from './canvas-differ.js';
import { buildSparseSettings } from '../slices/settings.js';
import { LRUCache } from '@lucid-fin/application/dist/lru-cache.js';

// Canvas actions that mutate node/edge data and need canvas:save
const CANVAS_MUTATE_PREFIXES = [
  'canvas/addNode',
  'canvas/removeNodes',
  'canvas/updateNode',
  'canvas/updateNodeData',
  'canvas/moveNode',
  'canvas/moveNodes',
  'canvas/renameNode',
  'canvas/addEdge',
  'canvas/removeEdges',
  'canvas/updateEdge',
  'canvas/pasteNodes',
  'canvas/duplicateNode',
  'canvas/duplicateNodes',
  'canvas/insertNodeIntoEdge',
  'canvas/disconnectNode',
  'canvas/toggleBypass',
  'canvas/toggleLock',
  'canvas/toggleBackdropCollapse',
  'canvas/setBackdropOpacity',
  'canvas/setNodeColorTag',
  'canvas/setNodeStatus',
  'canvas/setNodeGenerationComplete',
  'canvas/setNodeGenerationFailed',
  'canvas/selectVariant',
  'canvas/addNodePresetTrackEntry',
  'canvas/updateNodePresetTrackEntry',
  'canvas/removeNodePresetTrackEntry',
  'canvas/setVideoFrameNode',
  'canvas/setVideoFrameAsset',
  'canvas/setNodeUploadedAsset',
  'canvas/clearNodeAsset',
  'canvas/setNodeSeed',
  'canvas/toggleSeedLock',
  'canvas/setNodeProvider',
  'canvas/setNodeVariantCount',
  'canvas/setNodeTrackAiDecide',
  'canvas/setAllTracksAiDecide',
  'canvas/applyNodeShotTemplate',
  'canvas/addNodeCharacterRef',
  'canvas/removeNodeCharacterRef',
  'canvas/updateNodeCharacterRef',
  'canvas/addNodeEquipmentRef',
  'canvas/removeNodeEquipmentRef',
  'canvas/updateNodeEquipmentRef',
  'canvas/addNodeLocationRef',
  'canvas/removeNodeLocationRef',
  'canvas/setNodeLocationRefs',
  'canvas/addCanvasNote',
  'canvas/updateCanvasNote',
  'canvas/deleteCanvasNote',
  'canvas/setNodeResolution',
  'canvas/setNodeDuration',
  'canvas/setNodeFps',
];

const DEBOUNCE_MS = 500;

let canvasTimer: ReturnType<typeof setTimeout> | null = null;
let settingsTimer: ReturnType<typeof setTimeout> | null = null;
// Guard: don't persist settings until the initial restore from disk has run.
// Without this, early settings/* actions (usage tracking, daily active, etc.)
// would save default/empty provider state, overwriting the real settings.json.
let settingsRestoredFromDisk = false;

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

    // Canvas-level save: persist the active canvas when nodes/edges change
    if (CANVAS_MUTATE_PREFIXES.includes(actionType) && state.settings.bootstrapped) {
      if (canvasTimer) clearTimeout(canvasTimer);
      canvasTimer = setTimeout(() => {
        canvasTimer = null;
        const currentState = store.getState() as RootState;
        const { activeCanvasId, canvases, viewport } = currentState.canvas;
        const canvas = activeCanvasId ? canvases.entities[activeCanvasId] : undefined;
        if (!canvas) return;

        // Snapshot current viewport into canvas for persistence.
        // updateViewport no longer writes canvas.viewport (to avoid Immer
        // invalidation), so we merge it here right before save.
        const canvasToSave = canvas.viewport === viewport
          ? canvas
          : { ...canvas, viewport };

        const api = getAPI();
        if (!api) return;

        const prevSnapshot = savedCanvasSnapshots.get(canvas.id);
        const patch = diffCanvas(prevSnapshot, canvasToSave);

        const doFullSave = (): void => {
          api.canvas
            .save(canvasToSave)
            .then(() => {
              savedCanvasSnapshots.set(canvas.id, canvasToSave);
            })
            .catch((error: unknown) => {
              store.dispatch(
                addLog({
                  level: 'error',
                  category: 'persistence',
                  message: 'Canvas save failed',
                  detail: error instanceof Error ? error.stack ?? error.message : String(error),
                }),
              );
            });
        };

        if (patch && shouldUsePatch(patch, canvasToSave)) {
          api.canvas
            .patch({ canvasId: canvas.id, patch })
            .then(() => {
              savedCanvasSnapshots.set(canvas.id, canvasToSave);
            })
            .catch((error: unknown) => {
              // Patch failed — fall back to full save
              store.dispatch(
                addLog({
                  level: 'warn',
                  category: 'persistence',
                  message: 'Canvas patch failed, falling back to full save',
                  detail: error instanceof Error ? error.stack ?? error.message : String(error),
                }),
              );
              doFullSave();
            });
        } else {
          doFullSave();
        }
      }, DEBOUNCE_MS);
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
                  detail: error instanceof Error ? error.stack ?? error.message : String(error),
                }),
              );
            });
        }, DEBOUNCE_MS);
      }
    }
  }

  return result;
};
