import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  WorkflowApproval,
  WorkflowDocument,
  WorkflowRun,
  WorkflowRunId,
  WorkflowStageRun,
  WorkflowTaskRun,
} from '@lucid-fin/contracts';
import { SqliteIndex } from '../sqlite-index.js';

function run(): WorkflowRun {
  return {
    id: 'run-final',
    workflowType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status: 'ready',
    summary: 'Ready for final export',
    progress: 90,
    completedStages: 0,
    totalStages: 0,
    completedTasks: 0,
    totalTasks: 1,
    currentStageId: 'stage-final-export',
    currentTaskId: 'task-final-export',
    input: {},
    output: {},
    metadata: {},
    createdAt: 100,
    updatedAt: 100,
    rowVersion: 0,
    engineVersion: 'persistent-hybrid-v1',
    definitionVersion: 1,
  };
}

function finalStage(): WorkflowStageRun {
  return {
    id: 'stage-final-export',
    workflowRunId: 'run-final',
    stageId: 'final-export',
    name: 'Final export',
    status: 'ready',
    order: 5,
    progress: 0,
    completedTasks: 0,
    totalTasks: 1,
    metadata: { dependsOnStageIds: [] },
    updatedAt: 100,
  };
}

function finalTask(): WorkflowTaskRun {
  return {
    id: 'task-final-export',
    workflowRunId: 'run-final',
    stageRunId: 'stage-final-export',
    taskId: 'final-export',
    name: 'Approve and render final export',
    kind: 'export',
    status: 'ready',
    dependencyIds: [],
    attempts: 0,
    maxRetries: 0,
    input: { executionMode: 'external', workflowTaskRole: 'final_export' },
    output: {},
    progress: 0,
    updatedAt: 100,
  };
}

function manifest(): WorkflowDocument {
  return {
    id: 'manifest-doc',
    workflowRunId: 'run-final',
    logicalKey: 'final-export',
    documentType: 'final_export_manifest',
    revision: 1,
    schemaVersion: 1,
    content: { manifestVersion: 1 },
    contentHash: 'a'.repeat(64),
    status: 'active',
    createdAt: 110,
    updatedAt: 110,
  };
}

function approval(): WorkflowApproval {
  return {
    id: 'final-approval',
    workflowRunId: 'run-final',
    gateKey: 'final_export',
    subjectLogicalKey: 'final-export',
    subjectRevision: 1,
    subjectHash: 'a'.repeat(64),
    manifestHash: 'a'.repeat(64),
    resumeTokenHash: 'host-token-hash',
    status: 'pending',
    createdAt: 120,
    updatedAt: 120,
  };
}

