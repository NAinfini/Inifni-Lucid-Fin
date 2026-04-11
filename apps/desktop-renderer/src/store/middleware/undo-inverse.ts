import type { UnknownAction } from '@reduxjs/toolkit';
import type { CanvasNode, CanvasEdge } from '@lucid-fin/contracts';
import type { CanvasSliceState } from '../slices/canvas.js';

/**
 * Attempts to compute a minimal inverse action for a given forward action.
 *
 * Returns `null` when no efficient inverse is known — the caller should fall
 * back to storing a full slice snapshot.
 *
 * @param actionType  The Redux action type string (e.g. "canvas/addNode")
 * @param action      The full action object dispatched
 * @param prevState   The slice state *before* the action was applied
 */
export function computeInverseAction(
  actionType: string,
  action: UnknownAction,
  prevState: CanvasSliceState | Record<string, unknown>,
): UnknownAction | null {
  // Only handle canvas/ actions with efficient inverses
  if (!actionType.startsWith('canvas/')) return null;

  const canvasState = prevState as unknown as CanvasSliceState;
  if (!Array.isArray(canvasState.canvases)) {
    return null;
  }

  // Helper: find active canvas in previous state
  const prevCanvas = canvasState.canvases.find(
    (c) => c.id === canvasState.activeCanvasId,
  );

  const payload = (action as UnknownAction & { payload?: unknown }).payload;

  switch (actionType) {
    // -----------------------------------------------------------------------
    // canvas/addNode  →  canvas/removeNodes([nodeId])
    // -----------------------------------------------------------------------
    case 'canvas/addNode': {
      const p = payload as { id: string };
      if (!p?.id) return null;
      return { type: 'canvas/removeNodes', payload: [p.id] } as UnknownAction;
    }

    // -----------------------------------------------------------------------
    // canvas/removeNodes  →  canvas/restoreNodes({ nodes, edges })
    // The forward action removes nodes AND their connected edges, so we need
    // to capture both from the previous canvas state.
    // -----------------------------------------------------------------------
    case 'canvas/removeNodes': {
      const ids = payload as string[];
      if (!prevCanvas || !Array.isArray(ids)) return null;
      const idSet = new Set(ids);
      const nodes: CanvasNode[] = prevCanvas.nodes.filter((n) => idSet.has(n.id));
      const edges: CanvasEdge[] = prevCanvas.edges.filter(
        (e) => idSet.has(e.source) || idSet.has(e.target),
      );
      if (nodes.length === 0) return null;
      return {
        type: 'canvas/restoreNodes',
        payload: { nodes, edges },
      } as UnknownAction;
    }

    // -----------------------------------------------------------------------
    // canvas/moveNode  →  canvas/moveNode({ id, position: previousPosition })
    // -----------------------------------------------------------------------
    case 'canvas/moveNode': {
      const p = payload as { id: string; position: { x: number; y: number } };
      if (!prevCanvas || !p?.id) return null;
      const prevNode = prevCanvas.nodes.find((n) => n.id === p.id);
      if (!prevNode) return null;
      return {
        type: 'canvas/moveNode',
        payload: { id: p.id, position: prevNode.position },
      } as UnknownAction;
    }

    // -----------------------------------------------------------------------
    // canvas/renameNode  →  canvas/renameNode({ id, title: previousTitle })
    // -----------------------------------------------------------------------
    case 'canvas/renameNode': {
      const p = payload as { id: string; title: string };
      if (!prevCanvas || !p?.id) return null;
      const prevNode = prevCanvas.nodes.find((n) => n.id === p.id);
      if (!prevNode) return null;
      return {
        type: 'canvas/renameNode',
        payload: { id: p.id, title: prevNode.title },
      } as UnknownAction;
    }

    // -----------------------------------------------------------------------
    // canvas/updateNodeData  →  canvas/updateNodeData({ id, data: previousData })
    // Store a shallow copy of the previous data object.
    // -----------------------------------------------------------------------
    case 'canvas/updateNodeData': {
      const p = payload as { id: string; data: Record<string, unknown> };
      if (!prevCanvas || !p?.id) return null;
      const prevNode = prevCanvas.nodes.find((n) => n.id === p.id);
      if (!prevNode) return null;
      // Only capture the keys that the forward action will change
      const prevData: Record<string, unknown> = {};
      for (const key of Object.keys(p.data)) {
        prevData[key] = (prevNode.data as Record<string, unknown>)[key];
      }
      return {
        type: 'canvas/updateNodeData',
        payload: { id: p.id, data: prevData },
      } as UnknownAction;
    }

    // -----------------------------------------------------------------------
    // canvas/addEdge  →  canvas/removeEdges([edgeId])
    // -----------------------------------------------------------------------
    case 'canvas/addEdge': {
      const p = payload as { id: string };
      if (!p?.id) return null;
      return { type: 'canvas/removeEdges', payload: [p.id] } as UnknownAction;
    }

    // -----------------------------------------------------------------------
    // canvas/removeEdges  →  canvas/restoreEdges(removedEdges)
    // -----------------------------------------------------------------------
    case 'canvas/removeEdges': {
      const ids = payload as string[];
      if (!prevCanvas || !Array.isArray(ids)) return null;
      const idSet = new Set(ids);
      const edges: CanvasEdge[] = prevCanvas.edges.filter((e) => idSet.has(e.id));
      if (edges.length === 0) return null;
      return { type: 'canvas/restoreEdges', payload: edges } as UnknownAction;
    }

    // -----------------------------------------------------------------------
    // canvas/renameCanvas  →  canvas/renameCanvas({ id, name: previousName })
    // -----------------------------------------------------------------------
    case 'canvas/renameCanvas': {
      const p = payload as { id: string; name: string };
      if (!p?.id) return null;
      const prevCvs = canvasState.canvases.find((c) => c.id === p.id);
      if (!prevCvs) return null;
      return {
        type: 'canvas/renameCanvas',
        payload: { id: p.id, name: prevCvs.name },
      } as UnknownAction;
    }

    default:
      return null;
  }
}

/**
 * Estimate the approximate byte size of an undo command's inverse payload.
 * Uses JSON serialisation length as a byte proxy (acceptable for ASCII-dominant data).
 */
export function estimateActionBytes(action: UnknownAction): number {
  try {
    return JSON.stringify(action).length;
  } catch {
    return 512; // Conservative fallback
  }
}
