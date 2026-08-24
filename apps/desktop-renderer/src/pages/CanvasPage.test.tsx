// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasPage } from './CanvasPage.js';
import { getAPI } from '../utils/api.js';
import { addCanvas, canvasReducer, setActiveCanvas } from '../store/slices/canvas/canvas.js';
import {
  LEFT_CANVAS_PANEL_WIDTH_STORAGE_KEY,
  RIGHT_CANVAS_PANEL_WIDTH_STORAGE_KEY,
  setActivePanel,
  setPanelWidth,
  setRightPanel,
  setRightPanelWidth,
  uiSlice,
} from '../store/slices/ui.js';
import { settingsSlice, setBootstrapped } from '../store/slices/settings.js';
import { presetsSlice } from '../store/slices/presets.js';
import { loggerSlice } from '../store/slices/logger.js';
import { commanderSlice } from '../store/slices/commander.js';
import { taskListsSlice } from '../store/slices/task-lists.js';

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

function createStore(bootstrapped = true) {
  const store = configureStore({
    reducer: {
      canvas: canvasReducer,
      ui: uiSlice.reducer,
      settings: settingsSlice.reducer,
      presets: presetsSlice.reducer,
      logger: loggerSlice.reducer,
      commander: commanderSlice.reducer,
      taskLists: taskListsSlice.reducer,
    },
  });

  if (bootstrapped) store.dispatch(setBootstrapped());

  return store;
}

