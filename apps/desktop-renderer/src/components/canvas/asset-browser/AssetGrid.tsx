import React, { type ComponentType } from 'react';
import { Download, FileType, Image, Music, Video } from 'lucide-react';
import type { Asset } from '../../../store/slices/assets.js';
import { t, getLocale } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { formatSize, formatDurationShort, getFormatLabel, localizeAssetType, getExportConfig } from './utils.js';
import { VideoGridCard } from './VideoGridCard.js';

const TYPE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  image: Image,
  video: Video,
  audio: Music,
};

const TYPE_BADGE_COLORS: Record<string, string> = {
  image: 'bg-blue-500/80 text-white',
  video: 'bg-purple-500/80 text-white',
  audio: 'bg-green-500/80 text-white',
};

export interface AssetGridProps {
  assets: Array<Asset & { _semanticScore?: number }>;
  selectedHashes: Set<string>;
  viewMode: 'grid' | 'list';
  gridRef: React.RefObject<HTMLDivElement | null>;
  onAssetClick: (asset: Asset, e: React.MouseEvent) => void;
  onAssetKeyDown: (asset: Asset, e: React.KeyboardEvent) => void;
  onContextMenuSelect: (asset: Asset, e: React.MouseEvent) => void;
  onQuickExport: (asset: Asset, exportConfig: { type: 'image' | 'video' | 'audio'; format: string }) => void;
  /** Loading / indexing / empty states */
  loading: boolean;
  semanticIndexing: boolean;
  semanticMode: boolean;
  searchQuery: string;
}

