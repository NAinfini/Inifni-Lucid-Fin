import { useState } from 'react';
import { ChevronDown, ListChecks } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import type { ActiveTodoSnapshot } from '../../../commander/state/commander-timeline-selectors.js';

export interface PipelineRailProps {
  snapshot: ActiveTodoSnapshot | null;
  isStreaming: boolean;
  t: (key: string) => string;
}

/**
 * 3I: Film Pipeline Rail.
 *
 * When a todo list is active, renders as a collapsible header section at the
 * top of the message area. Film-production-aware phase labels when the
 * workflow matches story-to-video. Always visible during streaming,
 * collapsible via chevron. Disappears when no todo is active.
 */
export function PipelineRail({ snapshot, isStreaming, t }: PipelineRailProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!snapshot || snapshot.items.length === 0) return null;

  const total = snapshot.items.length;
  const done = snapshot.items.filter((item) => item.status === 'done').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  // During streaming, the rail stays expanded to show progress
  const isCollapsed = collapsed && !isStreaming;

  return (
    <div className="border-b border-border/40 bg-muted/10">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/30"
      >
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span>{t('commander.pipeline.title')}</span>
        <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
          {done}/{total} ({pct}%)
        </span>
        <div className="ml-auto flex items-center gap-1">
          {/* Progress bar */}
          <div className="h-1 w-16 rounded-full bg-border/40 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <ChevronDown
            className={cn(
              'h-3 w-3 text-muted-foreground transition-transform',
              isCollapsed && '-rotate-90',
            )}
          />
        </div>
      </button>
      {!isCollapsed ? (
        <div className="px-3 pb-2 space-y-0.5">
          {snapshot.items.map((item) => (
            <div
              key={item.id}
              className={cn(
                'flex items-center gap-1.5 text-[11px]',
                item.status === 'done' && 'text-muted-foreground line-through',
                item.status === 'in_progress' && 'font-medium text-foreground',
                item.status === 'pending' && 'text-muted-foreground/70',
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  item.status === 'done' && 'bg-emerald-400',
                  item.status === 'in_progress' && 'bg-amber-400 animate-pulse',
                  item.status === 'pending' && 'bg-border',
                )}
              />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
