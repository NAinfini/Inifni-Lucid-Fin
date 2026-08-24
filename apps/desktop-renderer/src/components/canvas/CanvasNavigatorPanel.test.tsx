// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { VirtuosoMockContext } from 'react-virtuoso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import { t } from '../../i18n.js';
import { archiveCanvas, canvasSlice, setActiveCanvas } from '../../store/slices/canvas/canvas.js';
import { commanderSlice } from '../../store/slices/commander.js';
import { uiSlice } from '../../store/slices/ui.js';
import { taskListsSlice } from '../../store/slices/task-lists.js';
import { toastSlice } from '../../store/slices/toast.js';
import { CanvasNavigatorPanel } from './CanvasNavigatorPanel.js';

const api = {
  canvas: {
    create: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
    restore: vi.fn(),
    deletePermanent: vi.fn(),
  },
};

vi.mock('../../utils/api.js', () => ({
  getAPI: () => api,
}));

function renderNavigator(
  canvases: Canvas[] = [
    {
      id: 'canvas-1',
      name: 'Opening Shot',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: 1,
      updatedAt: 1,
      notes: [],
    },
    {
      id: 'canvas-2',
      name: 'Battlefield',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: 2,
      updatedAt: 2,
      notes: [],
    },
  ],
) {
  const store = configureStore({
    reducer: {
      canvas: canvasSlice.reducer,
      ui: uiSlice.reducer,
      commander: commanderSlice.reducer,
      taskLists: taskListsSlice.reducer,
      toast: toastSlice.reducer,
    },
  });

  store.dispatch(canvasSlice.actions.setCanvases(canvases));
  store.dispatch(setActiveCanvas(canvases[0]?.id ?? null));

  render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 240, itemHeight: 72 }}>
      <Provider store={store}>
        <CanvasNavigatorPanel />
      </Provider>
    </VirtuosoMockContext.Provider>,
  );

  return store;
}

