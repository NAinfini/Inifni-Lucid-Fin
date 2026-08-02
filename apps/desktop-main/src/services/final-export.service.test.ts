import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  FinalExportManifestContent,
  WorkflowDocument,
  WorkflowExportExecution,
  WorkflowRun,
} from '@lucid-fin/contracts';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import type { WorkflowEngine } from '@lucid-fin/application';
import { createFinalExportService } from './final-export.service.js';

vi.mock('../logger.js', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

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

function sha(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function manifest(sourceHash: string): WorkflowDocument {
  const segments = [
    {
      order: 0,
      nodeId: 'shot-1',
      nodeUpdatedAt: 100,
      title: 'Shot 1',
      assetHash: sourceHash,
      assetFormat: 'mp4',
      selectedVariantIndex: 0,
      trimInMs: 0,
      trimOutMs: 5000,
      sourceDurationMs: 5000,
      sourceStartSeconds: 0,
      durationSeconds: 5,
      speed: 1,
    },
  ];
  const assemblySnapshotHash = sha(
    canonicalJson({ segments, audioTracks: [], subtitleTracks: [] }),
  );
  const content: FinalExportManifestContent = {
    manifestVersion: 1,
    workflowRunId: 'run-1',
    productionPlan: { revision: 1, contentHash: '1'.repeat(64) },
    visualConstitution: { revision: 1, contentHash: '2'.repeat(64) },
    canvasId: 'canvas-1',
    assemblySnapshotHash,
    segments,
    audioTracks: [],
    subtitleTracks: [],
    output: {
      container: 'mp4',
      codec: 'h264',
      quality: 'standard',
      width: 1920,
      height: 1080,
      fps: 24,
      logicalFileName: 'Signal.mp4',
      audioCodec: 'aac',
      pixelFormat: 'yuv420p',
      overwritePolicy: 'fail',
    },
    expectedDurationMs: 5000,
    estimatedDurationSeconds: 5,
    maxRenderAttempts: 2,
    capabilities: {
      embeddedClipAudio: true,
      separateAudioMix: false,
      subtitles: false,
    },
  };
  return {
    id: 'manifest-1',
    workflowRunId: 'run-1',
    logicalKey: 'final-export',
    documentType: 'final_export_manifest',
    revision: 1,
    schemaVersion: 1,
    content,
    contentHash: 'a'.repeat(64),
    status: 'active',
    createdAt: 100,
    updatedAt: 100,
  };
}

function harness(root: string, approved = true, sourceExists = true) {
  const sourceHash = 'b'.repeat(64);
  const outputHash = 'c'.repeat(64);
  const sourcePath = path.join(root, `${sourceHash}.mp4`);
  const outputCasPath = path.join(root, `${outputHash}.mp4`);
  if (sourceExists) fs.writeFileSync(sourcePath, 'source-video');
  const document = manifest(sourceHash);
  const run: WorkflowRun = {
    id: 'run-1',
    workflowType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status: 'ready',
    summary: '',
    progress: 90,
    completedStages: 0,
    totalStages: 0,
    completedTasks: 0,
    totalTasks: 0,
    currentStageId: 'final-export',
    input: {},
    output: {},
    metadata: {},
    createdAt: 1,
    updatedAt: 1,
    rowVersion: 3,
    engineVersion: 'persistent-hybrid-v1',
    definitionVersion: 1,
  };
  const executions = new Map<string, WorkflowExportExecution>();
  const assets = new Map<
    string,
    { hash: string; type: 'video'; format: string; duration?: number }
  >([[sourceHash, { hash: sourceHash, type: 'video', format: 'mp4', duration: 5 }]]);
  const reserve = vi.fn(({ execution }: { execution: WorkflowExportExecution }) => {
    executions.set(execution.id, execution);
    return { execution, created: true };
  });
  const workflows = {
    listRuns: vi.fn(() => ({ rows: [], degradedCount: 0 })),
    getLatestExportExecution: vi.fn(() => [...executions.values()].at(-1)),
    getExportExecution: vi.fn((id: string) => executions.get(id)),
    reserveExportExecution: reserve,
    retryExportExecution: vi.fn(),
    listRecoverableExportExecutions: vi.fn(() => []),
    transitionExportExecution: vi.fn((input: Record<string, unknown>) => {
      const current = executions.get(input.id as string)!;
      const next = {
        ...current,
        status: input.status as WorkflowExportExecution['status'],
        rowVersion: current.rowVersion + 1,
        ...(input.stagingPath ? { stagingPath: input.stagingPath as string } : {}),
        ...(input.outputAssetHash ? { outputAssetHash: input.outputAssetHash as string } : {}),
        ...(input.outputHash ? { outputHash: input.outputHash as string } : {}),
        ...(input.outputSize !== undefined ? { outputSize: input.outputSize as number } : {}),
        ...(input.error ? { error: input.error as string } : {}),
        updatedAt: input.updatedAt as number,
      };
      executions.set(next.id, next);
      return next;
    }),
    completeExportExecution: vi.fn((input: Record<string, unknown>) => {
      const current = executions.get(input.id as string)!;
      const completed = {
        ...current,
        status: 'completed' as const,
        rowVersion: current.rowVersion + 1,
        completedAt: input.completedAt as number,
      };
      executions.set(completed.id, completed);
      run.status = 'completed';
      run.rowVersion = (run.rowVersion ?? 0) + 1;
      return { execution: completed, run, event: { seq: 1 } };
    }),
  };
  const db = {
    repos: {
      workflows,
      assets: {
        findByHash: vi.fn((hash: string) => assets.get(hash)),
        insert: vi.fn((asset: { hash: string; type: 'video'; format: string }) => {
          assets.set(asset.hash, asset);
        }),
      },
    },
  } as unknown as SqliteIndex;
  const cas = {
    getAssetsRoot: () => root,
    getAssetPath: (hash: string) => (hash === sourceHash ? sourcePath : outputCasPath),
    importAsset: vi.fn(async (stagingPath: string) => {
      fs.copyFileSync(stagingPath, outputCasPath);
      return {
        ref: { hash: outputHash, type: 'video' as const, format: 'mp4', path: outputCasPath },
        meta: {
          hash: outputHash,
          type: 'video' as const,
          format: 'mp4',
          fileSize: 12,
          createdAt: 1,
        },
      };
    }),
  } as unknown as CAS;
  const workflowEngine = {
    requireApprovedFinalExportManifest: vi.fn(() => {
      if (!approved) throw new Error('Exact final_export approval is required');
      return document;
    }),
    get: vi.fn(() => run),
  } as unknown as WorkflowEngine;
  const render = vi.fn(async (_segments: unknown, stagingPath: string) => {
    fs.writeFileSync(stagingPath, 'rendered-video');
  });
  const service = createFinalExportService({
    db,
    cas,
    workflowEngine,
    renderTimeline: render as never,
    resolveFfmpegBinary: () => path.join(root, 'ffmpeg.exe'),
    now: (() => {
      let now = 1_000;
      return () => ++now;
    })(),
    idFactory: (() => {
      let id = 0;
      return () => `execution-${++id}`;
    })(),
    stagingRoot: path.join(root, 'staging'),
    defaultOutputRoot: path.join(root, 'output'),
  });
  return {
    service,
    render,
    reserve,
    workflows,
    executions,
    assets,
    sourcePath,
    outputCasPath,
  };
}

describe('FinalExportService', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('does not reserve, start FFmpeg, or write before the exact approval', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-final-service-deny-'));
    roots.push(root);
    const destination = path.join(root, 'Signal.mp4');
    const { service, render, reserve } = harness(root, false);

    await expect(
      service.startApproved({
        workflowRunId: 'run-1',
        canvasId: 'canvas-1',
        expectedManifestRevision: 1,
        expectedManifestHash: 'a'.repeat(64),
        destinationPath: destination,
      }),
    ).rejects.toThrow(/exact final_export approval is required/i);
    expect(reserve).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('renders only CAS paths, publishes without overwrite, persists output, and deduplicates', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-final-service-ok-'));
    roots.push(root);
    const destination = path.join(root, 'Signal.mp4');
    const { service, render, sourcePath } = harness(root);
    const first = await service.startApproved({
      workflowRunId: 'run-1',
      canvasId: 'canvas-1',
      expectedManifestRevision: 1,
      expectedManifestHash: 'a'.repeat(64),
      destinationPath: destination,
    });
    await vi.waitFor(() => {
      const status = service.getStatus(first.jobId);
      if (status.stage === 'failed') throw new Error(status.error ?? 'Final Export failed');
      expect(status.stage).toBe('completed');
    });

    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[0]).toEqual([
      { inputPath: sourcePath, startTime: 0, duration: 5, speed: 1 },
    ]);
    expect(fs.readFileSync(destination, 'utf8')).toBe('rendered-video');
    const repeated = await service.startApproved({
      workflowRunId: 'run-1',
      canvasId: 'canvas-1',
      expectedManifestRevision: 1,
      expectedManifestHash: 'a'.repeat(64),
      destinationPath: destination,
    });
    expect(repeated.jobId).toBe(first.jobId);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('persists a failed execution and never starts FFmpeg when a CAS source is missing', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-final-service-missing-'));
    roots.push(root);
    const destination = path.join(root, 'Signal.mp4');
    const { service, render } = harness(root, true, false);
    const started = await service.startApproved({
      workflowRunId: 'run-1',
      canvasId: 'canvas-1',
      expectedManifestRevision: 1,
      expectedManifestHash: 'a'.repeat(64),
      destinationPath: destination,
    });
    await vi.waitFor(() => expect(service.getStatus(started.jobId).stage).toBe('failed'));
    expect(render).not.toHaveBeenCalled();
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('finishes the ledger after restart when an already-published destination has the exact CAS hash', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-final-service-recover-'));
    roots.push(root);
    const destination = path.join(root, 'Signal.mp4');
    const output = 'already-published-video';
    const outputHash = sha(output);
    const { service, render, workflows, executions, assets, outputCasPath } = harness(root);
    fs.writeFileSync(outputCasPath, output);
    fs.writeFileSync(destination, output);
    assets.set(outputHash, { hash: outputHash, type: 'video', format: 'mp4' });
    const execution: WorkflowExportExecution = {
      id: 'execution-recovery',
      workflowRunId: 'run-1',
      manifestRevision: 1,
      manifestHash: 'a'.repeat(64),
      idempotencyKey: 'd'.repeat(64),
      status: 'ready_to_publish',
      rowVersion: 2,
      destinationPath: destination,
      outputAssetHash: outputHash,
      outputHash,
      outputSize: Buffer.byteLength(output),
      attempt: 1,
      createdAt: 100,
      updatedAt: 200,
    };
    executions.set(execution.id, execution);
    workflows.listRecoverableExportExecutions.mockReturnValueOnce([execution]);

    service.recoverInterruptedExecutions();

    expect(workflows.completeExportExecution).toHaveBeenCalledTimes(1);
    expect(service.getStatus(execution.id).stage).toBe('completed');
    expect(render).not.toHaveBeenCalled();
    expect(fs.readFileSync(destination, 'utf8')).toBe(output);
  });

  it('requires recovery instead of overwriting an existing destination with different bytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-final-service-conflict-'));
    roots.push(root);
    const destination = path.join(root, 'Signal.mp4');
    const output = 'cas-output';
    const outputHash = sha(output);
    const { service, workflows, executions, assets, outputCasPath } = harness(root);
    fs.writeFileSync(outputCasPath, output);
    fs.writeFileSync(destination, 'different-user-file');
    assets.set(outputHash, { hash: outputHash, type: 'video', format: 'mp4' });
    const execution: WorkflowExportExecution = {
      id: 'execution-conflict',
      workflowRunId: 'run-1',
      manifestRevision: 1,
      manifestHash: 'a'.repeat(64),
      idempotencyKey: 'e'.repeat(64),
      status: 'ready_to_publish',
      rowVersion: 2,
      destinationPath: destination,
      outputAssetHash: outputHash,
      outputHash,
      outputSize: Buffer.byteLength(output),
      attempt: 1,
      createdAt: 100,
      updatedAt: 200,
    };
    executions.set(execution.id, execution);
    workflows.listRecoverableExportExecutions.mockReturnValueOnce([execution]);

    service.recoverInterruptedExecutions();

    expect(workflows.completeExportExecution).not.toHaveBeenCalled();
    expect(service.getStatus(execution.id).stage).toBe('failed');
    expect(service.getStatus(execution.id).error).toMatch(/different content/i);
    expect(fs.readFileSync(destination, 'utf8')).toBe('different-user-file');
  });
});
