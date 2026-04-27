import { useState, useMemo } from 'react';
import { Check, ChevronDown, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { ToolCallCard } from './ToolCallCard.js';
import type { CommanderToolCall } from '../../../store/slices/commander.js';

interface ChangesetCardProps {
  domain: string;
  toolCalls: CommanderToolCall[];
  nodeTitlesById: Record<string, string>;
  resolveNodeAssetHash?: (nodeId: string) => string | undefined;
  t: (key: string) => string;
  onNodeClick?: (nodeId: string) => void;
  onSendMessage?: (message: string) => void;
}

export function ChangesetCard({
  domain,
  toolCalls,
  nodeTitlesById,
  resolveNodeAssetHash,
  t,
  onNodeClick,
  onSendMessage,
}: ChangesetCardProps) {
  const [expanded, setExpanded] = useState(false);

  const { allDone, hasErrors, hasPending, totalElapsed } = useMemo(() => {
    let done = true;
    let errors = false;
    let pending = false;
    let elapsed = 0;
    for (const tc of toolCalls) {
      if (tc.status === 'error') errors = true;
      if (tc.status === 'pending') {
        pending = true;
        done = false;
      }
      if (tc.status !== 'done' && tc.status !== 'error') done = false;
      if (tc.completedAt && tc.startedAt) elapsed += tc.completedAt - tc.startedAt;
    }
    return { allDone: done, hasErrors: errors, hasPending: pending, totalElapsed: elapsed };
  }, [toolCalls]);

  const domainLabel = (() => {
    const localized = t(`commander.toolDomain.${domain}`);
    return localized.startsWith('commander.toolDomain.') ? domain : localized;
  })();

  const operationsLabel = t('commander.changeset.operations').replace(
    '{count}',
    String(toolCalls.length),
  );

  const elapsedStr = formatElapsed(totalElapsed);

  return (
    <div
      className={cn(
        'mt-2 mb-2 overflow-hidden rounded-lg border bg-background/50',
        hasPending && 'border-amber-500/40 animate-pulse',
        allDone && !hasErrors && 'border-emerald-500/30',
        hasErrors && 'border-amber-500/30',
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/50"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {hasPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
        ) : hasErrors ? (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
        ) : (
          <Check className="h-3.5 w-3.5 text-emerald-400" />
        )}
        <span className="flex-1 text-left">
          {domainLabel}{' '}
          <span className="text-muted-foreground font-normal">({operationsLabel})</span>
        </span>
        {allDone && elapsedStr ? (
          <span className="text-[10px] text-muted-foreground">{elapsedStr}</span>
        ) : null}
        <ChevronDown
          className={cn(
            'h-3 w-3 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded ? (
        <div className="border-t border-border/40 px-2 pb-2">
          {toolCalls.map((tc) => (
            <ToolCallCard
              key={tc.id}
              toolCall={tc}
              nodeTitlesById={nodeTitlesById}
              resolveNodeAssetHash={resolveNodeAssetHash}
              t={t}
              onNodeClick={onNodeClick}
              onSendMessage={onSendMessage}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
