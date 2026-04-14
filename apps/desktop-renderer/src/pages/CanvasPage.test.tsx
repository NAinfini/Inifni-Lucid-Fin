// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { describe, expect, it, vi } from 'vitest';
import { CanvasPage } from './CanvasPage.js';
import { getAPI } from '../utils/api.js';
import { canvasReducer } from '../store/slices/canvas.js';
import { uiSlice } from '../store/slices/ui.js';
import { settingsSlice, setBootstrapped } from '../store/slices/settings.js';
import { presetsSlice } from '../store/slices/presets.js';
import { loggerSlice } from '../store/slices/logger.js';
import { commanderSlice } from '../store/slices/commander.js';

let commanderPanelModuleLoads = 0;

vi.mock('../utils/api.js', () => ({
  getAPI: vi.fn(),
}));

vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/canvas/AddNodePanel.js', () => ({
  AddNodePanel: () => <div>AddNodePanel</div>,
}));
vi.mock('../components/canvas/AssetBrowserPanel.js', () => ({
  AssetBrowserPanel: () => <div>AssetBrowserPanel</div>,
}));
vi.mock('../components/canvas/CanvasNavigatorPanel.js', () => ({
  CanvasNavigatorPanel: () => <div>CanvasNavigatorPanel</div>,
}));
vi.mock('../components/canvas/CanvasNotesPanel.js', () => ({
  CanvasNotesPanel: () => <div>CanvasNotesPanel</div>,
}));
vi.mock('../components/canvas/CanvasWorkspace.js', () => ({
  CanvasWorkspace: () => <div>CanvasWorkspace</div>,
}));
vi.mock('../components/canvas/CharacterManagerPanel.js', () => ({
  CharacterManagerPanel: () => <div>CharacterManagerPanel</div>,
}));
vi.mock('../components/canvas/CommanderPanel.js', () => {
  commanderPanelModuleLoads += 1;
  return {
    CommanderPanel: () => <div>CommanderPanel</div>,
  };
});
vi.mock('../components/canvas/DependenciesPanel.js', () => ({
  DependenciesPanel: () => <div>DependenciesPanel</div>,
}));
vi.mock('../components/canvas/EquipmentManagerPanel.js', () => ({
  EquipmentManagerPanel: () => <div>EquipmentManagerPanel</div>,
}));
vi.mock('../components/canvas/LocationManagerPanel.js', () => ({
  LocationManagerPanel: () => <div>LocationManagerPanel</div>,
}));
vi.mock('../components/canvas/ExportRenderPanel.js', () => ({
  ExportRenderPanel: () => <div>ExportRenderPanel</div>,
}));
vi.mock('../components/canvas/GenerationQueuePanel.js', () => ({
  GenerationQueuePanel: () => <div>GenerationQueuePanel</div>,
}));
vi.mock('../components/canvas/HistoryPanel.js', () => ({
  HistoryPanel: () => <div>HistoryPanel</div>,
}));
vi.mock('../components/canvas/InspectorPanel.js', () => ({
  InspectorPanel: () => <div>InspectorPanel</div>,
}));
vi.mock('../components/canvas/LoggerPanel.js', () => ({
  LoggerPanel: () => <div>LoggerPanel</div>,
}));
vi.mock('../components/canvas/PresetManagerPanel.js', () => ({
  PresetManagerPanel: () => <div>PresetManagerPanel</div>,
}));
vi.mock('../components/canvas/ShotTemplateManagerPanel.js', () => ({
  ShotTemplateManagerPanel: () => <div>ShotTemplateManagerPanel</div>,
}));
vi.mock('../components/layout/LeftToolbar.js', () => ({
  LeftToolbar: () => <div>LeftToolbar</div>,
}));
vi.mock('../components/layout/RightToolbar.js', () => ({
  RightToolbar: () => <div>RightToolbar</div>,
}));

function createStore() {
  const store = configureStore({
    reducer: {
      canvas: canvasReducer,
      ui: uiSlice.reducer,
      settings: settingsSlice.reducer,
      presets: presetsSlice.reducer,
      logger: loggerSlice.reducer,
      commander: commanderSlice.reducer,
    },
  });

  store.dispatch(setBootstrapped());

  return store;
}

