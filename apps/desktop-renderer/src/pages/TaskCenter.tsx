import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { ClipboardList, Filter, Sparkles } from 'lucide-react';
import type { RootState } from '../store/index.js';
import { loadWorkflows } from '../store/slices/workflows.js';
import { t } from '../i18n.js';

const ACTIVE_STATUSES = new Set(['pending', 'blocked', 'ready', 'running', 'paused']);

const FAILED_STATUSES = new Set(['failed', 'completed_with_errors']);

type TaskFilter = 'all' | 'active' | 'failed';

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

function routeForWorkflow(workflowType: string): string {
  switch (workflowType) {
    case 'storyboard.generate':
      return '/';
    case 'style.extract':
      return '/';
    default:
      return '/tasks';
  }
}

export function TaskCenter() {
  const dispatch = useDispatch();
  const { allIds, summariesById } = useSelector((state: RootState) => state.workflows);
  const [filter, setFilter] = useState<TaskFilter>('all');

  useEffect(() => {
    dispatch(loadWorkflows({}));
  }, [dispatch]);

  const allWorkflows = useMemo(() => {
    return allIds
      .map((id) => summariesById[id])
      .filter((workflow): workflow is NonNullable<typeof workflow> => !!workflow);
  }, [allIds, summariesById]);

  const workflows = useMemo(() => {
    switch (filter) {
      case 'active':
        return allWorkflows.filter((workflow) => ACTIVE_STATUSES.has(workflow.status));
      case 'failed':
        return allWorkflows.filter((workflow) => FAILED_STATUSES.has(workflow.status));
      default:
        return allWorkflows;
    }
  }, [allWorkflows, filter]);

  const counts = useMemo(() => {
    return {
      all: allWorkflows.length,
      active: allWorkflows.filter((workflow) => ACTIVE_STATUSES.has(workflow.status)).length,
      failed: allWorkflows.filter((workflow) => FAILED_STATUSES.has(workflow.status)).length,
    };
  }, [allWorkflows]);

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4 overflow-y-auto px-4 py-4">
      <section className="rounded-lg border border-border/60 bg-card/80 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background px-2.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <ClipboardList className="h-3 w-3" />
              {t('taskCenter.eyebrow')}
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{t('taskCenter.title')}</h1>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                {t('taskCenter.subtitle')}
              </p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('taskCenter.filters.all')}
              </div>
              <div className="mt-1 text-lg font-semibold">{counts.all}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('taskCenter.filters.active')}
              </div>
              <div className="mt-1 text-lg font-semibold">{counts.active}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('taskCenter.filters.failed')}
              </div>
              <div className="mt-1 text-lg font-semibold">{counts.failed}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border/60 bg-card/80 p-3 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Filter className="h-3.5 w-3.5 text-primary" />
            {t('taskCenter.filterTitle')}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(['all', 'active', 'failed'] as const).map((value) => {
              const active = filter === value;
              return (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border/60 bg-background text-foreground hover:bg-muted'
                  }`}
                >
                  {t(`taskCenter.filters.${value}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {workflows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
              {t('taskCenter.empty')}
            </div>
          ) : (
            workflows.map((workflow) => (
              <article
                key={workflow.id}
                className="rounded-lg border border-border/60 bg-background/80 p-3 shadow-sm transition-colors hover:border-primary/40"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-border/60 bg-card px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        {workflow.displayCategory}
                      </span>
                      <span className="rounded-full border border-border/60 bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                        {statusLabel(workflow.status)}
                      </span>
                      {workflow.provider && (
                        <span className="rounded-full border border-border/60 bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
                          {workflow.provider}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h2 className="text-sm font-semibold">{workflow.displayLabel}</h2>
                      <span className="text-xs text-muted-foreground">
                        {workflow.relatedEntityLabel ?? workflow.entityId ?? workflow.id}
                      </span>
                    </div>

                    <p className="mt-1.5 text-xs text-muted-foreground">{workflow.summary}</p>

                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-4">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.16em]">
                          {t('taskCenter.columns.progress')}
                        </div>
                        <div className="mt-0.5 font-medium text-foreground">
                          {Math.round(workflow.progress)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.16em]">
                          {t('taskCenter.columns.tasks')}
                        </div>
                        <div className="mt-0.5 font-medium text-foreground">
                          {workflow.completedTasks}/{workflow.totalTasks}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.16em]">
                          {t('taskCenter.columns.stages')}
                        </div>
                        <div className="mt-0.5 font-medium text-foreground">
                          {workflow.completedStages}/{workflow.totalStages}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.16em]">
                          {t('taskCenter.columns.updated')}
                        </div>
                        <div className="mt-0.5 font-medium text-foreground">
                          {new Date(workflow.updatedAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Link
                      to={routeForWorkflow(workflow.workflowType)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {t('taskCenter.openWorkspace')}
                    </Link>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
