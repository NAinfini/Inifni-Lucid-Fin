// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { setCanvases, setActiveCanvas } from '../store/slices/canvas/canvas.js';
import {
  deleteSession,
  ensureActiveSession,
  setProviderId,
  startStreaming,
} from '../store/slices/commander.js';
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
import { resetTimeline } from '../commander/state/commander-timeline-slice.js';

vi.mock('../utils/api.js', () => ({
  getAPI: vi.fn(),
}));

type CommanderStartRequest = Parameters<LucidAPI['commander']['start']>[0];

function createStartMock() {
  return vi.fn(async (request: CommanderStartRequest) => ({
    runId: 'run-started',
    sessionId: request.sessionId,
    acceptedAt: 1,
  }));
}

function createCommanderStub(overrides: Partial<LucidAPI['commander']> = {}) {
  return {
    start: createStartMock(),
    eventsHydrate: vi.fn(async ({ runId }: { runId: string }) => ({
      run: {
        id: runId,
        sessionId: 'session-1',
        defaultCanvasId: 'canvas-1',
        authorizedCanvasIds: ['canvas-1'],
        intent: 'hello commander',
        status: 'running' as const,
        acceptedAt: 1,
        startedAt: 1,
        lastSeq: 0,
        attachments: [],
      },
      events: [],
    })),
    onStream: () => () => {},
    onCanvasDispatch: () => () => {},
    onEntitiesUpdated: () => () => {},
    onSettingsDispatch: () => () => {},
    ...overrides,
  };
}

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
  store.dispatch(clearLogs());
  for (const session of store.getState().commander.sessions) {
    store.dispatch(resetTimeline(session.id));
    store.dispatch(deleteSession(session.id));
  }
  store.dispatch(setCanvases([]));
  store.dispatch(setActiveCanvas(null));
  store.dispatch(setProviderId(null));
  store.dispatch(restoreSettings(settingsSlice.reducer(undefined, { type: '@@INIT' })));
  vi.clearAllMocks();
});

