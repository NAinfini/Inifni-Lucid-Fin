import React from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { t } from '../../i18n.js';

const STATUS_LABELS: Record<string, string> = {
  queued: 'execution.status.queued',
  running: 'execution.status.running',
  completed: 'execution.status.completed',
  failed: 'execution.status.failed',
  cancelled: 'execution.status.cancelled',
  paused: 'execution.status.paused',
  dead: 'execution.status.dead',
};

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-yellow-500',
  running: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-500',
  paused: 'bg-orange-500',
  dead: 'bg-red-800',
};

export function JobQueuePanel() {
  const jobs = useSelector((s: RootState) => s.jobs.items);

  if (jobs.length === 0) {
    return <div className="p-3 text-xs text-muted-foreground">{t('layout.noRunningJobs')}</div>;
  }

  return (
    <div className="divide-y">
      {jobs.map((job) => (
        <div key={job.id} className="flex items-center gap-3 px-3 py-2 text-xs">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[job.status] ?? 'bg-gray-400'}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">
                {job.currentStep ??
                  (STATUS_LABELS[job.status] ? t(STATUS_LABELS[job.status]) : job.status)}
              </span>
              {job.provider && <span className="text-muted-foreground">{job.provider}</span>}
            </div>
            {job.status === 'running' && (
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${job.progress ?? 0}%` }}
                  />
                </div>
                <span className="text-muted-foreground tabular-nums w-8 text-right">
                  {job.progress ?? 0}%
                </span>
                {job.totalSteps != null && job.completedSteps != null && (
                  <span className="text-muted-foreground">
                    {job.completedSteps}/{job.totalSteps}
                  </span>
                )}
              </div>
            )}
            {job.status === 'failed' && job.error && (
              <div className="text-destructive mt-0.5 truncate">{job.error}</div>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground uppercase shrink-0">{job.type}</span>
        </div>
      ))}
    </div>
  );
}
