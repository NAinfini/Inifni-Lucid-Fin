import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import {
  setCharacters,
  addCharacter,
  updateCharacter,
  removeCharacter,
  selectCharacter,
  setLoading,
  setCharacterRefImage,
  removeCharacterRefImage,
  setCharacterLoadout,
  removeCharacterLoadout,
} from '../../store/slices/characters.js';
import { useAssetUrl } from '../../hooks/useAssetUrl.js';
import { getAPI } from '../../utils/api.js';
import { cn } from '../../lib/utils.js';
import type {
  Character,
  ReferenceImage,
  EquipmentLoadout,
  CharacterGender,
} from '@lucid-fin/contracts';
import { Plus, Search, Trash2, Save, Upload, User } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';
import { t as translate } from '../../i18n.js';


const ROLE_OPTIONS: Character['role'][] = ['protagonist', 'antagonist', 'supporting', 'extra'];
const GENDER_OPTIONS: CharacterGender[] = ['male', 'female', 'non-binary', 'other'];

interface CharacterDraft {
  id: string;
  name: string;
  role: Character['role'];
  description: string;
  appearance: string;
  personality: string;
  tags: string;
  age: string;
  gender: CharacterGender | '';
  voice: string;
}

function createDraft(char: Character): CharacterDraft {
  return {
    id: char.id,
    name: char.name,
    role: char.role,
    description: char.description,
    appearance: char.appearance,
    personality: char.personality,
    tags: char.tags.join(', '),
    age: char.age != null ? String(char.age) : '',
    gender: char.gender ?? '',
    voice: char.voice ?? '',
  };
}