describe('CanvasPage logger startup', () => {
  it('does not load the commander panel module until it is opened', async () => {
    vi.mocked(getAPI).mockReturnValue({
      canvas: {
        list: vi.fn().mockResolvedValue([]),
      },
      preset: {
        list: vi.fn().mockResolvedValue([]),
      },
      logger: {
        getRecent: vi.fn().mockResolvedValue([]),
        onEntry: vi.fn(() => () => {}),
      },
      onReady: vi.fn(() => () => {}),
    } as unknown as ReturnType<typeof getAPI>);

    commanderPanelModuleLoads = 0;

    const store = createStore();
    render(
      <Provider store={store}>
        <CanvasPage />
      </Provider>,
    );

    await waitFor(() => {
      expect(commanderPanelModuleLoads).toBe(0);
    });

    store.dispatch(commanderSlice.actions.setCommanderOpen(true));

    await waitFor(() => {
      expect(commanderPanelModuleLoads).toBe(1);
    });
  });

  it('waits for app readiness before requesting recent logs', async () => {
    const getRecent = vi.fn().mockResolvedValue([]);
    const onEntry = vi.fn(() => () => {});
    let readyCallback: (() => void) | undefined;
    const onReady = vi.fn((cb: () => void) => {
      readyCallback = cb;
      return () => {};
    });

    vi.mocked(getAPI).mockReturnValue({
      canvas: {
        list: vi.fn().mockResolvedValue([]),
      },
      preset: {
        list: vi.fn().mockResolvedValue([]),
      },
      logger: {
        getRecent,
        onEntry,
      },
      onReady,
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <CanvasPage />
      </Provider>,
    );

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onEntry).toHaveBeenCalledTimes(1);
    expect(getRecent).not.toHaveBeenCalled();

    readyCallback?.();

    await waitFor(() => {
      expect(getRecent).toHaveBeenCalledTimes(1);
    });
  });

  it('does not continuously reload canvases when the project has no canvases yet', async () => {
    const listCanvases = vi.fn().mockResolvedValue([]);
    const listPresets = vi.fn().mockResolvedValue([]);

    vi.mocked(getAPI).mockReturnValue({
      canvas: {
        list: listCanvases,
      },
      preset: {
        list: listPresets,
      },
      logger: {
        getRecent: vi.fn().mockResolvedValue([]),
        onEntry: vi.fn(() => () => {}),
      },
      onReady: vi.fn(() => () => {}),
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <CanvasPage />
      </Provider>,
    );

    await waitFor(() => {
      expect(listCanvases).toHaveBeenCalled();
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(listCanvases).toHaveBeenCalledTimes(1);
  });

  it('deduplicates recent and streamed log entries and normalizes fatal entries to error', async () => {
    const store = createStore();
    let onEntryCallback:
      | ((entry: {
          id: string;
          level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
          category: string;
          message: string;
          detail?: string;
        }) => void)
      | undefined;
    let readyCallback: (() => void) | undefined;

    vi.mocked(getAPI).mockReturnValue({
      canvas: {
        list: vi.fn().mockResolvedValue([]),
      },
      preset: {
        list: vi.fn().mockResolvedValue([]),
      },
      logger: {
        getRecent: vi.fn().mockResolvedValue([
          {
            id: 'entry-1',
            level: 'info',
            category: 'startup',
            message: 'Boot complete',
          },
          {
            id: 'entry-2',
            level: 'fatal',
            category: 'provider',
            message: 'Provider crashed',
            detail: 'stack',
          },
        ]),
        onEntry: vi.fn((cb) => {
          onEntryCallback = cb;
          return () => {};
        }),
      },
      onReady: vi.fn((cb: () => void) => {
        readyCallback = cb;
        return () => {};
      }),
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={store}>
        <CanvasPage />
      </Provider>,
    );

    readyCallback?.();

    await waitFor(() => {
      expect(store.getState().logger.entries).toHaveLength(2);
    });

    onEntryCallback?.({
      id: 'entry-1',
      level: 'info',
      category: 'startup',
      message: 'Boot complete',
    });
    onEntryCallback?.({
      id: 'entry-2',
      level: 'fatal',
      category: 'provider',
      message: 'Provider crashed',
      detail: 'stack',
    });

    expect(store.getState().logger.entries).toHaveLength(2);
    expect(store.getState().logger.entries[1]).toEqual(
      expect.objectContaining({
        level: 'error',
        category: 'provider',
        message: 'Provider crashed',
      }),
    );
  });
});
