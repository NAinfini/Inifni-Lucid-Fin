import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { selectAllCanvases } from '../../store/slices/canvas-selectors.js';
import {
  setLocations,
  addLocation,
  updateLocation,
  removeLocation,
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
  moveItemToFolder,
} from '../../store/slices/locations.js';
import { getAPI } from '../../utils/api.js';
import { cn } from '../../lib/utils.js';
import type {
  Location,
  ReferenceImage,
  ImageNodeData,
  VideoNodeData,
} from '@lucid-fin/contracts';
import { useAssetUrl } from '../../hooks/useAssetUrl.js';
import { MapPin, Plus, Search, Trash2, Save, Upload, Image, ImageOff, X } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';
import { useEntityManager } from '../../hooks/useEntityManager.js';
import { useEntityFolders } from '../../hooks/useEntityFolders.js';
import { FolderTree } from './folders/FolderTree.js';
import { FolderBreadcrumb } from './folders/FolderBreadcrumb.js';
import { selectImageAssets, type Asset } from '../../store/slices/assets.js';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/Dialog.js';

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
    draft, setDraft,
    setOriginalDraft,
    search, setSearch,
    error, setError,
    assetPickerOpen, setAssetPickerOpen,
    isDirty,
    reportError,
    confirmDiscardIfDirty,
    confirm,
    ConfirmDialog,
  } = useEntityManager<LocationDraft>({
    entityType: 'location',
    unsavedChangesKey: 'locationManager.unsavedChanges',
  });

  const selectedLoc = useMemo(() => items.find((l) => l.id === selectedId), [items, selectedId]);
  const [foldersOpen, setFoldersOpen] = useState(true);

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

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((l) => {
      if (folderApi.currentFolderId !== null && l.folderId !== folderApi.currentFolderId) {
        return false;
      }
      if (!keyword) return true;
      const blob = `${l.name} ${l.description} ${l.tags.join(' ')}`.toLowerCase();
      return blob.includes(keyword);
    });
  }, [items, search, folderApi.currentFolderId]);

  const canvases = useSelector(selectAllCanvases);

  const usageCountById = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const canvas of canvases) {
      for (const node of canvas.nodes) {
        if (node.type !== 'image' && node.type !== 'video') continue;
        const data = node.data as ImageNodeData | VideoNodeData;
        if (data.locationRefs) {
          for (const ref of data.locationRefs) {
            counts[ref.locationId] = (counts[ref.locationId] ?? 0) + 1;
          }
        }
      }
    }
    return counts;
  }, [canvases]);

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

  const handleSelectLocation = useCallback(
    async (id: string) => {
      if (id === selectedId) return;
      if (!(await confirmDiscardIfDirty())) return;
      dispatch(selectLocation(id));
    },
    [dispatch, selectedId, confirmDiscardIfDirty],
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
      }
    } catch (reason) {
      reportError(reason, 'createNewLocation');
    }
  }, [dispatch, confirmDiscardIfDirty, reportError, setError, t, folderApi.currentFolderId]);

  const handleMoveLocationToFolder = useCallback(
    async (locationId: string, folderId: string | null) => {
      const api = getAPI();
      if (!api?.location) return;
      try {
        await api.location.setFolder(locationId, folderId);
        dispatch(moveItemToFolder({ id: locationId, folderId }));
      } catch (reason) {
        reportError(reason, 'handleMoveLocationToFolder');
      }
    },
    [dispatch, reportError],
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
      }
    } catch (reason) {
      reportError(reason, 'saveDraft');
    }
  }, [dispatch, draft, reportError, selectedLoc, setError]);

  const deleteSelected = useCallback(async () => {
    if (!selectedLoc) return;
    const ok = await confirm({
      title: t('locationManager.deleteConfirm').replace('{name}', selectedLoc.name),
      destructive: true,
      confirmLabel: t('action.confirm'),
      cancelLabel: t('action.cancel'),
    });
    if (!ok) return;
    setError(null);
    try {
      const api = getAPI();
      if (api?.location) {
        await api.location.delete(selectedLoc.id);
      }
      dispatch(removeLocation(selectedLoc.id));
    } catch (reason) {
      reportError(reason, 'deleteSelected');
    }
  }, [confirm, dispatch, reportError, selectedLoc, setError, t]);

  const handleRefImageUpload = useCallback(
    async (slot: string, isStandard: boolean) => {
      if (!selectedLoc) return;
      setError(null);
      try {
        const api = getAPI();
        if (!api) return;
        const asset = (await api.asset.pickFile('image')) as { hash: string } | null;
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

        // Only change the active image; keep variants list unchanged
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
          mainRef.assetHash === variantHash
            ? (newVariants[0] ?? '')
            : mainRef.assetHash;

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

  return (
    <div className="h-full border-r border-border/60 bg-card flex flex-col">
      <div className="px-3 py-2 border-b border-border/60 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" />
            {t('locationManager.title')}
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
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('locationManager.search')}
            className="w-full rounded bg-muted pl-7 pr-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <FolderBreadcrumb
          breadcrumb={folderApi.breadcrumb}
          onNavigate={folderApi.setCurrentFolder}
          rootLabel={t('folders.all') as string}
        />
      </div>

      {foldersOpen && (
        <div className="border-b border-border/60 max-h-40 overflow-auto p-1.5">
          <FolderTree
            folders={folderApi.folders}
            currentFolderId={folderApi.currentFolderId}
            onSelect={folderApi.setCurrentFolder}
            onCreate={folderApi.createFolder}
            onRename={folderApi.renameFolder}
            onDelete={folderApi.deleteFolder}
            onDropItem={(folderId, payload) => void handleMoveLocationToFolder(payload, folderId)}
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

      <div className="grid grid-cols-[40%_60%] h-full min-h-0">
        <div className="border-r min-h-0 overflow-auto">
          <div className="p-1.5 border-b border-border/60 flex items-center gap-1">
            <button
              onClick={() => void createNewLocation()}
              className="flex-1 text-[11px] rounded-md border border-border/60 px-2 py-1 hover:bg-muted/80 flex items-center justify-center gap-1 transition-colors"
              aria-label={t('locationManager.newLocation')}
            >
              <Plus className="w-3 h-3" aria-hidden="true" />
              {t('locationManager.newLocation')}
            </button>
            {draft && (
              <>
                <button
                  onClick={saveDraft}
                  disabled={!isDirty}
                  className="inline-flex items-center gap-0.5 rounded-md border border-border/60 px-1.5 py-1 text-[11px] hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label={t('locationManager.save')}
                  title={t('locationManager.save')}
                >
                  <Save className="w-3 h-3" aria-hidden="true" />
                </button>
                <button
                  onClick={() => void deleteSelected()}
                  className="inline-flex items-center gap-0.5 rounded-md border border-border/60 px-1.5 py-1 text-[11px] hover:bg-destructive/20 transition-colors"
                  aria-label={t('locationManager.delete')}
                  title={t('locationManager.delete')}
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
          {loading ? (
            <div className="text-xs text-muted-foreground p-3">{t('locationManager.loading')}</div>
          ) : (
            <div className="p-1.5 space-y-1">
              {filtered.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => void handleSelectLocation(loc.id)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/lucid-entity-id', loc.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  className={cn(
                    'w-full text-left rounded-md border px-2 py-1.5 text-[11px] transition-colors',
                    selectedId === loc.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border/60 hover:bg-muted/80',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <ListThumb
                      hash={
                        loc.referenceImages?.find((r) => r.slot === 'main')?.assetHash ??
                        loc.referenceImages?.[0]?.assetHash
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">
                        {loc.name || t('locationManager.untitled')}
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {loc.timeOfDay &&
                          (() => {
                            const key = `locationManager.timeOfDayOptions.${loc.timeOfDay}`;
                            const translated = t(key as 'locationManager.fields.name');
                            return (
                              <span className="inline-block text-[9px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-400">
                                {translated === key ? loc.timeOfDay : translated}
                              </span>
                            );
                          })()}
                      </div>
                      {(usageCountById[loc.id] ?? 0) > 0 && (
                        <div className="text-[9px] text-muted-foreground mt-0.5">
                          {t('locationManager.usedInNodes').replace(
                            '{count}',
                            String(usageCountById[loc.id]),
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="text-[11px] text-muted-foreground px-2 py-1.5">
                  {t('locationManager.noResults')}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-auto p-2 space-y-2">
          {!draft ? (
            <div className="text-xs text-muted-foreground">
              {t('locationManager.selectOrCreate')}
            </div>
          ) : (
            <>
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

              {/* Reference Image - Single large image */}
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
            </>
          )}

          {error && <div className="text-[11px] text-destructive">{error}</div>}
        </div>
      </div>
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
          <div className="relative w-full aspect-[3/2] bg-muted rounded overflow-hidden">
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
          <div className="flex flex-col items-center justify-center aspect-[3/2] gap-2">
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
            {t('locationManager.variants')}:
          </span>
          <div className="flex gap-1 overflow-x-auto">
            {mainRef.assetHash && (
              <VariantThumb key={mainRef.assetHash} hash={mainRef.assetHash} isActive onDelete={onDeleteVariant ? () => onDeleteVariant(mainRef.assetHash!) : undefined} />
            )}
            {mainRef.variants.filter((v) => v !== mainRef.assetHash).map((variantHash) => (
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
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
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
  if (!url) return <div className="shrink-0 w-8 h-8 rounded bg-muted/50" />;
  return (
    <img src={url} alt="" className="shrink-0 w-8 h-8 rounded object-cover" onError={markFailed} />
  );
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
