import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { DeliveryManifestContent, PlanDocument } from '@lucid-fin/contracts';
import { DeliveryManifestSchema } from '@lucid-fin/contracts-parse';
import {
  renderReviewCut,
  type ReviewCutInput,
  type RenderReviewCutOptions,
} from '@lucid-fin/media-engine';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';

const OUTPUT_WIDTH = 1_920;
const OUTPUT_HEIGHT = 1_080;
const OUTPUT_FPS = 30;
const MAX_RETAINED_JOBS = 100;

export type ReviewCutJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ReviewCutJobView {
  jobId: string;
  status: ReviewCutJobStatus;
  progress: number;
  outputPath: string;
  manifestRevision: number;
  manifestHash: string;
  error?: string;
}

export interface ReviewCutStartInput {
  taskListId: string;
  canvasId: string;
  expectedManifestRevision: number;
  expectedManifestHash: string;
  outputPath: string;
}

interface ReviewCutTaskExecutionEngine {
  requireApprovedDeliveryManifest(taskListId: string, canvasId: string): PlanDocument;
}

type ReviewCutRenderer = (
  input: ReviewCutInput,
  outputPath: string,
  options?: RenderReviewCutOptions,
) => Promise<void>;

export interface ReviewCutServiceOptions {
  db: SqliteIndex;
  cas: CAS;
  taskExecutionEngine: ReviewCutTaskExecutionEngine;
  renderer?: ReviewCutRenderer;
  idFactory?: () => string;
}

interface ReviewCutJob extends ReviewCutJobView {
  abortController: AbortController;
}

export class ReviewCutService {
  private readonly renderer: ReviewCutRenderer;
  private readonly idFactory: () => string;
  private readonly jobs = new Map<string, ReviewCutJob>();

  constructor(private readonly options: ReviewCutServiceOptions) {
    this.renderer = options.renderer ?? renderReviewCut;
    this.idFactory = options.idFactory ?? randomUUID;
  }

  startApproved(input: ReviewCutStartInput): ReviewCutJobView {
    const { document, manifest } = this.requireExactManifest(input);
    const outputPath = validateOutputPath(input.outputPath);
    if (
      [...this.jobs.values()].some(
        (job) =>
          (job.status === 'queued' || job.status === 'running') && job.outputPath === outputPath,
      )
    ) {
      throw new Error(`Review Cut output is already being rendered: ${outputPath}`);
    }
    this.pruneFinishedJobs();
    const job: ReviewCutJob = {
      jobId: this.idFactory(),
      status: 'queued',
      progress: 0,
      outputPath,
      manifestRevision: document.revision,
      manifestHash: document.contentHash,
      abortController: new AbortController(),
    };
    this.jobs.set(job.jobId, job);
    queueMicrotask(() => void this.execute(job, manifest));
    return toView(job);
  }

  getStatus(jobId: string): ReviewCutJobView | null {
    const job = this.jobs.get(jobId);
    return job ? toView(job) : null;
  }

