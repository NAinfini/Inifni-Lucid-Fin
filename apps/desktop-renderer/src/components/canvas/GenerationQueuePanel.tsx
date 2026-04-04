import { useEffect, useState, useCallback } from 'react';
import { ListTodo, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { getAPI } from '../../utils/api.js';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../hooks/use-i18n.js';

interface JobEntry {
  id: string;
  provider: string;
  status: string;
  progress: number;
  error?: string;
  currentStep?: string;
}

const STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  pending: Clock,
  queued: Clock,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
  dead: XCircle,
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-muted-foreground',
  queued: 'text-muted-foreground',
  running: 'text-blue-400',
  completed: 'text-emerald-400',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground',
  dead: 'text-destructive',
};

const ACTIVE_STATUSES = new Set(['pending', 'queued', 'running']);

export function GenerationQueuePanel() {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<JobEntry[]>([]);

  const refresh = useCallback(async () => {
    const api = getAPI();
    if (!api) return;
    try {
      const list = await api.job.list();
      setJobs(list as unknown as JobEntry[]);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void refresh();

    const api = getAPI();
    if (!api) return;

    // Progress/complete events don't send full job objects — use them as refresh triggers
    const offProgress = api.job.onProgress(() => { void refresh(); });
    const offComplete = api.job.onComplete(() => { void refresh(); });

    return () => {
      offProgress();
      offComplete();
    };
  }, [refresh]);

  const active = jobs.filter((j) => ACTIVE_STATUSES.has(j.status));
  const finished = jobs.filter((j) => !ACTIVE_STATUSES.has(j.status));

  return (
    <div className="h-full bg-card border-l flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('generationQueue.title')}</span>
        </div>
        {active.length > 0 && (
          <span className="text-[10px] rounded-full bg-blue-400/20 text-blue-400 px-2 py-0.5 font-medium">
            {active.length} {t('generationQueue.active')}
          </span>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {t('generationQueue.empty')}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {[...active, ...finished].map((job) => {
            const Icon = STATUS_ICON[job.status] ?? Clock;
            const isRunning = job.status === 'running';
            return (
              <div key={job.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border border-border/60">
                <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', isRunning ? 'animate-spin' : '', STATUS_COLOR[job.status] ?? 'text-muted-foreground')} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{job.provider ?? t('generationQueue.unknown')}</div>
                  <div className="text-xs text-muted-foreground">{job.id.slice(0, 8)}</div>
                  {job.currentStep && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{job.currentStep}</div>
                  )}
                  {isRunning && (
                    <div className="mt-1.5 h-1 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full bg-blue-400 rounded-full transition-all"
                        style={{ width: `${job.progress ?? 0}%` }}
                      />
                    </div>
                  )}
                  {job.error && (
                    <div className="mt-1 text-xs text-destructive truncate">{job.error}</div>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground capitalize shrink-0">{job.status}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
