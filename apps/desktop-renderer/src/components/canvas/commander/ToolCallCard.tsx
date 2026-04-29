import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Loader2, Minus, RefreshCw } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { annotateToolPayload } from './node-formatting.js';
import {
  formatToolName,
  formatProductionToolName,
  summarizeToolAction,
} from './tool-formatting.js';
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
  resolveNodeAssetHash?: (nodeId: string) => string | undefined;
  t: (key: string) => string;
  onNodeClick?: (nodeId: string) => void;
  onSendMessage?: (message: string) => void;
}

export function ToolCallCard({
  toolCall,
  nodeTitlesById,
  resolveNodeAssetHash,
  t,
  onNodeClick,
  onSendMessage,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'artifacts' | 'inputs' | 'raw'>('summary');

  // Heavy payload formatting is deferred until the card is expanded to avoid
  // calling JSON.stringify on large payloads for every collapsed card.
  const formattedArguments = useMemo(
    () =>
      expanded
        ? JSON.stringify(annotateToolPayload(toolCall.arguments, nodeTitlesById), null, 2)
        : '',
    [expanded, nodeTitlesById, toolCall.arguments],
  );
  const formattedResult = useMemo(
    () =>
      !expanded || toolCall.result === undefined
        ? undefined
        : JSON.stringify(annotateToolPayload(toolCall.result, nodeTitlesById), null, 2),
    [expanded, nodeTitlesById, toolCall.result],
  );
  const formattedRaw = useMemo(() => {
    if (!expanded) return '';
    const raw: Record<string, unknown> = { arguments: toolCall.arguments };
    if (toolCall.result !== undefined) raw.result = toolCall.result;
    return JSON.stringify(raw, null, 2);
  }, [expanded, toolCall.arguments, toolCall.result]);
  const elapsed =
    toolCall.completedAt && toolCall.startedAt
      ? (() => {
          const ms = toolCall.completedAt! - toolCall.startedAt;
          if (ms < 1) return '<1ms';
          if (ms < 1000) return `${Math.round(ms)}ms`;
          return `${(ms / 1000).toFixed(1)}s`;
        })()
      : null;

  // Resolve the 5-state display status from the raw status + result payload.
  const displayStatus = useMemo((): 'done' | 'pending' | 'skipped' | 'error' | 'retrying' => {
    if (toolCall.status === 'retrying') return 'retrying';
    if (toolCall.status === 'skipped') return 'skipped';
    if (toolCall.status === 'error') {
      // RUN_ENDED_BEFORE_RESULT is a benign "run stopped" signal, not a real error.
      const r = toolCall.result as Record<string, unknown> | null | undefined;
      if (r && typeof r === 'object' && r.errorCode === 'RUN_ENDED_BEFORE_RESULT') return 'skipped';
      return 'error';
    }
    if (toolCall.status === 'pending') return 'pending';
    return 'done';
  }, [toolCall.status, toolCall.result]);

  // One-line error summary for the collapsed header of error-state cards.
  const errorSummary = useMemo(() => {
    if (displayStatus !== 'error') return null;
    const r = toolCall.result as Record<string, unknown> | null | undefined;
    if (r && typeof r === 'object') {
      const msg = r.error ?? r.message ?? r.errorCode;
      if (typeof msg === 'string') return msg.slice(0, 120);
    }
    return t('commander.unknownError');
  }, [displayStatus, toolCall.result, t]);

  // Production-language tool name (falls back to domain:action format).
  const displayName = useMemo(() => {
    const production = formatProductionToolName(
      toolCall.name,
      toolCall.arguments,
      toolCall.result,
      t,
    );
    return production ?? formatToolName(toolCall.name, t);
  }, [toolCall.name, toolCall.arguments, toolCall.result, t]);

  // Human-readable summary for the Summary tab — deferred until expanded.
  const toolSummary = useMemo(
    () =>
      expanded
        ? summarizeToolAction(toolCall.name, toolCall.arguments, t)
        : { action: '', detail: '' },
    [expanded, toolCall.name, toolCall.arguments, t],
  );

  // 3E: Post-action chips for completed tool calls.
  const postActions = useMemo(
    () => getPostActions(toolCall.name, toolCall.arguments, toolCall.result, displayStatus, t),
    [toolCall.name, toolCall.arguments, toolCall.result, displayStatus, t],
  );

  // 3F: Generation progress phases for canvas.generate in pending state.
  const generationPhase = useGenerationPhase(toolCall.name, displayStatus, toolCall.startedAt, t);

  return (
    <div
      className={cn(
        'mt-2 mb-2 overflow-hidden rounded-lg border bg-background/50',
        displayStatus === 'pending' && 'border-amber-500/40 animate-pulse',
        displayStatus === 'done' && 'border-emerald-500/30',
        displayStatus === 'skipped' && 'border-border/60',
        displayStatus === 'error' && 'border-amber-500/30',
        displayStatus === 'retrying' && 'border-amber-500/30',
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/50"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {displayStatus === 'pending' && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
        )}
        {displayStatus === 'done' && <Check className="h-3.5 w-3.5 text-emerald-400" />}
        {displayStatus === 'skipped' && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
        {displayStatus === 'error' && <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
        {displayStatus === 'retrying' && (
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-400" />
        )}
        <span className="flex-1 text-left">
          {displayName}
          {displayStatus === 'skipped' && (
            <span className="ml-1.5 text-[10px] text-muted-foreground">
              {t('commander.toolStatus.skipped')}
            </span>
          )}
          {displayStatus === 'retrying' && (
            <span className="ml-1.5 text-[10px] text-amber-400">
              {t('commander.toolStatus.retrying')}
            </span>
          )}
        </span>
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
      {/* Generation progress phase for pending canvas.generate */}
      {generationPhase ? (
        <div className="px-2.5 pb-1.5 text-[10px] text-amber-400/80">{generationPhase}</div>
      ) : null}
      {/* Error summary in collapsed state */}
      {!expanded && displayStatus === 'error' && errorSummary && (
        <div className="px-2.5 pb-1.5 text-[10px] text-amber-400/80 truncate">{errorSummary}</div>
      )}
      {/* Post-action chips for completed tools */}
      {!expanded && postActions.length > 0 && onSendMessage ? (
        <div className="flex flex-wrap gap-1 px-2.5 pb-1.5">
          {postActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary hover:border-primary/40"
              onClick={(e) => {
                e.stopPropagation();
                onSendMessage(action.message);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {expanded && (
        <div className="border-t border-border/40 text-[11px]">
          {/* 3M: Tabbed expansion */}
          <div className="flex border-b border-border/40">
            {(['summary', 'artifacts', 'inputs', 'raw'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={cn(
                  'flex-1 px-2 py-1 text-[10px] font-medium transition-colors',
                  activeTab === tab
                    ? 'text-primary border-b-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => setActiveTab(tab)}
              >
                {t(`commander.tab.${tab}`)}
              </button>
            ))}
          </div>
          <div className="max-h-60 overflow-y-auto px-2.5 py-2">
            {activeTab === 'summary' && (
              <div className="space-y-1">
                <div className="font-medium">{toolSummary.action}</div>
                <div className="text-muted-foreground">{toolSummary.detail}</div>
                {displayStatus === 'done' && toolCall.result !== undefined ? (
                  <div className="mt-1 text-emerald-400 text-[10px]">
                    {t('commander.runCompleted')}
                  </div>
                ) : displayStatus === 'error' && errorSummary ? (
                  <div className="mt-1 text-amber-400 text-[10px]">{errorSummary}</div>
                ) : null}
              </div>
            )}
            {activeTab === 'artifacts' && (
              <div>
                {displayStatus === 'done' && toolCall.result !== undefined ? (
                  <ArtifactPreview
                    toolName={toolCall.name}
                    result={toolCall.result}
                    nodeTitlesById={nodeTitlesById}
                    resolveNodeAssetHash={resolveNodeAssetHash}
                    t={t}
                    onNodeClick={onNodeClick}
                  />
                ) : (
                  <div className="text-muted-foreground italic">
                    {toolCall.result === undefined
                      ? t('commander.thinkingProcess')
                      : t('commander.toolStatus.error')}
                  </div>
                )}
              </div>
            )}
            {activeTab === 'inputs' && (
              <div>
                <pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">
                  {formattedArguments}
                </pre>
                {toolCall.result !== undefined && (
                  <>
                    <div className="mt-2 font-medium">
                      {t('commander.toolResult')}:{' '}
                      <span
                        className={cn(
                          displayStatus === 'done' && 'text-emerald-400',
                          displayStatus === 'error' && 'text-amber-400',
                          displayStatus === 'skipped' && 'text-muted-foreground',
                        )}
                      >
                        {displayStatus === 'error'
                          ? t('commander.toolStatus.error')
                          : displayStatus === 'skipped'
                            ? t('commander.toolStatus.skipped')
                            : displayStatus}
                      </span>
                    </div>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-muted-foreground">
                      {formattedResult}
                    </pre>
                  </>
                )}
              </div>
            )}
            {activeTab === 'raw' && (
              <pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">
                {formattedRaw}
              </pre>
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

// ---------------------------------------------------------------------------
// 3E: Post-action chip definitions
// ---------------------------------------------------------------------------

interface PostAction {
  label: string;
  message: string;
}

function getPostActions(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  status: string,
  t: (key: string) => string,
): PostAction[] {
  if (status !== 'done') return [];

  const name = toolName.toLowerCase();
  const nodeId = typeof args.nodeId === 'string' ? args.nodeId : '';
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const nodeType = typeof args.type === 'string' ? args.type : '';
  const resultNodeId = typeof r.nodeId === 'string' ? r.nodeId : nodeId;

  // canvas.generate
  if (name.includes('canvas') && name.includes('generate') && !name.includes('batch')) {
    const isVideo = nodeType === 'video' || (typeof r.type === 'string' && r.type === 'video');
    if (isVideo) {
      return [
        {
          label: t('commander.postAction.regenerate'),
          message: `Regenerate the video for node ${resultNodeId}`,
        },
        {
          label: t('commander.postAction.extend'),
          message: `Extend the video for node ${resultNodeId}`,
        },
      ];
    }
    return [
      {
        label: t('commander.postAction.regenerate'),
        message: `Regenerate the image for node ${resultNodeId}`,
      },
      {
        label: t('commander.postAction.useAsVideoFrame'),
        message: `Use the image from node ${resultNodeId} as a video frame source`,
      },
    ];
  }

  // character.create
  if (name.includes('character') && name.includes('create')) {
    const charName =
      typeof args.name === 'string' ? args.name : typeof r.name === 'string' ? r.name : '';
    const charId = typeof r.id === 'string' ? r.id : '';
    return [
      {
        label: t('commander.postAction.generateRefImage'),
        message: `Generate a reference image for character "${charName}" (${charId})`,
      },
      {
        label: t('commander.postAction.addCostume'),
        message: `Add a costume/loadout for character "${charName}" (${charId})`,
      },
    ];
  }

  // canvas.batchCreate
  if (name.includes('canvas') && name.includes('batchcreate')) {
    return [
      {
        label: t('commander.postAction.applyTemplates'),
        message: 'Apply shot templates to the newly created nodes',
      },
      {
        label: t('commander.postAction.setRefs'),
        message: 'Set character and location references on the newly created nodes',
      },
      { label: t('commander.postAction.generateAll'), message: 'Generate all newly created nodes' },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// 3F: Generation progress phases hook
// ---------------------------------------------------------------------------

const PREPARING_THRESHOLD_MS = 5_000;
const GENERATING_EST_MS = 30_000;

function useGenerationPhase(
  toolName: string,
  status: string,
  startedAt: number | undefined,
  t: (key: string) => string,
): string | null {
  const isGenerate =
    toolName.toLowerCase().includes('generate') && toolName.toLowerCase().includes('canvas');
  const isPending = status === 'pending';
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isGenerate || !isPending || !startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isGenerate, isPending, startedAt]);

  if (!isGenerate || !isPending || !startedAt) return null;

  const elapsedMs = now - startedAt;

  if (elapsedMs < PREPARING_THRESHOLD_MS) {
    return t('commander.generationPhase.preparing');
  }

  const remainingMs = Math.max(0, GENERATING_EST_MS - (elapsedMs - PREPARING_THRESHOLD_MS));
  if (remainingMs > 0) {
    const remainingSec = Math.ceil(remainingMs / 1000);
    return t('commander.generationPhase.generating').replace('{time}', `${remainingSec}s`);
  }

  return t('commander.generationPhase.processing');
}
