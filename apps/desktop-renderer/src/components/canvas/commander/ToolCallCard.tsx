import { useMemo, useState } from 'react';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { annotateToolPayload } from './node-formatting.js';
import { formatToolName } from './tool-formatting.js';
import { ArtifactPreview } from './ArtifactPreview.js';

export interface ToolCallCardProps {
  toolCall: {
    name: string;
    id: string;
    arguments: Record<string, unknown>;
    startedAt?: number;
    completedAt?: number;
    result?: unknown;
    status: string;
  };
  nodeTitlesById: Record<string, string>;
  t: (key: string) => string;
  onNodeClick?: (nodeId: string) => void;
}

export function ToolCallCard({ toolCall, nodeTitlesById, t, onNodeClick }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const formattedArguments = useMemo(
    () => JSON.stringify(annotateToolPayload(toolCall.arguments, nodeTitlesById), null, 2),
    [nodeTitlesById, toolCall.arguments],
  );
  const formattedResult = useMemo(
    () =>
      toolCall.result === undefined
        ? undefined
        : JSON.stringify(annotateToolPayload(toolCall.result, nodeTitlesById), null, 2),
    [nodeTitlesById, toolCall.result],
  );
  const elapsed =
    toolCall.completedAt && toolCall.startedAt
      ? (() => {
          const ms = toolCall.completedAt! - toolCall.startedAt;
          if (ms < 1) return '<1ms';
          if (ms < 1000) return `${Math.round(ms)}ms`;
          return `${(ms / 1000).toFixed(1)}s`;
        })()
      : null;

  return (
    <div
      className={cn(
        'mt-2 mb-2 overflow-hidden rounded-lg border bg-background/50',
        toolCall.status === 'pending' && 'border-amber-500/40 animate-pulse',
        toolCall.status === 'done' && 'border-emerald-500/30',
        toolCall.status === 'error' && 'border-destructive/40',
        toolCall.status !== 'pending' &&
          toolCall.status !== 'done' &&
          toolCall.status !== 'error' &&
          'border-border/60',
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/50"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {toolCall.status === 'pending' && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
        )}
        {toolCall.status === 'done' && <Check className="h-3.5 w-3.5 text-emerald-400" />}
        {toolCall.status === 'error' && <X className="h-3.5 w-3.5 text-destructive" />}
        <span className="flex-1 text-left">{formatToolName(toolCall.name, t)}</span>
        {elapsed && (
          <span className="text-[10px] text-muted-foreground">
            {t('commander.elapsed')} {elapsed}
          </span>
        )}
        <ChevronDown
          className={cn(
            'h-3 w-3 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-border/40 text-[11px]">
          <div className="max-h-60 overflow-y-auto px-2.5 py-2">
            <pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">
              {formattedArguments}
            </pre>
            {toolCall.result !== undefined && (
              <>
                <div className="mt-2 font-medium">
                  {t('commander.toolResult')}:{' '}
                  <span
                    className={cn(
                      toolCall.status === 'error' ? 'text-destructive' : 'text-emerald-400',
                    )}
                  >
                    {toolCall.status}
                  </span>
                </div>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-muted-foreground">
                  {formattedResult}
                </pre>
              </>
            )}
            {toolCall.status === 'done' && toolCall.result !== undefined && (
              <ArtifactPreview
                toolName={toolCall.name}
                result={toolCall.result}
                nodeTitlesById={nodeTitlesById}
                onNodeClick={onNodeClick}
              />
            )}
          </div>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1 border-t border-border/40 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            onClick={() => setExpanded(false)}
          >
            <ChevronDown className="h-3 w-3 rotate-180" />
            <span>{t('commander.minimize')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
