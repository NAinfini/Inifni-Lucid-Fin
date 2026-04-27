import { describe, expect, it, vi } from 'vitest';
import { CommanderSessionService } from './CommanderSessionService.js';
import { CommanderTransport } from '../transport/CommanderTransport.js';
import type { AppDispatch, RootState } from '../../store/index.js';
import { COMMANDER_WIRE_VERSION } from '@lucid-fin/contracts';

/**
 * Minimal stub of the commander bridge the transport expects.
 */
function makeStubCommander() {
  const streamListeners: Array<(p: unknown) => void> = [];
  return {
    chat: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    cancelCurrentStep: vi.fn(async () => ({ escalated: false })),
    injectMessage: vi.fn(async () => undefined),
    confirmTool: vi.fn(async () => undefined),
    answerQuestion: vi.fn(async () => undefined),
    onStream: vi.fn((cb: (p: unknown) => void) => {
      streamListeners.push(cb);
      return () => {
        const idx = streamListeners.indexOf(cb);
        if (idx >= 0) streamListeners.splice(idx, 1);
      };
    }),
    onCanvasUpdated: vi.fn(() => () => {}),
    onEntitiesUpdated: vi.fn(() => () => {}),
    onSettingsDispatch: vi.fn(() => () => {}),
    onUndoDispatch: vi.fn(() => () => {}),
    emitStream: (event: Record<string, unknown>) => {
      const envelope = { wireVersion: COMMANDER_WIRE_VERSION, event };
      for (const cb of streamListeners) cb(envelope);
    },
  };
}

interface ServiceOverrides {
  commanderState?: Partial<RootState['commander']>;
  timelineState?: Partial<RootState['commanderTimeline']>;
  canvasState?: Partial<RootState['canvas']>;
  settingsState?: Partial<RootState['settings']>;
}

function makeService(overrides: ServiceOverrides = {}) {
  const commander = makeStubCommander();
  const transport = new CommanderTransport(commander as never);
  const dispatch = vi.fn() as unknown as AppDispatch;

  const state: RootState = {
    commander: {
      messages: [],
      streaming: false,
      activeSessionId: null,
      activeCanvasId: null,
      sessions: [],
      confirmAutoMode: 'none',
      permissionMode: 'normal',
      providerId: null,
      maxSteps: 50,
      temperature: 0.7,
      maxTokens: 200000,
      finalizedRunIds: [],
      ...overrides.commanderState,
    },
    commanderTimeline: {
      events: [],
      byRunId: {},
      currentRunId: null,
      droppedOutOfOrder: 0,
      locallyResolvedConfirmations: [],
      locallyResolvedQuestions: [],
      ...overrides.timelineState,
    },
    canvas: {
      activeCanvasId: null,
      canvases: { entities: {} },
      selectedNodeIds: [],
      ...overrides.canvasState,
    },
    settings: {
      bootstrapped: true,
      llm: { providers: [] },
      image: {},
      video: {},
      audio: {},
      ...overrides.settingsState,
    },
    promptTemplates: { templates: [] },
    workflowDefinitions: { entries: [] },
  } as unknown as RootState;

  const service = new CommanderSessionService({
    transport,
    api: { commander } as never,
    dispatch,
    getState: () => state,
    t: (k) => k,
    getLocale: () => 'en',
  });
  return { service, dispatch, commander, state };
}

