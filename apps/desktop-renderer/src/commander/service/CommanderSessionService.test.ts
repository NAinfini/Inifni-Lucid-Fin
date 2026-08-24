import { describe, expect, it, vi } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import { COMMANDER_WIRE_VERSION } from '@lucid-fin/contracts';
import type { AppDispatch, RootState } from '../../store/index.js';
import { canvasReducer, setActiveCanvas, setCanvases } from '../../store/slices/canvas/canvas.js';
import {
  commanderSlice,
  enqueueMessage,
  ensureActiveSession,
  finishStreaming,
  setRunResourceBudget,
  startStreaming,
} from '../../store/slices/commander.js';
import { appendEvent, commanderTimelineSlice } from '../state/commander-timeline-slice.js';
import { CommanderTransport } from '../transport/CommanderTransport.js';
import { CommanderSessionService } from './CommanderSessionService.js';

function canvas(id: string, name = id): Canvas {
  return {
    id,
    name,
    nodes: [],
    edges: [],
    notes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeStubCommander() {
  const streamListeners: Array<(payload: unknown) => void> = [];
  const canvasListeners: Array<(payload: unknown) => void> = [];
  return {
    start: vi.fn(async (request: { sessionId: string }) => ({
      runId: `run-${request.sessionId}`,
      sessionId: request.sessionId,
      acceptedAt: 1,
    })),
    cancel: vi.fn(async () => undefined),
    cancelStep: vi.fn(async () => ({ escalated: false })),
    injectMessage: vi.fn(async () => undefined),
    toolDecision: vi.fn(async () => ({ accepted: true as const, delivery: 'active_run' as const })),
    toolAnswer: vi.fn(async () => ({ accepted: true as const, delivery: 'active_run' as const })),
    runGet: vi.fn(),
    eventsHydrate: vi.fn(async (request: { runId: string }) => ({
      run: {
        id: request.runId,
        sessionId: request.runId.replace(/^run-/, ''),
        authorizedCanvasIds: [],
        intent: 'test',
        status: 'running' as const,
        acceptedAt: 1,
        lastSeq: -1,
        attachments: [],
      },
      events: [],
    })),
    onStream: vi.fn((listener: (payload: unknown) => void) => {
      streamListeners.push(listener);
      return () => {};
    }),
    onCanvasDispatch: vi.fn((listener: (payload: unknown) => void) => {
      canvasListeners.push(listener);
      return () => {};
    }),
    onEntitiesUpdated: vi.fn(() => () => {}),
    onSettingsDispatch: vi.fn(() => () => {}),
    emitStream(sessionId: string, event: Record<string, unknown>) {
      for (const listener of streamListeners) {
        listener({ wireVersion: COMMANDER_WIRE_VERSION, sessionId, event });
      }
    },
    emitCanvas(payload: Record<string, unknown>) {
      for (const listener of canvasListeners) listener(payload);
    },
  };
}

function makeHarness(canvases: Canvas[] = []) {
  const commander = makeStubCommander();
  let commanderState = commanderSlice.reducer(undefined, { type: '@@INIT' });
  let timelineState = commanderTimelineSlice.reducer(undefined, { type: '@@INIT' });
  let canvasState = canvasReducer(undefined, { type: '@@INIT' });
  canvasState = canvasReducer(canvasState, setCanvases(canvases));
  const actions: Array<{ type: string; payload?: unknown }> = [];
  const dispatch = vi.fn((action: { type: string; payload?: unknown }) => {
    actions.push(action);
    commanderState = commanderSlice.reducer(commanderState, action);
    timelineState = commanderTimelineSlice.reducer(timelineState, action);
    canvasState = canvasReducer(canvasState, action);
    return action;
  }) as unknown as AppDispatch;
  const sessionUpsert = vi.fn(async () => undefined);
  const canvasSave = vi.fn(async (_canvas: Canvas) => undefined);
  const api = {
    commander,
    session: { upsert: sessionUpsert },
    snapshot: { capture: vi.fn(async () => undefined) },
    canvas: { save: canvasSave },
  };
  const getState = () =>
    ({
      commander: commanderState,
      commanderTimeline: timelineState,
      canvas: canvasState,
      settings: {
        bootstrapped: true,
        llm: { providers: [] },
        image: {},
        video: {},
        audio: {},
      },
      skillDefinitions: { skills: [] },
      taskLists: { allIds: [], summariesById: {}, tasksByTaskListId: {} },
    }) as unknown as RootState;
  const service = new CommanderSessionService({
    transport: new CommanderTransport(commander as never),
    api: api as never,
    dispatch,
    getState,
    t: (key) => key,
    getLocale: () => 'en',
  });
  return {
    actions,
    api,
    commander,
    dispatch,
    getState,
    service,
  };
}

describe('CommanderSessionService', () => {
  it('uses sessionId for tool decisions and runId for injected messages', async () => {
    const commander = makeStubCommander();
    const transport = new CommanderTransport(commander as never);
    await transport.confirmTool('session-1', 'run-1', 'tool-1', true);
    await transport.injectMessage('run-1', 'follow up');

    expect(commander.toolDecision).toHaveBeenCalledWith({
      sessionId: 'session-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      approved: true,
    });
    expect(commander.injectMessage).toHaveBeenCalledWith({ runId: 'run-1', message: 'follow up' });
  });

  it('starts an unassigned chat with an empty authorized scope', async () => {
    const harness = makeHarness([canvas('canvas-viewed')]);
    harness.dispatch(ensureActiveSession({ id: 'session-1', defaultCanvasId: null }));
    harness.dispatch(setRunResourceBudget({ maxTokens: 80_000, maxCostUsd: 0 }));
    harness.dispatch(setActiveCanvas('canvas-viewed'));

    await expect(harness.service.start('hello')).resolves.toBe(true);

    expect(harness.commander.start).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        authorizedCanvasIds: [],
        selectedNodes: [],
        resourceBudget: { maxTokens: 80_000, maxCostUsd: 0 },
      }),
    );
    expect(harness.commander.start.mock.calls[0]?.[0]).not.toHaveProperty('defaultCanvasId');
    expect(harness.api.session.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ defaultCanvasId: null }),
    );
    expect(harness.api.canvas.save).not.toHaveBeenCalled();
  });

  it('deduplicates default and explicit canvases, saves each, and scopes selected nodes', async () => {
    const canvasA = canvas('canvas-a');
    const canvasB = {
      ...canvas('canvas-b'),
      nodes: [
        {
          id: 'node-b',
          type: 'image' as const,
          title: 'B',
          position: { x: 0, y: 0 },
          bypassed: false,
          locked: false,
          data: { status: 'empty' as const, variants: [], selectedVariantIndex: 0 },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    const harness = makeHarness([canvasA, canvasB]);
    harness.dispatch(ensureActiveSession({ id: 'session-1', defaultCanvasId: 'canvas-a' }));
    harness.dispatch(setActiveCanvas('canvas-b'));
    harness.dispatch({
      type: 'canvas/setSelection',
      payload: { nodeIds: ['node-b'], edgeIds: [] },
    });

    await harness.service.start('edit both', {
      extraCanvasIds: ['canvas-b', 'canvas-a', 'canvas-b'],
    });

    expect(harness.commander.start).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultCanvasId: 'canvas-a',
        authorizedCanvasIds: ['canvas-a', 'canvas-b'],
        selectedNodes: [{ canvasId: 'canvas-b', nodeId: 'node-b' }],
      }),
    );
    expect(harness.api.canvas.save.mock.calls.map(([saved]) => saved.id)).toEqual([
      'canvas-a',
      'canvas-b',
    ]);
  });

  it('fails closed when an authorized canvas cannot be saved before the run', async () => {
    const harness = makeHarness([canvas('canvas-a')]);
    harness.dispatch(ensureActiveSession({ id: 'session-1', defaultCanvasId: 'canvas-a' }));
    Object.assign(harness.api.canvas, { save: undefined });

    await expect(harness.service.start('inspect the canvas')).resolves.toBe(false);

    expect(harness.commander.start).not.toHaveBeenCalled();
  });

  it('requires restoring an archived default Canvas before starting another run', async () => {
    const archived = { ...canvas('canvas-a'), archivedAt: 10 };
    const harness = makeHarness([archived]);
    harness.dispatch(ensureActiveSession({ id: 'session-1', defaultCanvasId: 'canvas-a' }));

    await expect(harness.service.start('continue')).resolves.toBe(false);

    expect(harness.api.canvas.save).not.toHaveBeenCalled();
    expect(harness.commander.start).not.toHaveBeenCalled();
  });

  it('injects into the selected session run without starting another run', async () => {
    const harness = makeHarness();
    harness.dispatch(ensureActiveSession({ id: 'session-1', defaultCanvasId: null }));
    harness.dispatch(startStreaming('session-1'));
    harness.dispatch(
      appendEvent({
        sessionId: 'session-1',
        event: {
          kind: 'run_start',
          workType: 'agent',
          runId: 'run-1',
          step: 0,
          seq: 0,
          emittedAt: 1,
          intent: 'first',
          resourceBudget: {},
        },
      }),
    );

    await harness.service.start('follow up');

    expect(harness.commander.injectMessage).toHaveBeenCalledWith({
      runId: 'run-1',
      message: 'follow up',
    });
    expect(harness.commander.start).not.toHaveBeenCalled();
  });

  it('rejects scope changes while injecting and preserves the active run', async () => {
    const harness = makeHarness([canvas('canvas-extra')]);
    harness.dispatch(ensureActiveSession({ id: 'session-1', defaultCanvasId: null }));
    harness.dispatch(startStreaming('session-1'));
    harness.dispatch(
      appendEvent({
        sessionId: 'session-1',
        event: {
          kind: 'run_start',
          workType: 'agent',
          runId: 'run-1',
          step: 0,
          seq: 0,
          emittedAt: 1,
          intent: 'first',
          resourceBudget: {},
        },
      }),
    );

    await expect(
      harness.service.start('follow up', { extraCanvasIds: ['canvas-extra'] }),
    ).resolves.toBe(false);

    expect(harness.commander.injectMessage).not.toHaveBeenCalled();
    expect(harness.getState().commanderTimeline.currentRunIdBySessionId['session-1']).toBe('run-1');
    expect(harness.getState().commander.sessions[0]?.runtime.phase.kind).toBe('awaiting_model');
  });

  it('retains a queued turn canvas scope until the next run is accepted', async () => {
    const harness = makeHarness([canvas('canvas-extra')]);
    harness.dispatch(ensureActiveSession({ id: 'session-1', defaultCanvasId: null }));
    harness.dispatch(startStreaming('session-1'));
    harness.dispatch(
      appendEvent({
        sessionId: 'session-1',
        event: {
          kind: 'run_start',
          workType: 'agent',
          runId: 'run-1',
          step: 0,
          seq: 0,
          emittedAt: 1,
          intent: 'first',
          resourceBudget: {},
        },
      }),
    );
    harness.dispatch(
      enqueueMessage({
        sessionId: 'session-1',
        content: 'queued turn',
        extraCanvasIds: ['canvas-extra'],
      }),
    );

    harness.dispatch(
      appendEvent({
        sessionId: 'session-1',
        event: {
          kind: 'run_end',
          status: 'completed',
          runId: 'run-1',
          step: 1,
          seq: 1,
          emittedAt: 2,
        },
      }),
    );
    harness.dispatch(finishStreaming('session-1'));
    const session = harness.getState().commander.sessions[0]!;
    const queued = session.runtime.messageQueue[session.runtime.messageQueueCursor]!;

    await harness.service.start(queued.content, { extraCanvasIds: queued.extraCanvasIds });

    expect(harness.commander.start).toHaveBeenCalledWith(
      expect.objectContaining({ authorizedCanvasIds: ['canvas-extra'] }),
    );
  });

  it('finalizes a background session without stopping the selected session', () => {
    const harness = makeHarness();
    harness.dispatch(ensureActiveSession({ id: 'session-a', defaultCanvasId: null }));
    harness.dispatch(startStreaming('session-a'));
    harness.dispatch(ensureActiveSession({ id: 'session-b', defaultCanvasId: null }));
    harness.dispatch(startStreaming('session-b'));
    harness.dispatch(
      appendEvent({
        sessionId: 'session-a',
        event: {
          kind: 'run_start',
          workType: 'agent',
          runId: 'run-a',
          step: 0,
          seq: 0,
          emittedAt: 1,
          intent: 'background',
          resourceBudget: {},
        },
      }),
    );
    harness.dispatch(
      appendEvent({
        sessionId: 'session-b',
        event: {
          kind: 'run_start',
          workType: 'agent',
          runId: 'run-b',
          step: 0,
          seq: 0,
          emittedAt: 1,
          intent: 'selected',
          resourceBudget: {},
        },
      }),
    );
    harness.service.subscribe();

    harness.commander.emitStream('session-a', {
      kind: 'run_end',
      status: 'completed',
      runId: 'run-a',
      step: 1,
      seq: 1,
      emittedAt: 2,
    });

    const state = harness.getState();
    expect(state.commander.activeSessionId).toBe('session-b');
    expect(
      state.commander.sessions.find((session) => session.id === 'session-a')?.runtime.phase.kind,
    ).toBe('idle');
    expect(
      state.commander.sessions.find((session) => session.id === 'session-b')?.runtime.phase.kind,
    ).toBe('awaiting_model');
    expect(state.commanderTimeline.currentRunIdBySessionId).toEqual({ 'session-b': 'run-b' });
  });

  it('applies a background canvas snapshot only to its addressed canvas', () => {
    const canvasA = canvas('canvas-a', 'A');
    const canvasB = canvas('canvas-b', 'B');
    const harness = makeHarness([canvasA, canvasB]);
    harness.dispatch(setActiveCanvas('canvas-a'));
    harness.service.subscribe();

    harness.commander.emitCanvas({
      canvasId: 'canvas-b',
      canvas: { ...canvasB, name: 'B updated', updatedAt: 2 },
    });

    expect(harness.getState().canvas.canvases.entities['canvas-a']).toEqual(canvasA);
    expect(harness.getState().canvas.canvases.entities['canvas-b']?.name).toBe('B updated');
    expect(harness.getState().canvas.activeCanvasId).toBe('canvas-a');
  });
});
