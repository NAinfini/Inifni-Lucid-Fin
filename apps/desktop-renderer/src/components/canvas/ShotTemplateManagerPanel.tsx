import { useCallback, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ChevronDown, Clapperboard, Plus, Trash2, X } from 'lucide-react';
import type { PresetDefinition, PresetTrack, ShotTemplate } from '@lucid-fin/contracts';
import type { RootState } from '../../store/index.js';
import {
  addCustomTemplate,
  removeCustomTemplate,
  updateCustomTemplate,
} from '../../store/slices/shotTemplates.js';
import { setActivePanel } from '../../store/slices/ui.js';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { localizePresetName } from '../../i18n.js';

function createCustomTemplateId(): string {
  return `custom-tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

export function ShotTemplateManagerPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const builtInTemplates = useSelector((state: RootState) => state.shotTemplates.builtIn);
  const customTemplates = useSelector((state: RootState) => state.shotTemplates.custom);
  const presetsById = useSelector((state: RootState) => state.presets.byId);
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
    <div className="h-full border-r bg-card flex flex-col">
      <div className="px-3 py-2 border-b">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold flex items-center gap-1">
            <Clapperboard className="w-3.5 h-3.5" />
            {t('shotTemplates.title')}
          </div>
          <button
            type="button"
            aria-label={t('commander.close')}
            onClick={() => dispatch(setActivePanel(null))}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-2">
        {templates.map((template) => {
          const expanded = expandedId === template.id;
          const trackEntries = getTrackEntries(template);

          return (
            <div
              key={template.id}
              className={cn(
                'rounded-lg border transition-colors',
                expanded ? 'border-primary/40 bg-primary/5' : 'border-border/70 bg-card',
              )}
            >
              <button
                type="button"
                onClick={() =>
                  setExpandedId((current) => (current === template.id ? null : template.id))
                }
                className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-muted/30"
                aria-expanded={expanded}
                aria-label={template.name}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{template.name}</span>
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
                        template.builtIn
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-primary/10 text-primary',
                      )}
                    >
                      {template.builtIn ? t('shotTemplates.builtIn') : t('shotTemplates.custom')}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground break-words">
                    {template.description || t('inspector.empty')}
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                    expanded && 'rotate-180',
                  )}
                />
              </button>

              {expanded ? (
                <div className="border-t border-border/60 px-3 py-3 space-y-3">
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t('inspector.presetTracks')}
                    </div>
                    {trackEntries.length === 0 ? (
                      <div className="rounded border border-dashed border-border/70 px-2 py-1.5 text-[11px] text-muted-foreground">
                        {t('inspector.empty')}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {trackEntries.map(([category, track]) => (
                          <TrackSummary
                            key={category}
                            category={category}
                            track={track}
                            presetsById={presetsById}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {!template.builtIn ? (
                    <>
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {t('shotTemplates.editTemplate')}
                        </div>
                        <input
                          aria-label={t('presetManager.fields.name')}
                          value={template.name}
                          onChange={(event) =>
                            handleUpdateTemplate(template.id, { name: event.target.value })
                          }
                          className="w-full rounded bg-muted px-2 py-1 text-xs"
                          placeholder={t('presetManager.fields.name')}
                        />
                        <textarea
                          aria-label={t('presetManager.fields.description')}
                          value={template.description}
                          onChange={(event) =>
                            handleUpdateTemplate(template.id, {
                              description: event.target.value,
                            })
                          }
                          className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[72px]"
                          placeholder={t('presetManager.fields.description')}
                        />
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleDeleteTemplate(template.id)}
                          aria-label={t('shotTemplates.deleteTemplate')}
                          className="inline-flex items-center gap-1 rounded border border-destructive/50 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3 w-3" />
                          {t('shotTemplates.deleteTemplate')}
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="border-t p-2">
        <button
          type="button"
          onClick={handleAddTemplate}
          className="flex w-full items-center justify-center gap-1 rounded border border-border px-2 py-1.5 text-[11px] hover:bg-muted"
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
    <div className="rounded border border-border/70 bg-muted/20 px-2 py-2 space-y-1">
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
