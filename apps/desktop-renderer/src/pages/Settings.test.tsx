// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { Settings } from './Settings.js';
import {
  addCustomProvider,
  settingsSlice,
  type SettingsState,
} from '../store/slices/settings.js';
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

    fireEvent.click(screen.getByRole('button', { name: 'About' }));

    await waitFor(() => {
      expect(screen.getAllByText('About and Updates').length).toBeGreaterThan(0);
      expect(screen.getByText('Version 1.2.3')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Check for Updates' })).toBeTruthy();
    });
  });

  it('shows a workflows placeholder panel from the sidebar navigation', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));

    await waitFor(() => {
      expect(screen.getAllByText('Workflows & Skills').length).toBeGreaterThan(0);
      expect(
        screen.getByText('Workflow and skill management will land here in the next step.'),
      ).toBeTruthy();
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

    fireEvent.click(screen.getByRole('button', { name: 'About' }));

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

  it('groups built-in providers by kind and opens hub model docs from registry metadata', async () => {
    const openExternal = vi.fn();

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
      openExternal,
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Official Providers')).toHaveLength(4);
      expect(screen.getAllByText('API Hubs')).toHaveLength(4);
    });

    expect(screen.queryAllByLabelText('Active')).toHaveLength(0);

    const openRouterCard = screen.getByText('OpenRouter').closest('div.rounded-xl');
    expect(openRouterCard).toBeTruthy();

    fireEvent.click(
      openRouterCard!.querySelector('button[aria-label="Expand"]') as HTMLButtonElement,
    );

    await waitFor(() => {
      expect(screen.getByText('Example: openai/gpt-4o')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'View Models' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'View Models' }));
    expect(openExternal).toHaveBeenCalledWith(
      'https://openrouter.ai/docs/api-reference/chat-completion',
    );
  });

  it('loads, copies, updates, and clears an existing API key', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const isConfigured = vi
      .fn()
      .mockImplementation(async (provider: string) => provider === 'openai');
    const getKey = vi.fn().mockResolvedValue('sk-live-old');
    const setKey = vi.fn().mockResolvedValue(undefined);
    const deleteKey = vi.fn().mockResolvedValue(undefined);

    vi.mocked(getAPI).mockReturnValue({
      keychain: {
        isConfigured,
        get: getKey,
        set: setKey,
        delete: deleteKey,
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
      expect(screen.getAllByText('Key set').length).toBeGreaterThan(0);
    });

    const openAiCard = screen.getAllByText(/^OpenAI$/)[0]!.closest('div.rounded-xl')! as HTMLElement;
    fireEvent.click(within(openAiCard).getByLabelText('Expand'));

    await waitFor(() => {
      expect(getKey).toHaveBeenCalledWith('openai');
      expect(screen.getByDisplayValue('sk-live-old')).toBeTruthy();
      expect(within(openAiCard).getByText('Configured in keychain')).toBeTruthy();
    });

    fireEvent.click(within(openAiCard).getByRole('button', { name: 'Copy Key' }));
    expect(writeText).toHaveBeenCalledWith('sk-live-old');

    const input = screen.getByDisplayValue('sk-live-old');
    fireEvent.change(input, { target: { value: 'sk-live-new' } });
    fireEvent.click(within(openAiCard).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(setKey).toHaveBeenCalledWith('openai', 'sk-live-new');
    });

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(within(openAiCard).getByRole('button', { name: '✓ Saved' }));

    await waitFor(() => {
      expect(deleteKey).toHaveBeenCalledWith('openai');
    });

    await waitFor(() => {
      expect(within(openAiCard).queryByText('Configured in keychain')).toBeNull();
      expect(within(openAiCard).queryByText('Key set')).toBeNull();
      expect(within(openAiCard).getByText('No key')).toBeTruthy();
    });
  });

  it('localizes custom provider labels and saved state in zh-CN', async () => {
    setLocale('zh-CN');

    const isConfigured = vi
      .fn()
      .mockImplementation(async (provider: string) => provider === 'custom-llm-localized');
    const getKey = vi.fn().mockResolvedValue('sk-localized');
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

    const store = createStore();
    store.dispatch(
      addCustomProvider({
        group: 'llm',
        id: 'custom-llm-localized',
        name: '本地代理',
      }),
    );

    render(
      <Provider store={store}>
        <MemoryRouter>
          <Settings />
        </MemoryRouter>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByText('自定义提供方')).toBeTruthy();
    });

    const customCard = screen.getByDisplayValue('本地代理').closest('div.rounded-xl')! as HTMLElement;
    fireEvent.click(within(customCard).getByLabelText('展开'));

    await waitFor(() => {
      expect(within(customCard).getByText('协议')).toBeTruthy();
      expect(within(customCard).getByText('已在钥匙串中配置')).toBeTruthy();
    });

    const input = screen.getByDisplayValue('sk-localized');
    fireEvent.change(input, { target: { value: 'sk-localized-new' } });
    fireEvent.click(within(customCard).getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(setKey).toHaveBeenCalledWith('custom-llm-localized', 'sk-localized-new');
      expect(within(customCard).getByRole('button', { name: '✓ 已保存' })).toBeTruthy();
    });
  });

  it('hydrates distinct keychain ids for OpenAI image and TTS providers', async () => {
    const isConfigured = vi.fn().mockResolvedValue(false);

    vi.mocked(getAPI).mockReturnValue({
      keychain: {
        isConfigured,
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
      expect(isConfigured).toHaveBeenCalledWith('openai');
      expect(isConfigured).toHaveBeenCalledWith('openai-image');
      expect(isConfigured).toHaveBeenCalledWith('openai-tts');
    });
  });
});
