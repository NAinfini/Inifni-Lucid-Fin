import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  PlanApproval,
  PlanDocument,
  Task,
  TaskDecision,
  TaskList,
} from '@lucid-fin/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteIndex } from '../sqlite-index.js';

function makeTaskList(id: string, overrides: Partial<TaskList> = {}): TaskList {
  return {
    id,
    taskListType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status: 'preparing',
    summary: '',
    progress: 0,
    completedPhases: 0,
    totalPhases: 1,
    completedTasks: 0,
    totalTasks: 1,
    input: { idea: 'A lantern searches for its owner.' },
    output: {},
    metadata: {},
    createdAt: 100,
    updatedAt: 100,
    rowVersion: 0,
    engineVersion: 'test',
    definitionVersion: 1,
    ...overrides,
  };
}

function makeTask(id: string, taskListId: string, overrides: Partial<Task> = {}): Task {
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
    input: { executionMode: 'external' },
    output: {},
    progress: 0,
    updatedAt: 100,
    ...overrides,
  };
}

function makeDocument(
  id: string,
  taskListId: string,
  logicalKey: string,
  revision: number,
  contentHash: string,
): PlanDocument {
  return {
    id,
    taskListId,
    logicalKey,
    documentType: logicalKey,
    revision,
    schemaVersion: 1,
    content: { title: `revision-${revision}` },
    contentHash,
    status: 'active',
    createdAt: 100 + revision,
    updatedAt: 100 + revision,
  };
}

function makeApproval(
  id: string,
  taskListId: string,
  gateKey: PlanApproval['gateKey'],
  logicalKey: string,
  revision: number,
  subjectHash: string,
  resumeTokenHash: string,
): PlanApproval {
  return {
    id,
    taskListId,
    gateKey,
    subjectLogicalKey: logicalKey,
    subjectRevision: revision,
    subjectHash,
    manifestHash: `manifest-${revision}`,
    resumeTokenHash,
    status: 'pending',
    createdAt: 200 + revision,
    updatedAt: 200 + revision,
  };
}

