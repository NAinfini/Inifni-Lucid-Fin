import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import {
  localizePromptTemplateName,
  localizeSettingsCategory,
  localizeWorkflowDefinitionName,
  t,
} from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import {
  getDefaultPromptTemplateName,
  type PromptTemplate,
} from '../../store/slices/promptTemplates.js';
import {
  type WorkflowDefEntry,
} from '../../store/slices/workflowDefinitions.js';

interface SettingsGuidesSectionProps {
  templates: PromptTemplate[];
  workflowEntries: WorkflowDefEntry[];
  onAddTemplate: (template: { id: string; name: string; category: string; content: string }) => void;
  onRemoveTemplate: (id: string) => void;
  onRenameTemplate: (payload: { id: string; name: string }) => void;
  onSetTemplateContent: (payload: { id: string; content: string }) => void;
  onResetAllTemplates: () => void;
  onResetTemplate: (id: string) => void;
  onAddWorkflowEntry: (entry: {
    name: string;
    category: 'workflow' | 'skill';
    content: string;
  }) => void;
  onUpdateWorkflowEntry: (payload: { id: string; name: string; content: string }) => void;
  onRemoveWorkflowEntry: (id: string) => void;
}

type GuideDraft = {
  content: string;
  name: string;
};

type GuideItem =
  | {
      badgeLabel: string;
      builtIn: boolean;
      canDelete: boolean;
      canEditName: boolean;
      category: string;
      content: string;
      id: string;
      kind: 'template';
      name: string;
      resettable: boolean;
      sourceLabel: string;
      title: string;
      customized: boolean;
    }
  | {
      badgeLabel: string;
      builtIn: boolean;
      canDelete: boolean;
      canEditName: boolean;
      category: string;
      content: string;
      id: string;
      kind: 'workflow';
      name: string;
      resettable: boolean;
      sourceLabel: string;
      title: string;
      customized: boolean;
    };

const categoryBadgeClasses: Record<string, string> = {
  system: 'bg-violet-500/10 text-violet-400',
  core: 'bg-blue-500/10 text-blue-400',
  visual: 'bg-emerald-500/10 text-emerald-400',
  process: 'bg-amber-500/10 text-amber-400',
  audio: 'bg-cyan-500/10 text-cyan-400',
  workflow: 'bg-fuchsia-500/10 text-fuchsia-400',
  skill: 'bg-sky-500/10 text-sky-400',
};

function isTemplateCustomized(template: PromptTemplate): boolean {
  const defaultName = getDefaultPromptTemplateName(template.id);
  return !template.defaultContent || template.customContent !== null || template.name !== defaultName;
}

function getTemplateDisplayName(template: PromptTemplate): string {
  const defaultName = getDefaultPromptTemplateName(template.id);
  if (defaultName && template.name === defaultName) {
    return localizePromptTemplateName(template.id, template.name);
  }
  return template.name;
}

function getWorkflowDisplayName(entry: WorkflowDefEntry): string {
  if (entry.builtIn) {
    return localizeWorkflowDefinitionName(entry.id, entry.name);
  }
  return entry.name;
}