  cancel(jobId: string): ReviewCutJobView | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    if (job.status === 'queued' || job.status === 'running') {
      job.status = 'cancelled';
      job.abortController.abort();
    }
    return toView(job);
  }

  requireCompletedOutputPath(jobId: string): string {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Review Cut job "${jobId}" not found`);
    if (job.status !== 'completed') throw new Error('Only a completed Review Cut can be opened');
    if (!existsSync(job.outputPath)) throw new Error('Completed Review Cut output is missing');
    return job.outputPath;
  }

  private async execute(job: ReviewCutJob, manifest: DeliveryManifestContent): Promise<void> {
    if (job.abortController.signal.aborted) return;
    job.status = 'running';
    try {
      const videos = await this.resolveSources(job, manifest);
      throwIfAborted(job.abortController.signal);
      await this.renderer(
        { videos, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT, fps: OUTPUT_FPS },
        job.outputPath,
        {
          signal: job.abortController.signal,
          onProgress: ({ percentage }) => {
            if (!job.abortController.signal.aborted) {
              job.progress = 10 + Math.floor(percentage * 0.9);
            }
          },
        },
      );
      if (job.abortController.signal.aborted) {
        job.status = 'cancelled';
        return;
      }
      job.status = 'completed';
      job.progress = 100;
    } catch (error) {
      if (job.abortController.signal.aborted) {
        job.status = 'cancelled';
      } else {
        job.status = 'failed';
        job.error = errorMessage(error);
      }
      try {
        await fsp.rm(job.outputPath, { force: true });
      } catch (cleanupError) {
        const message = `Review Cut cleanup failed: ${errorMessage(cleanupError)}`;
        job.error = job.error ? `${job.error}; ${message}` : message;
      }
    }
  }

  private async resolveSources(
    job: ReviewCutJob,
    manifest: DeliveryManifestContent,
  ): Promise<ReviewCutInput['videos']> {
    const videos: ReviewCutInput['videos'] = [];
    for (const [index, item] of manifest.items.entries()) {
      throwIfAborted(job.abortController.signal);
      const asset = this.options.db.repos.assets.findByHash(item.selectedVideoHash);
      if (!asset || asset.type !== 'video' || asset.format !== item.sourceFormat) {
        throw new Error(`Approved Delivery video asset is missing: ${item.selectedVideoHash}`);
      }
      const sourcePath = this.options.cas.getAssetPath(
        item.selectedVideoHash,
        'video',
        item.sourceFormat,
      );
      const stat = await fsp.stat(sourcePath).catch(() => undefined);
      if (!stat?.isFile()) {
        throw new Error(`Approved Delivery source is missing from CAS: ${item.selectedVideoHash}`);
      }
      if (stat.size !== item.sourceBytes) {
        throw new Error(`Approved Delivery source size mismatch: ${item.selectedVideoHash}`);
      }
      const actualHash = await hashFile(sourcePath, job.abortController.signal);
      if (actualHash !== item.selectedVideoHash) {
        throw new Error(`Approved Delivery source hash mismatch: ${item.selectedVideoHash}`);
      }
      videos.push({
        sourcePath,
        trimInMs: item.trimInMs,
        trimOutMs: item.trimOutMs,
        sourceDurationMs: item.sourceDurationMs,
        embeddedAudioEnabled: item.embeddedAudioEnabled,
        hasEmbeddedAudio: item.hasEmbeddedAudio,
      });
      job.progress = Math.floor(((index + 1) / manifest.items.length) * 10);
    }
    return videos;
  }

  private requireExactManifest(input: ReviewCutStartInput): {
    document: PlanDocument;
    manifest: DeliveryManifestContent;
  } {
    const document = this.options.taskExecutionEngine.requireApprovedDeliveryManifest(
      input.taskListId,
      input.canvasId,
    );
    if (
      document.revision !== input.expectedManifestRevision ||
      document.contentHash !== input.expectedManifestHash
    ) {
      throw new Error('Delivery manifest revision/hash changed before Review Cut rendering');
    }
    const manifest = DeliveryManifestSchema.parse(document.content) as DeliveryManifestContent;
    if (manifest.taskListId !== input.taskListId || manifest.canvasId !== input.canvasId) {
      throw new Error('Approved Delivery manifest identity does not match the Review Cut request');
    }
    return { document, manifest };
  }

  private pruneFinishedJobs(): void {
    if (this.jobs.size < MAX_RETAINED_JOBS) return;
    for (const [jobId, job] of this.jobs) {
      if (job.status === 'queued' || job.status === 'running') continue;
      this.jobs.delete(jobId);
      if (this.jobs.size < MAX_RETAINED_JOBS) return;
    }
  }
}

function validateOutputPath(value: string): string {
  if (!path.isAbsolute(value)) throw new Error('Review Cut output path must be absolute');
  if (path.extname(value).toLowerCase() !== '.mp4') {
    throw new Error('Review Cut output path must use the .mp4 extension');
  }
  const outputPath = path.resolve(value);
  const parent = path.dirname(outputPath);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new Error(`Review Cut output directory does not exist: ${parent}`);
  }
  if (existsSync(outputPath)) throw new Error(`Review Cut output already exists: ${outputPath}`);
  return outputPath;
}

async function hashFile(filePath: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath, { signal })) hash.update(chunk);
  return hash.digest('hex');
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error('Review Cut cancelled');
  error.name = 'AbortError';
  throw error;
}

function toView(job: ReviewCutJob): ReviewCutJobView {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    outputPath: job.outputPath,
    manifestRevision: job.manifestRevision,
    manifestHash: job.manifestHash,
    ...(job.error ? { error: job.error } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createReviewCutService(options: ReviewCutServiceOptions): ReviewCutService {
  return new ReviewCutService(options);
}
