import { describe, expect, it } from 'vitest';
import type { CanvasSliceState } from '../slices/canvas.js';
import { canvasAdapter } from '../slices/canvas.js';
import { computeInverseAction, estimateActionBytes } from './undo-inverse.js';

function createCanvasState(): CanvasSliceState {
  const canvas = {
    id: 'canvas-1',
    name: 'Canvas 1',
    nodes: [
      {
        id: 'node-1',
        type: 'text' as const,
        title: 'Node 1',
        position: { x: 10, y: 20 },
        data: { content: 'before' },
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'node-2',
        type: 'text' as const,
        title: 'Node 2',
        position: { x: 30, y: 40 },
        data: { content: 'second' },
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        data: {
          status: 'idle' as const,
        },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 1,
    updatedAt: 1,
  };
  return {
    canvases: canvasAdapter.addOne(canvasAdapter.getInitialState(), canvas),
    activeCanvasId: 'canvas-1',
    selectedNodeIds: [],
    selectedEdgeIds: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerWidth: 800,
    containerHeight: 600,
    clipboard: null,
    loading: false,
  };
}

describe('computeInverseAction', () => {
  it('creates inverse actions for add and remove operations', () => {
    const prevState = createCanvasState();

    expect(
      computeInverseAction('canvas/addNode', { type: 'canvas/addNode', payload: { id: 'node-3' } }, prevState),
    ).toEqual({
      type: 'canvas/removeNodes',
      payload: ['node-3'],
    });

    expect(
      computeInverseAction(
        'canvas/removeNodes',
        { type: 'canvas/removeNodes', payload: ['node-1'] },
        prevState,
      ),
    ).toEqual({
      type: 'canvas/restoreNodes',
      payload: {
        nodes: [expect.objectContaining({ id: 'node-1' })],
        edges: [expect.objectContaining({ id: 'edge-1' })],
      },
    });

    expect(
      computeInverseAction(
        'canvas/removeEdges',
        { type: 'canvas/removeEdges', payload: ['edge-1'] },
        prevState,
      ),
    ).toEqual({
      type: 'canvas/restoreEdges',
      payload: [expect.objectContaining({ id: 'edge-1' })],
    });
  });

  it('captures previous node and canvas values for reversible updates', () => {
    const prevState = createCanvasState();

    expect(
      computeInverseAction(
        'canvas/moveNode',
        { type: 'canvas/moveNode', payload: { id: 'node-1', position: { x: 99, y: 88 } } },
        prevState,
      ),
    ).toEqual({
      type: 'canvas/moveNode',
      payload: { id: 'node-1', position: { x: 10, y: 20 } },
    });

    expect(
      computeInverseAction(
        'canvas/renameNode',
        { type: 'canvas/renameNode', payload: { id: 'node-1', title: 'Renamed' } },
        prevState,
      ),
    ).toEqual({
      type: 'canvas/renameNode',
      payload: { id: 'node-1', title: 'Node 1' },
    });

    expect(
      computeInverseAction(
        'canvas/updateNodeData',
        {
          type: 'canvas/updateNodeData',
          payload: { id: 'node-1', data: { content: 'after' } },
        },
        prevState,
      ),
    ).toEqual({
      type: 'canvas/updateNodeData',
      payload: {
        id: 'node-1',
        data: { content: 'before' },
      },
    });

    expect(
      computeInverseAction(
        'canvas/renameCanvas',
        { type: 'canvas/renameCanvas', payload: { id: 'canvas-1', name: 'Updated' } },
        prevState,
      ),
    ).toEqual({
      type: 'canvas/renameCanvas',
      payload: { id: 'canvas-1', name: 'Canvas 1' },
    });
  });

  it('returns null for unsupported or invalid actions', () => {
    expect(
      computeInverseAction('characters/unknownOp', { type: 'characters/unknownOp' }, {}),
    ).toBeNull();
    expect(
      computeInverseAction('canvas/moveNode', { type: 'canvas/moveNode', payload: { id: 'missing' } }, {}),
    ).toBeNull();
  });
});

describe('estimateActionBytes', () => {
  it('measures JSON-serializable actions and falls back for cyclic data', () => {
    expect(estimateActionBytes({ type: 'canvas/removeNodes', payload: ['node-1'] })).toBeGreaterThan(0);

    const cyclic = { type: 'cyclic' } as { type: string; self?: unknown };
    cyclic.self = cyclic;

    expect(estimateActionBytes(cyclic)).toBe(512);
  });
});
