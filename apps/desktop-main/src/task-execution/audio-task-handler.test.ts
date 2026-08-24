import { describe, expect, it, vi } from 'vitest';
import type {
  AIProviderAdapter,
  PromptAssemblyRecord,
  Task,
  TaskExecutionAttempt,
  TaskList,
} from '@lucid-fin/contracts';
import { JobStatus, TaskStatus } from '@lucid-fin/contracts';
import type { TaskExecutionContext } from '@lucid-fin/application';
import { createAudioTaskHandler } from './audio-task-handler.js';

describe('audio.generate TaskList handler', () => {
  it('waits for Commander Prompt Assembly and submits the exact final prompt once', async () => {
    const fixture = createFixture();
    const first = await fixture.handler.execute(fixture.context);

    expect(first).toMatchObject({
      status: TaskStatus.AwaitingProvider,
      currentStep: 'awaiting_prompt_assembly',
    });
    expect(fixture.prepare).toHaveBeenCalledTimes(1);
    expect(fixture.adapter.generate).not.toHaveBeenCalled();

    fixture.assembly.status = 'assembled';
    fixture.assembly.output = {
      version: 1,
      assemblyId: fixture.assembly.id,
      inputHash: fixture.assembly.inputHash,
      finalPrompt: 'exact commander audio prompt',
      sourceDecisions: [],
      summary: 'assembled',
      warnings: [],
    };

    const completed = await fixture.handler.recover(fixture.context);
    expect(fixture.adapter.generate).toHaveBeenCalledTimes(1);
    expect(fixture.adapter.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'music',
        providerId: 'suno-v4',
        prompt: 'exact commander audio prompt',
      }),
    );
    expect(completed).toMatchObject({
      status: TaskStatus.Completed,
      output: { assetHash: 'cas-audio-hash', promptAssemblyId: fixture.assembly.id },
    });
    expect(fixture.artifacts).toHaveLength(1);
    expect(fixture.artifacts[0]).toMatchObject({
      artifactType: 'audio',
      assetHash: 'cas-audio-hash',
      metadata: {
        attemptId: fixture.attempts[0].id,
        promptAssemblyId: fixture.assembly.id,
      },
    });

    await fixture.handler.recover(fixture.context);
    expect(fixture.adapter.generate).toHaveBeenCalledTimes(1);
    expect(fixture.assets).toHaveLength(1);
    expect(fixture.artifacts).toHaveLength(1);
  });

  it('recovers an asynchronous provider job without submitting it twice', async () => {
    const fixture = createFixture({ asynchronous: true });
    await fixture.handler.execute(fixture.context);
    fixture.assembly.status = 'assembled';
    fixture.assembly.output = {
      version: 1,
      assemblyId: fixture.assembly.id,
      inputHash: fixture.assembly.inputHash,
      finalPrompt: 'durable music prompt',
      sourceDecisions: [],
      summary: 'assembled',
      warnings: [],
    };

    const submitted = await fixture.handler.recover(fixture.context);
    expect(submitted).toMatchObject({
      status: TaskStatus.AwaitingProvider,
      currentStep: 'awaiting_provider',
    });
    const completed = await fixture.handler.recover(fixture.context);
    expect(completed.status).toBe(TaskStatus.Completed);
    expect(fixture.adapter.generate).toHaveBeenCalledTimes(1);
    expect(fixture.adapter.checkStatus).toHaveBeenCalledWith('provider-job-1');
    expect(fixture.adapter.getResult).toHaveBeenCalledWith('provider-job-1');
    expect(fixture.attempts[0]).toMatchObject({
      status: TaskStatus.Completed,
      providerJobId: 'provider-job-1',
      assetHash: 'cas-audio-hash',
    });

    await fixture.handler.recover(fixture.context);
    expect(fixture.adapter.generate).toHaveBeenCalledTimes(1);
    expect(fixture.adapter.getResult).toHaveBeenCalledTimes(1);
  });
});

