// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { Settings } from './Settings.js';
import { settingsSlice, type SettingsState } from '../store/slices/settings.js';
import { promptTemplatesSlice } from '../store/slices/promptTemplates.js';
import { uiSlice } from '../store/slices/ui.js';
import { getAPI } from '../utils/api.js';
import { setLocale } from '../i18n.js';

vi.mock('../utils/api.js', () => ({ getAPI: vi.fn(() => null) }));

type UpdateStatus =
  | { state: 'idle' | 'checking' }
  | { state: 'available' | 'downloaded'; info: { version: string } }
  | { state: 'downloading'; progress?: number; info?: { version: string } }
  | { state: 'error'; error?: string };

function createStore(preloadedSettings?: SettingsState) {
  return configureStore({
    reducer: {
      settings: settingsSlice.reducer,
      promptTemplates: promptTemplatesSlice.reducer,
      ui: uiSlice.reducer,
    },
    preloadedState: preloadedSettings ? { settings: preloadedSettings } : undefined,
  });
}

describe('Settings updater UI', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setLocale('en-US');
  });

  it('renders the about and updates section', async () => {
    vi.mocked(getAPI).mockReturnValue({
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('About and Updates')).toBeTruthy();
      expect(screen.getByText('Version 1.2.3')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Check for Updates' })).toBeTruthy();
    });
  });

  it('updates the UI when download progress events arrive', async () => {
    let onProgress: ((status: UpdateStatus) => void) | undefined;

    vi.mocked(getAPI).mockReturnValue({
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({
          state: 'available',
          info: { version: '2.0.0' },
        } satisfies UpdateStatus),
        onProgress: vi.fn((cb: (status: UpdateStatus) => void) => {
          onProgress = cb;
          return () => {};
        }),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    });

    onProgress?.({
      state: 'downloading',
      progress: 42,
      info: { version: '2.0.0' },
    });

    await waitFor(() => {
      expect(screen.getByText('Downloading...')).toBeTruthy();
      expect(screen.getByText('42%')).toBeTruthy();
    });
  });

  it('loads, copies, and updates an existing API key', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const isConfigured = vi.fn().mockImplementation(async (provider: string) => provider === 'openai');
    const getKey = vi.fn().mockResolvedValue('sk-live-old');
    const setKey = vi.fn().mockResolvedValue(undefined);

    vi.mocked(getAPI).mockReturnValue({
      keychain: {
        isConfigured,
        get: getKey,
        set: setKey,
        delete: vi.fn().mockResolvedValue(undefined),
        test: vi.fn().mockResolvedValue({ ok: true }),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
      openExternal: vi.fn(),
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Key set')).toBeTruthy();
    });

    fireEvent.click(screen.getAllByLabelText('Expand')[0]!);

    await waitFor(() => {
      expect(getKey).toHaveBeenCalledWith('openai');
      expect(screen.getByDisplayValue('sk-live-old')).toBeTruthy();
      expect(screen.getByText('Configured in keychain')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy Key' }));
    expect(writeText).toHaveBeenCalledWith('sk-live-old');

    const input = screen.getByDisplayValue('sk-live-old');
    fireEvent.change(input, { target: { value: 'sk-live-new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(setKey).toHaveBeenCalledWith('openai', 'sk-live-new');
    });
  });
});
