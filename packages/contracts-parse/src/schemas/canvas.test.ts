import { describe, expect, it } from 'vitest';
import { CanvasPatchSchema, StrictCanvasSchema } from './canvas.js';

const NODE_TYPES = ['text', 'image', 'video', 'audio', 'backdrop'] as const;

function makeCanvas(nodeType: (typeof NODE_TYPES)[number]) {
  return {
    id: `canvas-${nodeType}`,
    name: 'Storyboard',
    nodes: [
      {
        id: `node-${nodeType}`,
        type: nodeType,
        position: { x: 10, y: 20 },
        data: { prompt: 'subject', assetHash: 'a'.repeat(64), color: '#ffffff' },
        title: `${nodeType} node`,
        status: 'idle',
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('StrictCanvasSchema', () => {
  it.each(NODE_TYPES)('accepts %s nodes', (nodeType) => {
    expect(StrictCanvasSchema.safeParse(makeCanvas(nodeType)).success).toBe(true);
  });
});

describe('CanvasPatchSchema', () => {
  it('allows safe node update fields used by renderer patches', () => {
    const result = CanvasPatchSchema.safeParse({
      canvasId: 'canvas-1',
      timestamp: 2,
      updatedNodes: [
        {
          id: 'node-1',
          changes: {
            position: { x: 50, y: 75 },
            data: { prompt: 'updated' },
            width: 320,
            height: 180,
            updatedAt: 2,
          },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects unsafe node update fields', () => {
    const result = CanvasPatchSchema.safeParse({
      canvasId: 'canvas-1',
      timestamp: 2,
      updatedNodes: [{ id: 'node-1', changes: { id: 'node-2', createdAt: 2 } }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Unsupported canvas node change field: id');
      expect(result.error.message).toContain('Unsupported canvas node change field: createdAt');
    }
  });
});
