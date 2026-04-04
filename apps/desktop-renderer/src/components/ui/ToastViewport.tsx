import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { LucideIcon } from 'lucide-react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import type { RootState } from '../../store/index.js';
import { dismissToast, type ToastItem } from '../../store/slices/toast.js';
import { t } from '../../i18n.js';

const TOAST_VARIANT_STYLE: Record<
  ToastItem['variant'],
  { icon: LucideIcon; accent: string; iconColor: string }
> = {
  info: { icon: Info, accent: 'border-primary/50', iconColor: 'text-primary' },
  success: { icon: CheckCircle2, accent: 'border-emerald-500/50', iconColor: 'text-emerald-400' },
  warning: { icon: AlertTriangle, accent: 'border-amber-500/50', iconColor: 'text-amber-300' },
  error: { icon: AlertCircle, accent: 'border-destructive/60', iconColor: 'text-destructive' },
};

function ToastCard({ toast }: { toast: ToastItem }) {
  const dispatch = useDispatch();
  const variantStyle = TOAST_VARIANT_STYLE[toast.variant];
  const Icon = variantStyle.icon;

  useEffect(() => {
    if (toast.durationMs <= 0) return;
    const timer = window.setTimeout(() => {
      dispatch(dismissToast(toast.id));
    }, toast.durationMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [dispatch, toast.durationMs, toast.id]);

  return (
    <article
      className={`pointer-events-auto rounded-lg border bg-card/95 px-3 py-2 shadow-lg backdrop-blur ${variantStyle.accent}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${variantStyle.iconColor}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{toast.title}</p>
          {toast.message ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{toast.message}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => dispatch(dismissToast(toast.id))}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t('toast.close')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}

export function ToastViewport() {
  const toasts = useSelector((state: RootState) => state.toast.items);
  if (toasts.length === 0) return null;

  return (
    <section
      className="pointer-events-none fixed right-4 top-4 z-[120] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-label={t('toast.list')}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </section>
  );
}
