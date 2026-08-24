import { describe, expect, it } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import {
  archiveCanvas,
  canvasReducer,
  restoreCanvas,
  setActiveCanvas,
  setCanvases,
} from './canvas/canvas.js';

function canvas(id: string, archivedAt?: number): Canvas {
  return {
    id,
    name: id,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    ...(archivedAt === undefined ? {} : { archivedAt }),
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('Canvas archive state', () => {
  it('keeps archived projects while selecting the next active Canvas', () => {
    let state = canvasReducer(undefined, setCanvases([canvas('a'), canvas('b')]));
    state = canvasReducer(state, setActiveCanvas('a'));
    state = canvasReducer(state, archiveCanvas({ id: 'a', archivedAt: 10 }));

    expect(state.canvases.entities.a?.archivedAt).toBe(10);
    expect(state.activeCanvasId).toBe('b');
  });

  it('does not open an archived Canvas until it is restored', () => {
    let state = canvasReducer(undefined, setCanvases([canvas('archived', 10)]));
    expect(state.activeCanvasId).toBeNull();

    state = canvasReducer(state, setActiveCanvas('archived'));
    expect(state.activeCanvasId).toBeNull();

    state = canvasReducer(state, restoreCanvas('archived'));
    state = canvasReducer(state, setActiveCanvas('archived'));
    expect(state.activeCanvasId).toBe('archived');
  });
});
