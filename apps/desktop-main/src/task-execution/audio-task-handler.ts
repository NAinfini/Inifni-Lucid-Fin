import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type {
  AIProviderAdapter,
  GenerationRequest,
  GenerationResult,
  PromptAssemblyRecord,
  TaskExecutionAttempt,
} from '@lucid-fin/contracts';
import { JobStatus, TaskKind, TaskStatus } from '@lucid-fin/contracts';
import type { TaskExecutionContext, TaskExecutionResult, TaskHandler } from '@lucid-fin/application';
import type { CAS } from '@lucid-fin/storage';
import { parseTaskId } from '@lucid-fin/contracts-parse';
import type {
  PreparePromptAssemblyInput,
  PromptAssemblyService,
} from '../services/prompt-assembly.service.js';
import { materializeAsset } from '../ipc/handlers/generation-helpers.js';
import type { MaterializedAsset, ProviderConfigOverride } from '../ipc/handlers/generation-types.js';

export type AudioGenerationSubtype = 'voice' | 'music' | 'sfx';

export interface AudioTaskInput extends Record<string, unknown> {
  subtype: AudioGenerationSubtype;
  prompt: string;
  providerId: string;
  model?: string;
  duration?: number;
  params?: Record<string, unknown>;
  providerConfig?: ProviderConfigOverride;
}

export interface AudioTaskAdapterRequest {
  providerId: string;
  subtype: AudioGenerationSubtype;
  providerConfig?: ProviderConfigOverride;
}

export interface AudioTaskHandlerOptions {
  cas: Pick<CAS, 'importAsset'>;
  promptAssemblyService: Pick<
    PromptAssemblyService,
    'prepare' | 'get' | 'markSubmitted' | 'markFailed'
  >;
  resolveAdapter(request: AudioTaskAdapterRequest): Promise<AIProviderAdapter>;
  resolveProcessPrompt?: (processKey: string) => string | undefined;
  now?: () => number;
  materialize?: (generated: GenerationResult) => Promise<MaterializedAsset>;
}

const MAX_PROVIDER_WAIT_MS = 30 * 60 * 1_000;

