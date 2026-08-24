import type { Task, TaskExecutionAttempt, TaskList } from '@lucid-fin/contracts';
import { setDegradeReporter, type DegradeReporter } from '@lucid-fin/contracts-parse';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteIndex } from '../sqlite-index.js';
import { TaskListRepository } from './task-list-repository.js';

function makeTaskList(id: string, overrides: Partial<TaskList> = {}): TaskList {
  return {
    id,
    taskListType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status: 'queued',
    summary: '',
    progress: 0,
    completedPhases: 0,
    totalPhases: 0,
    completedTasks: 0,
    totalTasks: 0,
    input: {},
    output: {},
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
    rowVersion: 0,
    engineVersion: 'test',
    definitionVersion: 1,
    ...overrides,
  };
}

function makeTask(
  id: string,
  taskListId: string,
  phaseKey: string,
  phaseOrder: number,
  overrides: Partial<Task> = {},
): Task {
  return {
    id,
    taskListId,
    phaseKey,
    phaseName: phaseKey === 'plan' ? 'Plan' : 'Generate media',
    phaseOrder,
    taskKey: id,
    name: id,
    kind: 'validation',
    status: 'pending',
    dependencyIds: [],
    attempts: 0,
    maxRetries: 2,
    input: {},
    output: {},
    progress: 0,
    updatedAt: 1,
    ...overrides,
  };
}

