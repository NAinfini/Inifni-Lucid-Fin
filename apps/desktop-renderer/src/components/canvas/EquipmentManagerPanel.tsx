import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { selectEntityUsageCounts } from '../../store/slices/canvas-selectors.js';
import { removeEntityRefsFromAllCanvases } from '../../store/slices/canvas.js';
import { enqueueToast } from '../../store/slices/toast.js';
import {
  setEquipment,
  addEquipment,
  updateEquipment,
  removeEquipment,
  selectEquipment,
  setLoading,
  setEquipmentRefImage,
  removeEquipmentRefImage,
  setFolders,
  addFolder,
  updateFolder,
  removeFolder,
  setCurrentFolder,
  setFoldersLoading,
  moveItemToFolder,
} from '../../store/slices/equipment.js';
import { getAPI } from '../../utils/api.js';
import { cn } from '../../lib/utils.js';
import type { Equipment, EquipmentType, ReferenceImage } from '@lucid-fin/contracts';
import { useAssetUrl } from '../../hooks/useAssetUrl.js';
import { Image, ImageOff, Link2, Package, Upload, X } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';
import { useEntityManager } from '../../hooks/useEntityManager.js';
import { useEntityFolders } from '../../hooks/useEntityFolders.js';
import { useEntityClipboard } from '../../hooks/useEntityClipboard.js';
import { EntityFileExplorer } from './EntityFileExplorer.js';
import { EntityDetailDrawer } from './EntityDetailDrawer.js';
import { selectImageAssets, type Asset } from '../../store/slices/assets.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog.js';

const TYPE_OPTIONS: EquipmentType[] = [
  'weapon',
  'armor',
  'clothing',
  'accessory',
  'vehicle',
  'tool',
  'furniture',
  'other',
];

interface EquipmentDraft {
  id: string;
  name: string;
  type: EquipmentType;
  subtype: string;
  description: string;
  functionDesc: string;
  tags: string;
}

function createDraft(equip: Equipment): EquipmentDraft {
  return {
    id: equip.id,
    name: equip.name,
    type: equip.type,
    subtype: equip.subtype ?? '',
    description: equip.description,
    functionDesc: equip.function ?? '',
    tags: equip.tags.join(', '),
  };
}

