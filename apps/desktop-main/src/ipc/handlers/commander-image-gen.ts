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
import type { CAS } from '@lucid-fin/storage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MaterializedAsset = {
  filePath: string;
  cleanupPath?: string;
  sourceUrl?: string;
};

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function makeGenerateImage(deps: {
  adapterRegistry: AdapterRegistry;
  cas: CAS;
}): (prompt: string, providerId?: string) => Promise<{ assetHash: string }> {
  return async (prompt: string, providerId?: string) => {
    const candidates = providerId
      ? deps.adapterRegistry.list('image').filter((adapter) => adapter.id === providerId)
      : deps.adapterRegistry.list('image');

    for (const adapter of candidates) {
      if (!(await adapter.validate())) {
        continue;
      }

      const generated = await adapter.generate({
        type: 'image',
        providerId: providerId ?? adapter.id,
        prompt,
        width: 1024,
        height: 1024,
      });
      const materialized = await materializeAsset(generated);
      try {
        const { ref } = await deps.cas.importAsset(materialized.filePath, 'image');
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
  } catch {
    return undefined;
  }
}

export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
