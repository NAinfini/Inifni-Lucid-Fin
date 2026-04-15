// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../../i18n.js';
import { canvasSlice } from '../../store/slices/canvas.js';
import { commanderSlice } from '../../store/slices/commander.js';
import { jobsSlice } from '../../store/slices/jobs.js';
import { uiSlice } from '../../store/slices/ui.js';
import { workflowsSlice } from '../../store/slices/workflows.js';
import { RightToolbar } from './RightToolbar.js';

function renderToolbar() {
  const store = configureStore({
    reducer: {
      ui: uiSlice.reducer,
      canvas: canvasSlice.reducer,
      commander: commanderSlice.reducer,
      jobs: jobsSlice.reducer,
      workflows: workflowsSlice.reducer,
    },
  });

  render(
    <Provider store={store}>
      <RightToolbar />
    </Provider>,
  );

  return store;
}

describe('RightToolbar', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders tooltip-trigger buttons without entering a ref update loop', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: t('toolbar.inspector') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('toolbar.queue') })).toBeTruthy();
  });

  it('toggles the active panel state', () => {
    renderToolbar();

    const inspectorButton = screen.getByRole('button', { name: t('toolbar.inspector') });
    fireEvent.click(inspectorButton);
    expect(inspectorButton.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(inspectorButton);
    expect(inspectorButton.getAttribute('aria-pressed')).toBe('false');
  });
});
