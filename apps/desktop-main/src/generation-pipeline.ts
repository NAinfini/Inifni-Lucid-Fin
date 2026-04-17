import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AIProviderAdapter, GenerationRequest } from '@lucid-fin/contracts';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import log from './logger.js';

type MaterializedAsset = {
  filePath: string;
  cleanupPath?: string;
  sourceUrl?: string;
};

export type GenerateAndImportOptions = {
  prompt?: string;
  provider?: string;
  tags?: string[];
};

export async function generateAndImport(
  request: GenerationRequest,
  deps: { adapter: AIProviderAdapter; cas: CAS; db: SqliteIndex },
  options: GenerateAndImportOptions = {},
): Promise<{ hashes: string[]; cost: number }> {
  const generated = await deps.adapter.generate(request);

  const materialized = await materializeAsset(generated);
  try {
    const assetType = request.type === 'image' ? 'image' : request.type === 'video' ? 'video' : 'audio';
    const { ref, meta } = await deps.cas.importAsset(materialized.filePath, assetType);

    deps.db.repos.assets.insert({
      ...meta,
      prompt: options.prompt ?? request.prompt,
      provider: options.provider ?? deps.adapter.id,
      tags: options.tags ?? [],
    });

    return {
      hashes: [ref.hash],
      cost: typeof generated.cost === 'number' ? generated.cost : 0,
    };
  } finally {
    if (materialized.cleanupPath) {
      await fsp.rm(materialized.cleanupPath, { recursive: true, force: true });
    }
  }
}

async function materializeAsset(generated: {
  assetPath?: string;
  metadata?: Record<string, unknown>;
}): Promise<MaterializedAsset> {
  const assetPath = normalizeOptionalString(generated.assetPath);
  if (assetPath) {
    if (assetPath.startsWith('data:image/') || assetPath.startsWith('data:video/') || assetPath.startsWith('data:audio/')) {
      return decodeBase64DataUrl(assetPath);
    }
    if (/^https?:\/\//i.test(assetPath)) {
      return downloadRemoteAsset(assetPath);
    }
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Generated asset path not found: ${assetPath.slice(0, 80)}`);
    }
    return { filePath: assetPath };
  }

  const metadataUrl =
    normalizeOptionalString(generated.metadata?.url as string | undefined) ??
    normalizeOptionalString(generated.metadata?.video_url as string | undefined) ??
    normalizeOptionalString(generated.metadata?.output as string | undefined) ??
    normalizeOptionalString(generated.metadata?.download_url as string | undefined);
  if (metadataUrl) {
    if (metadataUrl.startsWith('data:image/') || metadataUrl.startsWith('data:video/') || metadataUrl.startsWith('data:audio/')) {
      return decodeBase64DataUrl(metadataUrl);
    }
    return downloadRemoteAsset(metadataUrl);
  }

  throw new Error('Generated asset did not include a usable file path or URL');
}

async function decodeBase64DataUrl(dataUrl: string): Promise<MaterializedAsset> {
  const match = dataUrl.match(/^data:(?:image|video|audio)\/(\w+);base64,(.+)$/);
  if (!match) throw new Error('Invalid base64 data URL');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const tmpPath = path.join(os.tmpdir(), `lucid-fin-gen-${Date.now()}.${ext}`);
  await fsp.writeFile(tmpPath, buffer);
  return { filePath: tmpPath, cleanupPath: tmpPath };
}

async function downloadRemoteAsset(url: string): Promise<MaterializedAsset> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download generated asset: ${response.status}`);
  }
  const ext = inferRemoteExtension(url, response.headers.get('content-type'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-pipeline-'));
  const filePath = path.join(dir, `generated-${Date.now()}.${ext}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(filePath, buffer);
  log.info('[generation-pipeline] downloaded remote asset', { url, filePath, fileSize: buffer.byteLength });
  return { filePath, cleanupPath: dir, sourceUrl: url };
}

function inferRemoteExtension(url: string, contentType: string | null): string {
  try {
    const ext = path.extname(new URL(url).pathname).slice(1).toLowerCase();
    if (ext) return ext;
  } catch { /* ignore */ }
  const normalized = contentType?.split(';')[0].trim().toLowerCase();
  switch (normalized) {
    case 'image/jpeg': return 'jpg';
    case 'image/webp': return 'webp';
    case 'image/png': return 'png';
    case 'video/mp4': return 'mp4';
    case 'audio/mpeg': return 'mp3';
    case 'audio/wav': return 'wav';
    default: return 'bin';
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
