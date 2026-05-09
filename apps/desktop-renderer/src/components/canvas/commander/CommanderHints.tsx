import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { Zap, X } from 'lucide-react';
import type { RootState } from '../../../store/index.js';

// ---------------------------------------------------------------------------
// ComposerChips — shows selected-node count chip above the textarea
// ---------------------------------------------------------------------------

interface ComposerChipsProps {
  t: (key: string) => string;
}

export const ComposerChips = React.memo(function ComposerChips({ t }: ComposerChipsProps) {
  const selectedCount = useSelector((state: RootState) => state.canvas.selectedNodeIds.length);
  if (selectedCount === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 px-3 pt-1.5">
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
        {t('commander.entityStrip.selected').replace('{count}', String(selectedCount))}
      </span>
    </div>
  );
});

// ---------------------------------------------------------------------------
// FirstSessionHint — one-time onboarding hint shown on empty chat
// ---------------------------------------------------------------------------

const LS_KEY_FIRST_SESSION = 'lucid-commander-first-session-seen';

interface FirstSessionHintProps {
  show: boolean;
  t: (key: string) => string;
}

export const FirstSessionHint = React.memo(function FirstSessionHint({
  show,
  t,
}: FirstSessionHintProps) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY_FIRST_SESSION) === '1';
    } catch {
      return false;
    }
  });
  if (!show || dismissed) return null;
  return (
    <div className="mb-2 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
      <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="flex-1">{t('commander.firstSessionHint')}</span>
      <button
        type="button"
        aria-label={t('action.close')}
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(LS_KEY_FIRST_SESSION, '1');
          } catch {
            /* noop */
          }
        }}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
});