function createFixture(options: { asynchronous?: boolean } = {}) {
  const attempts: TaskExecutionAttempt[] = [];
  const artifacts: Array<Record<string, unknown>> = [];
  const assets: Array<Record<string, unknown>> = [];
  const assembly = makeAssembly();
  const prepare = vi.fn(() => assembly);
  const adapter = {
    id: 'suno-v4',
    name: 'Suno',
    type: 'music',
    capabilities: ['text-to-music'],
    maxConcurrent: 1,
    configure: vi.fn(),
    validate: vi.fn(async () => true),
    generate: vi.fn(async () =>
      options.asynchronous
        ? { assetHash: '', assetPath: '', provider: 'suno-v4', metadata: { id: 'provider-job-1' } }
        : { assetHash: '', assetPath: 'memory://audio', provider: 'suno-v4' },
    ),
    getResult: vi.fn(async () => ({
      assetHash: '',
      assetPath: 'memory://audio',
      provider: 'suno-v4',
    })),
    estimateCost: vi.fn(() => ({
      provider: 'suno-v4',
      estimatedCost: 0.1,
      currency: 'USD',
      unit: 'track',
    })),
    checkStatus: options.asynchronous
      ? vi.fn().mockResolvedValueOnce(JobStatus.Running).mockResolvedValue(JobStatus.Completed)
      : vi.fn(async () => JobStatus.Completed),
    cancel: vi.fn(async () => undefined),
  } as unknown as AIProviderAdapter;
  const taskList: TaskList = {
    id: 'audio-list-1',
    taskListType: 'audio.production.v1',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status: 'running',
    summary: 'Audio production',
    progress: 0,
    completedPhases: 0,
    totalPhases: 1,
    completedTasks: 0,
    totalTasks: 1,
    currentPhaseKey: 'generation',
    currentTaskId: 'audio-task-1',
    input: {},
    output: {},
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
  };
  const task: Task = {
    id: 'audio-task-1',
    taskListId: taskList.id,
    phaseKey: 'generation',
    phaseName: 'Audio generation',
    phaseOrder: 0,
    taskKey: 'generate-audio',
    name: 'Generate audio',
    kind: 'adapter_generation',
    status: 'running',
    dependencyIds: [],
    attempts: 1,
    maxRetries: 1,
    input: {
      subtype: 'music',
      prompt: 'user music idea',
      providerId: 'suno-v4',
      duration: 20,
    },
    output: {},
    progress: 0,
    updatedAt: 1,
  };
  const taskLists = {
    reserveTaskAttempt: vi.fn(({ attempt }: { attempt: TaskExecutionAttempt }) => {
      const existing = attempts.find((item) => item.idempotencyKey === attempt.idempotencyKey);
      if (existing) return { attempt: existing, created: false };
      attempts.push({ ...attempt });
      return { attempt: attempts[0], created: true };
    }),
    listTaskAttempts: vi.fn(() => attempts),
    transitionTaskAttempt: vi.fn((input: Record<string, unknown>) => {
      const index = attempts.findIndex((attempt) => attempt.id === input.id);
      if (index < 0) throw new Error('attempt not found');
      const current = attempts[index];
      const next: TaskExecutionAttempt = {
        ...current,
        status: input.status as TaskExecutionAttempt['status'],
        rowVersion: current.rowVersion + 1,
        ...(input.output ? { output: input.output as Record<string, unknown> } : {}),
        ...(input.metadata ? { metadata: input.metadata as Record<string, unknown> } : {}),
        ...(typeof input.providerJobId === 'string'
          ? { providerJobId: input.providerJobId }
          : {}),
        ...(typeof input.assetHash === 'string' ? { assetHash: input.assetHash } : {}),
        ...(typeof input.error === 'string' ? { error: input.error } : {}),
        ...(typeof input.submittedAt === 'number' ? { submittedAt: input.submittedAt } : {}),
        ...(typeof input.assetReadyAt === 'number' ? { assetReadyAt: input.assetReadyAt } : {}),
        ...(typeof input.completedAt === 'number' ? { completedAt: input.completedAt } : {}),
        updatedAt: input.updatedAt as number,
      };
      attempts[index] = next;
      return next;
    }),
    insertArtifact: vi.fn((artifact: Record<string, unknown>) => artifacts.push(artifact)),
  };
  const context = {
    taskList,
    task,
    db: {
      repos: {
        taskLists,
        assets: {
          insert: vi.fn((asset: Record<string, unknown>) => {
            assets.push(asset);
            return { ...asset, id: 'asset-entry-1' };
          }),
        },
      },
    },
  } as unknown as TaskExecutionContext;
  const handler = createAudioTaskHandler({
    cas: {
      importAsset: vi.fn(async () => ({
        ref: {
          hash: 'cas-audio-hash',
          type: 'audio' as const,
          format: 'mp3',
          path: 'C:/cas/audio/cas-audio-hash.mp3',
        },
        meta: {
          hash: 'cas-audio-hash',
          type: 'audio' as const,
          format: 'mp3',
          originalName: 'generated.mp3',
          fileSize: 123,
          createdAt: 2,
        },
      })),
    },
    promptAssemblyService: {
      prepare,
      get: vi.fn(() => assembly),
      markSubmitted: vi.fn(() => ({ ...assembly, status: 'submitted' })),
      markFailed: vi.fn(() => ({ ...assembly, status: 'failed' })),
    },
    resolveAdapter: vi.fn(async () => adapter),
    now: (() => {
      let value = 10;
      return () => value++;
    })(),
    materialize: vi.fn(async () => ({ filePath: 'memory://audio' })),
  });

  return { adapter, artifacts, assets, assembly, attempts, context, handler, prepare };
}

function makeAssembly(): PromptAssemblyRecord {
  return {
    id: 'assembly-1',
    canvasId: 'canvas-1',
    nodeId: 'audio-task-1',
    nodeUpdatedAt: 1,
    mediaType: 'audio',
    mode: 'text-to-audio',
    purpose: 'initial',
    inputHash: 'input-hash',
    input: {
      version: 1,
      assemblyId: 'assembly-1',
      canvasId: 'canvas-1',
      nodeId: 'audio-task-1',
      nodeUpdatedAt: 1,
      mediaType: 'audio',
      mode: 'text-to-audio',
      purpose: 'initial',
      authority: { kind: 'task-list', taskListId: 'audio-list-1', taskId: 'audio-task-1' },
      sources: [],
      conditioningManifest: [],
      providerProfile: { providerId: 'suno-v4', capabilities: ['text-to-music'] },
      hostConstraints: { immutable: ['subtype', 'providerId'] },
      inputHash: 'input-hash',
    },
    status: 'prepared',
    rowVersion: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}
