import { useCallback, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ChevronDown, Clapperboard, Eye, EyeOff, Plus, Search, Trash2, X } from 'lucide-react';
import type { PresetCategory, PresetDefinition, PresetTrack, PresetTrackEntry, ShotTemplate } from '@lucid-fin/contracts';
import type { RootState } from '../../store/index.js';
import {
  addCustomTemplate,
  removeCustomTemplate,
  toggleTemplateHidden,
  updateCustomTemplate,
  updateCustomTemplateTracks,
} from '../../store/slices/shotTemplates.js';
import { setActivePanel } from '../../store/slices/ui.js';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { localizePresetName, localizeShotTemplateName, localizeShotTemplateDescription } from '../../i18n.js';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/Dialog.js';

const CATEGORIES: PresetCategory[] = ['camera', 'lens', 'look', 'scene', 'composition', 'emotion', 'flow', 'technical'];

function createCustomTemplateId(): string {
  return `custom-tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEntryId(category: string): string {
  return `tmpl-entry-${category}-${Date.now()}`;
}

function getTrackEntries(template: ShotTemplate): Array<[string, PresetTrack]> {
  return Object.entries(template.tracks).filter((entry): entry is [string, PresetTrack] =>
    Boolean(entry[1]),
  );
}

function getPresetLabel(presetId: string, category: string, fallbackName?: string): string {
  if (fallbackName) return localizePresetName(fallbackName);
  const prefix = `builtin-${category}-`;
  const derivedName = presetId.startsWith(prefix) ? presetId.slice(prefix.length) : presetId;
  return localizePresetName(derivedName);
}

interface CategoryCellProps {
  templateId: string;
  category: PresetCategory;
  track: PresetTrack | undefined;
  presetsById: Record<string, PresetDefinition>;
  allPresets: PresetDefinition[];
  hiddenPresetIds: string[];
  onTracksChange: (tracks: ShotTemplate['tracks']) => void;
  currentTracks: ShotTemplate['tracks'];
}

function CategoryCell({ templateId, category, track, presetsById, allPresets, hiddenPresetIds, onTracksChange, currentTracks }: CategoryCellProps) {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState('');
  const categoryPresets = useMemo(
    () => allPresets.filter((p) => p.category === category && !hiddenPresetIds.includes(p.id)),
    [allPresets, category, hiddenPresetIds],
  );
  const filteredPresets = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return categoryPresets;
    return categoryPresets.filter((p) => localizePresetName(p.name).toLowerCase().includes(kw));
  }, [categoryPresets, search]);
  const entries = track?.entries ?? [];

  const addPreset = (presetId: string) => {
    const entry: PresetTrackEntry = {
      id: createEntryId(category),
      category,
      presetId,
      params: {},
      order: entries.length,
    };
    const newTrack: PresetTrack = {
      category,
      aiDecide: track?.aiDecide ?? false,
      entries: [...entries, entry],
    };
    onTracksChange({ ...currentTracks, [category]: newTrack });
    setModalOpen(false);
    setSearch('');
  };

  const removeEntry = (entryId: string) => {
    const newEntries = entries.filter((e) => e.id !== entryId);
    if (newEntries.length === 0) {
      const newTracks = { ...currentTracks };
      delete newTracks[category];
      onTracksChange(newTracks);
    } else {
      onTracksChange({ ...currentTracks, [category]: { ...track!, entries: newEntries } });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className={cn(
          'relative flex flex-col gap-1 rounded-md border text-left transition-colors hover:bg-muted/40 overflow-hidden p-2',
          entries.length > 0 ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-muted/10',
        )}
      >
        <div className="flex items-center justify-between gap-1 w-full">
          <span className="text-[10px] font-semibold truncate">{t('presetCategory.' + category)}</span>
          <Plus className="w-3 h-3 text-muted-foreground shrink-0" />
        </div>
        {entries.length > 0 ? (
          <div className="flex flex-wrap gap-0.5">
            {entries.slice(0, 2).map((e) => {
              const p = presetsById[e.presetId];
              return (
                <span key={e.id} className="rounded bg-primary/10 text-primary px-1 py-0.5 text-[9px] leading-none truncate max-w-full">
                  {getPresetLabel(e.presetId, category, p?.name)}
                </span>
              );
            })}
            {entries.length > 2 && (
              <span className="rounded bg-muted text-muted-foreground px-1 py-0.5 text-[9px] leading-none">+{entries.length - 2}</span>
            )}
          </div>
        ) : (
          <span className="text-[9px] text-muted-foreground/60 leading-none">{t('inspector.empty')}</span>
        )}
      </button>

      <Dialog open={modalOpen} onOpenChange={(v) => { setModalOpen(v); if (!v) setSearch(''); }}>
        <DialogContent className="max-w-sm max-h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('presetCategory.' + category)}</DialogTitle>
          </DialogHeader>

          {/* Current entries */}
          {entries.length > 0 && (
            <div className="space-y-1 border-b pb-3">
              {entries.map((entry) => {
                const preset = presetsById[entry.presetId];
                return (
                  <div key={entry.id} className="flex items-center justify-between rounded border border-border/60 bg-card px-2 py-1">
                    <span className="text-xs truncate">{getPresetLabel(entry.presetId, category, preset?.name)}</span>
                    <button onClick={() => removeEntry(entry.id)} className="ml-2 text-muted-foreground hover:text-destructive shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Search + picker */}
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-muted pl-7 pr-2 py-1.5 rounded text-xs"
              placeholder={t('inspector.searchPresets')}
            />
          </div>
          <div className="flex-1 overflow-auto space-y-0.5 min-h-0">
            {filteredPresets.map((p) => (
              <button
                key={p.id}
                onClick={() => addPreset(p.id)}
                className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted"
              >
                <div className="font-medium">{localizePresetName(p.name)}</div>
                {p.description && <div className="text-[10px] text-muted-foreground truncate">{p.description}</div>}
              </button>
            ))}
            {filteredPresets.length === 0 && (
              <div className="text-xs text-muted-foreground px-2 py-2">{t('inspector.noPresets')}</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ShotTemplateManagerPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const builtInTemplates = useSelector((state: RootState) => state.shotTemplates.builtIn);
  const customTemplates = useSelector((state: RootState) => state.shotTemplates.custom);
  const hiddenIds = useSelector((state: RootState) => state.shotTemplates.hiddenIds);
  const presetsById = useSelector((state: RootState) => state.presets.byId);
  const presetIds = useSelector((state: RootState) => state.presets.allIds);
  const hiddenPresetIds = useSelector((state: RootState) => state.presets.hiddenIds);
  const allPresets = useMemo(
    () => presetIds.map((id) => presetsById[id]).filter(Boolean),
    [presetIds, presetsById],
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const templates = useMemo(
    () => [...builtInTemplates, ...customTemplates],
    [builtInTemplates, customTemplates],
  );

  const handleAddTemplate = useCallback(() => {
    const template: ShotTemplate = {
      id: createCustomTemplateId(),
      name: `${t('shotTemplates.custom')} ${customTemplates.length + 1}`,
      description: '',
      builtIn: false,
      tracks: {},
      createdAt: Date.now(),
    };
    dispatch(addCustomTemplate(template));
    setExpandedId(template.id);
  }, [customTemplates.length, dispatch, t]);

  const handleDeleteTemplate = useCallback(
    (templateId: string) => {
      dispatch(removeCustomTemplate(templateId));
      setExpandedId((current) => (current === templateId ? null : current));
    },
    [dispatch],
  );

  const handleUpdateTemplate = useCallback(
    (templateId: string, changes: Partial<Pick<ShotTemplate, 'name' | 'description'>>) => {
      dispatch(updateCustomTemplate({ id: templateId, changes }));
    },
    [dispatch],
  );

  return (
    <div className="h-full border-r border-border/60 bg-card flex flex-col">
      <div className="px-3 py-2 border-b border-border/60">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold flex items-center gap-1">
            <Clapperboard className="w-3.5 h-3.5" />
            {t('shotTemplates.title')}
          </div>
          <button
            type="button"
            aria-label={t('commander.close')}
            onClick={() => dispatch(setActivePanel(null))}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-2">
        {templates.map((template) => {
          const expanded = expandedId === template.id;
          const isHidden = hiddenIds.includes(template.id);
          const trackEntries = getTrackEntries(template);

          return (
            <div
              key={template.id}
              className={cn(
                'rounded-md border transition-colors',
                expanded ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-card',
                isHidden && 'opacity-40',
              )}
            >
              <div className="flex items-start gap-1 pr-2">
                <button
                  type="button"
                  onClick={() => setExpandedId((current) => (current === template.id ? null : template.id))}
                  className="flex flex-1 items-start justify-between gap-3 px-3 py-2 text-left hover:bg-muted/30"
                  aria-expanded={expanded}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium truncate">
                        {template.builtIn ? localizeShotTemplateName(template.id, template.name) : template.name}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
                          template.builtIn ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
                        )}
                      >
                        {template.builtIn ? t('shotTemplates.builtIn') : t('shotTemplates.custom')}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground break-words">
                      {template.builtIn
                        ? localizeShotTemplateDescription(template.id, template.description)
                        : template.description || t('inspector.empty')}
                    </p>
                  </div>
                  <ChevronDown
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                      expanded && 'rotate-180',
                    )}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => dispatch(toggleTemplateHidden(template.id))}
                  className="mt-2 p-1 rounded hover:bg-muted text-muted-foreground"
                >
                  {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              {expanded ? (
                <div className="border-t border-border/60 px-2.5 py-2.5 space-y-2">
                  {/* Tracks — read-only for built-in, editable for custom */}
                  {template.builtIn ? (
                    <div className="space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t('inspector.presetTracks')}
                      </div>
                      {trackEntries.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                          {t('inspector.empty')}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {trackEntries.map(([category, track]) => (
                            <TrackSummary key={category} category={category} track={track} presetsById={presetsById} />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {t('inspector.presetTracks')}
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          {CATEGORIES.map((category) => (
                            <CategoryCell
                              key={category}
                              templateId={template.id}
                              category={category}
                              track={template.tracks[category]}
                              presetsById={presetsById}
                              allPresets={allPresets}
                              hiddenPresetIds={hiddenPresetIds}
                              currentTracks={template.tracks}
                              onTracksChange={(tracks) =>
                                dispatch(updateCustomTemplateTracks({ id: template.id, tracks }))
                              }
                            />
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {t('shotTemplates.editTemplate')}
                        </div>
                        <input
                          aria-label={t('presetManager.fields.name')}
                          value={template.name}
                          onChange={(event) => handleUpdateTemplate(template.id, { name: event.target.value })}
                          className="w-full rounded bg-muted px-2 py-1 text-xs"
                          placeholder={t('presetManager.fields.name')}
                        />
                        <textarea
                          aria-label={t('presetManager.fields.description')}
                          value={template.description}
                          onChange={(event) => handleUpdateTemplate(template.id, { description: event.target.value })}
                          className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[72px]"
                          placeholder={t('presetManager.fields.description')}
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleDeleteTemplate(template.id)}
                          aria-label={t('shotTemplates.deleteTemplate')}
                          className="inline-flex items-center gap-1 rounded-md border border-destructive/50 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                          {t('shotTemplates.deleteTemplate')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="border-t border-border/60 p-2">
        <button
          type="button"
          onClick={handleAddTemplate}
          className="flex w-full items-center justify-center gap-1 rounded-md border border-border/60 px-2 py-1.5 text-[11px] hover:bg-muted/80 transition-colors"
        >
          <Plus className="h-3 w-3" />
          {t('shotTemplates.addTemplate')}
        </button>
      </div>
    </div>
  );
}

interface TrackSummaryProps {
  category: string;
  track: PresetTrack;
  presetsById: Record<string, PresetDefinition>;
}

function TrackSummary({ category, track, presetsById }: TrackSummaryProps) {
  const { t } = useI18n();

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-2 py-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium">{t('presetCategory.' + category)}</span>
        {track.aiDecide ? (
          <span className="text-[10px] text-muted-foreground">{t('commander.aiDecide')}</span>
        ) : null}
      </div>
      <div className="space-y-1">
        {track.entries.map((entry) => {
          const preset = presetsById[entry.presetId];
          const label = getPresetLabel(entry.presetId, category, preset?.name);
          return (
            <div key={entry.id} className="rounded border border-border/60 bg-card px-2 py-1">
              <div className="text-[11px] font-medium break-all">{label}</div>
              <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                {entry.intensity != null ? <span>#{entry.intensity}</span> : null}
                {entry.durationMs != null ? <span>{entry.durationMs}ms</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
