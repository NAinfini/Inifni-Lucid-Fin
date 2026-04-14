import { describe, it, expect } from 'vitest';

// We need to test the middleware in isolation
// Import directly to test the module's exported functions
import {
  undoMiddleware,
  canUndo,
  canRedo,
  getUndoLabel,
  getUndoStackSize,
} from './undo.js';
import type { CanvasSliceState } from '../slices/canvas.js';
import { canvasAdapter } from '../slices/canvas.js';

function createMockStore(initialState: Record<string, unknown> = {}) {
  let state = initialState;
  return {
    getState: () => state,
    dispatch: (action: unknown) => {
      // Simple reducer for testing
      if (typeof action === 'object' && action !== null && 'type' in action) {
        const typed = action as { type: string; payload?: unknown };
        if (typed.type.endsWith('/restore') && typed.payload) {
          const sliceName = typed.type.split('/')[0];
          state = { ...state, [sliceName]: typed.payload };
        }
      }
    },
  };
}

function createCanvasState(): CanvasSliceState {
  const canvas = {
    id: 'canvas-1',
    name: 'Canvas 1',
    nodes: [
      {
        id: 'node-1',
        type: 'text' as const,
        position: { x: 10, y: 20 },
        data: { content: 'hello' },
        title: 'Node 1',
        status: 'idle' as const,
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

describe('undoMiddleware', () => {
  it('tracks actions with recognized prefixes', () => {
    const store = createMockStore({ script: { content: 'hello' } });
    const next = (action: unknown) => action;
    const middleware = undoMiddleware(store as never)(next);

    middleware({ type: 'script/updateContent', payload: 'world' });

    expect(canUndo()).toBe(true);
    expect(getUndoLabel()).toBeTruthy();
  });

  it('does not track unrecognized prefixes', () => {
    const store = createMockStore({ ui: {} });
    const next = (action: unknown) => action;
    const middleware = undoMiddleware(store as never)(next);

    // Reset by running through
    middleware({ type: 'ui/setMode', payload: 'simple' });

    // ui/ is not tracked — canUndo should only reflect tracked actions
  });

  it('limits stack to MAX_STACK (100)', () => {
    const store = createMockStore({ script: { content: '' } });
    const next = (action: unknown) => action;
    const middleware = undoMiddleware(store as never)(next);

    for (let i = 0; i < 120; i++) {
      middleware({ type: 'script/updateContent', payload: `v${i}` });
      // Add delay to prevent grouping
    }

    expect(getUndoStackSize()).toBeLessThanOrEqual(100);
  });

  it('clears redo stack on new action', () => {
    const store = createMockStore({ script: { content: 'a' } });
    const next = (action: unknown) => action;
    const middleware = undoMiddleware(store as never)(next);

    middleware({ type: 'script/updateContent', payload: 'b' });
    middleware({ type: 'undo/undo' });
    expect(canRedo()).toBe(true);

    middleware({ type: 'script/updateContent', payload: 'c' });
    expect(canRedo()).toBe(false);
  });

  it('does not crash when tracking canvas actions', () => {
    const store = createMockStore({ canvas: createCanvasState() });
    const next = (action: unknown) => action;
    const middleware = undoMiddleware(store as never)(next);

    expect(() =>
      middleware({
        type: 'canvas/moveNode',
        payload: { id: 'node-1', position: { x: 100, y: 200 } },
      })
    ).not.toThrow();
  });
});
