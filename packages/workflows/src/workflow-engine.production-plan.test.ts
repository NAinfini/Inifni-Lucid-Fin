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

  it('atomically creates an immutable plan gate without starting tasks or media work', async () => {
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
    expect(engine.get(result.workflowRunId)).toMatchObject({
      status: WorkflowRunStatus.AwaitingApproval,
      currentGate: 'production_plan',
      rowVersion: 1,
      currentStageId: undefined,
    });
    expect(engine.getStages(result.workflowRunId)).toEqual([]);
    expect(engine.getTasks(result.workflowRunId)).toEqual([]);
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
    expect(approved).toMatchObject({
      ok: true,
      code: 'approved',
      run: {
        status: WorkflowRunStatus.Ready,
        currentStageId: 'style-exploration',
        currentGate: undefined,
      },
      event: { actor: 'user' },
    });
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
