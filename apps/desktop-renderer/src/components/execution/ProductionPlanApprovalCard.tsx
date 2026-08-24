import React from 'react';
import { FileText } from 'lucide-react';
import type { PlanApprovalContext } from '@lucid-fin/contracts';
import { t } from '../../i18n.js';

type ProductionPlanApprovalCardProps = {
  context: PlanApprovalContext;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map((entry) => asRecord(entry)).filter((entry) => Object.keys(entry).length > 0)
    : [];
}

export function ProductionPlanApprovalCard({ context }: ProductionPlanApprovalCardProps) {
  const plan = context.document.content;
  const format = asRecord(plan.format);
  const story = asRecord(plan.story);
  const acts = recordList(story.acts);
  const budget = asRecord(plan.budget);
  const assumptions = stringList(plan.assumptions);
  const visualDirections = stringList(plan.visualDirections);

  return (
    <section
      aria-labelledby="production-plan-approval-title"
      className="overflow-hidden rounded-xl border border-border/70 bg-card/70"
    >
      <div className="border-b border-border/60 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-muted p-2 text-muted-foreground">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {t('planApproval.eyebrow')}
            </div>
            <h2 id="production-plan-approval-title" className="mt-1 text-base font-semibold">
              {t('planApproval.title')}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{t('planApproval.guardrail')}</p>
          </div>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
            {t('planApproval.revision')} {context.document.revision}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4 text-sm">
        <div>
          <div className="text-lg font-semibold">{text(plan.title)}</div>
          <div className="mt-1 text-sm text-muted-foreground">{text(plan.logline)}</div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border bg-background/70 p-3 sm:col-span-2">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('planApproval.synopsis')}
            </div>
            <p className="mt-1.5 leading-6">{text(plan.synopsis)}</p>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('planApproval.format')}
            </div>
            <div className="mt-1.5 font-medium">
              {String(format.targetDurationSeconds ?? '—')}s · {text(format.aspectRatio)}
            </div>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('planApproval.story')}
            </div>
            <div className="mt-1.5 font-medium">
              {acts.length} {t('planApproval.acts')}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('planApproval.genre')}
            </div>
            <div className="mt-1.5 font-medium">{text(plan.genre)}</div>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('planApproval.tone')}
            </div>
            <div className="mt-1.5 font-medium">{text(plan.tone)}</div>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('planApproval.targetAudience')}
            </div>
            <div className="mt-1.5 font-medium">{text(plan.targetAudience)}</div>
          </div>
        </div>

        <div className="rounded-lg border bg-background/70 p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('planApproval.scenePlan')}
          </div>
          <div className="mt-3 space-y-3">
            {acts.map((act, actIndex) => {
              const scenes = recordList(act.scenes);
              const actName = text(act.name, `${t('planApproval.act')} ${actIndex + 1}`);
              return (
                <details
                  key={`${actName}-${actIndex}`}
                  className="rounded-md border bg-card/60 px-3 py-2"
                >
                  <summary className="cursor-pointer text-xs font-medium">
                    {actName} · {scenes.length} {t('planApproval.scenes')}
                  </summary>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                    {text(act.purpose)}
                  </p>
                  <div className="mt-2 space-y-2">
                    {scenes.map((scene, sceneIndex) => (
                      <article
                        key={`${actIndex}-${sceneIndex}-${text(scene.title)}`}
                        className="rounded-md border border-border/70 bg-background/70 p-2.5 text-xs"
                      >
                        <div className="font-medium">
                          {t('planApproval.scene')} {sceneIndex + 1}: {text(scene.title)}
                        </div>
                        <p className="mt-1 text-muted-foreground">{text(scene.summary)}</p>
                        <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-2">
                          <div>
                            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {t('planApproval.storyBeat')}
                            </dt>
                            <dd className="mt-0.5">{text(scene.storyBeat)}</dd>
                          </div>
                          <div>
                            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {t('planApproval.dialogueIntent')}
                            </dt>
                            <dd className="mt-0.5">{text(scene.dialogueIntent)}</dd>
                          </div>
                        </dl>
                      </article>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('planApproval.assumptions')}
            </div>
            <ul className="mt-2 space-y-1.5 text-xs">
              {assumptions.map((assumption) => (
                <li key={assumption} className="flex gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>{assumption}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('planApproval.visualDirections')}
            </div>
            <ul className="mt-2 space-y-1.5 text-xs">
              {visualDirections.map((direction) => (
                <li key={direction} className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>{direction}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="rounded-lg border bg-background/70 p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('planApproval.budget')}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <span>${String(budget.maxTotalCostUsd ?? '—')} total</span>
            <span>${String(budget.styleAuditionCostUsd ?? '—')} styles</span>
            <span>{String(budget.maxAttemptsPerShot ?? '—')} / shot</span>
            <span>{String(budget.maxRegenerations ?? '—')} regenerations</span>
          </div>
        </div>

        <p className="border-t border-border/60 pt-3 text-xs leading-5 text-muted-foreground">
          {t('planApproval.chatDecisionHint')}
        </p>
      </div>
    </section>
  );
}
