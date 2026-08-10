/**
 * Canvas generation service — domain logic for starting, executing, and
 * cancelling canvas node generation jobs.
 *
 * Extracted from canvas-generation.handlers.ts. The handler file now only
 * contains thin IPC routing; all business logic lives here.
 */
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import fs from 'node:fs';
import log from '../../logger.js';
import { providerHealth } from '@lucid-fin/adapters-ai';
import type {
  AudioNodeData,
  Canvas,
  CanvasNode,
  ContentProvenance,
  ImageNodeData,
  ProgressUpdate,
  QueueUpdate,
  SubscribeCallbacks,
  VideoNodeData,
} from '@lucid-fin/contracts';
import { matchNode } from '@lucid-fin/shared-utils';
import {
  canvasGenerationProgressChannel,
  canvasGenerationCompleteChannel,
  canvasGenerationFailedChannel,
} from '@lucid-fin/contracts-parse';
import type { RendererPushGateway } from '../../features/ipc/push-gateway.js';

import type {
  CanvasGenerationDeps,
  GenerateArgs,
  CancelArgs,
  RunningCanvasJob,
} from './generation-helpers.js';
import {
  normalizeOptionalString,
  normalizeErrorMessage,
  capitalizeUpdateStatus,
  mergeVariants,
  materializeAsset,
  probeGeneratedAsset,
  materializeGenerationRequest,
  requireGenerateArgs,
  requireCancelArgs,
} from './generation-helpers.js';
import { buildGenerationContext, mapGenerationTypeToAssetType } from './generation-context.js';
import { assertManualCanvasGenerationAllowed } from './persistent-workflow-guard.js';
import { autoChainVideoFrame } from './video-chain.js';
import { runLipSyncPostProcess } from './lipsync.handlers.js';

// ---------------------------------------------------------------------------
// Running job state
// ---------------------------------------------------------------------------

