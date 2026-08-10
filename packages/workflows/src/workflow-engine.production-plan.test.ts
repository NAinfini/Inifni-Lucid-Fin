import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkflowRunStatus } from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import { WorkflowEngine } from './workflow-engine.js';
import { WorkflowRegistry } from './workflow-registry.js';

function makePlan(): Record<string, unknown> {
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
          scenes: [
            {
              title: 'The Broadcast',
              summary: 'Mara hears a warning in her own voice.',
              storyBeat: 'inciting incident',
              dialogueIntent: 'Disbelief gives way to fear.',
            },
          ],
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

describe('WorkflowEngine persistent production-plan gate', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  function open(dbPath: string): SqliteIndex {
    const db = new SqliteIndex(dbPath);
    indexes.push(db);
    return db;
  }

  function createEngine(db: SqliteIndex): WorkflowEngine {
    let id = 0;
    return new WorkflowEngine({
      db,
      registry: new WorkflowRegistry(),
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

    const result = await engine.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A radio operator hears a transmission from tomorrow.',
      plan: makePlan(),
    });

    expect(result).toMatchObject({
      gate: 'production_plan',
      status: 'awaiting_approval',
      revision: 1,
    });
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const run = engine.get(result.workflowRunId);
    const stages = engine.getStages(result.workflowRunId);
    const tasks = engine.getTasks(result.workflowRunId);
    const stageByLogicalId = new Map(stages.map((stage) => [stage.stageId, stage]));

    expect(run).toMatchObject({
      status: WorkflowRunStatus.AwaitingApproval,
      currentGate: 'production_plan',
      rowVersion: 1,
      totalStages: 6,
    });
    expect(run?.currentStageId).toBe(stageByLogicalId.get('production-plan')?.id);
    expect(stages.map((stage) => stage.stageId)).toEqual([
      'production-plan',
      'style-exploration',
      'preproduction',
      'media-generation',
      'assembly',
      'final-export',
    ]);
    expect(tasks.map((task) => task.taskId)).toEqual(
      expect.arrayContaining([
        'production-plan',
        'style-audition',
        'script',
        'entities',
        'references',
        'shot-spec-001',
        'media-shot-001',
        'assembly',
        'final-export',
      ]),
    );
    const shotSpec = tasks.find((task) => task.taskId === 'shot-spec-001');
    const mediaShot = tasks.find((task) => task.taskId === 'media-shot-001');
    expect(shotSpec).toBeDefined();
    expect(mediaShot?.dependencyIds).toContain(shotSpec?.id);
    expect(db.repos.workflows.listTaskDependencies(mediaShot?.id as never)).toContain(shotSpec?.id);
    expect(db.repos.workflows.listEvents(result.workflowRunId as never)).toEqual([
      expect.objectContaining({
        seq: 1,
        payload: expect.objectContaining({ type: 'workflow.created' }),
      }),
      expect.objectContaining({
        seq: 2,
        payload: expect.objectContaining({ type: 'workflow.gate.requested' }),
      }),
    ]);
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
    });
    first.close();

    const reopened = open(dbPath);
    const engine = createEngine(reopened);
    const pending = engine.getPendingApprovalContext(created.workflowRunId);
    expect(pending).toMatchObject({
      run: {
        id: created.workflowRunId,
        status: WorkflowRunStatus.AwaitingApproval,
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

    reopened.repos.workflows.createDocument({
      ...pending.document,
      id: 'unapproved-doc-2',
      revision: 2,
      content: { title: 'Unapproved replacement' },
      contentHash: 'f'.repeat(64),
      createdAt: 2_000,
      updatedAt: 2_000,
    });
    expect(engine.getPendingApprovalContext(created.workflowRunId)?.document).toMatchObject({
      revision: 1,
      contentHash: created.contentHash,
    });

    const approved = engine.approvePendingGateFromUser({
      workflowRunId: created.workflowRunId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.run.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
    });
    const styleStage = engine
      .getStages(created.workflowRunId)
      .find((stage) => stage.stageId === 'style-exploration');
    expect(approved).toMatchObject({
      ok: true,
      code: 'approved',
      run: {
        status: WorkflowRunStatus.Ready,
        currentStageId: styleStage?.id,
        currentGate: undefined,
      },
      event: { actor: 'user' },
    });
    await engine.waitForAutoPump();
    expect(
      engine.getTasks(created.workflowRunId).find((task) => task.taskId === 'style-audition'),
    ).toMatchObject({ status: 'ready' });
    expect(engine.getPendingApprovalContext(created.workflowRunId)).toBeUndefined();

    const repeated = engine.approvePendingGateFromUser({
      workflowRunId: created.workflowRunId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.run.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
    });
    expect(repeated).toMatchObject({ ok: false, code: 'already_approved' });
    expect(reopened.repos.workflows.listEvents(created.workflowRunId as never)).toHaveLength(3);
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
      },
    });
    const pending = engine.getPendingApprovalContext(created.workflowRunId);
    if (!pending) throw new Error('Expected pending Production Plan gate');
    const approved = engine.approvePendingGateFromUser({
      workflowRunId: created.workflowRunId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.run.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
    });
    expect(approved.ok).toBe(true);
    await engine.waitForAutoPump();

    const readyRun = engine.get(created.workflowRunId);
    const task = engine
      .getTasks(created.workflowRunId)
      .find((candidate) => candidate.taskId === 'style-audition');
    if (!readyRun || !task) throw new Error('Expected ready style-audition task');
    const claimKey = `${task.id}:style_exploration:0`;
    const claimed = engine.claimCommanderContinuation({
      workflowRunId: created.workflowRunId,
      taskRunId: task.id,
      claimKey,
      claimOwnerId: 'process-1',
      expectedRowVersion: readyRun.rowVersion ?? -1,
    });

    expect(claimed).toMatchObject({
      ok: true,
      run: { rowVersion: (readyRun.rowVersion ?? 0) + 1 },
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
        workflowRunId: created.workflowRunId,
        taskRunId: task.id,
        claimKey,
        claimOwnerId: 'process-1',
        expectedRowVersion: claimed.run.rowVersion ?? -1,
      }),
    ).toMatchObject({ ok: false, code: 'already_claimed' });

    const reclaimed = engine.claimCommanderContinuation({
      workflowRunId: created.workflowRunId,
      taskRunId: task.id,
      claimKey,
      claimOwnerId: 'process-2',
      expectedRowVersion: claimed.run.rowVersion ?? -1,
    });
    expect(reclaimed).toMatchObject({
      ok: true,
      continuation: { claim: { ownerId: 'process-2', status: 'running' } },
    });
    if (!reclaimed.ok) throw new Error('Expected a restarted process to reclaim the task');

    expect(
      engine.finishCommanderContinuationClaim({
        workflowRunId: created.workflowRunId,
        claimKey,
        claimOwnerId: 'process-2',
        expectedRowVersion: reclaimed.run.rowVersion ?? -1,
        outcome: 'failed',
        reason: 'Commander ended before task completion',
      }),
    ).toBe(true);
    const retryRun = engine.get(created.workflowRunId);
    if (!retryRun) throw new Error('Expected workflow after failed continuation');
    expect(
      engine.claimCommanderContinuation({
        workflowRunId: created.workflowRunId,
        taskRunId: task.id,
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
    });

    await expect(engine.resume(created.workflowRunId)).rejects.toThrow('human approval');
    await expect(engine.retryWorkflow(created.workflowRunId)).rejects.toThrow('human approval');
    expect(engine.get(created.workflowRunId)).toMatchObject({
      status: WorkflowRunStatus.AwaitingApproval,
      currentGate: 'production_plan',
    });
  });

  it('allows only one non-terminal persistent production workflow per canvas', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-production-singleton-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const engine = createEngine(db);

    engine.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'First production.',
      plan: makePlan(),
    });

    expect(() =>
      engine.createProductionPlan({
        canvasId: 'canvas-1',
        idea: 'A conflicting production.',
        plan: makePlan(),
      }),
    ).toThrow('already active for canvas "canvas-1"');

    expect(() =>
      engine.createProductionPlan({
        canvasId: 'canvas-2',
        idea: 'An independent production.',
        plan: makePlan(),
      }),
    ).not.toThrow();
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
    });

    const first = engine.createContextCheckpoint(created.workflowRunId, {
      currentGate: 'production_plan',
      productionPlan: { revision: 1, contentHash: created.contentHash },
    });
    const second = engine.createContextCheckpoint(created.workflowRunId, {
      currentGate: 'production_plan',
      productionPlan: { revision: 1, contentHash: created.contentHash },
      compactionReason: 'context-pressure',
    });

    expect(first).toMatchObject({ workflowRunId: created.workflowRunId, revision: 1 });
    expect(second).toMatchObject({ workflowRunId: created.workflowRunId, revision: 2 });
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const firstStored = db.repos.workflows.getDocumentRevision(
      created.workflowRunId as never,
      'context-checkpoint',
      1,
    );
    const latestStored = db.repos.workflows.getLatestDocument(
      created.workflowRunId as never,
      'context-checkpoint',
    );
    expect(firstStored).toMatchObject({ revision: 1, contentHash: first.contentHash });
    expect(latestStored).toMatchObject({ revision: 2, contentHash: second.contentHash });
  });
});
