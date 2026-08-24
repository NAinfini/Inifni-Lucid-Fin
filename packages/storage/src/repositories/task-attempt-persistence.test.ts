import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  DeliveryPackageTaskAttempt,
  PlanApproval,
  PlanDocument,
  ProductionMediaGenerationSpec,
  ProductionMediaTaskAttempt,
  Task,
  TaskEvaluation,
  TaskList,
} from '@lucid-fin/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteIndex } from '../sqlite-index.js';

const PLAN_HASH = '1'.repeat(64);
const VISUAL_HASH = '2'.repeat(64);
const ASSET_HASH = '3'.repeat(64);
const OUTPUT_HASH = '4'.repeat(64);

function makeTaskList(id: string, overrides: Partial<TaskList> = {}): TaskList {
  return {
    id,
    taskListType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status: 'ready',
    summary: 'Ready',
    progress: 40,
    completedPhases: 0,
    totalPhases: 1,
    completedTasks: 0,
    totalTasks: 1,
    input: {},
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

function makeTask(
  id: string,
  taskListId: string,
  phaseKey: string,
  phaseOrder: number,
  taskKey: string,
  taskRole: string,
): Task {
  return {
    id,
    taskListId,
    phaseKey,
    phaseName: phaseKey,
    phaseOrder,
    taskKey,
    name: taskKey,
    kind: phaseKey === 'delivery' ? 'export' : 'adapter_generation',
    status: 'ready',
    dependencyIds: [],
    attempts: 0,
    maxRetries: 1,
    input: { executionMode: 'external', taskRole },
    output: {},
    progress: 0,
    updatedAt: 100,
  };
}

function makeDocument(
  id: string,
  taskListId: string,
  logicalKey: string,
  contentHash: string,
): PlanDocument {
  return {
    id,
    taskListId,
    logicalKey,
    documentType: logicalKey,
    revision: 1,
    schemaVersion: 1,
    content: { limits: { maxAttemptsPerShot: 2, maxRegenerations: 2, maxTotalCostUsd: 10 } },
    contentHash,
    status: 'active',
    createdAt: 110,
    updatedAt: 110,
  };
}

function makeApproval(
  id: string,
  taskListId: string,
  gateKey: PlanApproval['gateKey'],
  logicalKey: string,
  subjectHash: string,
): PlanApproval {
  return {
    id,
    taskListId,
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

function approve(
  index: SqliteIndex,
  taskListId: string,
  gateKey: PlanApproval['gateKey'],
  logicalKey: string,
  hash: string,
  eventId: string,
): void {
  const repo = index.repos.taskLists;
  const approvalId = `${gateKey}-approval`;
  repo.createDocument(makeDocument(`${gateKey}-document`, taskListId, logicalKey, hash));
  repo.createPendingApproval(makeApproval(approvalId, taskListId, gateKey, logicalKey, hash));
  const taskList = repo.getTaskList(taskListId);
  if (!taskList) throw new Error('Task List disappeared before approval');
  const result = repo.approveGate({
    taskListId,
    gateKey,
    expectedRowVersion: taskList.rowVersion ?? -1,
    expectedSubjectRevision: 1,
    expectedSubjectHash: hash,
    resumeTokenHash: `${approvalId}-token`,
    eventId,
    actor: 'user',
    approvedAt: 130,
  });
  if (!result.ok) throw new Error(`Approval failed: ${result.code}`);
}

function mediaSpec(): ProductionMediaGenerationSpec {
  return {
    specVersion: 3,
    scope: 'production',
    authority: {
      kind: 'task-list-approved',
      planId: 'production_plan-document',
      planHash: PLAN_HASH,
      constitutionId: 'visual_constitution-document',
      constitutionHash: VISUAL_HASH,
    },
    taskListId: 'list-media',
    taskId: 'task-media',
    canvasId: 'canvas-1',
    canvasUpdatedAt: 80,
    nodeId: 'shot-1',
    nodeUpdatedAt: 90,
    task: {
      id: 'task-media',
      key: 'generate-shot-1',
      role: 'production_media',
      shotId: 'shot-1',
    },
    mediaType: 'image',
    generationType: 'image',
    operation: 'text-to-image',
    providerId: 'image-provider',
    modelId: 'image-model',
    promptAssemblyId: 'assembly-1',
    prompt: 'A precise hero frame',
    promptHash: '7'.repeat(64),
    referenceEvidence: [],
    request: {
      type: 'image',
      providerId: 'image-provider',
      prompt: 'A precise hero frame',
      width: 1024,
      height: 576,
      seed: 42,
    },
    limits: {
      maxAttemptsPerShot: 2,
      maxRegenerations: 2,
      maxTotalCostUsd: 10,
      styleAuditionCommittedCostUsd: 0,
    },
    lineage: { purpose: 'initial', variantIndex: 0, variantCount: 1 },
    createdAt: 150,
  };
}

function mediaAttempt(): ProductionMediaTaskAttempt {
  const generationSpec = mediaSpec();
  return {
    kind: 'production_media',
    id: 'media-attempt-1',
    taskListId: 'list-media',
    taskId: 'task-media',
    canvasId: 'canvas-1',
    nodeId: 'shot-1',
    attempt: 1,
    idempotencyKey: '5'.repeat(64),
    specHash: '6'.repeat(64),
    generationSpec,
    scope: 'production',
    mediaType: 'image',
    status: 'reserved',
    rowVersion: 0,
    providerId: 'image-provider',
    model: 'image-model',
    promptAssemblyId: 'assembly-1',
    submissionPurpose: 'initial',
    prompt: generationSpec.prompt,
    promptHash: '7'.repeat(64),
    seed: 42,
    estimatedCostUsd: 0.25,
    createdAt: 150,
    updatedAt: 150,
  };
}

function mediaEvaluation(): TaskEvaluation {
  return {
    kind: 'production_media',
    id: 'evaluation-1',
    attemptId: 'media-attempt-1',
    taskListId: 'list-media',
    canvasId: 'canvas-1',
    nodeId: 'shot-1',
    artifactId: 'media-output-1',
    assetHash: ASSET_HASH,
    mediaType: 'image',
    profile: 'production_media.v1',
    sourcePromptHash: '7'.repeat(64),
    rubricVersion: 'production-media-v1',
    evaluatorProviderId: 'vision-provider',
    evaluatorModel: 'vision-model',
    scores: {
      identity: 92,
      style: 90,
      scriptAlignment: 91,
      continuity: 89,
      composition: 93,
      lighting: 90,
      motion: 100,
      technical: 94,
      safety: 100,
    },
    total: 93,
    verdict: 'pass',
    strengths: ['Approved visual grammar is preserved'],
    risks: [],
    evidence: ['Frame 1 matches the locked character identity'],
    metadata: { source: 'vision' },
    frameEvidence: [],
    createdAt: 200,
  };
}

describe('unified Task Attempt persistence', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  function open(prefix: string): { index: SqliteIndex; dbPath: string; root: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    roots.push(root);
    const dbPath = path.join(root, 'project.db');
    const index = new SqliteIndex(dbPath);
    indexes.push(index);
    return { index, dbPath, root };
  }

  afterEach(() => {
    for (const index of indexes.splice(0)) {
      try {
        index.close();
      } catch {
        // A restart assertion may already have closed the connection.
      }
    }
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('reserves, transitions, evaluates, and restores a production-media attempt', () => {
    const { index, dbPath } = open('lucid-task-media-');
    const repo = index.repos.taskLists;
    repo.insertTaskList(
      makeTaskList('list-media', {
        currentPhaseKey: 'media-generation',
        currentTaskId: 'task-media',
      }),
    );
    repo.insertTask(
      makeTask(
        'task-media',
        'list-media',
        'media-generation',
        2,
        'generate-shot-1',
        'production_media',
      ),
    );
    approve(index, 'list-media', 'production_plan', 'production-plan', PLAN_HASH, 'event-plan');
    approve(
      index,
      'list-media',
      'visual_constitution',
      'visual-constitution',
      VISUAL_HASH,
      'event-visual',
    );

    const promptInput = {
      version: 1 as const,
      assemblyId: 'assembly-1',
      canvasId: 'canvas-1',
      nodeId: 'shot-1',
      nodeUpdatedAt: 90,
      mediaType: 'image' as const,
      mode: 'text-to-image' as const,
      purpose: 'initial' as const,
      authority: {
        kind: 'task-list-approved' as const,
        taskListId: 'list-media',
        taskId: 'task-media',
        productionPlan: { revision: 1, contentHash: PLAN_HASH, content: {} },
        visualConstitution: { revision: 1, contentHash: VISUAL_HASH, content: {} },
      },
      sources: [],
      conditioningManifest: [],
      providerProfile: {
        providerId: 'image-provider',
        model: 'image-model',
        capabilities: ['text-to-image'],
      },
      hostConstraints: { immutable: ['providerId', 'modelId'] },
      inputHash: 'assembly-input-hash',
    };
    const preparedAssembly = index.repos.promptAssemblies.prepare(promptInput, {
      taskListId: 'list-media',
      taskId: 'task-media',
    });
    const assembled = index.repos.promptAssemblies.assemble({
      id: preparedAssembly.id,
      expectedRowVersion: preparedAssembly.rowVersion,
      inputHash: preparedAssembly.inputHash,
      output: {
        version: 1,
        assemblyId: preparedAssembly.id,
        inputHash: preparedAssembly.inputHash,
        finalPrompt: 'A precise hero frame',
        sourceDecisions: [],
        summary: 'Exact prompt',
        warnings: [],
      },
      llmProviderId: 'chatgpt-oauth',
      llmModel: 'gpt-test',
    });

    const proposed = mediaAttempt();
    const taskList = repo.getTaskList('list-media');
    if (!taskList) throw new Error('Task List disappeared');
    expect(
      repo.reserveProductionMediaAttempt({
        attempt: proposed,
        expectedTaskListRowVersion: taskList.rowVersion ?? -1,
      }),
    ).toMatchObject({ created: true, attempt: { id: proposed.id, status: 'reserved' } });
    expect(
      repo.reserveProductionMediaAttempt({
        attempt: proposed,
        expectedTaskListRowVersion: taskList.rowVersion ?? -1,
      }),
    ).toMatchObject({ created: false, attempt: { id: proposed.id } });

    const begun = repo.beginMediaSubmission({
      attemptId: proposed.id,
      expectedAttemptRowVersion: 0,
      promptAssemblyId: assembled.id,
      expectedPromptAssemblyRowVersion: assembled.rowVersion,
      artifactId: 'media-submission-1',
      submissionStartedAt: 160,
    });
    expect(begun).toMatchObject({
      created: true,
      attempt: { status: 'submitting', rowVersion: 1 },
      artifact: {
        id: 'media-submission-1',
        attemptId: proposed.id,
        artifactType: 'media_submission',
      },
    });
    expect(index.repos.promptAssemblies.get('assembly-1')).toMatchObject({
      status: 'submitted',
      rowVersion: 2,
    });
    expect(repo.getArtifactByAttempt(proposed.id, 'media_submission')).toMatchObject({
      id: 'media-submission-1',
      metadata: {
        taskListId: 'list-media',
        taskId: 'task-media',
        attemptId: proposed.id,
        providerId: 'image-provider',
        modelId: 'image-model',
        promptAssemblyId: 'assembly-1',
        promptHash: '7'.repeat(64),
        idempotencyKey: proposed.idempotencyKey,
      },
    });
    expect(
      repo.beginMediaSubmission({
        attemptId: proposed.id,
        expectedAttemptRowVersion: 0,
        promptAssemblyId: assembled.id,
        expectedPromptAssemblyRowVersion: assembled.rowVersion,
        artifactId: 'media-submission-1',
        submissionStartedAt: 160,
      }),
    ).toMatchObject({ created: false, attempt: { status: 'submitting' } });

    const assetEntry = index.repos.assets.insert({
      hash: ASSET_HASH,
      type: 'image',
      format: 'png',
      displayName: 'Generated frame',
      tags: [],
      createdAt: 170,
      fileSize: 1,
    });
    const ready = repo.recordMediaOutput({
      attemptId: proposed.id,
      expectedAttemptRowVersion: begun.attempt.rowVersion,
      model: 'image-model',
      providerJobId: 'job-1',
      providerReceipt: 'receipt-1',
      reportedActualCostUsd: 0.2,
      assetReadyAt: 170,
      artifact: {
        id: 'media-output-1',
        taskListId: 'list-media',
        taskId: 'task-media',
        attemptId: proposed.id,
        artifactType: 'media_output',
        entityType: 'canvas-node',
        entityId: 'shot-1',
        assetHash: ASSET_HASH,
        metadata: {
          taskListId: 'list-media',
          taskId: 'task-media',
          attemptId: proposed.id,
          providerId: 'image-provider',
          modelId: 'image-model',
          promptAssemblyId: 'assembly-1',
          promptHash: '7'.repeat(64),
          idempotencyKey: proposed.idempotencyKey,
          providerReceipt: 'receipt-1',
          assetEntryId: assetEntry.id,
          contentHash: ASSET_HASH,
        },
        createdAt: 170,
      },
    }).attempt;
    const evaluating = repo.transitionProductionMediaAttempt({
      id: proposed.id,
      expectedRowVersion: ready.rowVersion,
      expectedStatuses: ['asset_ready'],
      status: 'evaluating',
      updatedAt: 180,
    });
    const recorded = repo.recordTaskEvaluation({
      evaluation: mediaEvaluation(),
      expectedAttemptRowVersion: evaluating.rowVersion,
      expectedAttemptStatuses: ['evaluating'],
      resultingAttemptStatus: 'accepted',
      evaluatedAt: 200,
    });
    expect(recorded).toMatchObject({
      created: true,
      attempt: { status: 'accepted', taskId: 'task-media', assetHash: ASSET_HASH },
      evaluation: { kind: 'production_media', verdict: 'pass', total: 93 },
    });
    expect(repo.getTaskCostSummary('list-media')).toEqual({
      attemptCount: 1,
      regenerationCount: 0,
      estimatedCostUsd: 0.25,
      reportedActualCostUsd: 0.2,
      committedCostUsd: 0.2,
      hasUnreportedActualCosts: false,
    });

    index.close();
    const reopened = new SqliteIndex(dbPath);
    indexes.push(reopened);
    expect(
      reopened.repos.taskLists.getLatestProductionMediaAttempt('list-media', 'shot-1'),
    ).toMatchObject({
      id: 'media-attempt-1',
      status: 'accepted',
      rowVersion: 4,
      promptAssemblyId: 'assembly-1',
      scope: 'production',
    });
    expect(reopened.repos.taskLists.getTaskEvaluation('media-attempt-1')).toMatchObject({
      id: 'evaluation-1',
      taskListId: 'list-media',
      assetHash: ASSET_HASH,
      artifactId: 'media-output-1',
      sourcePromptHash: '7'.repeat(64),
    });
  });

  it('rejects media artifacts without exact attempt lineage', () => {
    const { index } = open('lucid-task-media-artifact-');
    expect(() =>
      index.repos.taskLists.insertArtifact({
        id: 'unbound-output',
        taskListId: 'missing-list',
        taskId: 'missing-task',
        artifactType: 'media_output',
        assetHash: ASSET_HASH,
        metadata: {},
        createdAt: 1,
      }),
    ).toThrow(/attempt/i);
  });

  it('reserves, completes, and restores an approved Delivery package attempt', () => {
    const { index, dbPath, root } = open('lucid-task-export-');
    const repo = index.repos.taskLists;
    repo.insertTaskList(
      makeTaskList('list-export', {
        progress: 90,
        currentPhaseKey: 'delivery',
        currentTaskId: 'task-export',
      }),
    );
    repo.insertTask(
      makeTask('task-export', 'list-export', 'delivery', 5, 'delivery', 'delivery'),
    );
    approve(
      index,
      'list-export',
      'delivery',
      'delivery-manifest',
      PLAN_HASH,
      'event-export-approved',
    );
    const proposed: DeliveryPackageTaskAttempt = {
      kind: 'batch_export',
      id: 'export-attempt-1',
      taskListId: 'list-export',
      taskId: 'task-export',
      manifestRevision: 1,
      manifestHash: PLAN_HASH,
      idempotencyKey: '8'.repeat(64),
      status: 'queued',
      rowVersion: 0,
      destinationPath: path.join(root, 'delivery-package'),
      attempt: 1,
      createdAt: 140,
      updatedAt: 140,
    };
    expect(repo.reserveDeliveryPackageAttempt({ attempt: proposed })).toMatchObject({
      created: true,
      attempt: { id: proposed.id, kind: 'batch_export', taskId: 'task-export' },
    });
    expect(repo.reserveDeliveryPackageAttempt({ attempt: proposed })).toMatchObject({
      created: false,
      attempt: { id: proposed.id },
    });
    const running = repo.transitionDeliveryPackageAttempt({
      id: proposed.id,
      expectedRowVersion: 0,
      expectedStatuses: ['queued'],
      status: 'running',
      stagingPath: path.join(root, 'staging.mp4'),
      updatedAt: 150,
    });
    const ready = repo.transitionDeliveryPackageAttempt({
      id: proposed.id,
      expectedRowVersion: running.rowVersion,
      expectedStatuses: ['running'],
      status: 'ready_to_publish',
      packageHash: OUTPUT_HASH,
      packageBytes: 42,
      fileCount: 1,
      updatedAt: 160,
    });
    const taskList = repo.getTaskList('list-export');
    if (!taskList) throw new Error('Task List disappeared');
    expect(
      repo.completeDeliveryPackageAttempt({
        id: proposed.id,
        expectedExecutionRowVersion: ready.rowVersion,
        expectedTaskListRowVersion: taskList.rowVersion ?? -1,
        packageHash: OUTPUT_HASH,
        packageBytes: 42,
        fileCount: 1,
        completedAt: 170,
        taskListOutput: {
          delivery: {
            manifestRevision: 1,
            manifestHash: PLAN_HASH,
            packageHash: OUTPUT_HASH,
          },
        },
        event: {
          taskListId: 'list-export',
          eventId: 'event-export-completed',
          actor: 'system',
          payload: { type: 'task_list.delivery.completed', attemptId: proposed.id },
          timestamp: 170,
        },
      }),
    ).toMatchObject({
      attempt: { status: 'completed', packageHash: OUTPUT_HASH, rowVersion: 3 },
      taskList: { status: 'completed', progress: 100, currentTaskId: undefined },
      event: { seq: 2, eventId: 'event-export-completed' },
    });
    expect(
      index.rawDb.prepare('SELECT kind, COUNT(*) AS count FROM task_attempts GROUP BY kind').all(),
    ).toEqual([{ kind: 'batch_export', count: 1 }]);
    expect(repo.listArtifactsByTask('task-export')).toEqual([
      expect.objectContaining({
        attemptId: proposed.id,
        artifactType: 'delivery_package',
        path: proposed.destinationPath,
      }),
    ]);

    index.close();
    const reopened = new SqliteIndex(dbPath);
    indexes.push(reopened);
    expect(reopened.repos.taskLists.getLatestDeliveryPackageAttempt('list-export')).toMatchObject({
      id: proposed.id,
      status: 'completed',
      packageBytes: 42,
    });
    expect(reopened.repos.taskLists.getTaskList('list-export')).toMatchObject({
      status: 'completed',
      output: {
        delivery: expect.objectContaining({ packageHash: OUTPUT_HASH }),
      },
    });
    expect(reopened.repos.taskLists.listTaskSummaries({ taskListId: 'list-export' })).toEqual([
      expect.objectContaining({
        id: 'task-export',
        producedArtifacts: [
          expect.objectContaining({
            artifactType: 'delivery_package',
            path: proposed.destinationPath,
          }),
        ],
      }),
    ]);
  });
});
