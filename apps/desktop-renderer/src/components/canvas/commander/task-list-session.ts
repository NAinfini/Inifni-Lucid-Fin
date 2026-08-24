import { isTaskListTerminalStatus, type TaskListSummary } from '@lucid-fin/contracts';

export { isTaskListTerminalStatus } from '@lucid-fin/contracts';

export function belongsToCommanderSession(
  taskList: TaskListSummary,
  sessionId: string | null,
): boolean {
  return Boolean(sessionId && taskList.commanderSessionId === sessionId);
}

export function selectCurrentTaskListForSession(
  taskLists: TaskListSummary[],
  sessionId: string | null,
): TaskListSummary | null {
  if (!sessionId) return null;
  let newestActive: TaskListSummary | null = null;
  for (const taskList of taskLists) {
    if (!belongsToCommanderSession(taskList, sessionId)) continue;
    if (
      !isTaskListTerminalStatus(taskList.status) &&
      (!newestActive || taskList.updatedAt > newestActive.updatedAt)
    ) {
      newestActive = taskList;
    }
  }
  return newestActive;
}

export function isTaskProgressActive(
  hasActiveRun: boolean,
  taskList: TaskListSummary | null,
): boolean {
  return Boolean(hasActiveRun && taskList && !isTaskListTerminalStatus(taskList.status));
}

export function newestActiveMoviePlansForSession(
  taskLists: TaskListSummary[],
  canvasId: string,
  sessionId: string,
): TaskListSummary[] {
  return taskLists
    .filter(
      (taskList) =>
        taskList.taskListType === 'movie.production.v2' &&
        taskList.entityType === 'canvas' &&
        taskList.entityId === canvasId &&
        belongsToCommanderSession(taskList, sessionId) &&
        !isTaskListTerminalStatus(taskList.status),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
}
