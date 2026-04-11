import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ChevronDown, ChevronUp, Plus, Trash2, Workflow } from 'lucide-react';
import {
  t,
  localizeSettingsCategory,
  localizeWorkflowDefinitionName,
} from '../i18n.js';
import type { RootState } from '../store/index.js';
import { translateOrFallback } from '../components/settings/SettingsSidebarNav.js';
import { cn } from '../lib/utils.js';
import {
  addEntry as addWorkflowEntry,
  getDefaultWorkflowDefinitionName,
  removeEntry as removeWorkflowEntry,
  updateEntry as updateWorkflowEntry,
  type WorkflowDefEntry,
} from '../store/slices/workflowDefinitions.js';

function getWorkflowEntryDisplayName(entry: WorkflowDefEntry): string {
  const defaultName = getDefaultWorkflowDefinitionName(entry.id);
  if (defaultName && entry.name === defaultName) {
    return localizeWorkflowDefinitionName(entry.id, entry.name);
  }
  return entry.name;
}

export function SettingsWorkflowsSection() {
  const dispatch = useDispatch();
  const entries = useSelector((state: RootState) => state.workflowDefinitions.entries);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { content: string; name: string }>>({});

  const getDraft = (entry: WorkflowDefEntry) =>
    drafts[entry.id] ?? { content: entry.content, name: entry.name };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => {
            dispatch(
              addWorkflowEntry({
                category: 'workflow',
                content: t('settings.workflows.newWorkflowTemplate'),
                name: t('settings.workflows.newWorkflowName'),
              }),
            );
          }}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-primary hover:bg-primary/10"
        >
          <Plus className="h-3 w-3" />
          {translateOrFallback('settings.addWorkflow', 'Add Workflow')}
        </button>
        <button
          type="button"
          onClick={() => {
            dispatch(
              addWorkflowEntry({
                category: 'skill',
                content: t('settings.workflows.newSkillTemplate'),
                name: t('settings.workflows.newSkillName'),
              }),
            );
          }}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-primary hover:bg-primary/10"
        >
          <Plus className="h-3 w-3" />
          {translateOrFallback('settings.addSkill', 'Add Skill')}
        </button>
      </div>

      <div className="space-y-1">
        {entries.map((entry) => {
          const isExpanded = expandedId === entry.id;
          const draft = getDraft(entry);
          const displayName = getWorkflowEntryDisplayName(entry);

          return (
            <div
              key={entry.id}
              className={cn(
                'rounded-md border transition-colors',
                isExpanded ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-card',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  if (isExpanded) {
                    setExpandedId(null);
                    return;
                  }
                  setDrafts((previous) => ({
                    ...previous,
                    [entry.id]: { content: entry.content, name: entry.name },
                  }));
                  setExpandedId(entry.id);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
              >
                <Workflow className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-xs font-medium">{displayName}</span>
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px]',
                    entry.category === 'workflow'
                      ? 'bg-fuchsia-500/10 text-fuchsia-400'
                      : 'bg-cyan-500/10 text-cyan-400',
                  )}
                >
                  {localizeSettingsCategory(entry.category)}
                </span>
                {entry.builtIn && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {translateOrFallback('settings.builtIn', 'Built-in')}
                  </span>
                )}
                {isExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>

              {isExpanded && (
                <div className="space-y-1.5 border-t border-border/40 px-2.5 pb-2.5 pt-2">
                  {!entry.builtIn && (
                    <input
                      value={draft.name}
                      onChange={(e) =>
                        setDrafts((previous) => ({
                          ...previous,
                          [entry.id]: { ...draft, name: e.target.value },
                        }))
                      }
                      className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder={t('settings.templateName')}
                    />
                  )}
                  <textarea
                    value={draft.content}
                    onChange={(e) =>
                      setDrafts((previous) => ({
                        ...previous,
                        [entry.id]: { ...draft, content: e.target.value },
                      }))
                    }
                    rows={10}
                    readOnly={entry.builtIn}
                    className="w-full resize-y rounded-md border border-border/60 bg-background px-2.5 py-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="flex items-center justify-end gap-1.5">
                    {!entry.builtIn && (
                      <button
                        type="button"
                        onClick={() => {
                          dispatch(removeWorkflowEntry(entry.id));
                          setExpandedId(null);
                        }}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3 w-3" /> {t('action.delete') || 'Delete'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedId(null)}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    >
                      {entry.builtIn
                        ? t('action.close') || 'Close'
                        : t('action.cancel') || 'Cancel'}
                    </button>
                    {!entry.builtIn && (
                      <button
                        type="button"
                        onClick={() => {
                          dispatch(
                            updateWorkflowEntry({
                              content: draft.content,
                              id: entry.id,
                              name: draft.name,
                            }),
                          );
                          setExpandedId(null);
                        }}
                        disabled={!draft.name.trim()}
                        className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
                      >
                        {t('action.save') || 'Save'}
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
