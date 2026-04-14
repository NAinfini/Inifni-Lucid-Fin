import type { Canvas, CanvasNode, CanvasEdge } from '@lucid-fin/contracts';

/** Describes the type of mutation that produced part of a patch. */
export type CanvasOperation =
  | 'addNode'
  | 'updateNode'
  | 'removeNode'
  | 'addEdge'
  | 'removeEdge'
  | 'renameCanvas';

export interface CanvasPatch {
  canvasId: string;
  timestamp: number;
  /** The set of high-level operations represented by this patch (for logging/debugging). */
  operations: CanvasOperation[];
  // Only included if changed
  nameChange?: string;
  addedNodes?: CanvasNode[];
  removedNodeIds?: string[];
  updatedNodes?: Array<{ id: string; changes: Record<string, unknown> }>;
  addedEdges?: CanvasEdge[];
  removedEdgeIds?: string[];
}

export function diffCanvas(prev: Canvas | undefined, next: Canvas): CanvasPatch | null {
  if (!prev) return null; // Full save needed for new canvases

  const patch: CanvasPatch = { canvasId: next.id, timestamp: Date.now(), operations: [] };
  let hasChanges = false;

  // Name change
  if (prev.name !== next.name) {
    patch.nameChange = next.name;
    patch.operations.push('renameCanvas');
    hasChanges = true;
  }

  // Node diffs
  const prevNodeMap = new Map(prev.nodes.map(n => [n.id, n]));
  const nextNodeMap = new Map(next.nodes.map(n => [n.id, n]));

  // Added nodes
  const added = next.nodes.filter(n => !prevNodeMap.has(n.id));
  if (added.length > 0) { patch.addedNodes = added; patch.operations.push('addNode'); hasChanges = true; }

  // Removed nodes
  const removed = prev.nodes.filter(n => !nextNodeMap.has(n.id)).map(n => n.id);
  if (removed.length > 0) { patch.removedNodeIds = removed; patch.operations.push('removeNode'); hasChanges = true; }

  // Updated nodes (compare updatedAt timestamp)
  const updated: Array<{ id: string; changes: Record<string, unknown> }> = [];
  for (const nextNode of next.nodes) {
    const prevNode = prevNodeMap.get(nextNode.id);
    if (!prevNode) continue;
    if (prevNode.updatedAt !== nextNode.updatedAt) {
      // Compute shallow changes
      const changes: Record<string, unknown> = {};
      for (const key of Object.keys(nextNode) as Array<keyof CanvasNode>) {
        if (JSON.stringify(prevNode[key]) !== JSON.stringify(nextNode[key])) {
          changes[key] = nextNode[key];
        }
      }
      if (Object.keys(changes).length > 0) {
        updated.push({ id: nextNode.id, changes });
      }
    }
  }
  if (updated.length > 0) { patch.updatedNodes = updated; patch.operations.push('updateNode'); hasChanges = true; }

  // Edge diffs
  const prevEdgeIds = new Set(prev.edges.map(e => e.id));
  const nextEdgeIds = new Set(next.edges.map(e => e.id));

  const addedEdges = next.edges.filter(e => !prevEdgeIds.has(e.id));
  if (addedEdges.length > 0) { patch.addedEdges = addedEdges; patch.operations.push('addEdge'); hasChanges = true; }

  const removedEdges = prev.edges.filter(e => !nextEdgeIds.has(e.id)).map(e => e.id);
  if (removedEdges.length > 0) { patch.removedEdgeIds = removedEdges; patch.operations.push('removeEdge'); hasChanges = true; }

  return hasChanges ? patch : null;
}

/** Estimate if patch is smaller than full canvas */
export function shouldUsePatch(patch: CanvasPatch, canvas: Canvas): boolean {
  // Exclude the `operations` metadata from the size estimate — it's for
  // debugging/logging only and shouldn't influence the full-vs-patch decision.
  const { operations: _ops, ...patchData } = patch;
  const patchSize = JSON.stringify(patchData).length;
  const fullSize = JSON.stringify(canvas).length;
  return patchSize < fullSize * 0.7; // Use patch if it's less than 70% of full
}
