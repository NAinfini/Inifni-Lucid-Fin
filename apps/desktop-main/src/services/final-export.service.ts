import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  FinalExportManifestContent,
  WorkflowExportExecution,
  WorkflowRun,
  WorkflowRunId,
} from '@lucid-fin/contracts';
import type { WorkflowEngine } from '@lucid-fin/application';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import { renderTimeline, resolveFfmpegBinary, type RenderSegment } from '@lucid-fin/media-engine';
import log from '../logger.js';
import { assertSafePath, getSafeRoots } from '../ipc/path-safety.js';

export interface FinalExportStartInput {
  workflowRunId: string;
  canvasId: string;
  expectedManifestRevision: number;
  expectedManifestHash: string;
  destinationPath?: string;
  retry?: boolean;
}

export interface FinalExportStartResult {
  jobId: string;
  outputPath: string;
  duration: number;
  format: 'mp4' | 'mov';
}

export interface FinalExportStatus {
  progress: number;
  stage: 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled' | 'unknown';
  outputPath?: string;
  error?: string;
}

type RenderTimeline = typeof renderTimeline;

export interface FinalExportServiceOptions {
  db: SqliteIndex;
  cas: CAS;
  workflowEngine: WorkflowEngine;
  renderTimeline?: RenderTimeline;
  resolveFfmpegBinary?: typeof resolveFfmpegBinary;
  now?: () => number;
  idFactory?: () => string;
  stagingRoot?: string;
  defaultOutputRoot?: string;
}

type RunningJob = {
  abortController: AbortController;
  progress: number;
};

const UNBOUND_TERMINAL_STATUSES = new Set<WorkflowRun['status']>(['cancelled', 'dead']);
const FFMPEG_PACKAGED_VERSION = '8.1.2';

export class FinalExportService {
  private readonly renderTimelineImpl: RenderTimeline;
  private readonly resolveFfmpegBinaryImpl: typeof resolveFfmpegBinary;
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly stagingRoot: string;
  private readonly defaultOutputRoot: string;
  private readonly runningJobs = new Map<string, RunningJob>();

  constructor(private readonly options: FinalExportServiceOptions) {
    this.renderTimelineImpl = options.renderTimeline ?? renderTimeline;
    this.resolveFfmpegBinaryImpl = options.resolveFfmpegBinary ?? resolveFfmpegBinary;
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory ?? randomUUID;
    this.stagingRoot = options.stagingRoot ?? path.join(os.tmpdir(), 'lucid-final-export');
    this.defaultOutputRoot =
      options.defaultOutputRoot ?? path.join(os.tmpdir(), 'lucid-final-output');
  }

  /** Manual render remains available only when no persistent movie run owns the canvas. */
  assertLegacyRenderAllowed(canvasId?: string): void {
    const runs = this.options.db.repos.workflows.listRuns({
      workflowType: 'movie.production.v2',
      entityType: 'canvas',
    }).rows;
    if (canvasId) {
      const bound = runs.find(
        (run) => run.entityId === canvasId && !UNBOUND_TERMINAL_STATUSES.has(run.status),
      );
      if (bound) {
        throw new Error(
          `Canvas "${canvasId}" is owned by persistent workflow "${bound.id}"; use its exact approved Final Export manifest`,
        );
      }
      return;
    }
    const active = runs.find((run) => !UNBOUND_TERMINAL_STATUSES.has(run.status));
    if (active) {
      throw new Error(
        'Manual render request has no verifiable canvas while a persistent movie workflow is active',
      );
    }
  }

