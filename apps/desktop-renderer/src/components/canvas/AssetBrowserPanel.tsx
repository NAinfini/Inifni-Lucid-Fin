import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FolderSearch, Save, Trash2, X } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import {
  selectFilteredAssets,
  setFilterType,
  setSearchQuery,
  updateAsset,
  setFolders,
  addFolder,
  updateFolder,
  removeFolder,
  setCurrentFolder,
  setFoldersLoading,
  moveItemToFolder,
  type Asset,
} from '../../store/slices/assets.js';
import { t } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { useDebouncedDispatch } from '../../hooks/useDebouncedDispatch.js';
import { useAssetOperations } from '../../hooks/useAssetOperations.js';
import { useEntityFolders } from '../../hooks/useEntityFolders.js';
import { getAPI } from '../../utils/api.js';
import { FolderTree } from './folders/FolderTree.js';
import { FolderBreadcrumb } from './folders/FolderBreadcrumb.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog.js';
import { AssetToolbar } from './asset-browser/AssetToolbar.js';
import { AssetGrid } from './asset-browser/AssetGrid.js';
import { AssetDetailPanel } from './asset-browser/AssetDetailPanel.js';
import { AssetContextMenu } from './asset-browser/AssetContextMenu.js';

export function AssetBrowserPanel() {
  const dispatch = useDispatch();
  const { filterType, searchQuery } = useSelector((state: RootState) => state.assets);
  const [localSearch, setLocalSearch] = useDebouncedDispatch(
    searchQuery,
    useCallback((v: string) => dispatch(setSearchQuery(v)), [dispatch]),
    200,
  );
  const allAssets = useSelector((state: RootState) => state.assets.items);
  const filteredAssets = useSelector(selectFilteredAssets);

  // --- Asset operations hook ---
  const ops = useAssetOperations();
  const { loadAssets } = ops;

  // --- UI state ---
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteHashes, setPendingDeleteHashes] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isDragOver, setIsDragOver] = useState(false);
  const [semanticMode, setSemanticMode] = useState(false);
  const [foldersOpen, setFoldersOpen] = useState(true);

  const folderApi = useEntityFolders({
    kind: 'asset',
    selectFolders: (s) => s.assets.folders,
    selectCurrentFolderId: (s) => s.assets.currentFolderId,
    selectFoldersLoading: (s) => s.assets.foldersLoading,
    actions: {
      setFolders,
      addFolder,
      updateFolder,
      removeFolder,
      setCurrentFolder,
      setFoldersLoading,
    },
  });

  const handleMoveAssetToFolder = useCallback(
    async (hash: string, folderId: string | null) => {
      const api = getAPI();
      if (!api?.asset) return;
      try {
        await api.asset.setFolder(hash, folderId);
        dispatch(moveItemToFolder({ hash, folderId }));
      } catch {
        /* swallow — user can retry; keep browsing experience uninterrupted */
      }
    },
    [dispatch],
  );

  // --- Refs ---
  const [dragSelect, setDragSelect] = useState<{ startX: number; startY: number } | null>(null);
  const dragSelectRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const rubberBandRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // --- Load assets on mount / filter change ---
  useEffect(() => { void loadAssets(); }, [loadAssets]);

  // --- Sorted / filtered grid assets ---
  const gridAssets = useMemo(() => {
    if (semanticMode) {
      // Folder filter is intentionally skipped in semantic mode — the search
      // intent is global, and filtering would surprise users expecting a
      // full-corpus ranking.
      return ops.semanticResults
        .map((r) => {
          const asset = allAssets.find((a) => a.hash === r.hash);
          return asset ? { ...asset, _semanticScore: r.score } : null;
        })
        .filter((a): a is Asset & { _semanticScore: number } => a !== null);
    }
    const byFolder =
      folderApi.currentFolderId === null
        ? filteredAssets
        : filteredAssets.filter((a) => a.folderId === folderApi.currentFolderId);
    const sorted = [...byFolder].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') cmp = a.createdAt - b.createdAt;
      else if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'size') cmp = a.size - b.size;
      return sortOrder === 'desc' ? -cmp : cmp;
    });
    return sorted.slice(0, 200);
  }, [semanticMode, ops.semanticResults, allAssets, filteredAssets, sortBy, sortOrder, folderApi.currentFolderId]);

  // --- Drag over / drop ---
  const handlePanelDragOver = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (types.includes('Files') || types.includes('application/x-lucid-node-asset')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handlePanelDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setIsDragOver(false);
  }, []);

  const handlePanelDrop = useCallback(async (e: React.DragEvent) => {
    setIsDragOver(false);
    await ops.handleDropImport(e);
  }, [ops]);

  // --- Multi-select click handler ---
  const handleAssetClick = useCallback((asset: Asset, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedHash) {
      const startIdx = gridAssets.findIndex((a) => a.hash === lastClickedHash);
      const endIdx = gridAssets.findIndex((a) => a.hash === asset.hash);
      if (startIdx !== -1 && endIdx !== -1) {
        const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const rangeHashes = gridAssets.slice(lo, hi + 1).map((a) => a.hash);
        setSelectedHashes((prev) => { const next = new Set(prev); for (const h of rangeHashes) next.add(h); return next; });
      }
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedHashes((prev) => { const next = new Set(prev); if (next.has(asset.hash)) next.delete(asset.hash); else next.add(asset.hash); return next; });
    } else if (selectMode) {
      setSelectedHashes((prev) => { const next = new Set(prev); if (next.has(asset.hash)) next.delete(asset.hash); else next.add(asset.hash); return next; });
    } else {
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

  const handleContextMenuSelect = useCallback((asset: Asset, e: React.MouseEvent) => {
    if (!selectedHashes.has(asset.hash)) {
      if (!e.ctrlKey && !e.metaKey) setSelectedHashes(new Set([asset.hash]));
      else setSelectedHashes((prev) => new Set([...prev, asset.hash]));
    }
  }, [selectedHashes]);

  // --- Delete ---
  const handleDeleteSelected = useCallback(() => {
    if (selectedHashes.size === 0) return;
    setPendingDeleteHashes(new Set(selectedHashes));
    setDeleteConfirmOpen(true);
  }, [selectedHashes]);

  const confirmDelete = useCallback(async () => {
    setDeleteConfirmOpen(false);
    const deletedHashes = await ops.executeDelete(pendingDeleteHashes);
    setSelectedHashes((prev) => { const next = new Set(prev); for (const h of deletedHashes) next.delete(h); return next; });
    setDetailAsset((prev) => (prev && deletedHashes.has(prev.hash) ? null : prev));
    setContextMenu(null);
  }, [pendingDeleteHashes, ops]);

  // --- Export ---
  const handleExportSelected = useCallback(async () => {
    const items = gridAssets
      .filter((a) => selectedHashes.has(a.hash))
      .map((a) => ({ hash: a.hash, type: a.type as 'image' | 'video' | 'audio', name: a.name }));
    await ops.handleExportSelected(items);
    setContextMenu(null);
  }, [gridAssets, selectedHashes, ops]);

  const handleCopyHash = useCallback(async () => {
    if (selectedHashes.size === 1) {
      const hash = [...selectedHashes][0];
      if (hash) await ops.handleCopyHash(hash);
    }
    setContextMenu(null);
  }, [selectedHashes, ops]);

  // --- Batch rename ---
  const handleBatchRename = useCallback(() => {
    if (!batchPrefix.trim()) return;
    let idx = 1;
    for (const hash of selectedHashes) {
      const asset = gridAssets.find((a) => a.hash === hash);
      if (asset) {
        dispatch(updateAsset({ id: asset.id, data: { name: `${batchPrefix.trim()}_${String(idx).padStart(3, '0')}` } }));
        idx++;
      }
    }
    setBatchRenaming(false);
    setBatchPrefix('');
    setContextMenu(null);
  }, [batchPrefix, selectedHashes, gridAssets, dispatch]);

  // --- Detail panel name editing ---
  const handleSaveName = useCallback(() => {
    if (!detailAsset) return;
    dispatch(updateAsset({ id: detailAsset.id, data: { name: editingName } }));
    setDetailAsset({ ...detailAsset, name: editingName });
    setIsEditingName(false);
  }, [detailAsset, editingName, dispatch]);

  // --- Context menu ---
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (selectedHashes.size === 0) return;
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [selectedHashes]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // --- Keyboard ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedHashes.size > 0 && !isEditingName && !batchRenaming) { e.preventDefault(); handleDeleteSelected(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && panelRef.current?.contains(document.activeElement)) { e.preventDefault(); setSelectedHashes(new Set(gridAssets.map((a) => a.hash))); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedHashes, gridAssets, handleDeleteSelected, isEditingName, batchRenaming]);

  // --- Rubber band drag select ---
  const handleGridMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-asset-card], button, a, input, [role="button"]')) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (!gridRef.current?.getBoundingClientRect()) return;
    setDragSelect({ startX: e.clientX, startY: e.clientY });
    dragSelectRef.current = { startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY };
    if (!selectMode) setSelectedHashes(new Set());
  }, [selectMode]);

  useEffect(() => {
    if (!dragSelect) return;
    const onMove = (e: MouseEvent) => {
      const ds = dragSelectRef.current;
      if (!ds) return;
      ds.currentX = e.clientX;
      ds.currentY = e.clientY;
      const el = rubberBandRef.current;
      if (el) {
        const left = Math.min(ds.startX, ds.currentX);
        const top = Math.min(ds.startY, ds.currentY);
        const width = Math.abs(ds.currentX - ds.startX);
        const height = Math.abs(ds.currentY - ds.startY);
        if (width > 3 && height > 3) { el.style.display = 'block'; el.style.left = `${left}px`; el.style.top = `${top}px`; el.style.width = `${width}px`; el.style.height = `${height}px`; }
        else { el.style.display = 'none'; }
      }
    };
    const onUp = () => {
      const ds = dragSelectRef.current;
      if (gridRef.current && ds) {
        const rect = { left: Math.min(ds.startX, ds.currentX), right: Math.max(ds.startX, ds.currentX), top: Math.min(ds.startY, ds.currentY), bottom: Math.max(ds.startY, ds.currentY) };
        const cards = gridRef.current.querySelectorAll<HTMLElement>('[data-asset-hash]');
        const hits = new Set<string>();
        cards.forEach((card) => { const cr = card.getBoundingClientRect(); if (cr.right >= rect.left && cr.left <= rect.right && cr.bottom >= rect.top && cr.top <= rect.bottom) { const hash = card.getAttribute('data-asset-hash'); if (hash) hits.add(hash); } });
        if (hits.size > 0) setSelectedHashes((prev) => new Set([...prev, ...hits]));
      }
      dragSelectRef.current = null;
      if (rubberBandRef.current) rubberBandRef.current.style.display = 'none';
      setDragSelect(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragSelect]);

  // --- Toolbar callbacks ---
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSearch(e.target.value);
    if (semanticMode) ops.scheduleSemanticSearch(e.target.value);
  }, [semanticMode, ops, setLocalSearch]);

  return (
    <div ref={panelRef} className="flex h-full flex-col bg-card" tabIndex={-1}>
      {/* Panel title */}
      <div className="border-b border-border/60 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FolderSearch className="h-3.5 w-3.5 text-primary" />
            <h2 className="text-xs font-semibold">{t('panels.assetBrowser')}</h2>
          </div>
          <button
            type="button"
            onClick={() => setFoldersOpen((v) => !v)}
            className="text-[10px] text-muted-foreground hover:text-foreground"
            title={t('folders.toggle') as string}
          >
            {foldersOpen ? '▾' : '▸'} {t('folders.label') as string}
          </button>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t('assetBrowser.emptyHint')}</p>
        {!semanticMode && (
          <div className="mt-1">
            <FolderBreadcrumb
              breadcrumb={folderApi.breadcrumb}
              onNavigate={folderApi.setCurrentFolder}
              rootLabel={t('folders.all') as string}
            />
          </div>
        )}
      </div>

      {foldersOpen && !semanticMode && (
        <div className="border-b border-border/60 max-h-40 overflow-auto p-1.5">
          <FolderTree
            folders={folderApi.folders}
            currentFolderId={folderApi.currentFolderId}
            onSelect={folderApi.setCurrentFolder}
            onCreate={folderApi.createFolder}
            onRename={folderApi.renameFolder}
            onDelete={folderApi.deleteFolder}
            onDropItem={(folderId, payload) => void handleMoveAssetToFolder(payload, folderId)}
            dropItemKey="application/lucid-entity-id"
            labels={{
              rootLabel: t('folders.all') as string,
              newFolderPlaceholder: t('folders.newPlaceholder') as string,
              createFolder: t('folders.createFolder') as string,
              rename: t('action.rename') as string,
              delete: t('action.delete') as string,
            }}
          />
        </div>
      )}

      <AssetToolbar
        filterType={filterType}
        onFilterChange={(f) => dispatch(setFilterType(f))}
        localSearch={localSearch}
        onSearchChange={handleSearchChange}
        sortBy={sortBy}
        onSortCycle={() => { if (sortBy === 'date') setSortBy('name'); else if (sortBy === 'name') setSortBy('size'); else setSortBy('date'); }}
        sortOrder={sortOrder}
        onSortOrderToggle={() => setSortOrder((o) => o === 'asc' ? 'desc' : 'asc')}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onImport={() => void ops.handleImport()}
        selectMode={selectMode}
        onSelectModeToggle={() => { setSelectMode((v) => !v); setSelectedHashes(new Set()); }}
        semanticMode={semanticMode}
        onSemanticToggle={() => { setSemanticMode((v) => !v); ops.setSemanticResults([]); }}
        onReindex={() => void ops.handleReindex()}
        semanticIndexing={ops.semanticIndexing}
      />

      {/* Main content area */}
      <div
        className={cn('relative flex-1 overflow-y-auto', isDragOver && 'ring-2 ring-inset ring-blue-400/50 bg-blue-500/5')}
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

        <AssetGrid
          assets={gridAssets}
          selectedHashes={selectedHashes}
          viewMode={viewMode}
          gridRef={gridRef}
          onAssetClick={handleAssetClick}
          onAssetKeyDown={handleAssetCardKeyDown}
          onContextMenuSelect={handleContextMenuSelect}
          onQuickExport={(asset, config) => void ops.handleQuickExport(asset, config)}
          loading={ops.loading}
          semanticIndexing={ops.semanticIndexing}
          semanticMode={semanticMode}
          searchQuery={searchQuery}
        />

        {/* Sticky selection bar */}
        {selectedHashes.size > 0 && (
          <div className="sticky bottom-0 left-0 right-0 z-10 border-t border-border/60 bg-card/90 backdrop-blur-sm px-3 py-2 select-none">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[11px] text-muted-foreground">
                {t('assetBrowser.selectedCount').replace('{count}', String(selectedHashes.size))}
              </span>
              <button type="button" onClick={() => void handleExportSelected()} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground">
                <Download className="h-3 w-3" />{t('assetBrowser.exportSelected')}
              </button>
              <button type="button" onClick={() => handleDeleteSelected()} className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/20">
                <Trash2 className="h-3 w-3" />{t('action.delete')}
              </button>
            </div>
          </div>
        )}

        <div ref={rubberBandRef} className="pointer-events-none fixed z-50 border border-primary/60 bg-primary/10" style={{ display: 'none' }} />
      </div>

      {/* Context Menu */}
      {contextMenu && selectedHashes.size > 0 && (
        <AssetContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedCount={selectedHashes.size}
          onCopyHash={() => void handleCopyHash()}
          onExport={() => void handleExportSelected()}
          onBatchRename={() => { setBatchRenaming(true); setBatchPrefix(''); setContextMenu(null); }}
          onDelete={() => handleDeleteSelected()}
        />
      )}

      {/* Batch Rename Bar */}
      {batchRenaming && (
        <div className="border-t border-border/60 px-3 py-2 space-y-1.5 bg-card">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium">{t('assetBrowser.batchRenameItems').replace('{count}', String(selectedHashes.size))}</span>
            <button type="button" onClick={() => setBatchRenaming(false)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
          <div className="text-[10px] text-muted-foreground">{t('assetBrowser.batchRenamePattern')}</div>
          <div className="flex items-center gap-1">
            <input value={batchPrefix} onChange={(e) => setBatchPrefix(e.target.value)} placeholder={t('assetBrowser.batchRenamePrefixPlaceholder')} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') handleBatchRename(); if (e.key === 'Escape') setBatchRenaming(false); }} className="flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary" />
            <button type="button" onClick={handleBatchRename} disabled={!batchPrefix.trim()} className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground disabled:opacity-50"><Save className="h-3 w-3" /></button>
          </div>
        </div>
      )}

      {/* Asset Detail Panel */}
      {detailAsset && !batchRenaming && (
        <AssetDetailPanel
          asset={detailAsset}
          editingName={editingName}
          isEditingName={isEditingName}
          onEditingNameChange={setEditingName}
          onStartEditing={() => setIsEditingName(true)}
          onSaveName={handleSaveName}
          onCancelEditing={() => { if (detailAsset) setEditingName(detailAsset.name); setIsEditingName(false); }}
          onClose={() => { setDetailAsset(null); setIsEditingName(false); }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('assetBrowser.deleteSelectedConfirm').replace('{count}', String(pendingDeleteHashes.size))}</DialogTitle>
            <DialogDescription>{t('assetBrowser.deleteConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setDeleteConfirmOpen(false)} className="rounded-md border border-border/60 px-3 py-1.5 text-xs text-foreground hover:bg-muted">{t('action.cancel')}</button>
            <button type="button" onClick={() => void confirmDelete()} className="rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground hover:bg-destructive/90">{t('action.delete')}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
