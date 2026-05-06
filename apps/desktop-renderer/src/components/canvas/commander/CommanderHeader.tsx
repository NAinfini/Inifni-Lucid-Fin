import { useDispatch } from 'react-redux';
import { Minus, Trash2, X, Zap } from 'lucide-react';
import {
  newSession,
  minimizeCommander,
  setCommanderOpen,
} from '../../../store/slices/commander.js';
import { useCommander } from '../../../hooks/useCommander.js';
import { useConfirm } from '../../ui/ConfirmDialog.js';

interface CommanderHeaderProps {
  /** Attach to the header element so the shell's drag handler can identify it */
  onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
  t: (key: string) => string;
}

export function CommanderHeader({ onMouseDown, t }: CommanderHeaderProps) {
  const dispatch = useDispatch();
  const { confirm, ConfirmDialog } = useConfirm();
  const { cancel, isStreaming } = useCommander();

  return (
    <>
      <header
        className="flex shrink-0 cursor-move items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-1.5"
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Zap className="h-3.5 w-3.5 text-amber-400" />
          <span>{t('commander.commanderAI')}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={async () => {
              const ok = await confirm({
                title: t('commander.clearHistoryConfirmTitle'),
                description: t('commander.clearHistoryConfirmDesc'),
                confirmLabel: t('action.confirm'),
              });
              if (ok) dispatch(newSession());
            }}
            title={t('commander.clearHistory')}
            aria-label={t('commander.clearHistory')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => dispatch(minimizeCommander())}
            title={t('commander.minimize')}
            aria-label={t('commander.minimize')}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              if (isStreaming) void cancel();
              dispatch(setCommanderOpen(false));
            }}
            title={t('commander.close')}
            aria-label={t('commander.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>
      {ConfirmDialog}
    </>
  );
}