describe('Task List plans, approvals, and decisions', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  function openPersistentIndex(prefix: string): SqliteIndex {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    roots.push(root);
    const index = new SqliteIndex(path.join(root, 'project.db'));
    indexes.push(index);
    return index;
  }

  afterEach(() => {
    for (const index of indexes.splice(0)) {
      try {
        index.close();
      } catch {
        // A test may close an index to verify restart recovery.
      }
    }
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('persists immutable plan revisions and approves exactly once with contiguous audit events', () => {
    const first = openPersistentIndex('lucid-task-list-approval-');
    const dbPath = first.dbPath;
    const repo = first.repos.taskLists;
    repo.insertTaskList(makeTaskList('list-1'));
    repo.createDocument(makeDocument('doc-1', 'list-1', 'production-plan', 1, 'sha-1'));
    repo.createDocument(makeDocument('doc-2', 'list-1', 'production-plan', 2, 'sha-2'));
    repo.createPendingApproval(
      makeApproval(
        'approval-1',
        'list-1',
        'production_plan',
        'production-plan',
        2,
        'sha-2',
        'token-2',
      ),
    );
    first.close();

    const reopened = new SqliteIndex(dbPath);
    indexes.push(reopened);
    const restored = reopened.repos.taskLists;
    expect(restored.getLatestDocument('list-1', 'production-plan')).toMatchObject({
      id: 'doc-2',
      revision: 2,
      contentHash: 'sha-2',
    });
    expect(restored.getPendingApproval('list-1', 'production_plan')).toMatchObject({
      id: 'approval-1',
      status: 'pending',
    });
    expect(restored.getTaskList('list-1')).toMatchObject({
      status: 'awaiting_approval',
      currentGate: 'production_plan',
      rowVersion: 1,
    });

    const base = {
      taskListId: 'list-1',
      gateKey: 'production_plan' as const,
      expectedRowVersion: 1,
      expectedSubjectRevision: 2,
      expectedSubjectHash: 'sha-2',
      resumeTokenHash: 'token-2',
      eventId: 'event-approved',
      actor: 'user',
      approvedAt: 300,
    };
    expect(restored.approveGate({ ...base, expectedRowVersion: 0 })).toMatchObject({
      ok: false,
      code: 'stale_row_version',
    });
    expect(restored.approveGate({ ...base, expectedSubjectRevision: 1 })).toMatchObject({
      ok: false,
      code: 'stale_subject_revision',
    });
    expect(restored.approveGate({ ...base, expectedSubjectHash: 'wrong' })).toMatchObject({
      ok: false,
      code: 'subject_hash_mismatch',
    });
    expect(restored.approveGate({ ...base, resumeTokenHash: 'wrong' })).toMatchObject({
      ok: false,
      code: 'resume_token_mismatch',
    });
    expect(restored.approveGate(base)).toMatchObject({
      ok: true,
      code: 'approved',
      taskList: { status: 'ready', currentGate: undefined, rowVersion: 2 },
      approval: { status: 'approved', decidedAt: 300 },
      event: { seq: 1, eventId: 'event-approved' },
    });
    expect(restored.approveGate(base)).toMatchObject({
      ok: false,
      code: 'already_approved',
    });
    expect(restored.listEvents('list-1')).toEqual([
      expect.objectContaining({
        seq: 1,
        payload: expect.objectContaining({ type: 'task_list.gate.approved' }),
      }),
    ]);
  });

  it.each([
    'pending',
    'blocked',
    'ready',
    'running',
    'awaiting_provider',
    'retryable_failed',
    'failed',
    'cancelled',
    'skipped',
  ] as const)(
    'reconciles an exact pending approval when its external producer is %s',
    (producerStatus) => {
      const index = openPersistentIndex(`lucid-task-list-${producerStatus}-approval-`);
      const repo = index.repos.taskLists;
      repo.insertTaskList(
        makeTaskList('list-1', {
          currentPhaseKey: 'production-plan',
          currentTaskId: 'producer-task',
        }),
      );
      repo.insertTask(makeTask('producer-task', 'list-1', { status: producerStatus }));
      repo.createDocument(makeDocument('doc-1', 'list-1', 'production-plan', 1, 'sha-1'));
      repo.createPendingApproval(
        makeApproval(
          'approval-1',
          'list-1',
          'production_plan',
          'production-plan',
          1,
          'sha-1',
          'token-1',
        ),
      );

      const approval = {
        taskListId: 'list-1',
        gateKey: 'production_plan' as const,
        expectedRowVersion: 1,
        expectedSubjectRevision: 1,
        expectedSubjectHash: 'sha-1',
        resumeTokenHash: 'token-1',
        completedProducerTaskId: 'producer-task',
        eventId: 'event-approved',
        actor: 'user',
        approvedAt: 300,
      };

      expect(repo.approveGate(approval)).toMatchObject({ ok: true, code: 'approved' });
      expect(repo.getTask('producer-task')).toMatchObject({
        status: 'completed',
        progress: 100,
        currentStep: 'approved',
        completedAt: 300,
      });
      expect(repo.approveGate(approval)).toMatchObject({
        ok: false,
        code: 'already_approved',
      });
    },
  );

  it('atomically rejects an approved subject candidate and reopens its producer Task', () => {
    const index = openPersistentIndex('lucid-task-list-revision-');
    const repo = index.repos.taskLists;
    repo.insertTaskList(
      makeTaskList('list-1', {
        status: 'ready',
        currentPhaseKey: 'production-plan',
        currentTaskId: 'producer-task',
      }),
    );
    repo.insertTask(
      makeTask('producer-task', 'list-1', {
        status: 'completed',
        progress: 100,
        output: { documentId: 'doc-1' },
        completedAt: 200,
        updatedAt: 200,
      }),
    );
    repo.createDocument(makeDocument('doc-1', 'list-1', 'production-plan', 1, 'sha-1'));
    repo.createPendingApproval(
      makeApproval(
        'approval-1',
        'list-1',
        'production_plan',
        'production-plan',
        1,
        'sha-1',
        'token-1',
      ),
    );

    const revised = repo.reviseGate({
      taskListId: 'list-1',
      gateKey: 'production_plan',
      action: 'request_changes',
      reason: 'Strengthen continuity.',
      expectedRowVersion: 1,
      expectedSubjectRevision: 1,
      expectedSubjectHash: 'sha-1',
      producerTaskId: 'producer-task',
      eventId: 'event-revised',
      actor: 'user',
      revisedAt: 400,
    });
    expect(revised).toMatchObject({
      ok: true,
      code: 'revision_requested',
      taskList: {
        status: 'ready',
        currentGate: undefined,
        currentPhaseKey: 'production-plan',
        currentTaskId: 'producer-task',
        rowVersion: 2,
      },
      previousApproval: { status: 'rejected' },
      producerTask: {
        status: 'ready',
        progress: 0,
        currentStep: 'revision_requested',
        input: {
          executionMode: 'external',
          revisionRequest: expect.objectContaining({ reason: 'Strengthen continuity.' }),
        },
      },
      event: { seq: 1 },
    });
    expect(repo.getPendingApproval('list-1', 'production_plan')).toBeUndefined();
    expect(repo.getLatestDocument('list-1', 'production-plan')?.revision).toBe(1);
  });

  it('reserves and answers Commander choices idempotently without bypassing the Task binding', () => {
    const index = openPersistentIndex('lucid-task-list-decision-');
    const repo = index.repos.taskLists;
    repo.insertTaskList(
      makeTaskList('list-1', {
        status: 'ready',
        currentPhaseKey: 'visual-direction',
        currentTaskId: 'task-choice',
      }),
    );
    repo.insertTask(
      makeTask('task-choice', 'list-1', {
        phaseKey: 'visual-direction',
        phaseName: 'Visual direction',
        phaseOrder: 1,
        taskKey: 'choose-style',
        input: { executionMode: 'external' },
      }),
    );
    const decision: TaskDecision = {
      id: 'decision-1',
      taskListId: 'list-1',
      taskId: 'task-choice',
      canvasId: 'canvas-1',
      questionId: 'question-1',
      decisionKey: 'style-choice',
      subjectRevision: 1,
      question: 'Choose a visual direction',
      options: [
        { id: 'quiet', label: 'Quiet realism' },
        { id: 'dream', label: 'Dreamlike' },
      ],
      allowFreeText: false,
      status: 'pending',
      rowVersion: 0,
      createdAt: 200,
      updatedAt: 200,
    };
    const reservation = {
      decision,
      expectedTaskListRowVersion: 0,
      event: {
        taskListId: 'list-1',
        eventId: 'event-question',
        actor: 'commander',
        payload: {},
        timestamp: 200,
      },
    };
    expect(repo.reserveDecision(reservation)).toMatchObject({
      created: true,
      decision: { id: 'decision-1', status: 'pending' },
      taskList: { status: 'blocked', rowVersion: 1 },
      task: { status: 'blocked', currentStep: 'awaiting_user_decision' },
      event: { seq: 1 },
    });
    expect(repo.reserveDecision(reservation)).toMatchObject({
      created: false,
      decision: { id: 'decision-1' },
    });
    expect(() =>
      repo.answerDecision({
        canvasId: 'canvas-1',
        questionId: 'question-1',
        answer: 'Something else',
        status: 'answered',
        answeredAt: 300,
        event: {
          taskListId: 'list-1',
          eventId: 'event-invalid',
          actor: 'user',
          payload: {},
          timestamp: 300,
        },
      }),
    ).toThrow('requires one of the listed options');

    expect(
      repo.answerDecision({
        canvasId: 'canvas-1',
        questionId: 'question-1',
        answer: 'Dreamlike',
        selectedOptionId: 'dream',
        status: 'answered',
        answeredAt: 301,
        event: {
          taskListId: 'list-1',
          eventId: 'event-answer',
          actor: 'user',
          payload: {},
          timestamp: 301,
        },
      }),
    ).toMatchObject({
      answered: true,
      decision: { status: 'answered', answer: 'Dreamlike', selectedOptionId: 'dream' },
      taskList: { status: 'ready', rowVersion: 2 },
      task: { status: 'ready', currentStep: 'user_decision_answered' },
      event: { seq: 2 },
    });
    expect(repo.listPendingDecisions({ canvasId: 'canvas-1' })).toEqual([]);
    expect(repo.listEvents('list-1').map(({ seq }) => seq)).toEqual([1, 2]);
  });

  it('allows a free-text-only durable decision and rejects malformed options', () => {
    const index = openPersistentIndex('lucid-task-list-open-decision-');
    const repo = index.repos.taskLists;
    repo.insertTaskList(
      makeTaskList('list-open', {
        status: 'ready',
        currentPhaseKey: 'visual-direction',
        currentTaskId: 'task-open',
      }),
    );
    repo.insertTask(makeTask('task-open', 'list-open'));
    const decision: TaskDecision = {
      id: 'decision-open',
      taskListId: 'list-open',
      taskId: 'task-open',
      canvasId: 'canvas-1',
      questionId: 'question-open',
      decisionKey: 'open-direction',
      subjectRevision: 1,
      question: 'Describe the direction',
      options: [],
      allowFreeText: true,
      status: 'pending',
      rowVersion: 0,
      createdAt: 200,
      updatedAt: 200,
    };
    const reservation = {
      decision,
      expectedTaskListRowVersion: 0,
      event: {
        taskListId: 'list-open',
        eventId: 'event-open-question',
        actor: 'commander',
        payload: {},
        timestamp: 200,
      },
    };

    expect(repo.reserveDecision(reservation)).toMatchObject({
      created: true,
      decision: { options: [], allowFreeText: true },
    });
    expect(() =>
      repo.reserveDecision({
        ...reservation,
        decision: { ...decision, id: 'decision-closed', questionId: 'question-closed', decisionKey: 'closed', allowFreeText: false },
      }),
    ).toThrow('empty option lists require allowFreeText=true');
    expect(() =>
      repo.reserveDecision({
        ...reservation,
        decision: {
          ...decision,
          id: 'decision-duplicate',
          questionId: 'question-duplicate',
          decisionKey: 'duplicate',
          options: [
            { id: 'first', label: 'Same' },
            { id: 'second', label: 'Same' },
          ],
        },
      }),
    ).toThrow('unique non-empty ids and labels');
    expect(() =>
      repo.reserveDecision({
        ...reservation,
        decision: {
          ...decision,
          id: 'decision-preview',
          questionId: 'question-preview',
          decisionKey: 'preview',
          options: [{ id: 'one', label: 'One', previewAssetHash: 'not-a-hash' }],
        },
      }),
    ).toThrow('previewAssetHash must be a SHA-256 CAS asset hash');
  });
});
