import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { RootState } from '../../../store/index.js';
import {
  recordConfirmationResolved,
  setConfirmAutoMode,
} from '../../../store/slices/commander.js';
import { markConfirmationResolvedLocally } from '../../../commander/state/commander-timeline-slice.js';
import { getAPI } from '../../../utils/api.js';
import type { PendingConfirmation } from '../../../commander/state/types.js';
import { ToolConfirmCard } from './ToolConfirmCard.js';

interface CommanderStreamViewProps {
  pendingConfirmation: PendingConfirmation | null | undefined;
  consecutiveConfirmCount: number;
  currentRunId?: string | null;
  t: (key: string) => string;
}

/**
 * The confirmation stays rendered until the IPC decision succeeds. This is
 * deliberately stricter than the old optimistic path: a rejected or failed
 * decision is recoverable in the same card rather than silently disappearing.
 */
export function CommanderStreamView({
  pendingConfirmation,
  consecutiveConfirmCount,
  currentRunId,
  t,
}: CommanderStreamViewProps) {
  const dispatch = useDispatch();
  const activeSessionId = useSelector((state: RootState) => state.commander.activeSessionId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSubmitting(false);
    setError(null);
  }, [pendingConfirmation?.toolCallId]);

  const resolveConfirmation = async (
    accept: boolean,
    autoMode: 'approve' | 'skip' | null = null,
  ) => {
    if (!pendingConfirmation) return;
    const api = getAPI();
    if (!api?.commander || !activeSessionId || !currentRunId) {
      setError(t('commander.toolConfirm.decisionUnavailable'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await api.commander.toolDecision({
        sessionId: activeSessionId,
        runId: currentRunId,
        toolCallId: pendingConfirmation.toolCallId,
        approved: accept,
      });
      if (!result.accepted) {
        setError(t('commander.toolConfirm.decisionRejected').replace('{code}', result.code));
        return;
      }
      if (autoMode) {
        dispatch(setConfirmAutoMode({ sessionId: activeSessionId, mode: autoMode }));
      }
      dispatch(
        markConfirmationResolvedLocally({
          sessionId: activeSessionId,
          runId: currentRunId,
          toolCallId: pendingConfirmation.toolCallId,
        }),
      );
      dispatch(recordConfirmationResolved(activeSessionId));
    } catch (decisionError) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : t('commander.toolConfirm.decisionFailed'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!pendingConfirmation) return null;

  return (
    <article aria-label={t('commander.toolConfirm.title')} className="space-y-1">
      <ToolConfirmCard
        toolName={pendingConfirmation.toolName}
        summary={pendingConfirmation.summary}
        details={pendingConfirmation.details}
        tier={pendingConfirmation.tier}
        onExecute={() => resolveConfirmation(true)}
        onSkip={() => resolveConfirmation(false)}
        disabled={submitting}
        status={submitting ? t('commander.toolConfirm.saving') : null}
        error={error}
        t={t}
      />
      {consecutiveConfirmCount >= 4 ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5 px-1 pb-1">
          <span className="mr-auto text-[10px] text-muted-foreground">
            {t('commander.confirmBatchHint')}
          </span>
          <button
            type="button"
            className="rounded border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/80 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
            disabled={submitting}
            onClick={() => void resolveConfirmation(false, 'skip')}
          >
            {t('commander.skipAll')}
          </button>
          <button
            type="button"
            className="rounded border border-primary/40 px-2 py-0.5 text-[10px] text-primary hover:bg-primary/10 disabled:cursor-wait disabled:opacity-60"
            disabled={submitting}
            onClick={() => void resolveConfirmation(true, 'approve')}
          >
            {t('commander.executeAll')}
          </button>
        </div>
      ) : null}
    </article>
  );
}
