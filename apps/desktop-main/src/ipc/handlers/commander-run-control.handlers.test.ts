import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommanderRunRecord } from '@lucid-fin/contracts';
import { runningSessions } from './commander-registry.js';
import {
  createCommanderRunController,
  registerCommanderRunControlHandlers,
} from './commander-run-control.handlers.js';

function run(
  id: string,
  status: CommanderRunRecord['status'],
  parentRunId?: string,
): CommanderRunRecord {
  return {
    id,
    sessionId: 'session-1',
    defaultCanvasId: 'canvas-1',
    authorizedCanvasIds: ['canvas-1'],
    intent: 'Make the film',
    workType: parentRunId ? 'subagent' : 'agent',
    ...(parentRunId ? { parentRunId } : {}),
    status,
    acceptedAt: 1,
    lastSeq: 0,
    attachments: [],
  };
}

function harness(runs: CommanderRunRecord[]) {
  const byId = new Map(runs.map((candidate) => [candidate.id, candidate]));
  const retryRun = vi.fn(async () => 'retry-1');
  const cancelTaskList = vi.fn(async () => undefined);
  const controller = createCommanderRunController({
    runs: {
      get: (id) => byId.get(id),
      listRunHeadsForSession: () => runs,
    },
    taskExecutionEngine: {
      listSummaries: vi.fn(() => [
        { id: 'task-list-1', commanderSessionId: 'session-1', status: 'running' },
      ]),
      cancel: cancelTaskList,
    } as never,
    retryRun,
    toPublicRun: (candidate) => ({ ...candidate, errorText: undefined }),
  });
  return { controller, retryRun, cancelTaskList };
}

function runtime(runId: string, overrides: Record<string, unknown> = {}) {
  const orchestrator = {
    pause: vi.fn(() => true),
    resume: vi.fn(() => true),
    cancel: vi.fn(),
    cancelCurrentStep: vi.fn(() => ({ escalated: false })),
    injectMessage: vi.fn(),
    ...overrides,
  };
  runningSessions.set(runId, {
    aborted: false,
    sessionId: 'session-1',
    defaultCanvasId: 'canvas-1',
    authorizedCanvasIds: ['canvas-1'],
    runId,
    orchestrator: orchestrator as never,
    lastActivity: 1,
  });
  return orchestrator;
}