export function AssetGrid({
  assets,
  selectedHashes,
  viewMode,
  gridRef,
  onAssetClick,
  onAssetKeyDown,
  onContextMenuSelect,
  onQuickExport,
  loading,
  semanticIndexing,
  semanticMode,
  searchQuery,
}: AssetGridProps) {
  if (loading) {
    return (
      <div className="p-3">
        <div className="text-xs text-muted-foreground">{t('assetBrowser.loading')}</div>
      </div>
    );
  }
  if (semanticIndexing) {
    return (
      <div className="p-3">
        <div className="text-xs text-muted-foreground">{t('assetBrowser.semantic.indexing')}</div>
      </div>
    );
  }
  if (assets.length === 0) {
    return (
      <div className="p-3">
        <div className="flex h-full flex-col items-center justify-center text-center text-xs text-muted-foreground">
          <span className="mb-2 h-8 w-8 opacity-20" />
          <div>{semanticMode && searchQuery ? t('assetBrowser.semantic.noResults') : t('assetBrowser.empty')}</div>
          <div className="mt-0.5 text-[11px]">{t('assetBrowser.emptyHint')}</div>
        </div>
      </div>
    );
  }

  if (viewMode === 'grid') {
    return (
      <div className="p-3">
        <div ref={gridRef} className="grid grid-cols-3 gap-2">
          {assets.map((asset) => (
            <GridCard
              key={asset.id}
              asset={asset}
              isSelected={selectedHashes.has(asset.hash)}
              onAssetClick={onAssetClick}
              onAssetKeyDown={onAssetKeyDown}
              onContextMenuSelect={onContextMenuSelect}
              onQuickExport={onQuickExport}
            />
          ))}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="p-3">
      <div ref={gridRef} className="flex flex-col">
        {/* List header */}
        <div className="mb-1 grid grid-cols-[32px_1fr_56px_80px_56px] gap-2 px-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          <span />
          <span>{t('assetBrowser.fields.name')}</span>
          <span>{t('assetBrowser.fields.type')}</span>
          <span>{t('assetBrowser.sortBy.date')}</span>
          <span>{t('assetBrowser.fields.size')}</span>
        </div>
        {assets.map((asset) => (
          <ListRow
            key={asset.id}
            asset={asset}
            isSelected={selectedHashes.has(asset.hash)}
            onAssetClick={onAssetClick}
            onContextMenuSelect={onContextMenuSelect}
          />
        ))}
      </div>
    </div>
  );
}

/* ---- Internal sub-components (not exported) ---- */

interface GridCardProps {
  asset: Asset & { _semanticScore?: number };
  isSelected: boolean;
  onAssetClick: (asset: Asset, e: React.MouseEvent) => void;
  onAssetKeyDown: (asset: Asset, e: React.KeyboardEvent) => void;
  onContextMenuSelect: (asset: Asset, e: React.MouseEvent) => void;
  onQuickExport: (asset: Asset, exportConfig: { type: 'image' | 'video' | 'audio'; format: string }) => void;
}

function GridCard({ asset, isSelected, onAssetClick, onAssetKeyDown, onContextMenuSelect, onQuickExport }: GridCardProps) {
  const Icon = TYPE_ICONS[asset.type] ?? FileType;
  const thumbnail = asset.type === 'image' && asset.hash
    ? `lucid-asset://${asset.hash}/image/png`
    : undefined;
  const videoUrl = asset.type === 'video' && asset.hash
    ? `lucid-asset://${asset.hash}/video/mp4`
    : undefined;
  const exportConfig = getExportConfig(asset.type);
  const typeBadgeColor = TYPE_BADGE_COLORS[asset.type] ?? 'bg-muted text-muted-foreground';

  return (
    <div
      className={cn(
        'group relative rounded-md border bg-background p-1.5 transition-colors hover:border-primary/40 hover:bg-muted/80',
        isSelected ? 'border-primary ring-1 ring-primary/40' : 'border-border/60',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        data-asset-card
        data-asset-hash={asset.hash}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(
            'application/x-lucid-asset',
            JSON.stringify({
              hash: asset.hash,
              name: asset.name,
              type: asset.type,
            }),
          );
          event.dataTransfer.setData('application/lucid-entity-id', asset.hash);
          event.dataTransfer.effectAllowed = 'copyMove';
        }}
        onClick={(e) => onAssetClick(asset, e)}
        onKeyDown={(event) => onAssetKeyDown(asset, event)}
        onContextMenu={(e) => onContextMenuSelect(asset, e)}
        className="text-left"
      >
        <div className="mb-1.5 flex aspect-square items-center justify-center overflow-hidden rounded-md bg-muted relative">
          {/* Thumbnail or video */}
          {thumbnail ? (
            <img
              src={thumbnail}
              alt={asset.name}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
          ) : videoUrl ? (
            <VideoGridCard
              src={videoUrl}
              className="h-full w-full object-cover"
            />
          ) : (
            <Icon className="h-6 w-6 text-muted-foreground" />
          )}

          {/* Type badge: top-left */}
          <span className={cn(
            'absolute top-1 left-1 flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-semibold leading-tight',
            typeBadgeColor,
          )}>
            <Icon className="h-2.5 w-2.5" />
          </span>

          {/* Duration badge: bottom-right (video/audio) */}
          {asset.duration != null && (asset.type === 'video' || asset.type === 'audio') && (
            <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-px text-[9px] font-semibold leading-tight text-white">
              {formatDurationShort(asset.duration)}
            </span>
          )}

          {/* Format badge: bottom-left */}
          {(() => {
            const fmt = getFormatLabel(asset);
            return fmt ? (
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-px text-[9px] font-semibold leading-tight text-white">
                {fmt}
              </span>
            ) : null;
          })()}
        </div>
        <div className="truncate text-[11px] font-medium">{asset.name}</div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{formatSize(asset.size)}</span>
          {asset._semanticScore != null && (
            <span className="rounded bg-primary/10 px-1 py-px text-[9px] font-semibold text-primary">
              {Math.round(asset._semanticScore * 100)}%
            </span>
          )}
        </div>
      </div>

      {exportConfig && (
        <button
          type="button"
          className="absolute right-2 top-2 rounded bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          onClick={() => onQuickExport(asset, exportConfig)}
          title={t('assetBrowser.export')}
        >
          <Download className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

interface ListRowProps {
  asset: Asset;
  isSelected: boolean;
  onAssetClick: (asset: Asset, e: React.MouseEvent) => void;
  onContextMenuSelect: (asset: Asset, e: React.MouseEvent) => void;
}

function ListRow({ asset, isSelected, onAssetClick, onContextMenuSelect }: ListRowProps) {
  const Icon = TYPE_ICONS[asset.type] ?? FileType;
  const thumbnail = asset.type === 'image' && asset.hash
    ? `lucid-asset://${asset.hash}/image/png`
    : undefined;
  const typeBadgeColor = TYPE_BADGE_COLORS[asset.type] ?? 'bg-muted text-muted-foreground';

  return (
    <button
      type="button"
      data-asset-card
      data-asset-hash={asset.hash}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(
          'application/x-lucid-asset',
          JSON.stringify({
            hash: asset.hash,
            name: asset.name,
            type: asset.type,
          }),
        );
        event.dataTransfer.setData('application/lucid-entity-id', asset.hash);
        event.dataTransfer.effectAllowed = 'copyMove';
      }}
      onClick={(e) => onAssetClick(asset, e)}
      onContextMenu={(e) => onContextMenuSelect(asset, e)}
      className={cn(
        'grid grid-cols-[32px_1fr_56px_80px_56px] items-center gap-2 rounded-md border px-1 py-1 text-left transition-colors hover:border-primary/40 hover:bg-muted/80 mb-0.5',
        isSelected ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-transparent',
      )}
    >
      {/* Thumb 32x32 */}
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
        {thumbnail ? (
          <img src={thumbnail} alt={asset.name} className="h-full w-full object-cover" />
        ) : (
          <Icon className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      {/* Name */}
      <span className="truncate text-[11px] font-medium">{asset.name}</span>
      {/* Type badge */}
      <span className={cn('inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-semibold leading-tight w-fit', typeBadgeColor)}>
        <Icon className="h-2.5 w-2.5" />
        <span>{localizeAssetType(asset.type)}</span>
      </span>
      {/* Date */}
      <span className="text-[10px] text-muted-foreground truncate">
        {new Date(asset.createdAt).toLocaleDateString(getLocale())}
      </span>
      {/* Size */}
      <span className="text-[10px] text-muted-foreground">{formatSize(asset.size)}</span>
    </button>
  );
}
