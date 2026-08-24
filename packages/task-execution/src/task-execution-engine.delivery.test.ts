import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  PlanApprovalGateKey,
  TaskListStatus,
  TaskStatus,
  type DeliveryManifestContent,
  type PlanApproval,
  type PlanDocument,
} from '@lucid-fin/contracts';
import { TaskExecutionEngine } from './task-execution-engine.js';
import { TaskListRegistry } from './task-list-registry.js';

const CANVAS_ID = 'canvas-1';
const TASK_LIST_ID = 'task-list-1';
const FIRST_HASH = createHash('sha256').update('first-video').digest('hex');
const SECOND_HASH = createHash('sha256').update('second-video').digest('hex');

function approvedDocument(
  logicalKey: string,
  id: string,
  revision: number,
  contentHash: string,
): PlanDocument {
  return {
    id,
    taskListId: TASK_LIST_ID,
    logicalKey,
    documentType: logicalKey.replaceAll('-', '_'),
    revision,
    schemaVersion: 1,
    content: {},
    contentHash,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  };
}

function approvedGate(document: PlanDocument, gateKey: PlanApprovalGateKey): PlanApproval {
  return {
    id: `${gateKey}-approval`,
    taskListId: TASK_LIST_ID,
    gateKey,
    subjectLogicalKey: document.logicalKey,
    subjectRevision: document.revision,
    subjectHash: document.contentHash,
    manifestHash: document.contentHash,
    resumeTokenHash: createHash('sha256').update(`${gateKey}-token`).digest('hex'),
    status: 'approved',
    createdAt: 2,
    updatedAt: 2,
  };
}

