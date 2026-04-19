import { memo, useState } from 'react';
import { AlertTriangle, ChevronDown, MessageCircleQuestion } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { Markdown } from './Markdown.js';
import { ToolCallCard } from './ToolCallCard.js';
import { CopyButton } from './CopyButton.js';
import { MessageActionStrip } from './MessageActionStrip.js';
import type {
  CommanderMessage,
  CommanderToolCall,
  MessageSegment,
} from '../../../store/slices/commander.js';

interface MessageListProps {
  messages: CommanderMessage[];
  liveMessage: {
    id: string;
    role: 'assistant';
    content: string;
    toolCalls: CommanderToolCall[];
  } | null;
  currentSegments: MessageSegment[];
  pendingInjectedMessages: string[];
  isStreaming: boolean;
  error: string | null;
  nodeTitlesById: Record<string, string>;
  thinkingContent?: string;
  t: (key: string) => string;
  emptyLabel: string;
  streamingLabel: string;
  onNodeClick?: (nodeId: string) => void;
}

export const MessageList = memo(function MessageList({
  messages,
  liveMessage,
  currentSegments,
  pendingInjectedMessages,
  isStreaming,
  error,
  nodeTitlesById,
  thinkingContent,
  t,
  emptyLabel,
  streamingLabel,
  onNodeClick,
}: MessageListProps) {
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const showThinking = Boolean(thinkingContent);
  const toggleRunExpanded = (messageId: string) => {
    setExpandedRuns((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
  };

  return (
    <>
      {messages.length === 0 && !liveMessage ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : null}

      {messages.map((message) => (
        <article
          key={message.id}
          className={cn(
            'min-w-0 w-full text-sm',
            message.role === 'user'
              ? 'border-l-2 border-primary/40 pl-3 py-1.5'
              : 'py-1.5',
          )}
        >
          {message.role === 'user' ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : message.questionMeta ? (
            <HistoricalQuestionCard message={message} t={t} />
          ) : message.runMeta ? (
            <RunSummaryCard
              expanded={Boolean(expandedRuns[message.id])}
              message={message}
              nodeTitlesById={nodeTitlesById}
              onNodeClick={onNodeClick}
              onToggle={() => toggleRunExpanded(message.id)}
              t={t}
            />
          ) : message.segments && message.segments.length > 0 ? (
            <>
              {message.content ? (
                <MessageActionStrip messageId={message.id}>
                  <CopyButton text={message.content} label={t('commander.copy')} />
                </MessageActionStrip>
              ) : null}
              <div className="px-3 py-2">
                {message.segments.map((seg, i) =>
                  seg.type === 'text' ? (
                    <Markdown key={i} content={seg.content} onNodeClick={onNodeClick} />
                  ) : (
                    <ToolCallCard
                      key={seg.toolCall.id}
                      toolCall={seg.toolCall}
                      nodeTitlesById={nodeTitlesById}
                      t={t}
                      onNodeClick={onNodeClick}
                    />
                  ),
                )}
              </div>
              <RemainingToolCalls
                message={message}
                nodeTitlesById={nodeTitlesById}
                onNodeClick={onNodeClick}
                t={t}
              />
            </>
          ) : (
            <>
              {message.content ? (
                <>
                  <MessageActionStrip messageId={message.id}>
                    <CopyButton text={message.content} label={t('commander.copy')} />
                  </MessageActionStrip>
                  <div className="px-3 py-2">
                    <Markdown content={message.content} onNodeClick={onNodeClick} />
                  </div>
                </>
              ) : null}
              {message.toolCalls?.length ? (
                <div className={cn('px-3', message.content ? 'pb-2' : 'py-2')}>
                  {message.toolCalls.map((toolCall) => (
                    <ToolCallCard
                      key={toolCall.id}
                      toolCall={toolCall}
                      nodeTitlesById={nodeTitlesById}
                      t={t}
                      onNodeClick={onNodeClick}
                    />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </article>
      ))}

      {liveMessage ? (
        <article className="w-full py-1.5 text-xs">
          {currentSegments.length > 0 ? (
            <>
              {currentSegments.map((seg, i) =>
                seg.type === 'text' ? (
                  <div key={i}>
                    <Markdown content={seg.content} onNodeClick={onNodeClick} />
                    {isStreaming && i === currentSegments.length - 1 ? (
                      <span className="inline-block animate-pulse text-primary">▌</span>
                    ) : null}
                  </div>
                ) : (
                  <ToolCallCard
                    key={seg.toolCall.id}
                    toolCall={seg.toolCall}
                    nodeTitlesById={nodeTitlesById}
                    t={t}
                    onNodeClick={onNodeClick}
                  />
                ),
              )}
            </>
          ) : null}
        </article>
      ) : null}

      {/* User messages injected during streaming — shown below live AI response */}
      {pendingInjectedMessages.map((msg, i) => (
        <article
          key={`injected-${i}`}
          className="min-w-0 w-full border-l-2 border-primary/40 pl-3 py-1.5 text-sm opacity-70"
        >
          <div className="whitespace-pre-wrap break-words">{msg}</div>
        </article>
      ))}

      {showThinking ? (
        <div className="rounded-md border border-violet-500/30 bg-violet-500/5">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-violet-400 hover:text-violet-300"
            onClick={() => setThinkingExpanded((prev) => !prev)}
          >
            <span className="animate-pulse">{'✦'}</span>
            <span>{t('commander.thinkingProcess')}</span>
            <span className="ml-auto text-[9px]">{thinkingExpanded ? '▾' : '▸'}</span>
          </button>
          {thinkingExpanded ? (
            <div className="border-t border-violet-500/20 px-2.5 py-2 text-[11px] leading-relaxed text-violet-300/80">
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap">{thinkingContent}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {isStreaming && (
        <div className="flex items-center gap-2 py-2 text-muted-foreground">
          <div className="flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: '0ms' }} />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: '150ms' }} />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="text-[10px]">{streamingLabel}</span>
        </div>
      )}

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </>
  );
});

interface RemainingToolCallsProps {
  message: CommanderMessage;
  nodeTitlesById: Record<string, string>;
  t: (key: string) => string;
  onNodeClick?: (nodeId: string) => void;
}

function RemainingToolCalls({
  message,
  nodeTitlesById,
  t,
  onNodeClick,
}: RemainingToolCallsProps) {
  const segmentToolCallIds = new Set(
    (message.segments ?? [])
      .filter((segment): segment is Extract<MessageSegment, { type: 'tool' }> => segment.type === 'tool')
      .map((segment) => segment.toolCall.id),
  );
  const remainingToolCalls = (message.toolCalls ?? []).filter(
    (toolCall) => !segmentToolCallIds.has(toolCall.id),
  );

  if (remainingToolCalls.length === 0) {
    return null;
  }

  return (
    <div className={cn('px-3', message.content ? 'pb-2' : 'py-2')}>
      {remainingToolCalls.map((toolCall) => (
        <ToolCallCard
          key={toolCall.id}
          toolCall={toolCall}
          nodeTitlesById={nodeTitlesById}
          t={t}
          onNodeClick={onNodeClick}
        />
      ))}
    </div>
  );
}

interface RunSummaryCardProps {
  expanded: boolean;
  message: CommanderMessage;
  nodeTitlesById: Record<string, string>;
  t: (key: string) => string;
  onToggle: () => void;
  onNodeClick?: (nodeId: string) => void;
}

/**
 * Codex-style run rendering. The assistant's final text is always visible
 * and rendered in full as normal markdown — it is NEVER hidden behind a
 * collapsed card. What folds away is the "process" that produced it: the
 * thinking chain, the intermediate text, and each tool invocation. A single
 * one-line toggle above the answer lets the user peek at how the model got
 * there when they need it.
 */
function RunSummaryCard({
  expanded,
  message,
  nodeTitlesById,
  t,
  onToggle,
  onNodeClick,
}: RunSummaryCardProps) {
  const runMeta = message.runMeta;
  if (!runMeta) {
    return null;
  }

  const { finalSegments, processSegments } = splitFinalFromProcess(message.segments);
  const processToolCalls = collectProcessToolCalls(message.toolCalls, message.segments);
  const hasThinking = Boolean(runMeta.thinkingContent);
  const isFailed = runMeta.status === 'failed';
  // Show the process toggle whenever the run did *something* worth folding:
  // thinking, intermediate segments, uncaptured tool calls, or a tool count
  // recorded on the summary even if raw segment/tool data is missing (older
  // persisted messages, historical sessions).
  const hasProcess =
    processSegments.length > 0 ||
    processToolCalls.length > 0 ||
    hasThinking ||
    runMeta.summary.toolCount > 0 ||
    isFailed;

  // The "final" text is the closing assistant reply. If the run failed or
  // produced no closing text, fall back to `message.content` so the user
  // still sees something actionable (error message / full content).
  const finalText = finalSegments.length > 0
    ? finalSegments
        .filter((seg): seg is Extract<MessageSegment, { type: 'text' }> => seg.type === 'text')
        .map((seg) => seg.content)
        .join('')
    : message.content;

  return (
    <div className="min-w-0">
      {hasProcess ? (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? t('commander.collapseRun') : t('commander.expandRun')}
            onClick={onToggle}
            data-testid="run-summary-header"
            className="flex w-full items-center gap-1.5 px-3 py-1 text-[11px] text-muted-foreground/80 hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={cn(
                'h-3 w-3 shrink-0 transition-transform',
                expanded ? 'rotate-0' : '-rotate-90',
              )}
            />
            <span
              data-testid="run-summary-metrics"
              className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 tabular-nums"
            >
              <span>
                {runMeta.summary.toolCount} {t('commander.runTools')}
              </span>
              <span aria-hidden className="opacity-40">·</span>
              <span>{formatDuration(runMeta.summary.durationMs)}</span>
              {runMeta.summary.failedToolCount > 0 ? (
                <>
                  <span aria-hidden className="opacity-40">·</span>
                  <span className="text-destructive">
                    {runMeta.summary.failedToolCount} {t('commander.runErrors')}
                  </span>
                </>
              ) : null}
              {isFailed ? (
                <>
                  <span aria-hidden className="opacity-40">·</span>
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    {t('commander.runFailed')}
                  </span>
                </>
              ) : null}
            </span>
          </button>
          {expanded ? (
            <div className="border-l-2 border-border/60 ml-3 pl-2 py-1 space-y-1">
              {hasThinking ? (
                <HistoricalThinkingCard content={runMeta.thinkingContent!} t={t} />
              ) : null}
              <ProcessSegments
                segments={processSegments}
                nodeTitlesById={nodeTitlesById}
                onNodeClick={onNodeClick}
                t={t}
              />
              {processToolCalls.map((toolCall) => (
                <ToolCallCard
                  key={toolCall.id}
                  toolCall={toolCall}
                  nodeTitlesById={nodeTitlesById}
                  t={t}
                  onNodeClick={onNodeClick}
                />
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {/* Final answer — always visible, always full markdown. */}
      {finalText ? (
        <>
          <MessageActionStrip messageId={message.id}>
            <CopyButton text={finalText} label={t('commander.copy')} />
          </MessageActionStrip>
          <div data-testid="run-summary-final" className="px-3 py-1">
            <Markdown content={finalText} onNodeClick={onNodeClick} />
          </div>
        </>
      ) : null}
    </div>
  );
}

interface ProcessSegmentsProps {
  segments: MessageSegment[];
  nodeTitlesById: Record<string, string>;
  t: (key: string) => string;
  onNodeClick?: (nodeId: string) => void;
}

function ProcessSegments({ segments, nodeTitlesById, t, onNodeClick }: ProcessSegmentsProps) {
  if (segments.length === 0) return null;
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <div key={`process-text-${i}`} className="px-2 py-1 text-[12px] text-muted-foreground/90">
            <Markdown content={seg.content} onNodeClick={onNodeClick} />
          </div>
        ) : (
          <ToolCallCard
            key={seg.toolCall.id}
            toolCall={seg.toolCall}
            nodeTitlesById={nodeTitlesById}
            t={t}
            onNodeClick={onNodeClick}
          />
        ),
      )}
    </>
  );
}

/**
 * Split a run's segment list into "final text" (the trailing text the model
 * produced after its last tool call — the result the user cares about) and
 * "process" (everything before that — intermediate text + tool calls).
 *
 * If the run has no tool calls, all text is "final" and there is no process.
 * If the run ended on a tool call (no closing text), `finalSegments` is empty
 * and the caller falls back to `message.content`.
 */
function splitFinalFromProcess(segments: MessageSegment[] | undefined): {
  finalSegments: MessageSegment[];
  processSegments: MessageSegment[];
} {
  if (!segments || segments.length === 0) {
    return { finalSegments: [], processSegments: [] };
  }
  // Find the index of the last tool segment. Everything after it is the
  // final answer; everything up to and including it is process.
  let lastToolIdx = -1;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i]!.type === 'tool') {
      lastToolIdx = i;
      break;
    }
  }
  if (lastToolIdx === -1) {
    // No tools — the whole run is final text.
    return { finalSegments: [...segments], processSegments: [] };
  }
  return {
    finalSegments: segments.slice(lastToolIdx + 1),
    processSegments: segments.slice(0, lastToolIdx + 1),
  };
}

/**
 * Tool calls that were tracked on the message but never made it into the
 * segment stream (older runs, or edge-case streaming). Render them alongside
 * the process so they are not lost. Excludes any tool that already appears
 * in either the process or the final tail — those render from segments.
 */
function collectProcessToolCalls(
  toolCalls: CommanderToolCall[] | undefined,
  segments: MessageSegment[] | undefined,
): CommanderToolCall[] {
  if (!toolCalls || toolCalls.length === 0) return [];
  const segmentIds = new Set(
    (segments ?? [])
      .filter((s): s is Extract<MessageSegment, { type: 'tool' }> => s.type === 'tool')
      .map((s) => s.toolCall.id),
  );
  return toolCalls.filter((tc) => !segmentIds.has(tc.id));
}

interface HistoricalQuestionCardProps {
  message: CommanderMessage;
  t: (key: string) => string;
}

function HistoricalQuestionCard({ message, t }: HistoricalQuestionCardProps) {
  if (!message.questionMeta) {
    return null;
  }

  return (
    <div className="mx-3 my-2 rounded-lg border border-blue-500/50 bg-blue-500/5 p-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <MessageCircleQuestion className="h-4 w-4 text-blue-400" />
        <span>{t('commander.question.title')}</span>
      </div>
      <div className="mt-2 space-y-1.5 text-sm">
        <p className="text-foreground">{message.questionMeta.question}</p>
        {message.questionMeta.options.map((option) => (
          <p key={option.label} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{option.label}</span>
            {option.description ? `: ${option.description}` : ''}
          </p>
        ))}
      </div>
    </div>
  );
}

interface HistoricalThinkingCardProps {
  content: string;
  t: (key: string) => string;
}

function HistoricalThinkingCard({ content, t }: HistoricalThinkingCardProps) {
  return (
    <div className="mx-3 mt-3 rounded-md border border-violet-500/30 bg-violet-500/5">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] text-violet-400">
        <span>{t('commander.thinkingProcess')}</span>
      </div>
      <div className="border-t border-violet-500/20 px-2.5 py-2 text-[11px] leading-relaxed text-violet-300/80">
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  );
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1) return '<1ms';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  if (durationMs < 3_600_000) return `${(durationMs / 60_000).toFixed(1)}m`;
  return `${(durationMs / 3_600_000).toFixed(1)}h`;
}
