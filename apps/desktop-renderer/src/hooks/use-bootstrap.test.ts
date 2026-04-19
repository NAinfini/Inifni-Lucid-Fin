// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n.js';
import { getAPI } from '../utils/api.js';
import { loggerSlice } from '../store/slices/logger.js';
import { settingsSlice } from '../store/slices/settings.js';
import { toastSlice } from '../store/slices/toast.js';
import { jobsSlice } from '../store/slices/jobs.js';
import { useBootstrap, _resetBootstrapForTest } from './use-bootstrap.js';

vi.mock('../utils/api.js', () => ({
  getAPI: vi.fn(),
}));

function createWrapper() {
  const store = configureStore({
    reducer: {
      settings: settingsSlice.reducer,
      logger: loggerSlice.reducer,
      toast: toastSlice.reducer,
      jobs: jobsSlice.reducer,
    },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(Provider, { store, children });
  }

  return { store, Wrapper };
}

describe('useBootstrap', () => {
  beforeEach(() => {
    _resetBootstrapForTest();
    vi.mocked(getAPI).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads settings and jobs on mount, then sets bootstrapped', async () => {
    let readyCallback: (() => Promise<void> | void) | undefined;

    vi.mocked(getAPI).mockReturnValue({
      updater: {
        onProgress: vi.fn(() => () => undefined),
      },
      onReady: vi.fn((cb) => {
        readyCallback = cb;
        return () => undefined;
      }),
      settings: {
        load: vi.fn(async () => ({ renderPreset: 'cinematic' })),
      },
      job: { list: vi.fn(async () => []) },
    } as never);

    const { store, Wrapper } = createWrapper();
    renderHook(() => useBootstrap(), { wrapper: Wrapper });

    await act(async () => {
      await readyCallback?.();
    });

    await waitFor(() => {
      expect(store.getState().settings.bootstrapped).toBe(true);
    });

    expect(store.getState().settings.renderPreset).toBe('cinematic');
  });

  it('sets bootstrapped = true after load with null settings', async () => {
    let readyCallback: (() => Promise<void> | void) | undefined;

    vi.mocked(getAPI).mockReturnValue({
      updater: {
        onProgress: vi.fn(() => () => undefined),
      },
      onReady: vi.fn((cb) => {
        readyCallback = cb;
        return () => undefined;
      }),
      settings: {
        load: vi.fn(async () => null),
      },
      job: { list: vi.fn(async () => []) },
    } as never);

    const { store, Wrapper } = createWrapper();
    renderHook(() => useBootstrap(), { wrapper: Wrapper });

    await act(async () => {
      await readyCallback?.();
    });

    await waitFor(() => {
      expect(store.getState().settings.bootstrapped).toBe(true);
    });
  });

  it('deduplicates updater toasts by version', () => {
    let progressCallback:
      | ((status: { state: string; info?: { version?: string } }) => void)
      | undefined;

    vi.mocked(getAPI).mockReturnValue({
      updater: {
        onProgress: vi.fn((cb) => {
          progressCallback = cb;
          return () => undefined;
        }),
      },
      onReady: vi.fn(() => () => undefined),
      settings: { load: vi.fn(async () => null) },
      job: { list: vi.fn(async () => []) },
    } as never);

    const { store, Wrapper } = createWrapper();
    renderHook(() => useBootstrap(), { wrapper: Wrapper });

    act(() => {
      progressCallback?.({ state: 'available', info: { version: '1.2.3' } });
      progressCallback?.({ state: 'available', info: { version: '1.2.3' } });
      progressCallback?.({ state: 'available', info: { version: '1.2.4' } });
    });

    expect(store.getState().toast.items).toEqual([
      expect.objectContaining({
        variant: 'info',
        title: t('settings.update.toastTitle'),
        message: t('settings.update.toastMessage').replace('{version}', '1.2.3'),
      }),
      expect.objectContaining({
        variant: 'info',
        title: t('settings.update.toastTitle'),
        message: t('settings.update.toastMessage').replace('{version}', '1.2.4'),
      }),
    ]);
  });

  it('logs startup failures and allows retry', async () => {
    let readyCallback: (() => Promise<void> | void) | undefined;

    vi.mocked(getAPI).mockReturnValue({
      updater: {
        onProgress: vi.fn(() => () => undefined),
      },
      onReady: vi.fn((cb) => {
        readyCallback = cb;
        return () => undefined;
      }),
      settings: {
        load: vi.fn()
          .mockRejectedValueOnce(new Error('settings load failed'))
          .mockResolvedValueOnce(null),
      },
      job: {
        list: vi.fn(async () => []),
      },
    } as never);

    const { store, Wrapper } = createWrapper();
    renderHook(() => useBootstrap(), { wrapper: Wrapper });

    await act(async () => {
      await readyCallback?.();
    });

    expect(store.getState().logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          category: 'startup',
          message: t('startup.bootstrapFailed'),
        }),
      ]),
    );
    expect(store.getState().settings.bootstrapped).toBe(false);

    // Retry should succeed
    await act(async () => {
      await readyCallback?.();
    });

    await waitFor(() => {
      expect(store.getState().settings.bootstrapped).toBe(true);
    });
  });

  it('boots only once across remounts when app is already ready', async () => {
    let resolveLoad: ((value: { renderPreset: string }) => void) | undefined;
    const load = vi.fn(
      () =>
        new Promise<{ renderPreset: string }>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    vi.mocked(getAPI).mockReturnValue({
      updater: {
        onProgress: vi.fn(() => () => undefined),
      },
      onReady: vi.fn((cb) => {
        void cb();
        return () => undefined;
      }),
      settings: { load },
      job: { list: vi.fn(async () => []) },
    } as never);

    const { store, Wrapper } = createWrapper();
    const first = renderHook(() => useBootstrap(), { wrapper: Wrapper });
    first.unmount();
    renderHook(() => useBootstrap(), { wrapper: Wrapper });

    await act(async () => {
      resolveLoad?.({ renderPreset: 'cinematic' });
    });

    await waitFor(() => {
      expect(store.getState().settings.bootstrapped).toBe(true);
    });

    expect(load).toHaveBeenCalledTimes(1);
  });
});
