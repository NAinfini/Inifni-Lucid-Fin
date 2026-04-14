import { createSelector } from '@reduxjs/toolkit';
import type { Canvas } from '@lucid-fin/contracts';
import type { RootState } from '../index.js';
import { canvasAdapter } from './canvas.js';

// Adapter selectors scoped to the `state.canvas.canvases` entity sub-state
const adapterSelectors = canvasAdapter.getSelectors();

/**
 * Select all canvases as a plain array.
 * Consumers that need to iterate (CanvasNavigatorPanel, manager panels, etc.)
 * should use this instead of accessing the entity state directly.
 */
export const selectAllCanvases = createSelector(
  [(s: RootState) => s.canvas.canvases],
  (canvasEntity) => adapterSelectors.selectAll(canvasEntity),
);

/**
 * Memoized selector for the active canvas.
 * O(1) lookup via entity dictionary instead of O(N) .find().
 */
export const selectActiveCanvas = createSelector(
  [(s: RootState) => s.canvas.canvases.entities, (s: RootState) => s.canvas.activeCanvasId],
  (entities, activeId) => {
    if (!activeId) return undefined;
    return entities[activeId];
  },
);

/**
 * Select a canvas by ID. O(1) lookup.
 */
export function selectCanvasById(state: RootState, id: string): Canvas | undefined {
  return state.canvas.canvases.entities[id];
}

/** Memoized selector for the active canvas's nodes array. */
export const selectActiveCanvasNodes = createSelector(
  [selectActiveCanvas],
  (canvas) => canvas?.nodes,
);

/** Memoized selector for the active canvas's edges array. */
export const selectActiveCanvasEdges = createSelector(
  [selectActiveCanvas],
  (canvas) => canvas?.edges,
);

/**
 * Memoized Map<nodeId, CanvasNode> for O(1) lookups.
 *
 * Replaces O(N) `.find()` scans throughout the codebase. The Map is rebuilt
 * only when the nodes array reference changes (i.e. after an Immer mutation).
 */
export const selectNodesById = createSelector(
  [selectActiveCanvasNodes],
  (nodes) => new Map((nodes ?? []).map((n) => [n.id, n])),
);

/**
 * O(1) single-node selector — parameterized by nodeId.
 *
 * Usage: `useSelector((s) => selectNodeById(s, nodeId))`
 *
 * Note: This is NOT a createSelector because the nodeId parameter changes
 * per call-site. Instead, it leverages selectNodesById (which IS memoized)
 * and does a cheap Map.get().
 */
export function selectNodeById(state: RootState, nodeId: string | undefined) {
  if (!nodeId) return undefined;
  return selectNodesById(state).get(nodeId);
}

/** Memoized selector for a single selected node (when exactly 1 is selected). */
export const selectSingleSelectedNode = createSelector(
  [selectNodesById, (s: RootState) => s.canvas.selectedNodeIds],
  (nodesById, selectedIds) => {
    if (selectedIds.length !== 1) return undefined;
    return nodesById.get(selectedIds[0]);
  },
);
