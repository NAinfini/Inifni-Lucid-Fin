import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ImageIcon, LoaderCircle, LockKeyhole, Sparkles } from 'lucide-react';
import type {
  ApproveWorkflowGateResult,
  VisualAuditionCandidate,
  VisualAuditionDocumentContent,
  VisualConstitutionDocumentContent,
  VisualConstitutionSelectionResult,
  VisualPreviewAttempt,
  WorkflowApprovalContext,
  WorkflowVisualAuditionContext,
} from '@lucid-fin/contracts';
import { t } from '../../i18n.js';
import { WorkflowRequestChangesForm } from './WorkflowRequestChangesForm.js';

type VisualConstitutionApprovalCardProps = {
  auditionContext: WorkflowVisualAuditionContext;
  approvalContext?: WorkflowApprovalContext | null;
  onSelect: (candidateId: string) => Promise<VisualConstitutionSelectionResult>;
  onApprove: () => Promise<ApproveWorkflowGateResult>;
  onApproved?: () => void;
  onRequestChanges?: (reason: string) => Promise<unknown>;
  onRequested?: () => void;
};

function selectedAttempt(candidate: VisualAuditionCandidate): VisualPreviewAttempt | undefined {
  return candidate.attempts.find(
    (attempt) =>
      attempt.attempt === candidate.selectedAttempt &&
      attempt.status === 'completed' &&
      Boolean(attempt.assetHash) &&
      Boolean(attempt.grade),
  );
}

function formatCost(value: number | undefined): string {
  return value === undefined ? '—' : `$${value.toFixed(4)}`;
}

