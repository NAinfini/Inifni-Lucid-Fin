import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskListStatus } from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import { TaskExecutionEngine } from './task-execution-engine.js';
import { TaskListRegistry } from './task-list-registry.js';

function makePlan(sceneCount = 1): Record<string, unknown> {
  return {
    title: 'The Last Signal',
    logline: "A radio operator hears tomorrow's final transmission.",
    synopsis: 'A remote operator races to change a disaster encoded in a future broadcast.',
    genre: 'science-fiction thriller',
    tone: 'tense and intimate',
    targetAudience: 'adult genre audience',
    format: { targetDurationSeconds: 90, aspectRatio: '16:9' },
    story: {
      acts: [
        {
          name: 'Act 1',
          purpose: 'Establish the signal and its stakes.',
          scenes: Array.from({ length: sceneCount }, (_, index) => ({
            title: index === 0 ? 'The Broadcast' : `The Broadcast ${index + 1}`,
            summary: 'Mara hears a warning in her own voice.',
            storyBeat: 'inciting incident',
            dialogueIntent: 'Disbelief gives way to fear.',
          })),
        },
      ],
    },
    assumptions: ['Single primary location'],
    budget: {
      maxTotalCostUsd: 25,
      styleAuditionCostUsd: 3,
      maxAttemptsPerShot: 3,
      maxRegenerations: 8,
    },
    visualDirections: ['analog cosmic horror', 'restrained near-future realism'],
  };
}

function commanderContinuation(sessionId = 'session-1') {
  return {
    version: 1 as const,
    sessionId,
    provider: {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6-sol',
      protocol: 'openai-responses',
      authStyle: 'bearer',
    },
    permissionMode: 'normal' as const,
    locale: 'en-US',
    resourceBudget: { maxTokens: 10_000, maxCostUsd: 0 },
    lastRunId: 'run-root',
  };
}