export function createAudioTaskHandler(options: AudioTaskHandlerOptions): TaskHandler {
  const now = options.now ?? (() => Date.now());
  const materialize = options.materialize ?? materializeAsset;

  async function execute(context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const input = parseAudioTaskInput(context.task.input);
    const attempt = reserveAttempt(context, input, now());
    const assemblyId = optionalString(attempt.metadata.promptAssemblyId);

    if (!assemblyId) {
      const prepared = options.promptAssemblyService.prepare(
        createAssemblyInput(context, input, options.resolveProcessPrompt?.('audio-generation')),
      );
      const awaiting = context.db.repos.taskLists.transitionTaskAttempt({
        id: attempt.id,
        expectedRowVersion: attempt.rowVersion,
        expectedStatuses: [attempt.status],
        status: TaskStatus.AwaitingProvider,
        metadata: {
          ...attempt.metadata,
          promptAssemblyId: prepared.id,
          submissionState: 'awaiting_prompt_assembly',
        },
        updatedAt: now(),
      });
      return awaitingAssemblyResult(awaiting, prepared);
    }

    return continueAttempt(context, input, attempt, assemblyId);
  }

  async function recover(context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const input = parseAudioTaskInput(context.task.input);
    const attempt = context.db.repos.taskLists.listTaskAttempts(parseTaskId(context.task.id)).at(-1);
    if (!attempt) return execute(context);
    const assemblyId = optionalString(attempt.metadata.promptAssemblyId);
    if (!assemblyId) return execute(context);
    return continueAttempt(context, input, attempt, assemblyId);
  }

  async function continueAttempt(
    context: TaskExecutionContext,
    input: AudioTaskInput,
    initialAttempt: TaskExecutionAttempt,
    assemblyId: string,
  ): Promise<TaskExecutionResult> {
    const assembly = requireAssembly(options.promptAssemblyService.get(assemblyId), assemblyId);
    if (
      initialAttempt.status === TaskStatus.Completed &&
      initialAttempt.assetHash &&
      initialAttempt.metadata.submissionState === 'completed'
    ) {
      return {
        status: TaskStatus.Completed,
        progress: 100,
        currentStep: 'completed',
        providerTaskId: initialAttempt.providerJobId,
        assetId: optionalString(initialAttempt.output.assetEntryId),
        output: initialAttempt.output,
      };
    }
    if (initialAttempt.status === TaskStatus.Failed) {
      return failedResult(initialAttempt, initialAttempt.error ?? 'Audio generation failed');
    }
    if (assembly.status === 'prepared') return awaitingAssemblyResult(initialAttempt, assembly);
    if (assembly.status === 'failed' || assembly.status === 'cancelled') {
      return failedResult(initialAttempt, assembly.error ?? `Prompt Assembly is ${assembly.status}`);
    }
    if (!assembly.output) throw new Error(`Prompt Assembly ${assemblyId} has no Commander output`);

    const adapter = await options.resolveAdapter({
      providerId: input.providerId,
      subtype: input.subtype,
      ...(input.providerConfig ? { providerConfig: input.providerConfig } : {}),
    });
    let attempt = initialAttempt;
    let providerJobId = attempt.providerJobId;

    if (!providerJobId && attempt.metadata.submissionState === 'submitting') {
      return failAttempt(
        context,
        attempt,
        assemblyId,
        'Provider submission outcome is ambiguous; the request was not submitted again',
        now,
        options.promptAssemblyService,
      );
    }

    if (!providerJobId && attempt.metadata.submissionState !== 'submitted') {
      attempt = context.db.repos.taskLists.transitionTaskAttempt({
        id: attempt.id,
        expectedRowVersion: attempt.rowVersion,
        expectedStatuses: [attempt.status],
        status: TaskStatus.Running,
        metadata: { ...attempt.metadata, submissionState: 'submitting' },
        updatedAt: now(),
      });
      options.promptAssemblyService.markSubmitted(assemblyId);
      let generated: GenerationResult;
      try {
        generated = await adapter.generate(createGenerationRequest(input, assembly));
      } catch (error) {
        return failAttempt(
          context,
          attempt,
          assemblyId,
          errorMessage(error),
          now,
          options.promptAssemblyService,
        );
      }

      providerJobId = readProviderJobId(generated);
      if (hasMaterializableAsset(generated)) {
        return persistCompletedAsset(
          context,
          input,
          attempt,
          assembly,
          adapter,
          generated,
          providerJobId,
        );
      }
      if (!providerJobId) {
        return failAttempt(
          context,
          attempt,
          assemblyId,
          'Audio provider returned neither an asset nor a durable provider job ID',
          now,
          options.promptAssemblyService,
        );
      }
      const submittedAt = now();
      attempt = context.db.repos.taskLists.transitionTaskAttempt({
        id: attempt.id,
        expectedRowVersion: attempt.rowVersion,
        expectedStatuses: [attempt.status],
        status: TaskStatus.AwaitingProvider,
        providerJobId,
        submittedAt,
        metadata: { ...attempt.metadata, submissionState: 'submitted' },
        updatedAt: submittedAt,
      });
    }

    if (!providerJobId) {
      return failAttempt(
        context,
        attempt,
        assemblyId,
        'Audio attempt is missing its durable provider job ID',
        now,
        options.promptAssemblyService,
      );
    }

    const submittedAt = attempt.submittedAt ?? attempt.updatedAt;
    if (context.signal?.aborted) throw new Error('Audio generation was cancelled');
    if (now() - submittedAt > MAX_PROVIDER_WAIT_MS) {
      return failAttempt(
        context,
        attempt,
        assemblyId,
        'Audio provider did not complete within 30 minutes',
        now,
        options.promptAssemblyService,
      );
    }
    const status = await adapter.checkStatus(providerJobId);
    if (status === JobStatus.Completed) {
      if (!adapter.getResult) {
        return failAttempt(
          context,
          attempt,
          assemblyId,
          `Provider ${adapter.id} cannot retrieve its completed audio result`,
          now,
          options.promptAssemblyService,
        );
      }
      const generated = await adapter.getResult(providerJobId);
      return persistCompletedAsset(
        context,
        input,
        attempt,
        assembly,
        adapter,
        generated,
        providerJobId,
      );
    }
    if (status === JobStatus.Failed || status === JobStatus.Dead) {
      return failAttempt(
        context,
        attempt,
        assemblyId,
        `Audio provider job ${providerJobId} failed`,
        now,
        options.promptAssemblyService,
      );
    }
    if (status === JobStatus.Cancelled) {
      return failAttempt(
        context,
        attempt,
        assemblyId,
        `Audio provider job ${providerJobId} was cancelled`,
        now,
        options.promptAssemblyService,
      );
    }
    return {
      status: TaskStatus.AwaitingProvider,
      progress: 50,
      currentStep: 'awaiting_provider',
      providerTaskId: providerJobId,
      output: {
        attemptId: attempt.id,
        providerJobId,
        promptAssemblyId: assembly.id,
      },
    };
  }

  async function persistCompletedAsset(
    context: TaskExecutionContext,
    input: AudioTaskInput,
    attempt: TaskExecutionAttempt,
    assembly: PromptAssemblyRecord,
    adapter: AIProviderAdapter,
    generated: GenerationResult,
    providerJobId?: string,
  ): Promise<TaskExecutionResult> {
    const materialized = await materialize(generated);
    try {
      const imported = await options.cas.importAsset(materialized.filePath, 'audio');
      const createdAt = now();
      const entry = context.db.repos.assets.insert({
        ...imported.meta,
        prompt: assembly.output!.finalPrompt,
        provider: adapter.id,
        displayName: `${input.subtype} audio`,
        tags: ['audio', input.subtype, `task-list:${context.taskList.id}`, `attempt:${attempt.attempt}`],
        generationMetadata: {
          prompt: assembly.output!.finalPrompt,
          ...(assembly.output!.negativePrompt
            ? { negativePrompt: assembly.output!.negativePrompt }
            : {}),
          provider: adapter.id,
          taskListId: context.taskList.id,
          attemptId: attempt.id,
          promptAssemblyId: assembly.id,
          promptHash: sha256(assembly.output!.finalPrompt),
          ...(input.model ? { model: input.model } : {}),
          ...(typeof generated.cost === 'number' ? { cost: generated.cost } : {}),
        },
      });
      context.db.repos.taskLists.insertArtifact({
        id: randomUUID(),
        taskListId: context.taskList.id,
        taskId: context.task.id,
        artifactType: 'audio',
        entityType: 'asset_entry',
        entityId: entry.id,
        assetHash: imported.ref.hash,
        path: imported.ref.path,
        metadata: {
          assetEntryId: entry.id,
          format: imported.ref.format,
          subtype: input.subtype,
          providerId: adapter.id,
          attemptId: attempt.id,
          idempotencyKey: attempt.idempotencyKey,
          promptAssemblyId: assembly.id,
          ...(providerJobId ? { providerJobId } : {}),
        },
        createdAt,
      });
      const completed = context.db.repos.taskLists.transitionTaskAttempt({
        id: attempt.id,
        expectedRowVersion: attempt.rowVersion,
        expectedStatuses: [attempt.status],
        status: TaskStatus.Completed,
        providerJobId,
        assetHash: imported.ref.hash,
        assetReadyAt: createdAt,
        completedAt: createdAt,
        output: {
          assetEntryId: entry.id,
          assetHash: imported.ref.hash,
          format: imported.ref.format,
          promptAssemblyId: assembly.id,
          ...(providerJobId ? { providerJobId } : {}),
        },
        metadata: { ...attempt.metadata, submissionState: 'completed' },
        updatedAt: createdAt,
      });
      return {
        status: TaskStatus.Completed,
        progress: 100,
        currentStep: 'completed',
        providerTaskId: providerJobId,
        assetId: entry.id,
        output: completed.output,
      };
    } finally {
      if (materialized.cleanupPath) {
        fs.rmSync(materialized.cleanupPath, { recursive: true, force: true });
      }
    }
  }

  return {
    id: 'audio.generate',
    kind: TaskKind.AdapterGeneration,
    execute,
    recover,
  };
}

