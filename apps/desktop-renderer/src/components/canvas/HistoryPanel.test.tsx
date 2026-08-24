// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { Canvas, TimelineEvent } from '@lucid-fin/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, t } from '../../i18n.js';
import { canvasSlice, setActiveCanvas } from '../../store/slices/canvas/canvas.js';
import {
  commanderSlice,
  type CommanderSession,
} from '../../store/slices/commander.js';
import { createCommanderSessionRuntime } from '../../commander/state/helpers.js';
import { toastSlice } from '../../store/slices/toast.js';
import { commanderTimelineSlice } from '../../commander/state/commander-timeline-slice.js';
import { getAPI } from '../../utils/api.js';
import { HistoryPanel } from './HistoryPanel.js';

vi.mock('../../utils/api.js', () => ({
  getAPI: vi.fn(() => null),
}));

vi.mock('../ui/ConfirmDialog.js', () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true), ConfirmDialog: null }),
}));

function createCanvas(id: string, name: string, archivedAt?: number): Canvas {
  return {
    id,
    name,
    nodes: [],
    edges: [],
    notes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: 1,
    updatedAt: 1,
    ...(archivedAt === undefined ? {} : { archivedAt }),
  };
}

function createSession(
  id: string,
  title: string,
  defaultCanvasId: string | null,
  updatedAt: number,
): CommanderSession {
  return {
    id,
    title,
    defaultCanvasId,
    runtime: createCommanderSessionRuntime(),
    createdAt: updatedAt,
    updatedAt,
    messages: [
      {
        id: `${id}-message`,
        role: 'user',
        content: title,
        timestamp: updatedAt,
      },
    ],
    messageCount: 1,
  };
}

function defaultSessions() {
  return [
    createSession('unassigned', 'General planning', null, 1),
    createSession('canvas-a-older', 'Opening scene', 'canvas-a', 2),
    createSession('canvas-a-newer', 'Shot revisions', 'canvas-a', 4),
    createSession('canvas-b', 'Final cut', 'canvas-b', 3),
  ];
}

function renderHistoryPanel(
  sessions = defaultSessions(),
  canvases = [createCanvas('canvas-a', 'Canvas A'), createCanvas('canvas-b', 'Canvas B')],
) {
  const store = configureStore({
    reducer: {
      canvas: canvasSlice.reducer,
      commander: commanderSlice.reducer,
      commanderTimeline: commanderTimelineSlice.reducer,
      toast: toastSlice.reducer,
    },
    preloadedState: {
      commander: {
        ...commanderSlice.getInitialState(),
        activeSessionId: 'unassigned',
        sessions,
      },
    },
  });

  store.dispatch(canvasSlice.actions.setCanvases(canvases));
  store.dispatch(setActiveCanvas('canvas-a'));

  render(
    <Provider store={store}>
      <HistoryPanel />
    </Provider>,
  );

  return store;
}

function appendActivityEvents(
  store: ReturnType<typeof renderHistoryPanel>,
  sessionId: string,
  events: TimelineEvent[],
) {
  for (const event of events) {
    store.dispatch(commanderTimelineSlice.actions.appendEvent({ sessionId, event }));
  }
}

function runStart(
  runId: string,
  emittedAt: number,
  parentRunId?: string,
): Extract<TimelineEvent, { kind: 'run_start' }> {
  return {
    kind: 'run_start',
    runId,
    step: 0,
    seq: 0,
    emittedAt,
    intent: 'private intent is not displayed in History',
    resourceBudget: {},
    workType: parentRunId ? 'subagent' : 'agent',
    ...(parentRunId ? { parentRunId } : {}),
    displayName: parentRunId ? 'Continuity review' : 'Production planner',
  };
}

function runEnd(
  runId: string,
  emittedAt: number,
): Extract<TimelineEvent, { kind: 'run_end' }> {
  return { kind: 'run_end', runId, step: 1, seq: 1, emittedAt, status: 'completed' };
}

function openCanvasActions(canvasName: string) {
  fireEvent.pointerDown(
    screen.getByRole('button', { name: `${t('history.canvasActions')} — ${canvasName}` }),
    { button: 0, ctrlKey: false },
  );
}

