import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type {
  AIProviderAdapter,
  GenerationRequest,
  GenerationResult,
  ProductionMediaTaskAttempt,
  TaskArtifact,
} from '@lucid-fin/contracts';
import { JobStatus } from '@lucid-fin/contracts';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import {
  materializeAsset,
  materializeGenerationRequest,
  probeGeneratedAsset,
} from '../ipc/handlers/generation-helpers.js';
import type { MaterializedAsset } from '../ipc/handlers/generation-types.js';
import type { PromptAssemblyService } from './prompt-assembly.service.js';

export interface MediaGenerationServiceDeps {
  db: SqliteIndex;
  cas: CAS;
  promptAssemblyService: Pick<PromptAssemblyService, 'get'>;
  resolveAdapter(attempt: ProductionMediaTaskAttempt): Promise<AIProviderAdapter>;
  materialize?: (result: GenerationResult) => Promise<MaterializedAsset>;
  probe?: (
    filePath: string,
    mediaType: 'image' | 'video',
  ) => Promise<{ width?: number; height?: number; duration?: number; hasAudio?: boolean }>;
  now?: () => number;
  idFactory?: () => string;
}

/**
 * The only image/video provider boundary.
 *
 * Prompt authorship, approval, cost reservation and evaluation live outside
 * this service. This class only advances an already-persisted attempt without
 * ever reconstructing its request or repeating an uncertain provider call.
 */
export class MediaGenerationService {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly materialize: (result: GenerationResult) => Promise<MaterializedAsset>;
  private readonly probe: NonNullable<MediaGenerationServiceDeps['probe']>;

  constructor(private readonly deps: MediaGenerationServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.idFactory = deps.idFactory ?? randomUUID;
    this.materialize = deps.materialize ?? materializeAsset;
    this.probe = deps.probe ?? probeGeneratedAsset;
  }

  async advance(attemptId: string): Promise<ProductionMediaTaskAttempt> {
    const attempt = this.requireAttempt(attemptId);
    if (attempt.status === 'reserved') return this.submit(attempt);
    if (attempt.status === 'submitting') return this.reconcileSubmitting(attempt);
    if (attempt.status === 'awaiting_provider') return this.poll(attempt);
    return attempt;
  }