describe('useCommander stream completion', () => {
  it('blocks commander chat until backend bootstrap finishes', async () => {
    const start = createStartMock();

    vi.mocked(getAPI).mockReturnValue({
      settings: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      canvas: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      commander: createCommanderStub({ start }),
    } as never);

    store.dispatch(
      setCanvases([
        {
          id: 'canvas-1',
          name: 'Main',
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          createdAt: 1,
          updatedAt: 1,
          notes: [],
        },
      ]),
    );
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
      expect(start).not.toHaveBeenCalled();
      expect(store.getState().logger.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'error',
            category: 'commander',
            message:
              'Commander backend is still starting. Wait for the app to finish loading and try again.',
          }),
        ]),
      );
    });
  });

  it('persists streamed content when the done event completes the session', async () => {
    let onStream: Parameters<LucidAPI['commander']['onStream']>[0] | undefined;

    vi.mocked(getAPI).mockReturnValue({
      settings: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      commander: createCommanderStub({
        onStream: (cb: Parameters<LucidAPI['commander']['onStream']>[0]) => {
          onStream = cb;
          return () => {};
        },
      }),
    } as never);

    store.dispatch(
      setCanvases([
        {
          id: 'canvas-1',
          name: 'Main',
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          createdAt: 1,
          updatedAt: 1,
          notes: [],
        },
      ]),
    );
    store.dispatch(setActiveCanvas('canvas-1'));
    store.dispatch(ensureActiveSession({ id: 'session-1', defaultCanvasId: 'canvas-1' }));
    store.dispatch(startStreaming('session-1'));

    render(React.createElement(Provider, { store, children: React.createElement(HookHarness) }));

    await act(async () => {
      onStream?.({
        wireVersion: 2,
        sessionId: 'session-1',
        event: {
          kind: 'assistant_text',
          content: 'Final answer',
          isDelta: false,
          runId: 'r',
          step: 1,
          seq: 0,
          emittedAt: 0,
        },
      });
      onStream?.({
        wireVersion: 2,
        sessionId: 'session-1',
        event: { kind: 'run_end', status: 'completed', runId: 'r', step: 1, seq: 1, emittedAt: 0 },
      });
    });

    await waitFor(() => {
      expect(store.getState().commander.sessions[0]?.messages).toEqual([
        expect.objectContaining({
          role: 'assistant',
          content: 'Final answer',
        }),
      ]);
    });

    expect(store.getState().logger.entries).toEqual([]);
  });

  it('uses the commander-selected provider instead of settings-owned active provider', async () => {
    const start = createStartMock();

    vi.mocked(getAPI).mockReturnValue({
      settings: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      canvas: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      commander: createCommanderStub({ start }),
    } as never);

    store.dispatch(
      setCanvases([
        {
          id: 'canvas-1',
          name: 'Main',
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          createdAt: 1,
          updatedAt: 1,
          notes: [],
        },
      ]),
    );
    store.dispatch(setActiveCanvas('canvas-1'));
    store.dispatch(setBootstrapped());
    store.dispatch(ensureActiveSession({ id: 'session-1', defaultCanvasId: 'canvas-1' }));
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
      expect(start).toHaveBeenCalledTimes(1);
    });

    const request = start.mock.calls[0]?.[0];

    expect(request.defaultCanvasId).toBe('canvas-1');
    expect(request.authorizedCanvasIds).toEqual(['canvas-1']);
    expect(request.intent).toEqual({ kind: 'user_message', message: 'hello commander' });
    expect(request.selectedNodes).toEqual([]);
    expect(Array.isArray(request.promptGuides)).toBe(true);
    expect(request.customLLMProvider).toEqual(
      expect.objectContaining({
        id: 'custom-llm-test',
        baseUrl: 'https://custom.example/v1',
        model: 'custom-model',
      }),
    );
    expect(request.permissionMode).toBe('normal');
  });

  it('sends task-list and skill guides alongside prompt templates', async () => {
    const start = createStartMock();

    vi.mocked(getAPI).mockReturnValue({
      settings: {
        save: vi.fn().mockResolvedValue(undefined),
      },
      commander: createCommanderStub({ start }),
    } as never);

    store.dispatch(
      setCanvases([
        {
          id: 'canvas-1',
          name: 'Main',
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          createdAt: 1,
          updatedAt: 1,
          notes: [],
        },
      ]),
    );
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
      expect(start).toHaveBeenCalledTimes(1);
    });

    const promptGuides = start.mock.calls[0]?.[0].promptGuides as Array<{
      id: string;
      name: string;
      content: string;
    }>;

    expect(promptGuides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'meta-prompt' }),
        expect.objectContaining({ id: 'task-style-transfer' }),
      ]),
    );
  });

  it('creates one stable session id for the first auto snapshot and chat request', async () => {
    const start = createStartMock();
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
      commander: createCommanderStub({ start }),
    } as never);

    store.dispatch(
      setCanvases([
        {
          id: 'canvas-1',
          name: 'Main',
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          createdAt: 1,
          updatedAt: 1,
          notes: [],
        },
      ]),
    );
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
      expect(start).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledTimes(2);
      expect(capture).toHaveBeenCalledTimes(1);
    });

    const persistedSessions = upsert.mock.calls.map(([session]) => session) as Array<
      {
        id: string;
        defaultCanvasId: string | null;
        title: string;
        messages: string;
        createdAt: number;
        updatedAt: number;
      }
    >;
    const stubSession = persistedSessions[0]!;

    expect(stubSession.id).not.toBe('canvas-1');
    expect(new Set(persistedSessions.map(({ id }) => id))).toEqual(new Set([stubSession.id]));
    expect(JSON.parse(persistedSessions[0]!.messages)).toEqual([]);
    expect(JSON.parse(persistedSessions[1]!.messages)).toHaveLength(1);
    expect(capture).toHaveBeenCalledWith(stubSession.id, 'Before Commander session', 'auto');
    expect(start.mock.calls[0]?.[0].sessionId).toBe(stubSession.id);
  });

  it('captures the auto snapshot only once per session', async () => {
    let onStream: Parameters<LucidAPI['commander']['onStream']>[0] | undefined;
    const start = createStartMock();
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
      commander: createCommanderStub({
        start,
        onStream: (cb: Parameters<LucidAPI['commander']['onStream']>[0]) => {
          onStream = cb;
          return () => {};
        },
      }),
    } as never);

    store.dispatch(
      setCanvases([
        {
          id: 'canvas-1',
          name: 'Main',
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          createdAt: 1,
          updatedAt: 1,
          notes: [],
        },
      ]),
    );
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
      expect(start).toHaveBeenCalledTimes(1);
      expect(capture).toHaveBeenCalledTimes(1);
    });

    const sessionId = start.mock.calls[0]![0].sessionId;

    await act(async () => {
      onStream?.({
        wireVersion: 2,
        sessionId,
        event: {
          kind: 'run_start',
          workType: 'agent',
          intent: 'hello commander',
          runId: 'r',
          step: 0,
          seq: 0,
          emittedAt: 0,
          resourceBudget: {},
        },
      });
      onStream?.({
        wireVersion: 2,
        sessionId,
        event: { kind: 'run_end', status: 'completed', runId: 'r', step: 1, seq: 1, emittedAt: 1 },
      });
    });

    await waitFor(() => {
      expect(
        store.getState().commander.sessions.find((session) => session.id === sessionId)?.runtime
          .phase.kind,
      ).toBe('idle');
    });

    await act(async () => {
      getByRole('button', { name: 'Send' }).click();
    });

    await waitFor(() => {
      expect(start).toHaveBeenCalledTimes(2);
    });

    expect(capture).toHaveBeenCalledTimes(1);
  });
});
