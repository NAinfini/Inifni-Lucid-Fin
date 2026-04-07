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

type RenderStartArgs = {
  sceneId: string;
  segments: RenderSegment[];
  outputFormat: 'mp4' | 'mov' | 'webm';
  resolution?: { width: number; height: number };
  fps?: number;
  codec?: RenderCodec;
  quality?: RenderPreset;
  outputPath?: string;
};

type RenderJob = {
  id: string;
  progress: number;
  stage: 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled';
  outputPath: string;
  error?: string;
  abortController: AbortController;
};

const runningJobs = new Map<string, RenderJob>();

export function registerRenderHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('render:start', async (_e, args: RenderStartArgs) => {
    if (!args || !Array.isArray(args.segments) || args.segments.length === 0) {
      throw new Error('render:start: segments array is required');
    }

    const codec: RenderCodec = args.codec ?? (args.outputFormat === 'mov' ? 'prores' : 'h264');
    const quality: RenderPreset = args.quality ?? 'standard';
    const width = args.resolution?.width ?? 1920;
    const height = args.resolution?.height ?? 1080;
    const fps = args.fps ?? 24;
    const ext = getOutputExtension(codec);
    const outputPath = args.outputPath ?? path.join(os.tmpdir(), `lucid-render-${Date.now()}.${ext}`);

    const jobId = randomUUID();
    const job: RenderJob = {
      id: jobId,
      progress: 0,
      stage: 'queued',
      outputPath,
      abortController: new AbortController(),
    };
    runningJobs.set(jobId, job);

    log.info('render:start', { jobId, codec, quality, outputPath, segmentCount: args.segments.length });

    void (async () => {
      try {
        job.stage = 'rendering';
        job.progress = 10;
        await renderTimeline(args.segments, outputPath, { codec, preset: quality, width, height, fps });
        job.stage = 'completed';
        job.progress = 100;
        log.info('render:complete', { jobId, outputPath });
      } catch (error) {
        job.stage = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        log.error('render:failed', { jobId, error: job.error });
      }
    })();

    return { jobId, outputPath, duration: 0, format: args.outputFormat };
  });

  ipcMain.handle('render:status', async (_e, args: { jobId: string }) => {
    if (!args?.jobId) throw new Error('render:status: jobId required');
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
    const job = runningJobs.get(args.jobId);
    if (!job) return;
    job.abortController.abort();
    job.stage = 'cancelled';
    log.info('render:cancel', args.jobId);
  });
}
