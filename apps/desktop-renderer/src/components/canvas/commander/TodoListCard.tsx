import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ListChecks } from 'lucide-react';
import type { ActiveTodoSnapshot } from '../../../commander/state/commander-timeline-selectors.js';
import { cn } from '../../../lib/utils.js';

export interface TodoListCardProps {
  snapshot: ActiveTodoSnapshot;
  t: (key: string) => string;
}

interface StatusIconProps {
  status: ActiveTodoSnapshot['items'][number]['status'];
  prevStatus: ActiveTodoSnapshot['items'][number]['status'] | null;
}

/**
 * Small three-state glyph for a todo item. Animates a brief scale pulse
 * whenever `status` transitions, so the user sees forward motion when
 * the model flips items done → next-in-progress.
 */
function StatusIcon({ status, prevStatus }: StatusIconProps) {
  const changed = prevStatus !== null && prevStatus !== status;
  const base =
    'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition-transform duration-300';
  if (status === 'done') {
    return (
      <span
        aria-label="done"
        className={cn(
          base,
          'border-emerald-500/50 bg-emerald-500/15 text-emerald-400',
          changed && 'scale-125',
        )}
      >
        {'✔'}
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span
        aria-label="in progress"
        className={cn(
          base,
          'border-amber-500/60 bg-amber-500/15 text-amber-400 animate-pulse',
        )}
      >
        {'·'}
      </span>
    );
  }
  return (
    <span
      aria-label="pending"
      className={cn(
        base,
        'border-border/60 bg-transparent text-muted-foreground/60',
      )}
    >
      {'☐'}
    </span>
  );
}

/**
 * Bottom-sticky todo list card for an active Commander run. Rendered
 * directly above the footer so the user sees it at the same eyeline as
 * the input and tool-call cards. In-place updates animate; a full
 * `todo.set` replacement swaps the whole body because the `todoId`
 * changes.
 */
export function TodoListCard({ snapshot, t }: TodoListCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const prevById = useRef<Map<string, ActiveTodoSnapshot['items'][number]['status']>>(
    new Map(),
  );
  useEffect(() => {
    prevById.current = new Map(snapshot.items.map((i) => [i.id, i.status]));
  }, [snapshot.todoId, snapshot.items]);

  const total = snapshot.items.length;
  const done = snapshot.items.filter((i) => i.status === 'done').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div
      data-testid="todo-list-card"
      data-todo-id={snapshot.todoId}
      className="mx-2 mb-1 rounded-lg border border-primary/30 bg-primary/5 text-xs shadow-sm"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium text-foreground">{t('commander.todo.title')}</span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>
            {done}/{total}
          </span>
          <span>
            ({pct}%)
          </span>
          <ChevronDown
            className={cn(
              'h-3 w-3 transition-transform duration-200',
              collapsed && '-rotate-90',
            )}
          />
        </span>
      </button>
      {!collapsed && (
        <ul className="border-t border-primary/20 px-2 py-1.5 flex flex-col gap-1">
          {snapshot.items.map((item) => {
            const prev = prevById.current.get(item.id) ?? null;
            const isDone = item.status === 'done';
            return (
              <li
                key={item.id}
                data-item-id={item.id}
                data-status={item.status}
                className="flex items-start gap-1.5 transition-opacity duration-200"
              >
                <StatusIcon status={item.status} prevStatus={prev} />
                <span
                  className={cn(
                    'leading-snug',
                    isDone && 'text-muted-foreground line-through',
                    item.status === 'in_progress' && 'font-medium text-foreground',
                  )}
                >
                  {item.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
