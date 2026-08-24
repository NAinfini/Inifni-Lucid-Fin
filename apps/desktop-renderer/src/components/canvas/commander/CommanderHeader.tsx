import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { ChevronDown, Minus, Wrench, X, Zap } from 'lucide-react';
import type { CatalogFrozenEvent } from '@lucid-fin/contracts';
import { minimizeCommander, setCommanderOpen } from '../../../store/slices/commander.js';
import { CommanderCapabilityViewer } from './CommanderCapabilityViewer.js';

interface CommanderHeaderProps {
  canvasLabel?: string | null;
  capabilityCatalog?: CatalogFrozenEvent | null;
  t: (key: string) => string;
}

export function CommanderHeader({
  canvasLabel,
  capabilityCatalog,
  t,
}: CommanderHeaderProps) {
  const dispatch = useDispatch();
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const capabilityPanelId = capabilityCatalog
    ? `commander-capabilities-${capabilityCatalog.runId}`
    : undefined;

  return (
    <header className="shrink-0 border-b border-border/60 bg-surface/30">
      <div className="flex h-14 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Zap className="h-5 w-5 text-amber-400" />
          <span className="shrink-0">{t('commander.commanderAI')}</span>
          {canvasLabel ? (
            <span className="min-w-0 truncate border-l border-border/60 pl-2 text-xs font-normal text-muted-foreground">
              {t('commander.canvasContext')}: {canvasLabel}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {capabilityCatalog ? (
            <button
              type="button"
              className="flex h-9 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-controls={capabilityPanelId}
              aria-expanded={capabilitiesOpen}
              aria-label={t('commander.capabilities.trigger')}
              title={t('commander.capabilities.trigger')}
              onClick={() => setCapabilitiesOpen((current) => !current)}
            >
              <Wrench className="h-4 w-4" aria-hidden="true" />
              <span className="tabular-nums">{capabilityCatalog.tools.length}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${capabilitiesOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          ) : null}
          <button
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => dispatch(minimizeCommander())}
            title={t('commander.minimize')}
            aria-label={t('commander.minimize')}
          >
            <Minus className="h-[18px] w-[18px]" />
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => dispatch(setCommanderOpen(false))}
            title={t('commander.close')}
            aria-label={t('commander.close')}
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
      {capabilityCatalog && capabilitiesOpen && capabilityPanelId ? (
        <CommanderCapabilityViewer id={capabilityPanelId} catalog={capabilityCatalog} t={t} />
      ) : null}
    </header>
  );
}
