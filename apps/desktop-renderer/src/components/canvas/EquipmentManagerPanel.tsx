import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { selectEntityUsageCounts } from '../../store/slices/canvas/canvas-selectors.js';
import { removeEntityRefsFromAllCanvases } from '../../store/slices/canvas/canvas.js';
import { enqueueToast } from '../../store/slices/toast.js';
import {
  setEquipment,
  addEquipment,
  addEquipmentBatch,
  updateEquipment,
  removeEquipmentBatch,
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
  moveItemsToFolder,
} from '../../store/slices/equipment.js';
import { getAPI } from '../../utils/api.js';
import type { Equipment, EquipmentType, ReferenceImage } from '@lucid-fin/contracts';
import { Link2, Package } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';
import { useEntityManager } from '../../hooks/useEntityManager.js';
import { useEntityFolders } from '../../hooks/useEntityFolders.js';
import { useEntityClipboard } from '../../hooks/useEntityClipboard.js';
import { EntityFileExplorer } from './EntityFileExplorer.js';
import { EntityDetailDrawer } from './EntityDetailDrawer.js';
import { SingleReferenceImage } from './entity-shared/SingleReferenceImage.js';
import { AssetPickerDialog } from './entity-shared/AssetPickerDialog.js';
import { ListThumb } from './entity-shared/EntityThumbs.js';

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

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const selectedEquip = selectedId ? itemsById.get(selectedId) : undefined;
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
      if (ids.length === 0) return;
      const api = getAPI();
      if (!api?.equipment) return;
      try {
        const { movedIds } = await api.equipment.setFolder(ids, folderId);
        dispatch(moveItemsToFolder({ ids: movedIds, folderId }));
      } catch (reason) {
        reportError(reason, 'handleMoveIdsToFolder');
      }
    },
    [dispatch, reportError],
  );

  const handleCopyIds = useCallback(
    async (ids: string[], targetFolderId: string | null) => {
      if (ids.length === 0) return;
      const api = getAPI();
      if (!api?.equipment) return;
      try {
        const { created } = await api.equipment.copy(ids, targetFolderId);
        dispatch(addEquipmentBatch(created));
      } catch (reason) {
        reportError(reason, 'handleCopyIds');
      }
    },
    [dispatch, reportError],
  );

  const handlePaste = useCallback(
    async (payload: { mode: 'copy' | 'cut'; items: Equipment[] }) => {
      const folderId = folderApi.currentFolderId;
      if (payload.mode === 'cut') {
        await handleMoveIdsToFolder(
          payload.items.map((it) => it.id),
          folderId,
        );
      } else {
        await handleCopyIds(
          payload.items.map((item) => item.id),
          folderId,
        );
      }
    },
    [folderApi.currentFolderId, handleCopyIds, handleMoveIdsToFolder],
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
      const names = ids.map((id) => itemsById.get(id)?.name ?? id).join(', ');
      const ok = await confirm({
        title: t('equipmentManager.deleteConfirm').replace('{name}', names),
        destructive: true,
        confirmLabel: t('action.confirm'),
        cancelLabel: t('action.cancel'),
      });
      if (!ok) return;
      setError(null);
      const api = getAPI();
      if (!api?.equipment) return;
      try {
        const { deletedIds } = await api.equipment.delete(ids);
        dispatch(removeEquipmentBatch(deletedIds));
        if (selectedId && deletedIds.includes(selectedId)) setDrawerOpen(false);
        dispatch(
          removeEntityRefsFromAllCanvases({ entityType: 'equipment', entityIds: deletedIds }),
        );
      } catch (reason) {
        reportError(reason, 'handleDeleteIds');
      }
    },
    [confirm, dispatch, itemsById, reportError, selectedId, setError, t],
  );

  const handleRefImageUpload = useCallback(
    async (slot: string, isStandard: boolean) => {
      if (!selectedEquip) return;
      setError(null);
      try {
        const api = getAPI();
        if (!api) return;
        const asset = await api.assetEntry.pickFile('image');
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
          onDuplicateItems={(ids) => void handleCopyIds(ids, folderApi.currentFolderId)}
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
          onPaste={(payload) => void handlePaste(payload)}
          header={
            <div className="flex items-center gap-2">
              <Package className="h-3.5 w-3.5 text-primary" />
              <h2 className="text-xs font-semibold">{t('equipmentManager.title')}</h2>
            </div>
          }
          newItemLabel={t('equipmentManager.newEquipment')}
          activeItemId={drawerOpen ? (selectedId ?? null) : null}
          loading={loading}
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
                aspectRatio="aspect-[2/3]"
                variantsLabel={t('equipmentManager.variants')}
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
