import { describe, expect, it, vi } from 'vitest';
import type { TaskList } from '@lucid-fin/contracts';

import {
  cancelOwnedNonterminalTaskLists,
  reconcileStaleCommanderTaskLists,
  settleOwnedTaskListsAfterRun,
} from './commander-task-list-lifecycle.js';

function taskList(
  id: string,
  sessionId: string,
  status: TaskList['status'],
  currentGate?: TaskList['currentGate'],
): TaskList {
  return {
    id,
    taskListType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status,
    currentGate,
    summary: id,
    progress: 0,
    completedPhases: 0,
    totalPhases: 1,
    completedTasks: 0,
    totalTasks: 1,
    input: {},
    output: {},
    metadata: { commanderSessionId: sessionId },
    createdAt: 1,
    updatedAt: 2,
    rowVersion: 0,
    engineVersion: 'test',
    definitionVersion: 1,
  };
}

describe('Commander-owned Task List lifecycle', () => {
  it('cancels only unguarded nonterminal Task Lists owned by the stopped session', async () => {
    const cancel = vi.fn(async () => undefined);
    const engine = {
      list: vi.fn(() => [
        taskList('active', 'session-1', 'running'),
        taskList('approval', 'session-1', 'awaiting_approval', 'production_plan'),
        taskList('terminal', 'session-1', 'failed'),
        taskList('foreign', 'session-2', 'running'),
      ]),
      cancel,
    } as never;

    await cancelOwnedNonterminalTaskLists(engine, 'session-1');

    expect(cancel.mock.calls).toEqual([['active']]);
  });

  it.each(['failed', 'cancelled'] as const)(
    'settles unfinished Task Lists after a %s Commander run',
    async (status) => {
      const cancel = vi.fn(async () => undefined);
      const engine = {
        list: vi.fn(() => [taskList('active', 'session-1', 'ready')]),
        cancel,
      } as never;

      await settleOwnedTaskListsAfterRun(engine, 'session-1', status);

      expect(cancel).toHaveBeenCalledWith('active');
    },
  );

  it('preserves approval state after a successful Commander run', async () => {
    const cancel = vi.fn(async () => undefined);
    const engine = {
      list: vi.fn(() => [taskList('approval', 'session-1', 'awaiting_approval')]),
      cancel,
    } as never;

    await settleOwnedTaskListsAfterRun(engine, 'session-1', 'completed');

    expect(cancel).not.toHaveBeenCalled();
  });

  it('reconciles only stale Task Lists whose latest run explicitly failed or was cancelled', async () => {
    const cancel = vi.fn(async () => undefined);
    const engine = {
      list: vi.fn(() => [
        taskList('failed-list', 'failed-session', 'running'),
        taskList('cancelled-list', 'cancelled-session', 'ready'),
        taskList('active-list', 'active-session', 'running'),
        taskList('failed-gate-list', 'failed-session', 'awaiting_approval', 'production_plan'),
        taskList('approval-list', 'completed-session', 'awaiting_approval'),
        taskList('unknown-list', 'unknown-session', 'blocked'),
      ]),
      cancel,
    } as never;
    const statuses = new Map([
      ['failed-session', 'failed'],
      ['cancelled-session', 'cancelled'],
      ['active-session', 'running'],
      ['completed-session', 'completed'],
    ]);
    const commanderRuns = {
      getLatestForSession: vi.fn((sessionId: string) => {
        const status = statuses.get(sessionId);
        return status ? { status } : undefined;
      }),
    } as never;

    await reconcileStaleCommanderTaskLists(engine, commanderRuns);

    expect(cancel.mock.calls).toEqual([['failed-list'], ['cancelled-list']]);
  });
});
