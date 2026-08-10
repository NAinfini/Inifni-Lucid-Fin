/**
 * Commander image generation helpers.
 *
 * Extracted from commander.handlers.ts to keep that file focused on
 * IPC registration and orchestration wiring.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import log from '../../logger.js';
import { sanitizePng } from '../../sanitize-png.js';
import {
  preflightGenerationPrompt,
  preflightGenerationResolution,
  providerHealth,
  type AdapterRegistry,
} from '@lucid-fin/adapters-ai';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import type {
  GenerationRequest,
  ResolutionAudit,
  ResolutionIntent,
  ResolutionSource,
} from '@lucid-fin/contracts';
import { probeMedia } from '@lucid-fin/media-engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MaterializedAsset = {
  filePath: string;
  cleanupPath?: string;
  sourceUrl?: string;
};

export interface CommanderImageGenerationOptions {
  providerId?: string;
  width?: number;
  height?: number;
  /** Canonical intent. Cannot be combined with legacy width/height. */
  resolution?: ResolutionIntent;
  resolutionSource?: ResolutionSource;
  seed?: number;
  negativePrompt?: string;
  /** Fail before provider submission when its USD estimate exceeds this bound. */
  maxEstimatedCostUsd?: number;
}

export interface CommanderImageGenerationResult {
  assetHash: string;
  providerId: string;
  model?: string;
  requestedSeed?: number;
  reportedSeed?: number;
  width: number;
  height: number;
  estimatedCostUsd: number;
  reportedActualCostUsd?: number;
  resolution: ResolutionAudit;
}

export class CommanderImageGenerationError extends Error {
  readonly submissionAmbiguous = true;

