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
import { providerHealth, type AdapterRegistry } from '@lucid-fin/adapters-ai';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import { getBuiltinProviderCapabilityProfile } from '@lucid-fin/contracts';

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
}

export class CommanderImageGenerationError extends Error {
  readonly submissionAmbiguous = true;

  constructor(
    message: string,
    readonly details: {
      providerId: string;
      width: number;
      height: number;
      estimatedCostUsd: number;
      requestedSeed?: number;
    },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CommanderImageGenerationError';
  }
}

/** Clamp width/height to the provider's maxDimension while preserving aspect ratio. */
function clampDimensions(
  width: number,
  height: number,
  providerId: string,
): { width: number; height: number } {
  const profile = getBuiltinProviderCapabilityProfile(providerId);
  const max = profile?.maxDimension ?? 1024;
  if (width <= max && height <= max) return { width, height };

  const scale = max / Math.max(width, height);
  // Round down to nearest 8 (universal safe alignment)
  const clampedW = Math.floor((width * scale) / 8) * 8;
  const clampedH = Math.floor((height * scale) / 8) * 8;
  log.info('Clamped image dimensions to provider max', {
    category: 'commander',
    providerId,
    maxDimension: max,
    requested: `${width}x${height}`,
    clamped: `${clampedW}x${clampedH}`,
  });
  return { width: clampedW, height: clampedH };
}

/**
 * Resolve dimensions to the provider's maximum square when no explicit
 * width/height is given. Used for reference images where we want the
 * highest resolution the provider supports.
 */
function resolveProviderMaxDimensions(providerId: string): { width: number; height: number } {
  const profile = getBuiltinProviderCapabilityProfile(providerId);
  const max = profile?.maxDimension ?? 1024;
  // Round down to nearest 8 for alignment safety
  const dim = Math.floor(max / 8) * 8;
  return { width: dim, height: dim };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function makeGenerateImage(deps: {
  adapterRegistry: AdapterRegistry;
  cas: CAS;
  db?: SqliteIndex;
  onStart?: (jobId: string, provider: string, width: number, height: number) => void;
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
    const jobId = crypto.randomUUID();
    const candidates = providerId
      ? deps.adapterRegistry.list('image').filter((adapter) => adapter.id === providerId)
      : deps.adapterRegistry.list('image');

    for (const adapter of candidates) {
      if (!(await adapter.validate())) {
        continue;
      }

      const actualProviderId = providerId ?? adapter.id;

      // When no explicit dimensions are given, resolve to the provider's
      // maximum supported resolution instead of falling back to a fixed default.
      let clamped: { width: number; height: number };
      if (explicitWidth != null && explicitHeight != null) {
        clamped = clampDimensions(explicitWidth, explicitHeight, actualProviderId);
      } else if (explicitWidth != null || explicitHeight != null) {
        clamped = clampDimensions(explicitWidth ?? 1024, explicitHeight ?? 1024, actualProviderId);
      } else {
        clamped = resolveProviderMaxDimensions(actualProviderId);
      }

      const generationRequest = {
        type: 'image' as const,
        providerId: actualProviderId,
        prompt,
        ...(options?.negativePrompt ? { negativePrompt: options.negativePrompt } : {}),
        width: clamped.width,
        height: clamped.height,
        ...(options?.seed !== undefined ? { seed: options.seed } : {}),
      };
      const estimate = adapter.estimateCost(generationRequest);
      if (estimate.currency.toUpperCase() !== 'USD') {
        throw new Error(
          `Image provider ${actualProviderId} returned a non-USD cost estimate; the approved audition budget cannot be enforced safely`,
        );
      }
      if (!Number.isFinite(estimate.estimatedCost) || estimate.estimatedCost < 0) {
        throw new Error(`Image provider ${actualProviderId} returned an invalid cost estimate`);
      }
      if (
        options?.maxEstimatedCostUsd !== undefined &&
        estimate.estimatedCost > options.maxEstimatedCostUsd + 1e-9
      ) {
        throw new Error(
          `Image generation estimate $${estimate.estimatedCost.toFixed(4)} exceeds the remaining approved audition budget $${options.maxEstimatedCostUsd.toFixed(4)}`,
        );
      }

      deps.onStart?.(jobId, actualProviderId, clamped.width, clamped.height);
      try {
        const generated = await adapter.generate(generationRequest);
        providerHealth.recordSuccess(adapter.id);
        const reportedActualCostUsd = normalizeFiniteNumber(generated.cost);
        const materialized = await materializeAsset(generated);
        try {
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
                width: clamped.width,
                height: clamped.height,
                generationMetadata: {
                  prompt,
                  ...(options?.negativePrompt ? { negativePrompt: options.negativePrompt } : {}),
                  provider: actualProviderId,
                  ...(reportedSeed !== undefined
                    ? { seed: reportedSeed }
                    : options?.seed !== undefined
                      ? { seed: options.seed }
                      : {}),
                  width: clamped.width,
                  height: clamped.height,
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
            width: clamped.width,
            height: clamped.height,
            estimatedCostUsd: estimate.estimatedCost,
            ...(reportedActualCostUsd !== undefined ? { reportedActualCostUsd } : {}),
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
            width: clamped.width,
            height: clamped.height,
            estimatedCostUsd: estimate.estimatedCost,
            ...(options?.seed !== undefined ? { requestedSeed: options.seed } : {}),
          },
          genErr instanceof Error ? { cause: genErr } : undefined,
        );
      }
    }

    throw new Error(
      providerId
        ? `Image adapter not available: ${providerId}`
        : 'No configured image adapter available',
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
