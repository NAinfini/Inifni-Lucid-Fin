import { memo, type ReactNode, useState } from 'react';
import { AlertTriangle, ChevronDown, MessageCircleQuestion } from 'lucide-react';

import { localizeToolName } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import type {
  CommanderMessage,
  CommanderToolCall,
  MessageSegment,
} from '../../../store/slices/commander.js';
import { CancelledBanner } from './CancelledBanner.js';
import { CopyButton } from './CopyButton.js';
import { Markdown } from './Markdown.js';
import { MessageActionStrip } from './MessageActionStrip.js';
import { localizeRunBlocker } from './run-blocker-label.js';

interface MessageListProps {
  messages: CommanderMessage[];
  hasActiveRun?: boolean;
  pendingInjectedMessages: string[];
  error: string | null;
  t: (key: string) => string;
  emptyLabel: string;
  onNodeClick?: (nodeId: string) => void;
  onViewActivity?: (runId: string) => void;
  expandedActivityRunId?: string | null;
  activityContent?: ReactNode;
}

/**
 * Conversation-only projection. Live model narration, reasoning and raw tool
 * payloads stay in the timeline for recovery and audit, but are not rendered.
 */
export const MessageList = memo(function MessageList({
  messages,
  hasActiveRun = false,
  pendingInjectedMessages,
  error,
  t,
  emptyLabel,
  onNodeClick,
  onViewActivity,
  expandedActivityRunId = null,
  activityContent,
}: MessageListProps) {
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});

  return (
    <>
      {messages.length === 0 && !hasActiveRun ? (
        <div className="px-2 py-12 text-center text-sm text-muted-foreground">{emptyLabel}</div>
      ) : null}

      <div className="space-y-5">
        {messages.map((message) =>
          message.role === 'user' ? (
            <UserMessageRow key={message.id} message={message} />
          ) : (
            <AssistantMessageRow
              key={message.id}
              expanded={Boolean(expandedRuns[message.id])}
              message={message}
              onNodeClick={onNodeClick}
              onViewActivity={onViewActivity}
              expandedActivityRunId={expandedActivityRunId}
              activityContent={activityContent}
              onToggle={() =>
                setExpandedRuns((previous) => ({
                  ...previous,
                  [message.id]: !previous[message.id],
                }))
              }
              t={t}
            />
          ),
        )}
      </div>

      {pendingInjectedMessages.map((message, index) => (
        <article
          key={`injected-${index}`}
          className="flex min-w-0 w-full justify-end py-2 text-sm opacity-70"
        >
          <div className="max-w-[72%] whitespace-pre-wrap break-words rounded-xl border border-border/70 bg-surface/70 px-4 py-3">
            {message}
          </div>
        </article>
      ))}

      {error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </>
  );
});

function formatMessageTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function UserMessageRow({ message }: { message: CommanderMessage }) {
  return (
    <article
      data-testid={`commander-message-${message.id}`}
      className="flex min-w-0 w-full justify-end py-1 text-sm"
    >
      <div className="max-w-[72%] rounded-xl border border-border/70 bg-surface/75 px-4 py-3 shadow-sm">
        <div className="whitespace-pre-wrap break-words leading-6">{message.content}</div>
        <time
          data-testid="commander-message-time"
          dateTime={new Date(message.timestamp).toISOString()}
          className="mt-1 block text-right text-[11px] tabular-nums text-muted-foreground"
        >
          {formatMessageTime(message.timestamp)}
        </time>
      </div>
    </article>
  );
}

function AssistantMessageFrame({
  children,
  messageId,
  timestamp,
  t,
}: {
  children: ReactNode;
  messageId: string;
  timestamp?: number;
  t: (key: string) => string;
}) {
  return (
    <article
      data-testid={`commander-message-${messageId}`}
      className="group flex min-w-0 w-full justify-start py-1 text-sm"
    >
      <div className="min-w-0 max-w-[720px] flex-1">
        <div className="mb-1.5 flex min-h-5 items-center gap-2 text-xs">
          <span className="font-semibold text-foreground">{t('commander.commanderAI')}</span>
          {timestamp !== undefined ? (
            <time
              data-testid="commander-message-time"
              dateTime={new Date(timestamp).toISOString()}
              className="tabular-nums text-muted-foreground"
            >
              {formatMessageTime(timestamp)}
            </time>
          ) : null}
        </div>
        <div className="min-w-0 leading-6">{children}</div>
      </div>
    </article>
  );
}

