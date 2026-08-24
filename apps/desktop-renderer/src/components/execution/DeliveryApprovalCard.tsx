import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FileVideo2,
  FolderOpen,
  LoaderCircle,
  PackageCheck,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  ApprovePlanGateResult,
  DeliveryManifestContent,
  DeliveryManifestContext,
  DeliveryManifestItem,
  DeliveryPackageTaskAttempt,
} from '@lucid-fin/contracts';
import { t } from '../../i18n.js';
import { getAPI } from '../../utils/api.js';

type DeliveryApprovalCardProps = {
  context: DeliveryManifestContext;
  onApprove?: () => Promise<ApprovePlanGateResult>;
  onApproved?: () => void;
};

const PACKAGE_STATUS_POLL_MS = 1_000;

type DeliveryPackageAttemptView = {
  attemptId: string;
  status: DeliveryPackageTaskAttempt['status'];
  progress: number;
  destinationPath: string;
  manifestRevision: number;
  manifestHash: string;
  attempt: number;
  error?: string;
};

type ReviewCutJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

type ReviewCutJobView = {
  jobId: string;
  status: ReviewCutJobStatus;
  progress: number;
  outputPath: string;
  manifestRevision: number;
  manifestHash: string;
  error?: string;
};

type ReviewCutApi = {
  start: (request: {
    taskListId: string;
    canvasId: string;
    expectedManifestRevision: number;
    expectedManifestHash: string;
  }) => Promise<{ cancelled: true } | { cancelled: false; job: ReviewCutJobView }>;
  status: (jobId: string) => Promise<ReviewCutJobView | null>;
  cancel: (jobId: string) => Promise<{ job: ReviewCutJobView | null }>;
  open: (jobId: string) => Promise<{ opened: true }>;
};

function formatMilliseconds(value: number): string {
  return `${value}ms`;
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}

function Reference({
  label,
  revision,
  hash,
}: {
  label: string;
  revision: number;
  hash: string;
}) {
  return (
    <div className="min-w-0 border-t border-border/60 pt-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {t('deliveryApproval.revision')} {revision}
        </span>
      </div>
      <code className="mt-1 block break-all text-[10px] text-muted-foreground">{hash}</code>
    </div>
  );
}

