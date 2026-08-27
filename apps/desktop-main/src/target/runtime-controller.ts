import type { CanonicalModelRequestV1, Run } from '@lucid-fin/target-contracts';
import {
  coordinateRun,
  createTargetStorageReadToolExecutor,
  drainRequestedOperationCancellations,
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
      readonly signal?: AbortSignal;
    },
  ): Promise<RunCoordinationResult>;
  recover(
    dependencies: { readonly persistence: TargetDataAccess['harness'] },
    input: RecoverTargetActivationInput,
  ): ReturnType<typeof recoverTargetActivation>;
  drainOperationCancellations?(
    dependencies: RunCoordinatorDependencies,
  ): ReturnType<typeof drainRequestedOperationCancellations>;
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
  const reportBackgroundError = (cause: unknown): void => {
    try {
      options.onBackgroundError(cause);
    } catch {
      // A host observer cannot alter durable runtime scheduling or recovery.
    }
  };
  const dependencies: RunCoordinatorDependencies = {
    runs: data.runs,
    persistence: data.harness,
    model: options.model,
    toolExecutor: createTargetStorageReadToolExecutor(data),
    onOperationCancellationError: reportBackgroundError,
    operations: data.operations,
    deliveryOperations: data.deliveryOperations,
    resultAssessments: data.resultAssessments,
    generation: data.generation,
    mediaDerivations: data.mediaDerivations,
  };
  const drainOperationCancellations = async (): Promise<void> => {
    try {
      await (kernel.drainOperationCancellations ?? drainRequestedOperationCancellations)(
        dependencies,
      );
    } catch (cause) {
      reportBackgroundError(cause);
    }
  };
  let closed = false;
  let notificationGeneration = 0;
  let sweepRequested = false;
  let sweep: Promise<void> | null = null;
  const activeCoordination = new Map<string, Promise<void>>();
  const activeCoordinationAbort = new Map<string, AbortController>();
  const lastAttemptGeneration = new Map<string, number>();

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

  const isDurablyRunnable = (run: Run): boolean =>
    (run.status === 'accepted' || run.status === 'running') &&
    data.runs.isSchedulingAllowed(run.id);

  const coordinate = async (run: Run, signal?: AbortSignal): Promise<RunCoordinationResult> => {
    const result = await kernel.coordinate(dependencies, {
      runId: run.id,
      limits: options.limitsForRun(run),
      context: commanderContext(run.id, options.createId),
      signal,
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
    if (!data.runs.isSchedulingAllowed(run.id)) return;
    let snapshot = activeSnapshot(data, run.id);
    if (snapshot === null) return;
    if (snapshot.modelAttempts.at(-1)?.response?.events.at(-1)?.type === 'model_failed') {
      await coordinate(run);
      return;
    }
    if (!snapshot.recoveryRequired) return;

    await coordinate(run);
    const refreshed = currentRun(data, run.id, options.createId('request'));
    if (refreshed.status !== 'running' && refreshed.status !== 'recovering') return;
    snapshot = activeSnapshot(data, run.id);
    if (snapshot !== null && snapshot.recoveryRequired) recoverRun(snapshot);
  };

  function requestSweep(): void {
    if (closed) return;
    sweepRequested = true;
    if (sweep !== null) return;
    sweep = drainRunnableRuns()
      .catch(reportBackgroundError)
      .finally(() => {
        sweep = null;
        if (sweepRequested && !closed) requestSweep();
      });
  }

  const startRunCoordination = (run: Run, generation: number): void => {
    if (closed || activeCoordination.has(run.id)) return;
    lastAttemptGeneration.set(run.id, generation);
    const abortController = new AbortController();
    activeCoordinationAbort.set(run.id, abortController);

    const task = (async () => {
      let current = run;
      while (!closed) {
        let result: RunCoordinationResult;
        try {
          result = await coordinate(current, abortController.signal);
        } catch (cause) {
          reportBackgroundError(cause);
          return;
        }
        if (result.kind !== 'executed') return;
        current = result.snapshot.run;
        if (current.status !== 'accepted' && current.status !== 'running') return;
      }
    })().finally(() => {
      if (activeCoordination.get(run.id) === task) activeCoordination.delete(run.id);
      if (activeCoordinationAbort.get(run.id) === abortController) {
        activeCoordinationAbort.delete(run.id);
      }
      if (!closed) requestSweep();
    });
    activeCoordination.set(run.id, task);
  };

  const drainRunnableRuns = async (): Promise<void> => {
    while (!closed && sweepRequested) {
      sweepRequested = false;
      const nonterminalRuns = listNonterminalRuns();
      const nonterminalRunIds = new Set(nonterminalRuns.map(({ id }) => id));
      const runnableRunIds = new Set(nonterminalRuns.filter(isDurablyRunnable).map(({ id }) => id));
      for (const [runId, abortController] of activeCoordinationAbort) {
        if (!runnableRunIds.has(runId)) abortController.abort();
      }
      await drainOperationCancellations();
      const generation = notificationGeneration;
      for (const runId of lastAttemptGeneration.keys()) {
        if (!nonterminalRunIds.has(runId) && !activeCoordination.has(runId)) {
          lastAttemptGeneration.delete(runId);
        }
      }
      for (const run of nonterminalRuns) {
        if (closed) return;
        if (!isDurablyRunnable(run)) continue;
        if (activeCoordination.has(run.id)) continue;
        if (lastAttemptGeneration.get(run.id) === generation) continue;
        startRunCoordination(run, generation);
      }
    }
  };

  const notifyDurableRunWork = (): void => {
    if (closed) return;
    notificationGeneration += 1;
    requestSweep();
  };

  return Object.freeze({
    async recoverAndReconcile(): Promise<void> {
      await drainOperationCancellations();
      for (const run of listNonterminalRuns()) await reconcileInterruptedRun(run);
    },
    notifyDurableRunWork,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      sweepRequested = false;
      for (const abortController of activeCoordinationAbort.values()) abortController.abort();
      await sweep;
      await Promise.all(activeCoordination.values());
    },
  });
}
