import type {
  AIProviderAdapter,
  GenerationRequest,
  ProductionMediaTaskAttempt,
  PromptAssemblyRecord,
  TaskArtifact,
} from '@lucid-fin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { MediaGenerationService } from './media-generation.service.js';

describe('MediaGenerationService', () => {
  it('submits the persisted prompt exactly once and binds the output artifact to the attempt', async () => {
    const fixture = createFixture();

    const result = await fixture.service.advance(fixture.attempt.id);

    expect(result.status).toBe('asset_ready');
    expect(result.assetHash).toBe('asset-hash-1');
    expect(fixture.adapter.generate).toHaveBeenCalledTimes(1);
    expect(fixture.adapter.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '  exact final prompt\nwith whitespace  ',
        negativePrompt: ' exact negative prompt ',
      }),
    );
    expect(fixture.events.slice(0, 2)).toEqual(['begin-submission', 'provider-generate']);
    expect(fixture.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attemptId: fixture.attempt.id,
          artifactType: 'media_submission',
        }),
        expect.objectContaining({
          attemptId: fixture.attempt.id,
          artifactType: 'media_output',
          assetHash: 'asset-hash-1',
        }),
      ]),
    );

    await fixture.service.advance(fixture.attempt.id);
    expect(fixture.adapter.generate).toHaveBeenCalledTimes(1);
  });

  it('marks an uncertain provider call ambiguous and never repeats it', async () => {
    const fixture = createFixture({ providerError: new Error('connection dropped') });

    const first = await fixture.service.advance(fixture.attempt.id);
    const second = await fixture.service.advance(fixture.attempt.id);

    expect(first.status).toBe('ambiguous');
    expect(first.error).toBe('connection dropped');
    expect(second.status).toBe('ambiguous');
    expect(fixture.adapter.generate).toHaveBeenCalledTimes(1);
  });

  it('fails before submission when the reserved adapter cannot be resolved', async () => {
    const fixture = createFixture({ resolveError: new Error('provider is not configured') });

    const result = await fixture.service.advance(fixture.attempt.id);

    expect(result.status).toBe('failed');
    expect(result.error).toBe('provider is not configured');
    expect(fixture.events).not.toContain('begin-submission');
    expect(fixture.adapter.generate).not.toHaveBeenCalled();
  });
});

function createFixture(options: { providerError?: Error; resolveError?: Error } = {}) {
  let currentAttempt = makeAttempt();
  let assembly = makeAssembly();
  const artifacts: TaskArtifact[] = [];
  const events: string[] = [];
  let id = 0;

  const adapter = {
    id: 'image-provider',
    name: 'Image provider',
    type: 'image',
    capabilities: ['text-to-image'],
    maxConcurrent: 1,
    configure: vi.fn(),
    validate: vi.fn(async () => true),
    generate: vi.fn(async (_request: GenerationRequest) => {
      events.push('provider-generate');
      if (options.providerError) throw options.providerError;
      return {
        assetHash: '',
        assetPath: 'memory://generated.png',
        provider: 'image-provider',
        cost: 0.2,
        metadata: { model: 'image-model', jobId: 'provider-job-1' },
      };
    }),
    estimateCost: vi.fn(() => ({
      provider: 'image-provider',
      estimatedCost: 0.2,
      currency: 'USD',
      unit: 'image',
    })),
    checkStatus: vi.fn(async () => 'completed'),
    cancel: vi.fn(async () => undefined),
  } as unknown as AIProviderAdapter;

  const taskLists = {
    getProductionMediaAttempt: vi.fn(() => currentAttempt),
    beginMediaSubmission: vi.fn(() => {
      events.push('begin-submission');
      assembly = { ...assembly, status: 'submitted', rowVersion: assembly.rowVersion + 1 };
      currentAttempt = {
        ...currentAttempt,
        status: 'submitting',
        rowVersion: currentAttempt.rowVersion + 1,
        submissionStartedAt: 200,
      };
      const artifact: TaskArtifact = {
        id: 'submission-artifact',
        taskListId: currentAttempt.taskListId,
        taskId: currentAttempt.taskId,
        attemptId: currentAttempt.id,
        artifactType: 'media_submission',
        metadata: {},
        createdAt: 200,
      };
      artifacts.push(artifact);
      return { attempt: currentAttempt, artifact, created: true };
    }),
    transitionProductionMediaAttempt: vi.fn(
      (input: Record<string, unknown>): ProductionMediaTaskAttempt => {
        currentAttempt = {
          ...currentAttempt,
          status: input.status as ProductionMediaTaskAttempt['status'],
          rowVersion: currentAttempt.rowVersion + 1,
          updatedAt: input.updatedAt as number,
          ...(typeof input.assetHash === 'string' ? { assetHash: input.assetHash } : {}),
          ...(typeof input.providerJobId === 'string'
            ? { providerJobId: input.providerJobId }
            : {}),
          ...(typeof input.providerReceipt === 'string'
            ? { providerReceipt: input.providerReceipt }
            : {}),
          ...(typeof input.reportedActualCostUsd === 'number'
            ? { reportedActualCostUsd: input.reportedActualCostUsd }
            : {}),
          ...(typeof input.model === 'string' ? { model: input.model } : {}),
          ...(typeof input.error === 'string' ? { error: input.error } : { error: undefined }),
        };
        return currentAttempt;
      },
    ),
    getArtifactByAttempt: vi.fn((attemptId: string, artifactType: string) =>
      artifacts.find(
        (artifact) => artifact.attemptId === attemptId && artifact.artifactType === artifactType,
      ),
    ),
    recordMediaOutput: vi.fn((input: Record<string, unknown>) => {
      const artifact = input.artifact as TaskArtifact;
      artifacts.push(artifact);
      currentAttempt = {
        ...currentAttempt,
        status: 'asset_ready',
        rowVersion: currentAttempt.rowVersion + 1,
        assetHash: artifact.assetHash,
        model: input.model as string,
        providerJobId: input.providerJobId as string | undefined,
        providerReceipt: input.providerReceipt as string,
        reportedActualCostUsd: input.reportedActualCostUsd as number | undefined,
        assetReadyAt: input.assetReadyAt as number,
        updatedAt: input.assetReadyAt as number,
      };
      return { attempt: currentAttempt, artifact, created: true };
    }),
  };

  const service = new MediaGenerationService({
    db: {
      repos: {
        taskLists,
        assets: {
          insert: vi.fn(() => ({ id: 'asset-entry-1' })),
        },
      },
    } as never,
    cas: {
      importAsset: vi.fn(async () => ({
        ref: {
          hash: 'asset-hash-1',
          type: 'image',
          format: 'png',
          path: 'cas://asset-hash-1.png',
        },
        meta: {
          hash: 'asset-hash-1',
          type: 'image',
          format: 'png',
          originalName: 'generated.png',
          fileSize: 123,
          tags: [],
          createdAt: 200,
        },
      })),
      getAssetPath: vi.fn(() => 'reference.png'),
    } as never,
    promptAssemblyService: { get: vi.fn(() => assembly) },
    resolveAdapter: async () => {
      if (options.resolveError) throw options.resolveError;
      return adapter;
    },
    materialize: vi.fn(async () => ({ filePath: 'generated.png' })),
    probe: vi.fn(async () => ({ width: 1024, height: 1024 })),
    now: () => 200,
    idFactory: () => `artifact-${++id}`,
  });

  return {
    service,
    adapter,
    attempt: currentAttempt,
    artifacts,
    events,
  };
}

