import { describe, expect, it } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import {
  mergePromptGuidesWithBuiltIns,
  requireAuthorizedCanvas,
  requireAuthorizedNode,
} from './helpers.js';

describe('mergePromptGuidesWithBuiltIns', () => {
  it('keeps the host process guide authoritative when a renderer guide reuses its id', () => {
    const merged = mergePromptGuidesWithBuiltIns(
      [
        { id: 'process:task-list-orchestration', name: 'Shadow', content: 'renderer shadow' },
        { id: 'custom-guide', name: 'Custom', content: 'custom content' },
      ],
      [
        {
          id: 'process:task-list-orchestration',
          name: 'Task List orchestration',
          content: 'host process rules',
        },
      ],
    );

    expect(merged).toEqual([
      {
        id: 'process:task-list-orchestration',
        name: 'Task List orchestration',
        content: 'host process rules',
      },
      { id: 'custom-guide', name: 'Custom', content: 'custom content' },
    ]);
  });
});

describe('Commander Canvas authorization guards', () => {
  const canvas: Canvas = {
    id: 'canvas-1',
    name: 'Authorized',
    nodes: [
      {
        id: 'node-1',
        type: 'text',
        position: { x: 0, y: 0 },
        data: { content: '' },
        title: 'Node',
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
  const deps = {
    authorizedCanvasIds: ['canvas-1'],
    canvasStore: { get: (id: string) => (id === canvas.id ? canvas : undefined) },
  } as never;

  it('returns only Canvas and node records inside the run scope', () => {
    expect(requireAuthorizedCanvas(deps, 'canvas-1')).toBe(canvas);
    expect(requireAuthorizedNode(deps, 'canvas-1', 'node-1').node.id).toBe('node-1');
  });

  it('fails before reading a Canvas or node outside the run scope', () => {
    expect(() => requireAuthorizedCanvas(deps, 'canvas-2')).toThrow(
      'Canvas is not authorized for this Commander run: canvas-2',
    );
    expect(() => requireAuthorizedNode(deps, 'canvas-2', 'node-1')).toThrow(
      'Canvas is not authorized for this Commander run: canvas-2',
    );
  });
});