export function EquipmentManagerPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const { items, selectedId, loading } = useSelector((s: RootState) => s.equipment);

  const {
    draft,
    setDraft,
    setOriginalDraft,
    error,
    setError,
    assetPickerOpen,
    setAssetPickerOpen,
    isDirty,
    reportError,
    confirmDiscardIfDirty,
    confirm,
    ConfirmDialog,
  } = useEntityManager<EquipmentDraft>({
    entityType: 'equipment',
    unsavedChangesKey: 'equipmentManager.unsavedChanges',
  });

  const selectedEquip = useMemo(() => items.find((e) => e.id === selectedId), [items, selectedId]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const folderApi = useEntityFolders({
    kind: 'equipment',
    selectFolders: (s) => s.equipment.folders,
    selectCurrentFolderId: (s) => s.equipment.currentFolderId,
    selectFoldersLoading: (s) => s.equipment.foldersLoading,
    actions: {
      setFolders,
      addFolder,
      updateFolder,
      removeFolder,
      setCurrentFolder,
      setFoldersLoading,
    },
  });

  const clipboard = useEntityClipboard<Equipment>('equipment');
  const cutIds = useMemo(() => {
    if (!clipboard.isCut) return new Set<string>();
    const p = clipboard.peek();
    return new Set(p?.items.map((it) => it.id) ?? []);
  }, [clipboard]);

  const usageCountById = useSelector(selectEntityUsageCounts).equipment;

  useEffect(() => {
    if (!selectedEquip) {
      setDraft(null);
      setOriginalDraft(null);
      return;
    }
    const d = createDraft(selectedEquip);
    setDraft(d);
    setOriginalDraft(d);
  }, [selectedEquip, setDraft, setOriginalDraft]);

  const handleOpenItem = useCallback(
    async (equip: Equipment) => {
      if (selectedId !== equip.id) {
        if (!(await confirmDiscardIfDirty())) return;
        dispatch(selectEquipment(equip.id));
      }
      setDrawerOpen(true);
    },
    [confirmDiscardIfDirty, dispatch, selectedId],
  );

  const loadEquipment = useCallback(async () => {
    dispatch(setLoading(true));
    try {
      const api = getAPI();
      if (api?.equipment) {
        const list = (await api.equipment.list()) as Equipment[];
        dispatch(setEquipment(list));
      }
    } catch (reason) {
      reportError(reason, 'loadEquipment');
    } finally {
      dispatch(setLoading(false));
    }
  }, [dispatch, reportError]);

  useEffect(() => {
    void loadEquipment();
  }, [loadEquipment]);

  const createNewEquipment = useCallback(async () => {
    if (!(await confirmDiscardIfDirty())) return;
    setError(null);
    try {
      const api = getAPI();
      const data: Partial<Equipment> = {
        name: t('equipmentManager.newEquipment'),
        type: 'other',
        description: '',
        tags: [],
        referenceImages: [],
        folderId: folderApi.currentFolderId,
      };
      if (api?.equipment) {
        const saved = (await api.equipment.save(data as Record<string, unknown>)) as Equipment;
        dispatch(addEquipment(saved));
        dispatch(selectEquipment(saved.id));
        setDrawerOpen(true);
      }
    } catch (reason) {
      reportError(reason, 'createNewEquipment');
    }
  }, [dispatch, confirmDiscardIfDirty, reportError, setError, t, folderApi.currentFolderId]);

  const handleMoveIdsToFolder = useCallback(
    async (ids: string[], folderId: string | null) => {
      const api = getAPI();
      if (!api?.equipment) return;
      for (const id of ids) {
        try {
          await api.equipment.setFolder(id, folderId);
          dispatch(moveItemToFolder({ id, folderId }));
        } catch (reason) {
          reportError(reason, 'handleMoveIdsToFolder');
        }
      }
    },
    [dispatch, reportError],
  );

  const handlePaste = useCallback(
    (payload: { mode: 'copy' | 'cut'; items: Equipment[] }) => {
      const folderId = folderApi.currentFolderId;
      if (payload.mode === 'cut') {
        void handleMoveIdsToFolder(
          payload.items.map((it) => it.id),
          folderId,
        );
      } else {
        const api = getAPI();
        if (!api?.equipment) return;
        void (async () => {
          for (const original of payload.items) {
            try {
              const { id: _id, ...rest } = original;
              const saved = (await api.equipment.save({
                ...rest,
                name: `${original.name} ${t('action.copySuffix')}`,
                folderId,
              } as Record<string, unknown>)) as Equipment;
              dispatch(addEquipment(saved));
            } catch (reason) {
              reportError(reason, 'handlePasteCopy');
            }
          }
        })();
      }
    },
    [folderApi.currentFolderId, handleMoveIdsToFolder, dispatch, reportError, t],
  );

  const saveDraft = useCallback(async () => {
    if (!draft || !selectedEquip) return;
    setError(null);
    try {
      const data: Partial<Equipment> = {
        id: draft.id,
        name: draft.name.trim(),
        type: draft.type,
        subtype: draft.subtype || undefined,
        description: draft.description,
        function: draft.functionDesc || undefined,
        tags: draft.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const api = getAPI();
      if (api?.equipment) {
        const saved = (await api.equipment.save(data as Record<string, unknown>)) as Equipment;
        dispatch(updateEquipment({ id: saved.id, data: saved }));
        dispatch(enqueueToast({ variant: 'success', title: t('toast.entitySaved') }));
      }
    } catch (reason) {
      reportError(reason, 'saveDraft');
    }
  }, [dispatch, draft, reportError, selectedEquip, setError, t]);

  const handleDeleteIds = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const names = ids.map((id) => items.find((e) => e.id === id)?.name || id).join(', ');
      const ok = await confirm({
        title: t('equipmentManager.deleteConfirm').replace('{name}', names),
        destructive: true,
        confirmLabel: t('action.confirm'),
        cancelLabel: t('action.cancel'),
      });
      if (!ok) return;
      setError(null);
      const api = getAPI();
      for (const id of ids) {
        try {
          if (api?.equipment) await api.equipment.delete(id);
          dispatch(removeEquipment(id));
          dispatch(removeEntityRefsFromAllCanvases({ entityType: 'equipment', entityId: id }));
          if (selectedId === id) setDrawerOpen(false);
        } catch (reason) {
          reportError(reason, 'handleDeleteIds');
        }
      }
    },
    [confirm, dispatch, items, reportError, selectedId, setError, t],
  );

  const handleRefImageUpload = useCallback(
    async (slot: string, isStandard: boolean) => {
      if (!selectedEquip) return;
      setError(null);
      try {
        const api = getAPI();
        if (!api) return;
        const asset = (await api.asset.pickFile('image')) as { hash: string } | null;
        if (!asset) return;
        const refImage = (await api.equipment.setRefImage(
          selectedEquip.id,
          slot,
          asset.hash,
          isStandard,
        )) as ReferenceImage;
        dispatch(setEquipmentRefImage({ equipmentId: selectedEquip.id, refImage }));
      } catch (reason) {
        reportError(reason, 'handleRefImageUpload');
      }
    },
    [dispatch, reportError, selectedEquip, setError],
  );

  const handleRefImageRemove = useCallback(
    async (slot: string) => {
      if (!selectedEquip) return;
      setError(null);
      try {
        const api = getAPI();
        if (api?.equipment) {
          await api.equipment.removeRefImage(selectedEquip.id, slot);
        }
        dispatch(removeEquipmentRefImage({ equipmentId: selectedEquip.id, slot }));
      } catch (reason) {
        reportError(reason, 'handleRefImageRemove');
      }
    },
    [dispatch, reportError, selectedEquip, setError],
  );

  const handleSelectVariant = useCallback(
    async (variantHash: string) => {
      if (!selectedEquip) return;
      setError(null);
      try {
        const mainRef =
          selectedEquip.referenceImages.find((r) => r.slot === 'main') ??
          selectedEquip.referenceImages[0];
        if (!mainRef) return;

        // Only change the active image; keep variants list unchanged
        const updatedRef: ReferenceImage = {
          ...mainRef,
          assetHash: variantHash,
        };

        const updatedRefs = selectedEquip.referenceImages.map((r) =>
          r.slot === mainRef.slot ? updatedRef : r,
        );
        const api = getAPI();
        if (api?.equipment) {
          await api.equipment.save({ id: selectedEquip.id, referenceImages: updatedRefs } as Record<
            string,
            unknown
          >);
        }
        dispatch(setEquipmentRefImage({ equipmentId: selectedEquip.id, refImage: updatedRef }));
      } catch (reason) {
        reportError(reason, 'handleSelectVariant');
      }
    },
    [dispatch, reportError, selectedEquip, setError],
  );

  const handleDeleteVariant = useCallback(
    async (variantHash: string) => {
      if (!selectedEquip) return;
      setError(null);
      try {
        const mainRef =
          selectedEquip.referenceImages.find((r) => r.slot === 'main') ??
          selectedEquip.referenceImages[0];
        if (!mainRef || !mainRef.variants) return;

        const newVariants = mainRef.variants.filter((v) => v !== variantHash);
        const newAssetHash =
          mainRef.assetHash === variantHash ? (newVariants[0] ?? '') : mainRef.assetHash;

        const updatedRef: ReferenceImage = {
          ...mainRef,
          assetHash: newAssetHash,
          variants: newVariants,
        };

        const updatedRefs = selectedEquip.referenceImages.map((r) =>
          r.slot === mainRef.slot ? updatedRef : r,
        );
        const api = getAPI();
        if (api?.equipment) {
          await api.equipment.save({ id: selectedEquip.id, referenceImages: updatedRefs } as Record<
            string,
            unknown
          >);
        }
        dispatch(setEquipmentRefImage({ equipmentId: selectedEquip.id, refImage: updatedRef }));
      } catch (reason) {
        reportError(reason, 'handleDeleteVariant');
      }
    },
    [dispatch, reportError, selectedEquip, setError],
  );

  const handleRefImageFromAsset = useCallback(
    async (hash: string) => {
      if (!selectedEquip) return;
      setAssetPickerOpen(false);
      setError(null);
      try {
        const api = getAPI();
        if (!api?.equipment) return;
        const refImage = (await api.equipment.setRefImage(
          selectedEquip.id,
          'main',
          hash,
          true,
        )) as ReferenceImage;
        dispatch(setEquipmentRefImage({ equipmentId: selectedEquip.id, refImage }));
      } catch (reason) {
        reportError(reason, 'handleRefImageFromAsset');
      }
    },
    [dispatch, reportError, selectedEquip, setAssetPickerOpen, setError],
  );

  const drawerShown = drawerOpen && draft !== null;
  return (
    <div className="flex h-full min-h-0">
      <div
        className={drawerShown ? 'w-[140px] shrink-0 border-r border-border/60' : 'flex-1 min-w-0'}
      >
        <EntityFileExplorer<Equipment>
          items={items}
          folders={folderApi.folders}
          currentFolderId={folderApi.currentFolderId}
          onNavigateFolder={folderApi.setCurrentFolder}
          onCreateFolder={folderApi.createFolder}
          onRenameFolder={folderApi.renameFolder}
          onDeleteFolder={folderApi.deleteFolder}
          onMoveItemsToFolder={(ids, folderId) => void handleMoveIdsToFolder(ids, folderId)}
          onCreateItem={() => void createNewEquipment()}
          onOpenItem={(e) => void handleOpenItem(e)}
          onDeleteItems={(ids) => void handleDeleteIds(ids)}
          compact={drawerShown}
          renderThumbnail={(e) => (
            <ListThumb
              hash={
                e.referenceImages?.find((r) => r.slot === 'main')?.assetHash ??
                e.referenceImages?.[0]?.assetHash
              }
            />
          )}
          renderSubtitle={(e) => (
            <span className="inline-flex items-center gap-1">
              {t('equipmentManager.types.' + e.type)}
              {e.subtype && ` · ${e.subtype}`}
              {(usageCountById[e.id] ?? 0) > 0 && (
                <span
                  className="inline-flex items-center gap-0.5"
                  title={t('equipmentManager.usedInNodes').replace(
                    '{count}',
                    String(usageCountById[e.id]),
                  )}
                >
                  <Link2 className="h-3 w-3" />
                  {usageCountById[e.id]}
                </span>
              )}
            </span>
          )}
          clipboard={{
            hasClipboard: clipboard.hasClipboard,
            isCut: clipboard.isCut,
            copy: clipboard.copy,
            cut: clipboard.cut,
            paste: clipboard.paste,
            cutIds,
          }}
          onPaste={handlePaste}
          header={
            <div className="flex items-center gap-2">
              <Package className="h-3.5 w-3.5 text-primary" />
              <h2 className="text-xs font-semibold">{t('equipmentManager.title')}</h2>
            </div>
          }
          newItemLabel={t('equipmentManager.newEquipment')}
          activeItemId={drawerOpen ? (selectedId ?? null) : null}
          loading={loading}
          showSearchControls={false}
          emptyLabel={t('equipmentManager.noResults')}
        />
      </div>

      <EntityDetailDrawer
        open={drawerShown}
        onOpenChange={async (o) => {
          if (!o) {
            if (await confirmDiscardIfDirty()) setDrawerOpen(false);
            else return;
          } else {
            setDrawerOpen(true);
          }
        }}
        title={draft?.name ?? ''}
        subtitle={draft ? t('equipmentManager.types.' + draft.type) : undefined}
        onSave={() => void saveDraft()}
        isDirty={isDirty}
        onDelete={selectedId ? () => void handleDeleteIds([selectedId]) : undefined}
      >
        {draft && (
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                {t('equipmentManager.fields.name')}
              </label>
              <input
                value={draft.name}
                onChange={(e) => setDraft((p) => (p ? { ...p, name: e.target.value } : p))}
                className="w-full rounded bg-muted px-2 py-1 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('equipmentManager.fields.type')}
                </label>
                <select
                  value={draft.type}
                  onChange={(e) =>
                    setDraft((p) => (p ? { ...p, type: e.target.value as EquipmentType } : p))
                  }
                  className="w-full rounded bg-muted px-2 py-1 text-xs"
                >
                  {TYPE_OPTIONS.map((tp) => (
                    <option key={tp} value={tp}>
                      {t('equipmentManager.types.' + tp)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('equipmentManager.fields.subtype')}
                </label>
                <input
                  value={draft.subtype}
                  onChange={(e) => setDraft((p) => (p ? { ...p, subtype: e.target.value } : p))}
                  className="w-full rounded bg-muted px-2 py-1 text-xs"
                  placeholder={t('equipmentManager.optional')}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                {t('equipmentManager.fields.description')}
              </label>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft((p) => (p ? { ...p, description: e.target.value } : p))}
                className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[60px]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                {t('equipmentManager.fields.function')}
              </label>
              <textarea
                value={draft.functionDesc}
                onChange={(e) => setDraft((p) => (p ? { ...p, functionDesc: e.target.value } : p))}
                className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[50px]"
                placeholder={t('equipmentManager.functionPlaceholder')}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                {t('equipmentManager.fields.tags')}
              </label>
              <input
                value={draft.tags}
                onChange={(e) => setDraft((p) => (p ? { ...p, tags: e.target.value } : p))}
                className="w-full rounded bg-muted px-2 py-1 text-xs"
                placeholder={t('equipmentManager.fields.tags')}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                {t('equipmentManager.referenceImages')}
              </label>
              <SingleReferenceImage
                referenceImages={selectedEquip?.referenceImages ?? []}
                onUpload={() => handleRefImageUpload('main', true)}
                onRemove={(slot) => handleRefImageRemove(slot)}
                onFromAssets={() => setAssetPickerOpen(true)}
                onDropHash={(hash) => void handleRefImageFromAsset(hash)}
                onSelectVariant={(hash) => void handleSelectVariant(hash)}
                onDeleteVariant={(hash) => void handleDeleteVariant(hash)}
                entityType="equipment"
                entityId={selectedEquip?.id}
                slot="main"
              />
              <p className="text-[9px] text-muted-foreground/70 italic mt-1">
                {t('equipmentManager.generateAllHint')}
              </p>
            </div>

            <AssetPickerDialog
              open={assetPickerOpen}
              onClose={() => setAssetPickerOpen(false)}
              onSelect={(hash) => void handleRefImageFromAsset(hash)}
            />

            {error && <div className="text-[11px] text-destructive">{error}</div>}
          </div>
        )}
      </EntityDetailDrawer>
      {ConfirmDialog}
    </div>
  );
}

function SingleReferenceImage({
  referenceImages,
  onUpload,
  onRemove,
  onFromAssets,
  onDropHash,
  onSelectVariant,
  onDeleteVariant,
  entityType,
  entityId,
  slot,
}: {
  referenceImages: ReferenceImage[];
  onUpload: () => void;
  onRemove: (slot: string) => void;
  onFromAssets: () => void;
  onDropHash?: (hash: string) => void;
  onSelectVariant?: (hash: string) => void;
  onDeleteVariant?: (hash: string) => void;
  entityType?: string;
  entityId?: string;
  slot?: string;
}) {
  const { t } = useI18n();
  const [isDragOver, setIsDragOver] = useState(false);
  const mainRef = referenceImages.find((r) => r.slot === 'main') || referenceImages[0];
  const { url, markFailed } = useAssetUrl(mainRef?.assetHash, 'image', 'png');

  const handleDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (
      types.includes('Files') ||
      types.includes('application/x-lucid-asset') ||
      types.includes('application/x-lucid-ref-image')
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (!onDropHash) return;

    const assetRaw = e.dataTransfer.getData('application/x-lucid-asset');
    if (assetRaw) {
      try {
        const payload = JSON.parse(assetRaw) as { hash: string; type: string };
        if (payload.hash && payload.type === 'image') onDropHash(payload.hash);
      } catch {
        /* ignore */
      }
      return;
    }

    const refRaw = e.dataTransfer.getData('application/x-lucid-ref-image');
    if (refRaw) {
      try {
        const payload = JSON.parse(refRaw) as { assetHash: string };
        if (payload.assetHash) onDropHash(payload.assetHash);
      } catch {
        /* ignore */
      }
      return;
    }

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file && file.type.startsWith('image/')) {
        const filePath = (file as { path?: string }).path ?? '';
        if (filePath) {
          const api = getAPI();
          void api?.asset
            .import(filePath, 'image')
            .then((ref) => {
              const r = ref as { hash: string } | null;
              if (r?.hash) onDropHash(r.hash);
            })
            .catch(() => {
              /* image import failure is non-critical */
            });
        }
      }
    }
  };

  return (
    <div className="space-y-1.5">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'rounded border w-full',
          mainRef?.assetHash ? 'border-primary/50 bg-primary/5' : 'border-dashed border-border/70',
          isDragOver && 'border-blue-400/70 bg-blue-500/5 ring-2 ring-blue-400/40',
        )}
      >
        {url ? (
          <div className="relative w-full aspect-[2/3] bg-muted rounded overflow-hidden">
            <img
              src={url}
              alt="Reference"
              className="h-full w-full object-contain"
              onError={markFailed}
              draggable={Boolean(mainRef?.assetHash && entityType && entityId && slot)}
              onDragStart={
                mainRef?.assetHash && entityType && entityId && slot
                  ? (e) => {
                      e.stopPropagation();
                      e.dataTransfer.setData(
                        'application/x-lucid-ref-image',
                        JSON.stringify({
                          assetHash: mainRef.assetHash,
                          entityType,
                          entityId,
                          slot,
                        }),
                      );
                      e.dataTransfer.effectAllowed = 'copy';
                    }
                  : undefined
              }
            />
            {isDragOver && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-blue-500/10">
                <span className="rounded border border-dashed border-blue-400/70 bg-blue-500/10 px-3 py-1 text-xs text-blue-400">
                  {t('entity.dropHere')}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center aspect-[2/3] gap-2">
            {isDragOver ? (
              <span className="text-xs text-blue-400">{t('entity.dropImageHere')}</span>
            ) : mainRef?.assetHash ? (
              <>
                <ImageOff className="w-8 h-8 text-destructive/40" />
                <span className="text-[10px] text-destructive/60">{t('entity.brokenImage')}</span>
              </>
            ) : (
              <Image className="w-8 h-8 text-muted-foreground/40" />
            )}
            {!isDragOver && !mainRef?.assetHash && (
              <span className="text-xs text-muted-foreground">
                {t('entity.clickToUploadReferenceImage')}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-1 p-1.5">
          <button
            type="button"
            onClick={onUpload}
            className="flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] hover:bg-muted/80 transition-colors"
            aria-label={t('entity.upload')}
          >
            <Upload className="w-3 h-3" aria-hidden="true" />
            {t('entity.upload')}
          </button>
          <button
            type="button"
            onClick={onFromAssets}
            className="flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] hover:bg-muted/80 transition-colors"
            aria-label={t('entity.fromAssets')}
          >
            <Image className="w-3 h-3" aria-hidden="true" />
            {t('entity.fromAssets')}
          </button>
          {mainRef?.assetHash && (
            <button
              type="button"
              onClick={() => onRemove(mainRef.slot)}
              className="ml-auto flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-[10px] hover:bg-destructive/20 transition-colors"
              aria-label={t('entity.removeImage')}
            >
              <X className="w-3 h-3" aria-hidden="true" />
              {t('entity.removeImage')}
            </button>
          )}
        </div>
      </div>
      {url && mainRef?.variants && mainRef.variants.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-muted-foreground/70 shrink-0">
            {t('equipmentManager.variants')}:
          </span>
          <div className="flex gap-1 overflow-x-auto">
            {mainRef.assetHash && (
              <VariantThumb
                key={mainRef.assetHash}
                hash={mainRef.assetHash}
                isActive
                onDelete={onDeleteVariant ? () => onDeleteVariant(mainRef.assetHash!) : undefined}
              />
            )}
            {mainRef.variants
              .filter((v) => v !== mainRef.assetHash)
              .map((variantHash) => (
                <VariantThumb
                  key={variantHash}
                  hash={variantHash}
                  isActive={false}
                  onClick={() => onSelectVariant?.(variantHash)}
                  onDelete={onDeleteVariant ? () => onDeleteVariant(variantHash) : undefined}
                />
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VariantThumb({
  hash,
  isActive,
  onClick,
  onDelete,
}: {
  hash: string;
  isActive: boolean;
  onClick?: () => void;
  onDelete?: () => void;
}) {
  const { url, markFailed } = useAssetUrl(hash, 'image', 'png');
  if (!url) return null;
  return (
    <div className="relative shrink-0 group">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'h-8 w-12 rounded border overflow-hidden transition-colors',
          isActive
            ? 'border-primary ring-1 ring-primary/40'
            : 'border-border/60 hover:border-primary/50',
        )}
      >
        <img src={url} alt="variant" className="h-full w-full object-cover" onError={markFailed} />
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-1 right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label="Delete variant"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}

function ListThumb({ hash }: { hash?: string }) {
  const { url, markFailed } = useAssetUrl(hash, 'image', 'png');
  if (!url) return <div className="h-full w-full bg-muted/50" />;
  return <img src={url} alt="" className="h-full w-full object-contain" onError={markFailed} />;
}

function AssetPickerDialog({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (hash: string) => void;
}) {
  const { t } = useI18n();
  const imageAssets = useSelector(selectImageAssets);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('entity.selectImage')}</DialogTitle>
          <DialogDescription className="sr-only">{t('entity.selectImage')}</DialogDescription>
        </DialogHeader>
        {imageAssets.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            {t('entity.noImageAssetsFound')}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 max-h-96 overflow-y-auto p-1">
            {imageAssets.map((asset) => (
              <AssetThumb key={asset.id} asset={asset} onSelect={onSelect} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssetThumb({ asset, onSelect }: { asset: Asset; onSelect: (hash: string) => void }) {
  const { url, markFailed } = useAssetUrl(asset.hash, 'image', asset.format ?? 'jpg');
  return (
    <button
      type="button"
      onClick={() => onSelect(asset.hash)}
      className="rounded border border-border/60 overflow-hidden hover:border-primary transition-colors"
      title={asset.name}
    >
      {url ? (
        <img
          src={url}
          alt={asset.name}
          className="w-full aspect-square object-cover"
          onError={markFailed}
        />
      ) : (
        <div className="w-full aspect-square bg-muted flex items-center justify-center">
          <Image className="w-6 h-6 text-muted-foreground/40" />
        </div>
      )}
      <div className="text-[9px] text-muted-foreground truncate px-1 py-0.5">{asset.name}</div>
    </button>
  );
}