function makeAssembly(): PromptAssemblyRecord {
  return {
    id: 'assembly-1',
    canvasId: 'canvas-1',
    nodeId: 'node-1',
    nodeUpdatedAt: 10,
    mediaType: 'image',
    mode: 'text-to-image',
    purpose: 'initial',
    taskListId: 'task-list-1',
    taskId: 'task-1',
    inputHash: 'input-hash',
    input: {
      version: 1,
      assemblyId: 'assembly-1',
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      nodeUpdatedAt: 10,
      mediaType: 'image',
      mode: 'text-to-image',
      purpose: 'initial',
      authority: { kind: 'task-list', taskListId: 'task-list-1', taskId: 'task-1' },
      sources: [],
      conditioningManifest: [],
      providerProfile: {
        providerId: 'image-provider',
        model: 'image-model',
        capabilities: ['text-to-image'],
      },
      hostConstraints: { immutable: [] },
      inputHash: 'input-hash',
    },
    output: {
      version: 1,
      assemblyId: 'assembly-1',
      inputHash: 'input-hash',
      finalPrompt: '  exact final prompt\nwith whitespace  ',
      negativePrompt: ' exact negative prompt ',
      sourceDecisions: [],
      summary: 'assembled',
      warnings: [],
    },
    status: 'assembled',
    rowVersion: 1,
    createdAt: 100,
    assembledAt: 150,
    updatedAt: 150,
  };
}

function makeAttempt(): ProductionMediaTaskAttempt {
  const request: GenerationRequest = {
    type: 'image',
    providerId: 'image-provider',
    prompt: '  exact final prompt\nwith whitespace  ',
    negativePrompt: ' exact negative prompt ',
    width: 1024,
    height: 1024,
  };
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
    status: 'reserved',
    rowVersion: 0,
    providerId: 'image-provider',
    promptAssemblyId: 'assembly-1',
    submissionPurpose: 'initial',
    model: 'image-model',
    prompt: request.prompt,
    promptHash: 'prompt-hash-1',
    negativePrompt: request.negativePrompt,
    estimatedCostUsd: 0.2,
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
      prompt: request.prompt,
      promptHash: 'prompt-hash-1',
      negativePrompt: request.negativePrompt,
      referenceEvidence: [],
      request,
      limits: {
        maxAttemptsPerShot: 1,
        maxRegenerations: 0,
        maxTotalCostUsd: 1,
        styleAuditionCommittedCostUsd: 0,
      },
      lineage: { purpose: 'initial', variantIndex: 0, variantCount: 1 },
      createdAt: 100,
    },
    createdAt: 100,
    updatedAt: 100,
  };
}
