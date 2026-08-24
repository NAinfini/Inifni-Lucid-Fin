import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryManifestContent, PlanDocument } from '@lucid-fin/contracts';
import { createReviewCutService } from './review-cut.service.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'lucid-review-cut-test-'));
  tempRoots.push(root);
  const sourceA = Buffer.from('approved-video-a');
  const sourceB = Buffer.from('approved-video-b');
  const hashA = createHash('sha256').update(sourceA).digest('hex');
  const hashB = createHash('sha256').update(sourceB).digest('hex');
  const paths = new Map([
    [hashA, path.join(root, `${hashA}.mp4`)],
    [hashB, path.join(root, `${hashB}.mp4`)],
  ]);
  await Promise.all([
    fsp.writeFile(paths.get(hashA)!, sourceA),
    fsp.writeFile(paths.get(hashB)!, sourceB),
  ]);
  const manifest: DeliveryManifestContent = {
    taskListId: 'list-1',
    canvasId: 'canvas-1',
    productionPlan: { revision: 1, contentHash: 'b'.repeat(64) },
    visualConstitution: { revision: 1, contentHash: 'c'.repeat(64) },
    deliverySequence: { revision: 4, contentHash: 'd'.repeat(64) },
    namingPolicy: {
      packageBaseName: 'movie',
      orderPrefixWidth: 2,
      separator: '_',
      overwritePolicy: 'fail',
    },
    items: [
      {
        shotId: 'shot-2',
        selectedVideoHash: hashB,
        packageFileName: '01_second.mp4',
        sourceFileName: 'second.mp4',
        sourceFormat: 'mp4',
        sourceBytes: sourceB.length,
        sourceDurationMs: 3_000,
        hasEmbeddedAudio: false,
        trimInMs: 200,
        trimOutMs: 2_800,
        embeddedAudioEnabled: false,
        provenance: { assetCreatedAt: 2 },
      },
      {
        shotId: 'shot-1',
        selectedVideoHash: hashA,
        packageFileName: '02_first.mp4',
        sourceFileName: 'first.mp4',
        sourceFormat: 'mp4',
        sourceBytes: sourceA.length,
        sourceDurationMs: 2_000,
        hasEmbeddedAudio: true,
        trimInMs: 100,
        trimOutMs: 1_900,
        embeddedAudioEnabled: true,
        provenance: { assetCreatedAt: 1 },
      },
    ],
  };
  const document: PlanDocument = {
    id: 'delivery-document-1',
    taskListId: 'list-1',
    logicalKey: 'delivery-manifest',
    documentType: 'delivery_manifest',
    revision: 2,
    schemaVersion: 1,
    content: manifest,
    contentHash: 'a'.repeat(64),
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  };
  const renderer = vi.fn(async (_input, outputPath: string, options) => {
    options?.onProgress?.({ percentage: 50 });
    await fsp.writeFile(outputPath, 'review-cut');
  });
  const taskExecutionEngine = {
    requireApprovedDeliveryManifest: vi.fn(() => document),
  };
  const service = createReviewCutService({
    db: {
      repos: {
        assets: {
          findByHash: vi.fn((hash: string) => ({ hash, type: 'video', format: 'mp4' })),
        },
      },
    } as never,
    cas: { getAssetPath: vi.fn((hash: string) => paths.get(hash)!) } as never,
    taskExecutionEngine,
    renderer,
    idFactory: () => 'job-1',
  });
  return {
    service,
    renderer,
    taskExecutionEngine,
    manifest,
    paths,
    hashA,
    hashB,
    outputPath: path.join(root, 'review.mp4'),
  };
}

function startInput(outputPath: string) {
  return {
    taskListId: 'list-1',
    canvasId: 'canvas-1',
    expectedManifestRevision: 2,
    expectedManifestHash: 'a'.repeat(64),
    outputPath,
  };
}

describe('ReviewCutService', () => {
  it('renders the exact approved order, trims, audio facts, and fixed preview output', async () => {
    const setupResult = await setup();
    const job = setupResult.service.startApproved(startInput(setupResult.outputPath));

    expect(job.status).toBe('queued');
    await vi.waitFor(() =>
      expect(setupResult.service.getStatus(job.jobId)?.status).toBe('completed'),
    );
    expect(setupResult.renderer).toHaveBeenCalledWith(
      {
        width: 1920,
        height: 1080,
        fps: 30,
        videos: [
          {
            sourcePath: setupResult.paths.get(setupResult.hashB),
            trimInMs: 200,
            trimOutMs: 2_800,
            sourceDurationMs: 3_000,
            embeddedAudioEnabled: false,
            hasEmbeddedAudio: false,
          },
          {
            sourcePath: setupResult.paths.get(setupResult.hashA),
            trimInMs: 100,
            trimOutMs: 1_900,
            sourceDurationMs: 2_000,
            embeddedAudioEnabled: true,
            hasEmbeddedAudio: true,
          },
        ],
      },
      setupResult.outputPath,
      expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }),
    );
    expect(setupResult.service.getStatus(job.jobId)).toMatchObject({
      status: 'completed',
      progress: 100,
      manifestRevision: 2,
      manifestHash: 'a'.repeat(64),
    });
    expect(setupResult.service.requireCompletedOutputPath(job.jobId)).toBe(setupResult.outputPath);
  });

  it('fails before rendering when a CAS source no longer matches its approved hash', async () => {
    const setupResult = await setup();
    await fsp.writeFile(setupResult.paths.get(setupResult.hashB)!, 'tampered-video-b');

    const job = setupResult.service.startApproved(startInput(setupResult.outputPath));
    await vi.waitFor(() => expect(setupResult.service.getStatus(job.jobId)?.status).toBe('failed'));

    expect(setupResult.service.getStatus(job.jobId)?.error).toContain('source hash mismatch');
    expect(setupResult.renderer).not.toHaveBeenCalled();
  });

  it('rejects a stale manifest identity before creating a job', async () => {
    const setupResult = await setup();

    expect(() =>
      setupResult.service.startApproved({
        ...startInput(setupResult.outputPath),
        expectedManifestHash: 'f'.repeat(64),
      }),
    ).toThrow('revision/hash changed');
    expect(setupResult.renderer).not.toHaveBeenCalled();
  });

  it('cancels an active render through its AbortSignal', async () => {
    const setupResult = await setup();
    setupResult.renderer.mockImplementationOnce(
      async (_input, _outputPath, options) =>
        new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const job = setupResult.service.startApproved(startInput(setupResult.outputPath));
    await vi.waitFor(() => expect(setupResult.service.getStatus(job.jobId)?.status).toBe('running'));

    expect(setupResult.service.cancel(job.jobId)?.status).toBe('cancelled');
    await vi.waitFor(() =>
      expect(setupResult.service.getStatus(job.jobId)?.status).toBe('cancelled'),
    );
  });
});
