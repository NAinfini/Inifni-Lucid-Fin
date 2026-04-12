/**
 * Commander image generation helpers.
 *
 * Extracted from commander.handlers.ts to keep that file focused on
 * IPC registration and orchestration wiring.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import log from '../../logger.js';
import type { AdapterRegistry } from '@lucid-fin/adapters-ai';
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

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function makeGenerateImage(deps: {
  adapterRegistry: AdapterRegistry;
  cas: CAS;
  db?: SqliteIndex;
  getProjectId?: () => string | undefined;
}): (prompt: string, options?: { providerId?: string; width?: number; height?: number }) => Promise<{ assetHash: string }> {
  return async (prompt: string, options?: { providerId?: string; width?: number; height?: number }) => {
    const providerId = options?.providerId;
    const width = options?.width ?? 1024;
    const height = options?.height ?? 1024;
    const candidates = providerId
      ? deps.adapterRegistry.list('image').filter((adapter) => adapter.id === providerId)
      : deps.adapterRegistry.list('image');

    for (const adapter of candidates) {
      if (!(await adapter.validate())) {
        continue;
      }

      const actualProviderId = providerId ?? adapter.id;
      const clamped = clampDimensions(width, height, actualProviderId);

      const generated = await adapter.generate({
        type: 'image',
        providerId: actualProviderId,
        prompt,
        width: clamped.width,
        height: clamped.height,
      });
      const materialized = await materializeAsset(generated);
      try {
        const { ref } = await deps.cas.importAsset(materialized.filePath, 'image');

        // Register in asset library so the image appears in the asset browser
        if (deps.db) {
          try {
            deps.db.insertAsset({
              hash: ref.hash,
              type: 'image',
              format: ref.format,
              prompt,
              provider: actualProviderId,
              width: clamped.width,
              height: clamped.height,
              projectId: deps.getProjectId?.(),
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
        return { assetHash: ref.hash };
      } finally {
        if (materialized.cleanupPath) {
          fs.rmSync(materialized.cleanupPath, { recursive: true, force: true });
        }
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
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

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
  } catch { /* malformed URL — extension cannot be determined, return undefined */
    return undefined;
  }
}

export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