export function SettingsGuidesSection({
  templates,
  workflowEntries,
  onAddTemplate,
  onRemoveTemplate,
  onRenameTemplate,
  onSetTemplateContent,
  onResetAllTemplates,
  onResetTemplate,
  onAddWorkflowEntry,
  onUpdateWorkflowEntry,
  onRemoveWorkflowEntry,
}: SettingsGuidesSectionProps) {
  const [expandedGuideId, setExpandedGuideId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, GuideDraft>>({});

  const guideItems = useMemo<GuideItem[]>(() => {
    const templateItems = templates.map<GuideItem>((template) => ({
      badgeLabel: localizeSettingsCategory(template.category),
      builtIn: Boolean(template.defaultContent),
      canDelete: !template.defaultContent,
      canEditName: true,
      category: template.category,
      content: template.customContent ?? template.defaultContent,
      id: `template:${template.id}`,
      kind: 'template',
      name: template.name,
      resettable: Boolean(template.defaultContent) && isTemplateCustomized(template),
      sourceLabel: t('settings.guides.templateSource'),
      title: getTemplateDisplayName(template),
      customized: isTemplateCustomized(template),
    }));

    const workflowItems = workflowEntries.map<GuideItem>((entry) => ({
      badgeLabel: localizeSettingsCategory(entry.category),
      builtIn: entry.builtIn,
      canDelete: !entry.builtIn,
      canEditName: !entry.builtIn,
      category: entry.category,
      content: entry.content,
      id: `workflow:${entry.id}`,
      kind: 'workflow',
      name: entry.name,
      resettable: false,
      sourceLabel: t('settings.guides.workflowSource'),
      title: getWorkflowDisplayName(entry),
      customized: !entry.builtIn,
    }));

    return [...templateItems, ...workflowItems];
  }, [templates, workflowEntries]);

  const hasCustomizedTemplates = templates.some(isTemplateCustomized);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() =>
            onAddTemplate({
              id: `custom-${Date.now()}`,
              name: t('settings.newTemplateName'),
              category: 'process',
              content: t('settings.newTemplateContent'),
            })
          }
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-primary hover:bg-primary/10"
        >
          <Plus className="h-3 w-3" />
          {t('settings.addTemplate')}
        </button>
        <button
          type="button"
          onClick={() =>
            onAddWorkflowEntry({
              category: 'workflow',
              content: t('settings.workflows.newWorkflowTemplate'),
              name: t('settings.workflows.newWorkflowName'),
            })
          }
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-primary hover:bg-primary/10"
        >
          <Plus className="h-3 w-3" />
          {t('settings.addWorkflow')}
        </button>
        <button
          type="button"
          onClick={() =>
            onAddWorkflowEntry({
              category: 'skill',
              content: t('settings.workflows.newSkillTemplate'),
              name: t('settings.workflows.newSkillName'),
            })
          }
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-primary hover:bg-primary/10"
        >
          <Plus className="h-3 w-3" />
          {t('settings.addSkill')}
        </button>
        {hasCustomizedTemplates && (
          <button
            type="button"
            onClick={() => {
              onResetAllTemplates();
              setExpandedGuideId(null);
              setDrafts({});
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <RotateCcw className="h-3 w-3" />
            {t('settings.resetAll')}
          </button>
        )}
      </div>

      <div className="space-y-1">
        {guideItems.map((item) => {
          const isExpanded = expandedGuideId === item.id;
          const draft = drafts[item.id] ?? {
            content: item.content,
            name: item.name,
          };

          return (
            <div
              key={item.id}
              className={cn(
                'rounded-md border transition-colors',
                isExpanded ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-card',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  if (isExpanded) {
                    setExpandedGuideId(null);
                    return;
                  }
                  setDrafts((previous) => ({
                    ...previous,
                    [item.id]: {
                      content: item.content,
                      name: item.name,
                    },
                  }));
                  setExpandedGuideId(item.id);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
              >
                <span className="flex-1 text-xs font-medium">{item.title}</span>
                {item.customized && (
                  <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500">
                    {t('settings.customized')}
                  </span>
                )}
                {item.builtIn && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t('settings.builtIn')}
                  </span>
                )}
                <span className="shrink-0 rounded bg-slate-500/10 px-1.5 py-0.5 text-[10px] text-slate-300">
                  {item.sourceLabel}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px]',
                    categoryBadgeClasses[item.category] ?? 'bg-muted text-muted-foreground',
                  )}
                >
                  {item.badgeLabel}
                </span>
                {isExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>

              {isExpanded && (
                <div className="space-y-1.5 border-t border-border/40 px-2.5 pb-2.5 pt-2">
                  {item.canEditName && (
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        setDrafts((previous) => ({
                          ...previous,
                          [item.id]: {
                            ...draft,
                            name: event.target.value,
                          },
                        }))
                      }
                      className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder={t('settings.templateName')}
                    />
                  )}
                  <textarea
                    value={draft.content}
                    onChange={(event) =>
                      setDrafts((previous) => ({
                        ...previous,
                        [item.id]: {
                          ...draft,
                          content: event.target.value,
                        },
                      }))
                    }
                    rows={12}
                    readOnly={!item.canEditName && item.kind === 'workflow'}
                    className="w-full resize-y rounded-md border border-border/60 bg-background px-2.5 py-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="flex items-center justify-end gap-1.5">
                    {item.canDelete && (
                      <button
                        type="button"
                        onClick={() => {
                          if (item.kind === 'template') {
                            onRemoveTemplate(item.id.slice('template:'.length));
                          } else {
                            onRemoveWorkflowEntry(item.id.slice('workflow:'.length));
                          }
                          setExpandedGuideId(null);
                        }}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3 w-3" />
                        {t('action.delete')}
                      </button>
                    )}
                    {item.resettable && (
                      <button
                        type="button"
                        onClick={() => {
                          onResetTemplate(item.id.slice('template:'.length));
                          setExpandedGuideId(null);
                        }}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                      >
                        <RotateCcw className="h-3 w-3" />
                        {t('settings.restoreDefault')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedGuideId(null)}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    >
                      {item.kind === 'workflow' && !item.canEditName ? t('action.close') : t('action.cancel')}
                    </button>
                    {(item.kind === 'template' || item.canEditName) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (item.kind === 'template') {
                            const templateId = item.id.slice('template:'.length);
                            onRenameTemplate({ id: templateId, name: draft.name });
                            onSetTemplateContent({ id: templateId, content: draft.content });
                          } else {
                            onUpdateWorkflowEntry({
                              id: item.id.slice('workflow:'.length),
                              name: draft.name,
                              content: draft.content,
                            });
                          }
                          setExpandedGuideId(null);
                        }}
                        disabled={!draft.name.trim() || !draft.content.trim()}
                        className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                      >
                        <Save className="h-3 w-3" />
                        {t('action.save')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
