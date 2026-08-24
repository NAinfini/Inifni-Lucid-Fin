import { createHash } from 'node:crypto';
import type {
  GenerationRequest,
  ImageNodeData,
  ProductionMediaTaskAttempt,
  PromptAssemblyRecord,
  TaskEvaluation,
  TaskListId,
  VideoNodeData,
} from '@lucid-fin/contracts';
import { TaskKind, TaskStatus } from '@lucid-fin/contracts';
import type { TaskExecutionContext, TaskExecutionResult, TaskHandler } from '@lucid-fin/application';
import {
  buildGenerationContext,
  prepareGenerationPromptAssembly,
} from '../ipc/handlers/generation-context.js';
import { mergeVariants } from '../ipc/handlers/generation-helpers.js';
import type {
  CanvasGenerationDeps,
  ProviderConfigOverride,
} from '../ipc/handlers/generation-types.js';
import type { MediaGenerationService } from '../services/media-generation.service.js';
import { buildMediaGenerationSpec } from '../services/media-generation-spec.js';

export interface MediaTaskInput extends Record<string, unknown> {
  nodeId: string;
  providerId?: string;
  providerConfig?: ProviderConfigOverride;
  seed?: number;
  commanderIntent?: string;
  parentAttemptId?: string;
  feedback?: string;
}

export interface MediaTaskHandlerOptions {
  generationDeps: CanvasGenerationDeps;
  mediaGenerationService: Pick<MediaGenerationService, 'advance' | 'cancel'>;
  now?: () => number;
}

/**
 * Durable image/video generation for an ordinary Canvas node.
 *
 * The handler never authors a provider prompt and never runs a visual model.
 * It prepares the immutable Prompt Assembly, submits the exact Commander
 * output once, then pauses at asset_ready for the background evaluator.
 */
