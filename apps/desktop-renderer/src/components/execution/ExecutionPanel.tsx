import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  PauseCircle,
  PlayCircle,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { RootState } from '../../store/index.js';
import {
  cancelWorkflow,
  loadWorkflowStages,
  loadWorkflowTasks,
  loadWorkflows,
  pauseWorkflow,
  resumeWorkflow,
} from '../../store/slices/workflows.js';
import { t } from '../../i18n.js';
import { QuestionCard } from '../canvas/commander/QuestionCard.js';
import { WorkflowDetailDrawer } from './WorkflowDetailDrawer.js';

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-slate-500/15 text-slate-300 border-slate-400/20',
  awaiting_approval: 'bg-amber-500/15 text-amber-200 border-amber-400/30',
  blocked: 'bg-amber-500/15 text-amber-300 border-amber-400/20',
  ready: 'bg-sky-500/15 text-sky-300 border-sky-400/20',
  running: 'bg-blue-500/15 text-blue-300 border-blue-400/20',
  paused: 'bg-orange-500/15 text-orange-300 border-orange-400/20',
  failed: 'bg-red-500/15 text-red-300 border-red-400/20',
  completed_with_errors: 'bg-rose-500/15 text-rose-300 border-rose-400/20',
  cancelled: 'bg-zinc-500/15 text-zinc-300 border-zinc-400/20',
};

const VISIBLE_STATUSES = new Set([
  'pending',
  'awaiting_approval',
  'blocked',
  'ready',
  'running',
  'paused',
  'failed',
  'completed_with_errors',
]);

const ACTIVE_STATUSES = new Set([
  'pending',
  'awaiting_approval',
  'blocked',
  'ready',
  'running',
  'paused',
]);

const ATTENTION_STATUSES = new Set(['failed', 'completed_with_errors']);

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return t('execution.status.pending');
    case 'awaiting_approval':
      return t('execution.status.awaitingApproval');
    case 'blocked':
      return t('execution.status.blocked');
    case 'ready':
      return t('execution.status.ready');
    case 'running':
      return t('execution.status.running');
    case 'paused':
      return t('execution.status.paused');
    case 'failed':
      return t('execution.status.failed');
    case 'completed_with_errors':
      return t('execution.status.completedWithErrors');
    case 'cancelled':
      return t('execution.status.cancelled');
    default:
      return status;
  }
}

type ExecutionPanelProps = {
  entityId?: string;
};

type WorkflowDecisionOption = {
  id: string;
  label: string;
  description?: string;
};

type PendingWorkflowDecision = {
  id: string;
  workflowRunId: string;
  canvasId: string;
  questionId: string;
  question: string;
  options: WorkflowDecisionOption[];
  allowFreeText: boolean;
  status: 'pending' | 'recovery_required';
};

type WorkflowDecisionListApi = {
  listPendingDecisions: (filter: { canvasId: string }) => Promise<unknown>;
};

type CommanderQuestionApi = {
  answerQuestion: (canvasId: string, questionId: string, answer: string) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWorkflowDecisionOption(value: unknown): value is WorkflowDecisionOption {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    (value.description === undefined || typeof value.description === 'string')
  );
}

function isPendingWorkflowDecision(value: unknown): value is PendingWorkflowDecision {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.workflowRunId === 'string' &&
    typeof value.canvasId === 'string' &&
    typeof value.questionId === 'string' &&
    typeof value.question === 'string' &&
    Array.isArray(value.options) &&
    value.options.every(isWorkflowDecisionOption) &&
    typeof value.allowFreeText === 'boolean' &&
    (value.status === 'pending' || value.status === 'recovery_required')
  );
}

function hasWorkflowDecisionList(value: unknown): value is WorkflowDecisionListApi {
  return (
    isRecord(value) &&
    'listPendingDecisions' in value &&
    typeof value.listPendingDecisions === 'function'
  );
}

function hasCommanderQuestionApi(value: unknown): value is CommanderQuestionApi {
  return isRecord(value) && 'answerQuestion' in value && typeof value.answerQuestion === 'function';
}

function pendingWorkflowDecisions(value: unknown, canvasId: string): PendingWorkflowDecision[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (decision): decision is PendingWorkflowDecision =>
      isPendingWorkflowDecision(decision) && decision.canvasId === canvasId,
  );
}

