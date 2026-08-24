import type {
  Canvas,
  ProductionMediaTaskAttempt,
  Task,
  TaskList,
} from '@lucid-fin/contracts';
import { TaskStatus } from '@lucid-fin/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMediaTaskHandler } from './media-task-handler.js';

const generationMocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  build: vi.fn(),
}));

vi.mock('../ipc/handlers/generation-context.js', () => ({
  prepareGenerationPromptAssembly: generationMocks.prepare,
  buildGenerationContext: generationMocks.build,
}));

describe('createMediaTaskHandler', () => {
  beforeEach(() => {
    generationMocks.prepare.mockReset();
    generationMocks.build.mockReset();
  });

  it('prepares a durable Commander Prompt Assembly before any provider submission', async () => {
    generationMocks.prepare.mockResolvedValue({ promptAssemblyId: 'assembly-1' });
    const fixture = createFixture();

    const result = await fixture.handler.execute(fixture.context);

    expect(result).toMatchObject({
      status: TaskStatus.AwaitingProvider,
      currentStep: 'awaiting_prompt_assembly',
      output: { promptAssemblyId: 'assembly-1' },
    });
    expect(generationMocks.prepare).toHaveBeenCalledWith(
      fixture.generationDeps,
      expect.objectContaining({
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        requestedProviderId: 'image-provider',
        promptAssemblyAuthority: {
          kind: 'task-list',
          taskListId: 'task-list-1',
          taskId: 'task-1',
        },
      }),
    );
    expect(fixture.advance).not.toHaveBeenCalled();
  });

  it('waits for background evaluation after the provider output is durable', async () => {
    const attempt = makeAttempt('asset_ready');
    const fixture = createFixture(attempt);

    const result = await fixture.handler.recover!(fixture.context);

    expect(result).toMatchObject({
      status: TaskStatus.AwaitingProvider,
      currentStep: 'awaiting_evaluation',
      output: { attemptId: attempt.id, assetHash: 'asset-hash-1' },
    });
    expect(fixture.advance).not.toHaveBeenCalled();
    expect(fixture.canvasStore.save).not.toHaveBeenCalled();
  });

  it('attaches only an accepted evaluated asset and completes the Task', async () => {
    const attempt = makeAttempt('accepted');
    const fixture = createFixture(attempt);

    const result = await fixture.handler.recover!(fixture.context);

    expect(result).toMatchObject({
      status: TaskStatus.Completed,
      progress: 100,
      assetId: 'asset-entry-1',
      output: { attemptId: attempt.id, attemptStatus: 'accepted' },
    });
    expect(fixture.canvas.nodes[0]?.data).toMatchObject({
      assetHash: 'asset-hash-1',
      variants: ['asset-hash-1'],
      status: 'done',
      providerId: 'image-provider',
    });
    expect(fixture.canvasStore.save).toHaveBeenCalledTimes(1);
    expect(fixture.advance).not.toHaveBeenCalled();
  });
});

