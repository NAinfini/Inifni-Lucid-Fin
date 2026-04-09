import { ChevronDown, ChevronUp, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import {
  localizePromptTemplateName,
  localizeSettingsCategory,
  t,
} from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import {
  getDefaultPromptTemplateName,
  type PromptTemplate,
} from '../../store/slices/promptTemplates.js';

type TemplateDraft = {
  content: string;
  name: string;
};

interface SettingsPromptTemplatesSectionProps {
  expandedTemplateId: string | null;
  onExpandedTemplateIdChange: (id: string | null) => void;
  onResetAll: () => void;
  onResetTemplate: (id: string) => void;
  onSaveTemplate: (id: string, draft: TemplateDraft) => void;
  onTemplateDraftChange: (id: string, draft: TemplateDraft) => void;
  onAddTemplate?: (template: { id: string; name: string; category: string; content: string }) => void;
  onRemoveTemplate?: (id: string) => void;
  templateDrafts: Record<string, TemplateDraft>;
  templates: PromptTemplate[];
}

const categoryBadgeClasses: Record<string, string> = {
  system: 'bg-violet-500/10 text-violet-400',
  core: 'bg-blue-500/10 text-blue-400',
  visual: 'bg-emerald-500/10 text-emerald-400',
  process: 'bg-amber-500/10 text-amber-400',
  audio: 'bg-cyan-500/10 text-cyan-400',
  workflow: 'bg-fuchsia-500/10 text-fuchsia-400',
};

function getTemplateDisplayName(template: PromptTemplate): string {
  const defaultName = getDefaultPromptTemplateName(template.id);
  if (defaultName && template.name === defaultName) {
    return localizePromptTemplateName(template.id, template.name);
  }
  return template.name;
}

function isTemplateCustomized(template: PromptTemplate): boolean {
  const defaultName = getDefaultPromptTemplateName(template.id);
  return !template.defaultContent || template.customContent !== null || template.name !== defaultName;
}

export function SettingsPromptTemplatesSection({
  expandedTemplateId,
  onExpandedTemplateIdChange,
  onResetAll,
  onResetTemplate,
  onSaveTemplate,
  onTemplateDraftChange,
  onAddTemplate,
  onRemoveTemplate,
  templateDrafts,
  templates,
}: SettingsPromptTemplatesSectionProps) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-end gap-1.5">
        {onAddTemplate && (
          <button
            type="button"
            onClick={() => {
              const id = `custom-${Date.now()}`;
              onAddTemplate({ id, name: 'New Template', category: 'process', content: '# New Template\n\nWrite your prompt template here...' });
              onExpandedTemplateIdChange(id);
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-primary hover:bg-primary/10"
          >
            <Plus className="h-3 w-3" />
            {t('settings.addTemplate') || 'Add Template'}
          </button>
        )}
        {templates.some(isTemplateCustomized) && (
          <button
            type="button"
            onClick={onResetAll}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <RotateCcw className="h-3 w-3" />
            {t('settings.resetAll')}
          </button>
        )}
      </div>

      <div className="space-y-1">
        {templates.map((template) => {
          const isExpanded = expandedTemplateId === template.id;
          const isCustomized = isTemplateCustomized(template);
          const displayTitle = getTemplateDisplayName(template);
          const localizedCategory = localizeSettingsCategory(template.category);
          const draft = templateDrafts[template.id] ?? {
            content: template.customContent ?? template.defaultContent,
            name: template.name,
          };

          return (
            <div
              key={template.id}
              className={cn(
                'rounded-md border transition-colors',
                isExpanded ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-card',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  if (isExpanded) {
                    onExpandedTemplateIdChange(null);
                    return;
                  }

                  onTemplateDraftChange(
                    template.id,
                    templateDrafts[template.id] ?? {
                      content: template.customContent ?? template.defaultContent,
                      name: template.name,
                    },
                  );
                  onExpandedTemplateIdChange(template.id);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
              >
                <span className="flex-1 text-xs font-medium">{displayTitle}</span>
                {isCustomized && (
                  <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500">
                    {t('settings.customized')}
                  </span>
                )}
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px]',
                    categoryBadgeClasses[template.category] ?? 'bg-muted text-muted-foreground',
                  )}
                >
                  {localizedCategory}
                </span>
                {isExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>

              {isExpanded && (
                <div className="space-y-1.5 border-t border-border/40 px-2.5 pb-2.5 pt-2">
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      onTemplateDraftChange(template.id, {
                        ...draft,
                        name: event.target.value,
                      })
                    }
                    className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder={t('settings.templateName') || 'Template name'}
                  />
                  <textarea
                    value={draft.content}
                    onChange={(event) =>
                      onTemplateDraftChange(template.id, {
                        ...draft,
                        content: event.target.value,
                      })
                    }
                    rows={12}
                    className="w-full resize-y rounded-md border border-border/60 bg-background px-2.5 py-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="flex items-center justify-end gap-1.5">
                    {!template.defaultContent && onRemoveTemplate && (
                      <button
                        type="button"
                        onClick={() => {
                          onRemoveTemplate(template.id);
                          onExpandedTemplateIdChange(null);
                        }}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3 w-3" />
                        {t('action.delete') || 'Delete'}
                      </button>
                    )}
                    {template.defaultContent && isCustomized && (
                      <button
                        type="button"
                        onClick={() => {
                          onResetTemplate(template.id);
                          onTemplateDraftChange(template.id, {
                            content: template.defaultContent,
                            name: getDefaultPromptTemplateName(template.id) ?? template.name,
                          });
                        }}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                      >
                        <RotateCcw className="h-3 w-3" />
                        {t('settings.restoreDefault')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onExpandedTemplateIdChange(null)}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    >
                      {t('action.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onSaveTemplate(template.id, draft);
                        onExpandedTemplateIdChange(null);
                      }}
                      disabled={!draft.name.trim()}
                      className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
                    >
                      <Save className="h-3 w-3" />
                      {t('action.save')}
                    </button>
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
