// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { t } from '../../i18n.js';
import { canvasSlice, setActiveCanvas } from '../../store/slices/canvas.js';
import { commanderSlice } from '../../store/slices/commander.js';
import { jobsSlice } from '../../store/slices/jobs.js';
import { uiSlice } from '../../store/slices/ui.js';
import { workflowsSlice } from '../../store/slices/workflows.js';
import { AddNodePanel } from './AddNodePanel.js';

function renderPanel() {
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
        name: 'Canvas 1',
        nodes: [],
        edges: [],
        viewport: { x: 120, y: 80, zoom: 1.5 },
        notes: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
  store.dispatch(setActiveCanvas('canvas-1'));
  store.dispatch(uiSlice.actions.setActivePanel('add'));

  render(
    <Provider store={store}>
      <ReactFlowProvider>
        <AddNodePanel />
      </ReactFlowProvider>
    </Provider>,
  );

  return store;
}

describe('AddNodePanel', () => {
  it('creates the requested node type and closes the left panel', () => {
    const store = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: t('panels.textNode') }));

    const state = store.getState();
    expect(state.canvas.canvases.entities['canvas-1']?.nodes).toHaveLength(1);
    expect(state.canvas.canvases.entities['canvas-1']?.nodes[0]?.type).toBe('text');
    expect(state.ui.activePanel).toBeNull();
  });
});