describe('TaskExecutionEngine persistent production-plan gate', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  function open(dbPath: string): SqliteIndex {
    const db = new SqliteIndex(dbPath);
    indexes.push(db);
    return db;
  }

  function createEngine(db: SqliteIndex): TaskExecutionEngine {
    let id = 0;
    return new TaskExecutionEngine({
      db,
      registry: new TaskListRegistry(),
      handlers: [],
      idFactory: () => `persistent-id-${++id}`,
      now: () => 1_000,
    });
  }

  afterEach(() => {
    for (const db of indexes.splice(0)) {
      try {
        db.close();
      } catch {
        // A test may close the database to simulate an application restart.
      }
    }
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('atomically creates an immutable plan gate and its durable production graph', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-production-plan-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const engine = createEngine(db);
    db.rawDb.exec(`
      CREATE TABLE dependency_insert_audit (task_id TEXT NOT NULL, depends_on_task_id TEXT NOT NULL);
      CREATE TRIGGER audit_task_dependency_insert AFTER INSERT ON task_dependencies BEGIN
        INSERT INTO dependency_insert_audit VALUES (new.task_id, new.depends_on_task_id);
      END;
    `);

    const result = await engine.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A radio operator hears a transmission from tomorrow.',
      plan: makePlan(),
      commanderContinuation: commanderContinuation(),
    });

    expect(result).toMatchObject({
      gate: 'production_plan',
      status: 'awaiting_approval',
      revision: 1,
    });
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const taskList = engine.get(result.taskListId);
    const tasks = engine.getTasks(result.taskListId);

    expect(taskList).toMatchObject({
      status: TaskListStatus.AwaitingApproval,
      currentGate: 'production_plan',
      rowVersion: 1,
      totalPhases: 6,
    });
    expect(taskList?.currentPhaseKey).toBe('production-plan');
    expect([...new Set(tasks.map((task) => task.phaseKey))]).toEqual([
      'production-plan',
      'style-exploration',
      'preproduction',
      'media-generation',
      'assembly',
      'delivery',
    ]);
    expect(tasks.map((task) => task.taskKey)).toEqual(
      expect.arrayContaining([
        'production-plan',
        'style-audition',
        'script',
        'entities',
        'references',
        'shot-spec-001',
        'media-shot-001',
        'assembly',
        'delivery',
      ]),
    );
    const shotSpec = tasks.find((task) => task.taskKey === 'shot-spec-001');
    const mediaShot = tasks.find((task) => task.taskKey === 'media-shot-001');
    expect(shotSpec).toBeDefined();
    expect(mediaShot?.dependencyIds).toContain(shotSpec?.id);
    expect(db.repos.taskLists.listTaskDependencies(mediaShot?.id as never)).toContain(shotSpec?.id);
    expect(db.rawDb.prepare('SELECT COUNT(*) AS count FROM dependency_insert_audit').get()).toEqual(
      db.rawDb.prepare('SELECT COUNT(*) AS count FROM task_dependencies').get(),
    );
    expect(db.repos.taskLists.listEvents(result.taskListId as never)).toEqual([
      expect.objectContaining({
        seq: 1,
        payload: expect.objectContaining({ type: 'task_list.created' }),
      }),
      expect.objectContaining({
        seq: 2,
        payload: expect.objectContaining({ type: 'task_list.gate.requested' }),
      }),
    ]);
  });

  it('persists every scene in a production graph larger than 24 shots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-production-large-graph-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const engine = createEngine(db);

    const result = engine.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A long-form story with more than twenty-four scenes.',
      plan: makePlan(25),
      commanderContinuation: commanderContinuation(),
    });

    const taskList = engine.get(result.taskListId);
    expect(taskList).toMatchObject({
      totalTasks: 57,
      metadata: { productionGraph: { shotCount: 25, sourceSceneCount: 25 } },
    });
    expect(taskList?.metadata.productionGraph).not.toHaveProperty('maxShots');
    expect(taskList?.metadata.productionGraph).not.toHaveProperty('truncated');
    expect(engine.getTasks(result.taskListId).map((task) => task.taskKey)).toEqual(
      expect.arrayContaining(['shot-spec-025', 'media-shot-025']),
    );
  });

  it('restores the exact pending revision after restart and advances once from a user approval', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-production-restart-'));
    roots.push(root);
    const dbPath = path.join(root, 'project.db');
    const first = open(dbPath);
    const created = await createEngine(first).createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A radio operator hears a transmission from tomorrow.',
      plan: makePlan(),
      commanderContinuation: commanderContinuation(),
    });
    first.close();

    const reopened = open(dbPath);
    const engine = createEngine(reopened);
    const pending = engine.getPendingApprovalContext(created.taskListId);
    expect(pending).toMatchObject({
      taskList: {
        id: created.taskListId,
        status: TaskListStatus.AwaitingApproval,
        currentGate: 'production_plan',
        rowVersion: 1,
      },
      approval: {
        gateKey: 'production_plan',
        subjectRevision: 1,
        subjectHash: created.contentHash,
        status: 'pending',
      },
      document: { revision: 1, contentHash: created.contentHash },
    });
    if (!pending) throw new Error('Expected a pending production-plan approval');

    reopened.repos.taskLists.createDocument({
      ...pending.document,
      id: 'unapproved-doc-2',
      revision: 2,
      content: { title: 'Unapproved replacement' },
      contentHash: 'f'.repeat(64),
      createdAt: 2_000,
      updatedAt: 2_000,
    });
    expect(engine.getPendingApprovalContext(created.taskListId)?.document).toMatchObject({
      revision: 1,
      contentHash: created.contentHash,
    });

    const approved = engine.approvePendingGateFromUser({
      taskListId: created.taskListId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.taskList.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
    });
    expect(approved).toMatchObject({
      ok: true,
      code: 'approved',
      taskList: {
        status: TaskListStatus.Ready,
        currentPhaseKey: 'style-exploration',
        currentGate: undefined,
      },
      event: { actor: 'user' },
    });
    await engine.waitForAutoPump();
    expect(
      engine.getTasks(created.taskListId).find((task) => task.taskKey === 'style-audition'),
    ).toMatchObject({ status: 'ready' });
    expect(engine.getPendingApprovalContext(created.taskListId)).toBeUndefined();

    const repeated = engine.approvePendingGateFromUser({
      taskListId: created.taskListId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.taskList.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
    });
    expect(repeated).toMatchObject({ ok: false, code: 'already_approved' });
    expect(reopened.repos.taskLists.listEvents(created.taskListId as never)).toHaveLength(3);
  });

  it('persists and atomically claims one keyless Commander continuation per durable task phase', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-production-continuation-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const engine = createEngine(db);
    const created = engine.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A radio operator hears a transmission from tomorrow.',
      plan: makePlan(),
      commanderContinuation: {
        version: 1,
        sessionId: 'session-1',
        provider: {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.6-sol',
          protocol: 'openai-responses',
          authStyle: 'bearer',
        },
        permissionMode: 'normal',
        locale: 'en-US',
        resourceBudget: { maxTokens: 10_000, maxCostUsd: 0 },
        lastRunId: 'run-root',
      },
    });
    const pending = engine.getPendingApprovalContext(created.taskListId);
    if (!pending) throw new Error('Expected pending Production Plan gate');
    const approved = engine.approvePendingGateFromUser({
      taskListId: created.taskListId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.taskList.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
    });
    expect(approved.ok).toBe(true);
    await engine.waitForAutoPump();

    const readyRun = engine.get(created.taskListId);
    const task = engine
      .getTasks(created.taskListId)
      .find((candidate) => candidate.taskKey === 'style-audition');
    if (!readyRun || !task) throw new Error('Expected ready style-audition task');
    const claimKey = `${task.id}:style_exploration:0`;
    const claimed = engine.claimCommanderContinuation({
      taskListId: created.taskListId,
      taskId: task.id,
      claimKey,
      claimOwnerId: 'process-1',
      expectedRowVersion: readyRun.rowVersion ?? -1,
    });

    expect(claimed).toMatchObject({
      ok: true,
      taskList: { rowVersion: (readyRun.rowVersion ?? 0) + 1 },
      continuation: {
        version: 1,
        sessionId: 'session-1',
        provider: { id: 'openai' },
        claim: {
          key: claimKey,
          ownerId: 'process-1',
          status: 'running',
        },
      },
    });
    if (!claimed.ok) throw new Error('Expected continuation claim');
    expect(
      engine.claimCommanderContinuation({
        taskListId: created.taskListId,
        taskId: task.id,
        claimKey,
        claimOwnerId: 'process-1',
        expectedRowVersion: claimed.taskList.rowVersion ?? -1,
      }),
    ).toMatchObject({ ok: false, code: 'already_claimed' });

    const reclaimed = engine.claimCommanderContinuation({
      taskListId: created.taskListId,
      taskId: task.id,
      claimKey,
      claimOwnerId: 'process-2',
      expectedRowVersion: claimed.taskList.rowVersion ?? -1,
    });
    expect(reclaimed).toMatchObject({
      ok: true,
      continuation: { claim: { ownerId: 'process-2', status: 'running' } },
    });
    if (!reclaimed.ok) throw new Error('Expected a restarted process to reclaim the task');

    expect(
      engine.finishCommanderContinuationClaim({
        taskListId: created.taskListId,
        claimKey,
        claimOwnerId: 'process-2',
        expectedRowVersion: reclaimed.taskList.rowVersion ?? -1,
        outcome: 'failed',
        runId: 'run-continuation-1',
        reason: 'Commander ended before task completion',
      }),
    ).toBe(true);
    const retryRun = engine.get(created.taskListId);
    if (!retryRun) throw new Error('Expected task list after failed continuation');
    expect(retryRun.metadata.commanderContinuation).toMatchObject({
      resourceBudget: { maxTokens: 10_000, maxCostUsd: 0 },
      lastRunId: 'run-continuation-1',
    });
    expect(
      engine.claimCommanderContinuation({
        taskListId: created.taskListId,
        taskId: task.id,
        claimKey,
        claimOwnerId: 'process-2',
        expectedRowVersion: retryRun.rowVersion ?? -1,
      }),
    ).toMatchObject({ ok: true, continuation: { claim: { status: 'running' } } });
  });

  it('refuses generic resume and retry while a human approval gate is pending', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-production-guard-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const engine = createEngine(db);
    const created = await engine.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A tiny ghost story.',
      plan: makePlan(),
      commanderContinuation: commanderContinuation(),
    });

    await expect(engine.resume(created.taskListId)).rejects.toThrow('human approval');
    await expect(engine.retryTaskList(created.taskListId)).rejects.toThrow('human approval');
    expect(engine.get(created.taskListId)).toMatchObject({
      status: TaskListStatus.AwaitingApproval,
      currentGate: 'production_plan',
    });
  });

  it('allows independent Commander sessions while limiting each session to one non-terminal production task list', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-production-singleton-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const engine = createEngine(db);

    const first = engine.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'First production.',
      plan: makePlan(),
      commanderContinuation: commanderContinuation(),
    });
    expect(engine.get(first.taskListId)?.metadata).toMatchObject({ commanderSessionId: 'session-1' });

    expect(() =>
      engine.createProductionPlan({
        canvasId: 'canvas-1',
        idea: 'A conflicting production.',
        plan: makePlan(),
        commanderContinuation: commanderContinuation(),
      }),
    ).toThrow('already active for Commander session "session-1"');

    expect(() =>
      engine.createProductionPlan({
        canvasId: 'canvas-1',
        idea: 'An independent production.',
        plan: makePlan(),
        commanderContinuation: commanderContinuation('session-2'),
      }),
    ).not.toThrow();

    expect(() =>
      engine.createProductionPlan({
        canvasId: 'canvas-2',
        idea: 'A second production in the same Commander session.',
        plan: makePlan(),
        commanderContinuation: commanderContinuation(),
      }),
    ).toThrow('already active for Commander session "session-1"');
  });

  it('writes immutable verified context checkpoints with increasing revisions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-context-checkpoint-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const engine = createEngine(db);
    const created = engine.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A production that will outlive its chat context.',
      plan: makePlan(),
      commanderContinuation: commanderContinuation(),
    });

    const first = engine.createContextCheckpoint(created.taskListId, {
      currentGate: 'production_plan',
      productionPlan: { revision: 1, contentHash: created.contentHash },
    });
    const second = engine.createContextCheckpoint(created.taskListId, {
      currentGate: 'production_plan',
      productionPlan: { revision: 1, contentHash: created.contentHash },
      compactionReason: 'context-pressure',
    });

    expect(first).toMatchObject({ taskListId: created.taskListId, revision: 1 });
    expect(second).toMatchObject({ taskListId: created.taskListId, revision: 2 });
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const firstStored = db.repos.taskLists.getDocumentRevision(
      created.taskListId as never,
      'context-checkpoint',
      1,
    );
    const latestStored = db.repos.taskLists.getLatestDocument(
      created.taskListId as never,
      'context-checkpoint',
    );
    expect(firstStored).toMatchObject({ revision: 1, contentHash: first.contentHash });
    expect(latestStored).toMatchObject({ revision: 2, contentHash: second.contentHash });
  });
});
