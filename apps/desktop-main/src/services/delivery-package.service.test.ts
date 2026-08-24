import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DeliveryManifestContent,
  DeliveryPackageTaskAttempt,
  PlanDocument,
} from '@lucid-fin/contracts';
import { createDeliveryPackageService } from './delivery-package.service.js';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

async function setup(overrides?: {
  sourceBytes?: Buffer;
  missingSource?: boolean;
  mutateManifest?: (manifest: DeliveryManifestContent) => void;
  completeFailsOnce?: boolean;
}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'lucid-delivery-test-'));
  tempRoots.push(root);
  const destinationDirectory = path.join(root, 'destination');
  const casDirectory = path.join(root, 'cas');
  await Promise.all([
    fsp.mkdir(destinationDirectory),
    fsp.mkdir(casDirectory),
  ]);
  const sourceBytes = overrides?.sourceBytes ?? Buffer.from('approved-video-bytes');
  const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
  const sourcePath = path.join(casDirectory, `${sourceHash}.mp4`);
  if (!overrides?.missingSource) await fsp.writeFile(sourcePath, sourceBytes);
  const manifestHash = 'a'.repeat(64);
  const manifest: DeliveryManifestContent = {
    taskListId: 'list-1',
    canvasId: 'canvas-1',
    productionPlan: { revision: 1, contentHash: 'b'.repeat(64) },
    visualConstitution: { revision: 1, contentHash: 'c'.repeat(64) },
    deliverySequence: { revision: 4, contentHash: 'd'.repeat(64) },
    namingPolicy: {
      packageBaseName: 'fallback-movie',
      orderPrefixWidth: 2,
      separator: '_',
      overwritePolicy: 'fail',
    },
    items: [
      {
        shotId: 'shot-1',
        selectedVideoHash: sourceHash,
        packageFileName: '01_opening.mp4',
        sourceFileName: 'provider-output.mp4',
        sourceFormat: 'mp4',
        sourceBytes: sourceBytes.length,
        sourceDurationMs: 2_000,
        sourceWidth: 1920,
        sourceHeight: 1080,
        hasEmbeddedAudio: true,
        trimInMs: 100,
        trimOutMs: 1_900,
        embeddedAudioEnabled: true,
        provenance: {
          assetCreatedAt: 100,
          nodeId: 'node-1',
          taskId: 'task-media-1',
          attemptId: 'media-attempt-1',
          evaluationId: 'evaluation-1',
          promptAssemblyId: 'prompt-1',
          providerId: 'provider-1',
          model: 'model-1',
        },
      },
    ],
  };
  overrides?.mutateManifest?.(manifest);
  const document: PlanDocument = {
    id: 'delivery-document-1',
    taskListId: 'list-1',
    logicalKey: 'delivery-manifest',
    documentType: 'delivery_manifest',
    revision: 2,
    schemaVersion: 1,
    content: manifest,
    contentHash: manifestHash,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  };
  let attempt: DeliveryPackageTaskAttempt | undefined;
  let completeShouldFail = overrides?.completeFailsOnce === true;
  let id = 0;
  const taskLists = {
    reserveDeliveryPackageAttempt: vi.fn(
      ({ attempt: proposed }: { attempt: DeliveryPackageTaskAttempt }) => {
        if (attempt) return { attempt, created: false };
        attempt = proposed;
        return { attempt, created: true };
      },
    ),
    getDeliveryPackageAttempt: vi.fn(() => attempt),
    getLatestDeliveryPackageAttempt: vi.fn(() => attempt),
    listRecoverableDeliveryPackageAttempts: vi.fn(() =>
      attempt && ['queued', 'running', 'ready_to_publish', 'recovery_required'].includes(attempt.status)
        ? [attempt]
        : [],
    ),
    transitionDeliveryPackageAttempt: vi.fn((input: Record<string, unknown>) => {
      if (!attempt || attempt.rowVersion !== input.expectedRowVersion) {
        throw new Error('Delivery package execution state changed concurrently');
      }
      if (!(input.expectedStatuses as string[]).includes(attempt.status)) {
        throw new Error('Delivery package execution state changed concurrently');
      }
      attempt = {
        ...attempt,
        status: input.status as DeliveryPackageTaskAttempt['status'],
        rowVersion: attempt.rowVersion + 1,
        updatedAt: input.updatedAt as number,
        ...(input.stagingPath ? { stagingPath: input.stagingPath as string } : {}),
        ...(input.packageHash ? { packageHash: input.packageHash as string } : {}),
        ...(input.packageBytes !== undefined ? { packageBytes: input.packageBytes as number } : {}),
        ...(input.fileCount !== undefined ? { fileCount: input.fileCount as number } : {}),
        ...(input.error ? { error: input.error as string } : { error: undefined }),
      };
      return attempt;
    }),
    retryDeliveryPackageAttempt: vi.fn(() => {
      if (!attempt || !['failed', 'cancelled', 'recovery_required'].includes(attempt.status)) {
        throw new Error('Delivery package execution is not retryable');
      }
      attempt = {
        ...attempt,
        status: 'queued',
        rowVersion: attempt.rowVersion + 1,
        attempt: attempt.attempt + 1,
        stagingPath: undefined,
        packageHash: undefined,
        packageBytes: undefined,
        fileCount: undefined,
        error: undefined,
      };
      return attempt;
    }),
    completeDeliveryPackageAttempt: vi.fn(() => {
      if (completeShouldFail) {
        completeShouldFail = false;
        throw new Error('simulated SQLite completion ambiguity');
      }
      if (!attempt || attempt.status !== 'ready_to_publish') {
        throw new Error('Delivery package attempt is not ready');
      }
      attempt = {
        ...attempt,
        status: 'completed',
        rowVersion: attempt.rowVersion + 1,
        completedAt: 500,
      };
      return { attempt };
    }),
  };
  const engine = {
    get: vi.fn(() => ({
      id: 'list-1',
      rowVersion: 9,
      currentTaskId: 'task-delivery',
    })),
    getDeliveryContext: vi.fn(() => ({
      taskList: engine.get(),
      manifest: document,
      approval: {
        id: 'approval-1',
        taskListId: 'list-1',
        gateKey: 'delivery',
        subjectLogicalKey: 'delivery-manifest',
        subjectRevision: 2,
        subjectHash: manifestHash,
        manifestHash,
        status: 'approved',
        createdAt: 1,
        updatedAt: 1,
      },
    })),
    requireApprovedDeliveryManifest: vi.fn(() => document),
  };
  const service = createDeliveryPackageService({
    db: {
      repos: {
        taskLists,
        assets: {
          findByHash: vi.fn((hash: string) => ({ hash, type: 'video', format: 'mp4' })),
        },
        canvases: { get: vi.fn(() => ({ id: 'canvas-1', name: 'My Movie' })) },
      },
    } as never,
    cas: { getAssetPath: vi.fn(() => sourcePath) } as never,
    taskExecutionEngine: engine as never,
    now: () => 500,
    idFactory: () => `id-${++id}`,
  });
  return {
    service,
    taskLists,
    engine,
    document,
    manifest,
    manifestHash,
    sourceBytes,
    sourceHash,
    sourcePath,
    destinationDirectory,
    finalPath: path.join(destinationDirectory, `My-Movie-delivery-${manifestHash.slice(0, 12)}`),
    getAttempt: () => attempt,
    setAttempt: (next: DeliveryPackageTaskAttempt) => {
      attempt = next;
    },
  };
}

