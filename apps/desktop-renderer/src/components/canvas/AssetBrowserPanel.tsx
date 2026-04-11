import React, { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileType, FolderSearch, Image, Music, Search, Sparkles, Upload, Video, Download, CheckSquare, Trash2, ArrowUpDown, X, Save, Pencil, LayoutGrid, List, Copy, RefreshCw } from 'lucide-react';
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
import { getLocale, t } from '../../i18n.js';
import { addLog } from '../../store/slices/logger.js';
import { useToast } from '../../hooks/use-toast.js';
import { cn } from '../../lib/utils.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog.js';

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

/** Accent color classes per asset type for the badge */
const TYPE_BADGE_COLORS: Record<string, string> = {
  image: 'bg-blue-500/80 text-white',
  video: 'bg-purple-500/80 text-white',
  audio: 'bg-green-500/80 text-white',
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

function formatDurationShort(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : t('toast.error.unknownError');
}

function getErrorDetail(error: unknown): string | undefined {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function formatFailureSummary(summary: string, extraCount: number): string {
  if (extraCount <= 0) return summary;
  return `${summary} (+${extraCount} ${t('assetBrowser.moreFailures')})`;
}

function localizeAssetType(type: string): string {
  const key = `asset.${type}`;
  const localized = t(key);
  return localized === key ? type : localized;
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

/** Video card that auto-plays on hover */
function VideoGridCard({ src, className }: { src: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      void videoRef.current.play().catch(() => {/* ignore */});
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, []);

  return (
    <video
      ref={videoRef}
      src={src}
      className={className}
      muted
      preload="metadata"
      loop
      playsInline
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    />
  );
}

export function AssetBrowserPanel() {
  const dispatch = useDispatch();
  const { error: showErrorToast } = useToast();
  const { filterType, searchQuery } = useSelector((state: RootState) => state.assets);
  const allAssets = useSelector((state: RootState) => state.assets.items);
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteHashes, setPendingDeleteHashes] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isDragOver, setIsDragOver] = useState(false);
  const [semanticMode, setSemanticMode] = useState(false);
  const [semanticResults, setSemanticResults] = useState<{ hash: string; score: number; description: string }[]>([]);
  const [semanticIndexing, setSemanticIndexing] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const logAssetFailure = useCallback((message: string, error: unknown) => {
    dispatch(
      addLog({
        level: 'error',
        category: 'asset',
        message,
        detail: getErrorDetail(error),
      }),
    );
  }, [dispatch]);

  const handleSemanticSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setSemanticResults([]); return; }
    const api = getAPI();
    if (!api?.embedding) return;
    try {
      const results = await api.embedding.search(query, 50);
      setSemanticResults(results);
    } catch (error) {
      dispatch(addLog({ level: 'error', category: 'asset', message: 'Semantic search failed', detail: getErrorDetail(error) }));
      setSemanticResults([]);
    }
  }, [dispatch]);

  const handleReindex = useCallback(async () => {
    const api = getAPI();
    if (!api?.embedding) return;
    setSemanticIndexing(true);
    try {
      await api.embedding.reindex();
    } catch (error) {
      dispatch(addLog({ level: 'error', category: 'asset', message: 'Re-index failed', detail: getErrorDetail(error) }));
    } finally {
      setSemanticIndexing(false);
    }
  }, [dispatch]);

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
    } catch (error) {
      const title = t('assetBrowser.loadFailed');
      logAssetFailure(title, error);
      showErrorToast({
        title,
        message: getErrorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }, [dispatch, filterType, logAssetFailure, showErrorToast]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const gridAssets = useMemo(() => {
    if (semanticMode) {
      // Map semantic results to asset objects, preserving score order
      return semanticResults
        .map((r) => {
          const asset = allAssets.find((a) => a.hash === r.hash);
          return asset ? { ...asset, _semanticScore: r.score } : null;
        })
        .filter((a): a is Asset & { _semanticScore: number } => a !== null);
    }
    const sorted = [...filteredAssets].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') cmp = a.createdAt - b.createdAt;
      else if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'size') cmp = a.size - b.size;
      return sortOrder === 'desc' ? -cmp : cmp;
    });
    return sorted.slice(0, 200);
  }, [semanticMode, semanticResults, allAssets, filteredAssets, sortBy, sortOrder]);

  const handleImport = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    try {
      const ref = await api.asset.pickFile('image');
      if (!ref) return;
      await loadAssets();
    } catch (error) {
      const title = t('assetBrowser.importFailed');
      logAssetFailure(title, error);
      showErrorToast({
        title,
        message: getErrorMessage(error),
      });
    }
  }, [loadAssets, logAssetFailure, showErrorToast]);

  // --- File/Asset drop into panel ---
  const handlePanelDragOver = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (types.includes('Files') || types.includes('application/x-lucid-node-asset')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handlePanelDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the panel itself (not a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false);
    }
  }, []);

  const handlePanelDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const api = getAPI();
    if (!api) return;

    // Handle node-asset drops (asset already in CAS, just refresh)
    const nodeAssetRaw = e.dataTransfer.getData('application/x-lucid-node-asset');
    if (nodeAssetRaw) {
      await loadAssets();
      return;
    }

    // Handle OS file drops
    const files = e.dataTransfer.files;
    if (files.length === 0) return;
    const importPromises: Promise<void>[] = [];
    const failedImports: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;
      let type: string | null = null;
      if (file.type.startsWith('image/')) type = 'image';
      else if (file.type.startsWith('video/')) type = 'video';
      else if (file.type.startsWith('audio/')) type = 'audio';
      if (!type) {
        const msg = `${file.name}: ${t('assetBrowser.unsupportedFileType')}`;
        failedImports.push(msg);
        dispatch(addLog({ level: 'warn', category: 'asset', message: msg }));
        continue;
      }
      const filePath = (file as { path?: string }).path ?? '';
      if (filePath) {
        // Electron with File.path available — import by path
        importPromises.push(
          api.asset.import(filePath, type)
            .then(() => undefined)
            .catch((error: unknown) => {
              const msg = `${file.name}: ${getErrorMessage(error)}`;
              failedImports.push(msg);
              dispatch(addLog({ level: 'error', category: 'asset', message: msg }));
            }),
        );
      } else if (api.asset.importBuffer) {
        // Sandboxed renderer — read file as ArrayBuffer and send via IPC
        importPromises.push(
          file.arrayBuffer()
            .then((buf) => api.asset.importBuffer!(buf, file.name, type!))
            .then(() => undefined)
            .catch((error: unknown) => {
              const msg = `${file.name}: ${getErrorMessage(error)}`;
              failedImports.push(msg);
              dispatch(addLog({ level: 'error', category: 'asset', message: msg }));
            }),
        );
      } else {
        const msg = `${file.name}: ${t('assetBrowser.importPathUnavailable')}`;
        failedImports.push(msg);
        dispatch(addLog({ level: 'error', category: 'asset', message: msg }));
      }
    }
    await Promise.all(importPromises);
    if (failedImports.length > 0) {
      const summary = failedImports[0] ?? t('toast.error.unknownError');
      const extraCount = failedImports.length - 1;
      showErrorToast({
        title: t('assetBrowser.importFailed'),
        message: formatFailureSummary(summary, extraCount),
      });
    }
    await loadAssets();
  }, [dispatch, loadAssets, showErrorToast]);

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

  const handleAssetCardKeyDown = useCallback((asset: Asset, event: React.KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setSelectedHashes(new Set([asset.hash]));
    setDetailAsset(asset);
    setEditingName(asset.name);
    setIsEditingName(false);
    setLastClickedHash(asset.hash);
  }, []);

  // --- Delete selected assets ---
  const handleDeleteSelected = useCallback(() => {
    if (selectedHashes.size === 0) return;
    setPendingDeleteHashes(new Set(selectedHashes));
    setDeleteConfirmOpen(true);
  }, [selectedHashes]);

  const executeDelete = useCallback(async () => {
    const api = getAPI();
    if (!api) { setDeleteConfirmOpen(false); return; }
    const hashesToDelete = new Set(pendingDeleteHashes);
    const deletedHashes = new Set<string>();
    const failedDeletes: string[] = [];
    setDeleteConfirmOpen(false);
    for (const hash of hashesToDelete) {
      const asset = allAssets.find((entry) => entry.hash === hash);
      try {
        await api.asset.delete(hash);
        deletedHashes.add(hash);
        if (asset) dispatch(removeAsset(asset.id));
      } catch (error) {
        const msg = `${asset?.name ?? hash}: ${getErrorMessage(error)}`;
        failedDeletes.push(msg);
        dispatch(addLog({ level: 'error', category: 'asset', message: msg }));
        // Keep failed assets visible so the user can retry.
      }
    }
    if (failedDeletes.length > 0) {
      const summary = failedDeletes[0] ?? t('toast.error.unknownError');
      const extraCount = failedDeletes.length - 1;
      showErrorToast({
        title: t('assetBrowser.deleteFailed'),
        message: formatFailureSummary(summary, extraCount),
      });
    }
    setSelectedHashes((prev) => {
      const next = new Set(prev);
      for (const h of deletedHashes) next.delete(h);
      return next;
    });
    setDetailAsset((prev) => (prev && deletedHashes.has(prev.hash) ? null : prev));
    setContextMenu(null);
  }, [pendingDeleteHashes, allAssets, dispatch, showErrorToast]);

  // --- Export selected ---
  const handleExportSelected = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    const items = gridAssets
      .filter((a) => selectedHashes.has(a.hash))
      .map((a) => ({ hash: a.hash, type: a.type as 'image' | 'video' | 'audio', name: a.name }));
    if (items.length === 0) {
      setContextMenu(null);
      return;
    }
    try {
      await api.asset.exportBatch({ items });
    } catch (error) {
      const title = t('assetBrowser.exportFailed');
      logAssetFailure(title, error);
      showErrorToast({
        title,
        message: getErrorMessage(error),
      });
    }
    setContextMenu(null);
  }, [gridAssets, logAssetFailure, selectedHashes, showErrorToast]);

  // --- Copy hash ---
  const handleCopyHash = useCallback(async () => {
    if (selectedHashes.size === 1) {
      const hash = [...selectedHashes][0];
      try {
        await navigator.clipboard.writeText(hash ?? '');
      } catch (error) {
        const title = t('assetBrowser.copyHashFailed');
        logAssetFailure(title, error);
        showErrorToast({
          title,
          message: getErrorMessage(error),
        });
      }
    }
    setContextMenu(null);
  }, [logAssetFailure, selectedHashes, showErrorToast]);

  const handleQuickExport = useCallback(async (asset: Asset, exportConfig: { type: 'image' | 'video' | 'audio'; format: string }) => {
    const api = getAPI();
    if (!api) return;
    try {
      await api.asset.export({
        hash: asset.hash,
        type: exportConfig.type,
        format: exportConfig.format,
        name: asset.name,
      });
    } catch (error) {
      const title = t('assetBrowser.exportFailed');
      logAssetFailure(title, error);
      showErrorToast({
        title,
        message: getErrorMessage(error),
      });
    }
  }, [logAssetFailure, showErrorToast]);

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
        handleDeleteSelected();
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
    // Only start drag select on left click on the grid background (not on an asset card or interactive element)
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-asset-card], button, a, input, [role="button"]')) return;
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
      {/* Panel title */}
      <div className="border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <FolderSearch className="h-3.5 w-3.5 text-primary" />
          <h2 className="text-xs font-semibold">{t('panels.assetBrowser')}</h2>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t('assetBrowser.emptyHint')}</p>
      </div>

      {/* Fixed header: search + type filter + view toggle */}
      <div className="border-b border-border/60 px-3 py-2 space-y-2">
        {/* Row 1: search + semantic toggle + reindex + view toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            {semanticMode ? (
              <Sparkles className="absolute left-2 top-2 h-3.5 w-3.5 text-primary" />
            ) : (
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            )}
            <input
              value={searchQuery}
              onChange={(event) => {
                dispatch(setSearchQuery(event.target.value));
                if (semanticMode) void handleSemanticSearch(event.target.value);
              }}
              placeholder={semanticMode ? t('assetBrowser.semantic.toggle') + '...' : t('assetBrowser.searchPlaceholder')}
              className={cn(
                'w-full rounded-md border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring',
                semanticMode ? 'border-primary/60' : 'border-border/60',
              )}
            />
          </div>
          {/* Semantic search toggle */}
          <button
            type="button"
            onClick={() => { setSemanticMode((v) => !v); setSemanticResults([]); }}
            title={t('assetBrowser.semantic.toggle')}
            className={cn(
              'flex items-center justify-center rounded-md border px-2 py-1.5 transition-colors',
              semanticMode
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border/60 text-muted-foreground hover:bg-muted/80 hover:text-foreground',
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </button>
          {/* Re-index button */}
          <button
            type="button"
            onClick={() => { void handleReindex(); }}
            disabled={semanticIndexing}
            title={t('assetBrowser.semantic.reindex')}
            className="flex items-center justify-center rounded-md border border-border/60 px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', semanticIndexing && 'animate-spin')} />
          </button>
          {/* View toggle */}
          <div className="flex items-center rounded-md border border-border/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              title={t('assetBrowser.viewGrid')}
              className={cn(
                'flex items-center justify-center px-2 py-1.5 text-[11px] transition-colors',
                viewMode === 'grid'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              title={t('assetBrowser.viewList')}
              className={cn(
                'flex items-center justify-center px-2 py-1.5 text-[11px] transition-colors border-l border-border/60',
                viewMode === 'list'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
              )}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Row 2: type filter pills */}
        <div className="flex flex-wrap gap-1.5">
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

        {/* Row 3: import + select mode + sort */}
        <div className="flex flex-wrap gap-1.5">
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
            {selectMode ? t('assetBrowser.cancelSelect') : t('assetBrowser.export')}
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
            {sortBy === 'date'
              ? t('assetBrowser.sortBy.date')
              : sortBy === 'name'
                ? t('assetBrowser.sortBy.name')
                : t('assetBrowser.sortBy.size')}
          </button>
          <button
            type="button"
            onClick={() => setSortOrder((o) => o === 'asc' ? 'desc' : 'asc')}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* Main content area — relative so the sticky bar anchors to it */}
      <div
        className={cn(
          'relative flex-1 overflow-y-auto',
          isDragOver && 'ring-2 ring-inset ring-blue-400/50 bg-blue-500/5',
        )}
        onMouseDown={handleGridMouseDown}
        onContextMenu={handleContextMenu}
        onDragOver={handlePanelDragOver}
        onDragLeave={handlePanelDragLeave}
        onDrop={(e) => { void handlePanelDrop(e); }}
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className="rounded-lg border-2 border-dashed border-blue-400/70 bg-blue-500/10 px-6 py-3 text-xs font-medium text-blue-400">
              {t('assetBrowser.dropToImport')}
            </div>
          </div>
        )}
        <div className="p-3">
          {loading ? (
            <div className="text-xs text-muted-foreground">{t('assetBrowser.loading')}</div>
          ) : semanticIndexing ? (
            <div className="text-xs text-muted-foreground">{t('assetBrowser.semantic.indexing')}</div>
          ) : gridAssets.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-xs text-muted-foreground">
              <FolderSearch className="mb-2 h-8 w-8 opacity-20" />
              <div>{semanticMode && searchQuery ? t('assetBrowser.semantic.noResults') : t('assetBrowser.empty')}</div>
              <div className="mt-0.5 text-[11px]">{t('assetBrowser.emptyHint')}</div>
            </div>
          ) : viewMode === 'grid' ? (
            /* --- Grid View --- */
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
                const typeBadgeColor = TYPE_BADGE_COLORS[asset.type] ?? 'bg-muted text-muted-foreground';

                return (
                  <div
                    key={asset.id}
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
                        event.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={(e) => handleAssetClick(asset, e)}
                      onKeyDown={(event) => handleAssetCardKeyDown(asset, event)}
                      onContextMenu={(e) => {
                        // Right-click: select if not already selected, then show context menu
                        if (!selectedHashes.has(asset.hash)) {
                          if (!e.ctrlKey && !e.metaKey) setSelectedHashes(new Set([asset.hash]));
                          else setSelectedHashes((prev) => new Set([...prev, asset.hash]));
                        }
                      }}
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
                        {'_semanticScore' in asset && (
                          <span className="rounded bg-primary/10 px-1 py-px text-[9px] font-semibold text-primary">
                            {Math.round((asset as Asset & { _semanticScore: number })._semanticScore * 100)}%
                          </span>
                        )}
                      </div>
                    </div>

                    {exportConfig && (
                      <button
                        type="button"
                        className="absolute right-2 top-2 rounded bg-background/80 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        onClick={() => {
                          void handleQuickExport(asset, exportConfig);
                        }}
                        title={t('assetBrowser.export')}
                      >
                        <Download className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* --- List View --- */
            <div ref={gridRef} className="flex flex-col">
              {/* List header */}
              <div className="mb-1 grid grid-cols-[32px_1fr_56px_80px_56px] gap-2 px-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                <span />
                <span>{t('assetBrowser.fields.name')}</span>
                <span>{t('assetBrowser.fields.type')}</span>
                <span>{t('assetBrowser.sortBy.date')}</span>
                <span>{t('assetBrowser.fields.size')}</span>
              </div>
              {gridAssets.map((asset) => {
                const Icon = TYPE_ICONS[asset.type] ?? FileType;
                const thumbnail = asset.type === 'image' && asset.hash
                  ? `lucid-asset://${asset.hash}/image/png`
                  : undefined;
                const isSelected = selectedHashes.has(asset.hash);
                const typeBadgeColor = TYPE_BADGE_COLORS[asset.type] ?? 'bg-muted text-muted-foreground';

                return (
                  <button
                    key={asset.id}
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
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={(e) => handleAssetClick(asset, e)}
                    onContextMenu={(e) => {
                      if (!selectedHashes.has(asset.hash)) {
                        if (!e.ctrlKey && !e.metaKey) setSelectedHashes(new Set([asset.hash]));
                        else setSelectedHashes((prev) => new Set([...prev, asset.hash]));
                      }
                    }}
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
              })}
            </div>
          )}
        </div>

        {/* Sticky bottom floating selection bar */}
        {selectedHashes.size > 0 && (
          <div className="sticky bottom-0 left-0 right-0 z-10 border-t border-border/60 bg-card/90 backdrop-blur-sm px-3 py-2 select-none">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[11px] text-muted-foreground">
                {t('assetBrowser.selectedCount').replace('{count}', String(selectedHashes.size))}
              </span>
              <button
                type="button"
                onClick={() => void handleExportSelected()}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground"
              >
                <Download className="h-3 w-3" />
                {t('assetBrowser.exportSelected')}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteSelected()}
                className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/20"
              >
                <Trash2 className="h-3 w-3" />
                {t('action.delete')}
              </button>
            </div>
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
          {selectedHashes.size === 1 && (
            <button
              type="button"
              onClick={() => void handleCopyHash()}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
            >
              <Copy className="h-3.5 w-3.5" />
              {t('assetBrowser.copyHash')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleExportSelected()}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" />
            {t('assetBrowser.exportSelected')} ({selectedHashes.size})
          </button>
          <button
            type="button"
            onClick={() => { setBatchRenaming(true); setBatchPrefix(''); setContextMenu(null); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('assetBrowser.batchRename')} ({selectedHashes.size})
          </button>
          <button
            type="button"
            onClick={() => handleDeleteSelected()}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-muted"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('action.delete')} ({selectedHashes.size})
          </button>
        </div>
      )}

      {/* Batch Rename Dialog */}
      {batchRenaming && (
        <div className="border-t border-border/60 px-3 py-2 space-y-1.5 bg-card">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium">
              {t('assetBrowser.batchRenameItems').replace('{count}', String(selectedHashes.size))}
            </span>
            <button type="button" onClick={() => setBatchRenaming(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="text-[10px] text-muted-foreground">{t('assetBrowser.batchRenamePattern')}</div>
          <div className="flex items-center gap-1">
            <input
              value={batchPrefix}
              onChange={(e) => setBatchPrefix(e.target.value)}
              placeholder={t('assetBrowser.batchRenamePrefixPlaceholder')}
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
                  title={t('action.save')}
                >
                  <Save className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingName(detailAsset.name); setIsEditingName(false); }}
                  className="rounded px-1.5 py-1 text-destructive hover:bg-destructive/10"
                  title={t('action.cancel')}
                >
                  <X className="h-3 w-3" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingName(true)}
                className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                title={t('contextMenu.rename')}
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="space-y-1 text-[10px] text-muted-foreground">
            <div className="flex justify-between"><span>{t('assetBrowser.fields.type')}</span><span>{localizeAssetType(detailAsset.type)}</span></div>
            <div className="flex justify-between"><span>{t('assetBrowser.fields.size')}</span><span>{formatSize(detailAsset.size)}</span></div>
            {detailAsset.format && (
              <div className="flex justify-between"><span>{t('assetBrowser.fields.format')}</span><span className="uppercase">{detailAsset.format}</span></div>
            )}
            {detailAsset.width != null && detailAsset.height != null && (
              <div className="flex justify-between"><span>{t('assetBrowser.fields.dimensions')}</span><span>{detailAsset.width}&times;{detailAsset.height}</span></div>
            )}
            {detailAsset.duration != null && (detailAsset.type === 'video' || detailAsset.type === 'audio') && (
              <div className="flex justify-between"><span>{t('assetBrowser.fields.duration')}</span><span>{formatDuration(detailAsset.duration)}</span></div>
            )}
            <div className="flex justify-between"><span>{t('assetBrowser.fields.hash')}</span><span className="font-mono truncate max-w-[120px]" title={detailAsset.hash}>{detailAsset.hash.slice(0, 16)}...</span></div>
            <div className="flex justify-between"><span>{t('assetBrowser.created')}</span><span>{new Date(detailAsset.createdAt).toLocaleString(getLocale())}</span></div>
            {detailAsset.provider && (
              <div className="flex justify-between"><span>{t('assetBrowser.fields.provider')}</span><span>{detailAsset.provider}</span></div>
            )}
            {detailAsset.prompt && (
              <div className="flex flex-col gap-0.5">
                <span>{t('assetBrowser.fields.prompt')}</span>
                <span className="text-[10px] text-foreground/80 break-words leading-snug">{detailAsset.prompt}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('assetBrowser.deleteSelectedConfirm').replace(
                '{count}',
                String(pendingDeleteHashes.size),
              )}
            </DialogTitle>
            <DialogDescription>{t('assetBrowser.deleteConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(false)}
              className="rounded-md border border-border/60 px-3 py-1.5 text-xs text-foreground hover:bg-muted"
            >
              {t('action.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void executeDelete()}
              className="rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground hover:bg-destructive/90"
            >
              {t('action.delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
