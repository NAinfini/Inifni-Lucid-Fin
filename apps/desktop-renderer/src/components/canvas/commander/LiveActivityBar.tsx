import { memo } from 'react';
import { useSelector } from 'react-redux';
import { Loader2, SkipForward } from 'lucide-react';

import type { RootState } from '../../../store/index.js';
import { selectPhase } from '../../../store/slices/commander.js';
import type { RunPhase } from '../../../commander/state/run-phase.js';
import { assertNever } from '../../../utils/assert-never.js';
import { useElapsed } from '../../../hooks/useElapsed.js';
import { cn } from '../../../lib/utils.js';

interface LiveActivityBarProps {
  maxSteps: number;
  t: (key: string) => string;
  /**
   * Optional step-cancel callback. When present and the current phase
   * has been `awaiting_model` / `model_streaming` for more than
   * `STEP_CANCEL_GRACE_MS`, a "skip current step" button appears on the
   * right of the bar. Called with no args — the hook knows the active
   * canvas id.
   */
  onCancelCurrentStep?: () => void;
}

/**
 * Live activity indicator mounted above the message list while the
 * commander is active. Phase label is localized. Elapsed is honest — it
 * ticks from the phase's `since` timestamp, not a global timer. Color
 * escalates past 20s (yellow) and 45s (red) to surface stalls.
 */
export const LiveActivityBar = memo(function LiveActivityBar({
  maxSteps,
  t,
  onCancelCurrentStep,
}: LiveActivityBarProps) {
  const phase = useSelector((state: RootState) => selectPhase(state));
  const since = 'since' in phase ? phase.since : null;
  const elapsedMs = useElapsed(since);
  if (phase.kind === 'idle' || phase.kind === 'done') return null;
  const seconds = Math.floor(elapsedMs / 1000);
  const colorClass =
    phase.kind === 'failed'
      ? 'text-destructive'
      : seconds > 45
        ? 'text-destructive'
        : seconds > 20
          ? 'text-yellow-500'
          : 'text-muted-foreground';

  const { label, step } = describePhase(phase, t);
  const stalled = phase.kind === 'model_streaming' && seconds > 20;
  const STEP_CANCEL_GRACE_MS = 60_000;
  const canCancelStep =
    !!onCancelCurrentStep &&
    (phase.kind === 'awaiting_model' || phase.kind === 'model_streaming') &&
    elapsedMs > STEP_CANCEL_GRACE_MS;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-[11px]',
        colorClass,
      )}
    >
      {phase.kind === 'failed' ? null : (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
      )}
      <span className="font-medium">{label}</span>
      {step !== null ? (
        <span className="tabular-nums opacity-80">
          {t('commander.stepLabel')} {step}/{maxSteps}
        </span>
      ) : null}
      {since !== null ? (
        <span className="ml-auto tabular-nums opacity-80">{formatElapsed(elapsedMs)}</span>
      ) : null}
      {stalled ? (
        <span className="ml-2 italic opacity-80">{t('commander.phase.stalled')}</span>
      ) : null}
      {canCancelStep ? (
        <button
          type="button"
          onClick={onCancelCurrentStep}
          title={t('commander.action.cancelCurrentStep')}
          className="ml-2 inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/80 hover:text-foreground"
        >
          <SkipForward className="h-2.5 w-2.5" aria-hidden />
          {t('commander.action.cancelCurrentStep')}
        </button>
      ) : null}
    </div>
  );
});

function describePhase(
  phase: RunPhase,
  t: (key: string) => string,
): { label: string; step: number | null } {
  switch (phase.kind) {
    case 'idle':
      return { label: '', step: null };
    case 'awaiting_model':
      return { label: t('commander.phase.awaitingModel'), step: phase.step };
    case 'model_streaming':
      return { label: t('commander.phase.modelStreaming'), step: phase.step };
    case 'tool_running': {
      const toolLabel = t('commander.phase.toolRunning');
      const count = phase.tools.length;
      return {
        label: count > 1 ? `${toolLabel} (${count})` : toolLabel,
        step: phase.step,
      };
    }
    case 'awaiting_confirmation':
      return {
        label: `${t('commander.phase.awaitingConfirmation')}: ${phase.toolName}`,
        step: null,
      };
    case 'awaiting_question':
      return { label: t('commander.phase.awaitingQuestion'), step: null };
    case 'compacting':
      return { label: t('commander.phase.compacting'), step: null };
    case 'failed':
      return { label: `${t('commander.runFailed')}: ${phase.error}`, step: null };
    case 'done':
      return { label: '', step: null };
    default:
      return assertNever(phase, 'describePhase');
  }
}

function formatElapsed(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${s}s`;
}