  constructor(
    message: string,
    readonly details: {
      providerId: string;
      width?: number;
      height?: number;
      estimatedCostUsd: number;
      requestedSeed?: number;
    },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CommanderImageGenerationError';
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function makeGenerateImage(deps: {
  adapterRegistry: AdapterRegistry;
  cas: CAS;
  db?: SqliteIndex;
  onStart?: (jobId: string, provider: string, width?: number, height?: number) => void;
  onComplete?: (jobId: string, assetHash: string) => void;
  onFailed?: (jobId: string, error: string) => void;
}): (
  prompt: string,
  options?: CommanderImageGenerationOptions,
) => Promise<CommanderImageGenerationResult> {
  return async (prompt: string, options?: CommanderImageGenerationOptions) => {
    const providerId = options?.providerId;
    const explicitWidth = options?.width;
    const explicitHeight = options?.height;
    if (options?.resolution && (explicitWidth !== undefined || explicitHeight !== undefined)) {
      throw new Error('resolution cannot be combined with legacy width or height');
    }
    if ((explicitWidth === undefined) !== (explicitHeight === undefined)) {
      throw new Error('width and height must be provided together');
    }
    const intent: ResolutionIntent =
      options?.resolution ??
      (explicitWidth !== undefined && explicitHeight !== undefined
        ? { mode: 'exact', width: explicitWidth, height: explicitHeight }
        : { mode: 'provider-default' });
    const resolutionSource: ResolutionSource =
      options?.resolutionSource ??
      (options?.resolution || explicitWidth !== undefined ? 'node' : 'provider');
    const jobId = crypto.randomUUID();
    const requestedAdapter = providerId
      ? (deps.adapterRegistry.resolve?.(providerId, 'image') ??
        deps.adapterRegistry.get(providerId))
      : undefined;
    const candidates = providerId
      ? requestedAdapter
        ? [requestedAdapter]
        : []
      : deps.adapterRegistry.list('image');
    let lastResolutionError: string | undefined;

    for (const adapter of candidates) {
      const actualProviderId = providerId ?? adapter.id;
      const baseRequest: GenerationRequest = {
        type: 'image' as const,
        providerId: actualProviderId,
        prompt,
        ...(options?.negativePrompt ? { negativePrompt: options.negativePrompt } : {}),
        ...(options?.seed !== undefined ? { seed: options.seed } : {}),
      };
      preflightGenerationPrompt(adapter, baseRequest);
      const preflight = preflightGenerationResolution({
        adapter,
        request: baseRequest,
        intent,
        source: resolutionSource,
      });
      if (!preflight.supported || !preflight.request) {
        const alternatives = preflight.supported
          ? ''
          : preflight.alternatives.map((option) => option.label).join(', ');
        lastResolutionError = preflight.supported
          ? `Provider ${actualProviderId} could not apply the resolution request`
          : `${preflight.reason}${alternatives ? `. Supported alternatives: ${alternatives}` : ''}`;
        if (providerId) throw new Error(lastResolutionError);
        continue;
      }
      const generationRequest = preflight.request;
      const estimatedCostUsd = preflight.estimatedCostUsd ?? 0;
      if (
        options?.maxEstimatedCostUsd !== undefined &&
        estimatedCostUsd > options.maxEstimatedCostUsd + 1e-9
      ) {
        throw new Error(
          `Image generation estimate $${estimatedCostUsd.toFixed(4)} exceeds the remaining approved audition budget $${options.maxEstimatedCostUsd.toFixed(4)}`,
        );
      }
      // Local resolution/cost checks run before any provider validation call.
      if (!(await adapter.validate())) continue;

      deps.onStart?.(jobId, actualProviderId, preflight.plan.width, preflight.plan.height);
      try {
        const generated = await adapter.generate(generationRequest);
        providerHealth.recordSuccess(adapter.id);
        const reportedActualCostUsd = normalizeFiniteNumber(generated.cost);
        const materialized = await materializeAsset(generated);
        try {
          const actualMedia = await probeMedia(materialized.filePath);
          if (!actualMedia.width || !actualMedia.height) {
            throw new Error('Generated image dimensions could not be verified');
          }
          const resolution: ResolutionAudit = {
            requested: intent,
            resolved: preflight.plan,
            actual: { width: actualMedia.width, height: actualMedia.height },
            estimatedCostUsd,
            ...(reportedActualCostUsd !== undefined ? { reportedActualCostUsd } : {}),
          };
          const { ref } = await deps.cas.importAsset(materialized.filePath, 'image');

          // Register in asset library so the image appears in the asset browser
          if (deps.db) {
            try {
              const model = normalizeOptionalString(
                generated.provenance?.model ?? generated.metadata?.model,
              );
              const reportedSeed = normalizeFiniteNumber(generated.metadata?.seed);
              deps.db.repos.assets.insert({
                hash: ref.hash,
                type: 'image',
                format: ref.format,
                prompt,
                provider: actualProviderId,
                width: actualMedia.width,
                height: actualMedia.height,
                generationMetadata: {
                  prompt,
                  ...(options?.negativePrompt ? { negativePrompt: options.negativePrompt } : {}),
                  provider: actualProviderId,
                  ...(reportedSeed !== undefined
                    ? { seed: reportedSeed }
                    : options?.seed !== undefined
                      ? { seed: options.seed }
                      : {}),
                  width: actualMedia.width,
                  height: actualMedia.height,
                  resolution,
                  ...(model ? { model } : {}),
                  ...(reportedActualCostUsd !== undefined ? { cost: reportedActualCostUsd } : {}),
                },
              });
            } catch (dbErr) {
              // Non-fatal — CAS already has the file
              log.warn('Failed to register generated image in asset index', {
                category: 'commander',
                hash: ref.hash,
                error: dbErr instanceof Error ? dbErr.message : String(dbErr),
              });
            }
          }

          log.info('Commander image generated and stored', {
            category: 'commander',
            hash: ref.hash,
            format: ref.format,
            path: ref.path,
          });
          deps.onComplete?.(jobId, ref.hash);
          const model = normalizeOptionalString(
            generated.provenance?.model ?? generated.metadata?.model,
          );
          const reportedSeed = normalizeFiniteNumber(generated.metadata?.seed);
          return {
            assetHash: ref.hash,
            providerId: actualProviderId,
            ...(model ? { model } : {}),
            ...(options?.seed !== undefined ? { requestedSeed: options.seed } : {}),
            ...(reportedSeed !== undefined ? { reportedSeed } : {}),
            width: actualMedia.width,
            height: actualMedia.height,
            estimatedCostUsd,
            ...(reportedActualCostUsd !== undefined ? { reportedActualCostUsd } : {}),
            resolution,
          };
        } finally {
          if (materialized.cleanupPath) {
            await fsp.rm(materialized.cleanupPath, { recursive: true, force: true });
          }
        }
      } catch (genErr) {
        providerHealth.recordFailure(adapter.id);
        deps.onFailed?.(jobId, genErr instanceof Error ? genErr.message : String(genErr));
        throw new CommanderImageGenerationError(
          genErr instanceof Error ? genErr.message : String(genErr),
          {
            providerId: actualProviderId,
            width: preflight.plan.width,
            height: preflight.plan.height,
            estimatedCostUsd,
            ...(options?.seed !== undefined ? { requestedSeed: options.seed } : {}),
          },
          genErr instanceof Error ? { cause: genErr } : undefined,
        );
      }
    }

    throw new Error(
      lastResolutionError ??
        (providerId
          ? `Image adapter not available: ${providerId}`
          : 'No configured image adapter available'),
    );
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

export async function materializeAsset(generated: {
  assetPath?: string;
  metadata?: Record<string, unknown>;
}): Promise<MaterializedAsset> {
  const assetPath = normalizeOptionalString(generated.assetPath);
  if (assetPath) {
    if (isRemoteUrl(assetPath)) {
      return downloadRemoteAsset(assetPath);
    }
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Generated asset path not found: ${assetPath}`);
    }
    return { filePath: assetPath };
  }

  const metadataUrl = normalizeOptionalString(generated.metadata?.url as string | undefined);
  if (metadataUrl) {
    return downloadRemoteAsset(metadataUrl);
  }

  throw new Error('Generated asset did not include a usable file path or URL');
}

async function downloadRemoteAsset(url: string): Promise<MaterializedAsset> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download generated asset: ${response.status}`);
  }

  const ext = inferRemoteExtension(url, response.headers.get('content-type'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-commander-'));
  const filePath = path.join(dir, `generated-${Date.now()}.${ext}`);
  const buffer = sanitizePng(Buffer.from(await response.arrayBuffer()));
  await fsp.writeFile(filePath, buffer);

  return {
    filePath,
    cleanupPath: dir,
    sourceUrl: url,
  };
}

function inferRemoteExtension(url: string, contentType: string | null): string {
  const byUrl = extensionFromUrl(url);
  if (byUrl) return byUrl;
  const normalized = contentType?.split(';')[0].trim().toLowerCase();
  switch (normalized) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    default:
      return 'bin';
  }
}

function extensionFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).slice(1).toLowerCase();
    return ext.length > 0 ? ext : undefined;
  } catch {
    /* malformed URL — extension cannot be determined, return undefined */
    return undefined;
  }
}

export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
