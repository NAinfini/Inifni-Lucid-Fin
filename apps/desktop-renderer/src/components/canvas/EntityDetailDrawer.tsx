import React, { useEffect, useRef, type ReactNode } from 'react';
import { X, Save, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { t } from '../../i18n.js';

export interface EntityDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  /** Save button — disabled when no dirty state. Hidden if handler omitted. */
  onSave?: () => void;
  isDirty?: boolean;
  /** Delete button — hidden if handler omitted. */
  onDelete?: () => void;
  className?: string;
  children: ReactNode;
}

/**
 * Panel-anchored detail drawer. Unlike the previous right-side fixed variant,
 * this one is a sibling column inside a split-flex parent. Close via the X
 * button or Escape only — clicking outside the panel does NOT close, so the
 * user can freely interact with the canvas while inspecting/editing an entity.
 */
export function EntityDetailDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  onSave,
  isDirty,
  onDelete,
  className,
  children,
}: EntityDetailDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      ref={drawerRef}
      role="dialog"
      aria-label={title}
      className={cn(
        'relative z-10 flex h-full min-w-0 flex-1 flex-col border-l border-border/60 bg-card shadow-xl',
        'animate-in slide-in-from-left-4 fade-in-0 duration-200',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          {subtitle && (
            <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={!isDirty}
              className="inline-flex items-center justify-center rounded-md border border-border/60 p-1.5 hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed"
              title={t('action.save')}
              aria-label={t('action.save')}
            >
              <Save className="h-3.5 w-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center justify-center rounded-md border border-border/60 p-1.5 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"
              title={t('action.delete')}
              aria-label={t('action.delete')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t('action.cancel')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3">{children}</div>
    </div>
  );
}
