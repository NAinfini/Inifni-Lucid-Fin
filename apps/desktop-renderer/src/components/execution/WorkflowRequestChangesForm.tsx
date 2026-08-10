import React, { useCallback, useState } from 'react';
import { LoaderCircle, MessageSquareText } from 'lucide-react';
import { t } from '../../i18n.js';

type WorkflowRequestChangesFormProps = {
  onRequestChanges?: (reason: string) => Promise<unknown>;
  onRequested?: () => void;
};

function rejectionMessage(result: unknown): string | null {
  if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== false) {
    return null;
  }

  if ('code' in result && typeof result.code === 'string') {
    return `${t('workflowApproval.requestChangesFailure')} (${result.code})`;
  }

  return t('workflowApproval.requestChangesFailure');
}

export function WorkflowRequestChangesForm({
  onRequestChanges,
  onRequested,
}: WorkflowRequestChangesFormProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedReason = reason.trim();

  const submit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!onRequestChanges || !normalizedReason) {
        setError(t('workflowApproval.requestChangesRequired'));
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        const result = await onRequestChanges(normalizedReason);
        const rejected = rejectionMessage(result);
        if (rejected) {
          setError(rejected);
          return;
        }
        setReason('');
        setOpen(false);
        onRequested?.();
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : t('workflowApproval.requestChangesFailure'),
        );
      } finally {
        setSubmitting(false);
      }
    },
    [normalizedReason, onRequestChanges, onRequested],
  );

  if (!onRequestChanges) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-100 hover:bg-amber-500/15"
      >
        <MessageSquareText className="h-4 w-4" />
        {t('workflowApproval.requestChanges')}
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="space-y-3 rounded-lg border border-amber-400/30 bg-amber-500/5 p-3"
    >
      <div>
        <label htmlFor="workflow-request-changes-reason" className="text-xs font-medium">
          {t('workflowApproval.requestChangesReason')}
        </label>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          {t('workflowApproval.requestChangesHint')}
        </p>
        <textarea
          id="workflow-request-changes-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('workflowApproval.requestChangesPlaceholder')}
          rows={3}
          required
          className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-amber-300"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setOpen(false);
          }}
          disabled={submitting}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60"
        >
          {t('action.cancel')}
        </button>
        <button
          type="submit"
          disabled={!normalizedReason || submitting}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-400 px-3 py-1.5 text-xs font-medium text-amber-950 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          {submitting
            ? t('workflowApproval.requestingChanges')
            : t('workflowApproval.submitRequestChanges')}
        </button>
      </div>
    </form>
  );
}
