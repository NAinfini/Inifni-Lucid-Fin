import type { CanonicalModelRequestV1, Run } from '@lucid-fin/target-contracts';
import {
  coordinateRun,
  createTargetStorageReadToolExecutor,
  recoverTargetActivation,
  type RecoverTargetActivationInput,
  type RunCoordinationResult,
  type RunCoordinatorDependencies,
  type TargetModelAdapter,
} from '@lucid-fin/target-runtime';
import type { HarnessActivationSnapshot, TargetDataAccess } from '@lucid-fin/target-storage';
import type { TargetDesktopRuntimeController } from './composition-root.js';

interface TargetRuntimeControllerKernel {
  coordinate(
    dependencies: RunCoordinatorDependencies,
    input: {
      readonly runId: string;
      readonly limits: CanonicalModelRequestV1['limits'];
      readonly context: {
        readonly actor: 'commander';
        readonly causation: { readonly kind: 'run'; readonly runId: string };
        readonly correlationId: string;
      };
    },
  ): Promise<RunCoordinationResult>;
  recover(
    dependencies: { readonly persistence: TargetDataAccess['harness'] },
    input: RecoverTargetActivationInput,
  ): ReturnType<typeof recoverTargetActivation>;
}

export interface TargetRuntimeControllerOptions {
  readonly data: TargetDataAccess;
  readonly model: TargetModelAdapter;
  readonly createId: (kind: 'command' | 'correlation' | 'request') => string;
  readonly limitsForRun: (run: Run) => CanonicalModelRequestV1['limits'];
  readonly onBackgroundError: (cause: unknown) => void;
  readonly publishPersistedRunHead: (run: Run) => void;
  readonly kernel?: TargetRuntimeControllerKernel;
}

const defaultKernel: TargetRuntimeControllerKernel = Object.freeze({
  coordinate: coordinateRun,
  recover: recoverTargetActivation,
});

function commanderContext(runId: string, createId: TargetRuntimeControllerOptions['createId']) {
  return {
    actor: 'commander' as const,
    causation: { kind: 'run' as const, runId },
    correlationId: createId('correlation'),
  };
}

function activeSnapshot(data: TargetDataAccess, runId: string): HarnessActivationSnapshot | null {
  const active = data.runs.listActivations(runId).filter(({ state }) => state === 'active');
  if (active.length > 1) throw new Error(`Run ${runId} has multiple active Activations`);
  const activation = active[0];
  return activation === undefined
    ? null
    : data.harness.loadActivation(runId, activation.activationNumber);
}

function currentRun(data: TargetDataAccess, runId: string, requestId: string): Run {
  return data.runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId,
    method: 'run.get',
    input: { runId },
  }).result;
}

export function createTargetRuntimeController(
  options: TargetRuntimeControllerOptions,
): TargetDesktopRuntimeController {
  const { data } = options;
  const kernel = options.kernel ?? defaultKernel;
  const dependencies: RunCoordinatorDependencies = {
    runs: data.runs,
    persistence: data.harness,
    model: options.model,
    toolExecutor: createTargetStorageReadToolExecutor(data),
    deliveryOperations: data.deliveryOperations,
    resultAssessments: data.resultAssessments,
    generation: data.generation,
    mediaDerivations: data.mediaDerivations,
  };
  let closed = false;
  let drainRequested = false;
  let drain: Promise<void> | null = null;

  const listNonterminalRuns = (): Run[] => {
    const runs: Run[] = [];
    let afterRunId: string | null = null;
    do {
      const page = data.scheduling.listNonterminal({ afterRunId, limit: 200 });
      runs.push(...page.runs);
      afterRunId = page.nextAfterRunId;
    } while (afterRunId !== null);
    return runs;
  };

  const coordinate = async (run: Run): Promise<RunCoordinationResult> => {
    const result = await kernel.coordinate(dependencies, {
      runId: run.id,
      limits: options.limitsForRun(run),
      context: commanderContext(run.id, options.createId),
    });
    options.publishPersistedRunHead(result.kind === 'executed' ? result.snapshot.run : result.run);
    return result;
  };

  const recoverRun = (snapshot: HarnessActivationSnapshot): void => {
    const expectedPublicEventHead = snapshot.run.publicEventHead;
    if (expectedPublicEventHead === null) {
      throw new Error(`Recovering Run ${snapshot.run.id} has no public event head`);
    }
    const recovered = kernel.recover(
      { persistence: data.harness },
      {
        close: {
          runId: snapshot.run.id,
          activationNumber: snapshot.activation.activationNumber,
          expectedRunRevision: snapshot.run.revision,
          expectedRunContentHash: snapshot.run.contentHash,
          expectedPublicEventHead,
          commandId: options.createId('command'),
        },
        retryCommandId: options.createId('command'),
        context: commanderContext(snapshot.run.id, options.createId),
      },
    );
    options.publishPersistedRunHead(recovered.closed.run);
    options.publishPersistedRunHead(recovered.retry.retryRun);
  };

  const reconcileInterruptedRun = async (run: Run): Promise<void> => {
    if (run.status !== 'running' && run.status !== 'recovering') return;
    let snapshot = activeSnapshot(data, run.id);
    if (snapshot === null || !snapshot.recoveryRequired) return;

    await coordinate(run);
    const refreshed = currentRun(data, run.id, options.createId('request'));
    if (refreshed.status !== 'running' && refreshed.status !== 'recovering') return;
    snapshot = activeSnapshot(data, run.id);
    if (snapshot !== null && snapshot.recoveryRequired) recoverRun(snapshot);
  };

  const drainRunnableRuns = async (): Promise<void> => {
    while (!closed && drainRequested) {
      drainRequested = false;
      let executed = false;
      for (const run of listNonterminalRuns()) {
        if (closed) return;
        if (run.status !== 'accepted' && run.status !== 'running') continue;
        const result = await coordinate(run);
        if (result.kind === 'executed') executed = true;
      }
      if (executed) drainRequested = true;
    }
  };

  const notifyDurableRunWork = (): void => {
    if (closed) return;
    drainRequested = true;
    if (drain !== null) return;
    drain = drainRunnableRuns()
      .catch((cause: unknown) => options.onBackgroundError(cause))
      .finally(() => {
        drain = null;
        if (drainRequested && !closed) notifyDurableRunWork();
      });
  };

  return Object.freeze({
    async recoverAndReconcile(): Promise<void> {
      for (const run of listNonterminalRuns()) await reconcileInterruptedRun(run);
    },
    notifyDurableRunWork,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      drainRequested = false;
      await drain;
    },
  });
}
