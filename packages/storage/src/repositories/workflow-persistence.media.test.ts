import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ProductionMediaGenerationSpec,
  WorkflowApproval,
  WorkflowDocument,
  WorkflowMediaAttempt,
  WorkflowMediaEvaluation,
  WorkflowRun,
  WorkflowRunId,
} from '@lucid-fin/contracts';
import { SqliteIndex } from '../sqlite-index.js';

const PLAN_HASH = '1'.repeat(64);
const VISUAL_HASH = '2'.repeat(64);
const ASSET_HASH = '3'.repeat(64);

function makeRun(): WorkflowRun {
  return {
    id: 'run-media',
    workflowType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status: 'ready',
    summary: 'Ready',
    progress: 40,
    completedStages: 0,
    totalStages: 0,
    completedTasks: 0,
    totalTasks: 0,
    currentStageId: 'production-plan',
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

function document(
  id: string,
  logicalKey: string,
  documentType: string,
  contentHash: string,
): WorkflowDocument {
  return {
    id,
    workflowRunId: 'run-media',
    logicalKey,
    documentType,
    revision: 1,
    schemaVersion: 1,
    content: { budget: { maxAttemptsPerShot: 2, maxRegenerations: 3, maxTotalCostUsd: 10 } },
    contentHash,
    status: 'active',
    createdAt: 110,
    updatedAt: 110,
  };
}

function approval(
  id: string,
  gateKey: WorkflowApproval['gateKey'],
  logicalKey: string,
  subjectHash: string,
): WorkflowApproval {
  return {
    id,
    workflowRunId: 'run-media',
    gateKey,
    subjectLogicalKey: logicalKey,
    subjectRevision: 1,
    subjectHash,
    manifestHash: subjectHash,
    resumeTokenHash: `${id}-token`,
    status: 'pending',
    createdAt: 120,
    updatedAt: 120,
  };
}

function approveBoth(db: SqliteIndex): void {
  const repo = db.repos.workflows;
  repo.insertRun(makeRun());
  repo.createDocument(document('plan-doc', 'production-plan', 'production_plan', PLAN_HASH));
  repo.createPendingApproval(
    approval('plan-approval', 'production_plan', 'production-plan', PLAN_HASH),
  );
  const planRun = repo.getRun('run-media' as WorkflowRunId)!;
  const planResult = repo.approveGate({
    workflowRunId: 'run-media' as WorkflowRunId,
    gateKey: 'production_plan',
    expectedRowVersion: planRun.rowVersion ?? -1,
    expectedSubjectRevision: 1,
    expectedSubjectHash: PLAN_HASH,
    resumeTokenHash: 'plan-approval-token',
    eventId: 'plan-approved-event',
    actor: 'user',
    approvedAt: 130,
    nextStageId: 'style-exploration',
  });
  if (!planResult.ok) throw new Error(`Plan approval failed: ${planResult.code}`);

  repo.createDocument(
    document('visual-doc', 'visual-constitution', 'visual_constitution', VISUAL_HASH),
  );
  repo.createPendingApproval(
    approval('visual-approval', 'visual_constitution', 'visual-constitution', VISUAL_HASH),
  );
  const visualRun = repo.getRun('run-media' as WorkflowRunId)!;
  const visualResult = repo.approveGate({
    workflowRunId: 'run-media' as WorkflowRunId,
    gateKey: 'visual_constitution',
    expectedRowVersion: visualRun.rowVersion ?? -1,
    expectedSubjectRevision: 1,
    expectedSubjectHash: VISUAL_HASH,
    resumeTokenHash: 'visual-approval-token',
    eventId: 'visual-approved-event',
    actor: 'user',
    approvedAt: 140,
    nextStageId: 'media-generation',
  });
  if (!visualResult.ok) throw new Error(`Visual approval failed: ${visualResult.code}`);
}

function spec(attempt: number): ProductionMediaGenerationSpec {
  return {
    specVersion: 1,
    workflowRunId: 'run-media',
    canvasId: 'canvas-1',
    nodeId: 'shot-1',
    nodeUpdatedAt: 90,
    mediaType: 'image',
    generationType: 'image',
    mode: 'text-to-image',
    productionPlan: { revision: 1, contentHash: PLAN_HASH },
    visualConstitution: { revision: 1, contentHash: VISUAL_HASH },
    providerId: 'image-provider',
    prompt:
      attempt === 1 ? 'A precise hero frame' : 'A precise hero frame\nRepair: keep face identity',
    referenceAssetHashes: [],
    request: { width: 1024, height: 576, seed: 41 + attempt },
    limits: {
      maxAttemptsPerShot: 2,
      maxRegenerations: 3,
      maxTotalCostUsd: 10,
      styleAuditionCommittedCostUsd: 0,
    },
    createdAt: 150 + attempt,
  };
}

function attempt(number: number): WorkflowMediaAttempt {
  const generationSpec = spec(number);
  return {
    id: `media-attempt-${number}`,
    workflowRunId: 'run-media',
    canvasId: 'canvas-1',
    nodeId: 'shot-1',
    attempt: number,
    idempotencyKey: `${number}`.repeat(64),
    specHash: `${number + 3}`.repeat(64),
    generationSpec,
    ...(number > 1
      ? {
          repairDelta: {
            version: 1 as const,
            reason: 'Identity drift',
            promptAdditions: ['keep face identity'],
            negativeAdditions: ['different face'],
            preserve: ['approved lighting'],
            seedStrategy: 'increment' as const,
          },
        }
      : {}),
    mediaType: 'image',
    status: 'reserved',
    rowVersion: 0,
    providerId: 'image-provider',
    prompt: generationSpec.prompt,
    promptHash: `${number + 5}`.repeat(64),
    seed: 41 + number,
    estimatedCostUsd: 0.25,
    createdAt: 150 + number,
    updatedAt: 150 + number,
  };
}

function evaluation(attemptId: string, verdict: 'pass' | 'repair'): WorkflowMediaEvaluation {
  return {
    id: `${attemptId}-evaluation`,
    attemptId,
    workflowRunId: 'run-media',
    canvasId: 'canvas-1',
    nodeId: 'shot-1',
    assetHash: ASSET_HASH,
    mediaType: 'image',
    rubricVersion: 'production-media-rubric-v1',
    evaluatorProviderId: 'vision-provider',
    evaluatorModel: 'vision-model',
    scores: {
      identity: verdict === 'pass' ? 90 : 50,
      style: 90,
      scriptAlignment: 90,
      continuity: 90,
      composition: 90,
      lighting: 90,
      motion: 100,
      technical: 90,
      safety: 100,
    },
    total: verdict === 'pass' ? 91 : 72,
    verdict,
    strengths: ['Approved style is visible'],
    risks: verdict === 'repair' ? ['Face identity drift'] : [],
    evidence: ['The face differs from the locked reference'],
    ...(verdict === 'repair'
      ? {
          repairDelta: {
            version: 1 as const,
            reason: 'Identity drift',
            promptAdditions: ['keep face identity'],
            negativeAdditions: ['different face'],
            preserve: ['approved lighting'],
            seedStrategy: 'increment' as const,
          },
        }
      : {}),
    metadata: {},
    frameEvidence: [],
    createdAt: 200,
  };
}

describe('persistent production-media ledger', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  function open(dbPath: string): SqliteIndex {
    const db = new SqliteIndex(dbPath);
    indexes.push(db);
    return db;
  }

  afterEach(() => {
    for (const index of indexes.splice(0)) {
      try {
        index.close();
      } catch {
        // A restart test may already have closed this connection.
      }
    }
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('reserves before submission, records immutable evaluation evidence, and restores after restart', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-media-ledger-'));
    roots.push(root);
    const dbPath = path.join(root, 'project.db');
    const db = open(dbPath);
    approveBoth(db);
    const repo = db.repos.workflows;
    const run = repo.getRun('run-media' as WorkflowRunId)!;
    const proposed = attempt(1);

    expect(
      repo.reserveMediaAttempt({
        attempt: proposed,
        expectedRunRowVersion: run.rowVersion ?? -1,
      }),
    ).toMatchObject({ created: true, attempt: { id: proposed.id, status: 'reserved' } });
    expect(
      repo.reserveMediaAttempt({
        attempt: proposed,
        expectedRunRowVersion: run.rowVersion ?? -1,
      }),
    ).toMatchObject({ created: false, attempt: { id: proposed.id } });

    const submitted = repo.transitionMediaAttempt({
      id: proposed.id,
      expectedRowVersion: 0,
      expectedStatuses: ['reserved'],
      status: 'submitted',
      submittedAt: 160,
      updatedAt: 160,
    });
    const ready = repo.transitionMediaAttempt({
      id: proposed.id,
      expectedRowVersion: submitted.rowVersion,
      expectedStatuses: ['submitted'],
      status: 'asset_ready',
      assetHash: ASSET_HASH,
      reportedActualCostUsd: 0.2,
      assetReadyAt: 170,
      updatedAt: 170,
    });
    const evaluating = repo.transitionMediaAttempt({
      id: proposed.id,
      expectedRowVersion: ready.rowVersion,
      expectedStatuses: ['asset_ready'],
      status: 'evaluating',
      updatedAt: 180,
    });
    const recorded = repo.recordMediaEvaluation({
      evaluation: evaluation(proposed.id, 'pass'),
      expectedAttemptRowVersion: evaluating.rowVersion,
      expectedAttemptStatuses: ['evaluating'],
      resultingAttemptStatus: 'accepted',
      evaluatedAt: 200,
    });
    expect(recorded).toMatchObject({
      created: true,
      attempt: { status: 'accepted', assetHash: ASSET_HASH },
      evaluation: { verdict: 'pass', total: 91 },
    });
    expect(repo.getMediaCostSummary('run-media' as WorkflowRunId)).toEqual({
      attemptCount: 1,
      regenerationCount: 0,
      estimatedCostUsd: 0.25,
      reportedActualCostUsd: 0.2,
      committedCostUsd: 0.2,
      hasUnreportedActualCosts: false,
    });

    db.close();
    const reopened = open(dbPath);
    expect(
      reopened.repos.workflows.getLatestMediaAttempt('run-media' as WorkflowRunId, 'shot-1'),
    ).toMatchObject({ id: proposed.id, status: 'accepted', rowVersion: 4 });
    expect(reopened.repos.workflows.getMediaEvaluation(proposed.id)).toMatchObject({
      verdict: 'pass',
      assetHash: ASSET_HASH,
    });
  });

  it('keeps a rejected artifact and Repair Delta when the next attempt is reserved', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-media-repair-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    approveBoth(db);
    const repo = db.repos.workflows;
    const run = repo.getRun('run-media' as WorkflowRunId)!;
    const first = repo.reserveMediaAttempt({
      attempt: attempt(1),
      expectedRunRowVersion: run.rowVersion ?? -1,
    }).attempt;
    const submitted = repo.transitionMediaAttempt({
      id: first.id,
      expectedRowVersion: first.rowVersion,
      expectedStatuses: ['reserved'],
      status: 'submitted',
      submittedAt: 160,
      updatedAt: 160,
    });
    const ready = repo.transitionMediaAttempt({
      id: first.id,
      expectedRowVersion: submitted.rowVersion,
      expectedStatuses: ['submitted'],
      status: 'asset_ready',
      assetHash: ASSET_HASH,
      assetReadyAt: 170,
      updatedAt: 170,
    });
    const recorded = repo.recordMediaEvaluation({
      evaluation: evaluation(first.id, 'repair'),
      expectedAttemptRowVersion: ready.rowVersion,
      expectedAttemptStatuses: ['asset_ready'],
      resultingAttemptStatus: 'repair_required',
      evaluatedAt: 180,
    });
    expect(recorded.attempt.status).toBe('repair_required');

    const second = repo.reserveMediaAttempt({
      attempt: attempt(2),
      expectedRunRowVersion: run.rowVersion ?? -1,
    });
    expect(second.attempt).toMatchObject({
      attempt: 2,
      status: 'reserved',
      repairDelta: { reason: 'Identity drift', seedStrategy: 'increment' },
    });
    expect(repo.getMediaAttempt(first.id)).toMatchObject({
      status: 'repair_required',
      assetHash: ASSET_HASH,
    });
    expect(repo.getMediaCostSummary('run-media' as WorkflowRunId)).toMatchObject({
      attemptCount: 2,
      regenerationCount: 1,
      committedCostUsd: 0.5,
      hasUnreportedActualCosts: true,
    });
  });

  it('writes no attempt before both exact approvals exist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-media-deny-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const repo = db.repos.workflows;
    repo.insertRun(makeRun());
    const run = repo.getRun('run-media' as WorkflowRunId)!;

    expect(() =>
      repo.reserveMediaAttempt({
        attempt: attempt(1),
        expectedRunRowVersion: run.rowVersion ?? -1,
      }),
    ).toThrow(/not ready for media generation|exact approved/i);
    expect(db.rawDb.prepare('SELECT COUNT(*) AS count FROM workflow_media_attempts').get()).toEqual(
      { count: 0 },
    );
  });

  it('enforces the shared approved cost bound inside the reservation transaction', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-media-budget-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    approveBoth(db);
    const repo = db.repos.workflows;
    const run = repo.getRun('run-media' as WorkflowRunId)!;
    const first = attempt(1);
    first.generationSpec.limits.maxTotalCostUsd = 0.4;
    repo.reserveMediaAttempt({
      attempt: first,
      expectedRunRowVersion: run.rowVersion ?? -1,
    });
    const second = structuredClone(attempt(1));
    second.id = 'media-attempt-other-node';
    second.nodeId = 'shot-2';
    second.idempotencyKey = '9'.repeat(64);
    second.specHash = '8'.repeat(64);
    second.generationSpec.nodeId = 'shot-2';
    second.generationSpec.limits.maxTotalCostUsd = 0.4;

    expect(() =>
      repo.reserveMediaAttempt({
        attempt: second,
        expectedRunRowVersion: run.rowVersion ?? -1,
      }),
    ).toThrow(/total production-media budget/i);
    expect(db.rawDb.prepare('SELECT COUNT(*) AS count FROM workflow_media_attempts').get()).toEqual(
      { count: 1 },
    );
  });
});
