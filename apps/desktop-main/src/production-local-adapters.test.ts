import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { detectFfmpeg } from '@lucid-fin/media-engine';
import { createFilesystemMediaCas, type DeliveryManifest } from '@lucid-fin/storage';
import { LOCAL_OLLAMA_PROVIDER_ID } from './production-adapters.js';
import {
  createProductionLocalAdapters,
  resolveFilesystemExportPath,
} from './production-local-adapters.js';

const FORMAT = {
  container: 'mp4' as const,
  videoCodec: 'h264' as const,
  audioCodec: 'aac' as const,
  width: 1280,
  height: 720,
  frameRate: 24,
  quality: 'review' as const,
};

const CONTEXT = {
  actor: 'user' as const,
  causation: { kind: 'direct_ui' as const, actionId: 'action.media.pick' },
  correlationId: 'correlation.media.pick',
};

const HASH = 'a'.repeat(64);
const CREATED_AT = '2026-08-28T00:00:00.000Z';
const FIXTURE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2dgAAAABJRU5ErkJggg==',
  'base64',
);
const executeFile = promisify(execFile);

async function* bytesOf(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

async function consume(bytes: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of bytes) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function createFixtureVideo(outputPath: string): Promise<void> {
  await executeFile(
    detectFfmpeg(),
    [
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=16x16:r=25:d=1',
      '-an',
      '-c:v',
      'libopenh264',
      '-pix_fmt',
      'yuv420p',
      '-y',
      outputPath,
    ],
    { windowsHide: true },
  );
}

function deliveryManifest(blobHash: string): DeliveryManifest {
  return {
    authority: 'delivery_manifest',
    id: 'manifest.local',
    projectId: 'project.local',
    revision: 0,
    contentHash: HASH,
    sourcePlan: { authority: 'delivery', id: 'delivery.local', revision: 0, contentHash: HASH },
    formatIntent: FORMAT,
    items: [
      {
        deliveryItemId: 'delivery-item.local',
        deliveryItemRevision: 0,
        deliveryItemContentHash: HASH,
        shotId: 'shot.local',
        shotRevision: 0,
        shotContentHash: HASH,
        generatedResultId: 'result.local',
        generatedResultRevision: 0,
        generatedResultContentHash: HASH,
        projectMediaRefId: 'project-media.local',
        projectMediaRevision: 0,
        projectMediaContentHash: HASH,
        globalAssetId: 'asset.local',
        globalAssetRevision: 0,
        globalAssetContentHash: HASH,
        blobHash,
        order: 0,
        trimStartMs: 0,
        trimEndMs: 1_000,
        audioPolicy: 'mute',
        transition: { kind: 'cut', durationMs: 0 },
        reviewState: 'approved',
      },
    ],
    currentChoices: [],
    protections: [],
    createdBy: { kind: 'direct_ui', actionId: 'action.local.render' },
    frozenAt: CREATED_AT,
  };
}

describe('production local adapters', () => {
  it('keeps selected media paths out of the wire grant and rejects unsafe folder labels', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-local-adapters-'));
    try {
      const selectedFile = join(directory, 'reference.png');
      await writeFile(selectedFile, FIXTURE_PNG);
      const adapters = createProductionLocalAdapters({
        mediaCas: createFilesystemMediaCas(join(directory, 'cas')),
        scratchRoot: join(directory, 'work'),
        model: {
          providerId: LOCAL_OLLAMA_PROVIDER_ID,
          model: 'qwen3:8b',
          reasoningStrength: null,
        },
        mediaPicker: { pick: async () => [selectedFile] },
      });

      const response = await adapters.pickMedia(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.media.pick',
          method: 'os.media.pick',
          input: { kinds: ['image'], multiple: false },
        },
        CONTEXT,
      );
      const grant = response.result;
      expect(JSON.stringify(grant)).not.toContain(directory);
      expect(grant.displayLabel).toBe('reference.png');

      const capability = await adapters.mediaImportCapabilities.resolve(grant.capabilityToken);
      expect(JSON.stringify(capability.descriptor)).not.toContain(directory);
      expect(capability.descriptor.technicalFacts).toEqual({ kind: 'image', width: 1, height: 1 });

      expect(() =>
        resolveFilesystemExportPath(
          { kind: 'folder', path: directory },
          { formatIntent: FORMAT },
          '../outside.mp4',
        ),
      ).toThrow(/unsafe/u);
      expect(() =>
        resolveFilesystemExportPath(
          { kind: 'folder', path: directory },
          { formatIntent: FORMAT },
          'C:\\outside.mp4',
        ),
      ).toThrow(/unsafe/u);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('derives and renders with local FFmpeg, then releases consumed scratch output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-local-ffmpeg-'));
    const startedAt = Date.now();
    const mark = (stage: string) => {
      console.info(`[local-ffmpeg] ${stage} ${Date.now() - startedAt}ms`);
    };
    try {
      const sourcePath = join(directory, 'source.mp4');
      mark('fixture-generation:start');
      await createFixtureVideo(sourcePath);
      mark('fixture-generation:complete');
      const sourceBytes = new Uint8Array(await readFile(sourcePath));
      const source = {
        hash: createHash('sha256').update(sourceBytes).digest('hex'),
        byteLength: sourceBytes.byteLength,
      };
      const mediaCas = createFilesystemMediaCas(join(directory, 'cas'));
      mark('cas-put:start');
      await mediaCas.putVerified(source, bytesOf(sourceBytes));
      mark('cas-put:complete');
      const scratchRoot = join(directory, 'work');
      const adapters = createProductionLocalAdapters({
        mediaCas,
        scratchRoot,
        model: {
          providerId: LOCAL_OLLAMA_PROVIDER_ID,
          model: 'qwen3:8b',
          reasoningStrength: null,
        },
      });

      mark('derive:start');
      const derived = await adapters.localMediaDerivation.derive({
        idempotencyKey: 'derive.local',
        requestHash: HASH,
        source: {
          blob: {
            authority: 'media_blob',
            ...source,
            mimeType: 'video/mp4',
            technicalFacts: {
              kind: 'video',
              width: 16,
              height: 16,
              durationMs: 1_000,
              frameRate: 25,
              hasAudio: false,
            },
            createdAt: CREATED_AT,
          },
          bytes: bytesOf(sourceBytes),
        },
        transform: { operation: 'extractFrames', timecodesMs: [0], imageFormat: 'png' },
        outputCount: 1,
        cancellationRequested: () => false,
      });
      mark('derive:complete');
      expect(derived).toHaveLength(1);
      const derivativePublication = derived[0]!.blob.publication;
      expect(derivativePublication.state).toBe('pending');
      if (derivativePublication.state !== 'pending')
        throw new Error('Expected pending derivative bytes.');
      mark('derivative-publication-consume:start');
      expect((await consume(derivativePublication.bytes)).byteLength).toBeGreaterThan(0);
      mark('derivative-publication-consume:complete');
      expect(await readdir(scratchRoot)).toEqual([]);

      mark('review-render:start');
      const review = await adapters.reviewRenderer.render({
        idempotencyKey: 'review.local',
        requestHash: HASH,
        manifest: deliveryManifest(source.hash),
        range: null,
      });
      mark('review-render:complete');
      mark('review-publication-consume:start');
      expect((await consume(review.blob.bytes)).byteLength).toBeGreaterThan(0);
      mark('review-publication-consume:complete');
      expect(await readdir(scratchRoot)).toEqual([]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);
});
