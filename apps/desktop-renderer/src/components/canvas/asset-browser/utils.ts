import { t } from '../../../i18n.js';
import type { Asset } from '../../../store/slices/assets.js';

export function formatSize(size: number): string {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationShort(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : t('toast.error.unknownError');
}

export function getErrorDetail(error: unknown): string | undefined {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export function formatFailureSummary(summary: string, extraCount: number): string {
  if (extraCount <= 0) return summary;
  return `${summary} (+${extraCount} ${t('assetBrowser.moreFailures')})`;
}

export function localizeAssetType(type: string): string {
  const key = `asset.${type}`;
  const localized = t(key);
  return localized === key ? type : localized;
}

/** Derive a short uppercase format label from the asset */
export function getFormatLabel(asset: { format?: string; path?: string; type: string }): string {
  if (asset.format) return asset.format.toUpperCase();
  if (asset.path) {
    const ext = asset.path.split('.').pop();
    if (ext && ext.length <= 5) return ext.toUpperCase();
  }
  // Fallback by type
  const fallback: Record<string, string> = { image: 'IMG', video: 'VID', audio: 'AUD' };
  return fallback[asset.type] ?? '';
}

export function getExportConfig(type: Asset['type']): { type: 'image' | 'video' | 'audio'; format: string } | null {
  switch (type) {
    case 'image':
      return { type: 'image', format: 'png' };
    case 'video':
      return { type: 'video', format: 'mp4' };
    case 'audio':
      return { type: 'audio', format: 'mp3' };
    default:
      return null;
  }
}
