import { describe, expect, it } from 'vitest';
import type { TaskListSummary } from '@lucid-fin/contracts';

import {
  isTaskProgressActive,
  newestActiveMoviePlansForSession,
  selectCurrentTaskListForSession,
} from './task-list-session.js';

function taskList(
  id: string,
  commanderSessionId: string,
  updatedAt: number,
  status: TaskListSummary['status'] = 'ready',
): TaskListSummary {
  return {
    id,
    commanderSessionId,
    taskListType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status,
    summary: id,
    progress: 0,
    completedPhases: 0,
    totalPhases: 6,
    completedTasks: 0,
    totalTasks: 8,
    displayCategory: 'production',
    displayLabel: id,
    createdAt: 1,
    updatedAt,
  };
}

describe('Commander Task List ownership', () => {
  it('keeps a new Commander session empty instead of showing a canvas sibling Task List', () => {
    expect(
      selectCurrentTaskListForSession([taskList('old-list', 'old-session', 9)], 'new-session'),
    ).toBeNull();
    expect(
      selectCurrentTaskListForSession([taskList('old-list', 'old-session', 9)], null),
    ).toBeNull();
  });

  it('selects only the newest active Task List owned by the current session', () => {
    const selected = selectCurrentTaskListForSession(
      [
        taskList('newer-terminal', 'session-1', 12, 'completed'),
        taskList('owned-active', 'session-1', 8),
        taskList('other-active', 'session-2', 20),
      ],
      'session-1',
    );

    expect(selected?.id).toBe('owned-active');
    expect(
      newestActiveMoviePlansForSession(
        [taskList('owned-active', 'session-1', 8), taskList('other-active', 'session-2', 20)],
        'canvas-1',
        'session-1',
      ).map((item) => item.id),
    ).toEqual(['owned-active']);
  });

  it('does not select terminal Task Lists as the current session work', () => {
    expect(
      selectCurrentTaskListForSession(
        [
          taskList('completed', 'session-1', 12, 'completed'),
          taskList('failed', 'session-1', 11, 'failed'),
        ],
        'session-1',
      ),
    ).toBeNull();
  });

  it('shows task progress only while both the run and its owned Task List are active', () => {
    const active = taskList('active', 'session-1', 12, 'running');
    const approval = taskList('approval', 'session-1', 13, 'awaiting_approval');
    const terminal = taskList('terminal', 'session-1', 14, 'failed');

    expect(isTaskProgressActive(true, active)).toBe(true);
    expect(isTaskProgressActive(false, active)).toBe(false);
    expect(isTaskProgressActive(false, approval)).toBe(false);
    expect(isTaskProgressActive(true, terminal)).toBe(false);
    expect(isTaskProgressActive(true, null)).toBe(false);
  });
});
