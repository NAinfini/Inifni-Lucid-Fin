// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n.js';
import { canvasSlice } from '../../store/slices/canvas/canvas.js';
import { commanderSlice } from '../../store/slices/commander.js';
import { uiSlice } from '../../store/slices/ui.js';
import { RightToolbar } from './RightToolbar.js';

function renderToolbar() {
  const store = configureStore({
    reducer: {
      ui: uiSlice.reducer,
      canvas: canvasSlice.reducer,
      commander: commanderSlice.reducer,
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
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    cleanup();
  });

  it('renders tooltip-trigger buttons without entering a ref update loop', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: t('toolbar.inspector') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('toolbar.shotTemplates') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('toolbar.presets') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: t('toolbar.history') })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(6);
    expect(
      screen.getByRole('button', { name: t('toolbar.inspector') }).getAttribute('data-state'),
    ).toBe('closed');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('toggles the active panel state', () => {
    renderToolbar();

    const inspectorButton = screen.getByRole('button', { name: t('toolbar.inspector') });
    fireEvent.click(inspectorButton);
    expect(inspectorButton.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(inspectorButton);
    expect(inspectorButton.getAttribute('aria-pressed')).toBe('false');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('switches directly between shot templates and presets', () => {
    renderToolbar();

    const shotTemplates = screen.getByRole('button', { name: t('toolbar.shotTemplates') });
    const presets = screen.getByRole('button', { name: t('toolbar.presets') });

    fireEvent.click(shotTemplates);
    expect(shotTemplates.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(presets);
    expect(shotTemplates.getAttribute('aria-pressed')).toBe('false');
    expect(presets.getAttribute('aria-pressed')).toBe('true');
  });
});
