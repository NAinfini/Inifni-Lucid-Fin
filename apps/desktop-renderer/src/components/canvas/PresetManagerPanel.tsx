import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import {
  removePreset,
  selectManagerPreset,
  setPresets,
  setPresetsCategoryFilter,
  setPresetsLoading,
  setPresetsSearch,
  upsertPreset,
} from '../../store/slices/presets.js';
import { getAPI } from '../../utils/api.js';
import { cn } from '../../lib/utils.js';
import type {
  PresetCategory,
  PresetDefinition,
  PresetLibraryExportPayload,
  PresetLibraryImportPayload,
  PresetParamDefinition,
  PresetParamMap,
  PresetResetScope,
} from '@lucid-fin/contracts';
import { Download, Search, Upload, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';
import { localizePresetName } from '../../i18n.js';

function parseIntensityFromDefaults(defaultsText: string): number {
  try {
    const parsed = JSON.parse(defaultsText) as Record<string, unknown>;
    if (typeof parsed.intensity === 'number') return Math.round(parsed.intensity);
  } catch { /* invalid JSON — return fallback */ }
  return 50;
}

function updateIntensityInDefaults(defaultsText: string, intensity: number): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(defaultsText) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      parsed = {};
    }
  } catch {
    parsed = {};
  }
  parsed.intensity = intensity;
  return JSON.stringify(parsed, null, 2);
}

const CATEGORY_FALLBACK: PresetCategory[] = [
  'camera',
  'lens',
  'look',
  'scene',
  'composition',
  'emotion',
  'flow',
  'technical',
];

interface PresetDraft {
  id: string;
  name: string;
  category: PresetCategory;
  description: string;
  prompt: string;
  defaultsText: string;
  builtIn: boolean;
  modified: boolean;
  params: PresetParamDefinition[];
}

function cloneParamDefinitions(params: PresetParamDefinition[]): PresetParamDefinition[] {
  return params.map((param) => ({
    ...param,
    options: param.options ? [...param.options] : undefined,
  }));
}

function clonePresetMap(map: PresetParamMap): PresetParamMap {
  return { ...map };
}

function createDraft(preset: PresetDefinition): PresetDraft {
  return {
    id: preset.id,
    name: preset.name,
    category: preset.category,
    description: preset.description,
    prompt: preset.prompt,
    defaultsText: JSON.stringify(preset.defaults ?? {}, null, 2),
    builtIn: preset.builtIn,
    modified: preset.modified,
    params: cloneParamDefinitions(preset.params ?? []),
  };
}

function parseDefaults(defaultsText: string): PresetParamMap {
  if (!defaultsText.trim()) return {};
  const parsed = JSON.parse(defaultsText) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Defaults must be a JSON object');
  }
  const output: PresetParamMap = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      output[key] = value;
      continue;
    }
    throw new Error(`Default "${key}" must be string/number/boolean`);
  }
  return output;
}