describe('CanvasNavigatorPanel', () => {
  beforeEach(() => {
    api.canvas.create.mockReset();
    api.canvas.rename.mockReset();
    api.canvas.delete.mockReset();
    api.canvas.restore.mockReset();
    api.canvas.deletePermanent.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('creates, switches, renames, and archives canvases through the store and IPC', async () => {
    api.canvas.create.mockResolvedValue({
      id: 'canvas-3',
      name: 'Finale',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: 3,
      updatedAt: 3,
      notes: [],
    });
    api.canvas.rename.mockResolvedValue(undefined);
    api.canvas.delete.mockResolvedValue(undefined);

    const store = renderNavigator();

    fireEvent.click(screen.getByRole('button', { name: t('panels.createCanvas') }));
    expect(await screen.findByText('Finale')).toBeTruthy();
    expect(store.getState().canvas.activeCanvasId).toBe('canvas-3');

    fireEvent.click(screen.getByRole('button', { name: 'Battlefield' }));
    expect(store.getState().canvas.activeCanvasId).toBe('canvas-2');

    fireEvent.click(screen.getAllByRole('button', { name: t('panels.renameCanvas') })[1]!);
    fireEvent.change(screen.getByDisplayValue('Battlefield'), {
      target: { value: 'Renamed Canvas' },
    });
    fireEvent.blur(screen.getByDisplayValue('Renamed Canvas'));
    await waitFor(() => {
      expect(api.canvas.rename).toHaveBeenCalledWith('canvas-2', 'Renamed Canvas');
      expect(store.getState().canvas.canvases.entities['canvas-2']?.name).toBe('Renamed Canvas');
    });

    fireEvent.click(
      screen.getByRole('button', { name: `${t('history.archiveCanvas')} Renamed Canvas` }),
    );
    fireEvent.click(await screen.findByRole('button', { name: t('history.archiveCanvas') }));
    await waitFor(() => {
      expect(api.canvas.delete).toHaveBeenCalledWith('canvas-2');
      expect(store.getState().canvas.canvases.entities['canvas-2']?.archivedAt).toBeTypeOf(
        'number',
      );
    });
  });

  it('restores or permanently deletes archived canvases', async () => {
    api.canvas.restore.mockResolvedValue(undefined);
    api.canvas.deletePermanent.mockResolvedValue(undefined);
    const store = renderNavigator([
      {
        id: 'canvas-archived',
        name: 'Archived Project',
        archivedAt: 10,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAt: 1,
        updatedAt: 1,
        notes: [],
      },
    ]);

    fireEvent.click(
      screen.getByRole('button', { name: `${t('history.restoreCanvas')} Archived Project` }),
    );
    await waitFor(() => expect(api.canvas.restore).toHaveBeenCalledWith('canvas-archived'));
    expect(
      store.getState().canvas.canvases.entities['canvas-archived']?.archivedAt,
    ).toBeUndefined();

    act(() => {
      store.dispatch(archiveCanvas({ id: 'canvas-archived', archivedAt: 20 }));
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: `${t('history.deletePermanently')} Archived Project`,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: t('history.deletePermanently') }));
    await waitFor(() => expect(api.canvas.deletePermanent).toHaveBeenCalledWith('canvas-archived'));
    expect(store.getState().canvas.canvases.entities['canvas-archived']).toBeUndefined();
  });

  it('archives before permanently deleting an active Canvas', async () => {
    api.canvas.delete.mockResolvedValue(undefined);
    api.canvas.deletePermanent.mockResolvedValue(undefined);
    const store = renderNavigator();

    fireEvent.click(
      screen.getByRole('button', {
        name: `${t('history.deletePermanently')} Opening Shot`,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: t('history.deletePermanently') }));

    await waitFor(() => expect(api.canvas.deletePermanent).toHaveBeenCalledWith('canvas-1'));
    expect(api.canvas.delete).toHaveBeenCalledWith('canvas-1');
    expect(api.canvas.delete.mock.invocationCallOrder[0]).toBeLessThan(
      api.canvas.deletePermanent.mock.invocationCallOrder[0]!,
    );
    expect(store.getState().canvas.canvases.entities['canvas-1']).toBeUndefined();
  });

  it('keeps the persisted name when rename fails and reports the error', async () => {
    api.canvas.rename.mockRejectedValue(new Error('Rename failed'));
    const store = renderNavigator();

    fireEvent.click(screen.getAllByRole('button', { name: t('panels.renameCanvas') })[1]!);
    fireEvent.change(screen.getByDisplayValue('Opening Shot'), {
      target: { value: 'Unsaved Name' },
    });
    fireEvent.blur(screen.getByDisplayValue('Unsaved Name'));

    await waitFor(() => expect(api.canvas.rename).toHaveBeenCalled());
    expect(store.getState().canvas.canvases.entities['canvas-1']?.name).toBe('Opening Shot');
    expect(store.getState().toast.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: 'Rename failed' })]),
    );
  });

  it('virtualizes a large sorted canvas list while retaining search and selection', async () => {
    const canvases = Array.from({ length: 10_000 }, (_, index) => ({
      id: `canvas-${index}`,
      name: `Canvas ${String(index).padStart(5, '0')}`,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: index,
      updatedAt: index,
      notes: [],
    }));
    const store = renderNavigator(canvases);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Canvas 09999' })).toBeTruthy());
    expect(document.querySelectorAll('[data-canvas-id]').length).toBeLessThan(100);

    fireEvent.click(screen.getByRole('button', { name: 'Canvas 09999' }));
    expect(store.getState().canvas.activeCanvasId).toBe('canvas-9999');

    fireEvent.change(screen.getByPlaceholderText(t('panels.searchCanvases')), {
      target: { value: 'Canvas 00042' },
    });
    expect(await screen.findByRole('button', { name: 'Canvas 00042' })).toBeTruthy();
  });
});
