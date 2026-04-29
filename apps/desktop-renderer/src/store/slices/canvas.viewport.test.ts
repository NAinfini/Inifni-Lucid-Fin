import { describe, expect, it } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import { canvasSlice, setActiveCanvas, setCanvases, updateViewport } from './canvas.js';

function makeCanvas(id: string, viewport = { x: 0, y: 0, zoom: 1 }): Canvas {
  return {
    id,
    name: id,
    nodes: [],
    edges: [],
    viewport,
    createdAt: 1,
    updatedAt: 1,
    notes: [],
  };
}

describe('canvas viewport isolation', () => {
  it('updateViewport writes only state.viewport and does not mutate the canvas object', () => {
    let state = canvasSlice.reducer(
      undefined,
      setCanvases([makeCanvas('c1', { x: 10, y: 20, zoom: 0.8 })]),
    );
    state = canvasSlice.reducer(state, setActiveCanvas('c1'));

    const canvasBefore = state.canvases.entities['c1'];

    state = canvasSlice.reducer(state, updateViewport({ x: 100, y: 200, zoom: 1.5 }));

    // state.viewport is updated
    expect(state.viewport).toEqual({ x: 100, y: 200, zoom: 1.5 });

    // The canvas object reference is unchanged (Immer did not produce a new draft)
    expect(state.canvases.entities['c1']).toBe(canvasBefore);

    // canvas.viewport is NOT updated (stays at load value)
    expect(state.canvases.entities['c1']!.viewport).toEqual({ x: 10, y: 20, zoom: 0.8 });
  });

  it('setCanvases loads the active canvas viewport into state.viewport', () => {
    const state = canvasSlice.reducer(
      undefined,
      setCanvases([
        makeCanvas('c1', { x: 50, y: 60, zoom: 2 }),
        makeCanvas('c2', { x: 0, y: 0, zoom: 1 }),
      ]),
    );

    // Default activeCanvasId is null → resolves to first canvas
    expect(state.activeCanvasId).toBe('c1');
    expect(state.viewport).toEqual({ x: 50, y: 60, zoom: 2 });
  });

  it('setActiveCanvas persists viewport to outgoing canvas and loads incoming viewport', () => {
    let state = canvasSlice.reducer(
      undefined,
      setCanvases([
        makeCanvas('c1', { x: 0, y: 0, zoom: 1 }),
        makeCanvas('c2', { x: 300, y: 400, zoom: 0.5 }),
      ]),
    );
    state = canvasSlice.reducer(state, setActiveCanvas('c1'));

    // Simulate panning on canvas c1
    state = canvasSlice.reducer(state, updateViewport({ x: 111, y: 222, zoom: 1.2 }));
    expect(state.viewport).toEqual({ x: 111, y: 222, zoom: 1.2 });

    // Switch to c2 — should save c1's live viewport and load c2's saved viewport
    state = canvasSlice.reducer(state, setActiveCanvas('c2'));

    // c1's canvas.viewport is updated with the live panned position
    const c1 = state.canvases.entities['c1']!;
    expect(c1.viewport).toEqual({ x: 111, y: 222, zoom: 1.2 });

    // state.viewport is now c2's saved viewport
    expect(state.viewport).toEqual({ x: 300, y: 400, zoom: 0.5 });

    // Switch back to c1 — should restore the saved panned position
    state = canvasSlice.reducer(state, setActiveCanvas('c1'));
    expect(state.viewport).toEqual({ x: 111, y: 222, zoom: 1.2 });
  });

  it('setCanvases preserves active canvas viewport when activeCanvasId is still valid', () => {
    let state = canvasSlice.reducer(
      undefined,
      setCanvases([makeCanvas('c1', { x: 10, y: 20, zoom: 1 })]),
    );
    state = canvasSlice.reducer(state, setActiveCanvas('c1'));

    // Simulate panning
    state = canvasSlice.reducer(state, updateViewport({ x: 99, y: 88, zoom: 1.5 }));

    // Reload canvases (e.g., reimport) — c1 still valid
    state = canvasSlice.reducer(
      state,
      setCanvases([makeCanvas('c1', { x: 777, y: 888, zoom: 3 })]),
    );

    // Since c1 is still valid, state.viewport is updated from the new canvas data
    expect(state.viewport).toEqual({ x: 777, y: 888, zoom: 3 });
  });
});
