import { describe, expect, it, vi } from 'vitest';
import type { Run } from '@lucid-fin/contracts';
import type { DataAccess, HarnessActivationSnapshot } from '@lucid-fin/storage';
import { createRuntimeController } from './runtime-controller.js';

function run(status: Run['status'], id = 'run.runtime-controller.1'): Run {
  return {
    id,
    status,
    revision: 4,
    contentHash: 'a'.repeat(64),
    publicEventHead: { sequence: 8, hash: 'b'.repeat(64) },
    budget: { maxInputTokens: 4_000, maxOutputTokens: 1_000 },
  } as unknown as Run;
}

function snapshot(value: Run): HarnessActivationSnapshot {
  return {
    run: value,
    activation: { activationNumber: 2, state: 'active' },
    recoveryRequired: true,
    modelAttempts: [],
  } as unknown as HarnessActivationSnapshot;
}

function dataAccess(
  value: Run,
  options: {
    readonly active?: boolean;
    readonly isSchedulingAllowed?: (runId: string) => boolean;
    readonly snapshot?: HarnessActivationSnapshot;
    readonly listNonterminal?: () => readonly Run[];
  } = {},
) {
  const currentSnapshot = options.snapshot ?? snapshot(value);
  const listActivations = vi.fn(() =>
    options.active === false
      ? []
      : [{ activationNumber: currentSnapshot.activation.activationNumber, state: 'active' }],
  );
  const loadActivation = vi.fn(() => currentSnapshot);
  const get = vi.fn(() => ({ result: value }));
  const isSchedulingAllowed = vi.fn(
    (runId: string) => options.isSchedulingAllowed?.(runId) ?? true,
  );
  const listNonterminal = vi.fn(() => ({
    runs: options.listNonterminal?.() ?? [value],
    nextAfterRunId: null,
  }));
  const data = {
    runs: { get, isSchedulingAllowed, listActivations },
    harness: { loadActivation },
    scheduling: { listNonterminal },
    deliveryOperations: {},
    resultAssessments: {},
    generation: {},
    mediaDerivations: {},
    operations: {
      listCancellationRequested: () => ({ operations: [], nextAfterOperationId: null }),
    },
  } as unknown as DataAccess;
  return { data, get, isSchedulingAllowed, listActivations, loadActivation, listNonterminal };
}

function controllerOptions(
  data: DataAccess,
  kernel: NonNullable<Parameters<typeof createRuntimeController>[0]['kernel']>,
) {
  let id = 0;
  return {
    data,
    model: {
      provider: { providerId: 'provider.test', model: 'test', reasoningStrength: null },
    } as never,
    createId: (kind: 'command' | 'correlation' | 'request') => `${kind}.runtime.${++id}`,
    limitsForRun: () => ({ maxInputTokens: 4_000, maxOutputTokens: 1_000 }),
    onBackgroundError: vi.fn(),
    publishPersistedRunHead: vi.fn(),
    kernel,
  };
}