export function ExecutionPanel({ entityId }: ExecutionPanelProps) {
  const dispatch = useDispatch();
  const { allIds, summariesById, stagesByWorkflowId, tasksByWorkflowId } = useSelector(
    (state: RootState) => state.workflows,
  );
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null);
  const [reviewWorkflowId, setReviewWorkflowId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<PendingWorkflowDecision[]>([]);
  const [decisionsLoading, setDecisionsLoading] = useState(false);
  const [decisionLoadError, setDecisionLoadError] = useState<string | null>(null);
  const [answeringDecisionId, setAnsweringDecisionId] = useState<string | null>(null);
  const [decisionAnswerError, setDecisionAnswerError] = useState<{
    decisionId: string;
    message: string;
  } | null>(null);
  const [decisionRefreshVersion, setDecisionRefreshVersion] = useState(0);

  const workflows = useMemo(() => {
    return allIds
      .map((id) => summariesById[id])
      .filter((workflow): workflow is NonNullable<typeof workflow> => !!workflow)
      .filter((workflow) => !entityId || workflow.entityId === entityId)
      .filter((workflow) => VISIBLE_STATUSES.has(workflow.status));
  }, [allIds, entityId, summariesById]);

  const workflowRefreshKey = useMemo(
    () =>
      workflows
        .map((workflow) => `${workflow.id}:${workflow.status}:${workflow.updatedAt}`)
        .join('|'),
    [workflows],
  );

  const refreshWorkflowDetails = useCallback(
    (workflowRunIds: Iterable<string>) => {
      for (const workflowRunId of new Set(workflowRunIds)) {
        if (!workflowRunId) continue;
        dispatch(loadWorkflowStages(workflowRunId));
        dispatch(loadWorkflowTasks(workflowRunId));
      }
    },
    [dispatch],
  );

  useEffect(() => {
    if (!entityId) return;
    refreshWorkflowDetails(workflows.map((workflow) => workflow.id));
  }, [entityId, refreshWorkflowDetails, workflows]);

  useEffect(() => {
    let cancelled = false;

    if (!entityId) {
      setDecisions([]);
      setDecisionLoadError(null);
      setDecisionsLoading(false);
      return;
    }

    const workflowApi: unknown = window.lucidAPI?.workflow;
    if (!hasWorkflowDecisionList(workflowApi)) {
      setDecisions([]);
      setDecisionLoadError(null);
      setDecisionsLoading(false);
      return;
    }

    setDecisionsLoading(true);
    setDecisionLoadError(null);
    void workflowApi
      .listPendingDecisions({ canvasId: entityId })
      .then((result) => {
        if (cancelled) return;

        const loadedDecisions = pendingWorkflowDecisions(result, entityId);
        setDecisions(loadedDecisions);
        refreshWorkflowDetails(loadedDecisions.map((decision) => decision.workflowRunId));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDecisionLoadError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setDecisionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [decisionRefreshVersion, entityId, refreshWorkflowDetails, workflowRefreshKey]);

  const answerDecision = useCallback(
    async (decision: PendingWorkflowDecision, answer: string) => {
      if (!entityId || !answer.trim()) return;

      const commanderApi: unknown = window.lucidAPI?.commander;
      if (!hasCommanderQuestionApi(commanderApi)) {
        setDecisionAnswerError({
          decisionId: decision.id,
          message: t('execution.decisions.answerUnavailable'),
        });
        return;
      }

      setAnsweringDecisionId(decision.id);
      setDecisionAnswerError(null);
      try {
        await commanderApi.answerQuestion(entityId, decision.questionId, answer.trim());
        refreshWorkflowDetails([decision.workflowRunId]);
        dispatch(loadWorkflows({ entityType: 'canvas' }));
        setDecisionRefreshVersion((version) => version + 1);
      } catch (error) {
        setDecisionAnswerError({
          decisionId: decision.id,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setAnsweringDecisionId(null);
      }
    },
    [dispatch, entityId, refreshWorkflowDetails],
  );

  const activeCount = workflows.filter((workflow) => ACTIVE_STATUSES.has(workflow.status)).length;
  const attentionCount = workflows.filter((workflow) =>
    ATTENTION_STATUSES.has(workflow.status),
  ).length;
  const hasPanelContent =
    workflows.length > 0 || decisions.length > 0 || decisionsLoading || decisionLoadError !== null;

  if (!hasPanelContent) {
    return (
      <div className="p-3 text-xs text-muted-foreground">{t('layout.noWorkflowActivity')}</div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-card">
      <div className="sticky top-0 z-10 border-b bg-card/95 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('layout.executionPanel')}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
              {t('execution.active')}: {activeCount}
            </span>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
              {t('execution.attention')}: {attentionCount}
            </span>
          </div>
        </div>
      </div>

      <div className="divide-y divide-border/70">
        {(decisionsLoading || decisionLoadError || decisions.length > 0) && (
          <section aria-labelledby="workflow-decisions-title" className="space-y-2 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <h2
                id="workflow-decisions-title"
                className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
              >
                {t('execution.decisions.title')}
              </h2>
              {decisionsLoading && (
                <span role="status" className="text-[10px] text-muted-foreground">
                  {t('execution.decisions.loading')}
                </span>
              )}
            </div>

            {decisionLoadError && (
              <p
                role="alert"
                className="rounded-md border border-red-400/30 bg-red-500/10 px-2.5 py-2 text-xs text-red-200"
              >
                {decisionLoadError}
              </p>
            )}

            {decisions.map((decision) =>
              decision.status === 'pending' ? (
                <div
                  key={decision.id}
                  className="rounded-lg border border-blue-400/25 bg-blue-500/[0.03] py-1"
                >
                  <QuestionCard
                    question={decision.question}
                    options={decision.options}
                    allowFreeText={decision.allowFreeText}
                    disabled={answeringDecisionId !== null}
                    onAnswer={(answer) => {
                      void answerDecision(decision, answer);
                    }}
                    t={t}
                  />
                  {decisionAnswerError?.decisionId === decision.id && (
                    <p role="alert" className="mx-3 mb-2 text-xs text-red-300">
                      {t('execution.decisions.answerFailed')}: {decisionAnswerError.message}
                    </p>
                  )}
                </div>
              ) : (
                <section
                  key={decision.id}
                  aria-label={t('execution.decisions.recoveryRequired')}
                  className="flex gap-2 rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-2.5 text-amber-100"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <div>
                    <h3 className="text-xs font-medium">
                      {t('execution.decisions.recoveryRequired')}
                    </h3>
                    <p className="mt-1 text-xs text-amber-100/85">
                      {t('execution.decisions.recoveryDescription')}
                    </p>
                  </div>
                </section>
              ),
            )}
          </section>
        )}
        {workflows.map((workflow) => {
          const expanded = expandedWorkflowId === workflow.id;
          const tasks = tasksByWorkflowId[workflow.id] ?? [];
          const stages = stagesByWorkflowId[workflow.id] ?? [];
          const canPause =
            workflow.status === 'running' ||
            workflow.status === 'ready' ||
            workflow.status === 'blocked';
          const canResume = workflow.status === 'paused';
          const canCancel =
            workflow.status !== 'failed' &&
            workflow.status !== 'cancelled' &&
            workflow.status !== 'completed_with_errors';

          return (
            <div key={workflow.id} className="px-3 py-2">
              <div className="rounded-lg border border-border/70 bg-background/60 p-3 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      workflow.status === 'failed'
                        ? 'bg-red-400 shadow-[0_0_0_4px_rgba(248,113,113,0.12)]'
                        : workflow.status === 'paused'
                          ? 'bg-orange-400 shadow-[0_0_0_4px_rgba(251,146,60,0.12)]'
                          : workflow.status === 'running'
                            ? 'bg-blue-400 shadow-[0_0_0_4px_rgba(96,165,250,0.16)]'
                            : 'bg-slate-400 shadow-[0_0_0_4px_rgba(148,163,184,0.12)]'
                    }`}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {workflow.displayLabel}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                          STATUS_BADGE[workflow.status] ??
                          'border-border bg-muted text-muted-foreground'
                        }`}
                      >
                        {statusLabel(workflow.status)}
                      </span>
                      {workflow.provider && (
                        <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                          {workflow.provider}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{workflow.relatedEntityLabel ?? workflow.entityId ?? workflow.id}</span>
                      <span>
                        {workflow.completedTasks}/{workflow.totalTasks} {t('execution.taskCount')}
                      </span>
                      <span>
                        {workflow.completedStages}/{workflow.totalStages}{' '}
                        {t('execution.stageCount')}
                      </span>
                    </div>

                    <div className="mt-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-[width] duration-200 ${
                            workflow.status === 'failed'
                              ? 'bg-red-400'
                              : workflow.status === 'paused'
                                ? 'bg-orange-400'
                                : 'bg-primary'
                          }`}
                          style={{ width: `${clampProgress(workflow.progress)}%` }}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="truncate">{workflow.summary}</span>
                        <span className="tabular-nums">{clampProgress(workflow.progress)}%</span>
                      </div>
                    </div>
                  </div>

                  {workflow.status === 'failed' && (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-3">
                  {workflow.status === 'awaiting_approval' && (
                    <button
                      onClick={() => setReviewWorkflowId(workflow.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-500/15"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {t('workflowApproval.review')}
                    </button>
                  )}
                  {canPause && (
                    <button
                      onClick={() => dispatch(pauseWorkflow(workflow.id))}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground hover:bg-muted"
                    >
                      <PauseCircle className="h-3.5 w-3.5" />
                      {t('action.pause')}
                    </button>
                  )}
                  {canResume && (
                    <button
                      onClick={() => dispatch(resumeWorkflow(workflow.id))}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground hover:bg-muted"
                    >
                      <PlayCircle className="h-3.5 w-3.5" />
                      {t('action.resume')}
                    </button>
                  )}
                  {canCancel && (
                    <button
                      onClick={() => dispatch(cancelWorkflow(workflow.id))}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground hover:bg-muted"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      {t('action.cancel')}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (!expanded) {
                        dispatch(loadWorkflowStages(workflow.id));
                        dispatch(loadWorkflowTasks(workflow.id));
                      }
                      setExpandedWorkflowId((current) =>
                        current === workflow.id ? null : workflow.id,
                      );
                    }}
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground hover:bg-muted"
                  >
                    {expanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    {expanded ? t('execution.hideDetails') : t('execution.showDetails')}
                  </button>
                </div>

                {expanded && (
                  <div className="mt-3 rounded-md border border-border/70 bg-card/70 p-3">
                    <div className="grid gap-2 text-[11px] text-muted-foreground md:grid-cols-2">
                      <div>
                        <span className="mr-1 text-foreground">{t('execution.provider')}:</span>
                        {workflow.provider ?? 'n/a'}
                      </div>
                      <div>
                        <span className="mr-1 text-foreground">{t('execution.model')}:</span>
                        {workflow.modelKey ?? 'n/a'}
                      </div>
                    </div>

                    {stages.length > 0 && (
                      <div className="mt-3">
                        <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {t('execution.stageCount')}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {stages.map((stage) => (
                            <span
                              key={stage.id}
                              className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                STATUS_BADGE[stage.status] ??
                                'border-border bg-muted text-muted-foreground'
                              }`}
                            >
                              {stage.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {tasks.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {t('execution.taskCount')}
                        </div>
                        {tasks.map((task) => (
                          <div
                            key={task.id}
                            className="rounded-md border border-border/70 bg-background/70 px-2.5 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-foreground">
                                {task.displayLabel}
                              </span>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                  STATUS_BADGE[task.status] ??
                                  'border-border bg-muted text-muted-foreground'
                                }`}
                              >
                                {statusLabel(task.status)}
                              </span>
                            </div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {task.summary ?? task.relatedEntityLabel ?? task.taskId}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                              {task.promptTemplateId && (
                                <span>
                                  <span className="mr-1 text-foreground">
                                    {t('execution.prompt')}:
                                  </span>
                                  {task.promptTemplateId}
                                  {task.promptTemplateVersion
                                    ? `@${task.promptTemplateVersion}`
                                    : ''}
                                </span>
                              )}
                              {task.provider && (
                                <span>
                                  <span className="mr-1 text-foreground">
                                    {t('execution.provider')}:
                                  </span>
                                  {task.provider}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <WorkflowDetailDrawer
        workflowRunId={reviewWorkflowId}
        open={reviewWorkflowId !== null}
        onClose={() => setReviewWorkflowId(null)}
      />
    </div>
  );
}
