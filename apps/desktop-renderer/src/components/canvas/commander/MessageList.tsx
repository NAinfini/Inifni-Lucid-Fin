import { memo, useMemo, useState } from 'react';
import { AlertTriangle, Brain, ChevronDown, MessageCircleQuestion } from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { assertNever } from '../../../utils/assert-never.js';
import { Markdown } from './Markdown.js';
import { ToolCallCard } from './ToolCallCard.js';
import { ChangesetCard } from './ChangesetCard.js';
import { CopyButton } from './CopyButton.js';
import { MessageActionStrip } from './MessageActionStrip.js';
import { CancelledBanner } from './CancelledBanner.js';
import type {
  CommanderMessage,
  CommanderToolCall,
  MessageSegment,
} from '../../../store/slices/commander.js';

/** Minimum consecutive same-domain tool calls to trigger changeset grouping. */
const CHANGESET_MIN_SIZE = 3;

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
  /** True only while a text chunk arrived within the last ~500ms (Phase 3 cursor gate). */
  showTextCursor: boolean;
  error: string | null;
  nodeTitlesById: Record<string, string>;
  resolveNodeAssetHash?: (nodeId: string) => string | undefined;
  t: (key: string) => string;
  emptyLabel: string;
  onNodeClick?: (nodeId: string) => void;
  onSendMessage?: (message: string) => void;
}