  async cancel(attemptId: string): Promise<ProductionMediaTaskAttempt> {
    const attempt = this.requireAttempt(attemptId);
    if (isTerminal(attempt)) return attempt;
    const cancelledAt = this.now();

    if (attempt.status === 'reserved') {
      return this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
        id: attempt.id,
        expectedRowVersion: attempt.rowVersion,
        expectedStatuses: ['reserved'],
        status: 'cancelled',
        cancelRequestedAt: cancelledAt,
        completedAt: cancelledAt,
        updatedAt: cancelledAt,
      });
    }

    if (attempt.status === 'submitting' && !attempt.providerReceipt) {
      return this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
        id: attempt.id,
        expectedRowVersion: attempt.rowVersion,
        expectedStatuses: ['submitting'],
        status: 'ambiguous',
        cancelRequestedAt: cancelledAt,
        error: 'Cancellation was requested while provider acceptance was unknown.',
        completedAt: cancelledAt,
        updatedAt: cancelledAt,
      });
    }

    if (attempt.providerJobId) {
      const adapter = await this.requireAdapter(attempt);
      await adapter.cancel(attempt.providerJobId);
    }
    return this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
      id: attempt.id,
      expectedRowVersion: attempt.rowVersion,
      expectedStatuses: [attempt.status],
      status: 'cancelled',
      cancelRequestedAt: cancelledAt,
      completedAt: cancelledAt,
      updatedAt: cancelledAt,
    });
  }

  private async submit(attempt: ProductionMediaTaskAttempt): Promise<ProductionMediaTaskAttempt> {
    const assembly = this.deps.promptAssemblyService.get(attempt.promptAssemblyId);
    if (!assembly?.output) {
      return this.failBeforeSubmission(attempt, 'Prompt Assembly is not assembled');
    }
    if (
      assembly.output.finalPrompt !== attempt.prompt ||
      assembly.output.negativePrompt !== attempt.negativePrompt ||
      attempt.generationSpec.request.prompt !== attempt.prompt ||
      attempt.generationSpec.request.negativePrompt !== attempt.negativePrompt
    ) {
      return this.failBeforeSubmission(
        attempt,
        'Provider request does not exactly match the persisted Prompt Assembly',
      );
    }

    let adapter: AIProviderAdapter;
    let request: GenerationRequest;
    try {
      adapter = await this.requireAdapter(attempt);
      request = materializeGenerationRequest(attempt.generationSpec.request, this.deps.cas);
    } catch (error) {
      return this.failBeforeSubmission(attempt, errorMessage(error));
    }

    const startedAt = this.now();
    const begun = this.deps.db.repos.taskLists.beginMediaSubmission({
      attemptId: attempt.id,
      expectedAttemptRowVersion: attempt.rowVersion,
      promptAssemblyId: assembly.id,
      expectedPromptAssemblyRowVersion: assembly.rowVersion,
      artifactId: this.idFactory(),
      submissionStartedAt: startedAt,
    });
    if (!begun.created) return this.reconcileSubmitting(begun.attempt);

    try {
      const generated = adapter.subscribe
        ? await adapter.subscribe(request, {})
        : await adapter.generate(request);
      return await this.persistOutput(begun.attempt, adapter, generated);
    } catch (error) {
      return this.markAmbiguous(begun.attempt, errorMessage(error));
    }
  }

  private async reconcileSubmitting(
    attempt: ProductionMediaTaskAttempt,
  ): Promise<ProductionMediaTaskAttempt> {
    const output = this.deps.db.repos.taskLists.getArtifactByAttempt(
      attempt.id,
      'media_output',
    );
    if (output?.assetHash) {
      return this.markAssetReady(attempt, output, {
        providerJobId: optionalString(output.metadata.providerJobId),
        providerReceipt: optionalString(output.metadata.providerReceipt),
        reportedActualCostUsd: optionalNumber(output.metadata.reportedActualCostUsd),
        model: optionalString(output.metadata.model),
      });
    }
    return this.markAmbiguous(
      attempt,
      'Application resumed after provider submission without a persisted output; automatic resubmission is disabled.',
    );
  }

  private async poll(attempt: ProductionMediaTaskAttempt): Promise<ProductionMediaTaskAttempt> {
    if (!attempt.providerJobId || !attempt.providerReceipt) {
      throw new Error('Awaiting-provider attempt is missing its durable provider receipt');
    }
    const adapter = await this.requireAdapter(attempt);
    const status = await adapter.checkStatus(attempt.providerJobId);
    if (status === JobStatus.Completed) {
      if (!adapter.getResult) {
        return this.markFailed(
          attempt,
          `Provider ${adapter.id} cannot retrieve its completed media result`,
        );
      }
      return this.persistOutput(
        attempt,
        adapter,
        await adapter.getResult(attempt.providerJobId),
      );
    }
    if (status === JobStatus.Failed || status === JobStatus.Dead) {
      return this.markFailed(attempt, `Provider job ${attempt.providerJobId} failed`);
    }
    if (status === JobStatus.Cancelled) {
      const now = this.now();
      return this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
        id: attempt.id,
        expectedRowVersion: attempt.rowVersion,
        expectedStatuses: ['awaiting_provider'],
        status: 'cancelled',
        completedAt: now,
        updatedAt: now,
      });
    }
    return attempt;
  }

  private async persistOutput(
    attempt: ProductionMediaTaskAttempt,
    adapter: AIProviderAdapter,
    generated: GenerationResult,
  ): Promise<ProductionMediaTaskAttempt> {
    const materialized = await this.materialize(generated);
    try {
      const actual = await this.probe(materialized.filePath, attempt.mediaType);
      const imported = await this.deps.cas.importAsset(materialized.filePath, attempt.mediaType);
      const createdAt = this.now();
      const providerJobId = readProviderJobId(generated) ?? attempt.providerJobId;
      const providerReceipt =
        attempt.providerReceipt ??
        JSON.stringify({
          providerId: adapter.id,
          providerJobId: providerJobId ?? null,
          idempotencyKey: attempt.idempotencyKey,
        });
      const model =
        generated.provenance?.model ?? optionalString(generated.metadata?.model) ?? attempt.model;
      const visualStyle =
        attempt.generationSpec.authority.kind === 'task-list-approved'
          ? {
              source: 'visual-constitution' as const,
              policyHash: attempt.generationSpec.authority.constitutionHash,
              taskListId: attempt.taskListId,
              contentHash: attempt.generationSpec.authority.constitutionHash,
            }
          : undefined;
      const entry = this.deps.db.repos.assets.insert({
        ...imported.meta,
        ...actual,
        prompt: attempt.prompt,
        provider: adapter.id,
        displayName: `${attempt.mediaType} generation`,
        tags: [
          attempt.mediaType,
          `canvas:${attempt.canvasId}`,
          `node:${attempt.nodeId}`,
          `task-list:${attempt.taskListId}`,
          `attempt:${attempt.attempt}`,
        ],
        generationMetadata: {
          prompt: attempt.prompt,
          ...(attempt.negativePrompt ? { negativePrompt: attempt.negativePrompt } : {}),
          provider: adapter.id,
          model,
          taskListId: attempt.taskListId,
          taskId: attempt.taskId,
          attemptId: attempt.id,
          promptAssemblyId: attempt.promptAssemblyId,
          promptHash: attempt.promptHash,
          specHash: attempt.specHash,
          referenceAssetHashes: attempt.generationSpec.referenceEvidence.map(
            (reference) => reference.assetHash,
          ),
          estimatedCostUsd: attempt.estimatedCostUsd,
          ...(typeof generated.cost === 'number'
            ? { reportedActualCostUsd: generated.cost }
            : {}),
          ...(visualStyle ? { visualStyle } : {}),
        },
      });
      const artifact: TaskArtifact = {
        id: this.idFactory(),
        taskListId: attempt.taskListId,
        taskId: attempt.taskId,
        attemptId: attempt.id,
        artifactType: 'media_output',
        entityType: 'asset_entry',
        entityId: entry.id,
        assetHash: imported.ref.hash,
        path: imported.ref.path,
        metadata: {
          taskListId: attempt.taskListId,
          taskId: attempt.taskId,
          attemptId: attempt.id,
          assetEntryId: entry.id,
          providerId: adapter.id,
          modelId: model,
          providerJobId,
          providerReceipt,
          promptAssemblyId: attempt.promptAssemblyId,
          promptHash: attempt.promptHash,
          idempotencyKey: attempt.idempotencyKey,
          contentHash: imported.ref.hash,
          specHash: attempt.specHash,
          reportedActualCostUsd: generated.cost,
          width: actual.width,
          height: actual.height,
          duration: actual.duration,
          hasAudio: actual.hasAudio,
          format: imported.ref.format,
        },
        createdAt,
      };
      return this.deps.db.repos.taskLists.recordMediaOutput({
        attemptId: attempt.id,
        expectedAttemptRowVersion: attempt.rowVersion,
        artifact,
        model,
        providerJobId,
        providerReceipt,
        reportedActualCostUsd: generated.cost,
        assetReadyAt: createdAt,
      }).attempt;
    } finally {
      if (materialized.cleanupPath) {
        fs.rmSync(materialized.cleanupPath, { recursive: true, force: true });
      }
    }
  }

  private markAssetReady(
    attempt: ProductionMediaTaskAttempt,
    artifact: TaskArtifact,
    provider: {
      providerJobId?: string;
      providerReceipt?: string;
      reportedActualCostUsd?: number;
      model?: string;
    },
  ): ProductionMediaTaskAttempt {
    if (!artifact.assetHash) throw new Error('Media output artifact is missing its CAS hash');
    const now = this.now();
    return this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
      id: attempt.id,
      expectedRowVersion: attempt.rowVersion,
      expectedStatuses: [attempt.status],
      status: 'asset_ready',
      assetHash: artifact.assetHash,
      assetReadyAt: now,
      updatedAt: now,
      ...provider,
    });
  }

  private failBeforeSubmission(
    attempt: ProductionMediaTaskAttempt,
    message: string,
  ): ProductionMediaTaskAttempt {
    return this.markFailed(attempt, message);
  }

  private markFailed(
    attempt: ProductionMediaTaskAttempt,
    message: string,
  ): ProductionMediaTaskAttempt {
    const now = this.now();
    return this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
      id: attempt.id,
      expectedRowVersion: attempt.rowVersion,
      expectedStatuses: [attempt.status],
      status: 'failed',
      error: message,
      completedAt: now,
      updatedAt: now,
    });
  }

  private markAmbiguous(
    attempt: ProductionMediaTaskAttempt,
    message: string,
  ): ProductionMediaTaskAttempt {
    const now = this.now();
    return this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
      id: attempt.id,
      expectedRowVersion: attempt.rowVersion,
      expectedStatuses: [attempt.status],
      status: 'ambiguous',
      error: message,
      completedAt: now,
      updatedAt: now,
    });
  }

  private requireAttempt(attemptId: string): ProductionMediaTaskAttempt {
    const attempt = this.deps.db.repos.taskLists.getProductionMediaAttempt(attemptId);
    if (!attempt) throw new Error(`Media generation attempt not found: ${attemptId}`);
    return attempt;
  }

  private async requireAdapter(
    attempt: ProductionMediaTaskAttempt,
  ): Promise<AIProviderAdapter> {
    const adapter = await this.deps.resolveAdapter(attempt);
    if (adapter.id !== attempt.providerId) {
      throw new Error(
        `Resolved adapter ${adapter.id} does not match reserved provider ${attempt.providerId}`,
      );
    }
    return adapter;
  }
}

function readProviderJobId(result: GenerationResult): string | undefined {
  return firstString(result.metadata?.jobId, result.metadata?.taskId, result.metadata?.id);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = optionalString(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTerminal(attempt: ProductionMediaTaskAttempt): boolean {
  return [
    'accepted',
    'repair_required',
    'regenerate_required',
    'human_review',
    'failed',
    'ambiguous',
    'cancelled',
  ].includes(attempt.status);
}
