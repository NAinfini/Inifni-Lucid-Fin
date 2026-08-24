import type { Canvas, VideoNodeData } from '@lucid-fin/contracts';
import type { Asset } from '../../../../store/slices/assets.js';

export interface DeliveryMediaSource {
  id: string;
  shotId: string;
  assetHash: string;
  title: string;
  format: string;
  durationMs: number | null;
  hasAudio: boolean | null;
  source: 'canvas' | 'library';
}

function selectedHash(data: VideoNodeData): string | undefined {
  return data.assetHash ?? data.variants?.[data.selectedVariantIndex ?? 0];
}

function durationMs(asset: Asset | undefined, fallbackSeconds?: number): number | null {
  const seconds = asset?.duration ?? fallbackSeconds;
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return null;
  return Math.round(seconds * 1_000);
}

function sourceFromAsset(
  id: string,
  shotId: string,
  assetHash: string,
  title: string,
  asset: Asset | undefined,
  fallbackDuration?: number,
  source: DeliveryMediaSource['source'] = 'canvas',
): DeliveryMediaSource {
  return {
    id,
    shotId,
    assetHash,
    title,
    format: asset?.format?.replace(/^\./, '') || 'mp4',
    durationMs: durationMs(asset, fallbackDuration),
    hasAudio: typeof asset?.metadata?.hasAudio === 'boolean' ? asset.metadata.hasAudio : null,
    source,
  };
}

export function canvasDeliveryMediaSources(canvas: Canvas, assets: readonly Asset[]): DeliveryMediaSource[] {
  const assetByHash = new Map(assets.map((asset) => [asset.hash, asset]));
  return canvas.nodes.flatMap((node) => {
    if (node.type !== 'video') return [];
    const data = node.data as VideoNodeData;
    const selected = selectedHash(data);
    const hashes = [...new Set([...(data.variants ?? []), ...(selected ? [selected] : [])])];
    return hashes.map((assetHash, index) => sourceFromAsset(
      `node:${node.id}:${assetHash}`,
      node.id,
      assetHash,
      hashes.length > 1
        ? `${node.title || assetByHash.get(assetHash)?.name || 'Untitled video'} · Variant ${index + 1}`
        : (node.title || assetByHash.get(assetHash)?.name || 'Untitled video'),
      assetByHash.get(assetHash),
      data.duration,
    ));
  });
}

export function libraryDeliveryMediaSources(assets: readonly Asset[]): DeliveryMediaSource[] {
  return assets.flatMap((asset) => {
    if (asset.type !== 'video' || !asset.hash) return [];
    return [sourceFromAsset(
      `asset:${asset.id}`,
      `media-${asset.id}`,
      asset.hash,
      asset.name || asset.hash.slice(0, 12),
      asset,
      undefined,
      'library',
    )];
  });
}
