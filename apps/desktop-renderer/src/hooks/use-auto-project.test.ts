// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n.js';
import { getAPI } from '../utils/api.js';
import { loggerSlice } from '../store/slices/logger.js';
import { projectSlice } from '../store/slices/project.js';
import { settingsSlice } from '../store/slices/settings.js';
import { toastSlice } from '../store/slices/toast.js';
import { useAutoProject } from './use-auto-project.js';

vi.mock('../utils/api.js', () => ({
  getAPI: vi.fn(),
}));

function createWrapper() {
  const store = configureStore({
    reducer: {
      project: projectSlice.reducer,
      settings: settingsSlice.reducer,
      logger: loggerSlice.reducer,
      toast: toastSlice.reducer,
    },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(Provider, { store, children });
  }

  return { store, Wrapper };
}

function createManifest(id: string, title: string, updatedAt = 1) {
  return {
    id,
    title,
    description: '',
    genre: '',
    resolution: [1920, 1080] as [number, number],
    fps: 24,
    aspectRatio: '16:9',
    createdAt: 1,
    updatedAt,
    aiProviders: [],
    snapshots: [],
    styleGuide: {
      global: {
        artStyle: '',
        colorPalette: { primary: '', secondary: '', forbidden: [] },
        lighting: 'natural',
        texture: '',
        referenceImages: [],
        freeformDescription: '',
      },
      sceneOverrides: {},
    },
  };
}

describe('useAutoProject', () => {
  beforeEach(() => {
    vi.mocked(getAPI).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('restores settings and opens the most recent project on ready', async () => {
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
      project: {
        list: vi.fn(async () => [
          { id: 'project-old', path: 'old-path', updatedAt: 100 },
          { id: 'project-new', path: 'new-path', updatedAt: 200 },
        ]),
        open: vi.fn(async () => createManifest('project-new', 'Newest', 200)),
        create: vi.fn(),
      },
    } as never);

    const { store, Wrapper } = createWrapper();
    renderHook(() => useAutoProject(), { wrapper: Wrapper });

    await act(async () => {
      await readyCallback?.();
    });

    await waitFor(() => {
      expect(store.getState().project).toEqual(
        expect.objectContaining({
          id: 'project-new',
          title: 'Newest',
          path: 'new-path',
          loaded: true,
        }),
      );
    });

    expect(store.getState().settings.renderPreset).toBe('cinematic');
  });

  it('creates a project when no recent project exists', async () => {
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
      project: {
        list: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: 'created-project', path: 'created-path', updatedAt: 50 }]),
        open: vi.fn(),
        create: vi.fn(async () => createManifest('created-project', 'My Project', 50)),
      },
    } as never);

    const { store, Wrapper } = createWrapper();
    renderHook(() => useAutoProject(), { wrapper: Wrapper });

    await act(async () => {
      await readyCallback?.();
    });

    expect(store.getState().project).toEqual(
      expect.objectContaining({
        id: 'created-project',
        title: 'My Project',
        path: 'created-path',
        loaded: true,
      }),
    );
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
      project: { list: vi.fn(async () => []), open: vi.fn(), create: vi.fn() },
    } as never);

    const { store, Wrapper } = createWrapper();
    renderHook(() => useAutoProject(), { wrapper: Wrapper });

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

  it('logs startup failures and retries when ready fires again', async () => {
    let readyCallback: (() => Promise<void> | void) | undefined;
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('open failed'))
      .mockResolvedValueOnce(createManifest('project-retry', 'Recovered', 200));

    vi.mocked(getAPI).mockReturnValue({
      updater: {
        onProgress: vi.fn(() => () => undefined),
      },
      onReady: vi.fn((cb) => {
        readyCallback = cb;
        return () => undefined;
      }),
      settings: { load: vi.fn(async () => null) },
      project: {
        list: vi.fn(async () => [{ id: 'project-retry', path: 'retry-path', updatedAt: 200 }]),
        open,
        create: vi.fn(),
      },
    } as never);

    const { store, Wrapper } = createWrapper();
    renderHook(() => useAutoProject(), { wrapper: Wrapper });

    await act(async () => {
      await readyCallback?.();
    });

    expect(store.getState().logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          category: 'startup',
          message: t('startup.autoProjectBootstrapFailed'),
        }),
      ]),
    );
    expect(store.getState().project.loaded).toBe(false);

    await act(async () => {
      await readyCallback?.();
    });

    expect(store.getState().project).toEqual(
      expect.objectContaining({
        id: 'project-retry',
        path: 'retry-path',
        loaded: true,
      }),
    );
  });
});
