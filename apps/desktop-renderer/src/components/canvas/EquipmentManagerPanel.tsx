import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import {
  setEquipment,
  addEquipment,
  updateEquipment,
  removeEquipment,
  selectEquipment,
  setFilterType,
  setLoading,
  setEquipmentRefImage,
  removeEquipmentRefImage,
} from '../../store/slices/equipment.js';
import { getAPI } from '../../utils/api.js';
import { cn } from '../../lib/utils.js';
import type { Equipment, EquipmentType, ReferenceImage } from '@lucid-fin/contracts';
import { useAssetUrl } from '../../hooks/useAssetUrl.js';
import { Plus, Search, Trash2, Save, Upload, Package } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';
import { localizeSlot } from '../../i18n.js';

const EQUIPMENT_STANDARD_SLOTS: readonly string[] = [
  'front',
  'back',
  'left-side',
  'right-side',
  'detail-closeup',
  'in-use',
];

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
  const { items, selectedId, filterType, loading } = useSelector((s: RootState) => s.equipment);

  const [draft, setDraft] = useState<EquipmentDraft | null>(null);
  const [originalDraft, setOriginalDraft] = useState<EquipmentDraft | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    if (!draft || !originalDraft) return false;
    return JSON.stringify(draft) !== JSON.stringify(originalDraft);
  }, [draft, originalDraft]);

  const selectedEquip = useMemo(
    () => items.find((e) => e.id === selectedId),
    [items, selectedId],
  );

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((e) => {
      if (filterType !== 'all' && e.type !== filterType) return false;
      if (!keyword) return true;
      const blob = `${e.name} ${e.description} ${e.tags.join(' ')}`.toLowerCase();
      return blob.includes(keyword);
    });
  }, [items, search, filterType]);

  useEffect(() => {
    if (!selectedEquip) {
      setDraft(null);
      setOriginalDraft(null);
      return;
    }
    const d = createDraft(selectedEquip);
    setDraft(d);
    setOriginalDraft(d);
  }, [selectedEquip]);

  const confirmDiscardIfDirty = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm(t('equipmentManager.unsavedChanges'));
  }, [isDirty, t]);

  const handleSelectEquipment = useCallback(
    (id: string) => {
      if (id === selectedId) return;
      if (!confirmDiscardIfDirty()) return;
      dispatch(selectEquipment(id));
    },
    [dispatch, selectedId, confirmDiscardIfDirty],
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
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      dispatch(setLoading(false));
    }
  }, [dispatch]);

  useEffect(() => {
    void loadEquipment();
  }, [loadEquipment]);

  const createNewEquipment = useCallback(async () => {
    if (!confirmDiscardIfDirty()) return;
    setError(null);
    try {
      const api = getAPI();
      const data: Partial<Equipment> = {
        name: t('equipmentManager.newEquipment'),
        type: 'other',
        description: '',
        tags: [],
        referenceImages: [],
      };
      if (api?.equipment) {
        const saved = (await api.equipment.save(data as Record<string, unknown>)) as Equipment;
        dispatch(addEquipment(saved));
        dispatch(selectEquipment(saved.id));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [dispatch, confirmDiscardIfDirty, t]);

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
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [dispatch, draft, selectedEquip]);

  const deleteSelected = useCallback(async () => {
    if (!selectedEquip) return;
    const ok = window.confirm(t('equipmentManager.deleteConfirm').replace('{name}', selectedEquip.name));
    if (!ok) return;
    setError(null);
    try {
      const api = getAPI();
      if (api?.equipment) {
        await api.equipment.delete(selectedEquip.id);
      }
      dispatch(removeEquipment(selectedEquip.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [dispatch, selectedEquip]);

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
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [dispatch, selectedEquip],
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
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [dispatch, selectedEquip],
  );

  const refImageBySlot = useMemo(() => {
    if (!selectedEquip) return {};
    const map: Record<string, ReferenceImage> = {};
    for (const ref of selectedEquip.referenceImages) {
      map[ref.slot] = ref;
    }
    return map;
  }, [selectedEquip]);

  return (
    <div className="h-full border-r bg-card flex flex-col">
      <div className="px-3 py-2 border-b space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold flex items-center gap-1">
            <Package className="w-3.5 h-3.5" />
            {t('equipmentManager.title')}
          </div>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('equipmentManager.search')}
            className="w-full rounded bg-muted pl-7 pr-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={filterType}
          onChange={(e) => dispatch(setFilterType(e.target.value as EquipmentType | 'all'))}
          className="w-full rounded bg-muted px-2 py-1.5 text-xs"
        >
          <option value="all">{t('equipmentManager.allTypes')}</option>
          {TYPE_OPTIONS.map((tp) => (
            <option key={tp} value={tp}>
              {t('equipmentManager.types.' + tp)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-[40%_60%] h-full min-h-0">
        <div className="border-r min-h-0 overflow-auto">
          <div className="p-1.5 border-b flex items-center gap-1">
            <button
              onClick={createNewEquipment}
              className="flex-1 text-[11px] rounded border border-border px-2 py-1 hover:bg-muted flex items-center justify-center gap-1"
            >
              <Plus className="w-3 h-3" />
              {t('equipmentManager.newEquipment')}
            </button>
            {draft && (
              <>
                <button
                  onClick={saveDraft}
                  disabled={!isDirty}
                  className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-1 text-[11px] hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                  title={t('action.save')}
                >
                  <Save className="w-3 h-3" />
                </button>
                <button
                  onClick={deleteSelected}
                  className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-1 text-[11px] hover:bg-destructive/20"
                  title={t('action.delete')}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
          {loading ? (
            <div className="text-xs text-muted-foreground p-3">{t('equipmentManager.loading')}</div>
          ) : (
            <div className="p-1.5 space-y-1">
              {filtered.map((equip) => (
                <button
                  key={equip.id}
                  onClick={() => handleSelectEquipment(equip.id)}
                  className={cn(
                    'w-full text-left rounded border px-2 py-1.5 text-[11px]',
                    selectedId === equip.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border/70 hover:bg-muted',
                  )}
                >
                  <div className="font-medium truncate">{equip.name || t('equipmentManager.untitled')}</div>
                  <div className="text-[10px] text-muted-foreground">{t('equipmentManager.types.' + equip.type)}</div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="text-[11px] text-muted-foreground px-2 py-1.5">
                  {t('equipmentManager.noResults')}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-auto p-2 space-y-2">
          {!draft ? (
            <div className="text-xs text-muted-foreground">{t('equipmentManager.selectOrCreate')}</div>
          ) : (
            <>
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
                      setDraft((p) =>
                        p ? { ...p, type: e.target.value as EquipmentType } : p,
                      )
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
                    onChange={(e) =>
                      setDraft((p) => (p ? { ...p, subtype: e.target.value } : p))
                    }
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
                  onChange={(e) =>
                    setDraft((p) => (p ? { ...p, description: e.target.value } : p))
                  }
                  className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[60px]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('equipmentManager.fields.function')}
                </label>
                <textarea
                  value={draft.functionDesc}
                  onChange={(e) =>
                    setDraft((p) => (p ? { ...p, functionDesc: e.target.value } : p))
                  }
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

              {/* Reference Images */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('equipmentManager.referenceImages')}
                </label>
                <div className="grid grid-cols-3 gap-1">
                  {EQUIPMENT_STANDARD_SLOTS.map((slot) => {
                    const ref = refImageBySlot[slot];
                    return (
                      <EquipmentSlotCard
                        key={slot}
                        slot={slot}
                        refImage={ref}
                        onUpload={() => handleRefImageUpload(slot, true)}
                        onRemove={() => handleRefImageRemove(slot)}
                      />
                    );
                  })}
                </div>
                {EQUIPMENT_STANDARD_SLOTS.some((s) => !refImageBySlot[s]?.assetHash) && (
                  <div className="text-[9px] text-amber-500">
                    {t('equipmentManager.warningMissingSlots')}
                  </div>
                )}
              </div>

            </>
          )}

          {error && <div className="text-[11px] text-destructive">{error}</div>}
        </div>
      </div>
    </div>
  );
}

function EquipmentSlotCard({
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
