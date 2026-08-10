import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteIndex } from '@lucid-fin/storage';
import { WorkflowEngine } from './workflow-engine.js';
import { WorkflowRegistry } from './workflow-registry.js';

function plan(sceneCount = 1): Record<string, unknown> {
  return {
    title: 'Revision Story',
    story: {
      acts: [
        {
          name: 'Act 1',
          scenes: Array.from({ length: sceneCount }, (_, index) => ({
            title: `Scene ${index + 1}`,
            summary: `Scene ${index + 1} summary.`,
          })),
        },
      ],
    },
    budget: {
      maxTotalCostUsd: 10,
      styleAuditionCostUsd: 1,
      maxAttemptsPerShot: 2,
      maxRegenerations: 2,
    },
  };
}

describe('WorkflowEngine approval-gate revision requests', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  afterEach(() => {
    for (const index of indexes.splice(0)) index.close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function setup(initialPlan: Record<string, unknown> = plan()): {
    db: SqliteIndex;
    engine: WorkflowEngine;
    workflowRunId: string;
  } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-gate-revision-'));
    roots.push(root);
    const db = new SqliteIndex(path.join(root, 'project.db'));
    indexes.push(db);
    let id = 0;
    const engine = new WorkflowEngine({
      db,
      registry: new WorkflowRegistry(),
      handlers: [],
      idFactory: () => `revision-id-${++id}`,
      now: () => 1_000,
    });
    const created = engine.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A story that needs review.',
      plan: initialPlan,
    });
    return { db, engine, workflowRunId: created.workflowRunId };
  }

  it('rejects the pending subject, produces a genuine higher revision, and reopens the same gate', async () => {
    const { db, engine, workflowRunId } = setup();
    const pending = engine.getPendingApprovalContext(workflowRunId);
    if (!pending) throw new Error('Expected pending production-plan approval');

    const revised = engine.requestChangesPendingGateFromUser({
      workflowRunId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.run.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
      reason: 'Give the protagonist a clearer goal.',
    });

    expect(revised).toMatchObject({
      ok: true,
      code: 'revision_requested',
      run: {
        status: 'ready',
        currentGate: undefined,
        rowVersion: (pending.run.rowVersion ?? 0) + 1,
      },
      previousApproval: { status: 'rejected', subjectRevision: 1 },
      producerTask: {
        taskId: 'production-plan',
        status: 'ready',
        currentStep: 'revision_requested',
        input: {
          revisionRequest: {
            action: 'request_changes',
            reason: 'Give the protagonist a clearer goal.',
            previousRevision: 1,
          },
        },
      },
    });
    expect(
      db.rawDb
        .prepare('SELECT status FROM workflow_approvals WHERE id = ?')
        .get(pending.approval.id),
    ).toEqual({ status: 'rejected' });
    expect(engine.getPendingApprovalContext(workflowRunId)).toBeUndefined();
    expect(
      db.repos.workflows.getLatestDocument(workflowRunId as never, 'production-plan')?.revision,
    ).toBe(1);
    expect(
      db.rawDb
        .prepare(
          `SELECT COUNT(*) AS count FROM workflow_documents
           WHERE workflow_run_id = ? AND logical_key = 'production-plan'`,
        )
        .get(workflowRunId),
    ).toEqual({ count: 1 });
    expect(db.repos.workflows.listEvents(workflowRunId as never).at(-1)?.payload).toMatchObject({
      type: 'workflow.gate.changes_requested',
      reason: 'Give the protagonist a clearer goal.',
      gateKey: 'production_plan',
    });

    if (!revised.ok) throw new Error('Expected a revision request');
    const replacement = engine.reviseProductionPlan({
      canvasId: 'canvas-1',
      workflowRunId,
      expectedRowVersion: revised.run.rowVersion ?? -1,
      plan: { ...plan(), title: 'Revision Story: A Clear Goal' },
    });
    expect(replacement).toMatchObject({
      workflowRunId,
      gate: 'production_plan',
      status: 'awaiting_approval',
      revision: 2,
    });
    const replacementPending = engine.getPendingApprovalContext(workflowRunId);
    expect(replacementPending).toMatchObject({
      run: { currentGate: 'production_plan', status: 'awaiting_approval' },
      approval: { gateKey: 'production_plan', subjectRevision: 2, status: 'pending' },
      document: { revision: 2, content: { title: 'Revision Story: A Clear Goal' } },
    });
    expect(
      db.rawDb
        .prepare(
          `SELECT COUNT(*) AS count FROM workflow_documents
           WHERE workflow_run_id = ? AND logical_key = 'production-plan'`,
        )
        .get(workflowRunId),
    ).toEqual({ count: 2 });
    if (!replacementPending) throw new Error('Expected replacement approval');
    expect(
      engine.approvePendingGateFromUser({
        workflowRunId,
        gateKey: 'production_plan',
        expectedRowVersion: replacementPending.run.rowVersion ?? -1,
        expectedSubjectRevision: replacementPending.approval.subjectRevision,
        expectedSubjectHash: replacementPending.approval.subjectHash,
      }),
    ).toMatchObject({ ok: true, code: 'approved' });
    await engine.waitForAutoPump();
    expect(
      engine.getTasks(workflowRunId).find((task) => task.taskId === 'production-plan'),
    ).toMatchObject({
      status: 'completed',
      currentStep: 'approved',
    });
    expect(engine.get(workflowRunId)).toMatchObject({ currentGate: undefined, status: 'ready' });
  });

  it('requires a non-empty reason and applies the same CAS idempotency rules to rejection', () => {
    const { engine, workflowRunId } = setup();
    const pending = engine.getPendingApprovalContext(workflowRunId)!;

    expect(() =>
      engine.rejectPendingGateFromUser({
        workflowRunId,
        gateKey: 'production_plan',
        expectedRowVersion: pending.run.rowVersion ?? -1,
        expectedSubjectRevision: pending.approval.subjectRevision,
        expectedSubjectHash: pending.approval.subjectHash,
        reason: '   ',
      }),
    ).toThrow(/reason/i);

    const rejected = engine.rejectPendingGateFromUser({
      workflowRunId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.run.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
      reason: 'The premise is not ready.',
    });
    expect(rejected).toMatchObject({
      ok: true,
      code: 'revision_requested',
      producerTask: { input: { revisionRequest: { action: 'reject' } } },
    });

    expect(
      engine.rejectPendingGateFromUser({
        workflowRunId,
        gateKey: 'production_plan',
        expectedRowVersion: pending.run.rowVersion ?? -1,
        expectedSubjectRevision: pending.approval.subjectRevision,
        expectedSubjectHash: pending.approval.subjectHash,
        reason: 'Duplicate stale rejection.',
      }),
    ).toMatchObject({ ok: false, code: 'approval_not_pending', status: 'rejected' });
  });

  it('atomically rebinds the unstarted shot graph to the revised plan topology', () => {
    const { db, engine, workflowRunId } = setup(plan(2));
    const pending = engine.getPendingApprovalContext(workflowRunId)!;
    const requested = engine.requestChangesPendingGateFromUser({
      workflowRunId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.run.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
      reason: 'Reduce the story to one stronger scene.',
    });
    if (!requested.ok) throw new Error('Expected Production Plan revision request');

    engine.reviseProductionPlan({
      canvasId: 'canvas-1',
      workflowRunId,
      expectedRowVersion: requested.run.rowVersion ?? -1,
      plan: { ...plan(1), title: 'Revision Story: One Scene' },
    });

    const activeTaskIds = engine.getTasks(workflowRunId).map((task) => task.taskId);
    expect(activeTaskIds).toContain('shot-spec-001');
    expect(activeTaskIds).toContain('media-shot-001');
    expect(activeTaskIds).not.toContain('shot-spec-002');
    expect(activeTaskIds).not.toContain('media-shot-002');
    expect(engine.get(workflowRunId)).toMatchObject({
      status: 'awaiting_approval',
      currentGate: 'production_plan',
      totalTasks: 9,
      metadata: { productionGraph: { shotCount: 1, sourceSceneCount: 1 } },
    });
    expect(
      db.rawDb
        .prepare(
          `SELECT COUNT(*) AS count FROM workflow_task_runs
           WHERE workflow_run_id = ?
             AND json_extract(input_json, '$.invalidatedByPlanRevision') = 2`,
        )
        .get(workflowRunId),
    ).toEqual({ count: 2 });
  });
});
