// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { setCanvases, setActiveCanvas } from '../store/slices/canvas.js';
import { clearHistory, deleteSession, setProviderId, startStreaming } from '../store/slices/commander.js';
import { setEquipment } from '../store/slices/equipment.js';
import { store } from '../store/index.js';
import { syncCommanderEntitiesForTool, useCommander } from './useCommander.js';
import { getAPI, type LucidAPI } from '../utils/api.js';
import {
  addCustomProvider,
  restore as restoreSettings,
  setBootstrapped,
  settingsSlice,
} from '../store/slices/settings.js';
import { clearLogs } from '../store/slices/logger.js';

vi.mock('../utils/api.js', () => ({
  getAPI: vi.fn(),
}));

type CommanderStreamEvent = Parameters<Parameters<LucidAPI['commander']['onStream']>[0]>[0];

describe('syncCommanderEntitiesForTool', () => {
  it('refreshes equipment state for equipment tool updates', async () => {
    const list = [{ id: 'eq-1', name: 'Lantern' }] as import('@lucid-fin/contracts').Equipment[];
    const dispatch = vi.fn();
    const api = {
      character: { list: vi.fn() },
      equipment: { list: vi.fn(async () => list) },
      location: { list: vi.fn() },
    } as unknown as Parameters<typeof syncCommanderEntitiesForTool>[0];

    await syncCommanderEntitiesForTool(
      api,
      dispatch as unknown as Parameters<typeof syncCommanderEntitiesForTool>[1],
      'equipment.create',
    );

    expect(api!.equipment?.list).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(setEquipment(list));
    expect(api!.character?.list).not.toHaveBeenCalled();
    expect(api!.location?.list).not.toHaveBeenCalled();
  });

  it('does not route scene tool updates through character refresh', async () => {
    const dispatch = vi.fn();
    const api = {
      character: { list: vi.fn() },
      equipment: { list: vi.fn() },
      location: { list: vi.fn() },
      scene: { list: vi.fn() },
    } as unknown as Parameters<typeof syncCommanderEntitiesForTool>[0];

    await syncCommanderEntitiesForTool(
      api,
      dispatch as unknown as Parameters<typeof syncCommanderEntitiesForTool>[1],
      'scene.create',
    );

    expect(api!.character?.list).not.toHaveBeenCalled();
    expect(api!.equipment?.list).not.toHaveBeenCalled();
    expect(api!.location?.list).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

function HookHarness() {
  useCommander();
  return null;
}

function SendHarness() {
  const { sendMessage } = useCommander();

  return React.createElement(
    'button',
    {
      type: 'button',
      onClick: () => void sendMessage('hello commander'),
    },
    'Send',
  );
}

afterEach(() => {
  cleanup();
  store.dispatch(clearHistory());
  store.dispatch(clearLogs());
  for (const session of store.getState().commander.sessions) {
    store.dispatch(deleteSession(session.id));
  }
  store.dispatch(setCanvases([]));
  store.dispatch(setActiveCanvas(null));
  store.dispatch(setProviderId(null));
  store.dispatch(
    restoreSettings(settingsSlice.reducer(undefined, { type: '@@INIT' })),
  );
  vi.clearAllMocks();
});

describe('useCommander stream completion', () => {
  it('blocks commander chat until backend bootstrap finishes', async () => {
    const chat = vi.fn().mockResolvedValue(undefined);

    vi.mocked(getAPI).mockReturnValue({
      settings: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      commander: {
        chat,
        onStream: () => () => {},
        onCanvasUpdated: () => () => {},
        onEntitiesUpdated: () => () => {},
        onSettingsDispatch: () => () => {},
        onUndoDispatch: () => () => {},
      },
    } as never);

    store.dispatch(setCanvases([{
      id: 'canvas-1',
      name: 'Main',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: 1,
      updatedAt: 1,
      notes: [],
    }]));
    store.dispatch(setActiveCanvas('canvas-1'));

    const { getByRole } = render(
      React.createElement(Provider, {
        store,
        children: React.createElement(SendHarness),
      }),
    );

    await act(async () => {
      getByRole('button', { name: 'Send' }).click();
    });

    await waitFor(() => {
      expect(chat).not.toHaveBeenCalled();
      expect(store.getState().commander.error).toBe(
        'Commander backend is still starting. Wait for the app to finish loading and try again.',
      );
      expect(store.getState().logger.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'error',
            category: 'commander',
            message: 'Commander backend is still starting. Wait for the app to finish loading and try again.',
          }),
        ]),
      );
    });
  });

  it('persists streamed content when the done event completes the session', async () => {
    let onStream: ((data: CommanderStreamEvent) => void) | undefined;

    vi.mocked(getAPI).mockReturnValue({
      settings: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      commander: {
        onStream: (cb: Parameters<LucidAPI['commander']['onStream']>[0]) => {
          onStream = cb;
          return () => {};
        },
        onCanvasUpdated: () => () => {},
        onEntitiesUpdated: () => () => {},
        onSettingsDispatch: () => () => {},
        onUndoDispatch: () => () => {},
      },
    } as never);

    store.dispatch(setCanvases([{
      id: 'canvas-1',
      name: 'Main',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: 1,
      updatedAt: 1,
      notes: [],
    }]));
    store.dispatch(setActiveCanvas('canvas-1'));
    store.dispatch(startStreaming());

    render(React.createElement(Provider, { store, children: React.createElement(HookHarness) }));

    await act(async () => {
      onStream?.({ type: 'chunk', content: 'Final answer' });
      onStream?.({ type: 'done' });
    });

    await waitFor(() => {
      expect(store.getState().commander.messages).toEqual([
        expect.objectContaining({
          role: 'assistant',
          content: 'Final answer',
        }),
      ]);
    });

    expect(store.getState().logger.entries).toEqual([]);
  });

  it('uses the commander-selected provider instead of settings-owned active provider', async () => {
    const chat = vi.fn().mockResolvedValue(undefined);

    vi.mocked(getAPI).mockReturnValue({
      settings: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      commander: {
        chat,
        onStream: () => () => {},
        onCanvasUpdated: () => () => {},
        onEntitiesUpdated: () => () => {},
        onSettingsDispatch: () => () => {},
        onUndoDispatch: () => () => {},
      },
    } as never);

    store.dispatch(setCanvases([{
      id: 'canvas-1',
      name: 'Main',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: 1,
      updatedAt: 1,
      notes: [],
    }]));
    store.dispatch(setActiveCanvas('canvas-1'));
    store.dispatch(setBootstrapped());
    store.dispatch(
      addCustomProvider({
        group: 'llm',
        id: 'custom-llm-test',
        name: 'Custom LLM',
        baseUrl: 'https://custom.example/v1',
        model: 'custom-model',
      }),
    );
    store.dispatch(setProviderId('custom-llm-test'));

    const { getByRole } = render(
      React.createElement(Provider, {
        store,
        children: React.createElement(SendHarness),
      }),
    );

    await act(async () => {
      getByRole('button', { name: 'Send' }).click();
    });

    await waitFor(() => {
      expect(chat).toHaveBeenCalledTimes(1);
    });

    const [canvasId, message, history, selectedNodeIds, activeTemplates, provider, permissionMode] =
      chat.mock.calls[0]!;

    expect(canvasId).toBe('canvas-1');
    expect(message).toBe('hello commander');
    expect(history).toEqual([]);
    expect(selectedNodeIds).toEqual([]);
    expect(Array.isArray(activeTemplates)).toBe(true);
    expect(provider).toEqual(
      expect.objectContaining({
        id: 'custom-llm-test',
        baseUrl: 'https://custom.example/v1',
        model: 'custom-model',
      }),
    );
    expect(permissionMode).toBe('normal');
  });

  it('sends workflow and skill guides alongside prompt templates', async () => {
    const chat = vi.fn().mockResolvedValue(undefined);

    vi.mocked(getAPI).mockReturnValue({
      settings: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      commander: {
        chat,
        onStream: () => () => {},
        onCanvasUpdated: () => () => {},
        onEntitiesUpdated: () => () => {},
        onSettingsDispatch: () => () => {},
        onUndoDispatch: () => () => {},
      },
    } as never);

    store.dispatch(setCanvases([{
      id: 'canvas-1',
      name: 'Main',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: 1,
      updatedAt: 1,
      notes: [],
    }]));
    store.dispatch(setActiveCanvas('canvas-1'));
    store.dispatch(setBootstrapped());

    const { getByRole } = render(
      React.createElement(Provider, {
        store,
        children: React.createElement(SendHarness),
      }),
    );

    await act(async () => {
      getByRole('button', { name: 'Send' }).click();
    });

    await waitFor(() => {
      expect(chat).toHaveBeenCalledTimes(1);
    });

    const promptGuides = chat.mock.calls[0]?.[4] as Array<{ id: string; name: string; content: string }>;

    expect(promptGuides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'meta-prompt' }),
        expect.objectContaining({ id: 'wf-video-clone' }),
        expect.objectContaining({ id: 'sk-lip-sync' }),
      ]),
    );
  });

  it('creates one stable session id for the first auto snapshot and chat request', async () => {
    const chat = vi.fn().mockResolvedValue(undefined);
    const upsert = vi.fn().mockResolvedValue(undefined);
    const capture = vi.fn().mockResolvedValue({
      id: 'snap-1',
      sessionId: 'session-1',
      label: 'Before Commander session',
      trigger: 'auto',
      createdAt: 1,
    });

    vi.mocked(getAPI).mockReturnValue({
      settings: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      session: {
        upsert,
      },
      snapshot: {
        capture,
      },
      canvas: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      commander: {
        chat,
        onStream: () => () => {},
        onCanvasUpdated: () => () => {},
        onEntitiesUpdated: () => () => {},
        onSettingsDispatch: () => () => {},
        onUndoDispatch: () => () => {},
      },
    } as never);

    store.dispatch(setCanvases([{
      id: 'canvas-1',
      name: 'Main',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: 1,
      updatedAt: 1,
      notes: [],
    }]));
    store.dispatch(setActiveCanvas('canvas-1'));
    store.dispatch(setBootstrapped());

    const { getByRole } = render(
      React.createElement(Provider, {
        store,
        children: React.createElement(SendHarness),
      }),
    );

    await act(async () => {
      getByRole('button', { name: 'Send' }).click();
    });

    await waitFor(() => {
      expect(chat).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledTimes(1);
    });

    const [stubSession] = upsert.mock.calls[0] as [{
      id: string;
      canvasId: string | null;
      title: string;
      messages: string;
      createdAt: number;
      updatedAt: number;
    }];

    expect(stubSession.id).not.toBe('canvas-1');
    expect(capture).toHaveBeenCalledWith(stubSession.id, 'Before Commander session', 'auto');
    expect(chat.mock.calls[0]?.[11]).toBe(stubSession.id);
  });

  it('captures the auto snapshot only once per session', async () => {
    let onStream: ((data: CommanderStreamEvent) => void) | undefined;
    const chat = vi.fn().mockResolvedValue(undefined);
    const capture = vi.fn().mockResolvedValue({
      id: 'snap-1',
      sessionId: 'session-1',
      label: 'Before Commander session',
      trigger: 'auto',
      createdAt: 1,
    });

    vi.mocked(getAPI).mockReturnValue({
      settings: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      session: {
        upsert: vi.fn().mockResolvedValue(undefined),
      },
      snapshot: {
        capture,
      },
      canvas: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      commander: {
        chat,
        onStream: (cb: Parameters<LucidAPI['commander']['onStream']>[0]) => {
          onStream = cb;
          return () => {};
        },
        onCanvasUpdated: () => () => {},
        onEntitiesUpdated: () => () => {},
        onSettingsDispatch: () => () => {},
        onUndoDispatch: () => () => {},
      },
    } as never);

    store.dispatch(setCanvases([{
      id: 'canvas-1',
      name: 'Main',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: 1,
      updatedAt: 1,
      notes: [],
    }]));
    store.dispatch(setActiveCanvas('canvas-1'));
    store.dispatch(setBootstrapped());

    const { getByRole } = render(
      React.createElement(Provider, {
        store,
        children: React.createElement(SendHarness),
      }),
    );

    await act(async () => {
      getByRole('button', { name: 'Send' }).click();
    });

    await waitFor(() => {
      expect(chat).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      onStream?.({ type: 'done' });
    });

    await waitFor(() => {
      expect(store.getState().commander.activeSessionId).toBeTruthy();
    });

    await act(async () => {
      getByRole('button', { name: 'Send' }).click();
    });

    await waitFor(() => {
      expect(chat).toHaveBeenCalledTimes(2);
    });

    expect(capture).toHaveBeenCalledTimes(1);
  });
});
