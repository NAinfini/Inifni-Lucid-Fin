import { useCallback, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { ChevronDown, ChevronUp, Plus, Search, Settings2, Trash2 } from 'lucide-react';
import {
  addNodePresetTrackEntry,
  moveNodePresetTrackEntry,
  removeNodePresetTrackEntry,
  updateNodePresetTrackEntry,
} from '../../store/slices/canvas.js';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { localizePresetName } from '../../i18n.js';
import type {
  PresetCategory,
  PresetDefinition,
  PresetPromptParamDef,
  PresetTrack,
  PresetTrackEntry,
} from '@lucid-fin/contracts';

interface InspectorTrackEditorProps {
  nodeId: string;
  category: PresetCategory;
  presets: PresetDefinition[];
  presetById: Record<string, PresetDefinition>;
  track: PresetTrack;
}

function createEntryId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Resolves the nearest intensity level label for a given slider value. */
function resolveIntensityLabel(
  levels: Partial<Record<0 | 25 | 50 | 75 | 100, string>>,
  value: number,
): string {
  const thresholds = [0, 25, 50, 75, 100] as const;
  let best = '';
  for (const t of thresholds) {
    if (levels[t] && t <= value) best = levels[t]!;
  }
  return best || '';
}

function PresetParamControl({
  paramDef,
  value,
  onChange,
}: {
  paramDef: PresetPromptParamDef;
  value: number | string | undefined;
  onChange: (key: string, val: number | string) => void;
}) {
  if (paramDef.type === 'intensity') {
    const numValue = typeof value === 'number' ? value : paramDef.default as number;
    const label = paramDef.levels ? resolveIntensityLabel(paramDef.levels, numValue) : '';
    return (
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] text-muted-foreground">{paramDef.label}</span>
          <span className="text-[10px] tabular-nums text-foreground">{numValue}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={numValue}
          onChange={(e) => onChange(paramDef.key, Number(e.target.value))}
          className="h-1 w-full cursor-pointer accent-primary"
        />
        {label ? (
          <div className="truncate text-[9px] text-muted-foreground/70">{label}</div>
        ) : null}
      </div>
    );
  }

  if (paramDef.type === 'select' && paramDef.options) {
    const strValue = typeof value === 'string' ? value : paramDef.default as string;
    return (
      <div className="space-y-0.5">
        <span className="text-[10px] text-muted-foreground">{paramDef.label}</span>
        <select
          value={strValue}
          onChange={(e) => onChange(paramDef.key, e.target.value)}
          className="w-full rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {paramDef.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (paramDef.type === 'number') {
    const numValue = typeof value === 'number' ? value : paramDef.default as number;
    return (
      <div className="space-y-0.5">
        <span className="text-[10px] text-muted-foreground">{paramDef.label}</span>
        <input
          type="number"
          min={paramDef.min}
          max={paramDef.max}
          value={numValue}
          onChange={(e) => onChange(paramDef.key, Number(e.target.value))}
          className="w-full rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
    );
  }

  return null;
}

export function InspectorTrackEditor({
  nodeId,
  category,
  presets,
  presetById,
  track,
}: InspectorTrackEditorProps) {
  const dispatch = useDispatch();
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  const filteredPresets = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return presets;

    return presets.filter((preset) => {
      const localized = localizePresetName(preset.name);
      const text = `${preset.name} ${localized} ${preset.description}`.toLowerCase();
      return text.includes(keyword);
    });
  }, [presets, search]);

  const addPreset = useCallback(
    (presetId: string) => {
      dispatch(
        addNodePresetTrackEntry({
          id: nodeId,
          category,
          entry: {
            id: createEntryId('entry'),
            category,
            presetId,
            params: {},
            order: track.entries.length,
          },
        }),
      );
      setPickerOpen(false);
      setSearch('');
    },
    [category, dispatch, nodeId, track.entries.length],
  );

  const toggleExpanded = useCallback((entryId: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  const handleParamChange = useCallback(
    (entry: PresetTrackEntry, key: string, value: number | string) => {
      dispatch(
        updateNodePresetTrackEntry({
          id: nodeId,
          category,
          entryId: entry.id,
          changes: { params: { ...entry.params, [key]: value } },
        }),
      );
    },
    [category, dispatch, nodeId],
  );

  return (
    <div className="rounded-md border border-border/60 bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-2.5 py-1.5">
        <span className="text-[11px] font-semibold text-foreground">
          {t('presetCategory.' + category)}
        </span>
      </div>

      <div className="space-y-1.5 p-2.5">
        {track.entries.map((entry, index) => {
          const preset = presetById[entry.presetId];
          const paramDefs = preset?.promptParamDefs;
          const hasParams = paramDefs && paramDefs.length > 0;
          const isExpanded = expandedEntries.has(entry.id);

          return (
            <div
              key={entry.id}
              className="rounded-md border border-border/60 bg-card/50 px-2.5 py-1.5"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate text-[11px] font-medium text-foreground">
                  {preset ? localizePresetName(preset.name) : entry.presetId}
                </span>
                <div className="flex items-center gap-1">
                  {hasParams ? (
                    <button
                      type="button"
                      className={cn(
                        'rounded-md border border-border/60 px-1.5 py-0.5 text-[11px] transition-colors hover:bg-muted',
                        isExpanded && 'bg-primary/10 border-primary/30',
                      )}
                      onClick={() => toggleExpanded(entry.id)}
                      aria-label="Toggle parameters"
                    >
                      <Settings2 className="h-3 w-3" />
                    </button>
                  ) : null}
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={entry.durationMs != null ? entry.durationMs / 1000 : ''}
                    onChange={(event) =>
                      dispatch(
                        updateNodePresetTrackEntry({
                          id: nodeId,
                          category,
                          entryId: entry.id,
                          changes: {
                            durationMs:
                              event.target.value === ''
                                ? undefined
                                : Math.round(Number(event.target.value) * 1000),
                          },
                        }),
                      )
                    }
                    className="w-14 rounded-md bg-muted px-1.5 py-0.5 text-[11px]"
                    placeholder={t('inspector.seconds')}
                  />
                  <button
                    type="button"
                    className="rounded-md border border-border/60 px-1.5 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
                    onClick={() =>
                      dispatch(
                        moveNodePresetTrackEntry({
                          id: nodeId,
                          category,
                          entryId: entry.id,
                          direction: 'up',
                        }),
                      )
                    }
                    disabled={index === 0}
                    aria-label={t('common.moveUp')}
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border/60 px-1.5 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
                    onClick={() =>
                      dispatch(
                        moveNodePresetTrackEntry({
                          id: nodeId,
                          category,
                          entryId: entry.id,
                          direction: 'down',
                        }),
                      )
                    }
                    disabled={index === track.entries.length - 1}
                    aria-label={t('common.moveDown')}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border/60 px-1.5 py-0.5 text-[11px] hover:bg-destructive/20 hover:text-destructive disabled:opacity-50"
                    onClick={() =>
                      dispatch(
                        removeNodePresetTrackEntry({
                          id: nodeId,
                          category,
                          entryId: entry.id,
                        }),
                      )
                    }
                    aria-label={t('common.delete')}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {hasParams && isExpanded ? (
                <div className="mt-2 space-y-2 border-t border-border/40 pt-2">
                  {paramDefs.map((pd) => {
                    const raw = entry.params[pd.key];
                    const val = typeof raw === 'boolean' ? undefined : raw;
                    return (
                      <PresetParamControl
                        key={pd.key}
                        paramDef={pd}
                        value={val}
                        onChange={(key, v) => handleParamChange(entry, key, v)}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="space-y-1.5 pt-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1.5 text-[11px] transition-colors hover:bg-muted disabled:opacity-50"
              onClick={() => setPickerOpen((value) => !value)}
            >
              <Plus className="h-3 w-3" />
              {t('inspector.addPreset')}
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>

          {pickerOpen ? (
            <div className="space-y-1.5 rounded-md border border-border/60 bg-card p-2.5">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full rounded-md bg-muted py-1.5 pl-8 pr-2.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder={t('inspector.searchPresets')}
                />
              </div>
              <div className="max-h-56 space-y-1 overflow-auto">
                {filteredPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => addPreset(preset.id)}
                    className="w-full rounded-md border border-border/60 px-2.5 py-1.5 text-left text-[11px] transition-colors hover:border-primary hover:bg-primary/5"
                  >
                    <div className="font-medium text-foreground">
                      {localizePresetName(preset.name)}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {preset.description}
                    </div>
                  </button>
                ))}
                {filteredPresets.length === 0 ? (
                  <div className="py-3 text-center text-[11px] text-muted-foreground">
                    {t('inspector.noPresets')}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