describe('HistoryPanel', () => {
  beforeEach(() => {
    setLocale('en-US');
    vi.mocked(getAPI).mockReturnValue({} as never);
  });

  afterEach(cleanup);

  it('groups all sessions by canvas and selects the matching canvas with a chat', async () => {
    const store = renderHistoryPanel();

    expect(screen.getByRole('button', { name: t('commander.newChat') })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unassigned (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Canvas A (2)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Canvas B (1)' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: `${t('history.loadSession')} — Final cut` }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: `${t('history.loadSession')} — Final cut` }),
    );

    await waitFor(() => {
      expect(store.getState().commander.activeSessionId).toBe('canvas-b');
      expect(store.getState().canvas.activeCanvasId).toBe('canvas-b');
    });
  });

  it('creates an unassigned chat from the top action and a bound chat from a group action', () => {
    const store = renderHistoryPanel();

    fireEvent.click(screen.getByRole('button', { name: t('commander.newChat') }));
    expect(
      store
        .getState()
        .commander.sessions.find(
          (session) => session.id === store.getState().commander.activeSessionId,
        )?.defaultCanvasId,
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: `${t('commander.newChat')} — Canvas A` }));
    expect(
      store
        .getState()
        .commander.sessions.find(
          (session) => session.id === store.getState().commander.activeSessionId,
        )?.defaultCanvasId,
    ).toBe('canvas-a');
  });

  it('uses the shared public activity tree for a descendant indicator, focus, and terminal cleanup', async () => {
    const store = renderHistoryPanel();
    const activityLabel = t('commander.agentActivity.activeUnitsLabel').replace('{count}', '2');

    expect(screen.queryByRole('button', { name: activityLabel })).toBeNull();
    appendActivityEvents(store, 'canvas-b', [
      runStart('root-run', 100),
      runStart('child-run', 110, 'root-run'),
    ]);

    const indicator = await screen.findByRole('button', { name: activityLabel });
    fireEvent.click(indicator);
    await waitFor(() => {
      expect(store.getState().commander.activeSessionId).toBe('canvas-b');
      expect(store.getState().commander.activityFocus).toEqual({
        sessionId: 'canvas-b',
        runId: 'root-run',
      });
    });

    appendActivityEvents(store, 'canvas-b', [runEnd('child-run', 120), runEnd('root-run', 130)]);
    await waitFor(() => expect(screen.queryByRole('button', { name: activityLabel })).toBeNull());
  });

  it('hydrates every public run in a session tree before deriving the History indicator', async () => {
    const root = runStart('root-run', 100);
    const child = runStart('child-run', 110, 'root-run');
    const runTree = vi.fn().mockResolvedValue({ runs: [{ id: 'root-run' }, { id: 'child-run' }] });
    const eventsHydrate = vi.fn(({ runId }: { runId: string }) =>
      Promise.resolve({ events: runId === 'root-run' ? [root] : [child] }),
    );
    vi.mocked(getAPI).mockReturnValue({ commander: { runTree, eventsHydrate } } as never);

    renderHistoryPanel([createSession('session-tree', 'Tree session', null, 1)], []);

    await waitFor(() => expect(runTree).toHaveBeenCalledWith({ sessionId: 'session-tree' }));
    await waitFor(() => {
      expect(eventsHydrate).toHaveBeenCalledWith({ runId: 'root-run', afterSeq: -1 });
      expect(eventsHydrate).toHaveBeenCalledWith({ runId: 'child-run', afterSeq: -1 });
    });
    expect(
      await screen.findByRole('button', {
        name: t('commander.agentActivity.activeUnitsLabel').replace('{count}', '2'),
      }),
    ).toBeTruthy();
  });

  it('shows Canvas actions only for Canvas groups and opens the selected Canvas', async () => {
    const store = renderHistoryPanel();

    expect(
      screen.queryByRole('button', {
        name: `${t('history.canvasActions')} — ${t('history.unassigned')}`,
      }),
    ).toBeNull();

    openCanvasActions('Canvas B');
    expect(await screen.findByRole('menuitem', { name: t('history.openCanvas') })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: t('panels.renameCanvas') })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: t('history.archiveCanvas') })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: t('history.openCanvas') }));

    await waitFor(() => expect(store.getState().canvas.activeCanvasId).toBe('canvas-b'));
  });

  it('renames a Canvas through its group actions menu', async () => {
    const rename = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getAPI).mockReturnValue({ canvas: { rename } } as never);
    const store = renderHistoryPanel();

    openCanvasActions('Canvas A');
    fireEvent.click(await screen.findByRole('menuitem', { name: t('panels.renameCanvas') }));

    const input = await screen.findByRole('textbox', {
      name: `${t('panels.renameCanvas')} — Canvas A`,
    });
    fireEvent.change(input, { target: { value: 'Renamed Canvas' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(rename).toHaveBeenCalledWith('canvas-a', 'Renamed Canvas'));
    expect(store.getState().canvas.canvases.entities['canvas-a']?.name).toBe('Renamed Canvas');
  });

  it('archives a Canvas without moving its chats to Unassigned', async () => {
    const archiveCanvas = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getAPI).mockReturnValue({ canvas: { delete: archiveCanvas } } as never);
    const store = renderHistoryPanel();

    openCanvasActions('Canvas B');
    fireEvent.click(await screen.findByRole('menuitem', { name: t('history.archiveCanvas') }));

    await waitFor(() => expect(archiveCanvas).toHaveBeenCalledWith('canvas-b'));
    expect(store.getState().canvas.canvases.entities['canvas-b']?.archivedAt).toBeTypeOf('number');
    expect(
      store.getState().commander.sessions.find((session) => session.id === 'canvas-b')
        ?.defaultCanvasId,
    ).toBe('canvas-b');
  });

  it('restores or permanently deletes an archived Canvas from its group menu', async () => {
    const restore = vi.fn().mockResolvedValue(undefined);
    const deletePermanent = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getAPI).mockReturnValue({ canvas: { restore, deletePermanent } } as never);
    const store = renderHistoryPanel(defaultSessions(), [
      createCanvas('canvas-a', 'Canvas A'),
      createCanvas('canvas-b', 'Canvas B', 10),
    ]);

    openCanvasActions('Canvas B');
    fireEvent.click(await screen.findByRole('menuitem', { name: t('history.restoreCanvas') }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith('canvas-b'));
    expect(store.getState().canvas.canvases.entities['canvas-b']?.archivedAt).toBeUndefined();

    store.dispatch({ type: 'canvas/archiveCanvas', payload: { id: 'canvas-b', archivedAt: 20 } });
    openCanvasActions('Canvas B');
    fireEvent.click(await screen.findByRole('menuitem', { name: t('history.deletePermanently') }));
    await waitFor(() => expect(deletePermanent).toHaveBeenCalledWith('canvas-b'));
    expect(store.getState().canvas.canvases.entities['canvas-b']).toBeUndefined();
    expect(
      store.getState().commander.sessions.find((session) => session.id === 'canvas-b')
        ?.defaultCanvasId,
    ).toBeNull();
  });

  it('keeps a session when the backend rejects deletion and reports the failure', async () => {
    const deleteSession = vi.fn().mockRejectedValue(new Error('session has an active run'));
    vi.mocked(getAPI).mockReturnValue({ session: { delete: deleteSession } } as never);
    const store = renderHistoryPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Delete session — Final cut' }));

    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith('canvas-b'));
    expect(store.getState().commander.sessions.some((session) => session.id === 'canvas-b')).toBe(
      true,
    );
    expect(store.getState().toast.items).toEqual([
      expect.objectContaining({
        variant: 'error',
        title: t('history.sessionDeleteFailed'),
        message: 'session has an active run',
      }),
    ]);
  });

  it('does not activate a lazy session when its persisted messages are invalid', async () => {
    const sessions = defaultSessions();
    const target = sessions.find((session) => session.id === 'canvas-b')!;
    target.messages = [];
    target.messageCount = 12;
    const get = vi.fn().mockResolvedValue({ messages: '{}' });
    vi.mocked(getAPI).mockReturnValue({ session: { get } } as never);
    const store = renderHistoryPanel(sessions);

    expect(screen.getByText(`12 ${t('history.messages')}`)).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: `${t('history.loadSession')} — Final cut` }),
    );

    await waitFor(() => expect(get).toHaveBeenCalledWith('canvas-b'));
    expect(store.getState().commander.activeSessionId).toBe('unassigned');
    expect(store.getState().canvas.activeCanvasId).toBe('canvas-a');
    expect(store.getState().toast.items).toEqual([
      expect.objectContaining({
        variant: 'warning',
        title: t('history.sessionLoadFailed'),
      }),
    ]);
  });

  it('moves a terminal session only after the backend accepts the target Canvas', async () => {
    const move = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(getAPI).mockReturnValue({ session: { move } } as never);
    const store = renderHistoryPanel();
    appendActivityEvents(store, 'canvas-b', [runStart('root-run', 100), runEnd('root-run', 120)]);

    fireEvent.keyDown(
      screen.getByRole('button', { name: `${t('history.loadSession')} — Final cut` }),
      { key: 'ArrowUp', altKey: true },
    );

    await waitFor(() => expect(move).toHaveBeenCalledWith('canvas-b', 'canvas-a'));
    expect(
      store.getState().commander.sessions.find((session) => session.id === 'canvas-b')
        ?.defaultCanvasId,
    ).toBe('canvas-a');
  });

  it('moves an unlocked session by drag and drop into an empty Canvas group', async () => {
    const move = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(getAPI).mockReturnValue({ session: { move } } as never);
    const store = renderHistoryPanel(
      [createSession('unassigned', 'General planning', null, 1)],
      [createCanvas('canvas-b', 'Canvas B')],
    );
    const dataTransfer = { dropEffect: 'none', effectAllowed: 'none', setData: vi.fn() };

    fireEvent.dragStart(
      screen.getByRole('button', {
        name: `${t('history.loadSession')} — General planning`,
      }),
      { dataTransfer },
    );
    const target = screen.getByRole('region', { name: 'Canvas B' });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    await waitFor(() => expect(move).toHaveBeenCalledWith('unassigned', 'canvas-b'));
    expect(
      store.getState().commander.sessions.find((session) => session.id === 'unassigned')
        ?.defaultCanvasId,
    ).toBe('canvas-b');
  });

  it('blocks moving a session while a descendant in its public activity tree is active', async () => {
    const move = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(getAPI).mockReturnValue({ session: { move } } as never);
    const store = renderHistoryPanel();
    appendActivityEvents(store, 'canvas-b', [
      runStart('root-run', 100),
      runStart('child-run', 110, 'root-run'),
    ]);

    const sessionButton = screen.getByRole('button', {
      name: `${t('history.loadSession')} — Final cut`,
    });
    await waitFor(() => expect(sessionButton.title).toBe(t('history.stopBeforeMove')));
    fireEvent.dragStart(sessionButton, {
      dataTransfer: { effectAllowed: 'none', setData: vi.fn() },
    });

    await waitFor(() =>
      expect(store.getState().toast.items).toEqual([
        expect.objectContaining({ title: t('history.stopBeforeMove') }),
      ]),
    );
    expect(move).not.toHaveBeenCalled();
  });

  it('explains why a session with an active public activity tree cannot be deleted', async () => {
    const deleteSession = vi.fn().mockResolvedValue({ success: true });
    vi.mocked(getAPI).mockReturnValue({ session: { delete: deleteSession } } as never);
    const store = renderHistoryPanel();
    appendActivityEvents(store, 'canvas-b', [
      runStart('root-run', 100),
      runStart('child-run', 110, 'root-run'),
    ]);

    const deleteButton = screen.getByRole('button', { name: 'Delete session — Final cut' });
    await waitFor(() => expect(deleteButton.getAttribute('aria-disabled')).toBe('true'));
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(store.getState().toast.items).toEqual([
        expect.objectContaining({ title: t('history.stopBeforeDelete') }),
      ]),
    );
    expect(deleteSession).not.toHaveBeenCalled();
  });
});
