import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { localizeSettingsCategory, localizeSkillName, t } from '../../i18n.js';
import { cn } from '../../lib/utils.js';
import {
  getDefaultSkillName,
  type SkillDefinition,
} from '../../store/slices/skillDefinitions.js';

interface SettingsGuidesSectionProps {
  skills: SkillDefinition[];
  onAddSkill: (payload: { id?: string; name: string; category: string; content: string }) => void;
  onRemoveSkill: (id: string) => void;
  onRenameSkill: (payload: { id: string; name: string }) => void;
  onSetSkillContent: (payload: { id: string; content: string }) => void;
  onResetAllSkills: () => void;
  onResetSkill: (id: string) => void;
}

type GuideDraft = { content: string; name: string };

interface GuideItem {
  badgeLabel: string;
  builtIn: boolean;
  canDelete: boolean;
  category: string;
  content: string;
  id: string;
  name: string;
  resettable: boolean;
  customized: boolean;
}

const categoryBadgeClasses: Record<string, string> = {
  system: 'bg-violet-500/10 text-violet-400',
  core: 'bg-blue-500/10 text-blue-400',
  visual: 'bg-emerald-500/10 text-emerald-400',
  process: 'bg-amber-500/10 text-amber-400',
  audio: 'bg-cyan-500/10 text-cyan-400',
  workflow: 'bg-fuchsia-500/10 text-fuchsia-400',
  skill: 'bg-sky-500/10 text-sky-400',
};

function isSkillCustomized(skill: SkillDefinition): boolean {
  const defaultName = getDefaultSkillName(skill.id);
  if (!skill.builtIn) return true;
  if (skill.customContent !== null) return true;
  if (defaultName && skill.name !== defaultName) return true;
  return false;
}

export function SettingsGuidesSection({
  skills,
  onAddSkill,
  onRemoveSkill,
  onRenameSkill,
  onSetSkillContent,
  onResetAllSkills,
  onResetSkill,
}: SettingsGuidesSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, GuideDraft>>({});

  const guideItems = useMemo<GuideItem[]>(
    () =>
      skills.map<GuideItem>((skill) => {
        const defaultName = getDefaultSkillName(skill.id);
        const userRenamed = defaultName !== undefined && skill.name !== defaultName;
        const displayName =
          skill.builtIn && !userRenamed ? localizeSkillName(skill.id, skill.name) : skill.name;
        return {
          badgeLabel: localizeSettingsCategory(skill.category),
          builtIn: skill.builtIn,
          canDelete: !skill.builtIn,
          category: skill.category,
          content: skill.customContent ?? skill.defaultContent,
          id: skill.id,
          name: displayName,
          resettable: skill.builtIn && isSkillCustomized(skill),
          customized: isSkillCustomized(skill),
        };
      }),
    [skills],
  );

  const hasCustomized = skills.some(isSkillCustomized);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() =>
            onAddSkill({
              id: `custom-${Date.now()}`,
              name: t('settings.newTemplateName'),
              category: 'skill',
              content: t('settings.newTemplateContent'),
            })
          }
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-primary hover:bg-primary/10"
        >
          <Plus className="h-3 w-3" />
          {t('settings.addTemplate')}
        </button>
        {hasCustomized && (
          <button
            type="button"
            onClick={() => {
              onResetAllSkills();
              setExpandedId(null);
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
          const isExpanded = expandedId === item.id;
          const draft = drafts[item.id] ?? { content: item.content, name: item.name };

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
                    setExpandedId(null);
                    return;
                  }
                  setDrafts((previous) => ({
                    ...previous,
                    [item.id]: { content: item.content, name: item.name },
                  }));
                  setExpandedId(item.id);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
              >
                <span className="flex-1 text-xs font-medium">{item.name}</span>
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
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      setDrafts((previous) => ({
                        ...previous,
                        [item.id]: { ...draft, name: event.target.value },
                      }))
                    }
                    className="w-full rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder={t('settings.templateName')}
                  />
                  <textarea
                    value={draft.content}
                    onChange={(event) =>
                      setDrafts((previous) => ({
                        ...previous,
                        [item.id]: { ...draft, content: event.target.value },
                      }))
                    }
                    rows={12}
                    className="w-full resize-y rounded-md border border-border/60 bg-background px-2.5 py-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="flex items-center justify-end gap-1.5">
                    {item.canDelete && (
                      <button
                        type="button"
                        onClick={() => {
                          onRemoveSkill(item.id);
                          setExpandedId(null);
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
                          onResetSkill(item.id);
                          setExpandedId(null);
                        }}
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                      >
                        <RotateCcw className="h-3 w-3" />
                        {t('settings.restoreDefault')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedId(null)}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    >
                      {t('action.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const trimmed = draft.name.trim();
                        if (trimmed && trimmed !== item.name) {
                          onRenameSkill({ id: item.id, name: trimmed });
                        }
                        onSetSkillContent({ id: item.id, content: draft.content });
                        setExpandedId(null);
                      }}
                      disabled={!draft.name.trim() || !draft.content.trim()}
                      className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
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
