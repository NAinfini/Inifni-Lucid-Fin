import React, { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileType, FolderSearch, Image, Music, Search, Upload, Video, Download, CheckSquare, Trash2, ArrowUpDown, X, Save, Pencil } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import {
  selectFilteredAssets,
  setAssets,
  setFilterType,
  setSearchQuery,
  removeAsset,
  updateAsset,
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

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** Derive a short uppercase format label from the asset */
function getFormatLabel(asset: { format?: string; path?: string; type: string }): string {
  if (asset.format) return asset.format.toUpperCase();
  if (asset.path) {
    const ext = asset.path.split('.').pop();
    if (ext && ext.length <= 5) return ext.toUpperCase();
  }
  // Fallback by type
  const fallback: Record<string, string> = { image: 'IMG', video: 'VID', audio: 'AUD' };
  return fallback[asset.type] ?? '';
}

function getExportConfig(type: Asset['type']): { type: 'image' | 'video' | 'audio'; format: string } | null {
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

export function AssetBrowserPanel() {
  const dispatch = useDispatch();
  const { filterType, searchQuery } = useSelector((state: RootState) => state.assets);
  const filteredAssets = useSelector(selectFilteredAssets);
  const [loading, setLoading] = useState(false);
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [lastClickedHash, setLastClickedHash] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [batchRenaming, setBatchRenaming] = useState(false);
  const [batchPrefix, setBatchPrefix] = useState('');
  const [dragSelect, setDragSelect] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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
            name: typeof asset.name === 'string' ? asset.name : (typeof asset.originalName === 'string' ? asset.originalName : asset.hash.slice(0, 12)),
            type: (asset.type as Asset['type']) ?? 'other',
            path: typeof asset.path === 'string' ? asset.path : '',
            tags: Array.isArray(asset.tags) ? (asset.tags as string[]) : [],
            projectId: typeof asset.projectId === 'string' ? asset.projectId : undefined,
            global: Boolean(asset.global),
            size: typeof asset.fileSize === 'number' ? asset.fileSize : (typeof asset.size === 'number' ? asset.size : 0),
            createdAt: typeof asset.createdAt === 'number' ? asset.createdAt : Date.now(),
            format: typeof asset.format === 'string' ? asset.format : undefined,
            width: typeof asset.width === 'number' ? asset.width : undefined,
            height: typeof asset.height === 'number' ? asset.height : undefined,
            duration: typeof asset.duration === 'number' ? asset.duration : undefined,
            provider: typeof asset.provider === 'string' ? asset.provider : undefined,
            prompt: typeof asset.prompt === 'string' ? asset.prompt : undefined,
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

  const gridAssets = useMemo(() => {
    const sorted = [...filteredAssets].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') cmp = a.createdAt - b.createdAt;
      else if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'size') cmp = a.size - b.size;
      return sortOrder === 'desc' ? -cmp : cmp;
    });
    return sorted.slice(0, 200);
  }, [filteredAssets, sortBy, sortOrder]);

  const handleImport = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const ref = await api.asset.pickFile('image');
    if (!ref) return;
    await loadAssets();
  }, [loadAssets]);

  // --- Multi-select click handler ---
  const handleAssetClick = useCallback((asset: Asset, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedHash) {
      // Shift+click: range select
      const startIdx = gridAssets.findIndex((a) => a.hash === lastClickedHash);
      const endIdx = gridAssets.findIndex((a) => a.hash === asset.hash);
      if (startIdx !== -1 && endIdx !== -1) {
        const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const rangeHashes = gridAssets.slice(lo, hi + 1).map((a) => a.hash);
        setSelectedHashes((prev) => {
          const next = new Set(prev);
          for (const h of rangeHashes) next.add(h);
          return next;
        });
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Ctrl+click: toggle single
      setSelectedHashes((prev) => {
        const next = new Set(prev);
        if (next.has(asset.hash)) next.delete(asset.hash);
        else next.add(asset.hash);
        return next;
      });
    } else if (selectMode) {
      // Select mode: toggle
      setSelectedHashes((prev) => {
        const next = new Set(prev);
        if (next.has(asset.hash)) next.delete(asset.hash);
        else next.add(asset.hash);
        return next;
      });
    } else {
      // Normal click: select single + open detail
      setSelectedHashes(new Set([asset.hash]));
      setDetailAsset(asset);
      setEditingName(asset.name);
      setIsEditingName(false);
    }
    setLastClickedHash(asset.hash);
  }, [gridAssets, lastClickedHash, selectMode]);

  // --- Delete selected assets ---
  const handleDeleteSelected = useCallback(async () => {
    if (selectedHashes.size === 0) return;
    const api = getAPI();
    for (const hash of selectedHashes) {
      await api?.asset.delete(hash);
      const asset = gridAssets.find((a) => a.hash === hash);
      if (asset) dispatch(removeAsset(asset.id));
    }
    setSelectedHashes(new Set());
    setDetailAsset(null);
    setContextMenu(null);
  }, [selectedHashes, gridAssets, dispatch]);

  // --- Export selected ---
  const handleExportSelected = useCallback(() => {
    const api = getAPI();
    const items = gridAssets
      .filter((a) => selectedHashes.has(a.hash))
      .map((a) => ({ hash: a.hash, type: a.type as 'image' | 'video' | 'audio', name: a.name }));
    void api?.asset.exportBatch({ items });
    setContextMenu(null);
  }, [gridAssets, selectedHashes]);

  // --- Batch rename ---
  const handleBatchRename = useCallback(() => {
    if (!batchPrefix.trim()) return;
    let idx = 1;
    for (const hash of selectedHashes) {
      const asset = gridAssets.find((a) => a.hash === hash);
      if (asset) {
        const newName = `${batchPrefix.trim()}_${String(idx).padStart(3, '0')}`;
        dispatch(updateAsset({ id: asset.id, data: { name: newName } }));
        idx++;
      }
    }
    setBatchRenaming(false);
    setBatchPrefix('');
    setContextMenu(null);
  }, [batchPrefix, selectedHashes, gridAssets, dispatch]);

  // --- Context menu ---
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (selectedHashes.size === 0) return;
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [selectedHashes]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // --- Keyboard: Delete ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedHashes.size > 0 && !isEditingName && !batchRenaming) {
        e.preventDefault();
        void handleDeleteSelected();
      }
      // Ctrl+A to select all (when panel focused)
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && panelRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        setSelectedHashes(new Set(gridAssets.map((a) => a.hash)));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedHashes, gridAssets, handleDeleteSelected, isEditingName, batchRenaming]);

  // --- Drag select (rubber band) ---
  const handleGridMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start drag select on left click on the grid background (not on an asset card)
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-asset-card]')) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDragSelect({ startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY });
    if (!selectMode) setSelectedHashes(new Set());
  }, [selectMode]);

  useEffect(() => {
    if (!dragSelect) return;
    const onMove = (e: MouseEvent) => {
      setDragSelect((prev) => prev ? { ...prev, currentX: e.clientX, currentY: e.clientY } : null);
    };
    const onUp = () => {
      // Determine which asset cards intersect the rubber band
      if (gridRef.current && dragSelect) {
        const rect = {
          left: Math.min(dragSelect.startX, dragSelect.currentX),
          right: Math.max(dragSelect.startX, dragSelect.currentX),
          top: Math.min(dragSelect.startY, dragSelect.currentY),
          bottom: Math.max(dragSelect.startY, dragSelect.currentY),
        };
        const cards = gridRef.current.querySelectorAll<HTMLElement>('[data-asset-hash]');
        const hits = new Set<string>();
        cards.forEach((card) => {
          const cr = card.getBoundingClientRect();
          if (cr.right >= rect.left && cr.left <= rect.right && cr.bottom >= rect.top && cr.top <= rect.bottom) {
            const hash = card.getAttribute('data-asset-hash');
            if (hash) hits.add(hash);
          }
        });
        if (hits.size > 0) {
          setSelectedHashes((prev) => new Set([...prev, ...hits]));
        }
      }
      setDragSelect(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragSelect]);

  const dragRect = dragSelect ? {
    left: Math.min(dragSelect.startX, dragSelect.currentX),
    top: Math.min(dragSelect.startY, dragSelect.currentY),
    width: Math.abs(dragSelect.currentX - dragSelect.startX),
    height: Math.abs(dragSelect.currentY - dragSelect.startY),
  } : null;

  return (
    <div ref={panelRef} className="flex h-full flex-col bg-card" tabIndex={-1}>
      <div className="border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <FolderSearch className="h-3.5 w-3.5 text-primary" />
          <h2 className="text-xs font-semibold">{t('panels.assetBrowser')}</h2>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t('assetBrowser.emptyHint')}</p>
      </div>

      <div className="border-b border-border/60 px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(event) => dispatch(setSearchQuery(event.target.value))}
            placeholder={t('assetBrowser.searchPlaceholder')}
            className="w-full rounded-md border border-border/60 bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => dispatch(setFilterType(filter.value))}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                filterType === filter.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/60 text-muted-foreground hover:bg-muted/80 hover:text-foreground',
              )}
            >
              {t(filter.label)}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => void handleImport()}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          >
            <Upload className="h-3 w-3" />
            {t('assetBrowser.import')}
          </button>
          <button
            type="button"
            onClick={() => { setSelectMode((v) => !v); setSelectedHashes(new Set()); }}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
              selectMode ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 text-muted-foreground hover:bg-muted/80 hover:text-foreground',
            )}
          >
            <CheckSquare className="h-3 w-3" />
            {selectMode ? t('assetBrowser.cancelSelect') || 'Cancel' : t('assetBrowser.export')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (sortBy === 'date') setSortBy('name');
              else if (sortBy === 'name') setSortBy('size');
              else setSortBy('date');
            }}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          >
            <ArrowUpDown className="h-3 w-3" />
            {sortBy === 'date' ? t('assetBrowser.sortBy.date') || 'Date' : sortBy === 'name' ? t('assetBrowser.sortBy.name') || 'Name' : t('assetBrowser.sortBy.size') || 'Size'}
          </button>
          <button
            type="button"
            onClick={() => setSortOrder((o) => o === 'asc' ? 'desc' : 'asc')}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
        </div>
        {selectedHashes.size > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">{selectedHashes.size} selected</span>
            <button
              type="button"
              onClick={handleExportSelected}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-[11px] text-primary-foreground"
            >
              <Download className="h-3 w-3" />
              {t('assetBrowser.exportSelected') || 'Export'}
            </button>
            <button
              type="button"
              onClick={() => void handleDeleteSelected()}
              className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/20"
            >
              <Trash2 className="h-3 w-3" />
              {t('action.delete') || 'Delete'}
            </button>
          </div>
        )}
      </div>

      <div className="relative flex-1 overflow-y-auto p-3" onMouseDown={handleGridMouseDown} onContextMenu={handleContextMenu}>
        {loading ? (
          <div className="text-xs text-muted-foreground">{t('assetBrowser.loading')}</div>
        ) : gridAssets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-xs text-muted-foreground">
            <FolderSearch className="mb-2 h-8 w-8 opacity-20" />
            <div>{t('assetBrowser.empty')}</div>
            <div className="mt-0.5 text-[11px]">{t('assetBrowser.emptyHint')}</div>
          </div>
        ) : (
          <div ref={gridRef} className="grid grid-cols-3 gap-2">
            {gridAssets.map((asset) => {
              const Icon = TYPE_ICONS[asset.type] ?? FileType;
              const thumbnail = asset.type === 'image' && asset.hash
                ? `lucid-asset://${asset.hash}/image/png`
                : undefined;
              const videoUrl = asset.type === 'video' && asset.hash
                ? `lucid-asset://${asset.hash}/video/mp4`
                : undefined;
              const isSelected = selectedHashes.has(asset.hash);
              const exportConfig = getExportConfig(asset.type);

              return (
                <button
                  key={asset.id}
                  type="button"
                  data-asset-card
                  data-asset-hash={asset.hash}
                  draggable={!selectMode}
                  onDragStart={(event) => {
                    if (selectMode) return;
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
                  onClick={(e) => handleAssetClick(asset, e)}
                  onContextMenu={(e) => {
                    // Right-click: select if not already selected, then show context menu
                    if (!selectedHashes.has(asset.hash)) {
                      if (!e.ctrlKey && !e.metaKey) setSelectedHashes(new Set([asset.hash]));
                      else setSelectedHashes((prev) => new Set([...prev, asset.hash]));
                    }
                  }}
                  className={cn(
                    'group rounded-md border bg-background p-1.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/80',
                    isSelected ? 'border-primary ring-1 ring-primary/40' : 'border-border/60',
                  )}
                >
                  <div className="mb-1.5 flex aspect-square items-center justify-center overflow-hidden rounded-md bg-muted relative">
                    {thumbnail ? (
                      <img src={thumbnail} alt={asset.name} className="h-full w-full object-cover" />
                    ) : videoUrl ? (
                      <video src={videoUrl} className="h-full w-full object-cover" muted preload="metadata" />
                    ) : (
                      <Icon className="h-6 w-6 text-muted-foreground" />
                    )}
                    {exportConfig && (
                      <button
                        type="button"
                        className="absolute top-1 right-1 rounded bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          const api = getAPI();
                          void api?.asset.export({
                            hash: asset.hash,
                            type: exportConfig.type,
                            format: exportConfig.format,
                            name: asset.name,
                          });
                        }}
                        title={t('assetBrowser.export')}
                      >
                        <Download className="h-3 w-3" />
                      </button>
                    )}
                    {/* Format badge */}
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
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {formatSize(asset.size)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {/* Rubber band overlay */}
        {dragRect && dragRect.width > 3 && dragRect.height > 3 && (
          <div
            className="pointer-events-none fixed z-50 border border-primary/60 bg-primary/10"
            style={{ left: dragRect.left, top: dragRect.top, width: dragRect.width, height: dragRect.height }}
          />
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && selectedHashes.size > 0 && (
        <div
          className="fixed z-50 min-w-[160px] rounded-md border border-border/60 bg-popover py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => void handleDeleteSelected()}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-muted"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('action.delete') || 'Delete'} ({selectedHashes.size})
          </button>
          <button
            type="button"
            onClick={() => { setBatchRenaming(true); setBatchPrefix(''); setContextMenu(null); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            <Pencil className="h-3.5 w-3.5" />
            Batch Rename ({selectedHashes.size})
          </button>
          <button
            type="button"
            onClick={handleExportSelected}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" />
            {t('assetBrowser.export') || 'Export'} ({selectedHashes.size})
          </button>
        </div>
      )}

      {/* Batch Rename Dialog */}
      {batchRenaming && (
        <div className="border-t border-border/60 px-3 py-2 space-y-1.5 bg-card">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium">Batch Rename ({selectedHashes.size} items)</span>
            <button type="button" onClick={() => setBatchRenaming(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="text-[10px] text-muted-foreground">Prefix + _001, _002, ...</div>
          <div className="flex items-center gap-1">
            <input
              value={batchPrefix}
              onChange={(e) => setBatchPrefix(e.target.value)}
              placeholder="Enter prefix..."
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleBatchRename(); if (e.key === 'Escape') setBatchRenaming(false); }}
              className="flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={handleBatchRename}
              disabled={!batchPrefix.trim()}
              className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground disabled:opacity-50"
            >
              <Save className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Asset Detail Panel */}
      {detailAsset && !batchRenaming && (
        <div className="border-t border-border/60 px-3 py-2 space-y-1.5 bg-card">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium">{t('assetBrowser.details')}</span>
            <button type="button" onClick={() => { setDetailAsset(null); setIsEditingName(false); }} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <input
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              disabled={!isEditingName}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isEditingName) {
                  dispatch(updateAsset({ id: detailAsset.id, data: { name: editingName } }));
                  setDetailAsset({ ...detailAsset, name: editingName });
                  setIsEditingName(false);
                }
                if (e.key === 'Escape') { setEditingName(detailAsset.name); setIsEditingName(false); }
              }}
              className={cn(
                'flex-1 rounded border px-2 py-1 text-xs outline-none',
                isEditingName
                  ? 'border-primary bg-background focus:ring-1 focus:ring-primary'
                  : 'border-transparent bg-muted text-foreground cursor-default',
              )}
            />
            {isEditingName ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    dispatch(updateAsset({ id: detailAsset.id, data: { name: editingName } }));
                    setDetailAsset({ ...detailAsset, name: editingName });
                    setIsEditingName(false);
                  }}
                  className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground"
                  title="Save"
                >
                  <Save className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingName(detailAsset.name); setIsEditingName(false); }}
                  className="rounded px-1.5 py-1 text-destructive hover:bg-destructive/10"
                  title="Cancel"
                >
                  <X className="h-3 w-3" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingName(true)}
                className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                title="Edit name"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="space-y-1 text-[10px] text-muted-foreground">
            <div className="flex justify-between"><span>{t('assetBrowser.fields.type')}</span><span>{detailAsset.type}</span></div>
            <div className="flex justify-between"><span>{t('assetBrowser.fields.size')}</span><span>{formatSize(detailAsset.size)}</span></div>
            {detailAsset.format && (
              <div className="flex justify-between"><span>Format</span><span className="uppercase">{detailAsset.format}</span></div>
            )}
            {detailAsset.width != null && detailAsset.height != null && (
              <div className="flex justify-between"><span>Dimensions</span><span>{detailAsset.width}&times;{detailAsset.height}</span></div>
            )}
            {detailAsset.duration != null && (detailAsset.type === 'video' || detailAsset.type === 'audio') && (
              <div className="flex justify-between"><span>Duration</span><span>{formatDuration(detailAsset.duration)}</span></div>
            )}
            <div className="flex justify-between"><span>Hash</span><span className="font-mono truncate max-w-[120px]" title={detailAsset.hash}>{detailAsset.hash.slice(0, 16)}...</span></div>
            <div className="flex justify-between"><span>{t('assetBrowser.created') || 'Created'}</span><span>{new Date(detailAsset.createdAt).toLocaleString()}</span></div>
            {detailAsset.provider && (
              <div className="flex justify-between"><span>Provider</span><span>{detailAsset.provider}</span></div>
            )}
            {detailAsset.prompt && (
              <div className="flex flex-col gap-0.5">
                <span>Prompt</span>
                <span className="text-[10px] text-foreground/80 break-words leading-snug">{detailAsset.prompt}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