export const MessageList = memo(function MessageList({
  messages,
  liveMessage,
  currentSegments,
  pendingInjectedMessages,
  showTextCursor,
  error,
  nodeTitlesById,
  resolveNodeAssetHash,
  t,
  emptyLabel,
  onNodeClick,
  onSendMessage,
}: MessageListProps) {
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
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
            message.role === 'user' ? 'border-l-2 border-primary/40 pl-3 py-1.5' : 'py-1.5',
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
              resolveNodeAssetHash={resolveNodeAssetHash}
              onNodeClick={onNodeClick}
              onSendMessage={onSendMessage}
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
                <GroupedSegments
                  segments={message.segments}
                  nodeTitlesById={nodeTitlesById}
                  resolveNodeAssetHash={resolveNodeAssetHash}
                  onNodeClick={onNodeClick}
                  onSendMessage={onSendMessage}
                  t={t}
                />
              </div>
              <RemainingToolCalls
                message={message}
                nodeTitlesById={nodeTitlesById}
                resolveNodeAssetHash={resolveNodeAssetHash}
                onNodeClick={onNodeClick}
                onSendMessage={onSendMessage}
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
                  <GroupedToolCalls
                    toolCalls={message.toolCalls}
                    nodeTitlesById={nodeTitlesById}
                    resolveNodeAssetHash={resolveNodeAssetHash}
                    onNodeClick={onNodeClick}
                    onSendMessage={onSendMessage}
                    t={t}
                  />
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
              {currentSegments.map((seg, i) => {
                const isLast = i === currentSegments.length - 1;
                return (
                  <LiveSegmentRenderer
                    key={seg.id}
                    seg={seg}
                    nodeTitlesById={nodeTitlesById}
                    resolveNodeAssetHash={resolveNodeAssetHash}
                    onNodeClick={onNodeClick}
                    t={t}
                    showCursor={showTextCursor && isLast && seg.kind === 'text'}
                  />
                );
              })}
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
  resolveNodeAssetHash?: (nodeId: string) => string | undefined;
  t: (key: string) => string;
  onNodeClick?: (nodeId: string) => void;
  onSendMessage?: (message: string) => void;
}

function RemainingToolCalls({
  message,
  nodeTitlesById,
  resolveNodeAssetHash,
  t,
  onNodeClick,
  onSendMessage,
}: RemainingToolCallsProps) {
  const segmentToolCallIds = new Set(
    (message.segments ?? [])
      .filter(
        (segment): segment is Extract<MessageSegment, { kind: 'tool' }> => segment.kind === 'tool',
      )
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
      <GroupedToolCalls
        toolCalls={remainingToolCalls}
        nodeTitlesById={nodeTitlesById}
        resolveNodeAssetHash={resolveNodeAssetHash}
        onNodeClick={onNodeClick}
        onSendMessage={onSendMessage}
        t={t}
      />
    </div>
  );
}

interface RunSummaryCardProps {
  expanded: boolean;
  message: CommanderMessage;
  nodeTitlesById: Record<string, string>;
  resolveNodeAssetHash?: (nodeId: string) => string | undefined;
  t: (key: string) => string;
  onToggle: () => void;
  onNodeClick?: (nodeId: string) => void;
  onSendMessage?: (message: string) => void;
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
  resolveNodeAssetHash,
  t,
  onToggle,
  onNodeClick,
  onSendMessage,
}: RunSummaryCardProps) {
  const runMeta = message.runMeta;
  if (!runMeta) {
    return null;
  }

  const { finalSegments, processSegments } = splitFinalFromProcess(message.segments);
  const processToolCalls = collectProcessToolCalls(message.toolCalls, message.segments);
  const isFailed = runMeta.status === 'failed';
  // Show the process toggle whenever the run did *something* worth folding:
  // intermediate segments, uncaptured tool calls, or a tool count recorded on
  // the summary even if raw segment/tool data is missing (older persisted
  // messages, historical sessions).
  const hasProcess =
    processSegments.length > 0 ||
    processToolCalls.length > 0 ||
    runMeta.summary.toolCount > 0 ||
    isFailed;

  // The "final" text is the closing assistant reply. If the run failed or
  // produced no closing text, fall back to `message.content` so the user
  // still sees something actionable (error message / full content).
  const finalText =
    finalSegments.length > 0
      ? finalSegments
          .filter((seg): seg is Extract<MessageSegment, { kind: 'text' }> => seg.kind === 'text')
          .map((seg) => seg.content)
          .join('')
      : message.content;

  return (
    <div className="min-w-0">
      {runMeta.exitDecision ? <ExitDecisionBanner decision={runMeta.exitDecision} t={t} /> : null}
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
              <span aria-hidden className="opacity-40">
                ·
              </span>
              <span>{formatDuration(runMeta.summary.durationMs)}</span>
              {runMeta.summary.failedToolCount > 0 ? (
                <>
                  <span aria-hidden className="opacity-40">
                    ·
                  </span>
                  <span className="text-destructive">
                    {runMeta.summary.failedToolCount} {t('commander.runErrors')}
                  </span>
                </>
              ) : null}
              {isFailed ? (
                <>
                  <span aria-hidden className="opacity-40">
                    ·
                  </span>
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
              <ProcessSegments
                segments={processSegments}
                nodeTitlesById={nodeTitlesById}
                resolveNodeAssetHash={resolveNodeAssetHash}
                onNodeClick={onNodeClick}
                onSendMessage={onSendMessage}
                t={t}
              />
              <GroupedToolCalls
                toolCalls={processToolCalls}
                nodeTitlesById={nodeTitlesById}
                resolveNodeAssetHash={resolveNodeAssetHash}
                onNodeClick={onNodeClick}
                onSendMessage={onSendMessage}
                t={t}
              />
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
  resolveNodeAssetHash?: (nodeId: string) => string | undefined;
  t: (key: string) => string;
  onNodeClick?: (nodeId: string) => void;
  onSendMessage?: (message: string) => void;
}

function ProcessSegments({
  segments,
  nodeTitlesById,
  resolveNodeAssetHash,
  t,
  onNodeClick,
  onSendMessage,
}: ProcessSegmentsProps) {
  if (segments.length === 0) return null;
  return (
    <GroupedSegments
      segments={segments}
      nodeTitlesById={nodeTitlesById}
      resolveNodeAssetHash={resolveNodeAssetHash}
      onNodeClick={onNodeClick}
      onSendMessage={onSendMessage}
      t={t}
      variant="process"
    />
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
    if (segments[i]!.kind === 'tool') {
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
      .filter((s): s is Extract<MessageSegment, { kind: 'tool' }> => s.kind === 'tool')
      .map((s) => s.toolCall.id),
  );
  return toolCalls.filter((tc) => !segmentIds.has(tc.id));
}

interface HistoricalQuestionCardProps {
  message: CommanderMessage;
  t: (key: string) => string;
}

/**
 * Phase E — terminal-state banner. Only renders when the orchestrator's
 * exit decision is *not* `satisfied` or `informational_answered`. Shape is
 * deliberately informational (no actions) in the soft-enforcement phase;
 * Phase F will wire "Continue" for `unsatisfied`.
 */
interface ExitDecisionBannerProps {
  decision: NonNullable<CommanderMessage['runMeta']>['exitDecision'];
  t: (key: string) => string;
}

function ExitDecisionBanner({ decision }: ExitDecisionBannerProps) {
  void decision;
  return null;
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

function formatDuration(durationMs: number): string {
  if (durationMs < 1) return '<1ms';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  if (durationMs < 3_600_000) return `${(durationMs / 60_000).toFixed(1)}m`;
  return `${(durationMs / 3_600_000).toFixed(1)}h`;
}

interface SegmentRendererProps {
  seg: MessageSegment;
  nodeTitlesById: Record<string, string>;
  resolveNodeAssetHash?: (nodeId: string) => string | undefined;
  onNodeClick?: (nodeId: string) => void;
  onSendMessage?: (message: string) => void;
  t: (key: string) => string;
}

/** Renders a segment in the "finished message" (history) context. */
function SegmentRenderer({
  seg,
  nodeTitlesById,
  resolveNodeAssetHash,
  onNodeClick,
  onSendMessage,
  t,
}: SegmentRendererProps) {
  switch (seg.kind) {
    case 'text':
      return <Markdown content={seg.content} onNodeClick={onNodeClick} />;
    case 'tool':
      return (
        <ToolCallCard
          toolCall={seg.toolCall}
          nodeTitlesById={nodeTitlesById}
          resolveNodeAssetHash={resolveNodeAssetHash}
          t={t}
          onNodeClick={onNodeClick}
          onSendMessage={onSendMessage}
        />
      );
    case 'thinking':
      return <ThinkingSegment seg={seg} t={t} />;
    case 'step_marker':
      return <StepMarkerSegment seg={seg} t={t} />;
    case 'phase_note':
      return <PhaseNoteSegment seg={seg} t={t} />;
    default:
      return assertNever(seg, 'SegmentRenderer');
  }
}

interface LiveSegmentRendererProps extends SegmentRendererProps {
  showCursor: boolean;
}

/** Renders a segment in the live-stream context (shows a cursor after the tail text segment). */
function LiveSegmentRenderer({
  seg,
  nodeTitlesById,
  resolveNodeAssetHash,
  onNodeClick,
  onSendMessage,
  t,
  showCursor: _showCursor,
}: LiveSegmentRendererProps) {
  switch (seg.kind) {
    case 'text':
      return (
        <div>
          <Markdown content={seg.content} onNodeClick={onNodeClick} />
          {/* Phase D (S4): blue cursor caret removed — streaming speed is
              already visible from text arriving. Activity bar + phase
              banners carry the "model is thinking" signal. */}
        </div>
      );
    case 'tool':
      return (
        <ToolCallCard
          toolCall={seg.toolCall}
          nodeTitlesById={nodeTitlesById}
          resolveNodeAssetHash={resolveNodeAssetHash}
          t={t}
          onNodeClick={onNodeClick}
          onSendMessage={onSendMessage}
        />
      );
    case 'thinking':
      return <ThinkingSegment seg={seg} t={t} />;
    case 'step_marker':
      return <StepMarkerSegment seg={seg} t={t} />;
    case 'phase_note':
      return <PhaseNoteSegment seg={seg} t={t} />;
    default:
      return assertNever(seg, 'LiveSegmentRenderer');
  }
}

/** Renders a segment inside the expanded "process" card of a completed run. */
function ProcessSegmentRenderer({
  seg,
  nodeTitlesById,
  resolveNodeAssetHash,
  onNodeClick,
  onSendMessage,
  t,
}: SegmentRendererProps) {
  switch (seg.kind) {
    case 'text':
      return (
        <div className="px-2 py-1 text-[12px] text-muted-foreground/90">
          <Markdown content={seg.content} onNodeClick={onNodeClick} />
        </div>
      );
    case 'tool':
      return (
        <ToolCallCard
          toolCall={seg.toolCall}
          nodeTitlesById={nodeTitlesById}
          resolveNodeAssetHash={resolveNodeAssetHash}
          t={t}
          onNodeClick={onNodeClick}
          onSendMessage={onSendMessage}
        />
      );
    case 'thinking':
      return <ThinkingSegment seg={seg} t={t} />;
    case 'step_marker':
      return <StepMarkerSegment seg={seg} t={t} />;
    case 'phase_note':
      return <PhaseNoteSegment seg={seg} t={t} />;
    default:
      return assertNever(seg, 'ProcessSegmentRenderer');
  }
}

interface ThinkingSegmentProps {
  seg: Extract<MessageSegment, { kind: 'thinking' }>;
  t: (key: string) => string;
}

/**
 * Collapsible reasoning block. Defaults to collapsed so the user can
 * focus on the assistant's answer but peek at the thinking chain when
 * needed. Header shows a brain icon plus word count.
 */
function ThinkingSegment({ seg, t }: ThinkingSegmentProps) {
  if (!seg.content.trim()) return null;
  const wordCount = seg.content.trim().split(/\s+/).length;
  const label = t('commander.reasoning').replace('{count}', String(wordCount));
  return (
    <details className="my-1 rounded border border-border/40 bg-muted/20 text-xs">
      <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1 text-muted-foreground select-none">
        <Brain className="h-3 w-3 shrink-0" />
        <span>{label}</span>
      </summary>
      <pre className="whitespace-pre-wrap break-words px-2 py-1 font-sans text-[11px] leading-snug text-muted-foreground/70">
        {seg.content}
      </pre>
    </details>
  );
}

interface StepMarkerSegmentProps {
  seg: Extract<MessageSegment, { kind: 'step_marker' }>;
  t: (key: string) => string;
}

function StepMarkerSegment(_props: StepMarkerSegmentProps) {
  // Step boundaries stay in the timeline as a semantic anchor for
  // selectors/tests, but we don't surface them in the chat UI — they added
  // visual noise without helping the reader.
  return null;
}

interface PhaseNoteSegmentProps {
  seg: Extract<MessageSegment, { kind: 'phase_note' }>;
  t: (key: string) => string;
}

function PhaseNoteSegment({ seg, t }: PhaseNoteSegmentProps) {
  const labelKey =
    seg.note === 'process_prompt_loaded'
      ? 'commander.phaseNote.processPromptLoaded'
      : seg.note === 'compacted'
        ? 'commander.phaseNote.compacted'
        : 'commander.phaseNote.llmRetry';
  const label = t(labelKey);
  return (
    <div className="my-1 italic text-[10px] text-muted-foreground/70">
      {label}
      {seg.detail ? `: ${seg.detail}` : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3D: Changeset grouping helpers
// ---------------------------------------------------------------------------

/** Extract the domain from a tool name (e.g. "canvas.addNode" -> "canvas"). */
function extractDomain(toolName: string): string {
  if (toolName.includes('.')) return toolName.split('.')[0] ?? '';
  const idx = toolName.indexOf('_');
  return idx > 0 ? toolName.slice(0, idx) : '';
}

/**
 * Group consecutive tool-kind segments into changesets when 3+ in a row
 * share the same domain. Non-tool segments pass through individually.
 */
type SegmentGroup =
  | { kind: 'segment'; seg: MessageSegment }
  | { kind: 'changeset'; domain: string; toolCalls: CommanderToolCall[] };

function groupSegments(segments: MessageSegment[]): SegmentGroup[] {
  const result: SegmentGroup[] = [];
  let i = 0;
  while (i < segments.length) {
    const seg = segments[i]!;
    if (seg.kind !== 'tool') {
      result.push({ kind: 'segment', seg });
      i += 1;
      continue;
    }
    // Scan consecutive tool segments with the same domain
    const domain = extractDomain(seg.toolCall.name);
    let j = i + 1;
    while (j < segments.length) {
      const next = segments[j]!;
      if (next.kind !== 'tool') break;
      if (extractDomain(next.toolCall.name) !== domain) break;
      j += 1;
    }
    const count = j - i;
    if (count >= CHANGESET_MIN_SIZE && domain) {
      const toolCalls: CommanderToolCall[] = [];
      for (let k = i; k < j; k += 1) {
        const s = segments[k]!;
        if (s.kind === 'tool') toolCalls.push(s.toolCall);
      }
      result.push({ kind: 'changeset', domain, toolCalls });
    } else {
      for (let k = i; k < j; k += 1) {
        result.push({ kind: 'segment', seg: segments[k]! });
      }
    }
    i = j;
  }
  return result;
}

interface GroupedSegmentsProps {
  segments: MessageSegment[];
  nodeTitlesById: Record<string, string>;
  resolveNodeAssetHash?: (nodeId: string) => string | undefined;
  t: (key: string) => string;
  onNodeClick?: (nodeId: string) => void;
  onSendMessage?: (message: string) => void;
  variant?: 'default' | 'process';
}

function GroupedSegments({
  segments,
  nodeTitlesById,
  resolveNodeAssetHash,
  t,
  onNodeClick,
  onSendMessage,
  variant = 'default',
}: GroupedSegmentsProps) {
  const groups = useMemo(() => groupSegments(segments), [segments]);
  const Renderer = variant === 'process' ? ProcessSegmentRenderer : SegmentRenderer;
  return (
    <>
      {groups.map((group, i) => {
        if (group.kind === 'changeset') {
          return (
            <ChangesetCard
              key={`changeset-${i}`}
              domain={group.domain}
              toolCalls={group.toolCalls}
              nodeTitlesById={nodeTitlesById}
              resolveNodeAssetHash={resolveNodeAssetHash}
              t={t}
              onNodeClick={onNodeClick}
              onSendMessage={onSendMessage}
            />
          );
        }
        return (
          <Renderer
            key={group.seg.id}
            seg={group.seg}
            nodeTitlesById={nodeTitlesById}
            resolveNodeAssetHash={resolveNodeAssetHash}
            onNodeClick={onNodeClick}
            onSendMessage={onSendMessage}
            t={t}
          />
        );
      })}
    </>
  );
}

/**
 * Group consecutive tool calls by domain into changesets (3+ same domain).
 * Used for standalone toolCalls arrays (not segment lists).
 */
type ToolCallGroup =
  | { kind: 'single'; toolCall: CommanderToolCall }
  | { kind: 'changeset'; domain: string; toolCalls: CommanderToolCall[] };

function groupToolCalls(toolCalls: CommanderToolCall[]): ToolCallGroup[] {
  const result: ToolCallGroup[] = [];
  let i = 0;
  while (i < toolCalls.length) {
    const tc = toolCalls[i]!;
    const domain = extractDomain(tc.name);
    let j = i + 1;
    while (j < toolCalls.length) {
      if (extractDomain(toolCalls[j]!.name) !== domain) break;
      j += 1;
    }
    const count = j - i;
    if (count >= CHANGESET_MIN_SIZE && domain) {
      result.push({ kind: 'changeset', domain, toolCalls: toolCalls.slice(i, j) });
    } else {
      for (let k = i; k < j; k += 1) {
        result.push({ kind: 'single', toolCall: toolCalls[k]! });
      }
    }
    i = j;
  }
  return result;
}

interface GroupedToolCallsProps {
  toolCalls: CommanderToolCall[];
  nodeTitlesById: Record<string, string>;
  resolveNodeAssetHash?: (nodeId: string) => string | undefined;
  t: (key: string) => string;
  onNodeClick?: (nodeId: string) => void;
  onSendMessage?: (message: string) => void;
}

function GroupedToolCalls({
  toolCalls,
  nodeTitlesById,
  resolveNodeAssetHash,
  t,
  onNodeClick,
  onSendMessage,
}: GroupedToolCallsProps) {
  const groups = useMemo(() => groupToolCalls(toolCalls), [toolCalls]);
  if (groups.length === 0) return null;
  return (
    <>
      {groups.map((group, i) => {
        if (group.kind === 'changeset') {
          return (
            <ChangesetCard
              key={`changeset-${i}`}
              domain={group.domain}
              toolCalls={group.toolCalls}
              nodeTitlesById={nodeTitlesById}
              resolveNodeAssetHash={resolveNodeAssetHash}
              t={t}
              onNodeClick={onNodeClick}
              onSendMessage={onSendMessage}
            />
          );
        }
        return (
          <ToolCallCard
            key={group.toolCall.id}
            toolCall={group.toolCall}
            nodeTitlesById={nodeTitlesById}
            resolveNodeAssetHash={resolveNodeAssetHash}
            t={t}
            onNodeClick={onNodeClick}
            onSendMessage={onSendMessage}
          />
        );
      })}
    </>
  );
}
