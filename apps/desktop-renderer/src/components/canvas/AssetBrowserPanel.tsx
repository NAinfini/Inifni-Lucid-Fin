import React, { type ComponentType, useCallback, useEffect, useMemo, useState } from 'react';
import { FileType, FolderSearch, Image, Music, Search, Upload, Video } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import {
  selectFilteredAssets,
  setAssets,
  setFilterType,
  setSearchQuery,
  type Asset,
} from '../../store/slices/assets.js';
import { getAPI } from '../../utils/api.js';
import { t } from '../../i18n.js';
import { cn } from '../../lib/utils.js';

const FILTERS: Array<{ value: Asset['type'] | 'all'; label: string }> = [
  { value: 'all', label: 'asset.all' },
  { value: 'image', label: 'asset.image' },
  { value: 'video', label: 'asset.video' },
  { value: 'audio', label: 'asset.audio' },
];

const TYPE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  image: Image,
  video: Video,
  audio: Music,
};

function formatSize(size: number): string {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

export function AssetBrowserPanel() {
  const dispatch = useDispatch();
  const { filterType, searchQuery } = useSelector((state: RootState) => state.assets);
  const filteredAssets = useSelector(selectFilteredAssets);
  const [loading, setLoading] = useState(false);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const api = getAPI();
      const result = await api?.asset.query(filterType === 'all' ? {} : { type: filterType });
      if (!Array.isArray(result)) return;

      dispatch(
        setAssets(
          result.map((asset) => ({
            id: asset.hash,
            hash: asset.hash,
            name: typeof asset.name === 'string' ? asset.name : asset.hash.slice(0, 12),
            type: (asset.type as Asset['type']) ?? 'other',
            path: typeof asset.path === 'string' ? asset.path : '',
            tags: Array.isArray(asset.tags) ? (asset.tags as string[]) : [],
            projectId: typeof asset.projectId === 'string' ? asset.projectId : undefined,
            global: Boolean(asset.global),
            size: typeof asset.size === 'number' ? asset.size : 0,
            createdAt: typeof asset.createdAt === 'number' ? asset.createdAt : Date.now(),
          })),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [dispatch, filterType]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const gridAssets = useMemo(() => filteredAssets.slice(0, 200), [filteredAssets]);

  const handleImport = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const ref = await api.asset.pickFile('image');
    if (!ref) return;
    await loadAssets();
  }, [loadAssets]);

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <FolderSearch className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{t('panels.assetBrowser')}</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t('assetBrowser.emptyHint')}</p>
      </div>

      <div className="border-b px-4 py-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(event) => dispatch(setSearchQuery(event.target.value))}
            placeholder={t('assetBrowser.searchPlaceholder')}
            className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => dispatch(setFilterType(filter.value))}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors',
                filterType === filter.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {t(filter.label)}
            </button>
          ))}

          <button
            type="button"
            onClick={() => void handleImport()}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Upload className="h-3.5 w-3.5" />
            {t('assetBrowser.import')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">{t('assetBrowser.loading')}</div>
        ) : gridAssets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <FolderSearch className="mb-3 h-10 w-10 opacity-20" />
            <div>{t('assetBrowser.empty')}</div>
            <div className="mt-1 text-xs">{t('assetBrowser.emptyHint')}</div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {gridAssets.map((asset) => {
              const Icon = TYPE_ICONS[asset.type] ?? FileType;
              const thumbnail = asset.type === 'image' && asset.hash
                ? `lucid-asset://${asset.hash}/image/png`
                : undefined;

              return (
                <button
                  key={asset.id}
                  type="button"
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
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  className="rounded-xl border border-border bg-background p-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/50"
                >
                  <div className="mb-2 flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted">
                    {thumbnail ? (
                      <img src={thumbnail} alt={asset.name} className="h-full w-full object-cover" />
                    ) : (
                      <Icon className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="truncate text-xs font-medium">{asset.name}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {formatSize(asset.size)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