describe('Runtime controller', () => {
  it('closes and retries an unresolved crash frontier after exact reconciliation cannot advance it', async () => {
    const value = run('running');
    const fixture = dataAccess(value);
    const coordinate = vi.fn(async () => ({
      kind: 'deferred' as const,
      run: value,
      pendingInbox: null,
      reason: 'active_activation' as const,
    }));
    const recover = vi.fn(
      (_dependencies: unknown, _input: unknown) =>
        ({
          closed: { run: value },
          retry: { retryRun: run('accepted') },
        }) as never,
    );
    const options = controllerOptions(fixture.data, { coordinate, recover });
    const controller = createRuntimeController(options);

    await controller.recoverAndReconcile();
    expect(coordinate).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledOnce();
    expect(options.publishPersistedRunHead).toHaveBeenCalledTimes(3);
    expect(recover.mock.calls[0]?.[1]).toMatchObject({
      close: {
        runId: value.id,
        activationNumber: 2,
        expectedRunRevision: value.revision,
        expectedRunContentHash: value.contentHash,
        expectedPublicEventHead: value.publicEventHead,
      },
      context: {
        actor: 'commander',
        causation: { kind: 'run', runId: value.id },
      },
    });
    await controller.close();
  });

  it('does not create a crash retry when authoritative reconciliation closes the activation', async () => {
    const value = run('running');
    let active = true;
    const fixture = dataAccess(value);
    fixture.listActivations.mockImplementation(() =>
      active ? [{ activationNumber: 2, state: 'active' }] : [],
    );
    const coordinate = vi.fn(async () => {
      active = false;
      return { kind: 'idle' as const, run: value, reason: 'no_pending_inbox' as const };
    });
    const recover = vi.fn();
    const controller = createRuntimeController(
      controllerOptions(fixture.data, { coordinate, recover }),
    );

    await controller.recoverAndReconcile();
    expect(coordinate).toHaveBeenCalledOnce();
    expect(recover).not.toHaveBeenCalled();
    await controller.close();
  });

  it('drains terminal cancellation requests during startup recovery without a nonterminal Run', async () => {
    const terminal = run('cancelled');
    const fixture = dataAccess(terminal, { active: false, listNonterminal: () => [] });
    const coordinate = vi.fn();
    const drainOperationCancellations = vi.fn(async () => undefined);
    const controller = createRuntimeController(
      controllerOptions(fixture.data, {
        coordinate,
        recover: vi.fn(),
        drainOperationCancellations,
      }),
    );

    await controller.recoverAndReconcile();
    expect(drainOperationCancellations).toHaveBeenCalledOnce();
    expect(coordinate).not.toHaveBeenCalled();
    await controller.close();
  });

  it('drains cancellation requests from a durable notification without a runnable Run', async () => {
    const value = run('accepted');
    const fixture = dataAccess(value, { active: false, listNonterminal: () => [] });
    const coordinate = vi.fn();
    const drainOperationCancellations = vi.fn(async () => undefined);
    const controller = createRuntimeController(
      controllerOptions(fixture.data, {
        coordinate,
        recover: vi.fn(),
        drainOperationCancellations,
      }),
    );

    controller.notifyDurableRunWork();
    await controller.close();
    expect(drainOperationCancellations).toHaveBeenCalledOnce();
    expect(coordinate).not.toHaveBeenCalled();
  });

  it('does not reconcile a recovery frontier behind a paused ancestor', async () => {
    const value = run('recovering', 'run.runtime-controller.paused-recovery-child');
    const fixture = dataAccess(value, {
      isSchedulingAllowed: () => false,
    });
    const coordinate = vi.fn();
    const recover = vi.fn();
    const controller = createRuntimeController(
      controllerOptions(fixture.data, { coordinate, recover }),
    );

    await controller.recoverAndReconcile();
    expect(coordinate).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
    await controller.close();
  });

  it('reconciles a settled model failure even when it has no recovery frontier', async () => {
    const value = run('running');
    const failedSnapshot = {
      ...snapshot(value),
      recoveryRequired: false,
      modelAttempts: [
        {
          response: {
            events: [
              {
                type: 'model_failed',
                typedCode: 'provider_rejected',
                retrySafety: 'never',
                providerState: 'terminal',
              },
            ],
          },
        },
      ],
    } as unknown as HarnessActivationSnapshot;
    const fixture = dataAccess(value, { snapshot: failedSnapshot });
    const coordinate = vi.fn(
      async () => ({ kind: 'executed' as const, snapshot: { run: run('failed') } }) as never,
    );
    const recover = vi.fn();
    const controller = createRuntimeController(
      controllerOptions(fixture.data, { coordinate, recover }),
    );

    await controller.recoverAndReconcile();
    expect(coordinate).toHaveBeenCalledOnce();
    expect(recover).not.toHaveBeenCalled();
    await controller.close();
  });

  it('coalesces durable work notifications and waits for the active drain on close', async () => {
    const value = run('accepted');
    const fixture = dataAccess(value, { active: false });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const coordinate = vi.fn(async () => {
      await gate;
      return { kind: 'idle' as const, run: value, reason: 'no_pending_inbox' as const };
    });
    const controller = createRuntimeController(
      controllerOptions(fixture.data, { coordinate, recover: vi.fn() }),
    );

    controller.notifyDurableRunWork();
    controller.notifyDurableRunWork();
    await vi.waitFor(() => expect(coordinate).toHaveBeenCalledOnce());
    const closing = controller.close();
    expect(coordinate).toHaveBeenCalledOnce();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release?.();
    await closing;
    expect(coordinate).toHaveBeenCalledOnce();
  });

  it('coordinates different runnable Runs concurrently without re-entering either Run', async () => {
    const first = run('accepted', 'run.runtime-controller.concurrent.1');
    const second = run('accepted', 'run.runtime-controller.concurrent.2');
    const fixture = dataAccess(first, {
      active: false,
      listNonterminal: () => [first, second],
    });
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const activeRunIds = new Set<string>();
    const coordinate = vi.fn(async (_dependencies: unknown, input: { runId: string }) => {
      expect(activeRunIds.has(input.runId)).toBe(false);
      activeRunIds.add(input.runId);
      if (input.runId === first.id) await firstGate;
      activeRunIds.delete(input.runId);
      const value = input.runId === first.id ? first : second;
      return { kind: 'idle' as const, run: value, reason: 'no_pending_inbox' as const };
    });
    const controller = createRuntimeController(
      controllerOptions(fixture.data, { coordinate, recover: vi.fn() }),
    );

    controller.notifyDurableRunWork();
    controller.notifyDurableRunWork();
    await vi.waitFor(() => expect(coordinate).toHaveBeenCalledTimes(2));
    expect(coordinate.mock.calls.map((call) => call[1].runId)).toEqual([first.id, second.id]);
    expect(activeRunIds).toEqual(new Set([first.id]));

    const closing = controller.close();
    releaseFirst?.();
    await closing;
    expect(coordinate).toHaveBeenCalledTimes(2);
  });

  it('holds an accepted descendant behind its paused ancestor until the durable barrier clears', async () => {
    const parent = run('paused', 'run.runtime-controller.paused-parent');
    const child = run('accepted', 'run.runtime-controller.paused-child');
    let childAllowed = false;
    const fixture = dataAccess(parent, {
      active: false,
      isSchedulingAllowed: (runId) => runId === child.id && childAllowed,
      listNonterminal: () => [parent, child],
    });
    const coordinate = vi.fn(async (_dependencies: unknown, input: { readonly runId: string }) => ({
      kind: 'idle' as const,
      run: input.runId === child.id ? child : parent,
      reason: 'no_pending_inbox' as const,
    }));
    const controller = createRuntimeController(
      controllerOptions(fixture.data, { coordinate, recover: vi.fn() }),
    );
    try {
      controller.notifyDurableRunWork();
      await Promise.resolve();
      expect(coordinate).not.toHaveBeenCalled();

      childAllowed = true;
      controller.notifyDurableRunWork();
      await vi.waitFor(() => expect(coordinate).toHaveBeenCalledOnce());
      expect(coordinate.mock.calls[0]?.[1]).toMatchObject({ runId: child.id });
    } finally {
      await controller.close();
    }
  });

  it('isolates a Run coordination failure so sibling Runs still start', async () => {
    const failed = run('accepted', 'run.runtime-controller.failed');
    const sibling = run('accepted', 'run.runtime-controller.sibling');
    const fixture = dataAccess(failed, {
      active: false,
      listNonterminal: () => [failed, sibling],
    });
    const error = new Error('coordinate failed');
    const coordinate = vi.fn(async (_dependencies: unknown, input: { runId: string }) => {
      if (input.runId === failed.id) throw error;
      return { kind: 'idle' as const, run: sibling, reason: 'no_pending_inbox' as const };
    });
    const options = controllerOptions(fixture.data, { coordinate, recover: vi.fn() });
    const controller = createRuntimeController(options);

    controller.notifyDurableRunWork();
    await vi.waitFor(() => expect(coordinate).toHaveBeenCalledTimes(2));
    await controller.close();

    expect(coordinate.mock.calls.map((call) => call[1].runId)).toEqual([failed.id, sibling.id]);
    expect(options.onBackgroundError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('continues an executed Run serially until its durable inbox is idle', async () => {
    const value = run('accepted');
    const fixture = dataAccess(value, { active: false });
    let markSecondStarted: (() => void) | undefined;
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    const coordinate = vi.fn(async () => {
      if (coordinate.mock.calls.length === 1) {
        return { kind: 'executed' as const, snapshot: { run: value } } as never;
      }
      markSecondStarted?.();
      return { kind: 'idle' as const, run: value, reason: 'no_pending_inbox' as const };
    });
    const controller = createRuntimeController(
      controllerOptions(fixture.data, { coordinate, recover: vi.fn() }),
    );

    controller.notifyDurableRunWork();
    await secondStarted;
    await controller.close();

    expect(coordinate).toHaveBeenCalledTimes(2);
  });

  it('aborts an active coordination when its Run is no longer durable-runnable', async () => {
    const value = run('accepted');
    let runnable = true;
    const fixture = dataAccess(value, {
      active: false,
      listNonterminal: () => (runnable ? [value] : []),
    });
    let seenSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let markAborted: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    const coordinate = vi.fn(
      async (
        _dependencies: unknown,
        input: { readonly runId: string; readonly signal?: AbortSignal },
      ) => {
        seenSignal = input.signal;
        markStarted?.();
        if (input.signal === undefined) {
          return { kind: 'idle' as const, run: value, reason: 'no_pending_inbox' as const };
        }
        if (!input.signal.aborted) {
          await new Promise<void>((resolve) =>
            input.signal?.addEventListener('abort', resolve, { once: true }),
          );
        }
        markAborted?.();
        return { kind: 'idle' as const, run: value, reason: 'no_pending_inbox' as const };
      },
    );
    const options = controllerOptions(fixture.data, { coordinate, recover: vi.fn() });
    const controller = createRuntimeController(options);
    try {
      controller.notifyDurableRunWork();
      await started;
      expect(seenSignal).toBeInstanceOf(AbortSignal);

      runnable = false;
      controller.notifyDurableRunWork();
      await aborted;
      expect(seenSignal?.aborted).toBe(true);
      expect(options.onBackgroundError).not.toHaveBeenCalled();
    } finally {
      await controller.close();
    }
  });

  it('aborts a stopped coordination and starts a sibling when cancellation draining fails', async () => {
    const stopped = run('accepted', 'run.runtime-controller.drain-failure.stopped');
    const sibling = run('accepted', 'run.runtime-controller.drain-failure.sibling');
    let stoppedAllowed = true;
    let siblingAllowed = false;
    const fixture = dataAccess(stopped, {
      active: false,
      isSchedulingAllowed: (runId) =>
        runId === stopped.id ? stoppedAllowed : runId === sibling.id && siblingAllowed,
      listNonterminal: () => [stopped, sibling],
    });
    let markStoppedStarted: (() => void) | undefined;
    const stoppedStarted = new Promise<void>((resolve) => {
      markStoppedStarted = resolve;
    });
    let markStoppedAborted: (() => void) | undefined;
    const stoppedAborted = new Promise<void>((resolve) => {
      markStoppedAborted = resolve;
    });
    let markSiblingStarted: (() => void) | undefined;
    const siblingStarted = new Promise<void>((resolve) => {
      markSiblingStarted = resolve;
    });
    const coordinate = vi.fn(
      async (
        _dependencies: unknown,
        input: { readonly runId: string; readonly signal?: AbortSignal },
      ) => {
        if (input.runId === stopped.id) {
          markStoppedStarted?.();
          if (!input.signal?.aborted) {
            await new Promise<void>((resolve) =>
              input.signal?.addEventListener('abort', resolve, { once: true }),
            );
          }
          markStoppedAborted?.();
          return { kind: 'idle' as const, run: stopped, reason: 'no_pending_inbox' as const };
        }
        markSiblingStarted?.();
        return { kind: 'idle' as const, run: sibling, reason: 'no_pending_inbox' as const };
      },
    );
    const drainFailure = new Error('cancellation drain failed');
    let failDrain = false;
    const drainOperationCancellations = vi.fn(async () => {
      if (failDrain) throw drainFailure;
    });
    const options = controllerOptions(fixture.data, {
      coordinate,
      recover: vi.fn(),
      drainOperationCancellations,
    });
    const observerFailure = new Error('background observer failed');
    options.onBackgroundError.mockImplementation(() => {
      throw observerFailure;
    });
    const controller = createRuntimeController(options);
    try {
      controller.notifyDurableRunWork();
      await stoppedStarted;

      stoppedAllowed = false;
      siblingAllowed = true;
      failDrain = true;
      controller.notifyDurableRunWork();

      await Promise.all([stoppedAborted, siblingStarted]);
      expect(drainOperationCancellations).toHaveBeenCalledTimes(2);
      expect(options.onBackgroundError).toHaveBeenCalledWith(drainFailure);
      expect(coordinate.mock.calls.map((call) => call[1].runId)).toContain(sibling.id);
    } finally {
      await controller.close();
    }
  });

  it('aborts active coordination before waiting for controller shutdown', async () => {
    const value = run('accepted');
    const fixture = dataAccess(value, { active: false });
    let seenSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let markAborted: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    const coordinate = vi.fn(
      async (
        _dependencies: unknown,
        input: { readonly runId: string; readonly signal?: AbortSignal },
      ) => {
        seenSignal = input.signal;
        markStarted?.();
        if (input.signal === undefined) {
          return { kind: 'idle' as const, run: value, reason: 'no_pending_inbox' as const };
        }
        if (!input.signal.aborted) {
          await new Promise<void>((resolve) =>
            input.signal?.addEventListener('abort', resolve, { once: true }),
          );
        }
        markAborted?.();
        return { kind: 'idle' as const, run: value, reason: 'no_pending_inbox' as const };
      },
    );
    const controller = createRuntimeController(
      controllerOptions(fixture.data, { coordinate, recover: vi.fn() }),
    );

    controller.notifyDurableRunWork();
    await started;
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    const closing = controller.close();
    await aborted;
    expect(seenSignal?.aborted).toBe(true);
    await closing;
  });
});
