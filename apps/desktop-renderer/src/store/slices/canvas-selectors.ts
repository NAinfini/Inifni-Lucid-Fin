import { createSelector } from '@reduxjs/toolkit';
import type { ImageNodeData, VideoNodeData } from '@lucid-fin/contracts';
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

/** Light-weight metadata for the canvas navigator — avoids pulling full nodes/edges arrays. */
export const selectCanvasMetadataList = createSelector(
  [(s: RootState) => s.canvas.canvases],
  (canvasEntity) => adapterSelectors.selectAll(canvasEntity).map((c) => ({
    id: c.id,
    name: c.name,
    updatedAt: c.updatedAt,
    nodeCount: c.nodes.length,
    edgeCount: c.edges.length,
  })),
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

/** Memoized selector for the active canvas's nodes array. */
export const selectActiveCanvasNodes = createSelector(
  [selectActiveCanvas],
  (canvas) => canvas?.nodes,
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

interface EntityRefCounts {
  character: Record<string, number>;
  equipment: Record<string, number>;
  location: Record<string, number>;
}

/**
 * Shared memoized selector: entity usage counts across all canvases.
 * Replaces the triple-nested loops that were duplicated in
 * CharacterManagerPanel, EquipmentManagerPanel, and LocationManagerPanel.
 */
export const selectEntityUsageCounts = createSelector(
  [selectAllCanvases],
  (canvases): EntityRefCounts => {
    const character: Record<string, number> = {};
    const equipment: Record<string, number> = {};
    const location: Record<string, number> = {};
    for (const canvas of canvases) {
      for (const node of canvas.nodes) {
        if (node.type !== 'image' && node.type !== 'video') continue;
        const data = node.data as ImageNodeData | VideoNodeData;
        if (data.characterRefs) {
          for (const ref of data.characterRefs) {
            character[ref.characterId] = (character[ref.characterId] ?? 0) + 1;
          }
        }
        if (data.equipmentRefs) {
          for (const ref of data.equipmentRefs) {
            const eqId = typeof ref === 'string' ? ref : (ref as { equipmentId: string }).equipmentId;
            equipment[eqId] = (equipment[eqId] ?? 0) + 1;
          }
        }
        if (data.locationRefs) {
          for (const ref of data.locationRefs) {
            location[ref.locationId] = (location[ref.locationId] ?? 0) + 1;
          }
        }
      }
    }
    return { character, equipment, location };
  },
);
