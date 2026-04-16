import { memo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, MessageCircleQuestion } from 'lucide-react';
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

  const statusLabel =
    runMeta.status === 'failed' ? t('commander.runFailed') : t('commander.runCompleted');
  const statusIcon =
    runMeta.status === 'failed' ? (
      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
    ) : (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
    );
  const detailOpen = !runMeta.collapsed || expanded;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border bg-background/30 shadow-[0_0_0_1px_rgba(255,255,255,0.01)]',
        runMeta.status === 'failed' ? 'border-destructive/30' : 'border-border/60',
      )}
    >
      <button
        type="button"
        aria-expanded={detailOpen}
        aria-label={detailOpen ? t('commander.collapseRun') : t('commander.expandRun')}
        className="flex w-full flex-col items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/20"
        onClick={onToggle}
      >
        <div
          data-testid="run-summary-header"
          className="flex w-full items-start gap-3"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="mt-0.5 shrink-0">{statusIcon}</span>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide',
                runMeta.status === 'failed'
                  ? 'border-destructive/35 bg-destructive/10 text-destructive'
                  : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
              )}
            >
              {statusLabel}
            </span>
          </div>
          <div
            data-testid="run-summary-metrics"
            className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px]"
          >
            <span className="text-muted-foreground">
              {formatDuration(runMeta.summary.durationMs)}
            </span>
            <span className="text-muted-foreground">
              {runMeta.summary.toolCount} {t('commander.runTools')}
            </span>
            {runMeta.summary.failedToolCount > 0 ? (
              <span className="text-destructive">
                {runMeta.summary.failedToolCount} {t('commander.runErrors')}
              </span>
            ) : null}
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform',
                detailOpen && 'rotate-180',
              )}
            />
          </div>
        </div>
        <div
          data-testid="run-summary-excerpt"
          className="w-full min-w-0 text-[13px] leading-6 text-foreground/88 line-clamp-2"
        >
          {runMeta.summary.excerpt}
        </div>
      </button>
      {detailOpen ? (
        <div className="border-t border-border/40">
          {message.runMeta?.thinkingContent ? (
            <HistoricalThinkingCard content={message.runMeta.thinkingContent} t={t} />
          ) : null}
          <AssistantMessageBody
            message={message}
            nodeTitlesById={nodeTitlesById}
            onNodeClick={onNodeClick}
            t={t}
          />
        </div>
      ) : null}
    </div>
  );
}

interface AssistantMessageBodyProps {
  message: CommanderMessage;
  nodeTitlesById: Record<string, string>;
  t: (key: string) => string;
  onNodeClick?: (nodeId: string) => void;
}

function AssistantMessageBody({
  message,
  nodeTitlesById,
  t,
  onNodeClick,
}: AssistantMessageBodyProps) {
  if (message.segments && message.segments.length > 0) {
    return (
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
    );
  }

  return (
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
  );
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