function createCustomPresetId(category: PresetCategory): string {
  return `user-${category}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function templateForCategory(
  category: PresetCategory,
  presets: PresetDefinition[],
): {
  params: PresetParamDefinition[];
  defaults: PresetParamMap;
} {
  const template = presets.find((preset) => preset.category === category);
  return {
    params: template ? cloneParamDefinitions(template.params ?? []) : [],
    defaults: template ? clonePresetMap(template.defaults ?? {}) : {},
  };
}

function toImportPayload(input: unknown): PresetLibraryImportPayload {
  if (Array.isArray(input)) {
    return { presets: input as PresetDefinition[] };
  }
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid preset import payload');
  }
  const payload = input as Partial<PresetLibraryImportPayload>;
  if (!Array.isArray(payload.presets)) {
    throw new Error('Invalid preset import payload');
  }
  return {
    presets: payload.presets as PresetDefinition[],
    includeBuiltIn: payload.includeBuiltIn,
    source: payload.source,
  };
}

export function PresetManagerPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const { byId, allIds, loading, search, selectedCategory, managerSelectedPresetId } = useSelector(
    (s: RootState) => s.presets,
  );
  const presets = useMemo(() => allIds.map((id) => byId[id]).filter(Boolean), [allIds, byId]);
  const categories = useMemo(() => {
    const fromData = Array.from(new Set(presets.map((preset) => preset.category)));
    return (fromData.length > 0 ? fromData : CATEGORY_FALLBACK) as PresetCategory[];
  }, [presets]);

  const [draft, setDraft] = useState<PresetDraft | null>(null);
  const [originalDraft, setOriginalDraft] = useState<PresetDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetScope, setResetScope] = useState<PresetResetScope>('all');

  const isDirty = useMemo(() => {
    if (!draft || !originalDraft) return false;
    return JSON.stringify(draft) !== JSON.stringify(originalDraft);
  }, [draft, originalDraft]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return presets.filter((preset) => {
      if (selectedCategory !== 'all' && preset.category !== selectedCategory) return false;
      if (!keyword) return true;
      const localized = localizePresetName(preset.name);
      const blob = `${preset.name} ${localized} ${preset.description} ${preset.prompt}`.toLowerCase();
      return blob.includes(keyword);
    });
  }, [presets, search, selectedCategory]);

  const selectedPreset = managerSelectedPresetId ? byId[managerSelectedPresetId] : null;

  useEffect(() => {
    if (!selectedPreset) {
      setDraft(null);
      setOriginalDraft(null);
      return;
    }
    const d = createDraft(selectedPreset);
    setDraft(d);
    setOriginalDraft(d);
  }, [selectedPreset]);

  const confirmDiscardIfDirty = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm(t('presetManager.unsavedChanges'));
  }, [isDirty, t]);

  const loadPresets = useCallback(async () => {
    dispatch(setPresetsLoading(true));
    try {
      const api = getAPI();
      if (api?.preset) {
        const library = await api.preset.list();
        dispatch(setPresets(library));
        if (library.length > 0 && !managerSelectedPresetId) {
          dispatch(selectManagerPreset(library[0].id));
        }
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
    } finally {
      dispatch(setPresetsLoading(false));
    }
  }, [dispatch, managerSelectedPresetId]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    setError(null);
    try {
      const defaults = parseDefaults(draft.defaultsText);
      const existing = selectedPreset;

      const nextPreset: PresetDefinition = {
        id: draft.id,
        name: draft.name.trim(),
        category: draft.category,
        description: draft.description.trim(),
        prompt: draft.prompt,
        builtIn: draft.builtIn,
        modified: draft.builtIn ? true : draft.modified,
        defaultPrompt: existing?.defaultPrompt,
        defaultParams: existing?.defaultParams,
        params: cloneParamDefinitions(draft.params),
        defaults,
        projectId: existing?.projectId,
        createdAt: existing?.createdAt,
        updatedAt: existing?.updatedAt,
      };

      const api = getAPI();
      if (api?.preset) {
        const saved = await api.preset.save(nextPreset);
        dispatch(upsertPreset(saved));
        dispatch(selectManagerPreset(saved.id));
        setOriginalDraft(createDraft(saved));
      } else {
        dispatch(upsertPreset(nextPreset));
        setOriginalDraft(createDraft(nextPreset));
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
    }
  }, [dispatch, draft, selectedPreset]);

  const createCustomPreset = useCallback(() => {
    if (!confirmDiscardIfDirty()) return;
    const defaultCategory = categories[0] ?? 'camera';
    const template = templateForCategory(defaultCategory, presets);
    const next: PresetDefinition = {
      id: createCustomPresetId(defaultCategory),
      name: 'New Preset',
      category: defaultCategory,
      description: '',
      prompt: '',
      builtIn: false,
      modified: false,
      params: template.params,
      defaults: template.defaults,
    };
    dispatch(upsertPreset(next));
    dispatch(selectManagerPreset(next.id));
  }, [categories, confirmDiscardIfDirty, dispatch, presets]);

  const deleteCurrentPreset = useCallback(async () => {
    if (!selectedPreset) return;
    const ok = window.confirm(t('presetManager.deleteConfirm').replace('{name}', selectedPreset.name));
    if (!ok) return;
    setError(null);
    try {
      const api = getAPI();
      if (api?.preset) {
        await api.preset.delete(selectedPreset.id);
      }
      dispatch(removePreset(selectedPreset.id));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
    }
  }, [dispatch, selectedPreset]);

  const resetCurrentPreset = useCallback(async () => {
    if (!selectedPreset) return;
    setError(null);
    try {
      const api = getAPI();
      if (api?.preset) {
        const resetPreset = await api.preset.reset({ id: selectedPreset.id, scope: resetScope });
        dispatch(upsertPreset(resetPreset));
      } else {
        await loadPresets();
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
    }
  }, [dispatch, loadPresets, resetScope, selectedPreset]);

  const exportPresets = useCallback(async () => {
    setError(null);
    try {
      const api = getAPI();
      const payload: PresetLibraryExportPayload = api?.preset
        ? await api.preset.export()
        : { version: 1, exportedAt: Date.now(), presets };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `lucid-presets-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
    }
  }, [presets]);

  const importPresets = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const payload = toImportPayload(parsed);

        const api = getAPI();
        if (api?.preset) {
          const result = await api.preset.import(payload);
          dispatch(setPresets(result.presets));
          return;
        }

        dispatch(setPresets(payload.presets));
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
      }
    },
    [dispatch],
  );

  return (
    <div className="h-full border-r bg-card flex flex-col">
      <div className="px-3 py-2 border-b space-y-2">
        <div className="text-xs font-semibold">{t('presetManager.title')}</div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => dispatch(setPresetsSearch(event.target.value))}
            placeholder={t('presetManager.search')}
            className="w-full rounded bg-muted pl-7 pr-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(event) =>
            dispatch(setPresetsCategoryFilter(event.target.value as PresetCategory | 'all'))
          }
          className="w-full rounded bg-muted px-2 py-1.5 text-xs"
        >
          <option value="all">{t('presetManager.allCategories')}</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {t('presetCategory.' + category)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-[44%_56%] h-full min-h-0">
        <div className="border-r min-h-0 overflow-auto">
          <div className="p-1.5 border-b flex items-center gap-1">
            <button
              onClick={createCustomPreset}
              className="flex-1 text-[11px] rounded border border-border px-2 py-1 hover:bg-muted"
            >
              {t('presetManager.newPreset')}
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
                {!draft.builtIn && (
                  <button
                    onClick={deleteCurrentPreset}
                    className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-1 text-[11px] hover:bg-destructive/20"
                    title={t('action.delete')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </>
            )}
          </div>
          {loading ? (
            <div className="text-xs text-muted-foreground p-3">{t('presetManager.loading')}</div>
          ) : (
            <div className="p-1.5 space-y-1">
              {filtered.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => {
                    if (preset.id === managerSelectedPresetId) return;
                    if (!confirmDiscardIfDirty()) return;
                    dispatch(selectManagerPreset(preset.id));
                  }}
                  className={cn(
                    'w-full text-left rounded border px-2 py-1.5 text-[11px]',
                    managerSelectedPresetId === preset.id
                      ? 'border-primary bg-primary/10'
                      : 'border-border/70 hover:bg-muted',
                  )}
                >
                  <div className="font-medium truncate">{localizePresetName(preset.name)}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {t('presetCategory.' + preset.category)}
                  </div>
                  {preset.builtIn && (
                    <div className="text-[10px] text-muted-foreground">
                      {preset.modified ? t('presetManager.builtInModified') : t('presetManager.builtIn')}
                    </div>
                  )}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="text-[11px] text-muted-foreground px-2 py-1.5">{t('presetManager.noResults')}</div>
              )}
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-auto p-2 space-y-2">
          {!draft ? (
            <div className="text-xs text-muted-foreground">{t('presetManager.selectToEdit')}</div>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('presetManager.fields.name')}
                </label>
                <input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((prev) => (prev ? { ...prev, name: event.target.value } : prev))
                  }
                  className="w-full rounded bg-muted px-2 py-1 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('presetManager.defaultIntensity')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={parseIntensityFromDefaults(draft.defaultsText)}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      setDraft((prev) =>
                        prev
                          ? { ...prev, defaultsText: updateIntensityInDefaults(prev.defaultsText, value) }
                          : prev,
                      );
                    }}
                    className="flex-1 h-1.5 accent-primary"
                  />
                  <span className="text-xs tabular-nums w-8 text-right text-muted-foreground">
                    {parseIntensityFromDefaults(draft.defaultsText)}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('presetManager.fields.category')}
                </label>
                <select
                  value={draft.category}
                  disabled={draft.builtIn}
                  onChange={(event) => {
                    const nextCategory = event.target.value as PresetCategory;
                    const template = templateForCategory(nextCategory, presets);
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            category: nextCategory,
                            params: template.params,
                            defaultsText: JSON.stringify(template.defaults, null, 2),
                          }
                        : prev,
                    );
                  }}
                  className="w-full rounded bg-muted px-2 py-1 text-xs disabled:opacity-70"
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {t('presetCategory.' + category)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('presetManager.fields.description')}
                </label>
                <textarea
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                  }
                  className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[60px]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('presetManager.fields.prompt')}
                </label>
                <textarea
                  value={draft.prompt}
                  onChange={(event) =>
                    setDraft((prev) => (prev ? { ...prev, prompt: event.target.value } : prev))
                  }
                  className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[90px]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('presetManager.fields.defaults')}
                </label>
                <textarea
                  value={draft.defaultsText}
                  onChange={(event) =>
                    setDraft((prev) => (prev ? { ...prev, defaultsText: event.target.value } : prev))
                  }
                  className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[90px] font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  {t('presetManager.fields.paramSchema')}
                </label>
                <div className="rounded border border-border/70 bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
                  {draft.params.length > 0
                    ? draft.params.map((param) => `${param.key} (${param.type})`).join(', ')
                    : t('presetManager.noParamSchema')}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {draft.builtIn && (
                  <>
                    <select
                      value={resetScope}
                      onChange={(event) => setResetScope(event.target.value as PresetResetScope)}
                      className="rounded bg-muted px-2 py-1 text-[11px]"
                    >
                      <option value="all">{t('presetManager.resetAll')}</option>
                      <option value="prompt">{t('presetManager.resetPrompt')}</option>
                      <option value="params">{t('presetManager.resetParams')}</option>
                    </select>
                    <button
                      onClick={resetCurrentPreset}
                      className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
                    >
                      <RotateCcw className="w-3 h-3" />
                      {t('presetManager.reset')}
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          <div className="pt-2 mt-2 border-t space-y-1.5">
            <div className="flex items-center gap-1.5">
              <button
                onClick={exportPresets}
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted"
              >
                <Download className="w-3 h-3" />
                {t('presetManager.exportJson')}
              </button>
              <label className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted cursor-pointer">
                <Upload className="w-3 h-3" />
                {t('presetManager.importJson')}
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void importPresets(file);
                    }
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
            {error && <div className="text-[11px] text-destructive">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