const runningJobs = new Map<string, RunningCanvasJob>();

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelCanvasGeneration(
  gateway: RendererPushGateway,
  args: CancelArgs,
  deps: CanvasGenerationDeps,
): Promise<void> {
  const parsed = requireCancelArgs(args);
  const key = runningKey(parsed.canvasId, parsed.nodeId);
  const running = runningJobs.get(key);
  if (!running) return;

  running.cancelled = true;
  running.cancelReason = 'Generation cancelled by user';
  sendProgress(gateway, parsed.canvasId, parsed.nodeId, 0, 'cancelling');

  const adapter = deps.adapterRegistry.get(running.adapterId);
  if (!adapter) return;

  for (const providerJobId of running.providerJobIds) {
    try {
      await adapter.cancel(providerJobId);
    } catch (error) {
      log.warn('[canvas:generation] cancel provider job failed', {
        adapterId: adapter.id,
        providerJobId,
        error: String(error),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Start generation
// ---------------------------------------------------------------------------

export async function startCanvasGeneration(
  gateway: RendererPushGateway,
  args: GenerateArgs,
  deps: CanvasGenerationDeps,
): Promise<{ jobId: string }> {
  const { canvasId, nodeId } = requireGenerateArgs(args);
  const key = runningKey(canvasId, nodeId);
  if (runningJobs.has(key)) {
    throw new Error(`Generation already running for node ${nodeId}`);
  }

  assertManualCanvasGenerationAllowed(deps.db, canvasId);

  const context = await buildGenerationContext(deps, {
    canvasId,
    nodeId,
    requestedProviderId: normalizeOptionalString(args.providerId),
    requestedProviderConfig: args.providerConfig,
    requestedVariantCount: args.variantCount,
    requestedSeed: args.seed,
    finalPrompt: normalizeOptionalString(args.finalPrompt),
    promptInputMode: args.promptInputMode,
  });

  log.info('Canvas generation requested', {
    category: 'canvas-generation',
    canvasId,
    nodeId,
    providerId: context.adapter.id,
    generationType: context.generationType,
    mode: context.mode,
    variantCount: context.variantCount,
    hasProviderConfig: Boolean(args.providerConfig),
    requestedProviderId: normalizeOptionalString(args.providerId),
    baseSeed: context.baseSeed,
  });

  const estimated = context.adapter.estimateCost(context.requestBase);
  setNodeEstimatedCost(context.node, estimated.estimatedCost);

  const jobId = randomUUID();
  const runningJob: RunningCanvasJob = {
    jobId,
    canvasId,
    nodeId,
    adapterId: context.adapter.id,
    providerJobIds: new Set<string>(),
    cancelled: false,
  };
  runningJobs.set(key, runningJob);

  markNodeGenerating(context.node, {
    jobId,
    providerId: context.adapter.id,
    variantCount: context.variantCount,
    seed: context.baseSeed,
  });
  touchCanvas(context.canvas, deps);

  sendProgress(gateway, canvasId, nodeId, 1, 'queued');

  void executeGeneration({
    gateway,
    deps,
    context,
    runningJob,
    initialEstimatedCost: estimated.estimatedCost,
  });

  return { jobId };
}

// ---------------------------------------------------------------------------
// Generation execution
// ---------------------------------------------------------------------------

async function executeGeneration(args: {
  gateway: RendererPushGateway;
  deps: CanvasGenerationDeps;
  context: import('./generation-helpers.js').BuiltGenerationContext;
  runningJob: RunningCanvasJob;
  initialEstimatedCost: number;
}): Promise<void> {
  const { gateway, deps, context, runningJob, initialEstimatedCost } = args;
  const { canvas, node, adapter, requestBase, generationType, variantCount, baseSeed } = context;
  const key = runningKey(runningJob.canvasId, runningJob.nodeId);
  const startedAt = Date.now();
  const variantHashes: string[] = [];
  let totalCost = 0;

  try {
    for (let index = 0; index < variantCount; index += 1) {
      throwIfCancelled(runningJob);
      const progress = Math.round((index / variantCount) * 100);
      sendProgress(
        gateway,
        runningJob.canvasId,
        runningJob.nodeId,
        progress,
        `Generating variant ${index + 1}`,
      );

      const variantSeed = typeof baseSeed === 'number' ? baseSeed + index : undefined;
      const variantRequest = materializeGenerationRequest(
        { ...requestBase, seed: variantSeed },
        deps.cas,
      );
      const generated = await runAdapterGeneration({
        adapter,
        request: variantRequest,
        gateway,
        runningJob,
        variantIndex: index,
        variantCount,
      });

      collectProviderJobId(runningJob, generated.metadata);
      throwIfCancelled(runningJob);

      const materialized = await materializeAsset(generated);
      try {
        const assetType = mapGenerationTypeToAssetType(generationType);
        const fileExists = fs.existsSync(materialized.filePath);
        const fileStats = fileExists ? fs.statSync(materialized.filePath) : undefined;
        const actualMedia = await probeGeneratedAsset(
          materialized.filePath,
          assetType,
          deps.probeMedia,
        );
        log.info('[canvas:generation] materialized asset ready for import', {
          canvasId: runningJob.canvasId,
          nodeId: runningJob.nodeId,
          variant: index + 1,
          adapterId: adapter.id,
          assetType,
          filePath: materialized.filePath,
          sourceUrl: materialized.sourceUrl,
          cleanupPath: materialized.cleanupPath,
          fileExists,
          fileSize: fileStats?.size,
        });

        const importedAsset = await (async () => {
          try {
            return await deps.cas.importAsset(materialized.filePath, assetType);
          } catch (error) {
            log.error('[canvas:generation] asset import failed', {
              canvasId: runningJob.canvasId,
              nodeId: runningJob.nodeId,
              variant: index + 1,
              adapterId: adapter.id,
              assetType,
              filePath: materialized.filePath,
              sourceUrl: materialized.sourceUrl,
              cleanupPath: materialized.cleanupPath,
              fileExists,
              fileSize: fileStats?.size,
              error: normalizeErrorMessage(error),
            });
            throw error;
          }
        })();
        const { ref, meta } = importedAsset;
        log.info('[canvas:generation] asset import succeeded', {
          canvasId: runningJob.canvasId,
          nodeId: runningJob.nodeId,
          variant: index + 1,
          adapterId: adapter.id,
          assetType,
          filePath: materialized.filePath,
          hash: ref.hash,
          format: ref.format,
          storedPath: ref.path,
          metaFileSize: meta.fileSize,
          metaOriginalName: meta.originalName,
        });
        deps.db.repos.assets.insert({
          ...meta,
          ...actualMedia,
          prompt: requestBase.prompt,
          provider: adapter.id,
          tags: [
            'canvas',
            `canvas:${runningJob.canvasId}`,
            `node:${runningJob.nodeId}`,
            `variant:${index + 1}`,
          ],
          generationMetadata: {
            prompt: requestBase.prompt,
            negativePrompt: requestBase.negativePrompt ?? undefined,
            provider: adapter.id,
            visualStyle: context.visualStyle,
            seed: variantSeed,
            width: requestBase.width,
            height: requestBase.height,
            sourceImageHash: requestBase.sourceImageHash ?? undefined,
            characterRefs: context.resolvedEntityRefs.characterRefs,
            equipmentRefs: context.resolvedEntityRefs.equipmentRefs,
            locationRefs: context.resolvedEntityRefs.locationRefs,
            frameReferenceHashes: requestBase.frameReferenceImages ?? undefined,
            steps: requestBase.steps ?? undefined,
            cfgScale: requestBase.cfgScale ?? undefined,
            scheduler: requestBase.scheduler ?? undefined,
            img2imgStrength: requestBase.img2imgStrength ?? undefined,
            model:
              generated.provenance?.model ??
              (generated.metadata?.model as string | undefined) ??
              undefined,
            cost: generated.cost ?? undefined,
            resolution:
              requestBase.resolution && actualMedia.width && actualMedia.height
                ? {
                    requested: requestBase.resolution.requested,
                    resolved: requestBase.resolution,
                    actual: { width: actualMedia.width, height: actualMedia.height },
                    estimatedCostUsd:
                      context.resolutionPreflight?.estimatedCostUsd ?? initialEstimatedCost,
                    reportedActualCostUsd: generated.cost ?? undefined,
                  }
                : undefined,
          },
        });

        variantHashes.push(ref.hash);

        // Attach C2PA provenance to result metadata
        const provenance: ContentProvenance = {
          provider: adapter.id,
          promptHash: crypto.createHash('sha256').update(requestBase.prompt).digest('hex'),
          generatedAt: Date.now(),
          softwareAgent: 'Lucid Fin',
          ...(requestBase.sourceImageHash ? { sourceImageHash: requestBase.sourceImageHash } : {}),
        };
        generated.provenance = provenance;
        generated.metadata = { ...(generated.metadata ?? {}), provenance };

        if (typeof generated.cost === 'number') {
          totalCost += generated.cost;
        }
      } finally {
        if (materialized.cleanupPath) {
          fs.rmSync(materialized.cleanupPath, { recursive: true, force: true });
        }
      }
    }

    if (variantHashes.length === 0) {
      throw new Error('Generation produced no assets');
    }

    const generationTimeMs = Date.now() - startedAt;
    const finalCost = totalCost > 0 ? totalCost : initialEstimatedCost;
    markNodeCompleted(node, {
      variants: variantHashes,
      generationTimeMs,
      cost: finalCost,
    });
    touchCanvas(canvas, deps);

    matchNode(node.type, {
      video: () => {
        void autoChainVideoFrame(canvas, node, deps.cas)
          .then(() => touchCanvas(canvas, deps))
          .catch((err) => {
            log.warn('[canvas:generation] auto-chain frame extraction failed', {
              error: String(err),
            });
          });

        const videoData = node.data as VideoNodeData;
        if (videoData.lipSyncEnabled) {
          void runLipSyncPostProcess(canvas, node, deps).catch((err) => {
            log.warn('[canvas:generation] lip-sync post-processing failed', { error: String(err) });
          });
        }
      },
      image: () => {},
      audio: () => {},
      text: () => {},
      backdrop: () => {},
    });

    sendProgress(gateway, runningJob.canvasId, runningJob.nodeId, 100, 'completed');
    log.info('Canvas generation completed', {
      category: 'canvas-generation',
      canvasId: runningJob.canvasId,
      nodeId: runningJob.nodeId,
      providerId: adapter.id,
      generationType,
      variantCount,
      generatedAssetCount: variantHashes.length,
      generationTimeMs,
      cost: finalCost,
    });
    gateway.emit(canvasGenerationCompleteChannel, {
      canvasId: runningJob.canvasId,
      nodeId: runningJob.nodeId,
      variants: variantHashes,
      primaryAssetHash: variantHashes[0],
      cost: finalCost,
      generationTimeMs,
      characterRefs: context.resolvedEntityRefs.characterRefs,
      equipmentRefs: context.resolvedEntityRefs.equipmentRefs,
      locationRefs: context.resolvedEntityRefs.locationRefs,
      frameReferenceHashes: requestBase.frameReferenceImages ?? undefined,
      sourceImageHash: requestBase.sourceImageHash ?? undefined,
      model: context.compiled?.params?.model as string | undefined,
    });
  } catch (error) {
    const message = normalizeErrorMessage(error);
    log.error('Canvas generation failed', {
      category: 'canvas-generation',
      nodeId: runningJob.nodeId,
      canvasId: runningJob.canvasId,
      providerId: adapter.id,
      generationType,
      variantCount,
      error: message,
    });
    markNodeFailed(node, message);
    touchCanvas(canvas, deps);
    gateway.emit(canvasGenerationFailedChannel, {
      canvasId: runningJob.canvasId,
      nodeId: runningJob.nodeId,
      error: message,
    });
  } finally {
    runningJobs.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Adapter invocation helpers
// ---------------------------------------------------------------------------

async function runAdapterGeneration(input: {
  adapter: import('@lucid-fin/contracts').AIProviderAdapter;
  request: import('@lucid-fin/contracts').GenerationRequest;
  gateway: RendererPushGateway;
  runningJob: RunningCanvasJob;
  variantIndex: number;
  variantCount: number;
}): Promise<import('@lucid-fin/contracts').GenerationResult> {
  const { adapter, request, gateway, runningJob, variantIndex, variantCount } = input;
  try {
    const result = adapter.subscribe
      ? await adapter.subscribe(
          request,
          createVariantCallbacks({
            gateway,
            runningJob,
            variantIndex,
            variantCount,
          }),
        )
      : await adapter.generate(request);
    providerHealth.recordSuccess(adapter.id);
    return result;
  } catch (error) {
    providerHealth.recordFailure(adapter.id);
    throw error;
  }
}

function createVariantCallbacks(input: {
  gateway: RendererPushGateway;
  runningJob: RunningCanvasJob;
  variantIndex: number;
  variantCount: number;
}): SubscribeCallbacks {
  const { gateway, runningJob, variantIndex, variantCount } = input;

  return {
    onQueueUpdate: (update) => {
      collectProviderJobIdFromUpdate(runningJob, update);
      sendProgress(
        gateway,
        runningJob.canvasId,
        runningJob.nodeId,
        progressForVariantUpdate(variantIndex, variantCount),
        describeQueueUpdate(variantIndex, update),
      );
    },
    onProgress: (update) => {
      collectProviderJobIdFromUpdate(runningJob, update);
      sendProgress(
        gateway,
        runningJob.canvasId,
        runningJob.nodeId,
        progressForVariantUpdate(variantIndex, variantCount, update.percentage),
        describeProgressUpdate(variantIndex, update),
      );
    },
    onLog: (logLine) => {
      sendProgress(
        gateway,
        runningJob.canvasId,
        runningJob.nodeId,
        progressForVariantUpdate(variantIndex, variantCount),
        logLine,
      );
    },
  };
}

function progressForVariantUpdate(
  variantIndex: number,
  variantCount: number,
  providerPercentage = 0,
): number {
  const clamped = Math.max(0, Math.min(100, Math.round(providerPercentage)));
  return Math.round(((variantIndex + clamped / 100) / variantCount) * 100);
}

function describeQueueUpdate(variantIndex: number, update: QueueUpdate): string {
  if (update.currentStep) return update.currentStep;
  if (update.status === 'queued' && update.queuePosition != null) {
    return `Queued variant ${variantIndex + 1} (${update.queuePosition})`;
  }
  return capitalizeUpdateStatus(update.status);
}

function describeProgressUpdate(variantIndex: number, update: ProgressUpdate): string {
  return update.currentStep ?? `Generating variant ${variantIndex + 1}`;
}

// ---------------------------------------------------------------------------
// Node mutation helpers
// ---------------------------------------------------------------------------

export function setNodeEstimatedCost(node: CanvasNode, estimatedCost: number): void {
  const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  data.estimatedCost = estimatedCost;
}

function markNodeGenerating(
  node: CanvasNode,
  input: {
    jobId: string;
    providerId: string;
    variantCount: number;
    seed?: number;
  },
): void {
  const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  data.status = 'generating';
  data.progress = 0;
  data.error = undefined;
  data.jobId = input.jobId;
  data.providerId = input.providerId;
  data.variantCount = input.variantCount;
  if (typeof input.seed === 'number') {
    data.seed = input.seed;
  }
}

function markNodeCompleted(
  node: CanvasNode,
  input: {
    variants: string[];
    generationTimeMs: number;
    cost?: number;
  },
): void {
  const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  const merged = mergeVariants(data.variants ?? [], input.variants);
  data.status = 'done';
  data.variants = merged.variants;
  data.selectedVariantIndex = merged.selectedVariantIndex;
  data.assetHash = merged.variants[merged.selectedVariantIndex];
  data.progress = 100;
  data.error = undefined;
  data.generationTimeMs = input.generationTimeMs;
  if (typeof input.cost === 'number') {
    data.cost = input.cost;
    data.estimatedCost = input.cost;
  }
}

function markNodeFailed(node: CanvasNode, error: string): void {
  const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  data.status = 'failed';
  data.error = error;
  data.progress = undefined;
}

export function touchCanvas(canvas: Canvas, deps: CanvasGenerationDeps): void {
  const now = Date.now();
  canvas.updatedAt = now;
  deps.canvasStore.save(canvas);
}

// ---------------------------------------------------------------------------
// Job tracking helpers
// ---------------------------------------------------------------------------

function runningKey(canvasId: string, nodeId: string): string {
  return `${canvasId}:${nodeId}`;
}

function throwIfCancelled(job: RunningCanvasJob): void {
  if (job.cancelled) {
    throw new Error(job.cancelReason ?? 'Generation cancelled');
  }
}

function collectProviderJobId(
  job: RunningCanvasJob,
  metadata: Record<string, unknown> | undefined,
): void {
  if (!metadata) return;
  const providerTaskId = normalizeOptionalString(
    (metadata.jobId as string | undefined) ??
      (metadata.taskId as string | undefined) ??
      (metadata.id as string | undefined),
  );
  if (providerTaskId) {
    job.providerJobIds.add(providerTaskId);
  }
}

function collectProviderJobIdFromUpdate(
  job: RunningCanvasJob,
  update: QueueUpdate | ProgressUpdate,
): void {
  if (update.jobId) {
    job.providerJobIds.add(update.jobId);
  }
}

function sendProgress(
  gateway: RendererPushGateway,
  canvasId: string,
  nodeId: string,
  progress: number,
  currentStep?: string,
): void {
  gateway.emit(canvasGenerationProgressChannel, {
    canvasId,
    nodeId,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    currentStep,
  });
}