export function VisualConstitutionApprovalCard({
  auditionContext,
  approvalContext,
  onSelect,
  onApprove,
  onApproved,
  onRequestChanges,
  onRequested,
}: VisualConstitutionApprovalCardProps) {
  const audition = auditionContext.document.content as VisualAuditionDocumentContent;
  const visualApproval =
    approvalContext?.approval.gateKey === 'visual_constitution' ? approvalContext : null;
  const locked = visualApproval?.document.content as VisualConstitutionDocumentContent | undefined;
  const completedCandidates = useMemo(
    () => audition.candidates.filter((candidate) => Boolean(selectedAttempt(candidate))),
    [audition.candidates],
  );
  const preferredCandidateId =
    locked?.selectedCandidateId ??
    audition.recommendedCandidateId ??
    completedCandidates[0]?.id ??
    '';
  const [selectedId, setSelectedId] = useState(preferredCandidateId);
  const [selecting, setSelecting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(preferredCandidateId);
  }, [preferredCandidateId, auditionContext.document.contentHash]);

  const selectionIsLocked = Boolean(visualApproval) && selectedId === locked?.selectedCandidateId;

  const select = async () => {
    if (!selectedId) return;
    setSelecting(true);
    setError(null);
    try {
      await onSelect(selectedId);
    } catch (selectionError) {
      setError(
        selectionError instanceof Error
          ? selectionError.message
          : t('visualConstitutionApproval.selectionFailure'),
      );
    } finally {
      setSelecting(false);
    }
  };

  const approve = async () => {
    setApproving(true);
    setError(null);
    try {
      const result = await onApprove();
      if (!result.ok) {
        setError(`${t('visualConstitutionApproval.approvalFailure')} (${result.code})`);
        return;
      }
      onApproved?.();
    } catch (approvalError) {
      setError(
        approvalError instanceof Error
          ? approvalError.message
          : t('visualConstitutionApproval.approvalFailure'),
      );
    } finally {
      setApproving(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-violet-400/30 bg-violet-500/5">
      <div className="border-b border-violet-400/20 bg-violet-500/10 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-violet-400/15 p-2 text-violet-200">
            <ImageIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-violet-200/80">
              {t('visualConstitutionApproval.eyebrow')}
            </div>
            <h2 className="mt-1 text-base font-semibold">
              {t('visualConstitutionApproval.title')}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('visualConstitutionApproval.guardrail')}
            </p>
          </div>
          <span className="rounded-full border border-violet-400/30 px-2 py-0.5 text-[10px] text-violet-100">
            {t('visualConstitutionApproval.auditionRevision')} {auditionContext.document.revision}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div
          className="grid gap-3 sm:grid-cols-2"
          role="radiogroup"
          aria-label={t('visualConstitutionApproval.title')}
        >
          {completedCandidates.map((candidate) => {
            const attempt = selectedAttempt(candidate)!;
            const grade = attempt.grade!;
            const selected = selectedId === candidate.id;
            const recommended = audition.recommendedCandidateId === candidate.id;
            return (
              <label
                key={candidate.id}
                className={`group cursor-pointer overflow-hidden rounded-xl border bg-background/80 transition ${
                  selected
                    ? 'border-violet-300 ring-2 ring-violet-400/30'
                    : 'border-border hover:border-violet-400/50'
                }`}
              >
                <input
                  type="radio"
                  name={`visual-candidate-${auditionContext.run.id}`}
                  value={candidate.id}
                  checked={selected}
                  onChange={() => setSelectedId(candidate.id)}
                  className="sr-only"
                />
                <div className="relative aspect-video overflow-hidden bg-black/30">
                  <img
                    src={`lucid-asset://${attempt.assetHash}/image/png`}
                    alt={`${candidate.name} ${t('visualConstitutionApproval.preview')}`}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute left-2 top-2 flex gap-1.5">
                    {recommended && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-violet-600/90 px-2 py-1 text-[10px] font-medium text-white shadow">
                        <Sparkles className="h-3 w-3" />
                        {t('visualConstitutionApproval.recommended')}
                      </span>
                    )}
                    {locked?.selectedCandidateId === candidate.id && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/90 px-2 py-1 text-[10px] font-medium text-white shadow">
                        <LockKeyhole className="h-3 w-3" />
                        {t('visualConstitutionApproval.locked')}
                      </span>
                    )}
                  </div>
                  <span className="absolute bottom-2 right-2 rounded-full bg-black/75 px-2 py-1 text-xs font-semibold text-white">
                    {grade.total}/100
                  </span>
                </div>

                <div className="space-y-3 p-3">
                  <div>
                    <div className="font-semibold">{candidate.name}</div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {candidate.summary}
                    </p>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <dt className="text-muted-foreground">
                      {t('visualConstitutionApproval.provider')}
                    </dt>
                    <dd className="truncate text-right">{attempt.providerId}</dd>
                    <dt className="text-muted-foreground">
                      {t('visualConstitutionApproval.model')}
                    </dt>
                    <dd className="truncate text-right">{attempt.model ?? '—'}</dd>
                    <dt className="text-muted-foreground">
                      {t('visualConstitutionApproval.seed')}
                    </dt>
                    <dd className="text-right">{attempt.reportedSeed ?? attempt.requestedSeed}</dd>
                    <dt className="text-muted-foreground">
                      {t('visualConstitutionApproval.cost')}
                    </dt>
                    <dd className="text-right">
                      {formatCost(attempt.reportedActualCostUsd)} /{' '}
                      {formatCost(attempt.estimatedCostUsd)}
                    </dd>
                  </dl>

                  <div className="grid gap-2 text-[11px]">
                    <div>
                      <div className="font-medium text-emerald-300">
                        {t('visualConstitutionApproval.strengths')}
                      </div>
                      <p className="mt-0.5 text-muted-foreground">{grade.strengths.join(' · ')}</p>
                    </div>
                    <div>
                      <div className="font-medium text-amber-300">
                        {t('visualConstitutionApproval.risks')}
                      </div>
                      <p className="mt-0.5 text-muted-foreground">{grade.risks.join(' · ')}</p>
                    </div>
                  </div>

                  <details className="rounded-lg border bg-black/10 px-2.5 py-2 text-[11px]">
                    <summary className="cursor-pointer font-medium">
                      {t('visualConstitutionApproval.gradeEvidence')}
                    </summary>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                      {[
                        ['promptAdherence', grade.promptAdherence],
                        ['styleClarity', grade.styleClarity],
                        ['storyFit', grade.storyFit],
                        ['lightingScore', grade.lighting],
                        ['compositionScore', grade.composition],
                        ['continuityPotential', grade.continuityPotential],
                      ].map(([label, value]) => (
                        <React.Fragment key={String(label)}>
                          <dt className="text-muted-foreground">
                            {t(`visualConstitutionApproval.${String(label)}`)}
                          </dt>
                          <dd className="text-right">{String(value)}</dd>
                        </React.Fragment>
                      ))}
                    </dl>
                    <p className="mt-2 leading-5 text-muted-foreground">{grade.evidence}</p>
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      {t('visualConstitutionApproval.vision')}: {grade.visionProviderId}
                      {grade.visionModel ? ` / ${grade.visionModel}` : ''} ·{' '}
                      {t('visualConstitutionApproval.rubric')}: {grade.rubricVersion}
                    </div>
                  </details>
                </div>
              </label>
            );
          })}
        </div>

        <div className="rounded-lg border bg-background/70 p-3 text-xs">
          <div className="font-medium">{t('visualConstitutionApproval.budget')}</div>
          <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
            <span>
              {t('visualConstitutionApproval.estimated')}:{' '}
              {formatCost(audition.budget.estimatedCommittedUsd)}
            </span>
            <span>
              {t('visualConstitutionApproval.reportedActual')}:{' '}
              {formatCost(audition.budget.reportedActualUsd)}
            </span>
            <span>
              {t('visualConstitutionApproval.approved')}:{' '}
              {formatCost(audition.budget.approvedStyleAuditionCostUsd)}
            </span>
            <span>
              {t('visualConstitutionApproval.unpriced')}:{' '}
              {audition.budget.unpricedOperations.join(', ') || '—'}
            </span>
          </div>
          {audition.budget.hasUnreportedActualCosts && (
            <p className="mt-2 text-amber-300">
              {t('visualConstitutionApproval.unreportedWarning')}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('visualConstitutionApproval.exactAuditionHash')}
            </div>
            <code className="mt-1 block break-all rounded bg-black/20 px-2 py-1.5 text-[10px] text-muted-foreground">
              {auditionContext.document.contentHash}
            </code>
          </div>
          {visualApproval && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('visualConstitutionApproval.exactConstitutionHash')}
              </div>
              <code className="mt-1 block break-all rounded bg-black/20 px-2 py-1.5 text-[10px] text-muted-foreground">
                {visualApproval.document.contentHash}
              </code>
            </div>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
          >
            {error}
          </div>
        )}

        {!selectionIsLocked && audition.status === 'complete' && (
          <button
            type="button"
            onClick={select}
            disabled={!selectedId || selecting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-400/40 bg-violet-500/15 px-4 py-2.5 text-sm font-medium text-violet-100 disabled:cursor-wait disabled:opacity-60"
          >
            {selecting ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <LockKeyhole className="h-4 w-4" />
            )}
            {selecting
              ? t('visualConstitutionApproval.locking')
              : visualApproval
                ? t('visualConstitutionApproval.updateSelection')
                : t('visualConstitutionApproval.lockSelection')}
          </button>
        )}

        {selectionIsLocked && visualApproval && (
          <>
            <WorkflowRequestChangesForm
              onRequestChanges={onRequestChanges}
              onRequested={onRequested}
            />
            <button
              type="button"
              onClick={approve}
              disabled={approving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:cursor-wait disabled:opacity-60"
            >
              {approving ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {approving
                ? t('visualConstitutionApproval.approving')
                : t('visualConstitutionApproval.approve')}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
