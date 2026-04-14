import { describe, expect, it } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import {
  addEdge,
  addNode,
  canvasSlice,
  copyNodes,
  pasteNodes,
  setActiveCanvas,
  setCanvases,
  setClipboard,
  setSelection,
} from './canvas.js';

function makeCanvas(): Canvas {
  return {
    id: 'canvas-1',
    name: 'Main',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: 1,
    updatedAt: 1,
    notes: [],
  };
}

function setup() {
  let state = canvasSlice.reducer(undefined, setCanvases([makeCanvas()]));
  state = canvasSlice.reducer(state, setActiveCanvas('canvas-1'));
  state = canvasSlice.reducer(
    state,
    addNode({ id: 'node-1', type: 'text', position: { x: 10, y: 20 } }),
  );
  state = canvasSlice.reducer(
    state,
    addNode({ id: 'node-2', type: 'image', position: { x: 110, y: 220 } }),
  );
  state = canvasSlice.reducer(
    state,
    addNode({ id: 'node-3', type: 'audio', position: { x: 210, y: 320 } }),
  );
  state = canvasSlice.reducer(
    state,
    addEdge({ id: 'edge-1', source: 'node-1', target: 'node-2', data: { status: 'idle' } }),
  );
  state = canvasSlice.reducer(
    state,
    addEdge({ id: 'edge-2', source: 'node-2', target: 'node-3', data: { status: 'idle' } }),
  );
  return state;
}

describe('canvas clipboard', () => {
  it('copyNodes populates clipboard with selected nodes and internal edges only', () => {
    let state = setup();
    state = canvasSlice.reducer(state, setSelection({ nodeIds: ['node-1', 'node-2'], edgeIds: [] }));
    state = canvasSlice.reducer(state, copyNodes(undefined));

    expect(state.clipboard).not.toBeNull();
    expect(state.clipboard?.sourceCanvasId).toBe('canvas-1');
    expect(state.clipboard?.nodes.map((n) => n.id)).toEqual(['node-1', 'node-2']);
    // edge-1 is internal (both endpoints in selection), edge-2 is external (node-3 not selected)
    expect(state.clipboard?.edges.map((e) => e.id)).toEqual(['edge-1']);
  });

  it('pasteNodes creates new nodes with new IDs and offset positions', () => {
    let state = setup();
    state = canvasSlice.reducer(state, setSelection({ nodeIds: ['node-1', 'node-2'], edgeIds: [] }));
    state = canvasSlice.reducer(state, copyNodes(undefined));

    const originalNodeIds = new Set(state.canvases.entities['canvas-1']!.nodes.map((n) => n.id));
    const originalEdgeIds = new Set(state.canvases.entities['canvas-1']!.edges.map((e) => e.id));

    state = canvasSlice.reducer(state, pasteNodes({ offset: { x: 50, y: 75 } }));

    const canvas = state.canvases.entities['canvas-1']!;
    const pastedNodes = canvas.nodes.filter((n) => !originalNodeIds.has(n.id));
    const pastedEdges = canvas.edges.filter((e) => !originalEdgeIds.has(e.id));

    expect(pastedNodes).toHaveLength(2);
    expect(pastedNodes.every((n) => !originalNodeIds.has(n.id))).toBe(true);
    expect(pastedNodes[0]!.position).toEqual({ x: 60, y: 95 });
    expect(pastedNodes[1]!.position).toEqual({ x: 160, y: 295 });

    expect(pastedEdges).toHaveLength(1);
    expect(originalEdgeIds.has(pastedEdges[0]!.id)).toBe(false);
    expect(pastedEdges[0]!.source).toBe(pastedNodes[0]!.id);
    expect(pastedEdges[0]!.target).toBe(pastedNodes[1]!.id);
  });

  it('pasteNodes on empty clipboard is a no-op', () => {
    let state = setup();
    state = canvasSlice.reducer(state, setSelection({ nodeIds: ['node-3'], edgeIds: ['edge-2'] }));
    state = canvasSlice.reducer(state, setClipboard(null));
    state = canvasSlice.reducer(state, pasteNodes(undefined));

    expect(state.canvases.entities['canvas-1']!.nodes).toHaveLength(3);
    expect(state.canvases.entities['canvas-1']!.edges).toHaveLength(2);
    expect(state.selectedNodeIds).toEqual(['node-3']);
    expect(state.selectedEdgeIds).toEqual(['edge-2']);
  });

  it('pasteNodes updates selectedNodeIds to the pasted nodes', () => {
    let state = setup();
    state = canvasSlice.reducer(state, setSelection({ nodeIds: ['node-1', 'node-2'], edgeIds: [] }));
    state = canvasSlice.reducer(state, copyNodes(undefined));

    const originalNodeIds = new Set(state.canvases.entities['canvas-1']!.nodes.map((n) => n.id));
    state = canvasSlice.reducer(state, pasteNodes({ offset: { x: 40, y: 40 } }));

    const pastedNodeIds = state.canvases.entities['canvas-1']!.nodes
      .filter((n) => !originalNodeIds.has(n.id))
      .map((n) => n.id);

    expect(state.selectedNodeIds).toEqual(pastedNodeIds);
  });
});