/** Pull the list of dispatched action types from the vi.fn() dispatcher. */
function dispatchedTypes(dispatch: AppDispatch): string[] {
  const calls = (dispatch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls.map((args) => (args[0] as { type?: string })?.type ?? 'unknown');
}

describe('CommanderSessionService', () => {
  it('subscribe wires up all push-channel listeners and returns a disposable', () => {
    const { service, commander } = makeService();
    const unsub = service.subscribe();
    expect(commander.onStream).toHaveBeenCalledOnce();
    expect(commander.onCanvasUpdated).toHaveBeenCalledOnce();
    expect(commander.onEntitiesUpdated).toHaveBeenCalledOnce();
    expect(commander.onSettingsDispatch).toHaveBeenCalledOnce();
    expect(commander.onUndoDispatch).toHaveBeenCalledOnce();
    expect(typeof unsub).toBe('function');
  });

  it('appends each incoming TimelineEvent to the timeline slice', () => {
    const { service, dispatch, commander } = makeService();
    service.subscribe();
    commander.emitStream({
      kind: 'assistant_text',
      content: 'hi',
      isDelta: true,
      runId: 'r1',
      step: 1,
      seq: 0,
      emittedAt: 0,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'commanderTimeline/appendEvent',
        payload: expect.objectContaining({ kind: 'assistant_text', content: 'hi' }),
      }),
    );
  });

  it('records tool-call telemetry on a tool_result event', () => {
    const { service, dispatch, commander } = makeService();
    service.subscribe();
    commander.emitStream({
      kind: 'tool_call',
      toolCallId: 'tc1',
      toolRef: { domain: 'canvas', action: 'getNode' },
      args: {},
      runId: 'r1',
      step: 1,
      seq: 0,
      emittedAt: 0,
    });
    commander.emitStream({
      kind: 'tool_result',
      toolCallId: 'tc1',
      result: { success: true },
      durationMs: 5,
      runId: 'r1',
      step: 1,
      seq: 1,
      emittedAt: 0,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'settings/recordToolCall',
        payload: expect.objectContaining({ toolName: 'canvas.getNode', error: false }),
      }),
    );
  });

  it('on completed run_end: dispatches appendFinalizedAssistantMessage then finishStreaming', () => {
    const { service, dispatch, commander } = makeService({
      timelineState: {
        events: [
          {
            kind: 'run_start',
            runId: 'r1',
            step: 0,
            seq: 0,
            emittedAt: 100,
            intent: 'test',
          },
          {
            kind: 'assistant_text',
            content: 'hello',
            isDelta: false,
            runId: 'r1',
            step: 1,
            seq: 1,
            emittedAt: 200,
          },
        ],
        byRunId: { r1: [0, 1] },
        currentRunId: 'r1',
      },
    });
    service.subscribe();
    commander.emitStream({
      kind: 'run_end',
      status: 'completed',
      runId: 'r1',
      step: 1,
      seq: 2,
      emittedAt: 300,
    });
    const types = dispatchedTypes(dispatch);
    const appendIdx = types.indexOf('commander/appendFinalizedAssistantMessage');
    const finishIdx = types.indexOf('commander/finishStreaming');
    expect(appendIdx).toBeGreaterThanOrEqual(0);
    expect(finishIdx).toBeGreaterThan(appendIdx);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'commander/appendFinalizedAssistantMessage',
        payload: expect.objectContaining({ runId: 'r1' }),
      }),
    );
  });

  it('on failed run_end: dispatches recordError + appendFinalizedAssistantMessage (failed) + finishStreaming', () => {
    const { service, dispatch, commander } = makeService({
      timelineState: {
        events: [
          {
            kind: 'run_start',
            runId: 'r1',
            step: 0,
            seq: 0,
            emittedAt: 100,
            intent: 'test',
          },
          {
            kind: 'assistant_text',
            content: 'partial',
            isDelta: false,
            runId: 'r1',
            step: 1,
            seq: 1,
            emittedAt: 200,
          },
        ],
        byRunId: { r1: [0, 1] },
        currentRunId: 'r1',
      },
    });
    service.subscribe();
    commander.emitStream({
      kind: 'run_end',
      status: 'failed',
      runId: 'r1',
      step: 1,
      seq: 2,
      emittedAt: 300,
    });
    const types = dispatchedTypes(dispatch);
    expect(types).toContain('settings/recordError');
    expect(types).toContain('commander/appendFinalizedAssistantMessage');
    expect(types).toContain('commander/finishStreaming');
    // D4: no streamError on run_end.failed path.
    expect(types).not.toContain('commander/streamError');
  });

  it('upserts on late run_end when runId already in finalizedRunIds (cancel-then-run_end race)', () => {
    const { service, dispatch, commander } = makeService({
      commanderState: { finalizedRunIds: ['r1'] },
      timelineState: {
        events: [
          {
            kind: 'run_start',
            runId: 'r1',
            step: 0,
            seq: 0,
            emittedAt: 100,
            intent: 'test',
          },
          {
            kind: 'assistant_text',
            content: 'partial',
            isDelta: false,
            runId: 'r1',
            step: 1,
            seq: 1,
            emittedAt: 200,
          },
        ],
        byRunId: { r1: [0, 1] },
        currentRunId: 'r1',
      },
    });
    service.subscribe();
    commander.emitStream({
      kind: 'run_end',
      status: 'cancelled',
      runId: 'r1',
      step: 1,
      seq: 2,
      emittedAt: 300,
    });
    const types = dispatchedTypes(dispatch);
    expect(types).toContain('commander/upsertFinalizedAssistantMessage');
    expect(types).not.toContain('commander/appendFinalizedAssistantMessage');
  });

  it('on cancelled TimelineEvent: no finalize, no finishStreaming (informational-only)', () => {
    const { service, dispatch, commander } = makeService({
      timelineState: {
        byRunId: { r1: [] },
        currentRunId: 'r1',
      },
    });
    service.subscribe();
    commander.emitStream({
      kind: 'cancelled',
      runId: 'r1',
      step: 1,
      seq: 0,
      emittedAt: 100,
      reason: 'user',
      completedToolCalls: 0,
      pendingToolCalls: 0,
    });
    const types = dispatchedTypes(dispatch);
    // Only appendEvent + updateRunPhase should have fired.
    expect(types).not.toContain('commander/finishStreaming');
    expect(types).not.toContain('commander/appendFinalizedAssistantMessage');
    expect(types).not.toContain('commander/upsertFinalizedAssistantMessage');
  });

  it('cancel() with no activeCanvasId: local finalize + finishStreaming, does not call transport.cancel', async () => {
    const { service, dispatch, commander } = makeService({
      commanderState: { activeCanvasId: null },
      timelineState: { currentRunId: 'r1' },
    });
    await service.cancel();
    expect(commander.cancel).not.toHaveBeenCalled();
    const types = dispatchedTypes(dispatch);
    expect(types).toContain('commander/finishStreaming');
  });

  it('cancel() with activeCanvasId: calls transport.cancel(canvasId)', async () => {
    const { service, commander } = makeService({
      commanderState: { activeCanvasId: 'canvas-1' },
      timelineState: { currentRunId: 'r1' },
    });
    // Run_end never arrives; the timeout path runs local finalize.
    // Use very short timeout via fake timers would be noisier than just
    // letting the 2s timeout lapse — mark test async and await.
    const p = service.cancel();
    await p;
    expect(commander.cancel).toHaveBeenCalledWith('canvas-1');
  }, 5000);

  it('cancel() swallows transport.cancel errors (backend already gone)', async () => {
    const { service, dispatch, commander } = makeService({
      commanderState: { activeCanvasId: 'canvas-1' },
      timelineState: { currentRunId: 'r1' },
    });
    commander.cancel.mockRejectedValueOnce(new Error('already gone'));
    await service.cancel();
    // After the await returns, finishStreaming MUST eventually be dispatched.
    const types = dispatchedTypes(dispatch);
    expect(types).toContain('commander/finishStreaming');
  }, 5000);

  it('start rejects with a backend-not-ready error when settings are unbootstrapped', async () => {
    const { service, dispatch } = makeService({
      settingsState: { bootstrapped: false } as never,
    });
    await service.start('hello');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'commander/streamError' }),
    );
  });
});