describe('persistent Final Export execution ledger', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  function open(dbPath: string): SqliteIndex {
    const db = new SqliteIndex(dbPath);
    indexes.push(db);
    return db;
  }

  function approvedRepository(db: SqliteIndex) {
    const repo = db.repos.workflows;
    repo.insertRun(run());
    repo.insertStageRun(finalStage());
    repo.insertTaskRun(finalTask());
    repo.createDocument(manifest());
    repo.createPendingApproval(approval());
    const pendingRun = repo.getRun('run-final' as WorkflowRunId)!;
    const approved = repo.approveGate({
      workflowRunId: 'run-final' as WorkflowRunId,
      gateKey: 'final_export',
      expectedRowVersion: pendingRun.rowVersion ?? -1,
      expectedSubjectRevision: 1,
      expectedSubjectHash: 'a'.repeat(64),
      resumeTokenHash: 'host-token-hash',
      eventId: 'approval-event',
      actor: 'user',
      approvedAt: 130,
      nextStageId: 'stage-final-export',
      nextTaskId: 'task-final-export',
    });
    if (!approved.ok) throw new Error(`Approval failed: ${approved.code}`);
    return repo;
  }

  afterEach(() => {
    for (const index of indexes.splice(0)) {
      try {
        index.close();
      } catch {
        // Restart tests may already have closed the connection.
      }
    }
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('reserves idempotently, CAS-transitions, completes atomically, and restores after restart', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-export-ledger-'));
    roots.push(root);
    const dbPath = path.join(root, 'project.db');
    const db = open(dbPath);
    const repo = approvedRepository(db);
    const proposed = {
      id: 'execution-1',
      workflowRunId: 'run-final',
      manifestRevision: 1,
      manifestHash: 'a'.repeat(64),
      idempotencyKey: 'b'.repeat(64),
      status: 'queued' as const,
      rowVersion: 0,
      destinationPath: path.join(root, 'Signal.mp4'),
      attempt: 1,
      createdAt: 140,
      updatedAt: 140,
    };
    const reserved = repo.reserveExportExecution({ execution: proposed });
    expect(reserved).toMatchObject({ created: true, execution: proposed });
    expect(repo.reserveExportExecution({ execution: proposed })).toMatchObject({
      created: false,
      execution: { id: 'execution-1', rowVersion: 0 },
    });

    const running = repo.transitionExportExecution({
      id: 'execution-1',
      expectedRowVersion: 0,
      expectedStatuses: ['queued'],
      status: 'running',
      stagingPath: path.join(root, 'staging.mp4'),
      updatedAt: 150,
    });
    const ready = repo.transitionExportExecution({
      id: 'execution-1',
      expectedRowVersion: running.rowVersion,
      expectedStatuses: ['running'],
      status: 'ready_to_publish',
      outputAssetHash: 'c'.repeat(64),
      outputHash: 'c'.repeat(64),
      outputSize: 42,
      updatedAt: 160,
    });
    const currentRun = repo.getRun('run-final' as WorkflowRunId)!;
    const completed = repo.completeExportExecution({
      id: 'execution-1',
      expectedExecutionRowVersion: ready.rowVersion,
      expectedRunRowVersion: currentRun.rowVersion ?? -1,
      outputAssetHash: 'c'.repeat(64),
      outputHash: 'c'.repeat(64),
      outputSize: 42,
      completedAt: 170,
      runOutput: {
        finalExport: {
          manifestRevision: 1,
          manifestHash: 'a'.repeat(64),
          outputAssetHash: 'c'.repeat(64),
        },
      },
      event: {
        workflowRunId: 'run-final',
        eventId: 'export-completed-event',
        actor: 'system',
        payload: { type: 'workflow.final_export.completed', executionId: 'execution-1' },
        timestamp: 170,
      },
    });
    expect(completed).toMatchObject({
      execution: { status: 'completed', outputAssetHash: 'c'.repeat(64) },
      run: { status: 'completed', progress: 100 },
      event: { seq: 2, eventId: 'export-completed-event' },
    });
    db.close();

    const reopened = open(dbPath);
    expect(
      reopened.repos.workflows.getLatestExportExecution('run-final' as WorkflowRunId),
    ).toMatchObject({
      id: 'execution-1',
      status: 'completed',
      outputHash: 'c'.repeat(64),
      outputSize: 42,
    });
    expect(reopened.repos.workflows.getRun('run-final' as WorkflowRunId)).toMatchObject({
      status: 'completed',
      output: { finalExport: { manifestRevision: 1, outputAssetHash: 'c'.repeat(64) } },
    });
  });

  it('does not reserve work before the exact Final Export approval', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-export-ledger-deny-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const repo = db.repos.workflows;
    repo.insertRun(run());
    repo.createDocument(manifest());
    repo.createPendingApproval(approval());

    expect(() =>
      repo.reserveExportExecution({
        execution: {
          id: 'execution-denied',
          workflowRunId: 'run-final',
          manifestRevision: 1,
          manifestHash: 'a'.repeat(64),
          idempotencyKey: 'd'.repeat(64),
          status: 'queued',
          rowVersion: 0,
          destinationPath: path.join(root, 'Signal.mp4'),
          attempt: 1,
          createdAt: 140,
          updatedAt: 140,
        },
      }),
    ).toThrow(/awaiting final_export approval|exact approved final export manifest is required/i);
    expect(
      db.rawDb.prepare('SELECT COUNT(*) AS count FROM workflow_export_executions').get(),
    ).toEqual({ count: 0 });
  });
});
