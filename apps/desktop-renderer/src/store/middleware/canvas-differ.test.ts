import { describe, expect, it, vi } from 'vitest';
import type { Canvas, CanvasEdge, CanvasNode } from '@lucid-fin/contracts';
import { diffCanvas, shouldUsePatch } from './canvas-differ.js';

function createNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'node-1',
    type: 'text',
    title: 'Node 1',
    position: { x: 10, y: 20 },
    data: { content: 'before' },
    bypassed: false,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createEdge(overrides: Partial<CanvasEdge> = {}): CanvasEdge {
  return {
    id: 'edge-1',
    source: 'node-1',
    target: 'node-2',
    data: {
      status: 'idle',
    },
    ...overrides,
  };
}

function createCanvas(overrides: Partial<Canvas> = {}): Canvas {
  return {
    id: 'canvas-1',
    name: 'Canvas',
    nodes: [createNode()],
    edges: [createEdge()],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('diffCanvas', () => {
  it('returns null for new canvases and unchanged canvases', () => {
    const canvas = createCanvas();

    expect(diffCanvas(undefined, canvas)).toBeNull();
    expect(diffCanvas(canvas, canvas)).toBeNull();
  });

  it('captures name, node, and edge changes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234);

    const prev = createCanvas();
    const next = createCanvas({
      name: 'Updated canvas',
      nodes: [
        createNode({
          updatedAt: 2,
          position: { x: 50, y: 70 },
          data: { content: 'after' },
        }),
        createNode({
          id: 'node-2',
          title: 'Node 2',
          position: { x: 100, y: 140 },
        }),
      ],
      edges: [createEdge({ id: 'edge-2', source: 'node-2', target: 'node-1' })],
    });

    expect(diffCanvas(prev, next)).toEqual({
      canvasId: 'canvas-1',
      timestamp: 1234,
      operations: ['renameCanvas', 'addNode', 'updateNode', 'addEdge', 'removeEdge'],
      nameChange: 'Updated canvas',
      addedNodes: [expect.objectContaining({ id: 'node-2' })],
      updatedNodes: [
        {
          id: 'node-1',
          changes: {
            position: { x: 50, y: 70 },
            data: { content: 'after' },
            updatedAt: 2,
          },
        },
      ],
      removedEdgeIds: ['edge-1'],
      addedEdges: [expect.objectContaining({ id: 'edge-2' })],
    });
  });
});

describe('shouldUsePatch', () => {
  it('prefers patches only when they are materially smaller than the full canvas', () => {
    const canvas = createCanvas({
      nodes: Array.from({ length: 8 }, (_, index) =>
        createNode({ id: `node-${index}`, title: `Node ${index}` }),
      ),
    });

    expect(
      shouldUsePatch(
        {
          canvasId: canvas.id,
          timestamp: 1,
          operations: ['removeNode'],
          removedNodeIds: ['node-1'],
        },
        canvas,
      ),
    ).toBe(true);

    expect(
      shouldUsePatch(
        {
          canvasId: canvas.id,
          timestamp: 1,
          operations: ['addNode', 'addEdge'],
          addedNodes: canvas.nodes,
          addedEdges: canvas.edges,
        },
        canvas,
      ),
    ).toBe(false);
  });
});
