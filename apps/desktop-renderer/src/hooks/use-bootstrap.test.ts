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
import { addUserMessage, commanderSlice, ensureSession } from '../store/slices/commander.js';
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
      commander: commanderSlice.reducer,
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

  it('records a main-process initialization failure instead of enabling backend actions', () => {
    let initErrorCallback: ((error: string) => void) | undefined;

    vi.mocked(getAPI).mockReturnValue({
      updater: {
        onProgress: vi.fn(() => () => undefined),
      },
      onReady: vi.fn(() => () => undefined),
      onInitError: vi.fn((cb) => {
        initErrorCallback = cb;
        return () => undefined;
      }),
      settings: { load: vi.fn(async () => null) },
    } as never);

    const { store, Wrapper } = createWrapper();
    renderHook(() => useBootstrap(), { wrapper: Wrapper });

    act(() => {
      initErrorCallback?.('Canonical schema validation failed');
    });

    expect(store.getState().settings.bootstrapped).toBe(false);
    expect(store.getState().settings.initializationError).toBe(
      'Canonical schema validation failed',
    );
    expect(store.getState().logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          category: 'startup',
          message: t('startup.initializationFailed'),
        }),
      ]),
    );
    expect(store.getState().toast.items).toEqual([
      expect.objectContaining({
        variant: 'error',
        title: t('startup.initializationFailed'),
        durationMs: 0,
      }),
    ]);
  });

  it('deduplicates updater toasts by version', () => {
    let progressCallback:
      ((status: { state: string; info?: { version?: string } }) => void) | undefined;

    vi.mocked(getAPI).mockReturnValue({
      updater: {
        onProgress: vi.fn((cb) => {
          progressCallback = cb;
          return () => undefined;
        }),
      },
      onReady: vi.fn(() => () => undefined),
      settings: { load: vi.fn(async () => null) },
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
        load: vi
          .fn()
          .mockRejectedValueOnce(new Error('settings load failed'))
          .mockResolvedValueOnce(null),
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

  it('keeps SQLite Canvas ownership while restoring a newer complete local transcript', async () => {
    let readyCallback: (() => Promise<void> | void) | undefined;
    const upsert = vi.fn(async () => ({ success: true }));
    const { store, Wrapper } = createWrapper();
    store.dispatch(ensureSession({ id: 'session-1', defaultCanvasId: null }));
    store.dispatch(addUserMessage({ sessionId: 'session-1', content: 'kept locally' }));
    const local = store
      .getState()
      .commander.sessions.find((session) => session.id === 'session-1')!;

    vi.mocked(getAPI).mockReturnValue({
      updater: { onProgress: vi.fn(() => () => undefined) },
      onReady: vi.fn((callback) => {
        readyCallback = callback;
        return () => undefined;
      }),
      settings: { load: vi.fn(async () => null) },
      session: {
        list: vi.fn(async () => [
          {
            id: local.id,
            defaultCanvasId: 'canvas-2',
            title: local.title,
            messageCount: local.messageCount,
            createdAt: local.createdAt,
            updatedAt: local.updatedAt - 1,
          },
        ]),
        upsert,
      },
    } as never);

    renderHook(() => useBootstrap(), { wrapper: Wrapper });
    await act(async () => {
      await readyCallback?.();
    });

    await waitFor(() => {
      const restored = store
        .getState()
        .commander.sessions.find((session) => session.id === 'session-1');
      expect(restored?.defaultCanvasId).toBe('canvas-2');
      expect(restored?.messages.map((message) => message.content)).toEqual(['kept locally']);
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'session-1', defaultCanvasId: 'canvas-2' }),
    );
  });
});
