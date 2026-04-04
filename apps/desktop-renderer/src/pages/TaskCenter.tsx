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
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 overflow-y-auto px-6 py-6">
      <section className="rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              <ClipboardList className="h-3.5 w-3.5" />
              {t('taskCenter.eyebrow')}
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{t('taskCenter.title')}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {t('taskCenter.subtitle')}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-background px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('taskCenter.filters.all')}
              </div>
              <div className="mt-2 text-2xl font-semibold">{counts.all}</div>
            </div>
            <div className="rounded-2xl border border-border bg-background px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('taskCenter.filters.active')}
              </div>
              <div className="mt-2 text-2xl font-semibold">{counts.active}</div>
            </div>
            <div className="rounded-2xl border border-border bg-background px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {t('taskCenter.filters.failed')}
              </div>
              <div className="mt-2 text-2xl font-semibold">{counts.failed}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter className="h-4 w-4 text-primary" />
            {t('taskCenter.filterTitle')}
          </div>

          <div className="flex flex-wrap gap-2">
            {(['all', 'active', 'failed'] as const).map((value) => {
              const active = filter === value;
              return (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:bg-muted'
                  }`}
                >
                  {t(`taskCenter.filters.${value}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {workflows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              {t('taskCenter.empty')}
            </div>
          ) : (
            workflows.map((workflow) => (
              <article
                key={workflow.id}
                className="rounded-2xl border border-border bg-background/80 p-4 shadow-sm transition-colors hover:border-primary/40"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {workflow.displayCategory}
                      </span>
                      <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
                        {statusLabel(workflow.status)}
                      </span>
                      {workflow.provider && (
                        <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
                          {workflow.provider}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                      <h2 className="text-lg font-semibold">{workflow.displayLabel}</h2>
                      <span className="text-sm text-muted-foreground">
                        {workflow.relatedEntityLabel ?? workflow.entityId ?? workflow.id}
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-muted-foreground">{workflow.summary}</p>

                    <div className="mt-4 grid gap-3 text-sm text-muted-foreground md:grid-cols-4">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em]">
                          {t('taskCenter.columns.progress')}
                        </div>
                        <div className="mt-1 font-medium text-foreground">
                          {Math.round(workflow.progress)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em]">
                          {t('taskCenter.columns.tasks')}
                        </div>
                        <div className="mt-1 font-medium text-foreground">
                          {workflow.completedTasks}/{workflow.totalTasks}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em]">
                          {t('taskCenter.columns.stages')}
                        </div>
                        <div className="mt-1 font-medium text-foreground">
                          {workflow.completedStages}/{workflow.totalStages}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em]">
                          {t('taskCenter.columns.updated')}
                        </div>
                        <div className="mt-1 font-medium text-foreground">
                          {new Date(workflow.updatedAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      to={routeForWorkflow(workflow.workflowType)}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                    >
                      <Sparkles className="h-4 w-4" />
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