export function createMediaTaskHandler(options: MediaTaskHandlerOptions): TaskHandler {
  const now = options.now ?? (() => Date.now());

  const execute = async (context: TaskExecutionContext): Promise<TaskExecutionResult> =>
    continueTask(context);

  const recover = async (context: TaskExecutionContext): Promise<TaskExecutionResult> =>
    continueTask(context);

  async function continueTask(context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const input = parseMediaTaskInput(context);
    const latest = options.generationDeps.db.repos.taskLists.getLatestProductionMediaAttempt(
      context.taskList.id as TaskListId,
      input.nodeId,
    );

    if (latest) return advanceAttempt(context, input, latest);

    const assemblyId = optionalString(context.task.output.promptAssemblyId);
    if (!assemblyId) {
      const parent = resolveParentAttempt(context, input);
      const prepared = await prepareGenerationPromptAssembly(options.generationDeps, {
        canvasId: requireCanvasId(context),
        nodeId: input.nodeId,
        requestedProviderId: input.providerId,
        requestedProviderConfig: input.providerConfig,
        requestedVariantCount: 1,
        requestedSeed: input.seed,
        commanderIntent: input.commanderIntent,
        promptAssemblyPurpose: parent ? 'user_refine' : 'initial',
        promptAssemblyAuthority: {
          kind: 'task-list',
          taskListId: context.taskList.id,
          taskId: context.task.id,
        },
        ...(parent
          ? {
              promptAssemblyParent: {
                assemblyId: parent.promptAssemblyId,
                finalPrompt: parent.prompt,
                promptHash: parent.promptHash,
                ...(parent.assetHash ? { assetHash: parent.assetHash } : {}),
                userFeedback: input.feedback!,
              },
            }
          : {}),
      });
      const preparedId = requiredString(prepared.promptAssemblyId, 'prepared Prompt Assembly ID');
      return awaitingPromptAssembly(preparedId);
    }

    const assembly = requireAssembly(
      options.generationDeps.promptAssemblyService.get(assemblyId),
      assemblyId,
    );
    if (assembly.status === 'prepared') return awaitingPromptAssembly(assembly.id);
    if (assembly.status === 'failed' || assembly.status === 'cancelled') {
      return {
        status: assembly.status === 'cancelled' ? TaskStatus.Cancelled : TaskStatus.Failed,
        progress: 0,
        currentStep: assembly.status,
        error: assembly.error ?? `Prompt Assembly is ${assembly.status}`,
        output: { promptAssemblyId: assembly.id, promptAssemblyStatus: assembly.status },
      };
    }
    if (assembly.status !== 'assembled' || !assembly.output) {
      return {
        status: TaskStatus.Failed,
        progress: 0,
        currentStep: 'failed',
        error: `Prompt Assembly ${assembly.id} has no reserved media attempt`,
        output: { promptAssemblyId: assembly.id, promptAssemblyStatus: assembly.status },
      };
    }

    const parent = resolveParentAttempt(context, input);
    const generation = await buildGenerationContext(options.generationDeps, {
      canvasId: requireCanvasId(context),
      nodeId: input.nodeId,
      requestedProviderId: input.providerId,
      requestedProviderConfig: input.providerConfig,
      requestedVariantCount: 1,
      requestedSeed: input.seed,
      commanderIntent: input.commanderIntent,
      promptAssemblyId: assembly.id,
      promptAssemblyPurpose: assembly.purpose,
      promptAssemblyAuthority: {
        kind: 'task-list',
        taskListId: context.taskList.id,
        taskId: context.task.id,
      },
      ...(parent
        ? {
            promptAssemblyParent: {
              assemblyId: parent.promptAssemblyId,
              finalPrompt: parent.prompt,
              promptHash: parent.promptHash,
              ...(parent.assetHash ? { assetHash: parent.assetHash } : {}),
              userFeedback: input.feedback!,
            },
          }
        : {}),
    });
    if (generation.generationType !== 'image' && generation.generationType !== 'video') {
      throw new Error('media.generation.v1 supports image and video nodes only');
    }
    if (generation.variantCount !== 1) {
      throw new Error('A durable media Task List owns exactly one provider submission');
    }

    const request: GenerationRequest = parent
      ? {
          ...structuredClone(parent.generationSpec.request),
          prompt: assembly.output.finalPrompt,
          negativePrompt: assembly.output.negativePrompt,
          seed: input.seed ?? parent.seed,
        }
      : { ...generation.requestBase, seed: input.seed ?? generation.baseSeed };
    const estimate = generation.adapter.estimateCost(request);
    if (!Number.isFinite(estimate.estimatedCost) || estimate.estimatedCost < 0) {
      throw new Error('Provider returned an invalid cost estimate; generation was not reserved');
    }
    const createdAt = now();
    const spec = buildMediaGenerationSpec({
      scope: 'canvas',
      authority: { kind: 'task-list' },
      taskListId: context.taskList.id,
      task: context.task,
      canvas: generation.canvas,
      node: generation.node,
      context: generation,
      request,
      promptAssembly: assembly,
      limits: {
        maxAttemptsPerShot: 1,
        maxRegenerations: 0,
        maxTotalCostUsd: estimate.estimatedCost,
        styleAuditionCommittedCostUsd: 0,
      },
      lineage: {
        purpose: assembly.purpose,
        ...(parent ? { parentAttemptId: parent.id, basePromptHash: parent.promptHash } : {}),
        variantIndex: 0,
        variantCount: 1,
      },
      createdAt,
    });
    const specHash = sha256(canonicalJson({ ...spec, createdAt: undefined }));
    const attemptId = `media-${sha256(
      canonicalJson({
        taskListId: context.taskList.id,
        taskId: context.task.id,
        promptAssemblyId: assembly.id,
        specHash,
      }),
    ).slice(0, 32)}`;
    const proposed: ProductionMediaTaskAttempt = {
      kind: 'production_media',
      id: attemptId,
      taskListId: context.taskList.id,
      taskId: context.task.id,
      canvasId: generation.canvas.id,
      nodeId: generation.node.id,
      attempt: 1,
      idempotencyKey: attemptId,
      specHash,
      generationSpec: spec,
      scope: 'canvas',
      mediaType: generation.generationType,
      status: 'reserved',
      rowVersion: 0,
      providerId: generation.adapter.id,
      promptAssemblyId: assembly.id,
      ...(parent ? { parentAttemptId: parent.id } : {}),
      submissionPurpose: assembly.purpose,
      model: spec.modelId,
      prompt: request.prompt,
      promptHash: spec.promptHash,
      ...(request.negativePrompt !== undefined
        ? { negativePrompt: request.negativePrompt }
        : {}),
      ...(request.seed !== undefined ? { seed: request.seed } : {}),
      estimatedCostUsd: estimate.estimatedCost,
      createdAt,
      updatedAt: createdAt,
    };
    const reserved = options.generationDeps.db.repos.taskLists.reserveProductionMediaAttempt({
      attempt: proposed,
      expectedTaskListRowVersion: context.taskList.rowVersion ?? 0,
    }).attempt;
    return advanceAttempt(context, input, reserved);
  }

  async function advanceAttempt(
    context: TaskExecutionContext,
    _input: MediaTaskInput,
    initial: ProductionMediaTaskAttempt,
  ): Promise<TaskExecutionResult> {
    let attempt = initial;
    if (
      attempt.status === 'reserved' ||
      attempt.status === 'submitting' ||
      attempt.status === 'awaiting_provider'
    ) {
      attempt = await options.mediaGenerationService.advance(attempt.id);
    }
    const evaluation = options.generationDeps.db.repos.taskLists.getTaskEvaluation(attempt.id);
    return projectAttemptResult(context, attempt, evaluation);
  }

  function projectAttemptResult(
    context: TaskExecutionContext,
    attempt: ProductionMediaTaskAttempt,
    evaluation: TaskEvaluation | undefined,
  ): TaskExecutionResult {
    const output = {
      taskListId: context.taskList.id,
      taskId: context.task.id,
      nodeId: attempt.nodeId,
      attemptId: attempt.id,
      attemptStatus: attempt.status,
      promptAssemblyId: attempt.promptAssemblyId,
      ...(attempt.assetHash ? { assetHash: attempt.assetHash } : {}),
      ...(evaluation
        ? {
            evaluationId: evaluation.id,
            evaluationVerdict: evaluation.verdict,
            evaluationTotal: evaluation.total,
          }
        : {}),
    };
    if (attempt.status === 'accepted') {
      attachAcceptedAsset(options.generationDeps, attempt, now());
      const artifact = options.generationDeps.db.repos.taskLists.getArtifactByAttempt(
        attempt.id,
        'media_output',
      );
      return {
        status: TaskStatus.Completed,
        progress: 100,
        currentStep: 'completed',
        assetId: optionalString(artifact?.metadata.assetEntryId),
        output,
      };
    }
    if (attempt.status === 'asset_ready' || attempt.status === 'evaluating') {
      return {
        status: TaskStatus.AwaitingProvider,
        progress: 80,
        currentStep: attempt.status === 'asset_ready' ? 'awaiting_evaluation' : 'evaluating',
        output,
      };
    }
    if (attempt.status === 'reserved' || attempt.status === 'submitting') {
      return {
        status: TaskStatus.Running,
        progress: 30,
        currentStep: 'submitting',
        output,
      };
    }
    if (attempt.status === 'awaiting_provider') {
      return {
        status: TaskStatus.AwaitingProvider,
        progress: 50,
        currentStep: 'awaiting_provider',
        providerTaskId: attempt.providerJobId,
        output,
      };
    }
    if (attempt.status === 'cancelled') {
      return { status: TaskStatus.Cancelled, progress: 0, currentStep: 'cancelled', output };
    }
    return {
      status: TaskStatus.Failed,
      progress: 0,
      currentStep: attempt.status,
      error:
        attempt.error ??
        (attempt.status === 'human_review'
          ? 'Generated media requires user review'
          : `Media generation ended in ${attempt.status}`),
      output,
    };
  }

  return {
    id: 'media.generate',
    kind: TaskKind.AdapterGeneration,
    execute,
    recover,
    async cancel(context) {
      const input = parseMediaTaskInput(context);
      const latest = options.generationDeps.db.repos.taskLists.getLatestProductionMediaAttempt(
        context.taskList.id as TaskListId,
        input.nodeId,
      );
      if (latest) await options.mediaGenerationService.cancel(latest.id);
    },
  };
}

