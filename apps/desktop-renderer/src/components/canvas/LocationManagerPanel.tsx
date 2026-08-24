import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { selectEntityUsageCounts } from '../../store/slices/canvas/canvas-selectors.js';
import { removeEntityRefsFromAllCanvases } from '../../store/slices/canvas/canvas.js';
import { enqueueToast } from '../../store/slices/toast.js';
import {
  setLocations,
  addLocation,
  addLocations,
  updateLocation,
  removeLocations,
  selectLocation,
  setLocationsLoading,
  setLocationRefImage,
  removeLocationRefImage,
  setFolders,
  addFolder,
  updateFolder,
  removeFolder,
  setCurrentFolder,
  setFoldersLoading,
  moveItemsToFolder,
} from '../../store/slices/locations.js';
import { getAPI } from '../../utils/api.js';
import type { Location, ReferenceImage } from '@lucid-fin/contracts';
import { Link2, MapPin } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';
import { useEntityManager } from '../../hooks/useEntityManager.js';
import { useEntityFolders } from '../../hooks/useEntityFolders.js';
import { useEntityClipboard } from '../../hooks/useEntityClipboard.js';
import { EntityFileExplorer } from './EntityFileExplorer.js';
import { EntityDetailDrawer } from './EntityDetailDrawer.js';
import { SingleReferenceImage } from './entity-shared/SingleReferenceImage.js';
import { AssetPickerDialog } from './entity-shared/AssetPickerDialog.js';
import { ListThumb } from './entity-shared/EntityThumbs.js';

const TIME_OF_DAY_OPTIONS = ['day', 'night', 'dawn', 'dusk', 'continuous'];

interface LocationDraft {
  id: string;
  name: string;
  timeOfDay: string;
  description: string;
  mood: string;
  weather: string;
  lighting: string;
  tags: string;
}

function createDraft(loc: Location): LocationDraft {
  return {
    id: loc.id,
    name: loc.name,
    timeOfDay: loc.timeOfDay ?? '',
    description: loc.description,
    mood: loc.mood ?? '',
    weather: loc.weather ?? '',
    lighting: loc.lighting ?? '',
    tags: loc.tags.join(', '),
  };
}

