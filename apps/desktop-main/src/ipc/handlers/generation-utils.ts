import path from 'node:path';
import { MAX_ACCUMULATED_VARIANTS } from './generation-constants.js';

export function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function normalizePresetLookupValue(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const URL_CHAR = '[A-Za-z0-9\\-._~:/?#\\[\\]@!$&*+;=%]';
const MEDIA_URL_RE = new RegExp(
  `(https?://${URL_CHAR}+\\.(?:png|jpg|jpeg|webp|mp4|mov|webm)(?:${URL_CHAR}*)?)`,
  'i',
);
export function extractMediaUrlFromLLMText(text: string): string | null {
  if (!text) return null;
  const m = text.match(MEDIA_URL_RE);
  return m?.[1] ?? null;
}

export function resolvePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

export function capitalizeUpdateStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function mergeVariants(
  existing: string[],
  incoming: string[],
): { variants: string[]; selectedVariantIndex: number } {
  const seen = new Set(existing);
  const newHashes = incoming.filter((h) => {
    if (seen.has(h)) return false;
    seen.add(h);
    return true;
  });
  let merged = [...existing, ...newHashes];
  if (merged.length > MAX_ACCUMULATED_VARIANTS) {
    merged = merged.slice(merged.length - MAX_ACCUMULATED_VARIANTS);
  }
  const firstNewIndex = merged.indexOf(newHashes[0] ?? incoming[0]);
  return {
    variants: merged,
    selectedVariantIndex: firstNewIndex >= 0 ? firstNewIndex : 0,
  };
}

export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function extensionFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).slice(1).toLowerCase();
    return ext.length > 0 ? ext : undefined;
  } catch {
    return undefined;
  }
}

export function inferRemoteExtension(url: string, contentType: string | null): string {
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
    case 'video/mp4':
      return 'mp4';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    default:
      return 'bin';
  }
}
