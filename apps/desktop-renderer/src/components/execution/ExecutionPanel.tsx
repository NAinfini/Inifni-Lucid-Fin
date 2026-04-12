import React, { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  PauseCircle,
  PlayCircle,
  XCircle,
} from 'lucide-react';
import type { RootState } from '../../store/index.js';
import {
  cancelWorkflow,
  loadWorkflowStages,
  loadWorkflowTasks,
  pauseWorkflow,
  resumeWorkflow,
} from '../../store/slices/workflows.js';
import { t } from '../../i18n.js';

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-slate-500/15 text-slate-300 border-slate-400/20',
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
  'blocked',
  'ready',
  'running',
  'paused',
  'failed',
  'completed_with_errors',
]);

const ACTIVE_STATUSES = new Set(['pending', 'blocked', 'ready', 'running', 'paused']);

const ATTENTION_STATUSES = new Set(['failed', 'completed_with_errors']);

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return t('execution.status.pending');
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

export function ExecutionPanel() {
  const dispatch = useDispatch();
  const { allIds, summariesById, stagesByWorkflowId, tasksByWorkflowId } = useSelector(
    (state: RootState) => state.workflows,
  );
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null);

  const workflows = useMemo(() => {
    return allIds
      .map((id) => summariesById[id])
      .filter((workflow): workflow is NonNullable<typeof workflow> => !!workflow)
      .filter((workflow) => VISIBLE_STATUSES.has(workflow.status));
  }, [allIds, summariesById]);

  const activeCount = workflows.filter((workflow) => ACTIVE_STATUSES.has(workflow.status)).length;
  const attentionCount = workflows.filter((workflow) =>
    ATTENTION_STATUSES.has(workflow.status),
  ).length;

  if (workflows.length === 0) {
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
    </div>
  );
}
