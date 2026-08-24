import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteIndex } from '@lucid-fin/storage';
import { TaskExecutionEngine } from './task-execution-engine.js';
import { TaskListRegistry } from './task-list-registry.js';

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

function commanderContinuation() {
  return {
    version: 1 as const,
    sessionId: 'session-1',
    provider: {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6-sol',
      protocol: 'openai-responses',
      authStyle: 'bearer',
    },
    permissionMode: 'normal' as const,
  };
}

describe('TaskExecutionEngine approval-gate revision requests', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  afterEach(() => {
    for (const index of indexes.splice(0)) index.close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function setup(initialPlan: Record<string, unknown> = plan()): {
    db: SqliteIndex;
    engine: TaskExecutionEngine;
    taskListId: string;
  } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-gate-revision-'));
    roots.push(root);
    const db = new SqliteIndex(path.join(root, 'project.db'));
    indexes.push(db);
    let id = 0;
    const engine = new TaskExecutionEngine({
      db,
      registry: new TaskListRegistry(),
      handlers: [],
      idFactory: () => `revision-id-${++id}`,
      now: () => 1_000,
    });
    const created = engine.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A story that needs review.',
      plan: initialPlan,
      commanderContinuation: commanderContinuation(),
    });
    return { db, engine, taskListId: created.taskListId };
  }

  it('rejects the pending subject, produces a genuine higher revision, and reopens the same gate', async () => {
    const { db, engine, taskListId } = setup();
    const pending = engine.getPendingApprovalContext(taskListId);
    if (!pending) throw new Error('Expected pending production-plan approval');

    const revised = engine.requestChangesPendingGateFromUser({
      taskListId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.taskList.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
      reason: 'Give the protagonist a clearer goal.',
    });

    expect(revised).toMatchObject({
      ok: true,
      code: 'revision_requested',
      taskList: {
        status: 'ready',
        currentGate: undefined,
        rowVersion: (pending.taskList.rowVersion ?? 0) + 1,
      },
      previousApproval: { status: 'rejected', subjectRevision: 1 },
      producerTask: {
        taskKey: 'production-plan',
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
      db.rawDb.prepare('SELECT status FROM plan_approvals WHERE id = ?').get(pending.approval.id),
    ).toEqual({ status: 'rejected' });
    expect(engine.getPendingApprovalContext(taskListId)).toBeUndefined();
    expect(
      db.repos.taskLists.getLatestDocument(taskListId as never, 'production-plan')?.revision,
    ).toBe(1);
    expect(
      db.rawDb
        .prepare(
          `SELECT COUNT(*) AS count FROM plan_documents
           WHERE task_list_id = ? AND logical_key = 'production-plan'`,
        )
        .get(taskListId),
    ).toEqual({ count: 1 });
    expect(db.repos.taskLists.listEvents(taskListId as never).at(-1)?.payload).toMatchObject({
      type: 'task_list.gate.changes_requested',
      reason: 'Give the protagonist a clearer goal.',
      gateKey: 'production_plan',
    });

    if (!revised.ok) throw new Error('Expected a revision request');
    const replacement = engine.reviseProductionPlan({
      canvasId: 'canvas-1',
      taskListId,
      expectedRowVersion: revised.taskList.rowVersion ?? -1,
      plan: { ...plan(), title: 'Revision Story: A Clear Goal' },
    });
    expect(replacement).toMatchObject({
      taskListId,
      gate: 'production_plan',
      status: 'awaiting_approval',
      revision: 2,
    });
    const replacementPending = engine.getPendingApprovalContext(taskListId);
    expect(replacementPending).toMatchObject({
      taskList: { currentGate: 'production_plan', status: 'awaiting_approval' },
      approval: { gateKey: 'production_plan', subjectRevision: 2, status: 'pending' },
      document: { revision: 2, content: { title: 'Revision Story: A Clear Goal' } },
    });
    expect(
      db.rawDb
        .prepare(
          `SELECT COUNT(*) AS count FROM plan_documents
           WHERE task_list_id = ? AND logical_key = 'production-plan'`,
        )
        .get(taskListId),
    ).toEqual({ count: 2 });
    if (!replacementPending) throw new Error('Expected replacement approval');
    expect(
      engine.approvePendingGateFromUser({
        taskListId,
        gateKey: 'production_plan',
        expectedRowVersion: replacementPending.taskList.rowVersion ?? -1,
        expectedSubjectRevision: replacementPending.approval.subjectRevision,
        expectedSubjectHash: replacementPending.approval.subjectHash,
      }),
    ).toMatchObject({ ok: true, code: 'approved' });
    await engine.waitForAutoPump();
    expect(
      engine.getTasks(taskListId).find((task) => task.taskKey === 'production-plan'),
    ).toMatchObject({
      status: 'completed',
      currentStep: 'approved',
    });
    expect(engine.get(taskListId)).toMatchObject({ currentGate: undefined, status: 'ready' });
  });

  it('requires a non-empty reason and applies the same CAS idempotency rules to rejection', () => {
    const { engine, taskListId } = setup();
    const pending = engine.getPendingApprovalContext(taskListId)!;

    expect(() =>
      engine.rejectPendingGateFromUser({
        taskListId,
        gateKey: 'production_plan',
        expectedRowVersion: pending.taskList.rowVersion ?? -1,
        expectedSubjectRevision: pending.approval.subjectRevision,
        expectedSubjectHash: pending.approval.subjectHash,
        reason: '   ',
      }),
    ).toThrow(/reason/i);

    const rejected = engine.rejectPendingGateFromUser({
      taskListId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.taskList.rowVersion ?? -1,
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
        taskListId,
        gateKey: 'production_plan',
        expectedRowVersion: pending.taskList.rowVersion ?? -1,
        expectedSubjectRevision: pending.approval.subjectRevision,
        expectedSubjectHash: pending.approval.subjectHash,
        reason: 'Duplicate stale rejection.',
      }),
    ).toMatchObject({ ok: false, code: 'approval_not_pending', status: 'rejected' });
  });

  it('atomically rebinds the unstarted shot graph to the revised plan topology', () => {
    const { db, engine, taskListId } = setup(plan(2));
    const pending = engine.getPendingApprovalContext(taskListId)!;
    const requested = engine.requestChangesPendingGateFromUser({
      taskListId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.taskList.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
      reason: 'Reduce the story to one stronger scene.',
    });
    if (!requested.ok) throw new Error('Expected Production Plan revision request');

    engine.reviseProductionPlan({
      canvasId: 'canvas-1',
      taskListId,
      expectedRowVersion: requested.taskList.rowVersion ?? -1,
      plan: { ...plan(1), title: 'Revision Story: One Scene' },
    });

    const activeTaskIds = engine.getTasks(taskListId).map((task) => task.taskKey);
    expect(activeTaskIds).toContain('shot-spec-001');
    expect(activeTaskIds).toContain('media-shot-001');
    expect(activeTaskIds).not.toContain('shot-spec-002');
    expect(activeTaskIds).not.toContain('media-shot-002');
    expect(engine.get(taskListId)).toMatchObject({
      status: 'awaiting_approval',
      currentGate: 'production_plan',
      totalTasks: 9,
      metadata: { productionGraph: { shotCount: 1, sourceSceneCount: 1 } },
    });
    expect(
      db.rawDb
        .prepare(
          `SELECT COUNT(*) AS count FROM tasks
           WHERE task_list_id = ?
             AND json_extract(input_json, '$.invalidatedByPlanRevision') = 2`,
        )
        .get(taskListId),
    ).toEqual({ count: 2 });
  });

  it('allows a plan revision after the producer records an AskUser decision', () => {
    const { db, engine, taskListId } = setup();
    const pending = engine.getPendingApprovalContext(taskListId)!;
    const producer = engine
      .getTasks(taskListId)
      .find((task) => task.taskKey === 'production-plan');
    if (!producer) throw new Error('Expected Production Plan producer task');

    const reserved = engine.reserveAskUserDecision({
      taskListId,
      taskId: producer.id,
      canvasId: 'canvas-1',
      questionId: 'question-plan-tone',
      decisionKey: 'plan-tone',
      subjectRevision: pending.approval.subjectRevision,
      expectedTaskListRowVersion: pending.taskList.rowVersion ?? -1,
      question: 'Which tone should the plan use?',
      options: [
        { id: 'hopeful', label: 'Hopeful' },
        { id: 'somber', label: 'Somber' },
      ],
      allowFreeText: true,
    });
    const requested = engine.requestChangesPendingGateFromUser({
      taskListId,
      gateKey: 'production_plan',
      expectedRowVersion: reserved.taskList.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
      reason: 'Make the ending hopeful.',
    });
    if (!requested.ok) throw new Error('Expected Production Plan revision request');
    expect(
      db.rawDb
        .prepare(
          `SELECT 'attempt' AS kind, task_id FROM task_attempts WHERE task_list_id = ?
           UNION ALL
           SELECT 'decision' AS kind, task_id FROM task_decisions WHERE task_list_id = ?
           UNION ALL
           SELECT 'artifact' AS kind, task_id FROM task_artifacts WHERE task_list_id = ?`,
        )
        .all(taskListId, taskListId, taskListId),
    ).toEqual([{ kind: 'decision', task_id: producer.id }]);

    expect(() =>
      engine.reviseProductionPlan({
        canvasId: 'canvas-1',
        taskListId,
        expectedRowVersion: requested.taskList.rowVersion ?? -1,
        plan: { ...plan(), title: 'Revision Story: Hopeful' },
      }),
    ).not.toThrow();
    expect(engine.getPendingApprovalContext(taskListId)).toMatchObject({
      approval: { gateKey: 'production_plan', subjectRevision: 2, status: 'pending' },
    });
  });

  it('still rejects graph replacement after work starts on a downstream task', () => {
    const { db, engine, taskListId } = setup();
    const pending = engine.getPendingApprovalContext(taskListId)!;
    const downstreamTask = engine
      .getTasks(taskListId)
      .find((task) => task.phaseKey !== 'production-plan');
    if (!downstreamTask) throw new Error('Expected a downstream production task');
    const requested = engine.requestChangesPendingGateFromUser({
      taskListId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.taskList.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
      reason: 'Revise after downstream work began.',
    });
    if (!requested.ok) throw new Error('Expected Production Plan revision request');
    db.rawDb
      .prepare(
        `INSERT INTO task_attempts (
           id, task_list_id, task_id, kind, idempotency_key, status, created_at, updated_at
         ) VALUES (?, ?, ?, 'task', ?, 'running', 1, 1)`,
      )
      .run('downstream-attempt', taskListId, downstreamTask.id, 'downstream-key');

    expect(() =>
      engine.reviseProductionPlan({
        canvasId: 'canvas-1',
        taskListId,
        expectedRowVersion: requested.taskList.rowVersion ?? -1,
        plan: { ...plan(), title: 'Revision Story: Too Late' },
      }),
    ).toThrow(/downstream side effects/i);
  });

  it('still rejects graph replacement after a task-less downstream attempt', () => {
    const { db, engine, taskListId } = setup();
    const pending = engine.getPendingApprovalContext(taskListId)!;
    const requested = engine.requestChangesPendingGateFromUser({
      taskListId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.taskList.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
      reason: 'Revise after export work began.',
    });
    if (!requested.ok) throw new Error('Expected Production Plan revision request');
    db.rawDb
      .prepare(
        `INSERT INTO task_attempts (
           id, task_list_id, kind, manifest_revision, manifest_hash, idempotency_key,
           status, destination_path, created_at, updated_at
         ) VALUES (?, ?, 'batch_export', 1, ?, ?, 'queued', ?, 1, 1)`,
      )
      .run('taskless-attempt', taskListId, 'manifest-hash', 'export-key', 'movie.mp4');

    expect(() =>
      engine.reviseProductionPlan({
        canvasId: 'canvas-1',
        taskListId,
        expectedRowVersion: requested.taskList.rowVersion ?? -1,
        plan: { ...plan(), title: 'Revision Story: Too Late' },
      }),
    ).toThrow(/downstream side effects/i);
  });
});
