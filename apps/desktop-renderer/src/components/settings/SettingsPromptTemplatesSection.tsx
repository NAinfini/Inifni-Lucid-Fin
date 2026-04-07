import { ChevronDown, ChevronUp, FileText, RotateCcw, Save } from 'lucide-react';
import {
  localizePromptTemplateName,
  localizeSettingsCategory,
  t,
} from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import type { PromptTemplate } from '../../store/slices/promptTemplates.js';

interface SettingsPromptTemplatesSectionProps {
  expandedTemplateId: string | null;
  onExpandedTemplateIdChange: (id: string | null) => void;
  onResetAll: () => void;
  onResetTemplate: (id: string) => void;
  onSaveTemplate: (id: string, content: string) => void;
  onTemplateDraftChange: (id: string, value: string) => void;
  templateDrafts: Record<string, string>;
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

export function SettingsPromptTemplatesSection({
  expandedTemplateId,
  onExpandedTemplateIdChange,
  onResetAll,
  onResetTemplate,
  onSaveTemplate,
  onTemplateDraftChange,
  templateDrafts,
  templates,
}: SettingsPromptTemplatesSectionProps) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          {t('settings.promptTemplates')}
        </h2>
        {templates.some((template) => template.customContent !== null) && (
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

      <div className="space-y-1.5">
        {templates.map((template) => {
          const isExpanded = expandedTemplateId === template.id;
          const isModified = template.customContent !== null;
          const localizedTitle = localizePromptTemplateName(template.id, template.name);
          const localizedCategory = localizeSettingsCategory(template.category);
          const draft =
            templateDrafts[template.id] ?? template.customContent ?? template.defaultContent;

          return (
            <div
              key={template.id}
              className={cn(
                'rounded-lg border transition-colors',
                isExpanded ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
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
                    templateDrafts[template.id] ?? template.customContent ?? template.defaultContent,
                  );
                  onExpandedTemplateIdChange(template.id);
                }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
              >
                <span className="flex-1 text-sm font-medium">{localizedTitle}</span>
                {isModified && (
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
                <div className="space-y-2 border-t border-border/50 px-3 pb-3 pt-2">
                  <textarea
                    value={draft}
                    onChange={(event) =>
                      onTemplateDraftChange(template.id, event.target.value)
                    }
                    rows={14}
                    className="w-full resize-y rounded border border-border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="flex items-center justify-end gap-2">
                    {isModified && (
                      <button
                        type="button"
                        onClick={() => {
                          onResetTemplate(template.id);
                          onTemplateDraftChange(template.id, template.defaultContent);
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
