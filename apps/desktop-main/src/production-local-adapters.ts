import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import {
  type DeliveryManifest,
  type MediaKind,
  type MediaTechnicalFacts,
  type ProviderModel,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/contracts';
import { createCommand, probeMedia, renderReviewCut, runCommand } from '@lucid-fin/media-engine';
import {
  StorageError,
  type LocalDeliveryExporterAdapter,
  type LocalMediaDerivationAdapter,
  type LocalReviewRendererAdapter,
  type MediaCas,
  type MediaImportCapabilityResolver,
  type MediaInspectionAdapter,
  type ProviderCapabilitiesResolver,
} from '@lucid-fin/storage';
import { WirePublicError, type WireHandler } from './ipc/router.js';
import { LOCAL_OLLAMA_PROVIDER_ID, ProviderNotConfiguredError } from './production-adapters.js';

const CAPABILITY_LIFETIME_MS = 5 * 60 * 1_000;
const CHUNK_BYTES = 64 * 1024;

type MediaPickRequest = Extract<WireRequestV1, { readonly method: 'os.media.pick' }>;
type MediaPickSuccess = Extract<WireSuccessV1, { readonly method: 'os.media.pick' }>;

export interface LocalMediaPicker {
  pick(input: MediaPickRequest['input']): Promise<readonly string[] | null>;
}

export interface FilesystemExportGrant {
  readonly kind: 'file' | 'folder';
  readonly path: string;
}

export class UnsupportedLocalCapabilityError extends Error {
  readonly code = 'unsupported' as const;

  constructor(capability: string) {
    super(`The local ${capability} capability is not available in this desktop profile.`);
    this.name = 'UnsupportedLocalCapabilityError';
  }
}

interface ImportCapabilityRecord {
  readonly descriptor: Awaited<ReturnType<typeof createImportDescriptor>>;
  readonly expiresAt: number;
}

function unsupported(capability: string): never {
  throw new UnsupportedLocalCapabilityError(capability);
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Local media operation was cancelled.');
}

function localIdentifier(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`;
}

function mimeForPath(filePath: string): string | null {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.webm':
      return 'video/webm';
    case '.mkv':
      return 'video/x-matroska';
    case '.wav':
      return 'audio/wav';
    case '.mp3':
      return 'audio/mpeg';
    case '.aac':
      return 'audio/aac';
    case '.flac':
      return 'audio/flac';
    default:
      return null;
  }
}

function kindForMime(mimeType: string): Exclude<MediaKind, 'document'> {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  unsupported('document media');
}

function positive(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new Error(`ffprobe did not provide ${label}.`);
  }
  return Math.max(1, Math.round(value));
}

async function technicalFacts(filePath: string, mimeType: string): Promise<MediaTechnicalFacts> {
  const kind = kindForMime(mimeType);
  const probe = await probeMedia(filePath);
  if (kind === 'image') {
    return Object.freeze({
      kind,
      width: positive(probe.width, 'image width'),
      height: positive(probe.height, 'image height'),
    });
  }
  if (kind === 'video') {
    return Object.freeze({
      kind,
      width: positive(probe.width, 'video width'),
      height: positive(probe.height, 'video height'),
      durationMs: positive(probe.durationSeconds * 1_000, 'video duration'),
      frameRate: positive(probe.fps, 'video frame rate'),
      hasAudio: probe.hasAudio,
    });
  }
  return Object.freeze({
    kind,
    durationMs: positive(probe.durationSeconds * 1_000, 'audio duration'),
    sampleRateHz: positive(probe.sampleRateHz, 'audio sample rate'),
    channels: positive(probe.channels, 'audio channels'),
  });
}

async function digestFile(
  filePath: string,
): Promise<{ readonly hash: string; readonly byteLength: number }> {
  const handle = await open(filePath, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('Selected media is not a regular file.');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let offset = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return Object.freeze({ hash: hash.digest('hex'), byteLength: offset });
  } finally {
    await handle.close();
  }
}

function fileBytes(filePath: string, cleanup?: () => Promise<void>): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(filePath, 'r');
        const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
        let offset = 0;
        while (true) {
          const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset);
          if (bytesRead === 0) return;
          offset += bytesRead;
          yield Uint8Array.from(buffer.subarray(0, bytesRead));
        }
      } finally {
        await handle?.close();
        await cleanup?.();
      }
    },
  };
}

async function writeBytes(
  filePath: string,
  bytes: AsyncIterable<Uint8Array>,
  flag: 'w' | 'wx',
  signal?: AbortSignal,
) {
  await mkdir(dirname(filePath), { recursive: true });
  const handle = await open(filePath, flag, 0o600);
  try {
    const hash = createHash('sha256');
    let byteLength = 0;
    for await (const chunk of bytes) {
      assertNotAborted(signal);
      const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      let offset = 0;
      while (offset < buffer.byteLength) {
        const written = await handle.write(buffer, offset, buffer.byteLength - offset, null);
        offset += written.bytesWritten;
      }
      hash.update(buffer);
      byteLength += buffer.byteLength;
    }
    await handle.sync();
    return Object.freeze({ hash: hash.digest('hex'), byteLength });
  } finally {
    await handle.close();
  }
}

async function workDirectory(root: string): Promise<string> {
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, 'media-'));
}

function operationSignal(
  active: Map<string, AbortController>,
  idempotencyKey: string,
  outer: AbortSignal | undefined,
): { readonly signal: AbortSignal; close(): void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  outer?.addEventListener('abort', onAbort, { once: true });
  active.set(idempotencyKey, controller);
  return Object.freeze({
    signal: controller.signal,
    close() {
      outer?.removeEventListener('abort', onAbort);
      active.delete(idempotencyKey);
    },
  });
}

async function createImportDescriptor(filePath: string, token: string) {
  const absolutePath = resolve(filePath);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error('Selected media is not a regular file.');
  const mimeType = mimeForPath(absolutePath);
  if (mimeType === null) unsupported('selected file type');
  const technical = await technicalFacts(absolutePath, mimeType);
  return Object.freeze({
    capabilityToken: token,
    importId: localIdentifier('import'),
    originalFileName: basename(absolutePath),
    ...(await digestFile(absolutePath)),
    mimeType,
    technicalFacts: technical,
    absolutePath,
  });
}

export interface ProductionLocalAdapters {
  readonly mediaImportCapabilities: MediaImportCapabilityResolver;
  readonly mediaInspector: MediaInspectionAdapter;
  readonly localMediaDerivation: LocalMediaDerivationAdapter;
  readonly reviewRenderer: LocalReviewRendererAdapter;
  readonly deliveryExporter: LocalDeliveryExporterAdapter;
  readonly providerCapabilitiesResolver: ProviderCapabilitiesResolver;
  readonly pickMedia: WireHandler<'os.media.pick'>;
}

function exactOllamaCapabilities(model: ProviderModel): ProviderCapabilitiesResolver {
  const resolver: ProviderCapabilitiesResolver = {
    async resolve(profile) {
      if (
        profile.id !== model.providerId ||
        profile.providerKind !== LOCAL_OLLAMA_PROVIDER_ID ||
        profile.model.providerId !== model.providerId ||
        profile.model.model !== model.model ||
        profile.model.reasoningStrength !== model.reasoningStrength
      ) {
        throw new ProviderNotConfiguredError(profile.id);
      }
      return Object.freeze([]);
    },
  };
  return Object.freeze(resolver);
}

function createMediaImportGateway(input: {
  readonly picker?: LocalMediaPicker;
  readonly now: () => Date;
}): Pick<ProductionLocalAdapters, 'mediaImportCapabilities' | 'pickMedia'> {
  const records = new Map<string, ImportCapabilityRecord>();
  const pickMedia: WireHandler<'os.media.pick'> = async (request) => {
    if (input.picker === undefined)
      throw new WirePublicError({ code: 'unavailable', retryable: false });
    const selected = await input.picker.pick(request.input);
    if (selected === null) throw new WirePublicError({ code: 'cancelled', retryable: false });
    if (selected.length !== 1) {
      throw new WirePublicError({ code: 'unavailable', retryable: false });
    }
    const token = localIdentifier('cap');
    const descriptor = await createImportDescriptor(selected[0]!, token);
    if (!request.input.kinds.includes(descriptor.technicalFacts.kind)) {
      throw new WirePublicError({ code: 'invalid_request', retryable: false });
    }
    const issuedAt = input.now().getTime();
    records.set(token, Object.freeze({ descriptor, expiresAt: issuedAt + CAPABILITY_LIFETIME_MS }));
    return {
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'os.media.pick',
      result: {
        capabilityToken: descriptor.capabilityToken,
        displayLabel: descriptor.originalFileName,
        expiresAt: new Date(issuedAt + CAPABILITY_LIFETIME_MS).toISOString(),
      },
    } satisfies MediaPickSuccess;
  };
  const mediaImportCapabilities: MediaImportCapabilityResolver = {
    async resolve(capabilityToken) {
      const record = records.get(capabilityToken);
      if (record === undefined || record.expiresAt <= input.now().getTime()) {
        records.delete(capabilityToken);
        throw new StorageError('NOT_FOUND', 'Media import capability is unavailable.');
      }
      return Object.freeze({
        descriptor: {
          capabilityToken: record.descriptor.capabilityToken,
          importId: record.descriptor.importId,
          originalFileName: record.descriptor.originalFileName,
          blobHash: record.descriptor.hash,
          byteLength: record.descriptor.byteLength,
          mimeType: record.descriptor.mimeType,
          technicalFacts: record.descriptor.technicalFacts,
        },
        openBytes: () => fileBytes(record.descriptor.absolutePath),
      });
    },
  };
  return Object.freeze({
    pickMedia,
    mediaImportCapabilities: Object.freeze(mediaImportCapabilities),
  });
}

function createMediaInspector(scratchRoot: string): MediaInspectionAdapter {
  const inspector: MediaInspectionAdapter = {
    async inspect(request, signal) {
      assertNotAborted(signal);
      const directory = await workDirectory(scratchRoot);
      const mimeType = request.blob.mimeType;
      const sourcePath = join(directory, `source${extnameForMime(mimeType)}`);
      try {
        await writeBytes(sourcePath, request.bytes, 'wx');
        assertNotAborted(signal);
        const facts = await technicalFacts(sourcePath, mimeType);
        return Object.freeze([
          Object.freeze({
            artifact: null,
            textEvidence: `ffprobe verified ${JSON.stringify(facts)}`,
            timecodesMs: [],
            pageNumbers: [],
          }),
        ]);
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  };
  return Object.freeze(inspector);
}

function extnameForMime(mimeType: string): string {
  const extension = Object.entries({
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
    'video/x-matroska': '.mkv',
    'audio/wav': '.wav',
    'audio/mpeg': '.mp3',
    'audio/aac': '.aac',
    'audio/flac': '.flac',
  }).find(([known]) => known === mimeType)?.[1];
  if (extension === undefined) unsupported('media MIME type');
  return extension;
}

function derivativeOutputMime(operation: string, transform: unknown): string {
  if (operation === 'extractFrames') {
    const imageFormat = (transform as { readonly imageFormat: string }).imageFormat;
    return imageFormat === 'jpeg' ? 'image/jpeg' : `image/${imageFormat}`;
  }
  if (operation === 'waveform') return 'image/png';
  if (operation === 'extractAudio') {
    const format = (transform as { readonly format: string }).format;
    return format === 'mp3' ? 'audio/mpeg' : `audio/${format}`;
  }
  const container =
    operation === 'proxyTranscode'
      ? (transform as { readonly container: string }).container
      : 'mp4';
  return container === 'mov' ? 'video/quicktime' : `video/${container}`;
}

async function runDerivation(
  sourcePath: string,
  transform: Parameters<LocalMediaDerivationAdapter['derive']>[0]['transform'],
  outputPath: string,
  signal: AbortSignal,
  timecodeMs?: number,
): Promise<void> {
  const command = createCommand(sourcePath);
  switch (transform.operation) {
    case 'extractFrames':
      command.inputOptions([`-ss ${((timecodeMs ?? 0) / 1_000).toString()}`]);
      command.outputOptions(['-frames:v 1', '-update 1']);
      break;
    case 'clip':
      command.inputOptions([`-ss ${(transform.startMs / 1_000).toString()}`]);
      command.outputOptions([`-t ${((transform.endMs - transform.startMs) / 1_000).toString()}`]);
      break;
    case 'crop':
      command.videoFilters(
        `crop=${transform.width}:${transform.height}:${transform.x}:${transform.y}`,
      );
      break;
    case 'resize':
      command.videoFilters(
        transform.fit === 'fill'
          ? `scale=${transform.width}:${transform.height}`
          : `scale=${transform.width}:${transform.height}:force_original_aspect_ratio=${
              transform.fit === 'cover' ? 'increase' : 'decrease'
            },crop=${transform.width}:${transform.height}`,
      );
      break;
    case 'proxyTranscode':
      command.videoFilters(
        `scale=${transform.maxWidth}:${transform.maxHeight}:force_original_aspect_ratio=decrease`,
      );
      command.outputOptions([`-crf ${Math.max(1, 52 - Math.round(transform.quality / 2))}`]);
      command.format(transform.container);
      break;
    case 'extractAudio':
      command.noVideo();
      command.audioFrequency(transform.sampleRateHz);
      command.format(transform.format);
      break;
    case 'waveform':
      command.audioFilters(`showwavespic=s=${transform.width}x${transform.height}`);
      command.outputOptions(['-frames:v 1']);
      break;
    case 'ocr':
      unsupported('OCR');
  }
  command.output(outputPath);
  await runCommand(command, signal);
}

function createMediaDerivationAdapter(scratchRoot: string): LocalMediaDerivationAdapter {
  const active = new Map<string, AbortController>();
  const adapter: LocalMediaDerivationAdapter = {
    async derive(request, outerSignal) {
      if (request.cancellationRequested()) throw new Error('Local media operation was cancelled.');
      const operation = operationSignal(active, request.idempotencyKey, outerSignal);
      const directory = await workDirectory(scratchRoot);
      let handedOff = false;
      try {
        const sourcePath = join(directory, `source${extnameForMime(request.source.blob.mimeType)}`);
        await writeBytes(sourcePath, request.source.bytes, 'wx');
        assertNotAborted(operation.signal);
        const timecodes =
          request.transform.operation === 'extractFrames'
            ? request.transform.timecodesMs
            : [undefined];
        if (timecodes.length !== request.outputCount) {
          throw new Error('Local media derivation output count does not match its transform.');
        }
        const outputMime = derivativeOutputMime(request.transform.operation, request.transform);
        const outputs = [];
        for (const [ordinal, timecode] of timecodes.entries()) {
          if (request.cancellationRequested())
            throw new Error('Local media operation was cancelled.');
          const outputPath = join(directory, `output-${ordinal}${extnameForMime(outputMime)}`);
          await runDerivation(
            sourcePath,
            request.transform,
            outputPath,
            operation.signal,
            timecode,
          );
          const identity = await digestFile(outputPath);
          outputs.push(
            Object.freeze({
              ordinal,
              blob: Object.freeze({
                ...identity,
                mimeType: outputMime,
                technicalFacts: await technicalFacts(outputPath, outputMime),
                publication: Object.freeze({
                  state: 'pending' as const,
                  bytes: fileBytes(outputPath),
                }),
              }),
            }),
          );
        }
        let remaining = outputs.length;
        let removed = false;
        const release = async () => {
          remaining -= 1;
          if (remaining === 0 && !removed) {
            removed = true;
            await rm(directory, { force: true, recursive: true });
          }
        };
        const published = outputs.map((output) =>
          Object.freeze({
            ...output,
            blob: Object.freeze({
              ...output.blob,
              publication: Object.freeze({
                state: 'pending' as const,
                bytes: fileBytes(
                  join(
                    directory,
                    `output-${output.ordinal}${extnameForMime(output.blob.mimeType)}`,
                  ),
                  release,
                ),
              }),
            }),
          }),
        );
        handedOff = true;
        return Object.freeze(published);
      } finally {
        operation.close();
        if (!handedOff) await rm(directory, { force: true, recursive: true });
      }
    },
    async cancel(request) {
      active.get(request.idempotencyKey)?.abort();
      return Object.freeze({ state: 'cancelled' as const });
    },
  };
  return Object.freeze(adapter);
}

async function materializeCasObject(
  cas: MediaCas,
  hash: string,
  targetPath: string,
): Promise<void> {
  const expected = await cas.stat(hash);
  if (expected === null)
    throw new StorageError('NOT_FOUND', `Media object ${hash} is unavailable.`);
  await writeBytes(targetPath, cas.openVerified(expected), 'wx');
}

function createReviewRenderer(scratchRoot: string, cas: MediaCas): LocalReviewRendererAdapter {
  const active = new Map<string, AbortController>();
  const adapter: LocalReviewRendererAdapter = {
    async render(request, outerSignal) {
      const operation = operationSignal(active, request.idempotencyKey, outerSignal);
      const directory = await workDirectory(scratchRoot);
      try {
        const items = [...request.manifest.items].sort((left, right) => left.order - right.order);
        const selected =
          request.range === null
            ? items
            : items.slice(request.range.startItem, request.range.endItem + 1);
        if (selected.length === 0)
          throw new Error('Review Cut requires at least one delivery item.');
        const videos = [];
        for (const [index, item] of selected.entries()) {
          const sourcePath = join(directory, `source-${index}.media`);
          await materializeCasObject(cas, item.blobHash, sourcePath);
          const probe = await probeMedia(sourcePath);
          videos.push({
            sourcePath,
            trimInMs: item.trimStartMs,
            trimOutMs: item.trimEndMs,
            sourceDurationMs: positive(probe.durationSeconds * 1_000, 'review source duration'),
            embeddedAudioEnabled: item.audioPolicy === 'use',
            hasEmbeddedAudio: probe.hasAudio,
          });
        }
        const outputPath = join(directory, 'review.mp4');
        await renderReviewCut(
          {
            videos,
            width: request.manifest.formatIntent.width,
            height: request.manifest.formatIntent.height,
            fps: request.manifest.formatIntent.frameRate,
          },
          outputPath,
          { signal: operation.signal },
        );
        const identity = await digestFile(outputPath);
        return Object.freeze({
          blob: Object.freeze({
            ...identity,
            mimeType: 'video/mp4',
            technicalFacts: await technicalFacts(outputPath, 'video/mp4'),
            bytes: fileBytes(outputPath, () => rm(directory, { force: true, recursive: true })),
          }),
        });
      } catch (cause) {
        await rm(directory, { force: true, recursive: true });
        throw cause;
      } finally {
        operation.close();
      }
    },
    async cancel(request) {
      active.get(request.idempotencyKey)?.abort();
      return Object.freeze({ state: 'cancelled' as const });
    },
  };
  return Object.freeze(adapter);
}

export function resolveFilesystemExportPath(
  grantValue: unknown,
  manifest: Pick<DeliveryManifest, 'formatIntent'>,
  displayLabel: string,
): string {
  if (
    typeof grantValue !== 'object' ||
    grantValue === null ||
    !('kind' in grantValue) ||
    !('path' in grantValue)
  ) {
    throw new Error('Filesystem export grant is invalid.');
  }
  const grant = grantValue as FilesystemExportGrant;
  if ((grant.kind !== 'file' && grant.kind !== 'folder') || !isAbsolute(grant.path)) {
    throw new Error('Filesystem export grant is invalid.');
  }
  if (
    displayLabel !== basename(displayLabel) ||
    displayLabel === '.' ||
    displayLabel === '..' ||
    /^[A-Za-z]:/u.test(displayLabel)
  ) {
    throw new Error('Filesystem export destination label is unsafe.');
  }
  const path = grant.kind === 'file' ? resolve(grant.path) : resolve(grant.path, displayLabel);
  if (grant.kind === 'file' && basename(path) !== displayLabel) {
    throw new Error('Filesystem export grant does not match the destination label.');
  }
  if (grant.kind === 'folder' && dirname(path) !== resolve(grant.path)) {
    throw new Error('Filesystem export grant escapes its selected folder.');
  }
  if (extname(path).slice(1).toLowerCase() !== manifest.formatIntent.container) {
    throw new Error('Filesystem export grant does not match the delivery container.');
  }
  return path;
}

function createDeliveryExporter(
  reviewRenderer: LocalReviewRendererAdapter,
): LocalDeliveryExporterAdapter {
  const active = new Map<string, AbortController>();
  const adapter: LocalDeliveryExporterAdapter = {
    async export(request, outerSignal) {
      const operation = operationSignal(active, request.idempotencyKey, outerSignal);
      try {
        const destinationPath = resolveFilesystemExportPath(
          request.writableGrant,
          request.manifest,
          request.destination.displayLabel,
        );
        const rendered = await reviewRenderer.render(
          {
            idempotencyKey: `${request.idempotencyKey}.render`,
            requestHash: request.requestHash,
            manifest: request.manifest,
            range: null,
          },
          operation.signal,
        );
        const output = await writeBytes(
          destinationPath,
          rendered.blob.bytes,
          request.overwriteExisting ? 'w' : 'wx',
          operation.signal,
        );
        return Object.freeze({
          blob: Object.freeze({
            ...output,
            mimeType: 'video/mp4',
            technicalFacts: await technicalFacts(destinationPath, 'video/mp4'),
            bytes: fileBytes(destinationPath),
          }),
          outputContentHash: output.hash,
        });
      } finally {
        operation.close();
      }
    },
    async cancel(request) {
      active.get(request.idempotencyKey)?.abort();
      return Object.freeze({ state: 'cancelled' as const });
    },
  };
  return Object.freeze(adapter);
}

export function createProductionLocalAdapters(input: {
  readonly mediaCas: MediaCas;
  readonly scratchRoot: string;
  readonly model: ProviderModel;
  readonly mediaPicker?: LocalMediaPicker;
  readonly now?: () => Date;
}): ProductionLocalAdapters {
  const imports = createMediaImportGateway({
    picker: input.mediaPicker,
    now: input.now ?? (() => new Date()),
  });
  const reviewRenderer = createReviewRenderer(input.scratchRoot, input.mediaCas);
  return Object.freeze({
    ...imports,
    mediaInspector: createMediaInspector(input.scratchRoot),
    localMediaDerivation: createMediaDerivationAdapter(input.scratchRoot),
    reviewRenderer,
    deliveryExporter: createDeliveryExporter(reviewRenderer),
    providerCapabilitiesResolver: exactOllamaCapabilities(input.model),
  });
}
