// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { Canvas } from '@lucid-fin/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSelection,
  copyNodes,
  duplicateNodes,
  removeEdges,
  removeNodes,
  setSelection,
  toggleBypass,
  toggleLock,
} from '../store/slices/canvas.js';
import { setSearchPanelOpen } from '../store/slices/ui.js';
import { useCanvasKeyboard } from './useCanvasKeyboard.js';

function createCanvas(): Canvas {
  return {
    id: 'canvas-1',
    name: 'Canvas',
    nodes: [
      {
        id: 'node-1',
        type: 'text',
        title: 'Node 1',
        position: { x: 0, y: 0 },
        data: { content: 'One' },
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'node-2',
        type: 'text',
        title: 'Node 2',
        position: { x: 100, y: 0 },
        data: { content: 'Two' },
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
          status: 'idle',
        },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function buildDeps(overrides: Partial<Parameters<typeof useCanvasKeyboard>[0]> = {}) {
  return {
    canvas: createCanvas(),
    dispatch: vi.fn(),
    selectedNodeIds: ['node-1'],
    selectedEdgeIds: [],
    setConnectingFromNodeId: vi.fn(),
    setDepHighlightLocked: vi.fn(),
    handleNodeGenerate: vi.fn(),
    handlePaste: vi.fn(async () => undefined),
    handleUndo: vi.fn(),
    handleRedo: vi.fn(),
    buildClipboardPayload: vi.fn(() => ({
      version: 1 as const,
      sourceCanvasId: 'canvas-1',
      nodes: [],
      edges: [],
      copiedAt: 1,
    })),
    ...overrides,
  };
}

describe('useCanvasKeyboard', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles delete, escape, and plain-key shortcuts on non-editable targets', () => {
    const deps = buildDeps();
    renderHook(() => useCanvasKeyboard(deps));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', cancelable: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', cancelable: true }));
    });

    expect(deps.dispatch).toHaveBeenCalledWith(removeNodes(['node-1']));
    expect(deps.dispatch).toHaveBeenCalledWith(clearSelection());
    expect(deps.dispatch).toHaveBeenCalledWith(setSearchPanelOpen(false));
    expect(deps.dispatch).toHaveBeenCalledWith(toggleBypass({ id: 'node-1' }));
    expect(deps.handleNodeGenerate).toHaveBeenCalledWith('node-1');
    expect(deps.setConnectingFromNodeId).toHaveBeenCalledWith(null);
    expect(deps.setDepHighlightLocked).toHaveBeenCalledTimes(1);
  });

  it('removes selected edges when no node selection exists', () => {
    const deps = buildDeps({
      selectedNodeIds: [],
      selectedEdgeIds: ['edge-1'],
    });
    renderHook(() => useCanvasKeyboard(deps));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true }));
    });

    expect(deps.dispatch).toHaveBeenCalledWith(removeEdges(['edge-1']));
  });

  it('handles modifier shortcuts for selection, duplicate, search, lock, paste, undo, and redo', () => {
    const deps = buildDeps();
    renderHook(() => useCanvasKeyboard(deps));

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, cancelable: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, cancelable: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', metaKey: true, cancelable: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, cancelable: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, cancelable: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, cancelable: true }),
      );
    });

    expect(deps.dispatch).toHaveBeenCalledWith(
      setSelection({
        nodeIds: ['node-1', 'node-2'],
        edgeIds: [],
      }),
    );
    expect(deps.dispatch).toHaveBeenCalledWith(duplicateNodes(['node-1']));
    expect(deps.dispatch).toHaveBeenCalledWith(setSearchPanelOpen(true));
    expect(deps.dispatch).toHaveBeenCalledWith(toggleLock({ id: 'node-1' }));
    expect(deps.handlePaste).toHaveBeenCalledTimes(1);
    expect(deps.handleUndo).toHaveBeenCalledTimes(1);
    expect(deps.handleRedo).toHaveBeenCalledTimes(2);
  });

  it('copies selected nodes to clipboard unless real text is selected', async () => {
    const deps = buildDeps();
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '',
    } as Selection);

    renderHook(() => useCanvasKeyboard(deps));

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(deps.buildClipboardPayload).toHaveBeenCalledWith(deps.canvas, ['node-1']);
    expect(deps.dispatch).toHaveBeenCalledWith(copyNodes(['node-1']));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'lucid-canvas-selection',
        payload: {
          version: 1,
          sourceCanvasId: 'canvas-1',
          nodes: [],
          edges: [],
          copiedAt: 1,
        },
      }),
    );

    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'selected text',
    } as Selection);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, cancelable: true }),
      );
      await Promise.resolve();
    });

    expect(deps.dispatch).toHaveBeenCalledTimes(1);
  });
});
