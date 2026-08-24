import type { TaskExecutionEngine } from '@lucid-fin/application';
import {
  getCommanderSessionId,
  isTaskListTerminalStatus,
  type CommanderRunStatus,
  type SessionId,
} from '@lucid-fin/contracts';
import type { CommanderRunRepository } from '@lucid-fin/storage';

export async function cancelOwnedNonterminalTaskLists(
  taskExecutionEngine: TaskExecutionEngine,
  sessionId: string,
): Promise<void> {
  const owned = taskExecutionEngine
    .list()
    .filter(
      (taskList) =>
        getCommanderSessionId(taskList.metadata) === sessionId &&
        !isTaskListTerminalStatus(taskList.status) &&
        !taskList.currentGate,
    );

  for (const taskList of owned) {
    await taskExecutionEngine.cancel(taskList.id);
  }
}

export async function settleOwnedTaskListsAfterRun(
  taskExecutionEngine: TaskExecutionEngine,
  sessionId: string,
  status: CommanderRunStatus,
): Promise<void> {
  if (status !== 'failed' && status !== 'cancelled') return;
  await cancelOwnedNonterminalTaskLists(taskExecutionEngine, sessionId);
}

export async function reconcileStaleCommanderTaskLists(
  taskExecutionEngine: TaskExecutionEngine,
  commanderRuns: Pick<CommanderRunRepository, 'getLatestForSession'>,
): Promise<void> {
  const sessionIds = new Set(
    taskExecutionEngine
      .list()
      .filter((taskList) => !isTaskListTerminalStatus(taskList.status))
      .map((taskList) => getCommanderSessionId(taskList.metadata))
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  );

  for (const sessionId of sessionIds) {
    const latestRun = commanderRuns.getLatestForSession(sessionId as SessionId);
    if (latestRun?.status !== 'failed' && latestRun?.status !== 'cancelled') continue;
    await cancelOwnedNonterminalTaskLists(taskExecutionEngine, sessionId);
  }
}
