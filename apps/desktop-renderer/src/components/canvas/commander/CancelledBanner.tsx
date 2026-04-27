import { Ban } from 'lucide-react';
import type { TimelineEvent } from '@lucid-fin/contracts';

export interface CancelledBannerProps {
  /** The `cancelled` timeline event for this run. */
  event: Extract<TimelineEvent, { kind: 'cancelled' }>;
  /**
   * Renderer-derived tool counts. Prefer these over the event's
   * fields — the backend emits zeros so the renderer can be the single
   * source of truth and avoid double-counting with synthetic results.
   */
  stats: { completed: number; pending: number };
  t: (key: string) => string;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

export function CancelledBanner({ event, stats, t }: CancelledBannerProps) {
  const reasonKey = `commander.cancelled.${event.reason}`;
  const reasonText = t(reasonKey);
  const countsTemplate = t('commander.cancelled.counts');
  const countsText = interpolate(countsTemplate, {
    completed: stats.completed,
    pending: stats.pending,
  });
  return (
    <div
      className="mx-3 my-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs"
      data-testid="commander-cancelled-banner"
    >
      <Ban className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
      <div className="flex flex-col gap-1">
        <span className="font-medium text-amber-300">{reasonText}</span>
        <span className="text-muted-foreground">{countsText}</span>
        {event.partialContent && (
          <details className="mt-1 text-muted-foreground">
            <summary className="cursor-pointer">{t('commander.cancelled.partial')}</summary>
            <pre className="mt-1 whitespace-pre-wrap rounded bg-background/40 p-2 text-[11px]">
              {event.partialContent}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
