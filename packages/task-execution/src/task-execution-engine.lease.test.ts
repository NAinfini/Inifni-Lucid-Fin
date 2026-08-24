import { afterEach, describe, expect, it } from 'vitest';
import { SqliteIndex } from '@lucid-fin/storage';
import type { Task, TaskHandler, TaskId, TaskList, TaskListId } from '@lucid-fin/contracts';
import { TaskExecutionEngine } from './task-execution-engine.js';
import { TaskListRegistry } from './task-list-registry.js';

function registry(handlerId: string): TaskListRegistry {
  const value = new TaskListRegistry();
  value.register({
    id: 'lease-test',
    name: 'Lease test',
    version: 1,
    kind: 'test',
    description: 'Lease test',
    displayCategory: 'test',
    displayLabel: 'Lease test',
    tasks: [
      {
        id: 'run',
        name: 'Run',
        phaseKey: 'run',
        phaseName: 'Run',
        phaseOrder: 0,
        kind: 'validation',
        maxRetries: 0,
        handlerId,
        displayCategory: 'test',
        displayLabel: 'Run',
      },
    ],
  });
  return value;
}

function movieTaskList(id: string, overrides: Partial<TaskList> = {}): TaskList {
  return {
    id,
    taskListType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: `canvas-${id}`,
    triggerSource: 'commander',
    status: 'ready',
    summary: '',
    progress: 0,
    completedPhases: 0,
    totalPhases: 1,
    completedTasks: 0,
    totalTasks: 1,
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

function externalTask(id: string, taskListId: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    taskListId,
    phaseKey: 'production-plan',
    phaseName: 'Production plan',
    phaseOrder: 0,
    taskKey: 'production-plan',
    name: 'Production plan',
    kind: 'validation',
    status: 'ready',
    dependencyIds: [],
    attempts: 0,
    maxRetries: 0,
    input: { executionMode: 'external', taskRole: 'script' },
    output: {},
    progress: 0,
    updatedAt: 1,
    ...overrides,
  };
}

function acquireLeaseForTest(engine: TaskExecutionEngine, taskListId: string): void {
  const lease = (
    engine as unknown as {
      acquireLease(id: string): unknown;
    }
  ).acquireLease(taskListId);
  expect(lease).toBeDefined();
}

describe('TaskExecutionEngine lease fencing', () => {
  const indexes: SqliteIndex[] = [];
  afterEach(() => {
    for (const index of indexes.splice(0)) index.close();
  });

  it('lets only one engine execute a ready task and releases the lease on terminal state', async () => {
    const db = new SqliteIndex(':memory:');
    indexes.push(db);
    let executions = 0;
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => (started = resolve));
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const handler: TaskHandler = {
      id: 'hold',
      kind: 'validation',
      async execute() {
        executions += 1;
        started();
        await blocked;
        return { status: 'completed' };
      },
    };
    const first = new TaskExecutionEngine({ db, registry: registry('hold'), handlers: [handler] });
    const second = new TaskExecutionEngine({ db, registry: registry('hold'), handlers: [handler] });

    const taskListId = first.start({ taskListType: 'lease-test', entityType: 'canvas' });
    await startedPromise;
    expect(await second.pump(taskListId)).toBe(0);
    expect(executions).toBe(1);

    release();
    await first.waitForAutoPump();
    expect(first.getTasks(taskListId)[0]).toMatchObject({ status: 'completed', attempts: 1 });
    expect(first.get(taskListId)).toMatchObject({
      status: 'completed',
      leaseOwner: undefined,
      leaseToken: 1,
    });
  });

  it('fails closed instead of resubmitting an unrecoverable provider task', async () => {
    const db = new SqliteIndex(':memory:');
    indexes.push(db);
    const taskList: TaskList = {
      id: 'list-recover',
      taskListType: 'lease-test',
      entityType: 'canvas',
      triggerSource: 'test',
      status: 'running',
      summary: '',
      progress: 0,
      completedPhases: 0,
      totalPhases: 1,
      completedTasks: 0,
      totalTasks: 1,
      currentPhaseKey: 'run',
      currentTaskId: 'task-recover',
      input: {},
      output: {},
      metadata: {},
      createdAt: 1,
      updatedAt: 1,
    };
    const task: Task = {
      id: 'task-recover',
      taskListId: taskList.id,
      phaseKey: 'run',
      phaseName: 'Run',
      phaseOrder: 0,
      taskKey: 'run',
      name: 'Run',
      kind: 'adapter_generation',
      status: 'awaiting_provider',
      dependencyIds: [],
      attempts: 1,
      maxRetries: 3,
      input: { handlerId: 'provider' },
      output: {},
      providerTaskId: 'provider-job-1',
      progress: 25,
      updatedAt: 1,
    };
    db.repos.taskLists.insertTaskList(taskList);
    db.repos.taskLists.insertTask(task);
    let executeCalls = 0;
    const handler: TaskHandler = {
      id: 'provider',
      kind: 'adapter_generation',
      async execute() {
        executeCalls += 1;
        return { status: 'completed' };
      },
    };
    const engine = new TaskExecutionEngine({ db, registry: registry('provider'), handlers: [handler] });

    expect(await engine.recover(taskList.id)).toBe(1);
    expect(executeCalls).toBe(0);
    expect(engine.getTasks(taskList.id)[0]).toMatchObject({
      status: 'failed',
      error: 'Recovery is unsupported; provider submission was not retried',
      providerTaskId: 'provider-job-1',
    });
  });

  it('rejects decision, gate, and external completion writes after lease takeover', async () => {
    const db = new SqliteIndex(':memory:');
    indexes.push(db);
    const engine = new TaskExecutionEngine({
      db,
      registry: registry('unused'),
      handlers: [],
      now: () => 100,
    });

    const decisionList = movieTaskList('decision', {
      currentPhaseKey: 'visual-direction',
      currentTaskId: 'decision-task',
    });
    const decisionTask = externalTask('decision-task', decisionList.id, {
      phaseKey: 'visual-direction',
      phaseName: 'Visual direction',
      taskKey: 'choose-style',
    });
    db.repos.taskLists.insertTaskList(decisionList);
    db.repos.taskLists.insertTask(decisionTask);

    const gateList = movieTaskList('gate', {
      currentPhaseKey: 'production-plan',
      currentTaskId: 'gate-task',
    });
    const gateTask = externalTask('gate-task', gateList.id, {
      status: 'completed',
      progress: 100,
      completedAt: 2,
    });
    db.repos.taskLists.insertTaskList(gateList);
    db.repos.taskLists.insertTask(gateTask);
    db.repos.taskLists.createDocument({
      id: 'gate-document',
      taskListId: gateList.id,
      logicalKey: 'production-plan',
      documentType: 'production-plan',
      revision: 1,
      schemaVersion: 1,
      content: { title: 'Plan' },
      contentHash: 'gate-hash',
      status: 'active',
      createdAt: 2,
      updatedAt: 2,
    });
    db.repos.taskLists.createPendingApproval({
      id: 'gate-approval',
      taskListId: gateList.id,
      gateKey: 'production_plan',
      subjectLogicalKey: 'production-plan',
      subjectRevision: 1,
      subjectHash: 'gate-hash',
      manifestHash: 'manifest-hash',
      resumeTokenHash: 'resume-hash',
      status: 'pending',
      createdAt: 3,
      updatedAt: 3,
    });

    const externalList = movieTaskList('external', {
      currentPhaseKey: 'production-plan',
      currentTaskId: 'external-task',
    });
    const completionTask = externalTask('external-task', externalList.id);
    db.repos.taskLists.insertTaskList(externalList);
    db.repos.taskLists.insertTask(completionTask);

    for (const taskListId of [decisionList.id, gateList.id, externalList.id]) {
      acquireLeaseForTest(engine, taskListId);
      expect(
        db.repos.taskLists.tryAcquireLease(
          taskListId as TaskListId,
          'takeover-owner',
          30_100,
          30_000,
        ),
      ).toMatchObject({ ownerId: 'takeover-owner', token: 2 });
    }

    expect(() =>
      engine.reserveAskUserDecision({
        taskListId: decisionList.id,
        taskId: decisionTask.id,
        canvasId: decisionList.entityId!,
        questionId: 'question-1',
        decisionKey: 'style',
        subjectRevision: 1,
        question: 'Choose a style',
        options: [
          { id: 'quiet', label: 'Quiet' },
          { id: 'bold', label: 'Bold' },
        ],
        allowFreeText: false,
        expectedTaskListRowVersion: 0,
      }),
    ).toThrow('lease is stale');
    expect(db.repos.taskLists.getDecisionByQuestion(decisionList.entityId!, 'question-1')).toBeUndefined();

    expect(() =>
      engine.requestChangesPendingGateFromUser({
        taskListId: gateList.id,
        gateKey: 'production_plan',
        expectedRowVersion: 1,
        expectedSubjectRevision: 1,
        expectedSubjectHash: 'gate-hash',
        reason: 'Revise the plan',
      }),
    ).toThrow('lease is stale');
    expect(db.repos.taskLists.getPendingApproval(gateList.id as TaskListId, 'production_plan')).toMatchObject({
      status: 'pending',
    });

    await expect(
      engine.completeCreativeTask({
        taskListId: externalList.id,
        taskId: completionTask.id,
        canvasId: externalList.entityId!,
        expectedRowVersion: 0,
        summary: 'Script persisted',
      }),
    ).rejects.toThrow('lease is stale');
    expect(db.repos.taskLists.getTask(completionTask.id as TaskId)).toMatchObject({
      status: 'ready',
    });
  });
});