export function CharacterManagerPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const { items, selectedId, loading } = useSelector((s: RootState) => s.characters);
  const equipment = useSelector((s: RootState) => s.equipment.items);

  const [draft, setDraft] = useState<CharacterDraft | null>(null);
  const [originalDraft, setOriginalDraft] = useState<CharacterDraft | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadoutName, setLoadoutName] = useState('');

  const isDirty = useMemo(() => {
    if (!draft || !originalDraft) return false;
    return JSON.stringify(draft) !== JSON.stringify(originalDraft);
  }, [draft, originalDraft]);

  const selectedChar = useMemo(
    () => items.find((c) => c.id === selectedId),
    [items, selectedId],
  );

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((c) => {
      const blob = `${c.name} ${c.description} ${c.tags.join(' ')}`.toLowerCase();
      return blob.includes(keyword);
    });
  }, [items, search]);

  useEffect(() => {
    if (!selectedChar) {
      setDraft(null);
      setOriginalDraft(null);
      return;
    }
    const d = createDraft(selectedChar);
    setDraft(d);
    setOriginalDraft(d);
  }, [selectedChar]);

  const confirmDiscardIfDirty = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm(t('characterManager.unsavedChanges'));
  }, [isDirty, t]);

  const handleSelectCharacter = useCallback(
    (id: string) => {
      if (id === selectedId) return;
      if (!confirmDiscardIfDirty()) return;
      dispatch(selectCharacter(id));
    },
    [dispatch, selectedId, confirmDiscardIfDirty],
  );

  const loadCharacters = useCallback(async () => {
    dispatch(setLoading(true));
    try {
      const api = getAPI();
      if (api?.character) {
        const list = (await api.character.list()) as Character[];
        dispatch(setCharacters(list));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      dispatch(setLoading(false));
    }
  }, [dispatch]);

  useEffect(() => {
    void loadCharacters();
  }, [loadCharacters]);

  const createNewCharacter = useCallback(async () => {
    if (!confirmDiscardIfDirty()) return;
    setError(null);
    try {
      const api = getAPI();
      const data: Partial<Character> = {
        name: t('characterManager.newCharacter'),
        role: 'supporting',
        description: '',
        appearance: '',
        personality: '',
        tags: [],
        referenceImages: [],
        loadouts: [],
        defaultLoadoutId: '',
      };
      if (api?.character) {
        const saved = (await api.character.save(data as Record<string, unknown>)) as Character;
        dispatch(addCharacter(saved));
        dispatch(selectCharacter(saved.id));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [dispatch, confirmDiscardIfDirty, t]);

  const saveDraft = useCallback(async () => {
    if (!draft || !selectedChar) return;
    setError(null);
    try {
      const data: Partial<Character> = {
        id: draft.id,
        name: draft.name.trim(),
        role: draft.role,
        description: draft.description,
        appearance: draft.appearance,
        personality: draft.personality,
        tags: draft.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        age: draft.age ? Number(draft.age) : undefined,
        gender: draft.gender || undefined,
        voice: draft.voice || undefined,
      };
      const api = getAPI();
      if (api?.character) {
        const saved = (await api.character.save(data as Record<string, unknown>)) as Character;
        dispatch(updateCharacter({ id: saved.id, data: saved }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [dispatch, draft, selectedChar]);

  const deleteSelected = useCallback(async () => {
    if (!selectedChar) return;
    const ok = window.confirm(t('characterManager.deleteConfirm').replace('{name}', selectedChar.name));
    if (!ok) return;
    setError(null);
    try {
      const api = getAPI();
      if (api?.character) {
        await api.character.delete(selectedChar.id);
      }
      dispatch(removeCharacter(selectedChar.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [dispatch, selectedChar]);

  const handleRefImageUpload = useCallback(
    async (slot: string, isStandard: boolean) => {
      if (!selectedChar) return;
      setError(null);
      try {
        const api = getAPI();
        if (!api) return;
        const asset = (await api.asset.pickFile('image')) as { hash: string } | null;
        if (!asset) return;
        const refImage = (await api.character.setRefImage(
          selectedChar.id,
          slot,
          asset.hash,
          isStandard,
        )) as ReferenceImage;
        dispatch(setCharacterRefImage({ characterId: selectedChar.id, refImage }));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [dispatch, selectedChar],
  );

  const handleRefImageRemove = useCallback(
    async (slot: string) => {
      if (!selectedChar) return;
      setError(null);
      try {
        const api = getAPI();
        if (api?.character) {
          await api.character.removeRefImage(selectedChar.id, slot);
        }
        dispatch(removeCharacterRefImage({ characterId: selectedChar.id, slot }));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [dispatch, selectedChar],
  );

  const handleAddLoadout = useCallback(async () => {
    if (!selectedChar || !loadoutName.trim()) return;
    setError(null);
    try {
      const loadout: EquipmentLoadout = {
        id: '',
        name: loadoutName.trim(),
        equipmentIds: [],
      };
      const api = getAPI();
      if (api?.character) {
        const saved = (await api.character.saveLoadout(selectedChar.id, loadout)) as EquipmentLoadout;
        dispatch(setCharacterLoadout({ characterId: selectedChar.id, loadout: saved }));
      }
      setLoadoutName('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [dispatch, selectedChar, loadoutName]);

  const handleDeleteLoadout = useCallback(
    async (loadoutId: string) => {
      if (!selectedChar) return;
      setError(null);
      try {
        const api = getAPI();
        if (api?.character) {
          await api.character.deleteLoadout(selectedChar.id, loadoutId);
        }
        dispatch(removeCharacterLoadout({ characterId: selectedChar.id, loadoutId }));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [dispatch, selectedChar],
  );

  return (
    <div className="h-full border-r bg-card flex flex-col">
      <div className="px-3 py-2 border-b space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold flex items-center gap-1">
            <User className="w-3.5 h-3.5" />
            {t('characterManager.title')}
          </div>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('characterManager.search')}
            className="w-full rounded bg-muted pl-7 pr-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div className="grid grid-cols-[40%_60%] h-full min-h-0">
        <div className="border-r min-h-0 overflow-auto">
          <div className="p-1.5 border-b flex items-center gap-1">
            <button
              onClick={createNewCharacter}
              className="flex-1 text-[11px] rounded border border-border px-2 py-1 hover:bg-muted flex items-center justify-center gap-1"
            >
              <Plus className="w-3 h-3" />
              {t('characterManager.newCharacter')}
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
            <div className="text-xs text-muted-foreground p-3">{t('characterManager.loading')}</div>
          ) : (
            <div className="p-1.5 space-y-1">
              {filtered.map((char) => (
                <button
                  key={char.id}
                  onClick={() => handleSelectCharacter(char.id)}
                  className={cn(
                    'w-full text-left rounded border px-2 py-1.5 text-[11px]',
                    selectedId === char.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border/70 hover:bg-muted',
                  )}
                >
                  <div className="font-medium truncate">{char.name || t('characterManager.untitled')}</div>
                  <div className="text-[10px] text-muted-foreground">{t('characterManager.roles.' + char.role)}</div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="text-[11px] text-muted-foreground px-2 py-1.5">
                  {t('characterManager.noResults')}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-auto p-2 space-y-2">
          {!draft ? (
            <div className="text-xs text-muted-foreground">{t('characterManager.selectOrCreate')}</div>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('characterManager.fields.name')}
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
                    {t('characterManager.fields.role')}
                  </label>
                  <select
                    value={draft.role}
                    onChange={(e) =>
                      setDraft((p) =>
                        p ? { ...p, role: e.target.value as Character['role'] } : p,
                      )
                    }
                    className="w-full rounded bg-muted px-2 py-1 text-xs"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {t('characterManager.roles.' + r)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                    {t('characterManager.fields.gender')}
                  </label>
                  <select
                    value={draft.gender}
                    onChange={(e) =>
                      setDraft((p) =>
                        p ? { ...p, gender: e.target.value as CharacterGender | '' } : p,
                      )
                    }
                    className="w-full rounded bg-muted px-2 py-1 text-xs"
                  >
                    <option value="">--</option>
                    {GENDER_OPTIONS.map((g) => (
                      <option key={g} value={g}>
                        {t('characterManager.genders.' + g)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                    {t('characterManager.fields.age')}
                  </label>
                  <input
                    type="number"
                    value={draft.age}
                    onChange={(e) => setDraft((p) => (p ? { ...p, age: e.target.value } : p))}
                    className="w-full rounded bg-muted px-2 py-1 text-xs"
                    placeholder={t('characterManager.fields.age')}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                    {t('characterManager.fields.voice')}
                  </label>
                  <textarea
                    rows={4}
                    value={draft.voice}
                    onChange={(e) => setDraft((p) => (p ? { ...p, voice: e.target.value } : p))}
                    className="w-full rounded bg-muted px-2 py-1 text-xs resize-none"
                    placeholder={t('characterManager.fields.voice')}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('characterManager.fields.description')}
                </label>
                <textarea
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((p) => (p ? { ...p, description: e.target.value } : p))
                  }
                  className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[50px]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('characterManager.fields.appearance')}
                </label>
                <textarea
                  value={draft.appearance}
                  onChange={(e) =>
                    setDraft((p) => (p ? { ...p, appearance: e.target.value } : p))
                  }
                  className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[50px]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('characterManager.fields.personality')}
                </label>
                <textarea
                  value={draft.personality}
                  onChange={(e) =>
                    setDraft((p) => (p ? { ...p, personality: e.target.value } : p))
                  }
                  className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[50px]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('characterManager.fields.tags')}
                </label>
                <input
                  value={draft.tags}
                  onChange={(e) => setDraft((p) => (p ? { ...p, tags: e.target.value } : p))}
                  className="w-full rounded bg-muted px-2 py-1 text-xs"
                  placeholder={t('characterManager.fields.tags')}
                />
              </div>

              {/* Reference Image - Single large image */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('characterManager.referenceImages')}
                </label>
                <SingleReferenceImage
                  referenceImages={selectedChar?.referenceImages ?? []}
                  onUpload={() => handleRefImageUpload('main', true)}
                  onRemove={() => handleRefImageRemove('main')}
                />
              </div>

              {/* Equipment Loadouts */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('characterManager.loadouts')}
                </label>
                {selectedChar?.loadouts.map((loadout) => (
                  <div
                    key={loadout.id}
                    className="flex items-center justify-between rounded border border-border/70 px-2 py-1"
                  >
                    <div>
                      <span className="text-[10px] font-medium">{loadout.name}</span>
                      <span className="text-[9px] text-muted-foreground ml-1">
                      ({loadout.equipmentIds.length} {t('characterManager.items')})
                      </span>
                      {selectedChar.defaultLoadoutId === loadout.id && (
                        <span className="text-[9px] text-primary ml-1">({t('characterManager.default')})</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteLoadout(loadout.id)}
                      className="text-[10px] text-destructive hover:underline"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-1">
                  <input
                    value={loadoutName}
                    onChange={(e) => setLoadoutName(e.target.value)}
                    className="flex-1 rounded bg-muted px-2 py-1 text-[10px]"
                    placeholder={t('characterManager.loadoutNamePlaceholder')}
                  />
                  <button
                    onClick={handleAddLoadout}
                    disabled={!loadoutName.trim()}
                    className="text-[10px] rounded border border-border px-1.5 py-1 hover:bg-muted disabled:opacity-50"
                  >
                    {t('characterManager.addCustomSlot')}
                  </button>
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

function SingleReferenceImage({
  referenceImages,
  onUpload,
  onRemove,
}: {
  referenceImages: ReferenceImage[];
  onUpload: () => void;
  onRemove: () => void;
}) {
  const mainRef = referenceImages.find((r) => r.slot === 'main') || referenceImages[0];
  const { url } = useAssetUrl(mainRef?.assetHash, 'image', 'jpg');

  return (
    <button
      type="button"
      onClick={onUpload}
      className={cn(
        'rounded border w-full cursor-pointer relative',
        mainRef?.assetHash
          ? 'border-primary/50 bg-primary/5'
          : 'border-dashed border-border/70 hover:bg-muted/50',
      )}
    >
      {url ? (
        <div className="relative w-full h-[240px] bg-muted rounded overflow-hidden">
          <img src={url} alt="Reference" className="h-full w-full object-contain" />
          <div
            role="toolbar"
            className="absolute top-2 right-2 opacity-0 hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onRemove}
              className="rounded bg-black/60 px-2 py-1 text-xs text-destructive hover:bg-black/80"
            >
              ×
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-[240px] gap-2">
          <Upload className="w-8 h-8 text-muted-foreground/40" />
          <span className="text-xs text-muted-foreground">{translate('characterManager.upload')}</span>
        </div>
      )}
    </button>
  );
}
