// @vitest-environment jsdom
/**
 * Accessibility audit — Settings page.
 *
 * Renders the Settings page and runs axe-core to catch structural / ARIA
 * violations.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';

import { Settings } from '../pages/Settings.js';
import { settingsSlice } from '../store/slices/settings.js';
import { skillDefinitionsSlice } from '../store/slices/skillDefinitions.js';
import { uiSlice } from '../store/slices/ui.js';
import { commanderSlice } from '../store/slices/commander.js';
import { getAPI } from '../utils/api.js';
import { setLocale } from '../i18n.js';

expect.extend(matchers);

vi.mock('../utils/api.js', () => ({ getAPI: vi.fn(() => null) }));

const AXE_OPTIONS = {
  rules: {
    'color-contrast': { enabled: false },
    region: { enabled: false },
  },
};

function mockOnReady() {
  return vi.fn((cb: () => void) => {
    cb();
    return () => {};
  });
}

function createStore() {
  return configureStore({
    reducer: {
      settings: settingsSlice.reducer,
      skillDefinitions: skillDefinitionsSlice.reducer,
      ui: uiSlice.reducer,
      commander: commanderSlice.reducer,
    },
  });
}

function renderSettings(store = createStore()) {
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setLocale('en-US');
});

describe('a11y audit: Settings page', () => {
  it('has no axe violations on the default tab (commander)', async () => {
    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: { isConfigured: vi.fn().mockResolvedValue(false) },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' }),
        onProgress: vi.fn(() => () => {}),
      },
      app: { version: vi.fn().mockResolvedValue('1.0.0') },
    } as unknown as ReturnType<typeof getAPI>);

    const { container } = renderSettings();

    // Wait for initial async effects to settle
    await waitFor(() => {
      expect(screen.getAllByText(/Commander/i).length).toBeGreaterThan(0);
    });

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('sidebar nav has proper landmark and aria-current attributes', async () => {
    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: { isConfigured: vi.fn().mockResolvedValue(false) },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' }),
        onProgress: vi.fn(() => () => {}),
      },
      app: { version: vi.fn().mockResolvedValue('1.0.0') },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    // Settings sidebar should be a <nav> landmark
    const nav = document.querySelector('nav[aria-label]');
    expect(nav).toBeTruthy();

    // Active tab should have aria-current="page"
    const activeButton = document.querySelector('button[aria-current="page"]');
    expect(activeButton).toBeTruthy();
  });

  it('has no axe violations on the About tab', async () => {
    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: { isConfigured: vi.fn().mockResolvedValue(false) },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' }),
        onProgress: vi.fn(() => () => {}),
      },
      app: { version: vi.fn().mockResolvedValue('1.0.0') },
    } as unknown as ReturnType<typeof getAPI>);

    const { container } = renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'About' }));

    await waitFor(() => {
      expect(screen.getAllByText('About and Updates').length).toBeGreaterThan(0);
    });

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });
});
