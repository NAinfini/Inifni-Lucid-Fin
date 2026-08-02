import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AlertTriangle, Sparkles, X } from 'lucide-react';
import type { RootState } from '../../store/index.js';
import type { WorkflowApprovalContext, WorkflowVisualAuditionContext } from '@lucid-fin/contracts';
import {
  loadWorkflows,
  loadWorkflowStages,
  loadWorkflowTasks,
  retryWorkflow,
} from '../../store/slices/workflows.js';
import { t } from '../../i18n.js';
import { FinalExportApprovalCard } from './FinalExportApprovalCard.js';
import { ProductionPlanApprovalCard } from './ProductionPlanApprovalCard.js';
import { VisualConstitutionApprovalCard } from './VisualConstitutionApprovalCard.js';

type WorkflowDetailDrawerProps = {
  workflowRunId: string | null;
  open: boolean;
  onClose: () => void;
};

function workflowStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return t('execution.status.pending');
    case 'awaiting_approval':
      return t('execution.status.awaitingApproval');
    case 'blocked':
      return t('execution.status.blocked');
    case 'ready':
      return t('execution.status.ready');
    case 'queued':
      return t('execution.status.queued');
    case 'preparing':
      return t('execution.status.preparing');
    case 'running':
      return t('execution.status.running');
    case 'paused':
      return t('execution.status.paused');
    case 'completed':
      return t('execution.status.completed');
    case 'completed_with_errors':
      return t('execution.status.completedWithErrors');
    case 'failed':
      return t('execution.status.failed');
    case 'cancelled':
      return t('execution.status.cancelled');
    case 'dead':
      return t('execution.status.dead');
    default:
      return status;
  }
}

