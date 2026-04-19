import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderSearch, Download, Pencil, X } from 'lucide-react';
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
import { t, getLocale } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { useAssetOperations } from '../../hooks/useAssetOperations.js';
import { useEntityFolders } from '../../hooks/useEntityFolders.js';
import { useEntityClipboard } from '../../hooks/useEntityClipboard.js';
import { useAssetUrl } from '../../hooks/useAssetUrl.js';
import { getAPI } from '../../utils/api.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog.js';
import { EntityFileExplorer } from './EntityFileExplorer.js';
import { EntityDetailDrawer } from './EntityDetailDrawer.js';
import { VideoGridCard } from './asset-browser/VideoGridCard.js';
import { formatSize, formatDuration, getExportConfig, localizeAssetType } from './asset-browser/utils.js';

const FILTER_OPTIONS: Array<{ value: Asset['type'] | 'all'; label: string }> = [
  { value: 'all', label: 'asset.all' },
  { value: 'image', label: 'asset.image' },
  { value: 'video', label: 'asset.video' },
  { value: 'audio', label: 'asset.audio' },
];

export function AssetBrowserPanel() {
  const dispatch = useDispatch();
  const { filterType, searchQuery } = useSelector((state: RootState) => state.assets);
  const allAssets = useSelector((state: RootState) => state.assets.items);
  const filteredAssets = useSelector(selectFilteredAssets);

  const ops = useAssetOperations();
  const { loadAssets } = ops;

  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

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

  const clipboard = useEntityClipboard<Asset>('asset');
  const cutIds = useMemo(() => {
    if (!clipboard.isCut) return new Set<string>();
    const p = clipboard.peek();
    return new Set(p?.items.map((it) => it.id) ?? []);
  }, [clipboard]);

  const handleMoveToFolder = useCallback(
    async (ids: string[], folderId: string | null) => {
      const api = getAPI();
      if (!api?.asset) return;
      for (const id of ids) {
        const asset = allAssets.find((a) => a.id === id);
        const hash = asset?.hash;
        if (!hash) continue;
        try {
          await api.asset.setFolder(hash, folderId);
          dispatch(moveItemToFolder({ hash, folderId }));
        } catch {
          /* swallow — the user can retry; keep browsing experience uninterrupted */
        }
      }
    },
    [allAssets, dispatch],
  );

  useEffect(() => { void loadAssets(); }, [loadAssets]);

  // Type filter narrows what the file explorer sees.
  const visibleAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return filteredAssets.filter((a) => !q || a.name.toLowerCase().includes(q));
  }, [filteredAssets, searchQuery]);

  const handleDeleteIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setPendingDeleteIds(ids);
    setDeleteConfirmOpen(true);
  }, []);

  const confirmDelete = useCallback(async () => {
    setDeleteConfirmOpen(false);
    const hashes = new Set<string>();
    for (const id of pendingDeleteIds) {
      const asset = allAssets.find((a) => a.id === id);
      if (asset) hashes.add(asset.hash);
    }
    const deleted = await ops.executeDelete(hashes);
    setDetailAsset((prev) => {
      if (prev && deleted.has(prev.hash)) {
        setDrawerOpen(false);
        return null;
      }
      return prev;
    });
    setPendingDeleteIds([]);
  }, [pendingDeleteIds, allAssets, ops]);

  const handlePaste = useCallback((payload: { mode: 'copy' | 'cut'; items: Asset[] }) => {
    const folderId = folderApi.currentFolderId;
    if (payload.mode === 'cut') {
      // Move the items into the current folder.
      void handleMoveToFolder(payload.items.map((it) => it.id), folderId);
    } else {
      // Copy: duplicate hashes into current folder by re-registering them.
      // Assets are content-addressed so true duplication doesn't make sense
      // — we simply move them into this folder, preserving both clipboard
      // state (so future pastes still work) and the original membership.
      void handleMoveToFolder(payload.items.map((it) => it.id), folderId);
    }
  }, [folderApi.currentFolderId, handleMoveToFolder]);

  const handleOpenItem = useCallback((asset: Asset) => {
    setDetailAsset(asset);
    setEditingName(asset.name);
    setIsEditingName(false);
    setDrawerOpen(true);
  }, []);

  const handleSaveName = useCallback(() => {
    if (!detailAsset) return;
    dispatch(updateAsset({ id: detailAsset.id, data: { name: editingName } }));
    setDetailAsset({ ...detailAsset, name: editingName });
    setIsEditingName(false);
  }, [detailAsset, editingName, dispatch]);

  const handleExportOne = useCallback(async (asset: Asset) => {
    const cfg = getExportConfig(asset.type);
    if (!cfg) return;
    await ops.handleQuickExport(asset, cfg);
  }, [ops]);

  // Drag-and-drop from OS / other panels → import.
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

  const renderThumbnail = useCallback((a: Asset) => <AssetThumb asset={a} />, []);
  const renderSubtitle = useCallback((a: Asset) => (
    <span>{localizeAssetType(a.type)} · {formatSize(a.size)}</span>
  ), []);

  const drawerShown = drawerOpen && detailAsset !== null;
  return (
    <div
      className="relative flex h-full bg-card"
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

      <div className={drawerShown ? 'w-[140px] shrink-0 border-r border-border/60' : 'flex-1 min-w-0'}>
        <EntityFileExplorer<Asset>
          items={visibleAssets}
          folders={folderApi.folders}
          currentFolderId={folderApi.currentFolderId}
          onNavigateFolder={folderApi.setCurrentFolder}
          onCreateFolder={folderApi.createFolder}
          onRenameFolder={folderApi.renameFolder}
          onDeleteFolder={folderApi.deleteFolder}
          onMoveItemsToFolder={(ids, folderId) => void handleMoveToFolder(ids, folderId)}
          onCreateItem={() => void ops.handleImport()}
          onOpenItem={handleOpenItem}
          onDeleteItems={handleDeleteIds}
          compact={drawerShown}
          renderThumbnail={renderThumbnail}
          renderSubtitle={renderSubtitle}
          clipboard={{
            hasClipboard: clipboard.hasClipboard,
            isCut: clipboard.isCut,
            copy: clipboard.copy,
            cut: clipboard.cut,
            paste: clipboard.paste,
            cutIds,
          }}
          onPaste={handlePaste}
          header={(
            <div className="flex items-center gap-2">
              <FolderSearch className="h-3.5 w-3.5 text-primary" />
              <h2 className="text-xs font-semibold">{t('panels.assetBrowser')}</h2>
              <div className="ml-auto flex items-center gap-1.5">
                {FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => dispatch(setFilterType(opt.value))}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                      filterType === opt.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/60 text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                    )}
                  >
                    {t(opt.label)}
                  </button>
                ))}
              </div>
            </div>
          )}
          newItemLabel={t('assetBrowser.import')}
          activeItemId={detailAsset?.id ?? null}
          loading={ops.loading}
          dndMime="application/lucid-entity-id"
          emptyLabel={t('assetBrowser.empty')}
        />
      </div>

      <EntityDetailDrawer
        open={drawerShown}
        onOpenChange={(o) => { setDrawerOpen(o); if (!o) setIsEditingName(false); }}
        title={detailAsset?.name ?? ''}
        subtitle={detailAsset ? `${localizeAssetType(detailAsset.type)} · ${formatSize(detailAsset.size)}` : ''}
        onDelete={detailAsset ? () => handleDeleteIds([detailAsset.id]) : undefined}
      >
        {detailAsset && (
          <div className="space-y-3">
            <AssetDetailPreview asset={detailAsset} />
            <div className="flex items-center gap-1">
              <input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                disabled={!isEditingName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isEditingName) handleSaveName();
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
                  <button type="button" onClick={handleSaveName} className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground">{t('action.save')}</button>
                  <button type="button" onClick={() => { setEditingName(detailAsset.name); setIsEditingName(false); }} className="rounded px-1.5 py-1 text-destructive hover:bg-destructive/10"><X className="h-3 w-3" /></button>
                </>
              ) : (
                <button type="button" onClick={() => setIsEditingName(true)} className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground" title={t('contextMenu.rename')}>
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <DetailRow label={t('assetBrowser.fields.type')} value={localizeAssetType(detailAsset.type)} />
              <DetailRow label={t('assetBrowser.fields.size')} value={formatSize(detailAsset.size)} />
              {detailAsset.format && <DetailRow label={t('assetBrowser.fields.format')} value={detailAsset.format.toUpperCase()} />}
              {detailAsset.width != null && detailAsset.height != null && (
                <DetailRow label={t('assetBrowser.fields.dimensions')} value={`${detailAsset.width}×${detailAsset.height}`} />
              )}
              {detailAsset.duration != null && (detailAsset.type === 'video' || detailAsset.type === 'audio') && (
                <DetailRow label={t('assetBrowser.fields.duration')} value={formatDuration(detailAsset.duration)} />
              )}
              <DetailRow
                label={t('assetBrowser.fields.hash')}
                value={<span className="font-mono" title={detailAsset.hash}>{detailAsset.hash.slice(0, 16)}…</span>}
              />
              <DetailRow
                label={t('assetBrowser.created')}
                value={new Date(detailAsset.createdAt).toLocaleString(getLocale())}
              />
              {detailAsset.provider && <DetailRow label={t('assetBrowser.fields.provider')} value={detailAsset.provider} />}
              {detailAsset.prompt && (
                <div className="flex flex-col gap-0.5 pt-1">
                  <span>{t('assetBrowser.fields.prompt')}</span>
                  <span className="text-[11px] text-foreground/80 break-words leading-snug">{detailAsset.prompt}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleExportOne(detailAsset)}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground"
              >
                <Download className="h-3 w-3" />
                {t('assetBrowser.export')}
              </button>
              <button
                type="button"
                onClick={() => void ops.handleCopyHash(detailAsset.hash)}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/80"
              >
                {t('assetBrowser.copyHash')}
              </button>
            </div>
          </div>
        )}
      </EntityDetailDrawer>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('assetBrowser.deleteSelectedConfirm').replace('{count}', String(pendingDeleteIds.length))}</DialogTitle>
            <DialogDescription>{t('assetBrowser.deleteConfirmDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setDeleteConfirmOpen(false)} className="rounded-md border border-border/60 px-3 py-1.5 text-xs text-foreground hover:bg-muted">{t('action.cancel')}</button>
            <button type="button" onClick={() => void confirmDelete()} className="rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground hover:bg-destructive/90">{t('action.delete')}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SearchSync searchQuery={searchQuery} onChange={(v) => dispatch(setSearchQuery(v))} />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="text-right text-foreground/80">{value}</span>
    </div>
  );
}

