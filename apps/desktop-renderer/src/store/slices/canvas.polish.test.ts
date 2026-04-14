import { describe, expect, it } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import {
  addEdge,
  addNode,
  canvasSlice,
  copyNodes,
  insertNodeIntoEdge,
  pasteNodes,
  setActiveCanvas,
  setCanvases,
} from './canvas.js';
import { t } from '../../i18n.js';

function makeCanvas(id = 'canvas-1', name = 'Main'): Canvas {
  return {
    id,
    name,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: 1,
    updatedAt: 1,
    notes: [],
  };
}

function setup() {
  let state = canvasSlice.reducer(undefined, setCanvases([makeCanvas(), makeCanvas('canvas-2', 'Alt')]));
  state = canvasSlice.reducer(state, setActiveCanvas('canvas-1'));
  state = canvasSlice.reducer(state, addNode({ id: 'text-1', type: 'text', position: { x: 0, y: 0 } }));
  state = canvasSlice.reducer(state, addNode({ id: 'image-1', type: 'image', position: { x: 180, y: 0 } }));
  state = canvasSlice.reducer(state, addNode({ id: 'video-1', type: 'video', position: { x: 360, y: 0 } }));
  return state;
}

describe('canvas polish reducers', () => {
  it('creates backdrop nodes with explicit size metadata', () => {
    let state = setup();
    state = canvasSlice.reducer(
      state,
      addNode({
        id: 'backdrop-1',
        type: 'backdrop',
        position: { x: -40, y: -60 },
        title: 'Opening Sequence',
        data: { color: '#334155', padding: 32 },
      }),
    );

    const node = state.canvases.entities['canvas-1']!.nodes.find((entry) => entry.id === 'backdrop-1');
    expect(node?.type).toBe('backdrop');
    expect(node?.width).toBeGreaterThan(300);
    expect(node?.height).toBeGreaterThan(180);
    expect((node?.data as { color?: string }).color).toBe('#334155');
  });

  it('auto-labels edges based on connected node types', () => {
    let state = setup();
    state = canvasSlice.reducer(
      state,
      addEdge({
        id: 'edge-1',
        source: 'text-1',
        target: 'image-1',
        data: { status: 'idle' },
      }),
    );
    state = canvasSlice.reducer(
      state,
      addEdge({
        id: 'edge-2',
        source: 'image-1',
        target: 'video-1',
        data: { status: 'idle' },
      }),
    );

    expect(state.canvases.entities['canvas-1']!.edges.find((edge) => edge.id === 'edge-1')?.data.label).toBe(
      t('edge.generateImage'),
    );
    expect(state.canvases.entities['canvas-1']!.edges.find((edge) => edge.id === 'edge-2')?.data.label).toBe(t('edge.animate'));
  });

  it('copies selected nodes and pastes them into another canvas with remapped ids and edges', () => {
    let state = setup();
    state = canvasSlice.reducer(
      state,
      addEdge({
        id: 'edge-1',
        source: 'text-1',
        target: 'image-1',
        data: { status: 'idle' },
      }),
    );
    state = canvasSlice.reducer(state, copyNodes(['text-1', 'image-1']));
    state = canvasSlice.reducer(state, pasteNodes({ targetCanvasId: 'canvas-2', offset: { x: 50, y: 50 } }));

    const targetCanvas = state.canvases.entities['canvas-2'];
    expect(targetCanvas?.nodes).toHaveLength(2);
    expect(targetCanvas?.edges).toHaveLength(1);
    expect(targetCanvas?.nodes.every((node) => !['text-1', 'image-1'].includes(node.id))).toBe(true);
    expect(targetCanvas?.nodes.map((node) => node.position)).toEqual([
      { x: 50, y: 50 },
      { x: 230, y: 50 },
    ]);
    expect(targetCanvas?.edges[0]?.source).not.toBe('text-1');
    expect(targetCanvas?.edges[0]?.target).not.toBe('image-1');
  });

  it('inserts a node into an edge and rewires the path', () => {
    let state = setup();
    state = canvasSlice.reducer(
      state,
      addEdge({
        id: 'edge-1',
        source: 'text-1',
        target: 'video-1',
        data: { status: 'idle' },
      }),
    );

    state = canvasSlice.reducer(
      state,
      insertNodeIntoEdge({
        edgeId: 'edge-1',
        nodeType: 'image',
        position: { x: 200, y: 120 },
        title: 'Inserted Image',
      }),
    );

    const canvas = state.canvases.entities['canvas-1']!;
    expect(canvas.edges).toHaveLength(2);
    expect(canvas.edges.some((edge) => edge.source === 'text-1')).toBe(true);
    expect(canvas.edges.some((edge) => edge.target === 'video-1')).toBe(true);

    const insertedNode = canvas.nodes.find((node) => node.title === 'Inserted Image');
    expect(insertedNode?.position).toEqual({ x: 200, y: 120 });
  });

  it('replaces canvas contents during import via setCanvases', () => {
    let state = setup();
    const imported = {
      ...makeCanvas('canvas-1', 'Imported Flow'),
      nodes: [
        {
          id: 'imported-text',
          type: 'text' as const,
          position: { x: 24, y: 32 },
          data: { content: 'Imported' },
          title: 'Imported',
          status: 'idle' as const,
          bypassed: false,
          locked: false,
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    };

    state = canvasSlice.reducer(state, setCanvases([imported]));

    expect(state.canvases.entities['canvas-1']?.name).toBe('Imported Flow');
    expect(state.canvases.entities['canvas-1']?.nodes).toHaveLength(1);
  });
});
