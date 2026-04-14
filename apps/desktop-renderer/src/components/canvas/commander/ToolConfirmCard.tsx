import { useState } from 'react';
import { Shield } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { summarizeToolAction } from './tool-formatting.js';

export interface ToolConfirmCardProps {
  toolName: string;
  args: Record<string, unknown>;
  tier: number;
  onExecute: () => void;
  onSkip: () => void;
  t: (key: string) => string;
}

export function ToolConfirmCard({ toolName, args, tier, onExecute, onSkip, t }: ToolConfirmCardProps) {
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

  const { action, detail } = summarizeToolAction(toolName, args, t);
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="mx-3 my-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
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
      {detail && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{detail}</div>
      )}
      <button
        type="button"
        className="mt-1.5 text-[9px] text-muted-foreground/60 hover:text-muted-foreground underline"
        onClick={() => setShowRaw((v) => !v)}
      >
        {showRaw ? t('commander.toolConfirm.hideRaw') : t('commander.toolConfirm.showRaw')}
      </button>
      {showRaw && (
        <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-1.5 text-[10px] text-muted-foreground">
          {JSON.stringify(args, null, 2)}
        </pre>
      )}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onSkip}
        >
          {t('commander.toolConfirm.skip')}
        </button>
        <button
          type="button"
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          onClick={onExecute}
        >
          {t('commander.toolConfirm.execute')}
        </button>
      </div>
    </div>
  );
}
