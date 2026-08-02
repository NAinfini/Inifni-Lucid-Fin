import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  WorkflowApproval,
  WorkflowDocument,
  WorkflowRun,
  WorkflowRunId,
} from '@lucid-fin/contracts';
import { SqliteIndex } from '../sqlite-index.js';

function makeRun(id: string): WorkflowRun {
  return {
    id,
    workflowType: 'idea-to-video',
    entityType: 'project',
    triggerSource: 'user',
    status: 'preparing',
    summary: '',
    progress: 0,
    completedStages: 0,
    totalStages: 0,
    completedTasks: 0,
    totalTasks: 0,
    input: { idea: 'A lantern searches for its owner.' },
    output: {},
    metadata: {},
    createdAt: 100,
    updatedAt: 100,
  };
}

function makeDocument(
  id: string,
  runId: string,
  logicalKey: string,
  revision: number,
  contentHash: string,
): WorkflowDocument {
  return {
    id,
    workflowRunId: runId,
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
  runId: string,
  gateKey: WorkflowApproval['gateKey'],
  logicalKey: string,
  subjectRevision: number,
  subjectHash: string,
  resumeTokenHash: string,
): WorkflowApproval {
  return {
    id,
    workflowRunId: runId,
    gateKey,
    subjectLogicalKey: logicalKey,
    subjectRevision,
    subjectHash,
    manifestHash: `manifest-${subjectRevision}`,
    resumeTokenHash,
    status: 'pending',
    createdAt: 200 + subjectRevision,
    updatedAt: 200 + subjectRevision,
  };
}

describe('persistent workflow documents and approvals', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  function openIndex(dbPath: string): SqliteIndex {
    const index = new SqliteIndex(dbPath);
    indexes.push(index);
    return index;
  }

  afterEach(() => {
    for (const index of indexes.splice(0)) {
      try {
        index.close();
      } catch {
        // The test may already have closed the connection to simulate restart.
      }
    }
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the latest immutable document and pending gate across repository restart', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-persist-'));
    roots.push(root);
    const dbPath = path.join(root, 'project.db');

    const first = openIndex(dbPath);
    first.repos.workflows.insertRun(makeRun('run-1'));
    first.repos.workflows.createDocument(
      makeDocument('doc-1', 'run-1', 'production-plan', 1, 'sha-1'),
    );
    first.repos.workflows.createDocument(
      makeDocument('doc-2', 'run-1', 'production-plan', 2, 'sha-2'),
    );
    first.repos.workflows.createPendingApproval(
      makeApproval(
        'approval-1',
        'run-1',
        'production_plan',
        'production-plan',
        2,
        'sha-2',
        'token-2',
      ),
    );
    first.close();

    const reopened = openIndex(dbPath);
    const repo = reopened.repos.workflows;
    expect(repo.getLatestDocument('run-1' as WorkflowRunId, 'production-plan')?.revision).toBe(2);
    expect(repo.getPendingApproval('run-1' as WorkflowRunId, 'production_plan')).toMatchObject({
      id: 'approval-1',
      subjectRevision: 2,
      subjectHash: 'sha-2',
      status: 'pending',
    });
    expect(repo.getRun('run-1' as WorkflowRunId)).toMatchObject({
      rowVersion: 1,
      currentGate: 'production_plan',
      status: 'awaiting_approval',
      engineVersion: 'legacy',
      definitionVersion: 1,
    });
    reopened.close();
  });

  it('approves exactly once and atomically advances run CAS state with a contiguous event', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-approve-'));
    roots.push(root);
    const index = openIndex(path.join(root, 'project.db'));
    const repo = index.repos.workflows;
    repo.insertRun(makeRun('run-1'));
    repo.createDocument(makeDocument('doc-1', 'run-1', 'production-plan', 1, 'sha-1'));
    repo.createPendingApproval(
      makeApproval(
        'approval-1',
        'run-1',
        'production_plan',
        'production-plan',
        1,
        'sha-1',
        'token-1',
      ),
    );

    const approved = repo.approveGate({
      workflowRunId: 'run-1' as WorkflowRunId,
      gateKey: 'production_plan',
      expectedRowVersion: 1,
      expectedSubjectRevision: 1,
      expectedSubjectHash: 'sha-1',
      resumeTokenHash: 'token-1',
      eventId: 'event-1',
      actor: 'user',
      correlationId: 'corr-1',
      approvedAt: 300,
    });
    expect(approved).toMatchObject({ ok: true, code: 'approved' });
    expect(repo.getRun('run-1' as WorkflowRunId)).toMatchObject({
      rowVersion: 2,
      currentGate: undefined,
      status: 'ready',
    });
    expect(repo.listEvents('run-1' as WorkflowRunId)).toEqual([
      expect.objectContaining({ seq: 1, eventId: 'event-1', actor: 'user' }),
    ]);

    const repeated = repo.approveGate({
      workflowRunId: 'run-1' as WorkflowRunId,
      gateKey: 'production_plan',
      expectedRowVersion: 1,
      expectedSubjectRevision: 1,
      expectedSubjectHash: 'sha-1',
      resumeTokenHash: 'token-1',
      eventId: 'event-repeat',
      actor: 'user',
      approvedAt: 301,
    });
    expect(repeated).toMatchObject({ ok: false, code: 'already_approved' });
    expect(repo.listEvents('run-1' as WorkflowRunId)).toHaveLength(1);
    index.close();
  });

  it('atomically appends a user-selected gate revision and rolls back a stale CAS attempt', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-gate-revision-'));
    roots.push(root);
    const index = openIndex(path.join(root, 'project.db'));
    const repo = index.repos.workflows;
    repo.insertRun({
      ...makeRun('run-1'),
      workflowType: 'movie.production.v2',
      entityType: 'canvas',
      entityId: 'canvas-1',
      status: 'ready',
      currentStageId: 'style-exploration',
    });

    const firstDocument = makeDocument(
      'visual-doc-1',
      'run-1',
      'visual-constitution',
      1,
      'visual-sha-1',
    );
    const firstApproval = makeApproval(
      'visual-approval-1',
      'run-1',
      'visual_constitution',
      'visual-constitution',
      1,
      'visual-sha-1',
      'visual-token-1',
    );
    const first = repo.createApprovalGateRevision({
      expectedRowVersion: 0,
      document: firstDocument,
      approval: firstApproval,
      event: {
        workflowRunId: 'run-1',
        eventId: 'visual-event-1',
        actor: 'user',
        payload: { type: 'workflow.gate.requested', selectedCandidateId: 'analog-horror' },
        timestamp: 201,
      },
    });
    expect(first).toMatchObject({
      run: { rowVersion: 1, currentGate: 'visual_constitution', status: 'awaiting_approval' },
      event: { seq: 1, actor: 'user' },
    });

    const secondDocument = makeDocument(
      'visual-doc-2',
      'run-1',
      'visual-constitution',
      2,
      'visual-sha-2',
    );
    const secondApproval = makeApproval(
      'visual-approval-2',
      'run-1',
      'visual_constitution',
      'visual-constitution',
      2,
      'visual-sha-2',
      'visual-token-2',
    );
    expect(() =>
      repo.createApprovalGateRevision({
        expectedRowVersion: 0,
        document: secondDocument,
        approval: secondApproval,
        event: {
          workflowRunId: 'run-1',
          eventId: 'visual-event-stale',
          actor: 'user',
          payload: { type: 'workflow.gate.requested', selectedCandidateId: 'quiet-realism' },
          timestamp: 202,
        },
      }),
    ).toThrow(/row version changed/);

    expect(repo.getLatestDocument('run-1' as WorkflowRunId, 'visual-constitution')).toMatchObject({
      id: 'visual-doc-1',
      revision: 1,
    });
    expect(repo.getPendingApproval('run-1' as WorkflowRunId, 'visual_constitution')).toMatchObject({
      id: 'visual-approval-1',
      subjectRevision: 1,
    });
    expect(repo.getRun('run-1' as WorkflowRunId)?.rowVersion).toBe(1);
    expect(repo.listEvents('run-1' as WorkflowRunId).map((event) => event.eventId)).toEqual([
      'visual-event-1',
    ]);
    index.close();
  });

  it('returns typed conflicts for stale row/revision, subject hash, and resume token', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-conflict-'));
    roots.push(root);
    const index = openIndex(path.join(root, 'project.db'));
    const repo = index.repos.workflows;
    repo.insertRun(makeRun('run-1'));
    repo.createDocument(makeDocument('doc-1', 'run-1', 'visual-constitution', 3, 'visual-sha'));
    repo.createPendingApproval(
      makeApproval(
        'approval-1',
        'run-1',
        'visual_constitution',
        'visual-constitution',
        3,
        'visual-sha',
        'visual-token',
      ),
    );

    const base = {
      workflowRunId: 'run-1' as WorkflowRunId,
      gateKey: 'visual_constitution' as const,
      expectedRowVersion: 1,
      expectedSubjectRevision: 3,
      expectedSubjectHash: 'visual-sha',
      resumeTokenHash: 'visual-token',
      eventId: 'event-1',
      actor: 'user',
      approvedAt: 300,
    };

    expect(repo.approveGate({ ...base, expectedRowVersion: 0 })).toMatchObject({
      ok: false,
      code: 'stale_row_version',
    });
    expect(repo.approveGate({ ...base, expectedSubjectRevision: 2 })).toMatchObject({
      ok: false,
      code: 'stale_subject_revision',
    });
    expect(repo.approveGate({ ...base, expectedSubjectHash: 'wrong' })).toMatchObject({
      ok: false,
      code: 'subject_hash_mismatch',
    });
    expect(repo.approveGate({ ...base, resumeTokenHash: 'wrong' })).toMatchObject({
      ok: false,
      code: 'resume_token_mismatch',
    });
    expect(repo.getPendingApproval('run-1' as WorkflowRunId, 'visual_constitution')).toBeDefined();
    expect(repo.listEvents('run-1' as WorkflowRunId)).toEqual([]);
    index.close();
  });

  it('assigns contiguous event sequences across the three fixed approval gates', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-seq-'));
    roots.push(root);
    const index = openIndex(path.join(root, 'project.db'));
    const repo = index.repos.workflows;
    repo.insertRun(makeRun('run-1'));

    const gates = [
      ['production_plan', 'production-plan'],
      ['visual_constitution', 'visual-constitution'],
      ['final_export', 'final-export'],
    ] as const;

    gates.forEach(([gateKey, logicalKey], offset) => {
      const revision = offset + 1;
      repo.createDocument(
        makeDocument(`doc-${revision}`, 'run-1', logicalKey, revision, `sha-${revision}`),
      );
      repo.createPendingApproval(
        makeApproval(
          `approval-${revision}`,
          'run-1',
          gateKey,
          logicalKey,
          revision,
          `sha-${revision}`,
          `token-${revision}`,
        ),
      );
      const rowVersion = repo.getRun('run-1' as WorkflowRunId)?.rowVersion;
      if (rowVersion === undefined) {
        throw new Error('workflow run rowVersion was not persisted');
      }
      const result = repo.approveGate({
        workflowRunId: 'run-1' as WorkflowRunId,
        gateKey,
        expectedRowVersion: rowVersion,
        expectedSubjectRevision: revision,
        expectedSubjectHash: `sha-${revision}`,
        resumeTokenHash: `token-${revision}`,
        eventId: `event-${revision}`,
        actor: 'user',
        causationId: revision === 1 ? undefined : `event-${revision - 1}`,
        approvedAt: 300 + revision,
      });
      expect(result).toMatchObject({ ok: true, code: 'approved' });
    });

    expect(repo.listEvents('run-1' as WorkflowRunId).map(({ seq }) => seq)).toEqual([1, 2, 3]);
    expect(repo.getRun('run-1' as WorkflowRunId)?.rowVersion).toBe(6);
    index.close();
  });
});
