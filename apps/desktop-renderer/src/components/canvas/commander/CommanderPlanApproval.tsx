import { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type {
  DeliveryManifestContext,
  TaskListSummary,
  PlanApprovalContext,
  VisualAuditionContext,
} from '@lucid-fin/contracts';

import { getAPI } from '../../../utils/api.js';
import { ProductionPlanApprovalCard } from '../../execution/ProductionPlanApprovalCard.js';
import { VisualConstitutionApprovalCard } from '../../execution/VisualConstitutionApprovalCard.js';
import { DeliveryApprovalCard } from '../../execution/DeliveryApprovalCard.js';
import type { RootState } from '../../../store/index.js';
import { loadTaskLists } from '../../../store/slices/task-lists.js';
import {
  belongsToCommanderSession,
  newestActiveMoviePlansForSession,
} from './task-list-session.js';

interface CommanderPlanApprovalProps {
  canvasId: string | null;
  sessionId: string | null;
  t: (key: string) => string;
  onContentChange?: () => void;
}

const VISUAL_AUDITION_POLL_MS = 2_000;

function isCompleteVisualAudition(
  context: VisualAuditionContext | null | undefined,
): context is VisualAuditionContext {
  return (context?.document.content as { status?: unknown } | undefined)?.status === 'complete';
}

function hasPendingVisualAuditionReplacement(context: VisualAuditionContext): boolean {
  const request = context.taskList.metadata.visualAuditionRevisionRequest;
  if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
  const value = request as Record<string, unknown>;
  return (
    value.previousRevision === context.document.revision &&
    value.previousHash === context.document.contentHash &&
    typeof value.reason === 'string' &&
    value.reason.trim().length > 0
  );
}

export function CommanderPlanApproval({
  canvasId,
  sessionId,
  t,
  onContentChange,
}: CommanderPlanApprovalProps) {
  const dispatch = useDispatch();
  const observedPlanRevision = useSelector((state: RootState) => {
    if (!canvasId || !sessionId) return null;
    const revisions = state.taskLists.allIds.flatMap((id) => {
      const taskList = state.taskLists.summariesById[id];
      return taskList &&
        taskList.taskListType === 'movie.production.v2' &&
        taskList.entityType === 'canvas' &&
        taskList.entityId === canvasId &&
        belongsToCommanderSession(taskList, sessionId)
        ? [
            `${taskList.id}:${taskList.updatedAt}:${taskList.status}:${taskList.currentPhaseKey ?? ''}`,
          ]
        : [];
    });
    return revisions.length > 0 ? revisions.sort().join('|') : null;
  });
  const hasReadyStyleExploration = useSelector((state: RootState) => {
    if (!canvasId || !sessionId) return false;
    return state.taskLists.allIds.some((id) => {
      const taskList = state.taskLists.summariesById[id];
      return (
        taskList?.taskListType === 'movie.production.v2' &&
        taskList.entityType === 'canvas' &&
        taskList.entityId === canvasId &&
        belongsToCommanderSession(taskList, sessionId) &&
        taskList.status === 'ready' &&
        taskList.currentPhaseKey === 'style-exploration'
      );
    });
  });
  const [summary, setSummary] = useState<TaskListSummary | null>(null);
  const [approval, setApproval] = useState<PlanApprovalContext | null>(null);
  const [visualAudition, setVisualAudition] = useState<VisualAuditionContext | null>(null);
  const [delivery, setDelivery] = useState<DeliveryManifestContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!canvasId || !sessionId || !api?.taskLists) {
      setSummary(null);
      setApproval(null);
      setVisualAudition(null);
      setDelivery(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const summaries = await api.taskLists.list();
      const plans = newestActiveMoviePlansForSession(summaries, canvasId, sessionId);
      setSummary(null);
      setApproval(null);
      setVisualAudition(null);
      setDelivery(null);

      for (const nextSummary of plans) {
        const nextApproval = await api.taskLists.getPendingApproval(nextSummary.id);
        if (nextApproval) {
          setSummary(nextSummary);
          setApproval(nextApproval);
          if (nextApproval.approval.gateKey === 'visual_constitution') {
            const nextVisualAudition = await api.taskLists.getVisualAuditions(nextSummary.id);
            if (!isCompleteVisualAudition(nextVisualAudition)) {
              throw new Error(t('planApproval.unavailable'));
            }
            setVisualAudition(nextVisualAudition);
          }
          if (nextApproval.approval.gateKey === 'delivery') {
            setDelivery({
              taskList: nextApproval.taskList,
              approval: nextApproval.approval,
              manifest: nextApproval.document,
            });
          }
          return;
        }

        if (nextSummary.status === 'awaiting_approval') {
          throw new Error(t('planApproval.unavailable'));
        }

        if (
          nextSummary.status === 'ready' &&
          nextSummary.currentPhaseKey === 'delivery'
        ) {
          const nextDelivery = await api.taskLists.getDelivery(nextSummary.id);
          if (nextDelivery?.approval.status === 'approved') {
            setSummary(nextSummary);
            setDelivery(nextDelivery);
            return;
          }
        }

        if (nextSummary.status !== 'ready' || nextSummary.currentPhaseKey !== 'style-exploration') {
          continue;
        }

        const nextVisualAudition = await api.taskLists.getVisualAuditions(nextSummary.id);
        if (
          isCompleteVisualAudition(nextVisualAudition) &&
          !hasPendingVisualAuditionReplacement(nextVisualAudition)
        ) {
          setSummary(nextSummary);
          setVisualAudition(nextVisualAudition);
          return;
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [canvasId, sessionId, t]);

  useEffect(() => {
    void refresh();
  }, [observedPlanRevision, refresh]);

  useEffect(() => {
    if (error || approval || visualAudition || !hasReadyStyleExploration) return;
    const interval = window.setInterval(() => void refresh(), VISUAL_AUDITION_POLL_MS);
    return () => window.clearInterval(interval);
  }, [approval, error, hasReadyStyleExploration, refresh, visualAudition]);

  useEffect(() => {
    onContentChange?.();
  }, [
    approval?.document.contentHash,
    delivery?.manifest.contentHash,
    error,
    loading,
    onContentChange,
    summary?.updatedAt,
    visualAudition?.document.contentHash,
  ]);

  const afterDecision = useCallback(() => {
    dispatch(loadTaskLists({}));
    void refresh();
  }, [dispatch, refresh]);

  const approve = useCallback(async () => {
    const api = getAPI();
    if (!api?.taskLists || !approval) throw new Error(t('planApproval.failure'));
    return api.taskLists.approveGate({
      taskListId: approval.taskList.id,
      gateKey: approval.approval.gateKey,
      expectedRowVersion: approval.taskList.rowVersion ?? 0,
      expectedSubjectRevision: approval.approval.subjectRevision,
      expectedSubjectHash: approval.approval.subjectHash,
    });
  }, [approval, t]);

  if (!summary && !loading && !error) return null;

  return (
    <section
      aria-label={t('commander.planApproval.title')}
      className="my-5 border-y border-border/60 py-5"
    >
      {loading && !approval ? (
        <div className="text-sm text-muted-foreground">{t('planApproval.loading')}</div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{error}</span>
          <button
            type="button"
            className="rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium hover:bg-destructive/10"
            onClick={() => void refresh()}
          >
            {t('action.retry')}
          </button>
        </div>
      ) : null}
      {approval?.approval.gateKey === 'production_plan' ? (
        <ProductionPlanApprovalCard context={approval} />
      ) : null}
      {visualAudition && (!approval || approval.approval.gateKey === 'visual_constitution') ? (
        <VisualConstitutionApprovalCard
          auditionContext={visualAudition}
          approvalContext={approval}
          onSelect={async (candidateId) => {
            const api = getAPI();
            if (!api?.taskLists) throw new Error(t('planApproval.failure'));
            const result = await api.taskLists.selectVisualCandidate({
              taskListId: visualAudition.taskList.id,
              candidateId,
              expectedRowVersion: visualAudition.taskList.rowVersion ?? 0,
              expectedAuditionRevision: visualAudition.document.revision,
              expectedAuditionHash: visualAudition.document.contentHash,
            });
            setApproval(result.context);
            setVisualAudition((current) =>
              current ? { ...current, taskList: result.context.taskList } : current,
            );
            return result;
          }}
          onApprove={approve}
          onApproved={afterDecision}
        />
      ) : null}
      {delivery ? (
        <DeliveryApprovalCard
          context={delivery}
          {...(approval?.approval.gateKey === 'delivery'
            ? { onApprove: approve, onApproved: afterDecision }
            : {})}
        />
      ) : null}
    </section>
  );
}
