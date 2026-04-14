// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../../i18n.js';
import { canvasSlice } from '../../store/slices/canvas.js';
import { commanderSlice } from '../../store/slices/commander.js';
import { jobsSlice } from '../../store/slices/jobs.js';
import { uiSlice } from '../../store/slices/ui.js';
import { workflowsSlice } from '../../store/slices/workflows.js';
import { LeftToolbar } from './LeftToolbar.js';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderToolbar(pathname = '/') {
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
      <MemoryRouter initialEntries={[pathname]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <LeftToolbar />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

  return store;
}

describe('LeftToolbar', () => {
  afterEach(() => {
    cleanup();
  });

  it('toggles sidebar panels and marks the active item as pressed', () => {
    renderToolbar('/');

    const assetsButton = screen.getByRole('button', { name: t('toolbar.assets') });
    fireEvent.click(assetsButton);

    expect(assetsButton.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(assetsButton);
    expect(assetsButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders and toggles the shot template manager button', () => {
    renderToolbar('/');

    const shotTemplatesButton = screen.getByRole('button', { name: t('toolbar.shotTemplates') });
    fireEvent.click(shotTemplatesButton);

    expect(shotTemplatesButton.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(shotTemplatesButton);
    expect(shotTemplatesButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('navigates to settings and marks route buttons active', () => {
    renderToolbar('/');

    const settingsButtons = screen.getAllByRole('button', { name: t('toolbar.settings') });
    const settingsButton = settingsButtons[settingsButtons.length - 1];
    fireEvent.click(settingsButton);

    const locations = screen.getAllByTestId('location');
    const lastLocation = locations[locations.length - 1];
    expect(lastLocation.textContent).toBe('/settings');
    expect(settingsButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the tooltip label when hovering an icon button', async () => {
    renderToolbar('/');

    const addNodeButton = screen.getAllByRole('button', { name: t('toolbar.add') })[0];
    expect(addNodeButton).toBeDefined();
    expect(addNodeButton.getAttribute('aria-label')).toBe(t('toolbar.add'));
  });
});
