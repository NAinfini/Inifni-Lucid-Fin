import type { WorkflowRun, WorkflowRunStatus } from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';

const TERMINAL_WORKFLOW_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set([
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'dead',
]);

export function isTerminalPersistentWorkflowStatus(status: WorkflowRunStatus): boolean {
  return TERMINAL_WORKFLOW_STATUSES.has(status);
}

function isActiveRunForCanvas(run: WorkflowRun, canvasId: string): boolean {
  return (
    run.entityType === 'canvas' &&
    run.entityId === canvasId &&
    !isTerminalPersistentWorkflowStatus(run.status)
  );
}

/**
 * Persistent movie workflows own generation for their bound Canvas. Manual
 * Canvas generation would bypass the approved Visual Constitution revision and
 * its provenance, so fail closed and direct the caller back to that workflow.
 */
export function assertManualCanvasGenerationAllowed(db: SqliteIndex, canvasId: string): void {
  const result = db.repos.workflows.listRuns({
    workflowType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: canvasId,
  });

  if (result.degradedCount > 0) {
    throw new Error(
      'Persistent workflow state is unreadable. Manual Canvas generation is paused to protect the approved Visual Constitution.',
    );
  }

  const activeRun = result.rows.find((run) => isActiveRunForCanvas(run, canvasId));
  if (!activeRun) return;

  throw new Error(
    `Canvas ${canvasId} is bound to active persistent workflow ${activeRun.id}. Generate or refine media through that workflow so its approved Visual Constitution remains authoritative.`,
  );
}