function reserveAttempt(
  context: TaskExecutionContext,
  input: AudioTaskInput,
  createdAt: number,
): TaskExecutionAttempt {
  const idempotencyKey = sha256({
    taskListId: context.taskList.id,
    taskId: context.task.id,
    input,
  });
  return context.db.repos.taskLists.reserveTaskAttempt({
    attempt: {
      kind: 'task',
      id: `audio-${idempotencyKey.slice(0, 32)}`,
      taskListId: context.taskList.id,
      taskId: context.task.id,
      attempt: 1,
      idempotencyKey,
      status: TaskStatus.Running,
      rowVersion: 0,
      input,
      output: {},
      metadata: { handlerId: 'audio.generate', submissionState: 'preparing_prompt' },
      createdAt,
      updatedAt: createdAt,
    },
  }).attempt;
}

function createAssemblyInput(
  context: TaskExecutionContext,
  input: AudioTaskInput,
  processGuide?: string,
): PreparePromptAssemblyInput {
  return {
    canvasId: requiredString(context.taskList.entityId, 'canvasId'),
    nodeId: context.task.id,
    nodeUpdatedAt: context.task.updatedAt,
    mediaType: 'audio',
    mode: 'text-to-audio',
    purpose: 'initial',
    authority: {
      kind: 'task-list',
      taskListId: context.taskList.id,
      taskId: context.task.id,
    },
    sources: [
      {
        sourceId: 'user-intent',
        kind: 'user-intent',
        label: 'Audio request',
        content: input.prompt,
        required: true,
        metadata: { subtype: input.subtype },
      },
      ...(processGuide?.trim()
        ? [
            {
              sourceId: 'audio-generation-guide',
              kind: 'task-list-guide' as const,
              label: 'Audio generation guide',
              content: processGuide,
              required: false,
            },
          ]
        : []),
    ],
    conditioningManifest: [],
    providerProfile: {
      providerId: input.providerId,
      ...(input.model ? { model: input.model } : {}),
      capabilities: [`text-to-${input.subtype}`],
    },
    hostConstraints: {
      immutable: ['subtype', 'providerId', 'duration', 'params'],
      ...(input.params?.budget ? { budget: input.params.budget } : {}),
    },
  };
}