function createFixture() {
  const productionPlan = approvedDocument(
    'production-plan',
    'plan-1',
    3,
    'a'.repeat(64),
  );
  const visualConstitution = approvedDocument(
    'visual-constitution',
    'constitution-1',
    2,
    'b'.repeat(64),
  );
  const productionPlanApproval = approvedGate(
    productionPlan,
    PlanApprovalGateKey.ProductionPlan,
  );
  const visualConstitutionApproval = approvedGate(
    visualConstitution,
    PlanApprovalGateKey.VisualConstitution,
  );
  let taskList = {
    id: TASK_LIST_ID,
    taskListType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: CANVAS_ID,
    status: TaskListStatus.Ready,
    rowVersion: 7,
    currentPhaseKey: 'delivery',
    currentTaskId: 'delivery-task',
    currentGate: undefined as PlanApprovalGateKey | undefined,
    metadata: {},
  };
  const deliveryTask = {
    id: 'delivery-task',
    taskListId: TASK_LIST_ID,
    taskKey: 'delivery',
    phaseKey: 'delivery',
    status: TaskStatus.Ready,
    input: { taskRole: 'delivery' },
  };
  const canvas = {
    id: CANVAS_ID,
    deliverySequence: {
      revision: 4,
      items: [
        {
          shotId: '002',
          selectedVideoHash: SECOND_HASH,
          trimInMs: 250,
          trimOutMs: 5_750,
          embeddedAudioEnabled: true,
        },
        {
          shotId: '001',
          selectedVideoHash: FIRST_HASH,
          trimInMs: 0,
          trimOutMs: 6_000,
          embeddedAudioEnabled: false,
        },
      ],
      updatedAt: 10,
    },
    nodes: [
      {
        id: 'node-001',
        type: 'video',
        bypassed: false,
        updatedAt: 10,
        data: { assetHash: FIRST_HASH, variants: [FIRST_HASH], selectedVariantIndex: 0 },
      },
      {
        id: 'node-002',
        type: 'video',
        bypassed: false,
        updatedAt: 20,
        data: { assetHash: SECOND_HASH, variants: [SECOND_HASH], selectedVariantIndex: 0 },
      },
    ],
  };
  const attemptFor = (shotId: string, nodeId: string, assetHash: string, updatedAt: number) => ({
    kind: 'production_media',
    id: `attempt-${shotId}`,
    taskListId: TASK_LIST_ID,
    taskId: `media-${shotId}`,
    canvasId: CANVAS_ID,
    nodeId,
    status: 'accepted',
    mediaType: 'video',
    assetHash,
    promptAssemblyId: `assembly-${shotId}`,
    prompt: `Exact prompt ${shotId}`,
    promptHash: createHash('sha256').update(`prompt-${shotId}`).digest('hex'),
    providerId: 'video-provider',
    model: 'video-model',
    generationSpec: {
      authority: {
        kind: 'task-list-approved',
        planId: productionPlan.id,
        planHash: productionPlan.contentHash,
        constitutionId: visualConstitution.id,
        constitutionHash: visualConstitution.contentHash,
      },
      task: { shotId },
      nodeUpdatedAt: updatedAt,
    },
  });
  const attempts = [
    attemptFor('001', 'node-001', FIRST_HASH, 10),
    attemptFor('002', 'node-002', SECOND_HASH, 20),
  ];
  const evaluations = attempts.map((attempt) => ({
    id: `evaluation-${attempt.id}`,
    attemptId: attempt.id,
    verdict: 'pass',
    assetHash: attempt.assetHash,
    canvasId: CANVAS_ID,
    nodeId: attempt.nodeId,
    mediaType: 'video',
    sourcePromptHash: attempt.promptHash,
  }));
  const assets = new Map(
    attempts.map((attempt, index) => [
      attempt.assetHash,
      {
        hash: attempt.assetHash,
        type: 'video',
        format: 'mp4',
        originalName: `${attempt.assetHash}.mp4`,
        fileSize: 2_000_000 + index,
        width: 1920,
        height: 1080,
        duration: 6,
        hasAudio: index === 1,
        createdAt: 100 + index,
        generationMetadata: {
          prompt: attempt.prompt,
          provider: attempt.providerId,
          model: attempt.model,
          taskListId: TASK_LIST_ID,
          taskId: attempt.taskId,
          attemptId: attempt.id,
          promptAssemblyId: attempt.promptAssemblyId,
          promptHash: attempt.promptHash,
        },
      },
    ]),
  );
  const assemblies = new Map(
    attempts.map((attempt) => [
      attempt.promptAssemblyId,
      {
        id: attempt.promptAssemblyId,
        canvasId: CANVAS_ID,
        nodeId: attempt.nodeId,
        taskListId: TASK_LIST_ID,
        taskId: attempt.taskId,
        input: { providerProfile: { providerId: attempt.providerId } },
        output: { finalPrompt: attempt.prompt },
      },
    ]),
  );
  const artifacts = new Map(
    attempts.map((attempt) => [
      attempt.id,
      {
        id: `output-${attempt.id}`,
        taskListId: TASK_LIST_ID,
        taskId: attempt.taskId,
        attemptId: attempt.id,
        artifactType: 'media_output',
        entityType: 'canvas-node',
        entityId: attempt.nodeId,
        assetHash: attempt.assetHash,
        metadata: {
          taskListId: TASK_LIST_ID,
          taskId: attempt.taskId,
          attemptId: attempt.id,
          providerId: attempt.providerId,
          modelId: attempt.model,
          promptAssemblyId: attempt.promptAssemblyId,
          promptHash: attempt.promptHash,
          assetEntryId: `entry-${attempt.id}`,
          contentHash: attempt.assetHash,
        },
      },
    ]),
  );
  const entries = new Map([
    [
      'entry-attempt-001',
      { id: 'entry-attempt-001', hash: FIRST_HASH, displayName: 'Wide Arrival.mp4' },
    ],
    [
      'entry-attempt-002',
      { id: 'entry-attempt-002', hash: SECOND_HASH, displayName: 'Close-Up Final.mp4' },
    ],
  ]);
  let deliveryDocument: PlanDocument | undefined;
  let deliveryApproval: PlanApproval | undefined;
  const repo = {
    getTaskList: vi.fn(() => taskList),
    getTask: vi.fn(() => deliveryTask),
    listProductionMediaAttempts: vi.fn(() => attempts),
    listTaskEvaluations: vi.fn(() => evaluations),
    getArtifactByAttempt: vi.fn((attemptId: string) => artifacts.get(attemptId)),
    getLatestDocument: vi.fn((_taskListId: string, logicalKey: string) =>
      logicalKey === 'delivery-manifest' ? deliveryDocument : undefined,
    ),
    getLatestApproval: vi.fn((_taskListId: string, gateKey: PlanApprovalGateKey) => {
      if (gateKey === PlanApprovalGateKey.ProductionPlan) return productionPlanApproval;
      if (gateKey === PlanApprovalGateKey.VisualConstitution) return visualConstitutionApproval;
      return deliveryApproval;
    }),
    getDocumentRevision: vi.fn(
      (_taskListId: string, logicalKey: string, revision: number) => {
        if (logicalKey === productionPlan.logicalKey && revision === productionPlan.revision) {
          return productionPlan;
        }
        if (
          logicalKey === visualConstitution.logicalKey &&
          revision === visualConstitution.revision
        ) {
          return visualConstitution;
        }
        if (logicalKey === deliveryDocument?.logicalKey && revision === deliveryDocument.revision) {
          return deliveryDocument;
        }
        return undefined;
      },
    ),
    createApprovalGateRevision: vi.fn(
      ({ document, approval }: { document: PlanDocument; approval: PlanApproval }) => {
        deliveryDocument = document;
        deliveryApproval = approval;
        taskList = {
          ...taskList,
          status: TaskListStatus.AwaitingApproval,
          rowVersion: taskList.rowVersion + 1,
          currentGate: PlanApprovalGateKey.Delivery,
        };
      },
    ),
    getLatestDeliveryPackageAttempt: vi.fn(() => undefined),
  };
  const db = {
    repos: {
      taskLists: repo,
      canvases: { get: vi.fn(() => canvas) },
      assets: {
        findByHashes: vi.fn(() => assets),
        findEntryById: vi.fn((id: string) => entries.get(id)),
      },
      promptAssemblies: { get: vi.fn((id: string) => assemblies.get(id)) },
    },
  };
  const engine = new TaskExecutionEngine({
    db: db as never,
    registry: new TaskListRegistry(),
    handlers: [],
    idFactory: (() => {
      let id = 0;
      return () => `delivery-id-${++id}`;
    })(),
    now: () => 1_000,
  });
  return {
    engine,
    canvas,
    artifacts,
    entries,
    repo,
    taskList: () => taskList,
    deliveryDocument: () => deliveryDocument,
    approveDelivery: () => {
      if (!deliveryApproval || !deliveryDocument) throw new Error('Delivery was not prepared');
      deliveryApproval = { ...deliveryApproval, status: 'approved', updatedAt: 2_000 };
      taskList = {
        ...taskList,
        status: TaskListStatus.Ready,
        rowVersion: taskList.rowVersion + 1,
        currentGate: undefined,
      };
    },
  };
}

