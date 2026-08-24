import { isTaskListTerminalStatus, type TaskList, type TaskListStatus } from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';

export function isTerminalPersistentTaskListStatus(status: TaskListStatus): boolean {
  return isTaskListTerminalStatus(status);
}

function isActiveTaskListForCanvas(taskList: TaskList, canvasId: string): boolean {
  return (
    taskList.entityType === 'canvas' &&
    taskList.entityId === canvasId &&
    !isTerminalPersistentTaskListStatus(taskList.status)
  );
}

/**
 * Persistent movie task lists own generation for their bound Canvas. Manual
 * Canvas generation would bypass the approved Visual Constitution revision and
 * its provenance, so fail closed and direct the caller back to that task list.
 */
export function assertManualCanvasGenerationAllowed(db: SqliteIndex, canvasId: string): void {
  const result = db.repos.taskLists.listTaskLists({
    taskListType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: canvasId,
  });

  if (result.degradedCount > 0) {
    throw new Error(
      'Persistent task-list state is unreadable. Manual Canvas generation is paused to protect the approved Visual Constitution.',
    );
  }

  const activeTaskList = result.rows.find((taskList) =>
    isActiveTaskListForCanvas(taskList, canvasId),
  );
  if (!activeTaskList) return;

  throw new Error(
    `Canvas ${canvasId} is bound to active persistent Task List ${activeTaskList.id}. Generate or refine media through that Task List so its approved Visual Constitution remains authoritative.`,
  );
}
