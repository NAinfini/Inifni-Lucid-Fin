import { memo } from 'react';
import { cn } from '../../../lib/utils.js';
import { Markdown } from './Markdown.js';
import { ToolCallCard } from './ToolCallCard.js';
import { CopyButton } from './CopyButton.js';
import { MessageActionStrip } from './MessageActionStrip.js';
import type { CommanderMessage, CommanderToolCall, MessageSegment } from '../../../store/slices/commander.js';

interface MessageListProps {
  messages: CommanderMessage[];
  liveMessage: {
    id: string;
    role: 'assistant';
    content: string;
    toolCalls: CommanderToolCall[];
  } | null;
  currentSegments: MessageSegment[];
  isStreaming: boolean;
  error: string | null;
  nodeTitlesById: Record<string, string>;
  t: (key: string) => string;
  emptyLabel: string;
  streamingLabel: string;
  onNodeClick?: (nodeId: string) => void;
}

export const MessageList = memo(function MessageList({
  messages,
  liveMessage,
  currentSegments,
  isStreaming,
  error,
  nodeTitlesById,
  t,
  emptyLabel,
  streamingLabel,
  onNodeClick,
}: MessageListProps) {
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
            'w-full text-sm',
            message.role === 'user'
              ? 'border-l-2 border-primary/40 pl-3 py-1.5'
              : 'py-1.5',
          )}
        >
          {message.role === 'user' ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
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