export function WorkflowDetailDrawer({ workflowRunId, open, onClose }: WorkflowDetailDrawerProps) {
  const dispatch = useDispatch();
  const [approvalContext, setApprovalContext] = useState<WorkflowApprovalContext | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [approvalLoadError, setApprovalLoadError] = useState<string | null>(null);
  const [visualAuditionContext, setVisualAuditionContext] =
    useState<WorkflowVisualAuditionContext | null>(null);
  const [visualLoadError, setVisualLoadError] = useState<string | null>(null);
  const workflow = useSelector((state: RootState) =>
    workflowRunId ? state.workflows.summariesById[workflowRunId] : undefined,
  );
  const stages = useSelector((state: RootState) =>
    workflowRunId ? (state.workflows.stagesByWorkflowId[workflowRunId] ?? []) : [],
  );
  const tasks = useSelector((state: RootState) =>
    workflowRunId ? (state.workflows.tasksByWorkflowId[workflowRunId] ?? []) : [],
  );

  useEffect(() => {
    if (!open || !workflowRunId) {
      return;
    }

    dispatch(loadWorkflowStages(workflowRunId));
    dispatch(loadWorkflowTasks(workflowRunId));
  }, [dispatch, open, workflowRunId]);

  useEffect(() => {
    let cancelled = false;
    setApprovalContext(null);
    setApprovalLoadError(null);
    if (!open || !workflowRunId || !window.lucidAPI?.workflow?.getPendingApproval) return;

    setApprovalLoading(true);
    void window.lucidAPI.workflow
      .getPendingApproval(workflowRunId)
      .then((context) => {
        if (!cancelled) setApprovalContext(context);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setApprovalLoadError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setApprovalLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, workflowRunId]);

  useEffect(() => {
    let cancelled = false;
    setVisualAuditionContext(null);
    setVisualLoadError(null);
    if (!open || !workflowRunId || !window.lucidAPI?.workflow?.getVisualAuditions) return;

    void window.lucidAPI.workflow
      .getVisualAuditions(workflowRunId)
      .then((context) => {
        if (!cancelled) setVisualAuditionContext(context);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setVisualLoadError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, workflowRunId]);

  if (!open || !workflowRunId || !workflow) {
    return null;
  }

  const canRetry = workflow.status === 'failed' || workflow.status === 'completed_with_errors';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-xl flex-col border-l bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b px-5 py-4">
          <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {t('workflowDrawer.title')}
            </div>
            <div className="mt-1 text-lg font-semibold">{workflow.displayLabel}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {workflow.relatedEntityLabel ?? workflow.entityId ?? workflow.id}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded border p-1.5 hover:bg-muted"
            aria-label={t('workflowDrawer.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {approvalLoading && (
            <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
              {t('workflowApproval.loading')}
            </div>
          )}
          {approvalLoadError && (
            <div
              role="alert"
              className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
            >
              {approvalLoadError}
            </div>
          )}
          {visualLoadError && (
            <div
              role="alert"
              className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
            >
              {visualLoadError}
            </div>
          )}
          {approvalContext?.approval.gateKey === 'production_plan' && (
            <ProductionPlanApprovalCard
              context={approvalContext}
              onApprove={() =>
                window.lucidAPI.workflow.approveGate({
                  workflowRunId: approvalContext.run.id,
                  gateKey: approvalContext.approval.gateKey,
                  expectedRowVersion: approvalContext.run.rowVersion ?? 0,
                  expectedSubjectRevision: approvalContext.approval.subjectRevision,
                  expectedSubjectHash: approvalContext.approval.subjectHash,
                })
              }
              onApproved={() => {
                setApprovalContext(null);
                dispatch(loadWorkflows({}));
              }}
            />
          )}
          {approvalContext?.approval.gateKey === 'final_export' && (
            <FinalExportApprovalCard
              context={approvalContext}
              onApprove={() =>
                window.lucidAPI.workflow.approveGate({
                  workflowRunId: approvalContext.run.id,
                  gateKey: approvalContext.approval.gateKey,
                  expectedRowVersion: approvalContext.run.rowVersion ?? 0,
                  expectedSubjectRevision: approvalContext.approval.subjectRevision,
                  expectedSubjectHash: approvalContext.approval.subjectHash,
                })
              }
              onApproved={() => {
                setApprovalContext(null);
                dispatch(loadWorkflows({}));
              }}
            />
          )}
          {visualAuditionContext &&
            (visualAuditionContext.run.currentStageId === 'style-exploration' ||
              approvalContext?.approval.gateKey === 'visual_constitution') && (
              <VisualConstitutionApprovalCard
                auditionContext={visualAuditionContext}
                approvalContext={approvalContext}
                onSelect={async (candidateId) => {
                  const result = await window.lucidAPI.workflow.selectVisualCandidate({
                    workflowRunId: visualAuditionContext.run.id,
                    candidateId,
                    expectedRowVersion: visualAuditionContext.run.rowVersion ?? 0,
                    expectedAuditionRevision: visualAuditionContext.document.revision,
                    expectedAuditionHash: visualAuditionContext.document.contentHash,
                  });
                  setApprovalContext(result.context);
                  setVisualAuditionContext((current) =>
                    current ? { ...current, run: result.context.run } : current,
                  );
                  dispatch(loadWorkflows({}));
                  return result;
                }}
                onApprove={() => {
                  if (approvalContext?.approval.gateKey !== 'visual_constitution') {
                    throw new Error('Visual Constitution selection must be locked first');
                  }
                  return window.lucidAPI.workflow.approveGate({
                    workflowRunId: approvalContext.run.id,
                    gateKey: approvalContext.approval.gateKey,
                    expectedRowVersion: approvalContext.run.rowVersion ?? 0,
                    expectedSubjectRevision: approvalContext.approval.subjectRevision,
                    expectedSubjectHash: approvalContext.approval.subjectHash,
                  });
                }}
                onApproved={() => {
                  setApprovalContext(null);
                  setVisualAuditionContext(null);
                  dispatch(loadWorkflows({}));
                }}
              />
            )}
          <section className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border bg-background px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                {workflow.displayCategory}
              </span>
              <span className="rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                {workflowStatusLabel(workflow.status)}
              </span>
              {workflow.provider && (
                <span className="rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                  {workflow.provider}
                </span>
              )}
            </div>

            <p className="mt-3 text-sm text-muted-foreground">{workflow.summary}</p>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border bg-background px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t('taskCenter.columns.progress')}
                </div>
                <div className="mt-1 font-medium">{Math.round(workflow.progress)}%</div>
              </div>
              <div className="rounded-lg border bg-background px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t('taskCenter.columns.tasks')}
                </div>
                <div className="mt-1 font-medium">
                  {workflow.completedTasks}/{workflow.totalTasks}
                </div>
              </div>
            </div>
          </section>

          <section>
            <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {t('taskCenter.columns.stages')}
            </div>
            <div className="space-y-2">
              {stages.length === 0 ? (
                <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  {t('workflowDrawer.noStageDetails')}
                </div>
              ) : (
                stages.map((stage) => (
                  <div key={stage.id} className="rounded-lg border bg-card px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">{stage.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {workflowStatusLabel(stage.status)}
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {stage.completedTasks}/{stage.totalTasks} {t('workflowDrawer.tasksDone')}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {t('taskCenter.columns.tasks')}
            </div>
            <div className="space-y-3">
              {tasks.length === 0 ? (
                <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  {t('workflowDrawer.noTaskDetails')}
                </div>
              ) : (
                tasks.map((task) => (
                  <article key={task.id} className="rounded-xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{task.displayLabel}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {task.summary ?? task.relatedEntityLabel ?? task.taskId}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {workflowStatusLabel(task.status)}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                      <div className="rounded-lg border bg-background px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {t('execution.model')}
                        </div>
                        <div className="mt-1 font-medium">
                          {task.modelKey ?? workflow.modelKey ?? 'n/a'}
                        </div>
                      </div>
                      <div className="rounded-lg border bg-background px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {t('execution.provider')}
                        </div>
                        <div className="mt-1 font-medium">
                          {task.provider ?? workflow.provider ?? 'n/a'}
                        </div>
                      </div>
                      <div className="rounded-lg border bg-background px-3 py-2 md:col-span-2">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {t('execution.prompt')}
                        </div>
                        <div className="mt-1 font-medium">
                          {task.promptTemplateId ?? 'n/a'}
                          {task.promptTemplateVersion ? ` @ ${task.promptTemplateVersion}` : ''}
                        </div>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="border-t px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-4 w-4" />
              {t('workflowDrawer.executionChainHint')}
            </div>
            <div className="flex items-center gap-2">
              {canRetry && (
                <button
                  onClick={() => dispatch(retryWorkflow(workflow.id))}
                  className="rounded border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  {t('workflowDrawer.retryWorkflow')}
                </button>
              )}
              <button
                onClick={onClose}
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              >
                {t('workflowDrawer.close')}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
