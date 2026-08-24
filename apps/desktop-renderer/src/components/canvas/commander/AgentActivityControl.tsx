import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  CircleSlash2,
  Clock3,
  Loader2,
  PauseCircle,
  Send,
  ShieldAlert,
  Square,
  Wrench,
} from 'lucide-react';

import {
  isTaskListTerminalStatus,
  type CommanderRunControlAction,
  type TaskListSummary,
  type TaskSummary,
} from '@lucid-fin/contracts';
import { localizeToolName } from '../../../i18n.js';
import { cn } from '../../../lib/utils.js';
import { useElapsed } from '../../../hooks/useElapsed.js';
import { getAPI } from '../../../utils/api.js';
import { useConfirm } from '../../ui/ConfirmDialog.js';
import { localizeRunBlocker } from './run-blocker-label.js';
import type {
  AgentActivityNodeView,
  AgentActivityPlanItem,
  AgentActivityStatus,
  AgentActivityTreeView,
  SafeToolActivity,
} from '../../../commander/state/commander-timeline-selectors.js';
import { isAgentActivityStatusActive } from '../../../commander/state/commander-timeline-selectors.js';
import { buildTaskListActivityPlan } from './task-list-activity.js';

interface AgentActivityControlProps {
  sessionId: string | null;
  tree: AgentActivityTreeView | null;
  taskList?: TaskListSummary | null;
  taskListTasks?: readonly TaskSummary[];
  focusRunId?: string | null;
  inline?: boolean;
  t: (key: string) => string;
}

type ActivityMode = 'tree' | 'detail';
type PendingControlAction = CommanderRunControlAction | null;

const TERMINAL_STATUSES = new Set<AgentActivityStatus>([
  'completed',
  'failed',
  'cancelled',
  'blocked',
]);

function activityStatusKey(status: AgentActivityStatus): string {
  switch (status) {
    case 'waiting_user':
      return 'waitingUser';
    default:
      return status;
  }
}

function activityStatusLabel(status: AgentActivityStatus, t: (key: string) => string): string {
  return t(`commander.agentActivity.status.${activityStatusKey(status)}`);
}

function workTypeLabel(node: AgentActivityNodeView, t: (key: string) => string): string {
  switch (node.workType) {
    case 'agent':
      return t('commander.agentActivity.workType.agent');
    case 'subagent':
      return t('commander.agentActivity.workType.subagent');
    case 'tool_program':
      return t('commander.agentActivity.workType.toolProgram');
  }
}

function nodeLabel(node: AgentActivityNodeView, t: (key: string) => string): string {
  return node.displayName || workTypeLabel(node, t);
}

function StatusIcon({
  status,
  active = false,
  className,
}: {
  status: AgentActivityStatus;
  active?: boolean;
  className?: string;
}) {
  const iconClass = cn(
    'h-4 w-4 shrink-0',
    active &&
      (status === 'accepted' || status === 'running' || status === 'pausing') &&
      'animate-spin motion-reduce:animate-none',
    className,
  );
  switch (status) {
    case 'accepted':
    case 'running':
      return <Loader2 aria-hidden className={cn(iconClass, 'text-primary')} />;
    case 'waiting_user':
      return <CircleHelp aria-hidden className={cn(iconClass, 'text-amber-400')} />;
    case 'pausing':
      return <Loader2 aria-hidden className={cn(iconClass, 'text-amber-400')} />;
    case 'paused':
      return <PauseCircle aria-hidden className={cn(iconClass, 'text-amber-400')} />;
    case 'completed':
      return <CheckCircle2 aria-hidden className={cn(iconClass, 'text-emerald-400')} />;
    case 'failed':
      return <AlertCircle aria-hidden className={cn(iconClass, 'text-destructive')} />;
    case 'blocked':
      return <ShieldAlert aria-hidden className={cn(iconClass, 'text-amber-400')} />;
    case 'cancelled':
      return <CircleSlash2 aria-hidden className={cn(iconClass, 'text-muted-foreground')} />;
  }
}

function replaceTemplate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function formatElapsed(milliseconds: number, t: (key: string) => string): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return replaceTemplate(t('commander.agentActivity.durationSeconds'), { count: seconds });
  }
  return replaceTemplate(t('commander.agentActivity.durationMinutes'), { minutes, seconds });
}

