import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { IpcMain } from 'electron';
import log from '../../logger.js';
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

import type {
  CanvasGenerationDeps,
  GenerateArgs,
  EstimateArgs,
  CancelArgs,
  SendTarget,
  RunningCanvasJob,
} from './generation-helpers.js';
import {
  normalizeOptionalString,
  normalizeErrorMessage,
  capitalizeUpdateStatus,
  materializeAsset,
  materializeGenerationRequest,
  requireGenerateArgs,
  requireEstimateArgs,
  requireCancelArgs,
} from './generation-helpers.js';
import { buildGenerationContext, mapGenerationTypeToAssetType } from './generation-context.js';
import { autoChainVideoFrame } from './video-chain.js';
import { runLipSyncPostProcess } from './lipsync.handlers.js';

// Re-export for external consumers
export { applyStyleGuideDefaultsToEmptyTracks } from './generation-prompt-compiler.js';

// ---------------------------------------------------------------------------
// Running job state
// ---------------------------------------------------------------------------

const runningJobs = new Map<string, RunningCanvasJob>();

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

export function registerCanvasGenerationHandlers(ipcMain: IpcMain, deps: CanvasGenerationDeps): void {
  ipcMain.handle('canvas:generate', async (event, args: GenerateArgs) => {
    return startCanvasGeneration(event.sender, args, deps);
  });

  ipcMain.handle('canvas:cancelGeneration', async (event, args: CancelArgs) => {
    await cancelCanvasGeneration(event.sender, args, deps);
  });

  ipcMain.handle('canvas:estimateCost', async (_event, args: EstimateArgs) => {
    try {
      const parsed = requireEstimateArgs(args);
      const context = await buildGenerationContext(deps, {
        canvasId: parsed.canvasId,
        nodeId: parsed.nodeId,
        requestedProviderId: parsed.providerId,
        requestedProviderConfig: parsed.providerConfig,
        requestedVariantCount: undefined,
        requestedSeed: undefined,
      });
      const estimate = context.adapter.estimateCost(context.requestBase);
      setNodeEstimatedCost(context.node, estimate.estimatedCost);
      touchCanvas(context.canvas, deps);
      return { estimatedCost: estimate.estimatedCost, currency: estimate.currency };
    } catch (err) {
      log.warn('estimateCost failed, falling back to 0', { error: String(err) });
      return { estimatedCost: 0, currency: 'USD' };
    }
  });
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelCanvasGeneration(
  sender: SendTarget,
  args: CancelArgs,
  deps: CanvasGenerationDeps,
): Promise<void> {
  const parsed = requireCancelArgs(args);
  const key = runningKey(parsed.canvasId, parsed.nodeId);
  const running = runningJobs.get(key);
  if (!running) return;

  running.cancelled = true;
  running.cancelReason = 'Generation cancelled by user';
  sendProgress(sender, parsed.canvasId, parsed.nodeId, 0, 'cancelling');

  // Send failed event so frontend updates node status
  sender.send('canvas:generation:failed', {
    canvasId: parsed.canvasId,
    nodeId: parsed.nodeId,
    error: 'Cancelled by user',
  });

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
  sender: SendTarget,
  args: GenerateArgs,
  deps: CanvasGenerationDeps,
): Promise<{ jobId: string }> {
  const { canvasId, nodeId } = requireGenerateArgs(args);
  const key = runningKey(canvasId, nodeId);
  if (runningJobs.has(key)) {
    throw new Error(`Generation already running for node ${nodeId}`);
  }

  const context = await buildGenerationContext(deps, {
    canvasId,
    nodeId,
    requestedProviderId: normalizeOptionalString(args.providerId),
    requestedProviderConfig: args.providerConfig,
    requestedVariantCount: args.variantCount,
    requestedSeed: args.seed,
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

  sendProgress(sender, canvasId, nodeId, 1, 'queued');

  void executeGeneration({
    sender,
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
  sender: SendTarget;
  deps: CanvasGenerationDeps;
  context: import('./generation-helpers.js').BuiltGenerationContext;
  runningJob: RunningCanvasJob;
  initialEstimatedCost: number;
}): Promise<void> {
  const { sender, deps, context, runningJob, initialEstimatedCost } = args;
  const { canvas, node, adapter, requestBase, generationType, variantCount, baseSeed } = context;
  const key = runningKey(runningJob.canvasId, runningJob.nodeId);
  const startedAt = Date.now();
  const variantHashes: string[] = [];
  let totalCost = 0;

  try {
    for (let index = 0; index < variantCount; index += 1) {
      throwIfCancelled(runningJob);
      const progress = Math.round((index / variantCount) * 100);
      sendProgress(sender, runningJob.canvasId, runningJob.nodeId, progress, `Generating variant ${index + 1}`);

      const variantSeed = typeof baseSeed === 'number' ? baseSeed + index : undefined;
      const variantRequest = materializeGenerationRequest(
        { ...requestBase, seed: variantSeed },
        deps.cas,
      );
      const generated = await runAdapterGeneration({
        adapter,
        request: variantRequest,
        sender,
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
          prompt: requestBase.prompt,
          provider: adapter.id,
          tags: [
            'canvas',
            `canvas:${runningJob.canvasId}`,
            `node:${runningJob.nodeId}`,
            `variant:${index + 1}`,
          ],
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
            log.warn('[canvas:generation] auto-chain frame extraction failed', { error: String(err) });
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

    sendProgress(sender, runningJob.canvasId, runningJob.nodeId, 100, 'completed');
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
    sender.send('canvas:generation:complete', {
      canvasId: runningJob.canvasId,
      nodeId: runningJob.nodeId,
      variants: variantHashes,
      primaryAssetHash: variantHashes[0],
      cost: finalCost,
      generationTimeMs,
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
    sender.send('canvas:generation:failed', {
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
  sender: SendTarget;
  runningJob: RunningCanvasJob;
  variantIndex: number;
  variantCount: number;
}): Promise<import('@lucid-fin/contracts').GenerationResult> {
  const { adapter, request, sender, runningJob, variantIndex, variantCount } = input;
  if (!adapter.subscribe) {
    return adapter.generate(request);
  }

  return adapter.subscribe(request, createVariantCallbacks({
    sender,
    runningJob,
    variantIndex,
    variantCount,
  }));
}

function createVariantCallbacks(input: {
  sender: SendTarget;
  runningJob: RunningCanvasJob;
  variantIndex: number;
  variantCount: number;
}): SubscribeCallbacks {
  const { sender, runningJob, variantIndex, variantCount } = input;

  return {
    onQueueUpdate: (update) => {
      collectProviderJobIdFromUpdate(runningJob, update);
      sendProgress(
        sender,
        runningJob.canvasId,
        runningJob.nodeId,
        progressForVariantUpdate(variantIndex, variantCount),
        describeQueueUpdate(variantIndex, update),
      );
    },
    onProgress: (update) => {
      collectProviderJobIdFromUpdate(runningJob, update);
      sendProgress(
        sender,
        runningJob.canvasId,
        runningJob.nodeId,
        progressForVariantUpdate(variantIndex, variantCount, update.percentage),
        describeProgressUpdate(variantIndex, update),
      );
    },
    onLog: (logLine) => {
      sendProgress(
        sender,
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

function setNodeEstimatedCost(node: CanvasNode, estimatedCost: number): void {
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
  node.status = 'generating';
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
  data.status = 'done';
  data.variants = input.variants;
  data.selectedVariantIndex = 0;
  data.assetHash = input.variants[0];
  data.progress = 100;
  data.error = undefined;
  data.generationTimeMs = input.generationTimeMs;
  if (typeof input.cost === 'number') {
    data.cost = input.cost;
    data.estimatedCost = input.cost;
  }
  node.status = 'done';
}

function markNodeFailed(node: CanvasNode, error: string): void {
  const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  data.status = 'failed';
  data.error = error;
  data.progress = undefined;
  node.status = 'failed';
}

function touchCanvas(canvas: Canvas, deps: CanvasGenerationDeps): void {
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

function collectProviderJobId(job: RunningCanvasJob, metadata: Record<string, unknown> | undefined): void {
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
  sender: SendTarget,
  canvasId: string,
  nodeId: string,
  progress: number,
  currentStep?: string,
): void {
  sender.send('canvas:generation:progress', {
    canvasId,
    nodeId,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    currentStep,
  });
}