describe('CanvasPage logger startup', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('shows only the selected left panel and keeps its width separate from the right panel', async () => {
    vi.mocked(getAPI).mockReturnValue({
      preset: { list: vi.fn().mockResolvedValue([]) },
      logger: {
        getRecent: vi.fn().mockResolvedValue([]),
        onEntry: vi.fn(() => () => {}),
      },
      onReady: vi.fn(() => () => {}),
    } as unknown as ReturnType<typeof getAPI>);

    const store = createStore();
    store.dispatch(
      addCanvas({
        id: 'canvas-panel-widths',
        name: 'Canvas panel widths',
        nodes: [],
        edges: [],
        notes: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    store.dispatch(setActiveCanvas('canvas-panel-widths'));
    store.dispatch(setActivePanel('history'));
    store.dispatch(setRightPanel('inspector'));
    store.dispatch(setPanelWidth(350));
    store.dispatch(setRightPanelWidth(400));

    render(
      <Provider store={store}>
        <CanvasPage />
      </Provider>,
    );

    const leftPanel = (await screen.findByText('HistoryPanel')).parentElement;
    expect(screen.queryByText('AssetBrowserPanel')).toBeNull();
    const rightPanel = (await screen.findByText('InspectorPanel')).parentElement;
    expect(leftPanel?.style.width).toBe('350px');
    expect(rightPanel?.style.width).toBe('400px');

    await act(async () => {
      store.dispatch(setRightPanel('presets'));
    });
    expect(await screen.findByText('PresetManagerPanel')).toBeTruthy();
    expect(screen.getByText('HistoryPanel')).toBeTruthy();

    await act(async () => {
      store.dispatch(setRightPanel('shotTemplates'));
    });
    expect(await screen.findByText('ShotTemplateManagerPanel')).toBeTruthy();

    const handles = document.querySelectorAll('.cursor-col-resize');
    fireEvent.mouseDown(handles[0]!, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 200 });
    fireEvent.mouseUp(document);
    fireEvent.mouseDown(handles[1]!, { clientX: 500 });
    fireEvent.mouseMove(document, { clientX: 350 });
    fireEvent.mouseUp(document);

    await waitFor(() => {
      expect(store.getState().ui.panelWidth).toBe(450);
      expect(store.getState().ui.rightPanelWidth).toBe(500);
    });
    expect(localStorage.getItem(LEFT_CANVAS_PANEL_WIDTH_STORAGE_KEY)).toBe('450');
    expect(localStorage.getItem(RIGHT_CANVAS_PANEL_WIDTH_STORAGE_KEY)).toBe('500');
  });

  it('keeps chat history hidden by default and can open it without a Canvas', async () => {
    vi.mocked(getAPI).mockReturnValue({
      canvas: { loadAll: vi.fn().mockResolvedValue([]) },
      preset: { list: vi.fn().mockResolvedValue([]) },
      logger: {
        getRecent: vi.fn().mockResolvedValue([]),
        onEntry: vi.fn(() => () => {}),
      },
      onReady: vi.fn(() => () => {}),
    } as unknown as ReturnType<typeof getAPI>);

    const store = createStore();
    render(
      <Provider store={store}>
        <CanvasPage />
      </Provider>,
    );

    expect(screen.queryByText('HistoryPanel')).toBeNull();
    store.dispatch(setActivePanel('history'));
    expect(await screen.findByText('HistoryPanel')).toBeTruthy();

    store.dispatch(setActivePanel(null));
    await waitFor(() => expect(screen.queryByText('HistoryPanel')).toBeNull());
  });

  it('does not load the commander panel module until it is opened', async () => {
    vi.mocked(getAPI).mockReturnValue({
      canvas: {
        loadAll: vi.fn().mockResolvedValue([]),
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
        loadAll: vi.fn().mockResolvedValue([]),
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
    const loadAllCanvases = vi.fn().mockResolvedValue([]);
    const listPresets = vi.fn().mockResolvedValue([]);

    vi.mocked(getAPI).mockReturnValue({
      canvas: {
        loadAll: loadAllCanvases,
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
      expect(loadAllCanvases).toHaveBeenCalled();
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(loadAllCanvases).toHaveBeenCalledTimes(1);
  });

  it('does not call Canvas IPC before the backend is ready', () => {
    const createCanvas = vi.fn();
    vi.mocked(getAPI).mockReturnValue({
      canvas: { create: createCanvas },
      preset: { list: vi.fn().mockResolvedValue([]) },
      logger: {
        getRecent: vi.fn().mockResolvedValue([]),
        onEntry: vi.fn(() => () => {}),
      },
      onReady: vi.fn(() => () => {}),
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore(false)}>
        <CanvasPage />
      </Provider>,
    );

    const createButton = screen.getByRole('button', {
      name: /starting workspace|正在启动工作区/i,
    });
    expect(createButton.hasAttribute('disabled')).toBe(true);
    fireEvent.click(createButton);
    expect(createCanvas).not.toHaveBeenCalled();
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
        loadAll: vi.fn().mockResolvedValue([]),
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

  it('opens Commander once for a newly projected plan approval', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const listTaskLists = vi.fn().mockResolvedValue([
      {
        id: 'task-list-canvas-1',
        taskListType: 'movie.production.v2',
        entityType: 'canvas',
        entityId: 'canvas-1',
        triggerSource: 'commander',
        status: 'awaiting_approval',
        summary: 'Production Plan awaiting approval',
        progress: 0,
        completedPhases: 0,
        totalPhases: 4,
        completedTasks: 0,
        totalTasks: 12,
        createdAt: 1,
        updatedAt: 2,
        rowVersion: 1,
      },
    ]);

    vi.mocked(getAPI).mockReturnValue({
      canvas: {
        loadAll: vi.fn().mockResolvedValue([
          {
            id: 'canvas-1',
            name: 'Production canvas',
            nodes: [],
            edges: [],
            notes: [],
            viewport: { x: 0, y: 0, zoom: 1 },
            createdAt: 1,
            updatedAt: 1,
          },
        ]),
      },
      preset: { list: vi.fn().mockResolvedValue([]) },
      taskLists: { list: listTaskLists },
      logger: {
        getRecent: vi.fn().mockResolvedValue([]),
        onEntry: vi.fn(() => () => {}),
      },
      onReady: vi.fn(() => () => {}),
    } as unknown as ReturnType<typeof getAPI>);

    const store = createStore();
    render(
      <React.StrictMode>
        <Provider store={store}>
          <CanvasPage />
        </Provider>
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(listTaskLists).toHaveBeenCalledWith({ entityType: 'canvas' });
      expect(screen.getByText('CommanderPanel')).toBeTruthy();
    });

    expect(store.getState().ui.rightPanel).toBeNull();
    expect(store.getState().commander.open).toBe(true);
    expect(
      consoleWarn.mock.calls.filter(([message]) =>
        String(message).includes('returned a different result'),
      ),
    ).toHaveLength(0);

    await act(async () => {
      store.dispatch(commanderSlice.actions.setCommanderOpen(false));
    });
    await waitFor(() => expect(screen.queryByText('CommanderPanel')).toBeNull());
    expect(store.getState().commander.open).toBe(false);
  });
});
