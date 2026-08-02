import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { IpcMain } from 'electron';
import log from '../../logger.js';
import {
  renderTimeline,
  getOutputExtension,
  type RenderSegment,
  type RenderCodec,
  type RenderPreset,
} from '@lucid-fin/media-engine';
import { assertSafePath, getSafeRoots } from '../path-safety.js';
import type { FinalExportService } from '../../services/final-export.service.js';

type RenderStartArgs = {
  sceneId: string;
  segments?: RenderSegment[];
  outputFormat?: 'mp4' | 'mov' | 'webm';
  resolution?: { width: number; height: number };
  fps?: number;
  codec?: RenderCodec;
  quality?: RenderPreset;
  outputPath?: string;
  workflowRunId?: string;
  expectedManifestRevision?: number;
  expectedManifestHash?: string;
  retry?: boolean;
};

type RenderJob = {
  id: string;
  progress: number;
  stage: 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled';
  outputPath: string;
  error?: string;
  abortController: AbortController;
  completedAt?: number;
};

const runningJobs = new Map<string, RenderJob>();
const COMPLETED_JOB_TTL_MS = 5 * 60 * 1000;

function evictStaleJobs(): void {
  const cutoff = Date.now() - COMPLETED_JOB_TTL_MS;
  for (const [id, job] of runningJobs) {
    if (job.completedAt && job.completedAt < cutoff) {
      runningJobs.delete(id);
    }
  }
}

export function registerRenderHandlers(
  ipcMain: IpcMain,
  finalExportService: FinalExportService,
): void {
  ipcMain.handle('render:start', async (_e, args: RenderStartArgs) => {
    evictStaleJobs();
    if (!args) throw new Error('render:start: request is required');
    if (args.workflowRunId) {
      const expectedManifestRevision = args.expectedManifestRevision;
      const expectedManifestHash = args.expectedManifestHash;
      if (
        !args.sceneId ||
        typeof expectedManifestRevision !== 'number' ||
        !Number.isInteger(expectedManifestRevision) ||
        expectedManifestRevision <= 0 ||
        typeof expectedManifestHash !== 'string' ||
        !expectedManifestHash.match(/^[a-f0-9]{64}$/i)
      ) {
        throw new Error('render:start: exact workflow manifest revision/hash is required');
      }
      if (
        args.segments !== undefined ||
        args.resolution !== undefined ||
        args.fps !== undefined ||
        args.codec !== undefined ||
        args.quality !== undefined
      ) {
        throw new Error(
          'render:start: persistent workflows derive segments and output settings only from the approved manifest',
        );
      }
      return finalExportService.startApproved({
        workflowRunId: args.workflowRunId,
        canvasId: args.sceneId,
        expectedManifestRevision,
        expectedManifestHash,
        ...(args.outputPath ? { destinationPath: args.outputPath } : {}),
        ...(args.retry === true ? { retry: true } : {}),
      });
    }

    finalExportService.assertLegacyRenderAllowed(args.sceneId || undefined);
    if (Array.isArray(args.segments) && args.segments.length === 0) {
      throw new Error('render:start: segments array is required');
    }
    const segments = Array.isArray(args.segments)
      ? args.segments
      : args.sceneId
        ? finalExportService.resolveLegacyCanvasSegments(args.sceneId)
        : undefined;
    if (!segments?.length) throw new Error('render:start: segments array is required');
    if (!args.outputFormat) throw new Error('render:start: outputFormat is required');

    const codec: RenderCodec = args.codec ?? (args.outputFormat === 'mov' ? 'prores' : 'h264');
    const quality: RenderPreset = args.quality ?? 'standard';
    const width = args.resolution?.width ?? 1920;
    const height = args.resolution?.height ?? 1080;
    const fps = args.fps ?? 24;
    const ext = getOutputExtension(codec);
    const outputPath = args.outputPath
      ? assertSafePath(args.outputPath, getSafeRoots())
      : path.join(os.tmpdir(), `lucid-render-${Date.now()}.${ext}`);

    const jobId = randomUUID();
    const job: RenderJob = {
      id: jobId,
      progress: 0,
      stage: 'queued',
      outputPath,
      abortController: new AbortController(),
    };
    runningJobs.set(jobId, job);

    log.info('render:start', {
      jobId,
      codec,
      quality,
      outputPath,
      segmentCount: segments.length,
    });

    void (async () => {
      try {
        job.stage = 'rendering';
        job.progress = 10;
        await renderTimeline(segments, outputPath, {
          codec,
          preset: quality,
          width,
          height,
          fps,
          signal: job.abortController.signal,
        });
        job.stage = 'completed';
        job.progress = 100;
        job.completedAt = Date.now();
        log.info('render:complete', { jobId, outputPath });
      } catch (error) {
        job.stage = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        job.completedAt = Date.now();
        log.error('render:failed', { jobId, error: job.error });
      }
    })();

    return { jobId, outputPath, duration: 0, format: args.outputFormat };
  });

  ipcMain.handle('render:status', async (_e, args: { jobId: string }) => {
    if (!args?.jobId) throw new Error('render:status: jobId required');
    const persistentStatus = finalExportService.getStatus(args.jobId);
    if (persistentStatus.stage !== 'unknown') return persistentStatus;
    const job = runningJobs.get(args.jobId);
    if (!job) return { progress: 0, stage: 'unknown' as const };
    return {
      progress: job.progress,
      stage: job.stage,
      outputPath: job.outputPath,
      error: job.error,
    };
  });

  ipcMain.handle('render:cancel', async (_e, args: { jobId: string }) => {
    if (!args?.jobId) throw new Error('render:cancel: jobId required');
    const persistentStatus = finalExportService.getStatus(args.jobId);
    if (persistentStatus.stage !== 'unknown') {
      finalExportService.cancel(args.jobId);
      return;
    }
    const job = runningJobs.get(args.jobId);
    if (!job) return;
    job.abortController.abort();
    job.stage = 'cancelled';
    job.completedAt = Date.now();
    log.info('render:cancel', args.jobId);
  });
}