function parseMediaTaskInput(context: TaskExecutionContext): MediaTaskInput {
  const nodeId = requiredString(context.task.input.nodeId, 'nodeId');
  const providerId = optionalString(context.task.input.providerId);
  const seed = context.task.input.seed;
  if (seed !== undefined && !Number.isInteger(seed)) throw new Error('seed must be an integer');
  const rawProviderConfig = optionalRecord(context.task.input.providerConfig);
  const providerConfig = rawProviderConfig
    ? parseProviderConfig(rawProviderConfig)
    : undefined;
  const parentAttemptId = optionalString(context.task.input.parentAttemptId);
  const feedback = optionalString(context.task.input.feedback);
  if ((parentAttemptId && !feedback) || (!parentAttemptId && feedback)) {
    throw new Error('parentAttemptId and feedback are required together for refinement');
  }
  return {
    nodeId,
    ...(providerId ? { providerId } : {}),
    ...(providerConfig ? { providerConfig } : {}),
    ...(typeof seed === 'number' ? { seed } : {}),
    ...(optionalString(context.task.input.commanderIntent)
      ? { commanderIntent: optionalString(context.task.input.commanderIntent) }
      : {}),
    ...(parentAttemptId ? { parentAttemptId, feedback } : {}),
  };
}

function resolveParentAttempt(
  context: TaskExecutionContext,
  input: MediaTaskInput,
): ProductionMediaTaskAttempt | undefined {
  if (!input.parentAttemptId) return undefined;
  const parent = context.db.repos.taskLists.getProductionMediaAttempt(input.parentAttemptId);
  if (
    !parent ||
    (parent.status !== 'accepted' && parent.status !== 'failed') ||
    parent.canvasId !== context.taskList.entityId ||
    parent.nodeId !== input.nodeId
  ) {
    throw new Error('Refinement requires the exact accepted or definitively failed parent media attempt');
  }
  return parent;
}