function formatUsageAmount(
  amount: { knowledge: 'known' | 'estimated' | 'unknown'; value?: number },
  t: (key: string) => string,
): string {
  if (amount.knowledge === 'unknown' || amount.value === undefined) {
    return t('commander.resource.unavailable');
  }
  const value = new Intl.NumberFormat().format(amount.value);
  return amount.knowledge === 'estimated'
    ? replaceTemplate(t('commander.resource.estimated'), { value })
    : value;
}

function formatRemaining(
  remaining: { state: 'known' | 'estimated' | 'unlimited' | 'unknown'; value?: number },
  t: (key: string) => string,
  format: (value: number) => string,
): string {
  if (remaining.state === 'unlimited') return t('commander.resource.unlimited');
  if (remaining.state === 'unknown' || remaining.value === undefined) {
    return t('commander.resource.unavailable');
  }
  const value = format(remaining.value);
  return remaining.state === 'estimated'
    ? replaceTemplate(t('commander.resource.estimated'), { value })
    : value;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value);
}

function getEffectiveStatus(
  status: AgentActivityStatus,
  pendingAction: PendingControlAction,
): AgentActivityStatus {
  return pendingAction === 'pause' && (status === 'accepted' || status === 'running')
    ? 'pausing'
    : status;
}

function treeDepths(tree: AgentActivityTreeView): Record<string, number> {
  const depths: Record<string, number> = {};
  const visit = (runId: string, depth: number) => {
    depths[runId] = depth;
    for (const childRunId of tree.nodesById[runId]?.childRunIds ?? []) visit(childRunId, depth + 1);
  };
  visit(tree.rootRunId, 0);
  return depths;
}

function descendantCount(tree: AgentActivityTreeView, runId: string): number {
  const node = tree.nodesById[runId];
  if (!node) return 0;
  return node.childRunIds.reduce(
    (total, childRunId) => total + 1 + descendantCount(tree, childRunId),
    0,
  );
}

const TRIGGER_STATUS_PRIORITY: Record<AgentActivityStatus, number> = {
  waiting_user: 6,
  blocked: 5,
  failed: 5,
  pausing: 4,
  paused: 4,
  accepted: 3,
  running: 3,
  completed: 1,
  cancelled: 1,
};

function highestPriorityNode(tree: AgentActivityTreeView): AgentActivityNodeView {
  return tree.orderedRunIds.reduce((highest, runId) => {
    const candidate = tree.nodesById[runId];
    return TRIGGER_STATUS_PRIORITY[candidate.status] > TRIGGER_STATUS_PRIORITY[highest.status]
      ? candidate
      : highest;
  }, tree.nodesById[tree.rootRunId]);
}

function toolStatusLabel(status: SafeToolActivity['status'], t: (key: string) => string): string {
  return t(`commander.agentActivity.toolStatus.${status}`);
}

function planItemStatusIcon(status: AgentActivityPlanItem['status']): AgentActivityStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'blocked':
      return 'blocked';
    case 'running':
      return 'running';
    case 'pending':
    case 'skipped':
      return 'accepted';
  }
}

function PlanItem({ item }: { item: AgentActivityPlanItem }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <StatusIcon
        status={planItemStatusIcon(item.status)}
        active={item.status === 'running'}
        className="mt-0.5 h-3.5 w-3.5"
      />
      <span className="min-w-0 flex-1 break-words text-foreground">{item.title}</span>
    </li>
  );
}