describe('Commander Run control dispatcher', () => {
  beforeEach(() => runningSessions.clear());

  it('pauses and resumes the selected active subtree through its runtimes', async () => {
    const root = run('root', 'running');
    const child = run('child', 'running', 'root');
    const { controller } = harness([root, child]);
    const rootRuntime = runtime('root');
    const childRuntime = runtime('child');

    await expect(controller.dispatch({ runId: 'root', action: 'pause' })).resolves.toEqual({
      response: {
        accepted: true,
        action: 'pause',
        runId: 'root',
        affectedRunIds: ['root', 'child'],
      },
    });
    expect(rootRuntime.pause).toHaveBeenCalledOnce();
    expect(childRuntime.pause).toHaveBeenCalledOnce();

    root.status = 'paused';
    child.status = 'paused';
    await expect(controller.dispatch({ runId: 'root', action: 'resume' })).resolves.toEqual({
      response: {
        accepted: true,
        action: 'resume',
        runId: 'root',
        affectedRunIds: ['root', 'child'],
      },
    });
    expect(rootRuntime.resume).toHaveBeenCalledOnce();
    expect(childRuntime.resume).toHaveBeenCalledOnce();
  });

  it('cancels a root subtree and only then cancels its owned Task Lists', async () => {
    const root = run('root', 'paused');
    const child = run('child', 'running', 'root');
    const { controller, cancelTaskList } = harness([root, child]);
    const rootRuntime = runtime('root');
    const childRuntime = runtime('child');

    const result = await controller.dispatch({ runId: 'root', action: 'cancel' });

    expect(result.response).toMatchObject({ accepted: true, affectedRunIds: ['root', 'child'] });
    expect(rootRuntime.cancel).toHaveBeenCalledOnce();
    expect(childRuntime.cancel).toHaveBeenCalledOnce();
    expect(runningSessions.get('root')?.aborted).toBe(true);
    expect(cancelTaskList).toHaveBeenCalledWith('task-list-1');
  });

  it('controls active descendants after their selected parent has already completed', async () => {
    const root = run('root', 'completed');
    const child = run('child', 'running', 'root');
    const { controller } = harness([root, child]);
    const childRuntime = runtime('child');

    await expect(controller.dispatch({ runId: 'root', action: 'pause' })).resolves.toMatchObject({
      response: { accepted: true, affectedRunIds: ['child'] },
    });
    expect(childRuntime.pause).toHaveBeenCalledOnce();

    child.status = 'paused';
    await expect(controller.dispatch({ runId: 'root', action: 'resume' })).resolves.toMatchObject({
      response: { accepted: true, affectedRunIds: ['child'] },
    });
    expect(childRuntime.resume).toHaveBeenCalledOnce();

    child.status = 'running';
    await expect(controller.dispatch({ runId: 'root', action: 'cancel' })).resolves.toMatchObject({
      response: { accepted: true, affectedRunIds: ['child'] },
    });
    expect(childRuntime.cancel).toHaveBeenCalledOnce();
  });

  it('targets message and current-step cancellation to only the selected run', async () => {
    const root = run('root', 'running');
    const child = run('child', 'running', 'root');
    const { controller } = harness([root, child]);
    const rootRuntime = runtime('root');
    const childRuntime = runtime('child', {
      cancelCurrentStep: vi.fn(() => ({ escalated: true })),
    });

    await controller.dispatch({ runId: 'child', action: 'message', message: 'Inspect continuity' });
    const stopped = await controller.dispatch({ runId: 'child', action: 'cancel_step' });

    expect(childRuntime.injectMessage).toHaveBeenCalledWith('Inspect continuity');
    expect(rootRuntime.injectMessage).not.toHaveBeenCalled();
    expect(childRuntime.cancelCurrentStep).toHaveBeenCalledOnce();
    expect(rootRuntime.cancelCurrentStep).not.toHaveBeenCalled();
    expect(stopped.cancelStepEscalated).toBe(true);
  });

  it('creates a new immutable run for retry and rejects active sources', async () => {
    const source = run('source', 'failed');
    const { controller, retryRun } = harness([source]);

    await expect(controller.dispatch({ runId: 'source', action: 'retry' })).resolves.toEqual({
      response: {
        accepted: true,
        action: 'retry',
        runId: 'source',
        affectedRunIds: ['source'],
        retryRunId: 'retry-1',
      },
    });
    expect(retryRun).toHaveBeenCalledWith(source);
    expect(source.status).toBe('failed');

    source.status = 'running';
    await expect(controller.dispatch({ runId: 'source', action: 'retry' })).resolves.toMatchObject({
      response: { accepted: false, code: 'invalid_state' },
    });
  });

  it('allows subagent retry and rejects tool_program retry', async () => {
    const root = run('root', 'running');
    const child = run('child', 'failed', 'root');
    const { controller, retryRun } = harness([root, child]);

    await expect(controller.dispatch({ runId: 'child', action: 'retry' })).resolves.toMatchObject({
      response: { accepted: true, retryRunId: 'retry-1' },
    });
    expect(retryRun).toHaveBeenCalledWith(child);

    child.workType = 'tool_program';
    await expect(controller.dispatch({ runId: 'child', action: 'retry' })).resolves.toMatchObject({
      response: { accepted: false, code: 'invalid_state' },
    });
  });

  it('waits for cold recovery before dispatching typed and legacy controls', async () => {
    const root = run('root', 'running');
    const { controller } = harness([root]);
    const rootRuntime = runtime('root');
    let release!: () => void;
    const recoveryReady = new Promise<void>((resolve) => { release = resolve; });
    const handlers = new Map<string, (...args: never[]) => unknown>();
    registerCommanderRunControlHandlers({
      handle(channel: string, handler: (...args: never[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never, controller, recoveryReady);

    const pending = handlers.get('commander:cancel')?.({}, { runId: 'root' } as never);
    await Promise.resolve();
    expect(rootRuntime.cancel).not.toHaveBeenCalled();
    release();
    await pending;
    expect(rootRuntime.cancel).toHaveBeenCalledOnce();
  });

  it('returns explicit missing, unavailable, and invalid-state rejections', async () => {
    const active = run('active', 'running');
    const terminal = run('terminal', 'completed');
    const { controller } = harness([active, terminal]);

    await expect(controller.dispatch({ runId: 'missing', action: 'pause' })).resolves.toMatchObject({
      response: { accepted: false, code: 'run_not_found' },
    });
    await expect(controller.dispatch({ runId: 'active', action: 'pause' })).resolves.toMatchObject({
      response: { accepted: false, code: 'runtime_unavailable' },
    });
    await expect(controller.dispatch({ runId: 'terminal', action: 'pause' })).resolves.toMatchObject({
      response: { accepted: false, code: 'invalid_state' },
    });
  });

  it('returns the stable session Run tree through the public projection', () => {
    const root = { ...run('root', 'failed'), errorText: '__PRIVATE_PROVIDER_ERROR__' };
    const child = run('child', 'completed', 'root');
    const { controller } = harness([root, child]);

    expect(controller.tree({ sessionId: 'session-1' })).toEqual({
      sessionId: 'session-1',
      runs: [
        expect.objectContaining({ id: 'root', errorText: undefined }),
        expect.objectContaining({ id: 'child', parentRunId: 'root' }),
      ],
    });
  });

  it('registers typed and legacy IPC controls against the same dispatcher', async () => {
    const root = run('root', 'running');
    const { controller } = harness([root]);
    const rootRuntime = runtime('root');
    const handlers = new Map<string, (...args: never[]) => unknown>();
    registerCommanderRunControlHandlers({
      handle(channel: string, handler: (...args: never[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never, controller);

    await handlers.get('commander:inject-message')?.({} as never, {
      runId: 'root',
      message: 'continue',
    } as never);
    await handlers.get('commander:cancel')?.({} as never, { runId: 'root' } as never);

    expect(rootRuntime.injectMessage).toHaveBeenCalledWith('continue');
    expect(rootRuntime.cancel).toHaveBeenCalledOnce();
    expect(handlers.has('commander:run:control')).toBe(true);
    expect(handlers.has('commander:run:tree')).toBe(true);
  });
});