  /** Host-derived inputs for the legacy, unbound canvas renderer. */
  resolveLegacyCanvasSegments(canvasId: string): RenderSegment[] {
    this.assertLegacyRenderAllowed(canvasId);
    const canvas = this.options.db.repos.canvases.get(canvasId as never);
    if (!canvas) throw new Error(`Canvas "${canvasId}" not found`);
    const videoNodes = canvas.nodes
      .filter((node) => node.type === 'video' && !node.bypassed)
      .sort(
        (left, right) =>
          left.position.x - right.position.x ||
          left.position.y - right.position.y ||
          left.id.localeCompare(right.id),
      );
    if (videoNodes.length === 0) {
      throw new Error('Manual canvas render requires at least one non-bypassed video node');
    }
    return videoNodes.map((node) => {
      const data = asRecord(node.data);
      const variants = Array.isArray(data.variants)
        ? data.variants.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const selectedVariantIndex =
        typeof data.selectedVariantIndex === 'number' &&
        Number.isInteger(data.selectedVariantIndex) &&
        data.selectedVariantIndex >= 0
          ? data.selectedVariantIndex
          : 0;
      const assetHash =
        variants[selectedVariantIndex] ??
        (typeof data.assetHash === 'string' && data.assetHash.trim() ? data.assetHash : undefined);
      if (!assetHash) throw new Error(`Video node "${node.id}" has no selected asset`);
      const asset = this.options.db.repos.assets.findByHash(assetHash);
      if (!asset || asset.type !== 'video') {
        throw new Error(`Selected video asset "${assetHash}" is missing from the CAS index`);
      }
      const duration =
        typeof data.durationOverride === 'number'
          ? data.durationOverride
          : typeof asset.duration === 'number'
            ? asset.duration
            : typeof data.duration === 'number'
              ? data.duration
              : undefined;
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
        throw new Error(`Video node "${node.id}" has no valid duration`);
      }
      const inputPath = this.options.cas.getAssetPath(assetHash, 'video', asset.format);
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Selected video asset "${assetHash}" is missing from CAS`);
      }
      return { inputPath, startTime: 0, duration, speed: 1 };
    });
  }

  async startApproved(input: FinalExportStartInput): Promise<FinalExportStartResult> {
    const manifestDocument = this.options.workflowEngine.requireApprovedFinalExportManifest(
      input.workflowRunId,
      input.canvasId,
    );
    const manifest = manifestDocument.content as FinalExportManifestContent;
    if (
      manifestDocument.revision !== input.expectedManifestRevision ||
      manifestDocument.contentHash !== input.expectedManifestHash
    ) {
      throw new Error('Final Export manifest revision/hash changed before execution');
    }
    const run = this.options.workflowEngine.get(input.workflowRunId);
    if (!run) throw new Error(`Workflow "${input.workflowRunId}" not found`);
    validateManifestForExecution(manifest, manifestDocument.contentHash);
    const idempotencyKey = createHash('sha256')
      .update(
        [
          'movie.production.v2',
          input.workflowRunId,
          String(run.definitionVersion ?? 1),
          String(manifestDocument.revision),
          manifestDocument.contentHash,
        ].join('|'),
        'utf8',
      )
      .digest('hex');
    const destinationPath = this.resolveDestinationPath(
      input.destinationPath,
      idempotencyKey,
      manifest.output.logicalFileName,
      manifest.output.container,
    );
    const existing = this.options.db.repos.workflows.getLatestExportExecution(
      input.workflowRunId as WorkflowRunId,
    );
    let execution: WorkflowExportExecution;
    if (
      existing &&
      existing.manifestRevision === manifestDocument.revision &&
      existing.manifestHash === manifestDocument.contentHash
    ) {
      if (
        existing.idempotencyKey !== idempotencyKey ||
        existing.destinationPath !== destinationPath
      ) {
        throw new Error('Approved Final Export already has a different execution destination');
      }
      execution = existing;
      if (execution.status === 'completed') return this.startResult(execution, manifest);
      if (
        execution.status === 'queued' ||
        execution.status === 'running' ||
        execution.status === 'ready_to_publish'
      ) {
        return this.startResult(execution, manifest);
      }
      if (!input.retry) {
        throw new Error(
          `Final Export execution is ${execution.status}; an explicit bounded retry is required`,
        );
      }
      if (execution.attempt >= manifest.maxRenderAttempts) {
        throw new Error(
          `Final Export retry budget exhausted (${execution.attempt}/${manifest.maxRenderAttempts})`,
        );
      }
      execution = this.options.db.repos.workflows.retryExportExecution({
        id: execution.id,
        expectedRowVersion: execution.rowVersion,
        updatedAt: this.now(),
      });
    } else {
      if (fs.existsSync(destinationPath)) {
        throw new Error(
          `Final Export destination already exists; overwrite is forbidden: ${destinationPath}`,
        );
      }
      const createdAt = this.now();
      execution = this.options.db.repos.workflows.reserveExportExecution({
        execution: {
          id: this.idFactory(),
          workflowRunId: input.workflowRunId,
          manifestRevision: manifestDocument.revision,
          manifestHash: manifestDocument.contentHash,
          idempotencyKey,
          status: 'queued',
          rowVersion: 0,
          destinationPath,
          attempt: 1,
          createdAt,
          updatedAt: createdAt,
        },
      }).execution;
    }

    if (!this.runningJobs.has(execution.id)) {
      const abortController = new AbortController();
      this.runningJobs.set(execution.id, { abortController, progress: 0 });
      void this.execute(execution, manifest, abortController);
    }
    return this.startResult(execution, manifest);
  }

  getStatus(jobId: string): FinalExportStatus {
    const execution = this.options.db.repos.workflows.getExportExecution(jobId);
    if (!execution) return { progress: 0, stage: 'unknown' };
    const inMemoryProgress = this.runningJobs.get(jobId)?.progress;
    switch (execution.status) {
      case 'queued':
        return {
          progress: inMemoryProgress ?? 0,
          stage: 'queued',
          outputPath: execution.destinationPath,
        };
      case 'running':
        return {
          progress: inMemoryProgress ?? 10,
          stage: 'rendering',
          outputPath: execution.destinationPath,
        };
      case 'ready_to_publish':
        return { progress: 90, stage: 'rendering', outputPath: execution.destinationPath };
      case 'completed':
        return { progress: 100, stage: 'completed', outputPath: execution.destinationPath };
      case 'cancelled':
        return { progress: 0, stage: 'cancelled', outputPath: execution.destinationPath };
      case 'failed':
      case 'recovery_required':
        return {
          progress: 0,
          stage: 'failed',
          outputPath: execution.destinationPath,
          error: execution.error,
        };
    }
  }

  cancel(jobId: string): void {
    const execution = this.options.db.repos.workflows.getExportExecution(jobId);
    if (!execution) return;
    this.runningJobs.get(jobId)?.abortController.abort();
    if (execution.status === 'queued' || execution.status === 'running') {
      this.options.db.repos.workflows.transitionExportExecution({
        id: execution.id,
        expectedRowVersion: execution.rowVersion,
        expectedStatuses: [execution.status],
        status: 'cancelled',
        error: 'Cancelled by user',
        updatedAt: this.now(),
      });
    }
    this.runningJobs.delete(jobId);
  }

  /** Recover durable state without blindly re-submitting an interrupted render. */
  recoverInterruptedExecutions(): void {
    for (const execution of this.options.db.repos.workflows.listRecoverableExportExecutions()) {
      if (execution.status === 'ready_to_publish') {
        try {
          this.publishReadyExecution(execution);
        } catch (error) {
          this.markRecoveryRequired(execution, error);
        }
        continue;
      }
      this.markRecoveryRequired(
        execution,
        new Error(
          `Application restarted while Final Export was ${execution.status}; explicit retry is required`,
        ),
      );
    }
  }

  private async execute(
    execution: WorkflowExportExecution,
    manifest: FinalExportManifestContent,
    abortController: AbortController,
  ): Promise<void> {
    let current: WorkflowExportExecution;
    const stagingDir = path.join(this.stagingRoot, execution.id, `attempt-${execution.attempt}`);
    const stagingPath = path.join(stagingDir, manifest.output.logicalFileName);
    try {
      fs.mkdirSync(stagingDir, { recursive: true });
      if (fs.existsSync(stagingPath)) {
        throw new Error(`Final Export staging path already exists: ${stagingPath}`);
      }
      current = this.options.db.repos.workflows.transitionExportExecution({
        id: execution.id,
        expectedRowVersion: execution.rowVersion,
        expectedStatuses: ['queued'],
        status: 'running',
        stagingPath,
        updatedAt: this.now(),
      });
      const running = this.runningJobs.get(execution.id);
      if (running) running.progress = 10;
      const segments = this.resolveSegments(manifest);
      await this.renderTimelineImpl(segments, stagingPath, {
        codec: manifest.output.codec,
        preset: manifest.output.quality,
        width: manifest.output.width,
        height: manifest.output.height,
        fps: manifest.output.fps,
        assetRoot: this.options.cas.getAssetsRoot(),
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) throw new Error('Final Export cancelled');
      const imported = await this.options.cas.importAsset(stagingPath, 'video');
      this.options.db.repos.assets.insert({
        ...imported.meta,
        hash: imported.ref.hash,
        type: 'video',
        format: imported.ref.format,
      });
      const outputSize = fs.statSync(imported.ref.path).size;
      current = this.options.db.repos.workflows.transitionExportExecution({
        id: current.id,
        expectedRowVersion: current.rowVersion,
        expectedStatuses: ['running'],
        status: 'ready_to_publish',
        outputAssetHash: imported.ref.hash,
        outputHash: imported.ref.hash,
        outputSize,
        updatedAt: this.now(),
      });
      const publishing = this.runningJobs.get(execution.id);
      if (publishing) publishing.progress = 90;
      this.publishReadyExecution(current, imported.ref.path);
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch (cleanupError) {
        log.warn('Final Export staging cleanup failed', {
          category: 'final-export',
          executionId: execution.id,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    } catch (error) {
      const latest = this.options.db.repos.workflows.getExportExecution(execution.id);
      if (latest && latest.status !== 'cancelled' && latest.status !== 'completed') {
        try {
          if (latest.status === 'ready_to_publish') {
            this.markRecoveryRequired(latest, error);
          } else if (latest.status === 'queued' || latest.status === 'running') {
            this.options.db.repos.workflows.transitionExportExecution({
              id: latest.id,
              expectedRowVersion: latest.rowVersion,
              expectedStatuses: [latest.status],
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
              updatedAt: this.now(),
            });
          }
        } catch (transitionError) {
          log.error('Final Export failure persistence failed', {
            category: 'final-export',
            executionId: execution.id,
            error:
              transitionError instanceof Error ? transitionError.message : String(transitionError),
          });
        }
      }
      log.error('Final Export execution failed', {
        category: 'final-export',
        executionId: execution.id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.runningJobs.delete(execution.id);
    }
  }

  private publishReadyExecution(execution: WorkflowExportExecution, knownCasPath?: string): void {
    if (
      execution.status !== 'ready_to_publish' ||
      !execution.outputAssetHash ||
      !execution.outputHash ||
      execution.outputSize === undefined
    ) {
      throw new Error('Final Export execution has no complete CAS output to publish');
    }
    const run = this.options.workflowEngine.get(execution.workflowRunId);
    if (!run?.entityId) throw new Error('Final Export workflow canvas binding is missing');
    const manifestDocument = this.options.workflowEngine.requireApprovedFinalExportManifest(
      execution.workflowRunId,
      run.entityId,
    );
    if (
      manifestDocument.revision !== execution.manifestRevision ||
      manifestDocument.contentHash !== execution.manifestHash
    ) {
      throw new Error('Final Export execution no longer matches the exact approved manifest');
    }
    const asset = this.options.db.repos.assets.findByHash(execution.outputAssetHash);
    if (!asset || asset.type !== 'video') throw new Error('Final Export CAS output is missing');
    const casPath =
      knownCasPath ??
      this.options.cas.getAssetPath(execution.outputAssetHash, 'video', asset.format);
    if (!fs.existsSync(casPath)) throw new Error('Final Export CAS output file is missing');
    if (fs.existsSync(execution.destinationPath)) {
      const publishedHash = hashFileSync(execution.destinationPath);
      if (publishedHash !== execution.outputHash) {
        throw new Error(
          `Final Export destination exists with different content and will not be overwritten: ${execution.destinationPath}`,
        );
      }
    } else {
      fs.copyFileSync(casPath, execution.destinationPath, fs.constants.COPYFILE_EXCL);
      const handle = fs.openSync(execution.destinationPath, 'r+');
      try {
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
    }
    const completedAt = this.now();
    const currentRun = this.options.workflowEngine.get(execution.workflowRunId);
    if (!currentRun) throw new Error(`Workflow "${execution.workflowRunId}" not found`);
    this.options.db.repos.workflows.completeExportExecution({
      id: execution.id,
      expectedExecutionRowVersion: execution.rowVersion,
      expectedRunRowVersion: currentRun.rowVersion ?? 0,
      outputAssetHash: execution.outputAssetHash,
      outputHash: execution.outputHash,
      outputSize: execution.outputSize,
      completedAt,
      runOutput: {
        finalExport: {
          executionId: execution.id,
          manifestRevision: execution.manifestRevision,
          manifestHash: execution.manifestHash,
          outputAssetHash: execution.outputAssetHash,
          outputHash: execution.outputHash,
          outputSize: execution.outputSize,
          destinationPath: execution.destinationPath,
          toolchain: {
            ffmpegBinary: this.resolveFfmpegBinaryImpl('ffmpeg'),
            expectedPackagedVersion: FFMPEG_PACKAGED_VERSION,
            license: 'LGPL',
          },
        },
      },
      event: {
        workflowRunId: execution.workflowRunId,
        eventId: this.idFactory(),
        actor: 'system',
        correlationId: execution.id,
        payload: {
          type: 'workflow.final_export.completed',
          executionId: execution.id,
          manifestRevision: execution.manifestRevision,
          manifestHash: execution.manifestHash,
          outputAssetHash: execution.outputAssetHash,
          outputHash: execution.outputHash,
          outputSize: execution.outputSize,
        },
        timestamp: completedAt,
      },
    });
  }

  private markRecoveryRequired(execution: WorkflowExportExecution, error: unknown): void {
    if (
      execution.status === 'completed' ||
      execution.status === 'failed' ||
      execution.status === 'cancelled' ||
      execution.status === 'recovery_required'
    ) {
      return;
    }
    this.options.db.repos.workflows.transitionExportExecution({
      id: execution.id,
      expectedRowVersion: execution.rowVersion,
      expectedStatuses: [execution.status],
      status: 'recovery_required',
      error: error instanceof Error ? error.message : String(error),
      updatedAt: this.now(),
    });
  }

  private resolveSegments(manifest: FinalExportManifestContent): RenderSegment[] {
    return manifest.segments.map((segment, index) => {
      if (
        segment.order !== index ||
        segment.speed !== 1 ||
        segment.trimInMs !== 0 ||
        segment.trimOutMs !== segment.sourceDurationMs
      ) {
        throw new Error('Final Export currently supports only ordered full clips at normal speed');
      }
      const asset = this.options.db.repos.assets.findByHash(segment.assetHash);
      if (!asset || asset.type !== 'video' || asset.format !== segment.assetFormat) {
        throw new Error(`Final Export source asset "${segment.assetHash}" is missing or changed`);
      }
      const inputPath = this.options.cas.getAssetPath(
        segment.assetHash,
        'video',
        segment.assetFormat,
      );
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Final Export source file "${segment.assetHash}" is missing from CAS`);
      }
      return {
        inputPath,
        startTime: segment.sourceStartSeconds,
        duration: segment.durationSeconds,
        speed: segment.speed,
      };
    });
  }

  private resolveDestinationPath(
    requested: string | undefined,
    idempotencyKey: string,
    logicalFileName: string,
    container: 'mp4' | 'mov',
  ): string {
    const defaultDir = this.defaultOutputRoot;
    fs.mkdirSync(defaultDir, { recursive: true });
    const candidate = requested
      ? assertSafePath(requested, getSafeRoots())
      : path.join(defaultDir, `${idempotencyKey.slice(0, 12)}-${logicalFileName}`);
    if (path.extname(candidate).toLowerCase() !== `.${container}`) {
      throw new Error(`Final Export destination must use the .${container} extension`);
    }
    if (!fs.existsSync(path.dirname(candidate))) {
      throw new Error(
        `Final Export destination directory does not exist: ${path.dirname(candidate)}`,
      );
    }
    return candidate;
  }

  private startResult(
    execution: WorkflowExportExecution,
    manifest: FinalExportManifestContent,
  ): FinalExportStartResult {
    return {
      jobId: execution.id,
      outputPath: execution.destinationPath,
      duration: manifest.estimatedDurationSeconds,
      format: manifest.output.container,
    };
  }
}

