import { Shield } from 'lucide-react';
import type { PublicToolDetails } from '@lucid-fin/contracts';
import { cn } from '../../../lib/utils.js';
import { localizeToolName } from '../../../i18n.js';

export interface ToolConfirmCardProps {
  toolName: string;
  summary?: string;
  details?: PublicToolDetails;
  tier: number;
  onExecute: () => void | Promise<void>;
  onSkip: () => void | Promise<void>;
  t: (key: string) => string;
  disabled?: boolean;
  error?: string | null;
  status?: string | null;
}

export function ToolConfirmCard({
  toolName,
  summary,
  details,
  tier,
  onExecute,
  onSkip,
  t,
  disabled = false,
  error = null,
  status = null,
}: ToolConfirmCardProps) {
  const tierLabels: Record<number, string> = {
    1: t('commander.tierLabels.safe'),
    2: t('commander.tierLabels.mutation'),
    3: t('commander.tierLabels.generation'),
    4: t('commander.tierLabels.system'),
  };
  const tierColors: Record<number, string> = {
    1: 'bg-emerald-500/15 text-emerald-400',
    2: 'bg-amber-500/15 text-amber-400',
    3: 'bg-blue-500/15 text-blue-400',
    4: 'bg-red-500/15 text-red-400',
  };

  const action = summary ?? localizeToolName(toolName);
  const detail = details
    ? Object.entries(details)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(' · ')
    : '';

  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <Shield className="h-4 w-4 text-amber-400" />
        <span>{t('commander.toolConfirm.title')}</span>
        <span
          className={cn(
            'ml-auto rounded px-1.5 py-0.5 text-[10px]',
            tierColors[tier] ?? 'bg-amber-500/15 text-amber-400',
          )}
        >
          {tierLabels[tier] ?? `Tier ${tier}`}
        </span>
      </div>
      <div className="mt-2 text-xs font-medium">{action}</div>
      {detail && <div className="mt-0.5 text-[11px] text-muted-foreground">{detail}</div>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => void onSkip()}
          disabled={disabled}
          aria-busy={disabled}
        >
          {t('commander.toolConfirm.skip')}
        </button>
        <button
          type="button"
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          onClick={() => void onExecute()}
          disabled={disabled}
          aria-busy={disabled}
        >
          {t('commander.toolConfirm.execute')}
        </button>
      </div>
      {status ? (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
