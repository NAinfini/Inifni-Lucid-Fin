import { useDispatch, useSelector } from 'react-redux';
import { useEffect, useRef } from 'react';
import type { RootState } from '../../../store/index.js';
import type {
  PendingConfirmation,
} from '../../../commander/state/types.js';
import {
  clearPendingConfirmation,
  setConfirmAutoMode,
} from '../../../store/slices/commander.js';
import { markConfirmationResolvedLocally } from '../../../commander/state/commander-timeline-slice.js';
import { getAPI } from '../../../utils/api.js';
import { ToolConfirmCard } from './ToolConfirmCard.js';

interface CommanderStreamViewProps {
  pendingConfirmation: PendingConfirmation | null | undefined;
  consecutiveConfirmCount: number;
  t: (key: string) => string;
}
/**
 * Renders the tool confirmation card (and the "approve all / skip all" batch
 * controls). The pending-question card is handled separately in the shell
 * because it must be positioned as an absolute overlay inside the footer.
 */
export function CommanderStreamView({
  pendingConfirmation,
  consecutiveConfirmCount,
  t,
}: CommanderStreamViewProps) {
  const dispatch = useDispatch();

  // Track activeCanvasId in a ref so handlers read the current value
  // without needing direct store.getState() access.
  const activeCanvasId = useSelector((state: RootState) => state.canvas.activeCanvasId);
  const activeCanvasIdRef = useRef(activeCanvasId);
  useEffect(() => {
    activeCanvasIdRef.current = activeCanvasId;
  }, [activeCanvasId]);

  const resolveConfirmation = (accept: boolean) => {
    if (!pendingConfirmation) return;
    const api = getAPI();
    const canvasId = activeCanvasIdRef.current;
    if (api?.commander && canvasId) {
      void api.commander.confirmTool(canvasId, pendingConfirmation.toolCallId, accept);
    }
    dispatch(markConfirmationResolvedLocally(pendingConfirmation.toolCallId));
    dispatch(clearPendingConfirmation());
  };

  if (!pendingConfirmation) return null;

  return (
    <div className="space-y-1">
      <ToolConfirmCard
        toolName={pendingConfirmation.toolName}
        args={pendingConfirmation.args}
        tier={pendingConfirmation.tier}
        onExecute={() => resolveConfirmation(true)}
        onSkip={() => resolveConfirmation(false)}
        t={t}
      />
      {consecutiveConfirmCount >= 4 && (
        <div className="flex items-center justify-end gap-1.5 px-3 pb-1">
          <span className="text-[10px] text-muted-foreground mr-auto">
            {t('commander.confirmBatchHint')}
          </span>
          <button
            type="button"
            className="text-[10px] px-2 py-0.5 rounded border border-border/60 text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
            onClick={() => {
              const api = getAPI();
              const canvasId = activeCanvasIdRef.current;
              if (api?.commander && canvasId) {
                void api.commander.confirmTool(canvasId, pendingConfirmation.toolCallId, false);
              }
              dispatch(setConfirmAutoMode('skip'));
              dispatch(markConfirmationResolvedLocally(pendingConfirmation.toolCallId));
              dispatch(clearPendingConfirmation());
            }}
          >
            {t('commander.skipAll')}
          </button>
          <button
            type="button"
            className="text-[10px] px-2 py-0.5 rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
            onClick={() => {
              const api = getAPI();
              const canvasId = activeCanvasIdRef.current;
              if (api?.commander && canvasId) {
                void api.commander.confirmTool(canvasId, pendingConfirmation.toolCallId, true);
              }
              dispatch(setConfirmAutoMode('approve'));
              dispatch(markConfirmationResolvedLocally(pendingConfirmation.toolCallId));
              dispatch(clearPendingConfirmation());
            }}
          >
            {t('commander.executeAll')}
          </button>
        </div>
      )}
    </div>
  );
}