function Provenance({ item }: { item: DeliveryManifestItem }) {
  const values = [
    [t('deliveryApproval.assetCreatedAt'), String(item.provenance.assetCreatedAt)],
    [t('deliveryApproval.canvasNode'), item.provenance.nodeId],
    [t('deliveryApproval.task'), item.provenance.taskId],
    [t('deliveryApproval.attempt'), item.provenance.attemptId],
    [t('deliveryApproval.evaluation'), item.provenance.evaluationId],
    [t('deliveryApproval.promptAssembly'), item.provenance.promptAssemblyId],
    [t('deliveryApproval.provider'), item.provenance.providerId],
    [t('deliveryApproval.model'), item.provenance.model],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  return (
    <details className="mt-3 border-t border-border/60 pt-2 text-xs">
      <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
        {t('deliveryApproval.sourceEvidence')}
      </summary>
      <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">{t('deliveryApproval.selectedVideoHash')}</dt>
          <dd>
            <code className="mt-0.5 block break-all text-[10px]">{item.selectedVideoHash}</code>
          </dd>
        </div>
        {values.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function isActivePackageStatus(status: DeliveryPackageAttemptView['status']): boolean {
  return status === 'queued' || status === 'running' || status === 'ready_to_publish';
}

function isCancellablePackageStatus(status: DeliveryPackageAttemptView['status']): boolean {
  return status === 'queued' || status === 'running';
}

function packageProgress(status: DeliveryPackageAttemptView['status']): number {
  switch (status) {
    case 'queued':
      return 0;
    case 'running':
      return 10;
    case 'ready_to_publish':
    case 'recovery_required':
      return 90;
    case 'completed':
      return 100;
    case 'failed':
    case 'cancelled':
      return 0;
    default:
      return 0;
  }
}

function initialPackageAttempt(
  context: DeliveryManifestContext,
): DeliveryPackageAttemptView | null {
  const attempt = context.packageAttempt;
  if (!attempt) return null;
  return {
    attemptId: attempt.id,
    status: attempt.status,
    progress: packageProgress(attempt.status),
    destinationPath: attempt.destinationPath,
    manifestRevision: attempt.manifestRevision,
    manifestHash: attempt.manifestHash,
    attempt: attempt.attempt,
    ...(attempt.error ? { error: attempt.error } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : t('deliveryPackage.failure');
}

function getReviewCutApi(): ReviewCutApi | null {
  return (
    (getAPI() as unknown as { reviewCut?: ReviewCutApi } | undefined)?.reviewCut ?? null
  );
}

function reviewCutErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : t('reviewCut.failure');
}

function DeliveryPackageActions({ context }: { context: DeliveryManifestContext }) {
  const manifest = context.manifest.content as DeliveryManifestContent;
  const [attempt, setAttempt] = useState<DeliveryPackageAttemptView | null>(() =>
    initialPackageAttempt(context),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAttempt(initialPackageAttempt(context));
    setError(null);
  }, [context.manifest.contentHash, context.packageAttempt?.id, context.packageAttempt?.updatedAt]);

  useEffect(() => {
    if (!attempt || !isActivePackageStatus(attempt.status)) return;
    let disposed = false;

    const poll = async () => {
      try {
        const api = getAPI();
        if (!api?.deliveryPackage) throw new Error(t('deliveryPackage.unavailable'));
        const nextAttempt = await api.deliveryPackage.status(attempt.attemptId);
        if (!disposed && nextAttempt) setAttempt(nextAttempt);
      } catch (pollError) {
        if (!disposed) setError(errorMessage(pollError));
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), PACKAGE_STATUS_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [attempt?.attemptId, attempt?.status]);

  const start = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const api = getAPI();
      if (!api?.deliveryPackage) throw new Error(t('deliveryPackage.unavailable'));
      const result = await api.deliveryPackage.start({
        taskListId: context.taskList.id,
        canvasId: manifest.canvasId,
        expectedManifestRevision: context.manifest.revision,
        expectedManifestHash: context.manifest.contentHash,
      });
      if (!result.cancelled) setAttempt(result.attempt);
    } catch (startError) {
      setError(errorMessage(startError));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!attempt) return;
    setSubmitting(true);
    setError(null);
    try {
      const api = getAPI();
      if (!api?.deliveryPackage) throw new Error(t('deliveryPackage.unavailable'));
      const result = await api.deliveryPackage.cancel(attempt.attemptId);
      if (result.attempt) setAttempt(result.attempt);
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    if (!attempt) return;
    setSubmitting(true);
    setError(null);
    try {
      const api = getAPI();
      if (!api?.deliveryPackage) throw new Error(t('deliveryPackage.unavailable'));
      const result = await api.deliveryPackage.retry(attempt.attemptId);
      setAttempt(result.attempt);
    } catch (retryError) {
      setError(errorMessage(retryError));
    } finally {
      setSubmitting(false);
    }
  };

  const open = async () => {
    if (!attempt) return;
    setSubmitting(true);
    setError(null);
    try {
      const api = getAPI();
      if (!api?.deliveryPackage) throw new Error(t('deliveryPackage.unavailable'));
      await api.deliveryPackage.open(attempt.attemptId);
    } catch (openError) {
      setError(errorMessage(openError));
    } finally {
      setSubmitting(false);
    }
  };

  const active = attempt && isActivePackageStatus(attempt.status);
  const cancellable = attempt && isCancellablePackageStatus(attempt.status);

  return (
    <section
      aria-labelledby="delivery-package-action-title"
      className="rounded-lg border border-primary/30 bg-primary/5 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="delivery-package-action-title" className="font-semibold">
            {t('deliveryPackage.title')}
          </h3>
          <p className="mt-1 max-w-[70ch] text-xs leading-5 text-muted-foreground">
            {attempt ? t('deliveryPackage.exactManifest') : t('deliveryPackage.destinationNotice')}
          </p>
        </div>
        {attempt ? (
          <span className="lucid-badge shrink-0">{t(`deliveryPackage.status.${attempt.status}`)}</span>
        ) : null}
      </div>

      {attempt?.destinationPath ? (
        <p className="mt-3 truncate text-xs text-muted-foreground" title={attempt.destinationPath}>
          {t('deliveryPackage.destination')}: {attempt.destinationPath}
        </p>
      ) : null}

      {active ? (
        <div className="mt-3" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span>{t(`deliveryPackage.status.${attempt.status}`)}</span>
            <span>{Math.max(0, Math.min(100, Math.round(attempt.progress)))}%</span>
          </div>
          <div
            role="progressbar"
            aria-label={t('deliveryPackage.progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.max(0, Math.min(100, Math.round(attempt.progress)))}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.max(0, Math.min(100, attempt.progress))}%` }}
            />
          </div>
        </div>
      ) : null}

      {attempt?.status === 'failed' || attempt?.status === 'recovery_required' ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <div>{t(`deliveryPackage.status.${attempt.status}`)}</div>
          {attempt.error ? <div className="mt-1 break-words">{attempt.error}</div> : null}
        </div>
      ) : null}

      {attempt?.status === 'completed' ? (
        <div role="status" className="mt-3 text-xs text-emerald-600 dark:text-emerald-300">
          {t('deliveryPackage.completedNotice')}
        </div>
      ) : null}

      {attempt?.status === 'cancelled' ? (
        <div role="status" className="mt-3 text-xs text-muted-foreground">
          {t('deliveryPackage.cancelledNotice')}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {!attempt ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
            {submitting ? t('deliveryPackage.starting') : t('deliveryPackage.start')}
          </button>
        ) : null}
        {cancellable ? (
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            {submitting ? t('deliveryPackage.cancelling') : t('deliveryPackage.cancel')}
          </button>
        ) : null}
        {attempt?.status === 'failed' || attempt?.status === 'recovery_required' ? (
          <button
            type="button"
            onClick={() => void retry()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {submitting ? t('deliveryPackage.retrying') : t('deliveryPackage.retry')}
          </button>
        ) : null}
        {attempt?.status === 'cancelled' ? (
          <button
            type="button"
            onClick={() => void retry()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {submitting ? t('deliveryPackage.restarting') : t('deliveryPackage.restart')}
          </button>
        ) : null}
        {attempt?.status === 'completed' ? (
          <button
            type="button"
            onClick={() => void open()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
            {submitting ? t('deliveryPackage.opening') : t('deliveryPackage.open')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function isActiveReviewCutStatus(status: ReviewCutJobStatus): boolean {
  return status === 'queued' || status === 'running';
}

function ReviewCutActions({ context }: { context: DeliveryManifestContext }) {
  const manifest = context.manifest.content as DeliveryManifestContent;
  const [job, setJob] = useState<ReviewCutJobView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setJob(null);
    setError(null);
  }, [context.manifest.contentHash]);

  useEffect(() => {
    if (!job || !isActiveReviewCutStatus(job.status)) return;
    let disposed = false;

    const poll = async () => {
      try {
        const api = getReviewCutApi();
        if (!api) throw new Error(t('reviewCut.unavailable'));
        const nextJob = await api.status(job.jobId);
        if (disposed) return;
        if (nextJob) {
          setJob(nextJob);
        } else {
          setJob(null);
          setError(t('reviewCut.statusUnavailable'));
        }
      } catch (pollError) {
        if (!disposed) setError(reviewCutErrorMessage(pollError));
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), PACKAGE_STATUS_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [job?.jobId, job?.status]);

  const start = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const api = getReviewCutApi();
      if (!api) throw new Error(t('reviewCut.unavailable'));
      const result = await api.start({
        taskListId: context.taskList.id,
        canvasId: manifest.canvasId,
        expectedManifestRevision: context.manifest.revision,
        expectedManifestHash: context.manifest.contentHash,
      });
      if (!result.cancelled) setJob(result.job);
    } catch (startError) {
      setError(reviewCutErrorMessage(startError));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    setSubmitting(true);
    setError(null);
    try {
      const api = getReviewCutApi();
      if (!api) throw new Error(t('reviewCut.unavailable'));
      const result = await api.cancel(job.jobId);
      if (result.job) setJob(result.job);
    } catch (cancelError) {
      setError(reviewCutErrorMessage(cancelError));
    } finally {
      setSubmitting(false);
    }
  };

  const open = async () => {
    if (!job) return;
    setSubmitting(true);
    setError(null);
    try {
      const api = getReviewCutApi();
      if (!api) throw new Error(t('reviewCut.unavailable'));
      await api.open(job.jobId);
    } catch (openError) {
      setError(reviewCutErrorMessage(openError));
    } finally {
      setSubmitting(false);
    }
  };

  const active = job && isActiveReviewCutStatus(job.status);

  return (
    <section
      aria-labelledby="review-cut-action-title"
      className="rounded-lg border border-border bg-muted/20 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="review-cut-action-title" className="font-semibold">
            {t('reviewCut.title')}
          </h3>
          <p className="mt-1 max-w-[70ch] text-xs leading-5 text-muted-foreground">
            {t('reviewCut.derivedNotice')}
          </p>
        </div>
        {job ? <span className="lucid-badge shrink-0">{t(`reviewCut.status.${job.status}`)}</span> : null}
      </div>

      {job?.outputPath ? (
        <p className="mt-3 truncate text-xs text-muted-foreground" title={job.outputPath}>
          {t('reviewCut.output')}: {job.outputPath}
        </p>
      ) : null}

      {active ? (
        <div className="mt-3" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span>{t(`reviewCut.status.${job.status}`)}</span>
            <span>{Math.max(0, Math.min(100, Math.round(job.progress)))}%</span>
          </div>
          <div
            role="progressbar"
            aria-label={t('reviewCut.progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.max(0, Math.min(100, Math.round(job.progress)))}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-background"
          >
            <div
              className="h-full rounded-full bg-foreground/70 transition-[width] duration-200"
              style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
            />
          </div>
        </div>
      ) : null}

      {job?.status === 'failed' ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <div>{t('reviewCut.status.failed')}</div>
          {job.error ? <div className="mt-1 break-words">{job.error}</div> : null}
        </div>
      ) : null}

      {job?.status === 'completed' ? (
        <div role="status" className="mt-3 text-xs text-emerald-600 dark:text-emerald-300">
          {t('reviewCut.completedNotice')}
        </div>
      ) : null}

      {job?.status === 'cancelled' ? (
        <div role="status" className="mt-3 text-xs text-muted-foreground">
          {t('reviewCut.cancelledNotice')}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {!job || job.status === 'failed' || job.status === 'cancelled' ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileVideo2 className="h-4 w-4" />}
            {submitting
              ? t('reviewCut.starting')
              : job
                ? t('reviewCut.startAgain')
                : t('reviewCut.start')}
          </button>
        ) : null}
        {active ? (
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            {submitting ? t('reviewCut.cancelling') : t('reviewCut.cancel')}
          </button>
        ) : null}
        {job?.status === 'completed' ? (
          <button
            type="button"
            onClick={() => void open()}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
            {submitting ? t('reviewCut.opening') : t('reviewCut.open')}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function DeliveryApprovalCard({
  context,
  onApprove,
  onApproved,
}: DeliveryApprovalCardProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manifest = context.manifest.content as DeliveryManifestContent;
  const approved = context.approval.status === 'approved';

  const approve = async () => {
    if (!onApprove) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onApprove();
      if (!result.ok) {
        setError(`${t('deliveryApproval.failure')} (${result.code})`);
        return;
      }
      onApproved?.();
    } catch (approvalError) {
      setError(
        approvalError instanceof Error ? approvalError.message : t('deliveryApproval.failure'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-labelledby="delivery-approval-title"
      className="overflow-hidden rounded-xl border border-border/70 bg-card/70"
    >
      <header className="border-b border-border/60 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <PackageCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="delivery-approval-title" className="text-base font-semibold">
              {approved ? t('deliveryPackage.approvedTitle') : t('deliveryApproval.title')}
            </h2>
            <p className="mt-1 max-w-[70ch] text-xs leading-5 text-muted-foreground">
              {approved ? t('deliveryPackage.approvedNotice') : t('deliveryApproval.guardrail')}
            </p>
          </div>
          <span className="lucid-badge shrink-0">
            {t('deliveryApproval.revision')} {context.manifest.revision}
          </span>
        </div>
      </header>

      <div className="space-y-5 p-4 text-sm">
        <section aria-labelledby="delivery-package-heading">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 id="delivery-package-heading" className="font-semibold">
                {manifest.namingPolicy.packageBaseName}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {manifest.items.length} {t('deliveryApproval.sourceVideos')}
              </p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <div>{t('deliveryApproval.canvas')}</div>
              <div className="mt-0.5 max-w-48 truncate font-medium text-foreground" title={manifest.canvasId}>
                {manifest.canvasId}
              </div>
            </div>
          </div>
          <dl className="mt-3 grid gap-x-4 gap-y-2 border-y border-border/60 py-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t('deliveryApproval.orderPrefixWidth')}</dt>
              <dd className="mt-0.5 font-medium">{manifest.namingPolicy.orderPrefixWidth}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('deliveryApproval.separator')}</dt>
              <dd className="mt-0.5 font-medium">{manifest.namingPolicy.separator}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('deliveryApproval.overwritePolicy')}</dt>
              <dd className="mt-0.5 font-medium">
                {t(`deliveryApproval.overwrite.${manifest.namingPolicy.overwritePolicy}`)}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="delivery-references-heading">
          <h3 id="delivery-references-heading" className="text-xs font-semibold">
            {t('deliveryApproval.lockedReferences')}
          </h3>
          <div className="mt-2 grid gap-x-4 gap-y-3 sm:grid-cols-3">
            <Reference
              label={t('deliveryApproval.productionPlan')}
              revision={manifest.productionPlan.revision}
              hash={manifest.productionPlan.contentHash}
            />
            <Reference
              label={t('deliveryApproval.visualConstitution')}
              revision={manifest.visualConstitution.revision}
              hash={manifest.visualConstitution.contentHash}
            />
            <Reference
              label={t('deliveryApproval.deliverySequence')}
              revision={manifest.deliverySequence.revision}
              hash={manifest.deliverySequence.contentHash}
            />
          </div>
        </section>

        <section aria-labelledby="delivery-videos-heading">
          <div className="flex items-center justify-between gap-3">
            <h3 id="delivery-videos-heading" className="font-semibold">
              {t('deliveryApproval.orderedVideos')}
            </h3>
            <span className="text-xs text-muted-foreground">{manifest.items.length}</span>
          </div>
          <ol className="mt-2 divide-y divide-border/60 border-y border-border/60">
            {manifest.items.map((item, index) => {
              const audioEnabled = item.hasEmbeddedAudio && item.embeddedAudioEnabled;
              return (
                <li key={`${item.shotId}:${item.selectedVideoHash}`} className="py-4 first:pt-3 last:pb-3">
                  <article>
                    <div className="flex items-start gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                        {String(index + 1).padStart(manifest.namingPolicy.orderPrefixWidth, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium" title={item.packageFileName}>
                              {item.packageFileName}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                              <FileVideo2 className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate" title={item.sourceFileName}>
                                {item.sourceFileName}
                              </span>
                            </div>
                          </div>
                          <span className="shrink-0 text-xs text-muted-foreground">{item.shotId}</span>
                        </div>

                        <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <dt className="text-muted-foreground">{t('deliveryApproval.trim')}</dt>
                            <dd className="mt-0.5 font-medium">
                              {formatMilliseconds(item.trimInMs)}–{formatMilliseconds(item.trimOutMs)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">{t('deliveryApproval.sourceDuration')}</dt>
                            <dd className="mt-0.5 font-medium">
                              {formatMilliseconds(item.sourceDurationMs)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">{t('deliveryApproval.source')}</dt>
                            <dd className="mt-0.5 font-medium">
                              {item.sourceWidth && item.sourceHeight
                                ? `${item.sourceWidth}×${item.sourceHeight} · `
                                : ''}
                              {item.sourceFormat} · {formatBytes(item.sourceBytes)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">{t('deliveryApproval.embeddedAudio')}</dt>
                            <dd className="mt-0.5 flex items-center gap-1.5 font-medium">
                              {audioEnabled ? (
                                <Volume2 className="h-3.5 w-3.5 text-primary" />
                              ) : (
                                <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                              {item.hasEmbeddedAudio
                                ? audioEnabled
                                  ? t('deliveryApproval.audioEnabled')
                                  : t('deliveryApproval.audioDisabled')
                                : t('deliveryApproval.noEmbeddedAudio')}
                            </dd>
                          </div>
                        </dl>
                        <Provenance item={item} />
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        </section>

        <details
          aria-label={`${t('assetBrowser.details')}: ${t('deliveryApproval.manifestHash')}`}
          className="border-y border-border/60 py-2.5 text-xs"
        >
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
            {t('deliveryApproval.manifestEvidence')}
          </summary>
          <dl className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('deliveryApproval.manifestHash')}</dt>
              <dd>
                <code className="mt-0.5 block break-all text-[10px]">{context.manifest.contentHash}</code>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('deliveryApproval.taskList')}</dt>
              <dd className="mt-0.5 break-all">{manifest.taskListId}</dd>
            </div>
          </dl>
        </details>

        <p className="rounded-md bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {t('deliveryApproval.changeWarning')}
        </p>

        {error && !approved && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        )}

        {approved ? (
          <>
            <DeliveryPackageActions context={context} />
            <ReviewCutActions context={context} />
          </>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => void approve()}
              disabled={submitting || !onApprove}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
            >
              {submitting ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {submitting ? t('deliveryApproval.approving') : t('deliveryApproval.approve')}
            </button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {t('deliveryApproval.noAutomaticExport')}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