describe('TaskListRepository', () => {
  let index: SqliteIndex;
  const degradeReports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    degradeReports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    index = new SqliteIndex(':memory:');
    degradeReports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    index.close();
  });

  it('round-trips, filters, CAS-updates, and degrades corrupt Task Lists', () => {
    const repo = index.repos.taskLists;
    repo.insertTaskList(
      makeTaskList('list-1', {
        input: { idea: 'rain' },
        output: { plan: 'ready' },
        metadata: { traceId: 'trace-1', commanderSessionId: 'session-1' },
      }),
    );
    repo.insertTaskList(makeTaskList('list-2', { entityId: 'canvas-2', status: 'running' }));

    expect(repo.getTaskList('list-1')).toMatchObject({
      taskListType: 'movie.production.v2',
      input: { idea: 'rain' },
      output: { plan: 'ready' },
      metadata: { traceId: 'trace-1' },
    });
    expect(repo.listTaskLists({ status: 'running', entityId: 'canvas-2' })).toEqual({
      rows: [expect.objectContaining({ id: 'list-2' })],
      degradedCount: 0,
    });
    const summaries = repo.listTaskListSummaries({ entityType: 'canvas' });
    expect(summaries.find((summary) => summary.id === 'list-1')).toMatchObject({
      commanderSessionId: 'session-1',
    });
    expect(summaries.find((summary) => summary.id === 'list-2')?.commanderSessionId).toBeUndefined();
    expect(repo.compareAndSetTaskListMetadata('list-1', 0, { traceId: 'trace-2' }, 2)).toBe(true);
    expect(repo.compareAndSetTaskListMetadata('list-1', 0, { stale: true }, 3)).toBe(false);
    expect(repo.getTaskList('list-1')).toMatchObject({
      rowVersion: 1,
      metadata: { traceId: 'trace-2' },
      updatedAt: 2,
    });

    index.rawDb
      .prepare(
        `INSERT INTO task_lists (
          id, task_list_type, entity_type, trigger_source, status, summary, progress,
          completed_phases, total_phases, completed_tasks, total_tasks, input_json,
          output_json, metadata_json, created_at, updated_at
        ) VALUES ('corrupt', 'type', 'entity', 'test', 'runing', '', 0, 0, 0, 0, 0,
                  '{}', '{}', '{}', 1, 1)`,
      )
      .run();
    const listed = repo.listTaskLists();
    expect(listed.degradedCount).toBe(1);
    expect(listed.rows.map(({ id }) => id).sort()).toEqual(['list-1', 'list-2']);
    expect(degradeReports.some(({ schema }) => schema === 'TaskList')).toBe(true);
  });

  it('fences two engine owners and permits takeover only after expiry', () => {
    const first = index.repos.taskLists;
    const second = new TaskListRepository(index.rawDb);
    first.insertTaskList(makeTaskList('list-lease'));

    const leaseA = first.tryAcquireLease('list-lease', 'engine-a', 100, 30_000);
    expect(leaseA).toMatchObject({ ownerId: 'engine-a', token: 1, expiresAt: 30_100 });
    expect(second.tryAcquireLease('list-lease', 'engine-b', 101, 30_000)).toBeUndefined();

    const leaseB = second.tryAcquireLease('list-lease', 'engine-b', 30_100, 30_000);
    expect(leaseB).toMatchObject({ ownerId: 'engine-b', token: 2 });
    expect(
      first.renewLease('list-lease', 'engine-a', leaseA!.token, 30_101, 30_000),
    ).toBeUndefined();
    expect(() =>
      first.runWithLease('list-lease', 'engine-a', leaseA!.token, 30_101, () =>
        first.updateTaskList('list-lease', { status: 'failed', updatedAt: 30_101 }),
      ),
    ).toThrow('lease is stale');

    second.runWithLease('list-lease', 'engine-b', leaseB!.token, 30_101, () =>
      second.updateTaskList('list-lease', { status: 'running', updatedAt: 30_101 }),
    );
    expect(second.getTaskList('list-lease')).toMatchObject({
      status: 'running',
      leaseOwner: 'engine-b',
      leaseToken: 2,
    });
  });

  it('stores a flat phase-tagged task graph, artifacts, and renderer summaries', () => {
    const repo = index.repos.taskLists;
    repo.insertTaskList(
      makeTaskList('list-1', {
        summary: 'Movie production',
        metadata: { displayCategory: 'production', displayLabel: 'Movie production' },
      }),
    );
    repo.insertTask(
      makeTask('task-plan', 'list-1', 'plan', 0, {
        taskKey: 'write-plan',
        status: 'completed',
        progress: 100,
        completedAt: 2,
        updatedAt: 2,
      }),
    );
    repo.insertTask(
      makeTask('task-media', 'list-1', 'media-generation', 1, {
        taskKey: 'generate-shot-1',
        kind: 'adapter_generation',
        status: 'ready',
        dependencyIds: ['task-plan'],
        provider: 'replicate',
        input: { displayLabel: 'Shot 1', relatedEntityLabel: 'Opening' },
        updatedAt: 3,
      }),
    );

    expect(repo.listTasks('list-1').rows.map(({ id }) => id)).toEqual(['task-plan', 'task-media']);
    expect(repo.listTasksByPhase('list-1', 'media-generation').rows).toEqual([
      expect.objectContaining({ id: 'task-media', phaseOrder: 1 }),
    ]);
    expect(repo.listTaskDependencies('task-media')).toEqual(['task-plan']);
    expect(repo.listTaskDependents('task-plan')).toEqual(['task-media']);
    expect(repo.listTaskDependenciesBatch(['task-plan', 'task-media'])).toEqual(
      new Map([
        ['task-plan', []],
        ['task-media', ['task-plan']],
      ]),
    );
    expect(() => repo.replaceTaskDependencies('task-media', ['task-media'])).toThrow(
      'cannot depend on itself',
    );

    repo.insertArtifact({
      id: 'artifact-1',
      taskListId: 'list-1',
      taskId: 'task-media',
      artifactType: 'image',
      entityType: 'canvas_node',
      entityId: 'node-1',
      assetHash: 'asset-1',
      path: 'assets/asset-1.png',
      metadata: { accepted: true },
      createdAt: 4,
    });
    expect(repo.listArtifacts('list-1').map(({ id }) => id)).toEqual(['artifact-1']);
    expect(repo.listArtifactsByTask('task-media').map(({ assetHash }) => assetHash)).toEqual([
      'asset-1',
    ]);
    expect(repo.listEntityArtifacts('canvas_node', 'node-1').map(({ id }) => id)).toEqual([
      'artifact-1',
    ]);
    expect(repo.listTaskSummaries({ phaseKey: 'media-generation' })).toEqual([
      expect.objectContaining({
        id: 'task-media',
        taskListId: 'list-1',
        phaseKey: 'media-generation',
        displayLabel: 'Shot 1',
        producedArtifacts: [expect.objectContaining({ id: 'artifact-1' })],
      }),
    ]);
    expect(repo.listTaskListSummaries({ entityType: 'canvas' })).toEqual([
      expect.objectContaining({
        id: 'list-1',
        displayCategory: 'production',
        displayLabel: 'Movie production',
        producedArtifacts: [expect.objectContaining({ id: 'artifact-1' })],
      }),
    ]);
    expect(repo.getTaskListSummary('list-1')).toMatchObject({
      id: 'list-1',
      producedArtifacts: [expect.objectContaining({ id: 'artifact-1' })],
    });
  });

  it('lists only ungated recoverable tasks in deterministic order', () => {
    const repo = index.repos.taskLists;
    repo.insertTaskList(makeTaskList('list-open', { status: 'running' }));
    repo.insertTaskList(
      makeTaskList('list-gated', { status: 'awaiting_approval', currentGate: 'production_plan' }),
    );
    repo.insertTask(makeTask('dependency', 'list-open', 'plan', 0, { status: 'completed' }));
    repo.insertTask(
      makeTask('running', 'list-open', 'media-generation', 1, {
        status: 'running',
        dependencyIds: ['dependency'],
        updatedAt: 3,
      }),
    );
    repo.insertTask(
      makeTask('awaiting', 'list-open', 'media-generation', 1, {
        status: 'awaiting_provider',
        updatedAt: 2,
      }),
    );
    repo.insertTask(
      makeTask('invalidated', 'list-open', 'media-generation', 1, {
        status: 'running',
        input: { invalidatedByPlanRevision: 2 },
      }),
    );
    repo.insertTask(makeTask('gated', 'list-gated', 'plan', 0, { status: 'running' }));

    expect(repo.listRecoverableTasks()).toEqual({
      rows: [
        expect.objectContaining({ id: 'awaiting', dependencyIds: [] }),
        expect.objectContaining({ id: 'running', dependencyIds: ['dependency'] }),
      ],
      degradedCount: 0,
    });
    expect(repo.listRecoverableTasks('list-open')).toEqual(
      expect.objectContaining({
        rows: expect.arrayContaining([expect.objectContaining({ id: 'running' })]),
      }),
    );
    expect(repo.listRecoverableTasks('list-gated').rows).toEqual([]);
  });

  it('derives phase and Task List progress directly from Tasks', () => {
    const repo = index.repos.taskLists;
    repo.insertTaskList(makeTaskList('list-aggregate'));
    repo.insertTask(
      makeTask('plan-a', 'list-aggregate', 'plan', 0, {
        status: 'completed',
        progress: 100,
        completedAt: 2,
        updatedAt: 2,
      }),
    );
    repo.insertTask(
      makeTask('media-a', 'list-aggregate', 'media-generation', 1, {
        status: 'running',
        progress: 50,
        updatedAt: 3,
      }),
    );
    repo.insertTask(
      makeTask('media-b', 'list-aggregate', 'media-generation', 1, {
        status: 'ready',
        progress: 0,
        updatedAt: 4,
      }),
    );

    repo.recomputePhaseAggregate('list-aggregate', 'media-generation');
    expect(repo.getTaskList('list-aggregate')).toMatchObject({
      status: 'running',
      completedPhases: 1,
      totalPhases: 2,
      completedTasks: 1,
      totalTasks: 3,
      currentPhaseKey: 'media-generation',
      currentTaskId: 'media-a',
      progress: 63,
    });

    repo.updateTask('media-a', {
      status: 'completed',
      progress: 100,
      completedAt: 5,
      updatedAt: 5,
    });
    repo.updateTask('media-b', {
      status: 'completed',
      progress: 100,
      completedAt: 6,
      updatedAt: 6,
    });
    repo.recomputeTaskListAggregate('list-aggregate');
    expect(repo.getTaskList('list-aggregate')).toMatchObject({
      status: 'completed',
      progress: 100,
      completedPhases: 2,
      totalPhases: 2,
      completedTasks: 3,
      totalTasks: 3,
      currentPhaseKey: undefined,
      currentTaskId: undefined,
      summary: 'completed 2/2 phases, 3/3 tasks',
    });
  });

  it('persists idempotent generic Task Attempts in the unified ledger', () => {
    const repo = index.repos.taskLists;
    repo.insertTaskList(makeTaskList('list-1'));
    repo.insertTask(makeTask('task-1', 'list-1', 'plan', 0, { status: 'running' }));
    const attempt: TaskExecutionAttempt = {
      kind: 'task',
      id: 'attempt-1',
      taskListId: 'list-1',
      taskId: 'task-1',
      attempt: 1,
      idempotencyKey: 'task-1:1',
      status: 'running',
      rowVersion: 0,
      input: { prompt: 'plan' },
      output: {},
      metadata: { handler: 'llm' },
      createdAt: 1,
      updatedAt: 1,
    };

    expect(repo.reserveTaskAttempt({ attempt })).toEqual({ attempt, created: true });
    expect(repo.reserveTaskAttempt({ attempt })).toEqual({ attempt, created: false });
    expect(
      repo.transitionTaskAttempt({
        id: 'attempt-1',
        expectedRowVersion: 0,
        expectedStatuses: ['running'],
        status: 'completed',
        output: { documentId: 'doc-1' },
        metadata: { handler: 'llm', tokens: 42 },
        updatedAt: 2,
        completedAt: 2,
      }),
    ).toMatchObject({
      id: 'attempt-1',
      status: 'completed',
      rowVersion: 1,
      output: { documentId: 'doc-1' },
      metadata: { handler: 'llm', tokens: 42 },
      completedAt: 2,
    });
    expect(repo.listTaskAttempts('task-1').map(({ id }) => id)).toEqual(['attempt-1']);
    expect(() =>
      repo.transitionTaskAttempt({
        id: 'attempt-1',
        expectedRowVersion: 0,
        expectedStatuses: ['running'],
        status: 'failed',
        updatedAt: 3,
      }),
    ).toThrow('changed concurrently');
  });
});
