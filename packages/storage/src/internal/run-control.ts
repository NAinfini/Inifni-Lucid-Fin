import { AttemptTerminalStateSchema, RunTerminalStateSchema, type Run } from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { CommandContext } from './command.js';
import type { StorageEnvironment } from './environment.js';
import { loadBoundOperation, recordOperationOwnerTransitions } from './operation-dispatch.js';
import { requestOperationOwnerCancellation } from './operation-owner-records.js';
import { loadRun } from './run-records.js';
import { StorageError } from '../kernel/errors.js';

export type RunControlAction = 'pause' | 'resume' | 'cancel';

export interface RunControlSubtreeEntry {
  readonly run: Run;
  readonly depth: number;
}

export function listRunControlSubtree(
  database: DatabaseSync,
  root: Run,
  maximumRuns = 100,
): RunControlSubtreeEntry[] {
  const rows = database
    .prepare(
      `WITH RECURSIVE subtree(id, depth) AS (
         SELECT id, 0 FROM runs WHERE id = ?
         UNION ALL
         SELECT child.id, parent.depth + 1
         FROM runs AS child
         JOIN subtree AS parent ON child.parent_run_id = parent.id
       )
       SELECT subtree.id, subtree.depth
       FROM subtree
       JOIN runs AS run ON run.id = subtree.id
       ORDER BY subtree.depth, run.accepted_at, subtree.id
       LIMIT ?`,
    )
    .all(root.id, maximumRuns + 1) as unknown as Array<{
    readonly id: string;
    readonly depth: number;
  }>;
  if (rows.length === 0 || rows[0]?.id !== root.id) {
    throw new StorageError('CORRUPT_DATA', `Run ${root.id} disappeared from its subtree`);
  }
  if (rows.length > maximumRuns) {
    throw new StorageError('INVALID_REQUEST', `Run ${root.id} subtree exceeds ${maximumRuns} Runs`);
  }
  return rows.map(({ id, depth }) => {
    const run = loadRun(database, id);
    if (run.projectId !== root.projectId) {
      throw new StorageError('CORRUPT_DATA', `Run ${run.id} is outside Run ${root.id}'s Project`);
    }
    return { run, depth };
  });
}

export function isRunSchedulingAllowed(database: DatabaseSync, runId: string): boolean {
  loadRun(database, runId);
  const blocked = database
    .prepare(
      `WITH RECURSIVE lineage(id, parent_run_id, status, path) AS (
         SELECT id, parent_run_id, status, id
         FROM runs
         WHERE id = ?
         UNION ALL
         SELECT parent.id, parent.parent_run_id, parent.status, lineage.path || ',' || parent.id
         FROM runs AS parent
         JOIN lineage ON parent.id = lineage.parent_run_id
         WHERE instr(',' || lineage.path || ',', ',' || parent.id || ',') = 0
       )
       SELECT 1 AS blocked
       FROM lineage
       WHERE status = 'paused'
       LIMIT 1`,
    )
    .get(runId) as unknown as { readonly blocked: number } | undefined;
  return blocked === undefined;
}

function boundOperationsForRun(database: DatabaseSync, run: Run) {
  const rows = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE run_id = ? AND owner_authority IS NOT NULL
       ORDER BY rowid`,
    )
    .all(run.id) as unknown as Array<{ readonly id: string }>;
  return rows.map(({ id }) => {
    const operation = loadBoundOperation(database, id);
    if (
      operation.dispatch.key.runId !== run.id ||
      operation.dispatch.key.projectId !== run.projectId ||
      operation.owner.runId !== run.id ||
      operation.owner.projectId !== run.projectId
    ) {
      throw new StorageError(
        'CORRUPT_DATA',
        `Operation ${operation.dispatch.id} is out of Run scope`,
      );
    }
    return operation;
  });
}

export function requestRunBoundOperationCancellations(
  database: DatabaseSync,
  environment: StorageEnvironment,
  run: Run,
  commandId: string,
  occurredAt: string,
  context: CommandContext,
): Run {
  const transitions = boundOperationsForRun(database, run).flatMap((operation) => {
    if (
      AttemptTerminalStateSchema.safeParse(operation.owner.view.state).success ||
      operation.owner.view.cancelRequested
    ) {
      return [];
    }
    return [
      {
        dispatch: operation.dispatch,
        before: operation.owner,
        after: requestOperationOwnerCancellation(database, operation.owner),
      },
    ];
  });
  if (transitions.length === 0) return run;
  return recordOperationOwnerTransitions(
    database,
    environment,
    transitions,
    commandId,
    occurredAt,
    context,
  ).run;
}

export function countUnknownRunControlOperations(
  database: DatabaseSync,
  subtree: readonly RunControlSubtreeEntry[],
): number {
  return subtree.reduce(
    (count, { run }) =>
      count +
      boundOperationsForRun(database, run).filter(({ owner }) => owner.view.state === 'unknown')
        .length,
    0,
  );
}

export interface ControlRunSubtreeInTransactionInput {
  readonly root: Run;
  readonly action: RunControlAction;
  readonly occurredAt: string;
  readonly context: CommandContext;
  readonly subtree?: readonly RunControlSubtreeEntry[];
  readonly settleActivation: (run: Run, action: Exclude<RunControlAction, 'resume'>) => Run;
  readonly transition: (run: Run, status: 'paused' | 'running', commandId: string) => Run;
  readonly terminalize: (
    run: Run,
    commandId: string,
    terminal: { readonly summary: string; readonly resultIds: readonly string[] },
  ) => Run;
  readonly operationCommandId: (run: Run) => string;
  readonly transitionCommandId: (run: Run) => string;
  readonly terminalCommandId: (run: Run) => string;
  readonly terminalSummary: string;
  readonly resultIdsForRun: (run: Run) => readonly string[];
}

export interface ControlledRunSubtree {
  readonly root: Run;
  readonly subtree: readonly RunControlSubtreeEntry[];
}

export function controlRunSubtreeInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  input: ControlRunSubtreeInTransactionInput,
): ControlledRunSubtree {
  const subtree = input.subtree ?? listRunControlSubtree(database, input.root);
  const ordered =
    input.action === 'cancel'
      ? [...subtree].sort(
          (left, right) => right.depth - left.depth || left.run.id.localeCompare(right.run.id),
        )
      : [...subtree].sort(
          (left, right) => left.depth - right.depth || left.run.id.localeCompare(right.run.id),
        );

  for (const entry of ordered) {
    let current = loadRun(database, entry.run.id);
    if (RunTerminalStateSchema.safeParse(current.status).success) continue;

    if (input.action === 'resume') {
      if (current.status === 'paused') {
        input.transition(current, 'running', input.transitionCommandId(current));
      }
      continue;
    }

    if (input.action === 'pause') {
      current = input.settleActivation(current, input.action);
      if (current.status === 'running') {
        input.transition(current, 'paused', input.transitionCommandId(current));
      }
      continue;
    }
    current = input.settleActivation(current, input.action);
    current = requestRunBoundOperationCancellations(
      database,
      environment,
      current,
      input.operationCommandId(current),
      input.occurredAt,
      input.context,
    );
    input.terminalize(current, input.terminalCommandId(current), {
      summary: input.terminalSummary,
      resultIds: input.resultIdsForRun(current),
    });
  }

  return { root: loadRun(database, input.root.id), subtree };
}