function AssistantMessageRow({
  expanded,
  message,
  t,
  onToggle,
  onNodeClick,
  onViewActivity,
  expandedActivityRunId,
  activityContent,
}: {
  expanded: boolean;
  message: CommanderMessage;
  t: (key: string) => string;
  onToggle: () => void;
  onNodeClick?: (nodeId: string) => void;
  onViewActivity?: (runId: string) => void;
  expandedActivityRunId?: string | null;
  activityContent?: ReactNode;
}) {
  let content: ReactNode;
  if (message.questionMeta) {
    content = <HistoricalQuestionCard message={message} t={t} />;
  } else if (message.runMeta) {
    content = (
      <RunSummaryCard
        expanded={expanded}
        message={message}
        onNodeClick={onNodeClick}
        onToggle={onToggle}
        onViewActivity={onViewActivity}
        expandedActivityRunId={expandedActivityRunId}
        activityContent={activityContent}
        t={t}
      />
    );
  } else {
    content = message.content ? (
      <>
        <MessageActionStrip messageId={message.id}>
          <CopyButton text={message.content} label={t('commander.copy')} />
        </MessageActionStrip>
        <div className="py-1">
          <Markdown content={message.content} onNodeClick={onNodeClick} />
        </div>
      </>
    ) : null;
  }

  return (
    <AssistantMessageFrame messageId={message.id} timestamp={message.timestamp} t={t}>
      {content}
    </AssistantMessageFrame>
  );
}

function RunSummaryCard({
  expanded,
  message,
  t,
  onToggle,
  onNodeClick,
  onViewActivity,
  expandedActivityRunId,
  activityContent,
}: {
  expanded: boolean;
  message: CommanderMessage;
  t: (key: string) => string;
  onToggle: () => void;
  onNodeClick?: (nodeId: string) => void;
  onViewActivity?: (runId: string) => void;
  expandedActivityRunId?: string | null;
  activityContent?: ReactNode;
}) {
  const runMeta = message.runMeta;
  if (!runMeta) return null;

  const finalText = findFinalText(message);
  const toolUsage = summarizeToolUsage(message.toolCalls, message.segments);
  const tokenCount = resourceUsageTotal(message.segments);
  const isFailed = runMeta.status === 'failed';
  const isBlocked = runMeta.status === 'blocked';
  const hasExpandableDetails = toolUsage.length > 0;
  const runId =
    runMeta.runId ??
    (message.id.startsWith('assistant-run-')
      ? message.id.slice('assistant-run-'.length)
      : null);
  const activityExpanded = runId !== null && runId === expandedActivityRunId;
  const summaryHeading = (
    <>
      <span data-testid="run-summary-metrics" className="shrink-0 tabular-nums">
        {t('commander.elapsed')} {formatDuration(runMeta.summary.durationMs)}
      </span>
      {isFailed ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-destructive">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {t('commander.runFailed')}
        </span>
      ) : null}
      {isBlocked ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-amber-400">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          {t('commander.runBlocked')}
        </span>
      ) : null}
      {tokenCount > 0 ? (
        <span data-testid="run-summary-resource-usage" className="shrink-0 tabular-nums">
          {t('commander.resourceUsage').replace('{count}', tokenCount.toLocaleString())}
        </span>
      ) : null}
      <span
        data-testid="run-summary-divider"
        aria-hidden
        className="h-px min-w-6 flex-1 bg-border/70"
      />
    </>
  );

  return (
    <div className="min-w-0">
      {runMeta.cancelled ? (
        <CancelledBanner
          event={{
            kind: 'cancelled',
            reason: runMeta.cancelled.reason,
            partialContent: runMeta.cancelled.partialContent,
            completedToolCalls: runMeta.cancelled.completedToolCalls,
            pendingToolCalls: runMeta.cancelled.pendingToolCalls,
            runId: message.id,
            step: 0,
            seq: 0,
            emittedAt: runMeta.completedAt,
          }}
          stats={{
            completed: runMeta.cancelled.completedToolCalls,
            pending: runMeta.cancelled.pendingToolCalls,
          }}
          t={t}
        />
      ) : null}

      {runMeta.status === 'blocked' && runMeta.blocker ? (
        <p
          data-testid="run-blocker"
          className="mb-2 flex items-start gap-2 text-xs leading-5 text-amber-300"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{localizeRunBlocker(runMeta.blocker, t)}</span>
        </p>
      ) : null}

      <>
        {hasExpandableDetails ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? t('commander.collapseRun') : t('commander.expandRun')}
            onClick={onToggle}
            data-testid="run-summary-header"
            className="flex w-full items-center gap-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {summaryHeading}
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 shrink-0 transition-transform',
                !expanded && '-rotate-90',
              )}
              aria-hidden
            />
          </button>
        ) : (
          <div
            data-testid="run-summary-header"
            className="flex w-full items-center gap-2 py-1 text-xs text-muted-foreground"
          >
            {summaryHeading}
          </div>
        )}
        {expanded && hasExpandableDetails ? <ToolUsageSummary groups={toolUsage} t={t} /> : null}
      </>

      {runId && onViewActivity ? (
        <>
          <button
            type="button"
            aria-expanded={activityExpanded}
            aria-controls={`run-activity-${runId}`}
            onClick={() => onViewActivity(runId)}
            className="mt-2 text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {activityExpanded
              ? t('commander.runActivity.collapse')
              : t('commander.agentActivity.viewActivity')}
          </button>
          {activityExpanded && activityContent ? (
            <div id={`run-activity-${runId}`} className="mt-3">
              {activityContent}
            </div>
          ) : null}
        </>
      ) : null}

      {finalText ? (
        <>
          <MessageActionStrip messageId={message.id}>
            <CopyButton text={finalText} label={t('commander.copy')} />
          </MessageActionStrip>
          <div data-testid="run-summary-final" className="pt-3">
            <Markdown content={finalText} onNodeClick={onNodeClick} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function findFinalText(message: CommanderMessage): string {
  const segments = message.segments ?? [];
  let lastToolIndex = -1;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index]?.kind === 'tool') {
      lastToolIndex = index;
      break;
    }
  }
  if (lastToolIndex < 0) return message.content;

  const finalText = segments
    .slice(lastToolIndex + 1)
    .filter(
      (segment): segment is Extract<MessageSegment, { kind: 'text' }> => segment.kind === 'text',
    )
    .map((segment) => segment.content)
    .join('');
  return finalText;
}