function startInput(destinationDirectory: string, manifestHash = 'a'.repeat(64)) {
  return {
    taskListId: 'list-1',
    canvasId: 'canvas-1',
    expectedManifestRevision: 2,
    expectedManifestHash: manifestHash,
    destinationDirectory,
  };
}

async function waitForStatus(
  service: ReturnType<typeof createDeliveryPackageService>,
  attemptId: string,
  status: DeliveryPackageTaskAttempt['status'],
): Promise<void> {
  await vi.waitFor(() => expect(service.getStatus(attemptId)?.status).toBe(status), {
    timeout: 3_000,
    interval: 10,
  });
}

describe('DeliveryPackageService', () => {
  it('atomically publishes stable names, unchanged bytes, canonical JSON, and RFC 4180 CSV', async () => {
    const target = await setup();
    const started = await target.service.startApproved(startInput(target.destinationDirectory));
    await waitForStatus(target.service, started.attemptId, 'completed');

    expect(path.basename(target.finalPath)).toBe('My-Movie-delivery-aaaaaaaaaaaa');
    expect(await fsp.readFile(path.join(target.finalPath, '01_opening.mp4'))).toEqual(
      target.sourceBytes,
    );
    const manifestJson = JSON.parse(
      await fsp.readFile(path.join(target.finalPath, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(manifestJson).not.toHaveProperty('schemaVersion');
    expect(manifestJson).toMatchObject({
      manifestRevision: 2,
      manifestHash: target.manifestHash,
      items: [{ order: 1, selectedVideoHash: target.sourceHash, trimInMs: 100 }],
    });
    const csv = await fsp.readFile(path.join(target.finalPath, 'manifest.csv'), 'utf8');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).toContain('order,packageFileName,selectedVideoHash');
    expect(csv).toContain('1,01_opening.mp4');
    expect(target.getAttempt()).toMatchObject({ status: 'completed', fileCount: 3 });
    expect((await fsp.readdir(target.destinationDirectory)).filter((name) => name.includes('.staging-'))).toEqual([]);
  });

  it.each([
    ['missing source', { missingSource: true }],
    [
      'hash mismatch',
      {
        mutateManifest: (manifest: DeliveryManifestContent) => {
          manifest.items[0].selectedVideoHash = 'e'.repeat(64);
        },
      },
    ],
    [
      'size mismatch',
      {
        mutateManifest: (manifest: DeliveryManifestContent) => {
          manifest.items[0].sourceBytes += 1;
        },
      },
    ],
  ])('keeps the package all-or-nothing on %s', async (_name, options) => {
    const target = await setup(options);
    const started = await target.service.startApproved(startInput(target.destinationDirectory));
    await waitForStatus(target.service, started.attemptId, 'failed');
    await vi.waitFor(async () =>
      expect(await fsp.readdir(target.destinationDirectory)).toEqual([]),
    );
    expect(fs.existsSync(target.finalPath)).toBe(false);
  });

  it('rejects a package-name collision before reserving or writing anything', async () => {
    const target = await setup({
      mutateManifest: (manifest) => {
        manifest.items.push({
          ...manifest.items[0],
          shotId: 'shot-2',
          packageFileName: manifest.items[0].packageFileName,
        });
      },
    });

    await expect(
      target.service.startApproved(startInput(target.destinationDirectory)),
    ).rejects.toThrow(/Duplicate packageFileName|must start with 02_/);
    expect(target.taskLists.reserveDeliveryPackageAttempt).not.toHaveBeenCalled();
    expect(await fsp.readdir(target.destinationDirectory)).toEqual([]);
  });

  it('fails without overwriting an existing stable destination', async () => {
    const target = await setup();
    await fsp.mkdir(target.finalPath);
    await fsp.writeFile(path.join(target.finalPath, 'keep.txt'), 'keep');

    await expect(
      target.service.startApproved(startInput(target.destinationDirectory)),
    ).rejects.toThrow(/overwrite is forbidden/i);
    expect(await fsp.readFile(path.join(target.finalPath, 'keep.txt'), 'utf8')).toBe('keep');
    expect(target.getAttempt()?.status).toBe('failed');
  });

  it('rejects an exact stale manifest identity before reserving an attempt', async () => {
    const target = await setup();
    await expect(
      target.service.startApproved(startInput(target.destinationDirectory, 'f'.repeat(64))),
    ).rejects.toThrow(/revision\/hash changed/i);
    expect(target.taskLists.reserveDeliveryPackageAttempt).not.toHaveBeenCalled();
  });

  it('cancels active work without publishing a partial package', async () => {
    const target = await setup({ sourceBytes: Buffer.alloc(8 * 1024 * 1024, 7) });
    const started = await target.service.startApproved(startInput(target.destinationDirectory));
    expect(target.service.cancel(started.attemptId)?.status).toBe('cancelled');
    await waitForStatus(target.service, started.attemptId, 'cancelled');
    await vi.waitFor(async () =>
      expect(await fsp.readdir(target.destinationDirectory)).toEqual([]),
    );
  });

  it('recovers pre-publish work to failed, then performs one explicit retry', async () => {
    const target = await setup();
    const attempt: DeliveryPackageTaskAttempt = {
      kind: 'batch_export',
      id: 'recovered-attempt',
      taskListId: 'list-1',
      taskId: 'task-delivery',
      manifestRevision: 2,
      manifestHash: target.manifestHash,
      idempotencyKey: 'identity',
      status: 'running',
      rowVersion: 1,
      stagingPath: `${target.finalPath}.staging-recovered-attempt-attempt-1`,
      destinationPath: target.finalPath,
      attempt: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    target.setAttempt(attempt);
    await fsp.mkdir(attempt.stagingPath!);
    await fsp.writeFile(path.join(attempt.stagingPath!, 'partial'), 'partial');

    await target.service.recoverInterruptedAttempts();
    expect(target.getAttempt()?.status).toBe('failed');
    expect(fs.existsSync(attempt.stagingPath!)).toBe(false);

    await target.service.retry(attempt.id);
    await waitForStatus(target.service, attempt.id, 'completed');
    expect(target.getAttempt()?.attempt).toBe(2);
    expect(fs.existsSync(target.finalPath)).toBe(true);
  });

  it('finishes a publish ambiguity deterministically without creating a second package', async () => {
    const target = await setup({ completeFailsOnce: true });
    const started = await target.service.startApproved(startInput(target.destinationDirectory));
    await waitForStatus(target.service, started.attemptId, 'recovery_required');
    expect(fs.existsSync(target.finalPath)).toBe(true);

    await target.service.recoverInterruptedAttempts();
    await waitForStatus(target.service, started.attemptId, 'completed');
    expect((await fsp.readdir(target.destinationDirectory))).toEqual([
      path.basename(target.finalPath),
    ]);
    expect(target.taskLists.completeDeliveryPackageAttempt).toHaveBeenCalledTimes(2);
  });
});
