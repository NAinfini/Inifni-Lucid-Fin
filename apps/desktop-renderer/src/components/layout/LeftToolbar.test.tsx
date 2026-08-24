// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../../i18n.js';
import { canvasSlice } from '../../store/slices/canvas/canvas.js';
import { commanderSlice } from '../../store/slices/commander.js';
import { uiSlice } from '../../store/slices/ui.js';
import { taskListsSlice } from '../../store/slices/task-lists.js';
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
      taskLists: taskListsSlice.reducer,
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

  it('keeps chats on the left and excludes right-side creation panels', () => {
    renderToolbar('/');

    const chats = screen.getByRole('button', { name: t('toolbar.history') });
    expect(screen.queryByRole('button', { name: t('toolbar.shotTemplates') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('toolbar.presets') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('toolbar.advancedTools') })).toBeNull();

    fireEvent.click(chats);
    expect(chats.getAttribute('aria-pressed')).toBe('true');
  });

  it('places Chats directly after Canvases', () => {
    renderToolbar('/');

    const buttons = Array.from(
      screen.getByRole('toolbar').querySelectorAll<HTMLButtonElement>('button'),
    );
    const canvases = screen.getByRole('button', {
      name: t('toolbar.canvases'),
    }) as HTMLButtonElement;
    const chats = screen.getByRole('button', { name: 'Chats' }) as HTMLButtonElement;

    expect(t('toolbar.history')).toBe('Chats');
    expect(buttons.indexOf(chats)).toBe(buttons.indexOf(canvases) + 1);
  });

  it('moves keyboard focus through direct panel buttons', () => {
    renderToolbar('/');

    const canvases = screen.getByRole('button', { name: t('toolbar.canvases') });
    const chats = screen.getByRole('button', { name: t('toolbar.history') });
    canvases.focus();
    fireEvent.keyDown(canvases, { key: 'ArrowDown' });

    expect(document.activeElement).toBe(chats);
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