function createGenerationRequest(
  input: AudioTaskInput,
  assembly: PromptAssemblyRecord,
): GenerationRequest {
  if (!assembly.output) throw new Error(`Prompt Assembly ${assembly.id} is not assembled`);
  return {
    type: input.subtype,
    providerId: input.providerId,
    prompt: assembly.output.finalPrompt,
    ...(assembly.output.negativePrompt !== undefined
      ? { negativePrompt: assembly.output.negativePrompt }
      : {}),
    ...(input.duration !== undefined ? { duration: input.duration } : {}),
    ...(input.params ? { params: input.params } : {}),
  };
}

function parseAudioTaskInput(value: Record<string, unknown>): AudioTaskInput {
  const subtype = value.subtype;
  if (subtype !== 'voice' && subtype !== 'music' && subtype !== 'sfx') {
    throw new Error('Audio subtype must be voice, music, or sfx');
  }
  const prompt = requiredString(value.prompt, 'prompt');
  const providerId = requiredString(value.providerId, 'providerId');
  const duration = value.duration;
  if (duration !== undefined && (typeof duration !== 'number' || duration <= 0)) {
    throw new Error('Audio duration must be a positive number');
  }
  const params = optionalRecord(value.params, 'params');
  const providerConfig = optionalRecord(value.providerConfig, 'providerConfig') as
    | ProviderConfigOverride
    | undefined;
  return {
    subtype,
    prompt,
    providerId,
    ...(optionalString(value.model) ? { model: optionalString(value.model) } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(params ? { params } : {}),
    ...(providerConfig ? { providerConfig } : {}),
  };
}

function awaitingAssemblyResult(
  attempt: TaskExecutionAttempt,
  assembly: PromptAssemblyRecord,
): TaskExecutionResult {
  return {
    status: TaskStatus.AwaitingProvider,
    progress: 10,
    currentStep: 'awaiting_prompt_assembly',
    output: {
      attemptId: attempt.id,
      promptAssemblyId: assembly.id,
      promptAssemblyStatus: assembly.status,
    },
  };
}

function failedResult(attempt: TaskExecutionAttempt, error: string): TaskExecutionResult {
  return {
    status: TaskStatus.Failed,
    progress: 0,
    currentStep: 'failed',
    error,
    output: { attemptId: attempt.id },
  };
}

function failAttempt(
  context: TaskExecutionContext,
  attempt: TaskExecutionAttempt,
  assemblyId: string,
  error: string,
  now: () => number,
  promptAssemblyService: AudioTaskHandlerOptions['promptAssemblyService'],
): TaskExecutionResult {
  const completedAt = now();
  const failed = context.db.repos.taskLists.transitionTaskAttempt({
    id: attempt.id,
    expectedRowVersion: attempt.rowVersion,
    expectedStatuses: [attempt.status],
    status: TaskStatus.Failed,
    error,
    metadata: { ...attempt.metadata, submissionState: 'failed' },
    completedAt,
    updatedAt: completedAt,
  });
  try {
    promptAssemblyService.markFailed(assemblyId, error);
  } catch {
    // The provider attempt remains the authoritative failure record.
  }
  return failedResult(failed, error);
}

function requireAssembly(
  assembly: PromptAssemblyRecord | undefined,
  assemblyId: string,
): PromptAssemblyRecord {
  if (!assembly) throw new Error(`Prompt Assembly not found: ${assemblyId}`);
  return assembly;
}

function readProviderJobId(result: GenerationResult): string | undefined {
  return firstString(result.metadata?.jobId, result.metadata?.taskId, result.metadata?.id);
}

function hasMaterializableAsset(result: GenerationResult): boolean {
  if (result.assetPath.trim()) return true;
  return Boolean(
    firstString(
      result.metadata?.url,
      result.metadata?.audio_url,
      result.metadata?.output,
      result.metadata?.download_url,
    ),
  );
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = optionalString(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`Audio ${field} is required`);
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalRecord(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Audio ${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value: unknown): string {
  const text = typeof value === 'string' ? value : canonicalJson(value);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === undefined || value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}
