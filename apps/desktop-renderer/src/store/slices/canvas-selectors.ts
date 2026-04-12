import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index.js';

/**
 * Memoized selector for the active canvas.
 * Only recomputes when `canvases` array ref or `activeCanvasId` change.
 * Shared across CanvasWorkspace, InspectorPanel, and any other consumer.
 */
export const selectActiveCanvas = createSelector(
  [(s: RootState) => s.canvas.canvases, (s: RootState) => s.canvas.activeCanvasId],
  (canvases, activeId) => canvases.find((c) => c.id === activeId),
);

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