function TreeNode({
  node,
  depth,
  selected,
  t,
  onSelect,
  onKeyDown,
  setRef,
}: {
  node: AgentActivityNodeView;
  depth: number;
  selected: boolean;
  t: (key: string) => string;
  onSelect: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  setRef: (element: HTMLButtonElement | null) => void;
}) {
  const statusLabel = activityStatusLabel(node.status, t);
  const title = nodeLabel(node, t);
  return (
    <button
      ref={setRef}
      type="button"
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-label={`${title} — ${statusLabel}`}
      className={cn(
        'flex min-h-11 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
        selected && 'bg-primary/10 ring-1 ring-inset ring-primary/70',
      )}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <StatusIcon status={node.status} active={isAgentActivityStatusActive(node.status)} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
            {title}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{statusLabel}</span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
          {node.currentStep?.title ? (
            <span className="min-w-0 truncate">{node.currentStep.title}</span>
          ) : node.objective ? (
            <span className="min-w-0 truncate">{node.objective}</span>
          ) : null}
          {node.startedAt ? (
            <span className="ml-auto shrink-0 tabular-nums">
              {formatElapsed(Date.now() - node.startedAt, t)}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function ToolTimeline({ tools, t }: { tools: SafeToolActivity[]; t: (key: string) => string }) {
  if (tools.length === 0) return null;
  return (
    <section className="border-t border-border/50 px-4 py-3">
      <h3 className="text-xs font-semibold text-foreground">{t('commander.agentActivity.toolsAndResults')}</h3>
      <ol className="mt-2 space-y-2">
        {tools.map((tool) => (
          <li key={tool.id} className="flex min-w-0 items-start gap-2 text-xs">
            <StatusIcon
              status={tool.status === 'running' ? 'running' : tool.status === 'failed' ? 'failed' : 'completed'}
              active={tool.status === 'running'}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {localizeToolName(tool.capability)}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {toolStatusLabel(tool.status, t)}
                </span>
              </div>
              {tool.summary ? (
                <p className="mt-0.5 break-words text-[11px] leading-4 text-muted-foreground">
                  {tool.summary}
                </p>
              ) : null}
              {tool.durationMs !== undefined ? (
                <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">
                  {formatElapsed(tool.durationMs, t)}
                </span>
              ) : null}
              {tool.status === 'failed' && tool.errorCode ? (
                <p className="mt-0.5 break-words text-[11px] leading-4 text-destructive">
                  {tool.errorCode} · {t(`commander.errorCode.${tool.errorCode}`)}
                </p>
              ) : null}
              {tool.details && Object.keys(tool.details).length > 0 ? (
                <details className="mt-1 text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer text-foreground hover:text-primary">
                    {t('commander.agentActivity.details')}
                  </summary>
                  <dl className="mt-1 space-y-1 break-words border-l border-border/50 pl-2">
                    {Object.entries(tool.details).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <dt className="shrink-0 text-muted-foreground">{key}</dt>
                        <dd className="min-w-0 break-all text-foreground">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ResourceList({
  node,
  elapsedMs,
  t,
}: {
  node: AgentActivityNodeView;
  elapsedMs: number;
  t: (key: string) => string;
}) {
  if (!node.resourceState && !node.startedAt) return null;
  const resource = node.resourceState;
  return (
    <section className="border-t border-border/50 px-4 py-3">
      <h3 className="text-xs font-semibold text-foreground">{t('commander.agentActivity.resources')}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] tabular-nums">
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t('commander.agentActivity.resourceElapsed')}</dt>
          <dd className="mt-0.5 text-foreground">{formatElapsed(elapsedMs, t)}</dd>
        </div>
        {resource ? (
          <>
            <div className="min-w-0">
              <dt className="text-muted-foreground">{t('commander.agentActivity.resourceTokens')}</dt>
              <dd className="mt-0.5 truncate text-foreground">
                {formatUsageAmount(resource.usage.tokens, t)} /{' '}
                {formatRemaining(resource.remaining.tokens, t, (value) =>
                  new Intl.NumberFormat().format(value),
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">
                {t('commander.agentActivity.resourceToolCalls')}
              </dt>
              <dd className="mt-0.5 truncate text-foreground">
                {new Intl.NumberFormat().format(resource.usage.toolCalls)} /{' '}
                {formatRemaining(resource.remaining.toolCalls, t, (value) =>
                  new Intl.NumberFormat().format(value),
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">{t('commander.agentActivity.resourceActiveTime')}</dt>
              <dd className="mt-0.5 truncate text-foreground">
                {formatElapsed(resource.usage.wallTimeMs, t)} /{' '}
                {formatRemaining(resource.remaining.wallTimeMs, t, (value) => formatElapsed(value, t))}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">{t('commander.agentActivity.resourceCost')}</dt>
              <dd className="mt-0.5 truncate text-foreground">
                {resource.usage.costUsd.knowledge === 'unknown'
                  ? t('commander.resource.unavailable')
                  : formatCurrency(resource.usage.costUsd.value)}
              </dd>
            </div>
          </>
        ) : null}
      </dl>
    </section>
  );
}

export function AgentActivityControl({
  sessionId,
  tree,
  taskList = null,
  taskListTasks = [],
  focusRunId = null,
  inline = false,
  t,
}: AgentActivityControlProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ActivityMode>('tree');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(tree?.rootRunId ?? null);
  const [messageDraft, setMessageDraft] = useState('');
  const [pendingControlAction, setPendingControlAction] = useState<PendingControlAction>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();
  const treeItemRefs = useRef(new Map<string, HTMLButtonElement>());
  const contentId = `agent-activity-panel-${tree?.rootRunId ?? 'none'}`;
  const isFocusRequested = focusRunId !== null;

  const selectedNode = tree && selectedRunId ? tree.nodesById[selectedRunId] : undefined;
  const taskListPlan =
    tree?.hasActiveDescendant &&
    taskList &&
    !isTaskListTerminalStatus(taskList.status) &&
    selectedNode?.runId === tree.rootRunId
      ? buildTaskListActivityPlan(taskList, taskListTasks)
      : null;
  const planItems =
    taskListPlan && taskListPlan.items.length > 0
      ? taskListPlan.items
      : (selectedNode?.publicPlan ?? []);
  const currentStep = taskListPlan?.currentStep ?? selectedNode?.currentStep;
  const rootElapsedMs = useElapsed(
    tree?.hasActiveDescendant && tree.nodesById[tree.rootRunId]?.startedAt
      ? (tree.nodesById[tree.rootRunId].startedAt ?? null)
      : null,
  );
  const selectedLiveElapsedMs = useElapsed(
    selectedNode && isAgentActivityStatusActive(selectedNode.status) && selectedNode.startedAt
      ? selectedNode.startedAt
      : null,
  );
  const selectedElapsedMs =
    selectedNode?.startedAt === undefined
      ? 0
      : isAgentActivityStatusActive(selectedNode.status)
        ? selectedLiveElapsedMs
        : Math.max(0, (selectedNode.completedAt ?? Date.now()) - selectedNode.startedAt);
  const depths = useMemo(() => (tree ? treeDepths(tree) : {}), [tree]);

  useEffect(() => {
    setOpen(isFocusRequested);
    setMode(isFocusRequested ? 'detail' : 'tree');
    setSelectedRunId(
      isFocusRequested && focusRunId && tree?.nodesById[focusRunId]
        ? focusRunId
        : (tree?.rootRunId ?? null),
    );
    setMessageDraft('');
    setPendingControlAction(null);
    setInlineError(null);
  }, [focusRunId, isFocusRequested, sessionId, tree?.rootRunId]);

  useEffect(() => {
    if (!tree?.hasActiveDescendant && !isFocusRequested) setOpen(false);
  }, [isFocusRequested, tree?.hasActiveDescendant]);

  useEffect(() => {
    if (tree && selectedRunId && !tree.nodesById[selectedRunId]) {
      setSelectedRunId(tree.rootRunId);
      setMode('tree');
    }
  }, [selectedRunId, tree]);

  useEffect(() => {
    if (pendingControlAction !== 'pause' || !selectedNode) return;
    if (selectedNode.status === 'paused' || TERMINAL_STATUSES.has(selectedNode.status)) {
      setPendingControlAction(null);
    }
  }, [pendingControlAction, selectedNode]);

  if (!tree || (!tree.hasActiveDescendant && !isFocusRequested)) return null;

  const activeNode = highestPriorityNode(tree);
  const activeCount = tree.orderedRunIds.filter((runId) =>
    isAgentActivityStatusActive(tree.nodesById[runId].status),
  ).length;
  const selectedEffectiveStatus = selectedNode
    ? getEffectiveStatus(selectedNode.status, pendingControlAction)
    : 'running';
  const selectedIsTerminal = selectedNode ? TERMINAL_STATUSES.has(selectedNode.status) : true;
  const isSubmitting = pendingControlAction !== null && pendingControlAction !== 'pause';
  const closeActivity = () => {
    setOpen(false);
  };

  const runControl = async (
    action: CommanderRunControlAction,
    node: AgentActivityNodeView,
    message?: string,
  ) => {
    const api = getAPI()?.commander;
    if (!api?.runControl) {
      setInlineError(t('commander.agentActivity.controlUnavailable'));
      return null;
    }
    setInlineError(null);
    setPendingControlAction(action);
    try {
      const result = await api.runControl(
        action === 'message'
          ? { runId: node.runId, action, message: message ?? '' }
          : { runId: node.runId, action },
      );
      if (!result.accepted) {
        setInlineError(t('commander.agentActivity.controlRejected'));
        setPendingControlAction(null);
        return null;
      }
      if (action === 'message') setMessageDraft('');
      if (action === 'retry') {
        setMode('tree');
        if (result.retryRunId) setSelectedRunId(result.retryRunId);
      }
      if (action !== 'pause') setPendingControlAction(null);
      return result;
    } catch {
      setInlineError(t('commander.agentActivity.actionFailed'));
      setPendingControlAction(null);
      return null;
    }
  };

  const sendMessage = async () => {
    if (!selectedNode) return;
    const message = messageDraft.trim();
    if (!message) {
      setInlineError(t('commander.agentActivity.messageRequired'));
      return;
    }
    await runControl('message', selectedNode, message);
  };

  const cancelRun = async () => {
    if (!selectedNode) return;
    const count = descendantCount(tree, selectedNode.runId);
    const accepted = await confirm({
      title: t('commander.agentActivity.cancelSubtreeTitle'),
      description: replaceTemplate(t('commander.agentActivity.cancelSubtreeDescription'), {
        name: nodeLabel(selectedNode, t),
        count,
      }),
      destructive: true,
      confirmLabel: t('commander.agentActivity.cancel'),
      cancelLabel: t('action.cancel'),
    });
    if (!accepted) return;
    setPendingControlAction(null);
    await runControl('cancel', selectedNode);
  };

  const focusTreeItem = (runId: string) => treeItemRefs.current.get(runId)?.focus();
  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, runId: string) => {
    const index = tree.orderedRunIds.indexOf(runId);
    if (index < 0) return;
    const moveTo = (nextIndex: number) => {
      event.preventDefault();
      focusTreeItem(tree.orderedRunIds[nextIndex]);
    };
    switch (event.key) {
      case 'ArrowDown':
        moveTo(Math.min(tree.orderedRunIds.length - 1, index + 1));
        break;
      case 'ArrowUp':
        moveTo(Math.max(0, index - 1));
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(tree.orderedRunIds.length - 1);
        break;
      case 'ArrowRight':
        if (tree.nodesById[runId].childRunIds.length > 0) {
          event.preventDefault();
          setSelectedRunId(runId);
          setMode('detail');
        }
        break;
      case 'ArrowLeft':
        if (tree.nodesById[runId].parentRunId) {
          event.preventDefault();
          focusTreeItem(tree.nodesById[runId].parentRunId!);
        }
        break;
    }
  };

  return (
    <div
      data-testid="agent-activity-control"
      className={cn(
        'relative z-10 flex flex-col',
        inline
          ? 'w-full'
          : 'mx-auto mb-2 w-[380px] max-w-[420px] max-[443px]:w-[calc(100%-24px)]',
      )}
    >
      {!isFocusRequested ? (
        <button
          type="button"
          id={`agent-activity-trigger-${tree.rootRunId}`}
          data-testid="agent-activity-trigger"
          aria-controls={contentId}
          aria-expanded={open}
          aria-label={replaceTemplate(t('commander.agentActivity.activeUnitsLabel'), {
            count: activeCount,
          })}
          className={cn(
            'flex min-h-9 w-full items-center gap-2 border border-border/70 bg-card px-3 py-2 text-left shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            open ? 'rounded-t-lg border-b-0' : 'rounded-lg',
          )}
          onClick={() => {
            if (open) {
              if (!isSubmitting) closeActivity();
              return;
            }
            setOpen(true);
            setMode('tree');
          }}
        >
          <StatusIcon status={activeNode.status} active className="h-4 w-4" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
            {replaceTemplate(t('commander.agentActivity.trigger'), {
              count: activeCount,
              name: nodeLabel(activeNode, t),
            })}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatElapsed(rootElapsedMs, t)}
          </span>
          <ChevronUp
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
              !open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      ) : null}

      {open ? (
        <div
          id={contentId}
          role="region"
          aria-label={t('commander.agentActivity.title')}
          className={cn(
            'flex max-h-[min(520px,50vh)] w-full flex-col overflow-hidden',
            inline
              ? 'border-y border-border/60 bg-surface/20'
              : 'rounded-b-xl border border-t-0 border-border/70 bg-card',
          )}
        >
          {mode === 'tree' ? (
            <section className="flex min-h-0 flex-1 flex-col">
              <div role="tree" aria-label={t('commander.agentActivity.tree')} className="min-h-0 flex-1 overflow-y-auto p-2">
                {tree.orderedRunIds.map((runId) => {
                  const node = tree.nodesById[runId];
                  return (
                    <TreeNode
                      key={runId}
                      node={node}
                      depth={depths[runId] ?? 0}
                      selected={selectedRunId === runId}
                      t={t}
                      setRef={(element) => {
                        if (element) treeItemRefs.current.set(runId, element);
                        else treeItemRefs.current.delete(runId);
                      }}
                      onSelect={() => {
                        setSelectedRunId(runId);
                        setMode('detail');
                      }}
                      onKeyDown={(event) => handleTreeKeyDown(event, runId)}
                    />
                  );
                })}
              </div>
            </section>
          ) : selectedNode ? (
            <section className="flex min-h-0 flex-1 flex-col">
              <header className="flex shrink-0 items-start gap-2 border-b border-border/50 px-4 py-3">
                <button
                  type="button"
                  aria-label={t('commander.agentActivity.back')}
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={() => {
                    setMode('tree');
                    requestAnimationFrame(() => focusTreeItem(selectedNode.runId));
                  }}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                      {nodeLabel(selectedNode, t)}
                    </h2>
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <StatusIcon
                        status={selectedEffectiveStatus}
                        active={isAgentActivityStatusActive(selectedEffectiveStatus)}
                        className="h-3.5 w-3.5"
                      />
                      {activityStatusLabel(selectedEffectiveStatus, t)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {workTypeLabel(selectedNode, t)} · {formatElapsed(selectedElapsedMs, t)}
                  </p>
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <section className="px-4 py-3">
                  <h3 className="text-xs font-semibold text-foreground">
                    {t('commander.agentActivity.objective')}
                  </h3>
                  <p className="mt-1 break-words text-[13px] leading-5 text-foreground">
                    {selectedNode.objective || t('commander.agentActivity.objectiveUnavailable')}
                  </p>
                </section>

                {planItems.length > 0 ? (
                  <section className="border-t border-border/50 px-4 py-3">
                    <h3 className="text-xs font-semibold text-foreground">
                      {t('commander.agentActivity.publicPlan')}
                    </h3>
                    <ol className="mt-2 space-y-1.5">
                      {planItems.slice(0, 8).map((item) => (
                        <PlanItem key={item.id} item={item} />
                      ))}
                    </ol>
                    {planItems.length > 8 ? (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-primary hover:underline">
                          {replaceTemplate(t('commander.agentActivity.showMore'), {
                            count: planItems.length - 8,
                          })}
                        </summary>
                        <ol className="mt-2 space-y-1.5">
                          {planItems.slice(8).map((item) => (
                            <PlanItem key={item.id} item={item} />
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </section>
                ) : null}

                {currentStep?.title ? (
                  <section className="border-t border-border/50 px-4 py-3">
                    <h3 className="text-xs font-semibold text-foreground">
                      {t('commander.agentActivity.currentWork')}
                    </h3>
                    <p className="mt-1 break-words text-[13px] leading-5 text-foreground">
                      {currentStep.title}
                    </p>
                    {currentStep.summary && currentStep.summary !== currentStep.title ? (
                      <p className="mt-1 break-words text-[11px] leading-4 text-muted-foreground">
                        {currentStep.summary}
                      </p>
                    ) : null}
                  </section>
                ) : null}

                <ToolTimeline tools={selectedNode.tools} t={t} />

                {selectedNode.artifacts.length > 0 ? (
                  <section className="border-t border-border/50 px-4 py-3">
                    <h3 className="text-xs font-semibold text-foreground">
                      {t('commander.agentActivity.artifacts')}
                    </h3>
                    <ul className="mt-2 space-y-1 text-xs text-foreground">
                      {selectedNode.artifacts.map((artifact) => (
                        <li key={`${artifact.kind}:${artifact.id}`} className="break-all">
                          {artifact.label || artifact.id}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {selectedNode.blocker ? (
                  <section className="border-t border-border/50 px-4 py-3">
                    <h3 className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                      <ShieldAlert className="h-4 w-4" aria-hidden />
                      {t('commander.agentActivity.blocker')}
                    </h3>
                    <p className="mt-1 break-words text-[13px] leading-5 text-foreground">
                      {localizeRunBlocker(selectedNode.blocker, t)}
                    </p>
                  </section>
                ) : null}

                <ResourceList node={selectedNode} elapsedMs={selectedElapsedMs} t={t} />
              </div>

              <footer className="shrink-0 border-t border-border/50 bg-card px-4 py-3">
                <div>
                  <textarea
                    data-testid="agent-activity-message"
                    value={messageDraft}
                    disabled={selectedIsTerminal || isSubmitting}
                    aria-label={replaceTemplate(t('commander.agentActivity.messagePlaceholder'), {
                      name: nodeLabel(selectedNode, t),
                    })}
                    placeholder={
                      selectedIsTerminal
                        ? t('commander.agentActivity.terminalMessageDisabled')
                        : replaceTemplate(t('commander.agentActivity.messagePlaceholder'), {
                            name: nodeLabel(selectedNode, t),
                          })
                    }
                    rows={2}
                    className="min-h-16 w-full resize-none rounded-md border border-border/70 bg-surface px-2.5 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                    onChange={(event) => setMessageDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.shiftKey) return;
                      event.preventDefault();
                      void sendMessage();
                    }}
                  />
                  {inlineError ? (
                    <p role="alert" className="mt-1 text-[11px] text-destructive">
                      {inlineError}
                    </p>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={selectedIsTerminal || isSubmitting || !messageDraft.trim()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                    onClick={() => void sendMessage()}
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden />
                    {t('commander.agentActivity.send')}
                  </button>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {(selectedEffectiveStatus === 'running' || selectedEffectiveStatus === 'accepted') &&
                    pendingControlAction !== 'pause' ? (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        className="h-8 rounded-md border border-border/70 px-2.5 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                        onClick={() => void runControl('pause', selectedNode)}
                      >
                        {t('commander.agentActivity.pause')}
                      </button>
                    ) : null}
                    {selectedEffectiveStatus === 'pausing' ? (
                      <span className="inline-flex h-8 items-center gap-1.5 px-2 text-[11px] text-amber-400">
                        <Clock3 className="h-3.5 w-3.5" aria-hidden />
                        {t('commander.agentActivity.safeBoundary')}
                      </span>
                    ) : null}
                    {selectedEffectiveStatus === 'paused' ? (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        className="h-8 rounded-md border border-border/70 px-2.5 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                        onClick={() => void runControl('resume', selectedNode)}
                      >
                        {t('commander.agentActivity.resume')}
                      </button>
                    ) : null}
                    {selectedEffectiveStatus === 'running' ? (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 px-2.5 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                        onClick={() => void runControl('cancel_step', selectedNode)}
                      >
                        <Square className="h-3 w-3" aria-hidden />
                        {t('commander.agentActivity.cancelStep')}
                      </button>
                    ) : null}
                    {selectedNode.workType === 'agent' &&
                    !selectedNode.parentRunId &&
                    ['failed', 'blocked', 'cancelled'].includes(selectedNode.status) ? (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        className="h-8 rounded-md border border-border/70 px-2.5 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                        onClick={() => void runControl('retry', selectedNode)}
                      >
                        {t('commander.agentActivity.retry')}
                      </button>
                    ) : null}
                    {!selectedIsTerminal || selectedEffectiveStatus === 'pausing' ? (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        className="h-8 rounded-md border border-destructive/50 px-2.5 text-xs text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:opacity-50"
                        onClick={() => void cancelRun()}
                      >
                        {t('commander.agentActivity.cancel')}
                      </button>
                    ) : null}
                  </div>
                </div>
              </footer>
            </section>
          ) : null}
        </div>
      ) : null}
      {ConfirmDialog}
    </div>
  );
}
