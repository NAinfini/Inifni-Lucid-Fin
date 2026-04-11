import type { Middleware } from '@reduxjs/toolkit';
import { getAPI } from '../../utils/api.js';
import { t } from '../../i18n.js';
import { enqueueToast } from '../slices/toast.js';
import { addLog } from '../slices/logger.js';
import type { RootState } from '../index.js';
import type { Canvas } from '@lucid-fin/contracts';
import { diffCanvas, shouldUsePatch } from './canvas-differ.js';
import { buildSparseSettings } from '../slices/settings.js';

const PROJECT_PERSIST_SLICES = [
  'project',
  'script',
  'characters',
  'equipment',
  'storyboard',
  'orchestration',
  'audio',
  'series',
  'settings',
  'presets',
  'shotTemplates',
];

// Canvas actions that mutate node/edge data and need canvas:save
const CANVAS_MUTATE_PREFIXES = [
  'canvas/addNode',
  'canvas/removeNodes',
  'canvas/updateNode',
  'canvas/updateNodeData',
  'canvas/moveNode',
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
  'canvas/updateViewport',
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

let projectTimer: ReturnType<typeof setTimeout> | null = null;
let canvasTimer: ReturnType<typeof setTimeout> | null = null;
let settingsTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;

// Tracks the last successfully saved canvas state per canvas id for patch diffing
const savedCanvasSnapshots = new Map<string, Canvas>();

export const persistMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action);

  if (typeof action === 'object' && action !== null && 'type' in action) {
    const actionType = (action as { type: string }).type;
    const sliceName = actionType.split('/')[0];
    const state = store.getState() as RootState;

    // Project-level save (manifest only)
    if (PROJECT_PERSIST_SLICES.includes(sliceName) && state.project.loaded) {
      if (projectTimer) clearTimeout(projectTimer);
      projectTimer = setTimeout(() => {
        projectTimer = null;
        getAPI()
          ?.project.save()
          .then(() => {
            consecutiveFailures = 0;
          })
          .catch((error: unknown) => {
            store.dispatch(
              addLog({
                level: 'error',
                category: 'persistence',
                message: 'Project autosave failed',
                detail: error instanceof Error ? error.stack ?? error.message : String(error),
              }),
            );
            consecutiveFailures += 1;
            store.dispatch(
              enqueueToast({
                variant: consecutiveFailures >= 3 ? 'warning' : 'error',
                title:
                  consecutiveFailures >= 3
                    ? t('toast.error.autosaveRepeatedFailed')
                    : t('toast.error.autosaveFailed'),
                message:
                  error instanceof Error ? error.message : t('toast.error.checkProjectState'),
                durationMs: consecutiveFailures >= 3 ? 8000 : 5000,
              }),
            );
          });
      }, DEBOUNCE_MS);
    }

    // Canvas-level save: persist the active canvas when nodes/edges change
    if (CANVAS_MUTATE_PREFIXES.includes(actionType) && state.project.loaded) {
      if (canvasTimer) clearTimeout(canvasTimer);
      canvasTimer = setTimeout(() => {
        canvasTimer = null;
        const currentState = store.getState() as RootState;
        const { activeCanvasId, canvases } = currentState.canvas;
        const canvas = canvases.find((c) => c.id === activeCanvasId);
        if (!canvas) return;

        const api = getAPI();
        if (!api) return;

        const prevSnapshot = savedCanvasSnapshots.get(canvas.id);
        const patch = diffCanvas(prevSnapshot, canvas);

        const doFullSave = (): void => {
          api.canvas
            .save(canvas)
            .then(() => {
              savedCanvasSnapshots.set(canvas.id, canvas);
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

        if (patch && shouldUsePatch(patch, canvas)) {
          api.canvas
            .patch({ canvasId: canvas.id, patch })
            .then(() => {
              savedCanvasSnapshots.set(canvas.id, canvas);
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

  return result;
};