function createFixture(latest?: ProductionMediaTaskAttempt) {
  const canvas: Canvas = {
    id: 'canvas-1',
    name: 'Canvas',
    nodes: [
      {
        id: 'node-1',
        type: 'image',
        title: 'Image',
        position: { x: 0, y: 0 },
        data: { prompt: 'user idea', variants: [], status: 'idle' },
        createdAt: 10,
        updatedAt: 10,
      },
    ],
    edges: [],
    settings: {},
    createdAt: 10,
    updatedAt: 10,
  } as Canvas;
  const canvasStore = {
    get: vi.fn(() => canvas),
    save: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(() => []),
    listFull: vi.fn(() => [canvas]),
  };
  const getLatestProductionMediaAttempt = vi.fn(() => latest);
  const taskListRepo = {
    getLatestProductionMediaAttempt,
    getProductionMediaAttempt: vi.fn(),
    getTaskEvaluation: vi.fn(() =>
      latest?.status === 'accepted'
        ? {
            id: 'evaluation-1',
            verdict: 'pass',
            total: 90,
          }
        : undefined,
    ),
    getArtifactByAttempt: vi.fn(() => ({
      id: 'artifact-1',
      assetHash: 'asset-hash-1',
      metadata: { assetEntryId: 'asset-entry-1' },
    })),
    reserveProductionMediaAttempt: vi.fn(),
  };
  const generationDeps = {
    db: { repos: { taskLists: taskListRepo } },
    canvasStore,
    promptAssemblyService: { get: vi.fn() },
  } as never;
  const advance = vi.fn(async (attemptId: string) => {
    if (!latest || latest.id !== attemptId) throw new Error('unexpected attempt');
    return latest;
  });
  const handler = createMediaTaskHandler({
    generationDeps,
    mediaGenerationService: { advance, cancel: vi.fn() },
    now: () => 20,
  });
  const taskList = {
    id: 'task-list-1',
    taskListType: 'media.generation.v1',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status: 'running',
    summary: 'media',
    progress: 0,
    completedPhases: 0,
    totalPhases: 1,
    completedTasks: 0,
    totalTasks: 1,
    currentPhaseKey: 'generation',
    currentTaskId: 'task-1',
    input: {},
    output: {},
    metadata: {},
    createdAt: 10,
    updatedAt: 10,
    rowVersion: 1,
  } as TaskList;
  const task = {
    id: 'task-1',
    taskListId: taskList.id,
    phaseKey: 'generation',
    phaseName: 'Media generation',
    phaseOrder: 0,
    taskKey: 'generate-media',
    name: 'Generate media',
    kind: 'adapter_generation',
    status: TaskStatus.Running,
    dependencyIds: [],
    attempts: 1,
    maxRetries: 0,
    input: {
      handlerId: 'media.generate',
      taskRole: 'canvas_media',
      nodeId: 'node-1',
      providerId: 'image-provider',
    },
    output: {},
    progress: 0,
    updatedAt: 10,
  } as Task;
  return {
    handler,
    canvas,
    canvasStore,
    generationDeps,
    advance,
    context: {
      taskList,
      task,
      db: generationDeps.db,
    } as never,
  };
}

function makeAttempt(status: ProductionMediaTaskAttempt['status']): ProductionMediaTaskAttempt {
  return {
    kind: 'production_media',
    id: 'attempt-1',
    taskListId: 'task-list-1',
    taskId: 'task-1',
    canvasId: 'canvas-1',
    nodeId: 'node-1',
    attempt: 1,
    idempotencyKey: 'idempotency-1',
    specHash: 'spec-hash-1',
    scope: 'canvas',
    mediaType: 'image',
    status,
    rowVersion: 1,
    providerId: 'image-provider',
    promptAssemblyId: 'assembly-1',
    submissionPurpose: 'initial',
    model: 'image-model',
    prompt: 'final prompt',
    promptHash: 'prompt-hash',
    estimatedCostUsd: 0.2,
    assetHash: 'asset-hash-1',
    generationSpec: {
      specVersion: 3,
      scope: 'canvas',
      authority: { kind: 'task-list' },
      taskListId: 'task-list-1',
      taskId: 'task-1',
      canvasId: 'canvas-1',
      canvasUpdatedAt: 10,
      nodeId: 'node-1',
      nodeUpdatedAt: 10,
      task: { id: 'task-1', key: 'generate-media', role: 'canvas_media' },
      mediaType: 'image',
      operation: 'text-to-image',
      providerId: 'image-provider',
      modelId: 'image-model',
      promptAssemblyId: 'assembly-1',
      prompt: 'final prompt',
      promptHash: 'prompt-hash',
      referenceEvidence: [],
      request: { type: 'image', providerId: 'image-provider', prompt: 'final prompt' },
      limits: {
        maxAttemptsPerShot: 1,
        maxRegenerations: 0,
        maxTotalCostUsd: 0.2,
        styleAuditionCommittedCostUsd: 0,
      },
      lineage: { purpose: 'initial', variantIndex: 0, variantCount: 1 },
      createdAt: 10,
    },
    createdAt: 10,
    updatedAt: 10,
  };
}
