import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IpcProcessPrompt } from '@lucid-fin/contracts';
import { ChevronDown, ChevronRight, RotateCcw, Save, SquarePen } from 'lucide-react';
import {
  localizeProcessPromptDescription,
  localizeProcessPromptName,
  localizeToolName,
  t,
} from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import { getAPI, type LucidAPI } from '../../utils/api.js';
import {
  getProcessPromptTriggerNote,
  getProcessPromptTriggerTools,
} from './processPromptTriggers.js';

type ProcessPromptApi = Pick<LucidAPI['processPrompt'], 'list' | 'setCustom' | 'reset'>;

const PROCESS_PROMPT_API_RETRY_LIMIT = 8;
const PROCESS_PROMPT_API_RETRY_MS = 250;

interface ProcessGuideGroup {
  groupKey: string;
  labelI18nKey: string;
  keys: string[];
}

export const PROCESS_GUIDE_GROUPS: ProcessGuideGroup[] = [
  {
    groupKey: 'generation',
    labelI18nKey: 'settings.processGuides.group.generation',
    keys: [
      'entity-ref-image-generation',
      'image-node-generation',
      'video-node-generation',
      'audio-generation',
    ],
  },
  {
    groupKey: 'canvas',
    labelI18nKey: 'settings.processGuides.group.canvas',
    keys: ['canvas-structure', 'canvas-graph-and-layout', 'canvas-node-editing', 'canvas-settings'],
  },
  {
    groupKey: 'entities',
    labelI18nKey: 'settings.processGuides.group.entities',
    keys: ['entity-management', 'node-preset-tracks'],
  },
  {
    groupKey: 'configuration',
    labelI18nKey: 'settings.processGuides.group.configuration',
    keys: ['media-config', 'provider-management', 'node-provider-selection'],
  },
  {
    groupKey: 'workflow',
    labelI18nKey: 'settings.processGuides.group.workflow',
    keys: [
      'script-development',
      'workflow-orchestration',
      'render-and-export',
      'job-control',
      'vision-analysis',
    ],
  },
  {
    groupKey: 'content',
    labelI18nKey: 'settings.processGuides.group.content',
    keys: [
      'preset-definition-management',
      'shot-template-management',
      'color-style-management',
      'series-management',
      'prompt-template-management',
      'asset-library-management',
    ],
  },
  {
    groupKey: 'qualityGates',
    labelI18nKey: 'settings.processGuides.group.qualityGates',
    keys: [
      'style-plate-lock',
      'entities-before-generation',
      'batch-create-guidance',
      'prompt-quality-gate',
      'story-workflow-phase',
      'snapshot-and-rollback',
    ],
  },
];

const ALL_GROUPED_KEYS = new Set(PROCESS_GUIDE_GROUPS.flatMap((g) => g.keys));

interface SettingsProcessPromptsSectionProps {
  api?: ProcessPromptApi;
}