function awaitingPromptAssembly(promptAssemblyId: string): TaskExecutionResult {
  return {
    status: TaskStatus.AwaitingProvider,
    progress: 10,
    currentStep: 'awaiting_prompt_assembly',
    output: { promptAssemblyId, promptAssemblyStatus: 'prepared' },
  };
}

function attachAcceptedAsset(
  deps: CanvasGenerationDeps,
  attempt: ProductionMediaTaskAttempt,
  updatedAt: number,
): void {
  if (!attempt.assetHash) throw new Error('Accepted media attempt has no asset hash');
  const canvas = deps.canvasStore.get(attempt.canvasId);
  const node = canvas?.nodes.find((candidate) => candidate.id === attempt.nodeId);
  if (!canvas || !node) throw new Error('Canvas node no longer exists for accepted media');
  if (node.updatedAt !== attempt.generationSpec.nodeUpdatedAt) {
    throw new Error('Canvas node changed before accepted media selection');
  }
  if (node.type !== 'image' && node.type !== 'video' && node.type !== 'backdrop') {
    throw new Error('Accepted media is not bound to an image or video node');
  }
  const data = node.data as ImageNodeData | VideoNodeData;
  const merged = mergeVariants(data.variants ?? [], [attempt.assetHash]);
  data.variants = merged.variants;
  data.selectedVariantIndex = merged.variants.indexOf(attempt.assetHash);
  data.assetHash = attempt.assetHash;
  data.status = 'done';
  data.progress = 100;
  data.error = undefined;
  data.providerId = attempt.providerId;
  data.seed = attempt.seed;
  data.cost = attempt.reportedActualCostUsd ?? attempt.estimatedCostUsd;
  data.estimatedCost = attempt.estimatedCostUsd;
  node.updatedAt = updatedAt;
  canvas.updatedAt = updatedAt;
  deps.canvasStore.save(canvas);
}

function requireCanvasId(context: TaskExecutionContext): string {
  if (context.taskList.entityType !== 'canvas') {
    throw new Error('media.generation.v1 must be bound to a canvas');
  }
  return requiredString(context.taskList.entityId, 'canvasId');
}

function requireAssembly(
  record: PromptAssemblyRecord | undefined,
  assemblyId: string,
): PromptAssemblyRecord {
  if (!record) throw new Error(`Prompt Assembly not found: ${assemblyId}`);
  return record;
}

function requiredString(value: unknown, name: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseProviderConfig(value: Record<string, unknown>): ProviderConfigOverride {
  if ('apiKey' in value) {
    throw new Error('Inline API keys cannot be stored in media Task Lists');
  }
  const baseUrl = requiredString(value.baseUrl, 'providerConfig.baseUrl');
  const model = requiredString(value.model, 'providerConfig.model');
  return { baseUrl, model };
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}