function validateManifestForExecution(
  manifest: FinalExportManifestContent,
  contentHash: string,
): void {
  if (
    manifest.manifestVersion !== 1 ||
    !Array.isArray(manifest.segments) ||
    manifest.segments.length === 0 ||
    !Array.isArray(manifest.audioTracks) ||
    !Array.isArray(manifest.subtitleTracks) ||
    manifest.audioTracks.length !== 0 ||
    manifest.subtitleTracks.length !== 0
  ) {
    throw new Error(
      'Approved Final Export manifest contains unsupported or incomplete assembly data',
    );
  }
  const snapshotHash = createHash('sha256')
    .update(
      canonicalJson({
        segments: manifest.segments,
        audioTracks: manifest.audioTracks,
        subtitleTracks: manifest.subtitleTracks,
      }),
      'utf8',
    )
    .digest('hex');
  if (snapshotHash !== manifest.assemblySnapshotHash) {
    throw new Error('Approved Final Export assembly snapshot hash is inconsistent');
  }
  if (!/^[a-f0-9]{64}$/i.test(contentHash)) {
    throw new Error('Approved Final Export content hash is invalid');
  }
}

function hashFileSync(filePath: string): string {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const handle = fs.openSync(filePath, 'r');
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

export function createFinalExportService(options: FinalExportServiceOptions): FinalExportService {
  return new FinalExportService(options);
}
