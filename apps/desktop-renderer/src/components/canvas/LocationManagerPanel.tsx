import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import {
  setLocations,
  addLocation,
  updateLocation,
  removeLocation,
  selectLocation,
  setLocationsFilterType,
  setLocationsLoading,
  setLocationRefImage,
  removeLocationRefImage,
} from '../../store/slices/locations.js';
import { getAPI } from '../../utils/api.js';
import { cn } from '../../lib/utils.js';
import type { Location, LocationType, ReferenceImage } from '@lucid-fin/contracts';
import { LOCATION_STANDARD_SLOTS } from '@lucid-fin/contracts';
import { useAssetUrl } from '../../hooks/useAssetUrl.js';
import { MapPin, Plus, Search, Trash2, Save, Upload } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';
import { localizeSlot } from '../../i18n.js';

const TYPE_OPTIONS: LocationType[] = ['interior', 'exterior', 'int-ext'];
const TIME_OF_DAY_OPTIONS = ['day', 'night', 'dawn', 'dusk', 'continuous'];

function typeBadgeClass(type: LocationType): string {
  switch (type) {
    case 'interior':
      return 'bg-blue-500/20 text-blue-400';
    case 'exterior':
      return 'bg-green-500/20 text-green-400';
    case 'int-ext':
      return 'bg-amber-500/20 text-amber-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

interface LocationDraft {
  id: string;
  name: string;
  type: LocationType;
  subLocation: string;
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
    type: loc.type,
    subLocation: loc.subLocation ?? '',
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
  const { items, selectedId, filterType, loading } = useSelector(
    (s: RootState) => s.locations,
  );

  const [draft, setDraft] = useState<LocationDraft | null>(null);
  const [originalDraft, setOriginalDraft] = useState<LocationDraft | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    if (!draft || !originalDraft) return false;
    return JSON.stringify(draft) !== JSON.stringify(originalDraft);
  }, [draft, originalDraft]);

  const selectedLoc = useMemo(
    () => items.find((l) => l.id === selectedId),
    [items, selectedId],
  );

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((l) => {
      if (filterType !== 'all' && l.type !== filterType) return false;
      if (!keyword) return true;
      const blob = `${l.name} ${l.description} ${l.tags.join(' ')}`.toLowerCase();
      return blob.includes(keyword);
    });
  }, [items, search, filterType]);

  useEffect(() => {
    if (!selectedLoc) {
      setDraft(null);
      setOriginalDraft(null);
      return;
    }
    const d = createDraft(selectedLoc);
    setDraft(d);
    setOriginalDraft(d);
  }, [selectedLoc]);

  const confirmDiscardIfDirty = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm(t('locationManager.unsavedChanges'));
  }, [isDirty, t]);

  const handleSelectLocation = useCallback(
    (id: string) => {
      if (id === selectedId) return;
      if (!confirmDiscardIfDirty()) return;
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
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      dispatch(setLocationsLoading(false));
    }
  }, [dispatch]);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  const createNewLocation = useCallback(async () => {
    if (!confirmDiscardIfDirty()) return;
    setError(null);
    try {
      const api = getAPI();
      const data: Partial<Location> = {
        name: t('locationManager.newLocation'),
        type: 'interior',
        description: '',
        tags: [],
        referenceImages: [],
      };
      if (api?.location) {
        const saved = (await api.location.save(
          data as Record<string, unknown>,
        )) as Location;
        dispatch(addLocation(saved));
        dispatch(selectLocation(saved.id));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [dispatch, confirmDiscardIfDirty, t]);

  const saveDraft = useCallback(async () => {
    if (!draft || !selectedLoc) return;
    setError(null);
    try {
      const data: Partial<Location> = {
        id: draft.id,
        name: draft.name.trim(),
        type: draft.type,
        subLocation: draft.subLocation || undefined,
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
        const saved = (await api.location.save(
          data as Record<string, unknown>,
        )) as Location;
        dispatch(updateLocation({ id: saved.id, data: saved }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [dispatch, draft, selectedLoc]);

  const deleteSelected = useCallback(async () => {
    if (!selectedLoc) return;
    const ok = window.confirm(t('locationManager.deleteConfirm').replace('{name}', selectedLoc.name));
    if (!ok) return;
    setError(null);
    try {
      const api = getAPI();
      if (api?.location) {
        await api.location.delete(selectedLoc.id);
      }
      dispatch(removeLocation(selectedLoc.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [dispatch, selectedLoc]);

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
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [dispatch, selectedLoc],
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
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [dispatch, selectedLoc],
  );

  const refImageBySlot = useMemo(() => {
    if (!selectedLoc) return {};
    const map: Record<string, ReferenceImage> = {};
    for (const ref of selectedLoc.referenceImages) {
      map[ref.slot] = ref;
    }
    return map;
  }, [selectedLoc]);

  return (
    <div className="h-full border-r bg-card flex flex-col">
      <div className="px-3 py-2 border-b space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" />
            {t('locationManager.title')}
          </div>
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
        <select
          value={filterType}
          onChange={(e) =>
            dispatch(setLocationsFilterType(e.target.value as LocationType | 'all'))
          }
          className="w-full rounded bg-muted px-2 py-1.5 text-xs"
        >
          <option value="all">{t('locationManager.allTypes')}</option>
          {TYPE_OPTIONS.map((tp) => (
            <option key={tp} value={tp}>
              {t('locationManager.types.' + tp)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-[40%_60%] h-full min-h-0">
        <div className="border-r min-h-0 overflow-auto">
          <div className="p-1.5 border-b flex items-center gap-1">
            <button
              onClick={createNewLocation}
              className="flex-1 text-[11px] rounded border border-border px-2 py-1 hover:bg-muted flex items-center justify-center gap-1"
            >
              <Plus className="w-3 h-3" />
              {t('locationManager.newLocation')}
            </button>
            {draft && (
              <>
                <button
                  onClick={saveDraft}
                  disabled={!isDirty}
                  className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-1 text-[11px] hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                  title={t('locationManager.save')}
                >
                  <Save className="w-3 h-3" />
                </button>
                <button
                  onClick={deleteSelected}
                  className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-1 text-[11px] hover:bg-destructive/20"
                  title={t('locationManager.delete')}
                >
                  <Trash2 className="w-3 h-3" />
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
                  onClick={() => handleSelectLocation(loc.id)}
                  className={cn(
                    'w-full text-left rounded border px-2 py-1.5 text-[11px]',
                    selectedId === loc.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border/70 hover:bg-muted',
                  )}
                >
                  <div className="font-medium truncate">{loc.name || t('locationManager.untitled')}</div>
                  <span
                    className={cn(
                      'inline-block text-[9px] px-1 py-0.5 rounded',
                      typeBadgeClass(loc.type),
                    )}
                  >
                    {t('locationManager.types.' + loc.type)}
                  </span>
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
            <div className="text-xs text-muted-foreground">{t('locationManager.selectOrCreate')}</div>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('locationManager.fields.name')}
                </label>
                <input
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((p) => (p ? { ...p, name: e.target.value } : p))
                  }
                  className="w-full rounded bg-muted px-2 py-1 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                    {t('locationManager.fields.type')}
                  </label>
                  <select
                    value={draft.type}
                    onChange={(e) =>
                      setDraft((p) =>
                        p ? { ...p, type: e.target.value as LocationType } : p,
                      )
                    }
                    className="w-full rounded bg-muted px-2 py-1 text-xs"
                  >
                    {TYPE_OPTIONS.map((tp) => (
                      <option key={tp} value={tp}>
                        {t('locationManager.types.' + tp)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                    {t('locationManager.fields.subLocation')}
                  </label>
                  <input
                    value={draft.subLocation}
                    onChange={(e) =>
                      setDraft((p) =>
                        p ? { ...p, subLocation: e.target.value } : p,
                      )
                    }
                    className="w-full rounded bg-muted px-2 py-1 text-xs"
                    placeholder={t('locationManager.optional')}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('locationManager.fields.timeOfDay')}
                </label>
                <select
                  value={draft.timeOfDay}
                  onChange={(e) =>
                    setDraft((p) =>
                      p ? { ...p, timeOfDay: e.target.value } : p,
                    )
                  }
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
                  onChange={(e) =>
                    setDraft((p) =>
                      p ? { ...p, description: e.target.value } : p,
                    )
                  }
                  className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[60px]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('locationManager.fields.mood')}
                </label>
                <input
                  value={draft.mood}
                  onChange={(e) =>
                    setDraft((p) => (p ? { ...p, mood: e.target.value } : p))
                  }
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
                  onChange={(e) =>
                    setDraft((p) => (p ? { ...p, weather: e.target.value } : p))
                  }
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
                  onChange={(e) =>
                    setDraft((p) =>
                      p ? { ...p, lighting: e.target.value } : p,
                    )
                  }
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
                  onChange={(e) =>
                    setDraft((p) => (p ? { ...p, tags: e.target.value } : p))
                  }
                  className="w-full rounded bg-muted px-2 py-1 text-xs"
                  placeholder={t('locationManager.placeholders.tags')}
                />
              </div>

              {/* Reference Images */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('locationManager.referenceImages')}
                </label>
                <div className="grid grid-cols-3 gap-1">
                  {LOCATION_STANDARD_SLOTS.map((slot) => {
                    const ref = refImageBySlot[slot];
                    return (
                      <LocationSlotCard
                        key={slot}
                        slot={slot}
                        refImage={ref}
                        onUpload={() => handleRefImageUpload(slot, true)}
                        onRemove={() => handleRefImageRemove(slot)}
                      />
                    );
                  })}
                </div>
              </div>

            </>
          )}

          {error && <div className="text-[11px] text-destructive">{error}</div>}
        </div>
      </div>
    </div>
  );
}

function LocationSlotCard({
  slot,
  refImage,
  onUpload,
  onRemove,
}: {
  slot: string;
  refImage: ReferenceImage | undefined;
  onUpload: () => void;
  onRemove: () => void;
}) {
  const { url } = useAssetUrl(refImage?.assetHash, 'image', 'jpg');
  return (
    <button
      type="button"
      onClick={onUpload}
      className={cn(
        'rounded border p-1.5 text-center w-full cursor-pointer',
        refImage?.assetHash
          ? 'border-primary/50 bg-primary/5'
          : 'border-dashed border-border/70 hover:bg-muted/50',
      )}
    >
      {url ? (
        <div className="relative aspect-square mb-1 bg-muted rounded overflow-hidden">
          <img src={url} alt={slot} className="h-full w-full object-cover" />
          <div
            role="toolbar"
            className="absolute top-0 right-0 opacity-0 hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onRemove}
              className="rounded-bl bg-black/60 px-1 py-0.5 text-[9px] text-destructive hover:bg-black/80"
            >
              x
            </button>
          </div>
        </div>
      ) : (
        <Upload className="w-3 h-3 mx-auto mb-1 text-muted-foreground/40" />
      )}
      <div className="text-[9px] text-muted-foreground truncate">
        {localizeSlot(slot)}
      </div>
    </button>
  );
}