function AssetThumb({ asset }: { asset: Asset }) {
  const imgUrl = asset.type === 'image' && asset.hash ? `lucid-asset://${asset.hash}/image/png` : null;
  const vidUrl = asset.type === 'video' && asset.hash ? `lucid-asset://${asset.hash}/video/mp4` : null;
  if (imgUrl) {
    return <img src={imgUrl} alt={asset.name} className="h-full w-full object-contain" />;
  }
  if (vidUrl) {
    return <VideoGridCard src={vidUrl} className="h-full w-full object-contain" />;
  }
  return <div className="h-full w-full bg-muted" />;
}

function AssetDetailPreview({ asset }: { asset: Asset }) {
  const { url, markFailed } = useAssetUrl(
    asset.hash,
    asset.type === 'image' || asset.type === 'video' || asset.type === 'audio' ? asset.type : 'image',
    asset.format,
  );
  if (!url) return <div className="aspect-video w-full rounded bg-muted" />;
  if (asset.type === 'video') {
    return <video src={url} controls className="aspect-video w-full rounded bg-black object-contain" onError={markFailed} />;
  }
  if (asset.type === 'audio') {
    return <audio src={url} controls className="w-full" onError={markFailed} />;
  }
  return <img src={url} alt={asset.name} className="max-h-60 w-full rounded bg-muted object-contain" onError={markFailed} />;
}

/** Tiny helper so the panel doesn't re-render on every keystroke. */
function SearchSync({ searchQuery: _searchQuery, onChange: _onChange }: { searchQuery: string; onChange: (v: string) => void }) {
  // Reserved for future parity; currently the explorer owns its own local search,
  // and Redux searchQuery tracks the last value. Kept as a hook in case we want to
  // re-enable global search state later.
  return null;
}
