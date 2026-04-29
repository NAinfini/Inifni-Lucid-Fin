// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n.js';
import { canvasSlice, setActiveCanvas } from '../../store/slices/canvas.js';
import { commanderSlice } from '../../store/slices/commander.js';
import { jobsSlice } from '../../store/slices/jobs.js';
import { uiSlice } from '../../store/slices/ui.js';
import { workflowsSlice } from '../../store/slices/workflows.js';
import { CanvasNavigatorPanel } from './CanvasNavigatorPanel.js';

const api = {
  canvas: {
    create: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock('../../utils/api.js', () => ({
  getAPI: () => api,
}));

function renderNavigator() {
  const store = configureStore({
    reducer: {
      canvas: canvasSlice.reducer,
      ui: uiSlice.reducer,
      commander: commanderSlice.reducer,
      jobs: jobsSlice.reducer,
      workflows: workflowsSlice.reducer,
    },
  });

  store.dispatch(
    canvasSlice.actions.setCanvases([
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
    ]),
  );
  store.dispatch(setActiveCanvas('canvas-1'));

  render(
    <Provider store={store}>
      <CanvasNavigatorPanel />
    </Provider>,
  );

  return store;
}

describe('CanvasNavigatorPanel', () => {
  beforeEach(() => {
    api.canvas.create.mockReset();
    api.canvas.rename.mockReset();
    api.canvas.delete.mockReset();
  });

  it('creates, switches, renames, and deletes canvases through the store and IPC', async () => {
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
    expect(api.canvas.rename).toHaveBeenCalledWith('canvas-2', 'Renamed Canvas');
    expect(store.getState().canvas.canvases.entities['canvas-2']?.name).toBe('Renamed Canvas');

    fireEvent.click(screen.getByRole('button', { name: `${t('action.delete')} Renamed Canvas` }));
    fireEvent.click(await screen.findByRole('button', { name: t('action.confirm') }));
    await waitFor(() => {
      expect(api.canvas.delete).toHaveBeenCalledWith('canvas-2');
      expect(store.getState().canvas.canvases.entities['canvas-2']).toBeUndefined();
    });
  });
});