describe('TaskExecutionEngine Delivery manifest', () => {
  it('derives readable, ordered, stable package names from exact asset-entry lineage', () => {
    const fixture = createFixture();
    const prepared = fixture.engine.prepareDeliveryManifest({
      taskListId: TASK_LIST_ID,
      canvasId: CANVAS_ID,
      expectedRowVersion: 7,
      packageBaseName: ' Signal: Master ',
    });

    expect(prepared).toMatchObject({
      created: true,
      context: {
        taskList: { currentGate: PlanApprovalGateKey.Delivery },
        approval: { gateKey: PlanApprovalGateKey.Delivery, subjectRevision: 1 },
        manifest: {
          logicalKey: 'delivery-manifest',
          documentType: 'delivery_manifest',
          content: {
            namingPolicy: {
              packageBaseName: 'Signal-Master',
              orderPrefixWidth: 3,
              overwritePolicy: 'fail',
            },
            items: [
              {
                shotId: '002',
                selectedVideoHash: SECOND_HASH,
                sourceFileName: 'Close-Up Final.mp4',
                packageFileName: '001_Close-Up-Final_002.mp4',
                provenance: {
                  nodeId: 'node-002',
                  attemptId: 'attempt-002',
                  evaluationId: 'evaluation-attempt-002',
                  promptAssemblyId: 'assembly-002',
                },
              },
              {
                shotId: '001',
                selectedVideoHash: FIRST_HASH,
                sourceFileName: 'Wide Arrival.mp4',
                packageFileName: '002_Wide-Arrival_001.mp4',
              },
            ],
          },
        },
      },
    });
    expect(
      (prepared.context.manifest.content as DeliveryManifestContent).items[0]?.packageFileName,
    ).not.toContain(SECOND_HASH);
    expect(fixture.repo.getLatestDeliveryPackageAttempt).toHaveBeenCalledOnce();

    const repeated = fixture.engine.prepareDeliveryManifest({
      taskListId: TASK_LIST_ID,
      canvasId: CANVAS_ID,
      expectedRowVersion: fixture.taskList().rowVersion,
      packageBaseName: 'Signal-Master',
    });
    expect(repeated).toMatchObject({ created: false, context: { manifest: { revision: 1 } } });
    expect(repeated.context.manifest.content).toEqual(prepared.context.manifest.content);
  });

  it('re-derives and canonically compares the exact approved Delivery state', () => {
    const fixture = createFixture();
    fixture.engine.prepareDeliveryManifest({
      taskListId: TASK_LIST_ID,
      canvasId: CANVAS_ID,
      expectedRowVersion: 7,
      packageBaseName: 'Signal Master',
    });
    fixture.approveDelivery();

    expect(fixture.engine.requireApprovedDeliveryManifest(TASK_LIST_ID, CANVAS_ID)).toBe(
      fixture.deliveryDocument(),
    );
    fixture.canvas.deliverySequence.items[0]!.trimInMs = 500;
    expect(() =>
      fixture.engine.requireApprovedDeliveryManifest(TASK_LIST_ID, CANVAS_ID),
    ).toThrow(/no longer matches the approved manifest/i);
  });

  it('fails closed when media-output asset-entry lineage is missing or inconsistent', () => {
    const missing = createFixture();
    missing.entries.delete('entry-attempt-002');
    expect(() =>
      missing.engine.prepareDeliveryManifest({
        taskListId: TASK_LIST_ID,
        canvasId: CANVAS_ID,
        expectedRowVersion: 7,
        packageBaseName: 'Signal Master',
      }),
    ).toThrow(/asset entry lineage/i);

    const inconsistent = createFixture();
    inconsistent.artifacts.get('attempt-002')!.metadata.contentHash = FIRST_HASH;
    expect(() =>
      inconsistent.engine.prepareDeliveryManifest({
        taskListId: TASK_LIST_ID,
        canvasId: CANVAS_ID,
        expectedRowVersion: 7,
        packageBaseName: 'Signal Master',
      }),
    ).toThrow(/media output lineage/i);
  });
});
