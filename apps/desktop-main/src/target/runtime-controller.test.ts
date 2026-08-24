import { describe, expect, it, vi } from 'vitest';
import type { Run } from '@lucid-fin/target-contracts';
import type { HarnessActivationSnapshot, TargetDataAccess } from '@lucid-fin/target-storage';
import { createTargetRuntimeController } from './runtime-controller.js';

function run(status: Run['status']): Run {
  return {
    id: 'run.runtime-controller.1',
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
  } as unknown as HarnessActivationSnapshot;
}

function dataAccess(
  value: Run,
  options: {
    readonly active?: boolean;
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
  const listNonterminal = vi.fn(() => ({
    runs: options.listNonterminal?.() ?? [value],
    nextAfterRunId: null,
  }));
  const data = {
    runs: { get, listActivations },
    harness: { loadActivation },
    scheduling: { listNonterminal },
    deliveryOperations: {},
    resultAssessments: {},
    generation: {},
    mediaDerivations: {},
  } as unknown as TargetDataAccess;
  return { data, get, listActivations, loadActivation, listNonterminal };
}

function controllerOptions(
  data: TargetDataAccess,
  kernel: NonNullable<Parameters<typeof createTargetRuntimeController>[0]['kernel']>,
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

describe('target Runtime controller', () => {
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
    const controller = createTargetRuntimeController(options);

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
    const controller = createTargetRuntimeController(
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
    const controller = createTargetRuntimeController(
      controllerOptions(fixture.data, { coordinate, recover: vi.fn() }),
    );

    controller.notifyDurableRunWork();
    controller.notifyDurableRunWork();
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
});
