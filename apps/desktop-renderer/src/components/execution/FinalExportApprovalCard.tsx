import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clapperboard, LoaderCircle, LockKeyhole } from 'lucide-react';
import type {
  ApproveWorkflowGateResult,
  FinalExportManifestContent,
  WorkflowApprovalContext,
} from '@lucid-fin/contracts';
import { t } from '../../i18n.js';
import { WorkflowRequestChangesForm } from './WorkflowRequestChangesForm.js';

type FinalExportApprovalCardProps = {
  context: WorkflowApprovalContext;
  onApprove: () => Promise<ApproveWorkflowGateResult>;
  onApproved?: () => void;
  onRequestChanges?: (reason: string) => Promise<unknown>;
  onRequested?: () => void;
};

function formatSeconds(value: number): string {
  return `${value}s`;
}

function formatMilliseconds(value: number): string {
  return `${value}ms`;
}

export function FinalExportApprovalCard({
  context,
  onApprove,
  onApproved,
  onRequestChanges,
  onRequested,
}: FinalExportApprovalCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manifest = context.document.content as FinalExportManifestContent;
  const segments = [...manifest.segments].sort((left, right) => left.order - right.order);

  const approve = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await onApprove();
      if (!result.ok) {
        setError(`${t('finalExportApproval.failure')} (${result.code})`);
        return;
      }
      onApproved?.();
    } catch (approvalError) {
      setError(
        approvalError instanceof Error ? approvalError.message : t('finalExportApproval.failure'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border border-cyan-400/30 bg-cyan-500/5">
      <div className="border-b border-cyan-400/20 bg-cyan-500/10 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-cyan-400/15 p-2 text-cyan-200">
            <Clapperboard className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-cyan-100/80">
              {t('finalExportApproval.eyebrow')}
            </div>
            <h2 className="mt-1 text-base font-semibold">{t('finalExportApproval.title')}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('finalExportApproval.guardrail')}
            </p>
          </div>
          <span className="rounded-full border border-cyan-400/30 px-2 py-0.5 text-[10px] text-cyan-100">
            {t('finalExportApproval.manifestRevision')} {context.document.revision}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('finalExportApproval.planReference')}
            </div>
            <div className="mt-1.5 text-xs font-medium">
              {t('finalExportApproval.revision')} {manifest.productionPlan.revision}
            </div>
            <code className="mt-1 block break-all text-[10px] text-muted-foreground">
              {manifest.productionPlan.contentHash}
            </code>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('finalExportApproval.visualReference')}
            </div>
            <div className="mt-1.5 text-xs font-medium">
              {t('finalExportApproval.revision')} {manifest.visualConstitution.revision}
            </div>
            <code className="mt-1 block break-all text-[10px] text-muted-foreground">
              {manifest.visualConstitution.contentHash}
            </code>
          </div>
        </div>

        <div className="rounded-lg border bg-background/70 p-3">
          <div className="grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('finalExportApproval.manifestHash')}
              </div>
              <code className="mt-1 block break-all text-[10px] text-muted-foreground">
                {context.document.contentHash}
              </code>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('finalExportApproval.assemblySnapshot')}
              </div>
              <code className="mt-1 block break-all text-[10px] text-muted-foreground">
                {manifest.assemblySnapshotHash}
              </code>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-muted-foreground">{t('finalExportApproval.manifestVersion')}</dt>
            <dd className="text-right">{manifest.manifestVersion}</dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.canvas')}</dt>
            <dd className="truncate text-right">{manifest.canvasId}</dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.expectedDuration')}</dt>
            <dd className="text-right">{formatMilliseconds(manifest.expectedDurationMs)}</dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.estimatedDuration')}</dt>
            <dd className="text-right">{formatSeconds(manifest.estimatedDurationSeconds)}</dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.maxRenderAttempts')}</dt>
            <dd className="text-right">{manifest.maxRenderAttempts}</dd>
          </dl>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('finalExportApproval.segments')}
            </div>
            <span className="text-xs text-muted-foreground">{segments.length}</span>
          </div>
          <div className="mt-2 space-y-2">
            {segments.map((segment) => (
              <article
                key={`${segment.order}:${segment.nodeId}:${segment.assetHash}`}
                className="rounded-lg border bg-background/70 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">
                      #{segment.order} {segment.title}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {t('finalExportApproval.node')}: {segment.nodeId}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                    {formatSeconds(segment.durationSeconds)}
                  </span>
                </div>
                <div className="mt-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    {t('finalExportApproval.assetHash')}
                  </div>
                  <code className="mt-1 block break-all text-[10px] text-muted-foreground">
                    {segment.assetHash}
                  </code>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-muted-foreground">{t('finalExportApproval.duration')}</dt>
                  <dd className="text-right">{formatSeconds(segment.durationSeconds)}</dd>
                  <dt className="text-muted-foreground">{t('finalExportApproval.sourceRange')}</dt>
                  <dd className="text-right">
                    {formatMilliseconds(segment.trimInMs)}–{formatMilliseconds(segment.trimOutMs)}
                  </dd>
                  <dt className="text-muted-foreground">
                    {t('finalExportApproval.sourceDuration')}
                  </dt>
                  <dd className="text-right">{formatMilliseconds(segment.sourceDurationMs)}</dd>
                  <dt className="text-muted-foreground">{t('finalExportApproval.sourceStart')}</dt>
                  <dd className="text-right">{formatSeconds(segment.sourceStartSeconds)}</dd>
                  <dt className="text-muted-foreground">{t('finalExportApproval.variant')}</dt>
                  <dd className="text-right">{segment.selectedVariantIndex}</dd>
                  <dt className="text-muted-foreground">{t('finalExportApproval.speed')}</dt>
                  <dd className="text-right">{segment.speed}×</dd>
                  <dt className="text-muted-foreground">{t('finalExportApproval.assetFormat')}</dt>
                  <dd className="text-right">{segment.assetFormat}</dd>
                  {segment.sourceWidth && segment.sourceHeight && (
                    <>
                      <dt className="text-muted-foreground">
                        {t('finalExportApproval.sourceResolution')}
                      </dt>
                      <dd className="text-right">
                        {segment.sourceWidth}×{segment.sourceHeight}
                      </dd>
                    </>
                  )}
                </dl>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-lg border bg-background/70 p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t('finalExportApproval.output')}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-muted-foreground">{t('finalExportApproval.container')}</dt>
            <dd className="text-right">{manifest.output.container}</dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.codec')}</dt>
            <dd className="text-right">{manifest.output.codec}</dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.quality')}</dt>
            <dd className="text-right">{manifest.output.quality}</dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.resolution')}</dt>
            <dd className="text-right">
              {manifest.output.width}×{manifest.output.height}
            </dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.fps')}</dt>
            <dd className="text-right">{manifest.output.fps}</dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.fitMode')}</dt>
            <dd className="text-right">{manifest.output.fitMode ?? 'stretch'}</dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.fileName')}</dt>
            <dd className="truncate text-right">{manifest.output.logicalFileName}</dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.audioCodec')}</dt>
            <dd className="text-right">{manifest.output.audioCodec}</dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.pixelFormat')}</dt>
            <dd className="text-right">{manifest.output.pixelFormat}</dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.overwritePolicy')}</dt>
            <dd className="text-right">{manifest.output.overwritePolicy}</dd>
          </dl>
        </div>

        {(manifest.resolutionRisks?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-xs">
            <div className="flex items-center gap-2 font-medium text-amber-100">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t('finalExportApproval.resolutionRisks')}
            </div>
            <ul className="mt-2 space-y-1.5 text-amber-100/90">
              {manifest.resolutionRisks?.map((risk, index) => (
                <li key={`${risk.nodeId}:${risk.code}:${index}`}>
                  {risk.nodeId}: {t(`finalExportApproval.risk.${risk.code}`)} ({risk.source.width}×
                  {risk.source.height} → {risk.output.width}×{risk.output.height})
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border bg-background/70 p-3 text-xs">
            <div className="font-medium">
              {t('finalExportApproval.audioTracks')} ({manifest.audioTracks.length})
            </div>
            <p className="mt-1.5 text-muted-foreground">{t('finalExportApproval.noAudioTracks')}</p>
          </div>
          <div className="rounded-lg border bg-background/70 p-3 text-xs">
            <div className="font-medium">
              {t('finalExportApproval.subtitleTracks')} ({manifest.subtitleTracks.length})
            </div>
            <p className="mt-1.5 text-muted-foreground">
              {t('finalExportApproval.noSubtitleTracks')}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-cyan-400/20 bg-cyan-500/5 p-3 text-xs">
          <div className="flex items-center gap-2 font-medium text-cyan-100">
            <LockKeyhole className="h-3.5 w-3.5" />
            {t('finalExportApproval.capabilities')}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">{t('finalExportApproval.embeddedClipAudio')}</dt>
            <dd className="text-right">
              {manifest.capabilities.embeddedClipAudio
                ? t('finalExportApproval.supported')
                : t('finalExportApproval.unavailable')}
            </dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.separateAudioMix')}</dt>
            <dd className="text-right">
              {manifest.capabilities.separateAudioMix
                ? t('finalExportApproval.supported')
                : t('finalExportApproval.unavailable')}
            </dd>
            <dt className="text-muted-foreground">{t('finalExportApproval.subtitles')}</dt>
            <dd className="text-right">
              {manifest.capabilities.subtitles
                ? t('finalExportApproval.supported')
                : t('finalExportApproval.unavailable')}
            </dd>
          </dl>
        </div>

        <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {t('finalExportApproval.changeWarning')}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
          >
            {error}
          </div>
        )}

        <WorkflowRequestChangesForm onRequestChanges={onRequestChanges} onRequested={onRequested} />

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
          {submitting ? t('finalExportApproval.approving') : t('finalExportApproval.approve')}
        </button>
      </div>
    </section>
  );
}
