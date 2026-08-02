import React, { useState } from 'react';
import { CheckCircle2, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { ApproveWorkflowGateResult, WorkflowApprovalContext } from '@lucid-fin/contracts';
import { t } from '../../i18n.js';

type ProductionPlanApprovalCardProps = {
  context: WorkflowApprovalContext;
  onApprove: () => Promise<ApproveWorkflowGateResult>;
  onApproved?: () => void;
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

export function ProductionPlanApprovalCard({
  context,
  onApprove,
  onApproved,
}: ProductionPlanApprovalCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plan = context.document.content;
  const format = asRecord(plan.format);
  const story = asRecord(plan.story);
  const acts = Array.isArray(story.acts) ? story.acts : [];
  const budget = asRecord(plan.budget);
  const assumptions = stringList(plan.assumptions);
  const visualDirections = stringList(plan.visualDirections);

  const approve = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await onApprove();
      if (!result.ok) {
        setError(`${t('workflowApproval.failure')} (${result.code})`);
        return;
      }
      onApproved?.();
    } catch (approvalError) {
      setError(
        approvalError instanceof Error ? approvalError.message : t('workflowApproval.failure'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-amber-400/30 bg-amber-500/5">
      <div className="border-b border-amber-400/20 bg-amber-500/10 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-400/15 p-2 text-amber-300">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-amber-200/80">
              {t('workflowApproval.eyebrow')}
            </div>
            <h2 className="mt-1 text-base font-semibold">{t('workflowApproval.title')}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t('workflowApproval.guardrail')}</p>
          </div>
          <span className="rounded-full border border-amber-400/30 px-2 py-0.5 text-[10px] text-amber-200">
            {t('workflowApproval.revision')} {context.document.revision}
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
              {t('workflowApproval.synopsis')}
            </div>
            <p className="mt-1.5 leading-6">{text(plan.synopsis)}</p>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('workflowApproval.format')}
            </div>
            <div className="mt-1.5 font-medium">
              {String(format.targetDurationSeconds ?? '—')}s · {text(format.aspectRatio)}
            </div>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('workflowApproval.story')}
            </div>
            <div className="mt-1.5 font-medium">
              {acts.length} {t('workflowApproval.acts')}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('workflowApproval.assumptions')}
            </div>
            <ul className="mt-2 space-y-1.5 text-xs">
              {assumptions.map((assumption) => (
                <li key={assumption} className="flex gap-2">
                  <span className="text-amber-300">•</span>
                  <span>{assumption}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('workflowApproval.visualDirections')}
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
            {t('workflowApproval.budget')}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <span>${String(budget.maxTotalCostUsd ?? '—')} total</span>
            <span>${String(budget.styleAuditionCostUsd ?? '—')} styles</span>
            <span>{String(budget.maxAttemptsPerShot ?? '—')} / shot</span>
            <span>{String(budget.maxRegenerations ?? '—')} regenerations</span>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('workflowApproval.exactHash')}
          </div>
          <code className="mt-1 block break-all rounded bg-black/20 px-2 py-1.5 text-[10px] text-muted-foreground">
            {context.document.contentHash}
          </code>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
          >
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={approve}
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:cursor-wait disabled:opacity-60"
        >
          {submitting ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {submitting ? t('workflowApproval.approving') : t('workflowApproval.approve')}
        </button>
      </div>
    </section>
  );
}