interface ToolUsageGroup {
  name: string;
  count: number;
  completed: number;
  failed: number;
  durationMs?: number;
  artifacts: Array<{ id: string; label?: string }>;
}

function summarizeToolUsage(
  toolCalls: CommanderToolCall[] | undefined,
  segments: MessageSegment[] | undefined,
): ToolUsageGroup[] {
  const callsById = new Map<string, CommanderToolCall>();
  for (const segment of segments ?? []) {
    if (segment.kind === 'tool') callsById.set(segment.toolCall.id, segment.toolCall);
  }
  for (const call of toolCalls ?? []) callsById.set(call.id, call);

  const groups = new Map<string, ToolUsageGroup>();
  for (const call of callsById.values()) {
    const group = groups.get(call.name) ?? {
      name: call.name,
      count: 0,
      completed: 0,
      failed: 0,
      artifacts: [],
    };
    group.count += 1;
    if (call.status === 'done') group.completed += 1;
    if (call.status === 'error') group.failed += 1;
    if (call.durationMs !== undefined) {
      group.durationMs = (group.durationMs ?? 0) + call.durationMs;
    }
    for (const artifact of call.artifacts ?? []) {
      if (!group.artifacts.some((entry) => entry.id === artifact.id)) {
        group.artifacts.push({
          id: artifact.id,
          ...(artifact.label ? { label: artifact.label } : {}),
        });
      }
    }
    groups.set(call.name, group);
  }
  return [...groups.values()];
}

function ToolUsageSummary({ groups, t }: { groups: ToolUsageGroup[]; t: (key: string) => string }) {
  return (
    <div
      data-testid="run-tool-usage-summary"
      className="space-y-1 border-l border-border/60 py-1 pl-3"
    >
      {groups.map((group) => (
        <div key={group.name} className="rounded-md px-2 py-1.5 text-xs text-muted-foreground">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
            <span className="truncate font-medium text-foreground">
              {localizeToolName(group.name)}
            </span>
            <span className="tabular-nums">
              {t('commander.toolUsage.calls').replace('{count}', String(group.count))}
            </span>
            <span className={group.failed > 0 ? 'tabular-nums text-destructive' : 'tabular-nums'}>
              {group.failed > 0
                ? t('commander.toolUsage.errors').replace('{count}', String(group.failed))
                : t('commander.toolUsage.completed').replace('{count}', String(group.completed))}
              {group.durationMs !== undefined ? ` · ${formatDuration(group.durationMs)}` : ''}
            </span>
          </div>
          {group.artifacts.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {group.artifacts.map((artifact) => (
                <span key={artifact.id} className="rounded-full border border-border/60 px-1.5 py-0.5">
                  {artifact.label ?? artifact.id}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function resourceUsageTotal(segments: MessageSegment[] | undefined): number {
  const resourceState = [...(segments ?? [])]
    .reverse()
    .find(
      (segment): segment is Extract<MessageSegment, { kind: 'resource_state' }> =>
        segment.kind === 'resource_state',
    );
  if (resourceState) {
    return resourceState.usage.tokens.knowledge === 'unknown'
      ? 0
      : resourceState.usage.tokens.value;
  }
  return (segments ?? []).reduce(
    (total, segment) =>
      segment.kind === 'resource_usage'
        ? total + (segment.promptTokens ?? 0) + (segment.completionTokens ?? 0)
        : total,
    0,
  );
}

function HistoricalQuestionCard({
  message,
  t,
}: {
  message: CommanderMessage;
  t: (key: string) => string;
}) {
  if (!message.questionMeta) return null;
  return (
    <div className="rounded-lg border border-blue-500/50 bg-blue-500/5 p-3">
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

function formatDuration(durationMs: number): string {
  if (durationMs < 1) return '<1ms';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  if (durationMs < 3_600_000) return `${(durationMs / 60_000).toFixed(1)}m`;
  return `${(durationMs / 3_600_000).toFixed(1)}h`;
}
