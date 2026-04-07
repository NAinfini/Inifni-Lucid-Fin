// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n.js';
import { canvasSlice, setActiveCanvas } from '../../store/slices/canvas.js';
import { uiSlice } from '../../store/slices/ui.js';
import { getAPI } from '../../utils/api.js';
import { GenerationQueuePanel } from './GenerationQueuePanel.js';

vi.mock('../../utils/api.js', () => ({
  getAPI: vi.fn(),
}));

function renderPanel() {
  const store = configureStore({
    reducer: {
      canvas: canvasSlice.reducer,
      ui: uiSlice.reducer,
    },
  });

  store.dispatch(
    canvasSlice.actions.setCanvases([
      {
        id: 'canvas-1',
        projectId: 'project-1',
        name: 'Opening Shot',
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAt: 1,
        updatedAt: 1,
        notes: [],
      },
    ]),
  );
  store.dispatch(setActiveCanvas('canvas-1'));

  render(
    <Provider store={store}>
      <GenerationQueuePanel />
    </Provider>,
  );

  return store;
}

describe('GenerationQueuePanel', () => {
  beforeEach(() => {
    vi.mocked(getAPI).mockReset();
  });

  it('renders the empty state when the preload API is unavailable', () => {
    vi.mocked(getAPI).mockReturnValue(undefined);

    renderPanel();

    expect(screen.getByText(t('generation.noJobs'))).toBeTruthy();
  });

  it('subscribes to canvas generation progress when the preload API is available', () => {
    const onProgress = vi.fn(() => () => {});

    vi.mocked(getAPI).mockReturnValue({
      canvasGeneration: {
        onProgress,
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderPanel();

    expect(onProgress).toHaveBeenCalledTimes(1);
  });
});