export function LocationManagerPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const { items, selectedId, loading } = useSelector((s: RootState) => s.locations);

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
  } = useEntityManager<LocationDraft>({
    entityType: 'location',
    unsavedChangesKey: 'locationManager.unsavedChanges',
  });

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const selectedLoc = selectedId ? itemsById.get(selectedId) : undefined;
  const [drawerOpen, setDrawerOpen] = useState(false);

  const folderApi = useEntityFolders({
    kind: 'location',
    selectFolders: (s) => s.locations.folders,
    selectCurrentFolderId: (s) => s.locations.currentFolderId,
    selectFoldersLoading: (s) => s.locations.foldersLoading,
    actions: {
      setFolders,
      addFolder,
      updateFolder,
      removeFolder,
      setCurrentFolder,
      setFoldersLoading,
    },
  });

  const clipboard = useEntityClipboard<Location>('location');
  const cutIds = useMemo(() => {
    if (!clipboard.isCut) return new Set<string>();
    const p = clipboard.peek();
    return new Set(p?.items.map((it) => it.id) ?? []);
  }, [clipboard]);

  const usageCountById = useSelector(selectEntityUsageCounts).location;

  useEffect(() => {
    if (!selectedLoc) {
      setDraft(null);
      setOriginalDraft(null);
      return;
    }
    const d = createDraft(selectedLoc);
    setDraft(d);
    setOriginalDraft(d);
  }, [selectedLoc, setDraft, setOriginalDraft]);

  const handleOpenItem = useCallback(
    async (loc: Location) => {
      if (selectedId !== loc.id) {
        if (!(await confirmDiscardIfDirty())) return;
        dispatch(selectLocation(loc.id));
      }
      setDrawerOpen(true);
    },
    [confirmDiscardIfDirty, dispatch, selectedId],
  );

  const loadLocations = useCallback(async () => {
    dispatch(setLocationsLoading(true));
    try {
      const api = getAPI();
      if (api?.location) {
        const list = (await api.location.list()) as Location[];
        dispatch(setLocations(list));
      }
    } catch (reason) {
      reportError(reason, 'loadLocations');
    } finally {
      dispatch(setLocationsLoading(false));
    }
  }, [dispatch, reportError]);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  const createNewLocation = useCallback(async () => {
    if (!(await confirmDiscardIfDirty())) return;
    setError(null);
    try {
      const api = getAPI();
      const data: Partial<Location> = {
        name: t('locationManager.newLocation'),
        description: '',
        tags: [],
        referenceImages: [],
        folderId: folderApi.currentFolderId,
      };
      if (api?.location) {
        const saved = (await api.location.save(data as Record<string, unknown>)) as Location;
        dispatch(addLocation(saved));
        dispatch(selectLocation(saved.id));
        setDrawerOpen(true);
      }
    } catch (reason) {
      reportError(reason, 'createNewLocation');
    }
  }, [dispatch, confirmDiscardIfDirty, reportError, setError, t, folderApi.currentFolderId]);

  const handleMoveIdsToFolder = useCallback(
    async (ids: string[], folderId: string | null) => {
      if (ids.length === 0) return;
      const api = getAPI();
      if (!api?.location) return;
      try {
        const { movedIds } = await api.location.setFolder(ids, folderId);
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
      if (!api?.location) return;
      try {
        const { created } = await api.location.copy(ids, targetFolderId);
        dispatch(addLocations(created));
      } catch (reason) {
        reportError(reason, 'handleCopyIds');
      }
    },
    [dispatch, reportError],
  );

  const handlePaste = useCallback(
    async (payload: { mode: 'copy' | 'cut'; items: Location[] }) => {
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
    if (!draft || !selectedLoc) return;
    setError(null);
    try {
      const data: Partial<Location> = {
        id: draft.id,
        name: draft.name.trim(),
        timeOfDay: draft.timeOfDay || undefined,
        description: draft.description,
        mood: draft.mood || undefined,
        weather: draft.weather || undefined,
        lighting: draft.lighting || undefined,
        tags: draft.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const api = getAPI();
      if (api?.location) {
        const saved = (await api.location.save(data as Record<string, unknown>)) as Location;
        dispatch(updateLocation({ id: saved.id, data: saved }));
        dispatch(enqueueToast({ variant: 'success', title: t('toast.entitySaved') }));
      }
    } catch (reason) {
      reportError(reason, 'saveDraft');
    }
  }, [dispatch, draft, reportError, selectedLoc, setError, t]);

  const handleDeleteIds = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const names = ids.map((id) => itemsById.get(id)?.name ?? id).join(', ');
      const ok = await confirm({
        title: t('locationManager.deleteConfirm').replace('{name}', names),
        destructive: true,
        confirmLabel: t('action.confirm'),
        cancelLabel: t('action.cancel'),
      });
      if (!ok) return;
      setError(null);
      const api = getAPI();
      if (!api?.location) return;
      try {
        const { deletedIds } = await api.location.delete(ids);
        dispatch(removeLocations(deletedIds));
        if (selectedId && deletedIds.includes(selectedId)) setDrawerOpen(false);
        dispatch(
          removeEntityRefsFromAllCanvases({ entityType: 'location', entityIds: deletedIds }),
        );
      } catch (reason) {
        reportError(reason, 'handleDeleteIds');
      }
    },
    [confirm, dispatch, itemsById, reportError, selectedId, setError, t],
  );

  const handleRefImageUpload = useCallback(
    async (slot: string, isStandard: boolean) => {
      if (!selectedLoc) return;
      setError(null);
      try {
        const api = getAPI();
        if (!api) return;
        const asset = await api.assetEntry.pickFile('image');
        if (!asset) return;
        const refImage = (await api.location.setRefImage(
          selectedLoc.id,
          slot,
          asset.hash,
          isStandard,
        )) as ReferenceImage;
        dispatch(setLocationRefImage({ locationId: selectedLoc.id, refImage }));
      } catch (reason) {
        reportError(reason, 'handleRefImageUpload');
      }
    },
    [dispatch, reportError, selectedLoc, setError],
  );

  const handleRefImageRemove = useCallback(
    async (slot: string) => {
      if (!selectedLoc) return;
      setError(null);
      try {
        const api = getAPI();
        if (api?.location) {
          await api.location.removeRefImage(selectedLoc.id, slot);
        }
        dispatch(removeLocationRefImage({ locationId: selectedLoc.id, slot }));
      } catch (reason) {
        reportError(reason, 'handleRefImageRemove');
      }
    },
    [dispatch, reportError, selectedLoc, setError],
  );

  const handleSelectVariant = useCallback(
    async (variantHash: string) => {
      if (!selectedLoc) return;
      setError(null);
      try {
        const mainRef =
          selectedLoc.referenceImages.find((r) => r.slot === 'main') ??
          selectedLoc.referenceImages[0];
        if (!mainRef) return;

        const updatedRef: ReferenceImage = {
          ...mainRef,
          assetHash: variantHash,
        };

        const updatedRefs = selectedLoc.referenceImages.map((r) =>
          r.slot === mainRef.slot ? updatedRef : r,
        );
        const api = getAPI();
        if (api?.location) {
          await api.location.save({ id: selectedLoc.id, referenceImages: updatedRefs } as Record<
            string,
            unknown
          >);
        }
        dispatch(setLocationRefImage({ locationId: selectedLoc.id, refImage: updatedRef }));
      } catch (reason) {
        reportError(reason, 'handleSelectVariant');
      }
    },
    [dispatch, reportError, selectedLoc, setError],
  );

  const handleDeleteVariant = useCallback(
    async (variantHash: string) => {
      if (!selectedLoc) return;
      setError(null);
      try {
        const mainRef =
          selectedLoc.referenceImages.find((r) => r.slot === 'main') ??
          selectedLoc.referenceImages[0];
        if (!mainRef || !mainRef.variants) return;

        const newVariants = mainRef.variants.filter((v) => v !== variantHash);
        const newAssetHash =
          mainRef.assetHash === variantHash ? (newVariants[0] ?? '') : mainRef.assetHash;

        const updatedRef: ReferenceImage = {
          ...mainRef,
          assetHash: newAssetHash,
          variants: newVariants,
        };

        const updatedRefs = selectedLoc.referenceImages.map((r) =>
          r.slot === mainRef.slot ? updatedRef : r,
        );
        const api = getAPI();
        if (api?.location) {
          await api.location.save({ id: selectedLoc.id, referenceImages: updatedRefs } as Record<
            string,
            unknown
          >);
        }
        dispatch(setLocationRefImage({ locationId: selectedLoc.id, refImage: updatedRef }));
      } catch (reason) {
        reportError(reason, 'handleDeleteVariant');
      }
    },
    [dispatch, reportError, selectedLoc, setError],
  );

  const handleRefImageFromAsset = useCallback(
    async (hash: string) => {
      if (!selectedLoc) return;
      setAssetPickerOpen(false);
      setError(null);
      try {
        const api = getAPI();
        if (!api?.location) return;
        const refImage = (await api.location.setRefImage(
          selectedLoc.id,
          'main',
          hash,
          true,
        )) as ReferenceImage;
        dispatch(setLocationRefImage({ locationId: selectedLoc.id, refImage }));
      } catch (reason) {
        reportError(reason, 'handleRefImageFromAsset');
      }
    },
    [dispatch, reportError, selectedLoc, setAssetPickerOpen, setError],
  );

  const drawerShown = drawerOpen && draft !== null;
  return (
    <div className="flex h-full min-h-0">
      <div
        className={drawerShown ? 'w-[140px] shrink-0 border-r border-border/60' : 'flex-1 min-w-0'}
      >
        <EntityFileExplorer<Location>
          items={items}
          folders={folderApi.folders}
          currentFolderId={folderApi.currentFolderId}
          onNavigateFolder={folderApi.setCurrentFolder}
          onCreateFolder={folderApi.createFolder}
          onRenameFolder={folderApi.renameFolder}
          onDeleteFolder={folderApi.deleteFolder}
          onMoveItemsToFolder={(ids, folderId) => void handleMoveIdsToFolder(ids, folderId)}
          onCreateItem={() => void createNewLocation()}
          onOpenItem={(l) => void handleOpenItem(l)}
          onDeleteItems={(ids) => void handleDeleteIds(ids)}
          onDuplicateItems={(ids) => void handleCopyIds(ids, folderApi.currentFolderId)}
          compact={drawerShown}
          renderThumbnail={(l) => (
            <ListThumb
              hash={
                l.referenceImages?.find((r) => r.slot === 'main')?.assetHash ??
                l.referenceImages?.[0]?.assetHash
              }
            />
          )}
          renderSubtitle={(l) => (
            <span className="inline-flex items-center gap-1">
              {l.timeOfDay && (
                <>
                  {(() => {
                    const key = `locationManager.timeOfDayOptions.${l.timeOfDay}`;
                    const translated = t(key as 'locationManager.fields.name');
                    return translated === key ? l.timeOfDay : translated;
                  })()}
                </>
              )}
              {(usageCountById[l.id] ?? 0) > 0 && (
                <span
                  className="inline-flex items-center gap-0.5"
                  title={t('locationManager.usedInNodes').replace(
                    '{count}',
                    String(usageCountById[l.id]),
                  )}
                >
                  <Link2 className="h-3 w-3" />
                  {usageCountById[l.id]}
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
              <MapPin className="h-3.5 w-3.5 text-primary" />
              <h2 className="text-xs font-semibold">{t('locationManager.title')}</h2>
            </div>
          }
          newItemLabel={t('locationManager.newLocation')}
          activeItemId={drawerOpen ? (selectedId ?? null) : null}
          loading={loading}
          emptyLabel={t('locationManager.noResults')}
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
        subtitle={
          draft?.timeOfDay
            ? (() => {
                const key = `locationManager.timeOfDayOptions.${draft.timeOfDay}`;
                const translated = t(key as 'locationManager.fields.name');
                return translated === key ? draft.timeOfDay : translated;
              })()
            : undefined
        }
        onSave={() => void saveDraft()}
        isDirty={isDirty}
        onDelete={selectedId ? () => void handleDeleteIds([selectedId]) : undefined}
      >
        {draft && (
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                {t('locationManager.fields.name')}
              </label>
              <input
                value={draft.name}
                onChange={(e) => setDraft((p) => (p ? { ...p, name: e.target.value } : p))}
                className="w-full rounded bg-muted px-2 py-1 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                {t('locationManager.fields.timeOfDay')}
              </label>
              <select
                value={draft.timeOfDay}
                onChange={(e) => setDraft((p) => (p ? { ...p, timeOfDay: e.target.value } : p))}
                className="w-full rounded bg-muted px-2 py-1 text-xs"
              >
                <option value="">--</option>
                {TIME_OF_DAY_OPTIONS.map((tod) => (
                  <option key={tod} value={tod}>
                    {t('locationManager.timeOfDayOptions.' + tod)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                {t('locationManager.fields.description')}
              </label>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft((p) => (p ? { ...p, description: e.target.value } : p))}
                className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[60px]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                {t('locationManager.fields.mood')}
              </label>
              <input
                value={draft.mood}
                onChange={(e) => setDraft((p) => (p ? { ...p, mood: e.target.value } : p))}
                className="w-full rounded bg-muted px-2 py-1 text-xs"
                placeholder={t('locationManager.placeholders.mood')}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                {t('locationManager.fields.weather')}
              </label>
              <input
                value={draft.weather}
                onChange={(e) => setDraft((p) => (p ? { ...p, weather: e.target.value } : p))}
                className="w-full rounded bg-muted px-2 py-1 text-xs"
                placeholder={t('locationManager.placeholders.weather')}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                {t('locationManager.fields.lighting')}
              </label>
              <input
                value={draft.lighting}
                onChange={(e) => setDraft((p) => (p ? { ...p, lighting: e.target.value } : p))}
                className="w-full rounded bg-muted px-2 py-1 text-xs"
                placeholder={t('locationManager.placeholders.lighting')}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                {t('locationManager.fields.tags')}
              </label>
              <input
                value={draft.tags}
                onChange={(e) => setDraft((p) => (p ? { ...p, tags: e.target.value } : p))}
                className="w-full rounded bg-muted px-2 py-1 text-xs"
                placeholder={t('locationManager.placeholders.tags')}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                {t('locationManager.referenceImages')}
              </label>
              <SingleReferenceImage
                referenceImages={selectedLoc?.referenceImages ?? []}
                onUpload={() => handleRefImageUpload('main', true)}
                onRemove={(slot) => handleRefImageRemove(slot)}
                onFromAssets={() => setAssetPickerOpen(true)}
                onDropHash={(hash) => void handleRefImageFromAsset(hash)}
                onSelectVariant={(hash) => void handleSelectVariant(hash)}
                onDeleteVariant={(hash) => void handleDeleteVariant(hash)}
                entityType="location"
                entityId={selectedLoc?.id}
                slot="main"
                aspectRatio="aspect-[3/2]"
                variantsLabel={t('locationManager.variants')}
              />
              <p className="text-[9px] text-muted-foreground/70 italic mt-1">
                {t('locationManager.generateAllHint')}
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