export function SettingsProcessPromptsSection({
  api: apiProp,
}: SettingsProcessPromptsSectionProps) {
  const api = apiProp ?? getAPI()?.processPrompt;
  const [apiRetryCount, setApiRetryCount] = useState(0);
  const [prompts, setPrompts] = useState<IpcProcessPrompt[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const loadPrompts = useCallback(async () => {
    if (!api) {
      if (apiProp || apiRetryCount >= PROCESS_PROMPT_API_RETRY_LIMIT) {
        setPrompts([]);
        setLoading(false);
        setError(t('settings.processGuides.unavailable'));
      }
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextPrompts = await api.list();
      setPrompts(nextPrompts);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('error.unknown'));
    } finally {
      setLoading(false);
    }
  }, [api, apiProp, apiRetryCount]);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  useEffect(() => {
    if (apiProp || api || apiRetryCount >= PROCESS_PROMPT_API_RETRY_LIMIT) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setApiRetryCount((current) => current + 1);
    }, PROCESS_PROMPT_API_RETRY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [api, apiProp, apiRetryCount]);

  const editingPrompt = useMemo(
    () => prompts.find((prompt) => prompt.processKey === editingKey) ?? null,
    [editingKey, prompts],
  );

  const openEditor = useCallback((prompt: IpcProcessPrompt) => {
    setDrafts((current) => ({
      ...current,
      [prompt.processKey]: current[prompt.processKey] ?? prompt.customValue ?? prompt.defaultValue,
    }));
    setEditingKey(prompt.processKey);
  }, []);

  const closeEditor = useCallback(() => {
    setEditingKey(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!api || !editingPrompt) return;
    const nextValue =
      drafts[editingPrompt.processKey] ?? editingPrompt.customValue ?? editingPrompt.defaultValue;
    setSavingKey(editingPrompt.processKey);
    setError(null);
    try {
      await api.setCustom(editingPrompt.processKey, nextValue);
      setPrompts((current) =>
        current.map((prompt) =>
          prompt.processKey === editingPrompt.processKey
            ? { ...prompt, customValue: nextValue }
            : prompt,
        ),
      );
      setEditingKey(null);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : t('settings.processGuides.saveFailed'),
      );
    } finally {
      setSavingKey(null);
    }
  }, [api, drafts, editingPrompt]);

  const handleReset = useCallback(
    async (processKey: string) => {
      if (!api) return;
      setSavingKey(processKey);
      setError(null);
      try {
        await api.reset(processKey);
        setPrompts((current) =>
          current.map((prompt) =>
            prompt.processKey === processKey ? { ...prompt, customValue: null } : prompt,
          ),
        );
        setDrafts((current) => {
          if (!current[processKey]) return current;
          const next = { ...current };
          delete next[processKey];
          return next;
        });
        if (editingKey === processKey) {
          setEditingKey(null);
        }
      } catch (resetError) {
        setError(
          resetError instanceof Error
            ? resetError.message
            : t('settings.processGuides.resetFailed'),
        );
      } finally {
        setSavingKey(null);
      }
    },
    [api, editingKey],
  );

  const toggleGroup = useCallback((groupKey: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const promptsByKey = useMemo(() => new Map(prompts.map((p) => [p.processKey, p])), [prompts]);

  const otherPrompts = useMemo(
    () => prompts.filter((p) => !ALL_GROUPED_KEYS.has(p.processKey)),
    [prompts],
  );

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">{t('settings.processGuides.loading')}</div>
    );
  }

  const renderPromptCard = (prompt: IpcProcessPrompt) => {
    const isEditing = editingKey === prompt.processKey;
    const isSaving = savingKey === prompt.processKey;
    const currentValue = drafts[prompt.processKey] ?? prompt.customValue ?? prompt.defaultValue;
    const localizedName = localizeProcessPromptName(prompt.processKey, prompt.name);
    const localizedDescription = localizeProcessPromptDescription(
      prompt.processKey,
      prompt.description,
    );
    const triggerTools = getProcessPromptTriggerTools(prompt.processKey);
    const triggerNote = getProcessPromptTriggerNote(prompt.processKey);

    return (
      <article
        key={prompt.processKey}
        className={cn(
          'rounded-md border border-border/60 bg-card px-2.5 py-1.5',
          isEditing && 'border-primary/40 bg-primary/5',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-medium leading-tight">{localizedName}</h3>
              {prompt.customValue !== null && (
                <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] leading-none text-amber-500">
                  {t('settings.customized')}
                </span>
              )}
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">{localizedDescription}</p>
            {triggerTools.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                <span className="text-[10px] font-medium text-muted-foreground">
                  {t('settings.processGuides.triggeredBy')}
                </span>
                {triggerTools.map((tool) => (
                  <span
                    key={tool}
                    className="rounded bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground"
                  >
                    {localizeToolName(tool)}
                  </span>
                ))}
                {triggerNote && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] leading-none text-primary">
                    {triggerNote}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => openEditor(prompt)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <SquarePen className="h-3 w-3" />
              {t('settings.edit')}
            </button>
            <button
              type="button"
              onClick={() => void handleReset(prompt.processKey)}
              disabled={isSaving}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              {t('settings.processGuides.reset')}
            </button>
          </div>
        </div>

        {isEditing && (
          <div className="mt-2 space-y-2 border-t border-border/40 pt-2">
            <textarea
              value={currentValue}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [prompt.processKey]: event.target.value,
                }))
              }
              rows={12}
              className="w-full resize-y rounded-md border border-border/60 bg-background px-2.5 py-2 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeEditor}
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                {t('action.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving || !currentValue.trim()}
                className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
              >
                <Save className="h-3 w-3" />
                {t('action.save')}
              </button>
            </div>
          </div>
        )}
      </article>
    );
  };

  const renderGroup = (
    groupKey: string,
    labelI18nKey: string,
    groupPrompts: IpcProcessPrompt[],
  ) => {
    if (groupPrompts.length === 0) return null;
    const isExpanded = expandedGroups.has(groupKey);
    const label = t(labelI18nKey);

    return (
      <div key={groupKey} className="rounded-md border border-border/40">
        <button
          type="button"
          onClick={() => toggleGroup(groupKey)}
          className="flex w-full items-center gap-1.5 border-b border-border/40 px-2.5 py-2 text-left hover:bg-muted/40 [&:not([aria-expanded='true'])]:border-b-0"
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="text-[13px] font-semibold">{label}</span>
          <span className="ml-auto text-[11px] text-muted-foreground">{groupPrompts.length}</span>
        </button>
        {isExpanded && (
          <div className="space-y-1.5 p-2">
            {groupPrompts.map((prompt) => renderPromptCard(prompt))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-2">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        {PROCESS_GUIDE_GROUPS.map((group) => {
          const groupPrompts = group.keys
            .map((key) => promptsByKey.get(key))
            .filter((p): p is IpcProcessPrompt => p !== undefined);
          return renderGroup(group.groupKey, group.labelI18nKey, groupPrompts);
        })}
        {otherPrompts.length > 0 &&
          renderGroup('other', 'settings.processGuides.group.other', otherPrompts)}
      </div>
    </section>
  );
}
