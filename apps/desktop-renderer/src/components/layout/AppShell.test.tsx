// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { AppShell } from './AppShell.js';
import { uiSlice } from '../../store/slices/ui.js';
import { settingsSlice } from '../../store/slices/settings.js';
import { jobsSlice } from '../../store/slices/jobs.js';

function createStore() {
  return configureStore({
    reducer: {
      ui: uiSlice.reducer,
      settings: settingsSlice.reducer,
      jobs: jobsSlice.reducer,
    },
  });
}

describe('AppShell drag regions', () => {
  it('keeps the title bar draggable and the main content interactive', () => {
    render(
      <Provider store={createStore()}>
        <AppShell>
          <button type="button">Interactive content</button>
        </AppShell>
      </Provider>,
    );

    const titleBar = screen.getAllByText('Lucid Fin')[0].parentElement as HTMLElement;
    const main = screen.getByRole('main') as HTMLElement;

    const titleBarRegion = (titleBar.style as unknown as { WebkitAppRegion?: string }).WebkitAppRegion;
    const mainRegion = (main.style as unknown as { WebkitAppRegion?: string }).WebkitAppRegion;

    expect(titleBarRegion).toBe('drag');
    expect(mainRegion).toBe('no-drag');
  });

  it('renders the app logo in the title bar', () => {
    render(
      <Provider store={createStore()}>
        <AppShell>
          <button type="button">Interactive content</button>
        </AppShell>
      </Provider>,
    );

    const logo = screen.getAllByRole('img', { name: 'Lucid Fin logo' })[0] as HTMLImageElement;
    expect(logo.getAttribute('src')).toContain('favicon.png');
  });
});
