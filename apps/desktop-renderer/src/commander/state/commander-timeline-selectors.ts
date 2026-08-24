import type {
  CommanderErrorCode,
  CommanderWorkType,
  PublicToolArtifact,
  PublicToolDetails,
  RunBlocker,
  RunResourceClock,
  RunResourceRemainder,
  RunResourceUsage,
  TimelineEvent,
} from '@lucid-fin/contracts';
import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../../store/index.js';
import type {
  CommanderMessage,
  CommanderToolCall,
  MessageSegment,
  PendingConfirmation,
  PendingQuestion,
} from './types.js';
import { deriveActiveRunView } from './run-derivation.js';

export const selectTimelineEvents = (state: RootState): readonly TimelineEvent[] =>
  state.commanderTimeline.events;

export const selectCurrentRunId = (state: RootState): string | null => {
  const sessionId = state.commander.activeSessionId;
  return sessionId ? (state.commanderTimeline.currentRunIdBySessionId[sessionId] ?? null) : null;
};

export function selectEventsForRun(state: RootState, runId: string): readonly TimelineEvent[] {
  const indices = state.commanderTimeline.byRunId[runId];
  return indices?.map((index) => state.commanderTimeline.events[index]) ?? [];
}

const EMPTY_TIMELINE_EVENTS: readonly TimelineEvent[] = [];

export const selectCurrentRunEvents = createSelector(
  [selectTimelineEvents, (state: RootState) => state.commanderTimeline.byRunId, selectCurrentRunId],
  (events, byRunId, runId): readonly TimelineEvent[] => {
    if (!runId) return EMPTY_TIMELINE_EVENTS;
    const indices = byRunId[runId];
    return indices?.map((index) => events[index]) ?? EMPTY_TIMELINE_EVENTS;
  },
);

export const selectLatestRunCapabilityCatalog = createSelector(
  [
    selectTimelineEvents,
    (state: RootState) => state.commanderTimeline.sessionIdByRunId,
    (state: RootState) => state.commander.activeSessionId,
  ],
  (events, sessionIdByRunId, sessionId) => {
    if (!sessionId) return null;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.kind === 'catalog_frozen' && sessionIdByRunId[event.runId] === sessionId) {
        return event;
      }
    }
    return null;
  },
);

export interface CommanderView {
  messages: CommanderMessage[];
  currentSegments: MessageSegment[];
  currentToolCalls: CommanderToolCall[];
  currentStreamContent: string;
  liveMessage: {
    id: string;
    role: 'assistant';
    content: string;
    toolCalls: CommanderToolCall[];
  } | null;
  pendingConfirmation: PendingConfirmation | null;
  pendingQuestion: PendingQuestion | null;
  error: string | null;
}

const EMPTY_MESSAGES: CommanderMessage[] = [];

export const selectCommanderView = createSelector(
  [
    (state: RootState) => state.commanderTimeline,
    (state: RootState) => state.commander.activeSessionId,
    (state: RootState) =>
      state.commander.sessions.find((session) => session.id === state.commander.activeSessionId) ??
      null,
  ],
  (timelineState, sessionId, session): CommanderView => {
    const currentRunId = sessionId
      ? timelineState.currentRunIdBySessionId[sessionId] ?? null
      : null;
    let activeSegments: MessageSegment[] = [];
    let activeToolCalls: CommanderToolCall[] = [];
    let activeStreamContent = '';
    let activePendingConfirmation: PendingConfirmation | null = null;
    let activePendingQuestion: PendingQuestion | null = null;

    if (sessionId && currentRunId) {
      const runEvents = (timelineState.byRunId[currentRunId] ?? []).map(
        (index) => timelineState.events[index],
      );
      const view = deriveActiveRunView(
        runEvents,
        timelineState.locallyResolvedConfirmationsBySessionId[sessionId]?.[currentRunId] ?? [],
        timelineState.locallyResolvedQuestionsBySessionId[sessionId]?.[currentRunId] ?? [],
      );
      activeSegments = view.segments;
      activeToolCalls = view.toolCalls;
      activeStreamContent = view.streamContent;
      activePendingConfirmation = view.pendingConfirmation;
      activePendingQuestion = view.pendingQuestion;
    }

    return {
      messages: session?.messages ?? EMPTY_MESSAGES,
      currentSegments: activeSegments,
      currentToolCalls: activeToolCalls,
      currentStreamContent: activeStreamContent,
      liveMessage:
        activeStreamContent || activeToolCalls.length > 0
          ? {
              id: `live-${currentRunId ?? 'idle'}`,
              role: 'assistant',
              content: activeStreamContent,
              toolCalls: activeToolCalls,
            }
          : null,
      pendingConfirmation: activePendingConfirmation,
      pendingQuestion: activePendingQuestion,
      error: session?.runtime.error ?? null,
    };
  },
);

export interface ActiveRunChecklistSnapshot {
  checklistId: string;
  items: Array<{
    id: string;
    label: string;
    status: 'pending' | 'in_progress' | 'done';
  }>;
}

export const selectActiveRunChecklistSnapshot = createSelector(
  [selectCurrentRunEvents, selectCurrentRunId],
  (events, currentRunId): ActiveRunChecklistSnapshot | null => {
    if (!currentRunId) return null;
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event.kind !== 'tool_result') continue;
      const snapshot = event.artifacts?.find((artifact) => artifact.kind === 'checklist');
      if (snapshot?.kind === 'checklist') {
        return { checklistId: snapshot.id, items: snapshot.items };
      }
    }
    return null;
  },
);

/**
 * Public-only activity projection used by both Commander and History. It is
 * deliberately derived from append-only timeline events: no provider body,
 * raw tool arguments, private reasoning, or session copy is admitted here.
 */
export type AgentActivityStatus =
  | 'accepted'
  | 'running'
  | 'waiting_user'
  | 'pausing'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export type AgentActivityPlanStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'skipped';

export interface AgentActivityPlanItem {
  id: string;
  title: string;
  status: AgentActivityPlanStatus;
}

export interface SafeToolActivity {
  id: string;
  capability: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  summary?: string;
  details?: PublicToolDetails;
  errorCode?: CommanderErrorCode;
}

export interface AgentActivityResourceState {
  usage: RunResourceUsage;
  remaining: RunResourceRemainder;
  clock: RunResourceClock;
}

export interface AgentActivityNodeView {
  runId: string;
  parentRunId?: string;
  retryOfRunId?: string;
  workType: CommanderWorkType;
  /** Empty when the run did not publish a public name; never inferred from intent. */
  displayName: string;
  objective?: string;
  status: AgentActivityStatus;
  publicPlan: AgentActivityPlanItem[];
  currentStep?: { id?: string; title: string; summary?: string };
  tools: SafeToolActivity[];
  artifacts: PublicToolArtifact[];
  blocker?: RunBlocker;
  startedAt?: number;
  completedAt?: number;
  resourceState?: AgentActivityResourceState;
  childRunIds: string[];
}

export interface AgentActivityTreeView {
  rootRunId: string;
  nodesById: Record<string, AgentActivityNodeView>;
  orderedRunIds: string[];
  hasActiveDescendant: boolean;
}

export interface AgentActivitySessionSummary {
  activeCount: number;
  highestPriorityStatus: AgentActivityStatus | null;
  hasActiveDescendant: boolean;
  rootRunId: string | null;
}

const EMPTY_AGENT_ACTIVITY_SESSION_SUMMARY: AgentActivitySessionSummary = {
  activeCount: 0,
  highestPriorityStatus: null,
  hasActiveDescendant: false,
  rootRunId: null,
};

const ACTIVITY_ACTIVE_STATUSES = new Set<AgentActivityStatus>([
  'accepted',
  'running',
  'waiting_user',
  'pausing',
  'paused',
]);

const ACTIVITY_STATUS_PRIORITY: Record<AgentActivityStatus, number> = {
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

export function isAgentActivityStatusActive(status: AgentActivityStatus): boolean {
  return ACTIVITY_ACTIVE_STATUSES.has(status);
}

function canonicalCapability(event: Extract<TimelineEvent, { kind: 'tool_call' }>): string {
  return `${event.toolRef.domain}.${event.toolRef.action}`;
}

function checklistStatus(
  status: 'pending' | 'in_progress' | 'done',
): AgentActivityPlanStatus {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'in_progress':
      return 'running';
    case 'done':
      return 'completed';
  }
}

function terminalStatus(event: Extract<TimelineEvent, { kind: 'run_end' }>): AgentActivityStatus {
  switch (event.status) {
    case 'completed':
      return 'completed';
    case 'failed':
    case 'max_steps':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'blocked':
      return 'blocked';
  }
}

function deriveActivityNode(events: readonly TimelineEvent[]): AgentActivityNodeView | null {
  const start = events.find((event) => event.kind === 'run_start');
  if (!start || start.kind !== 'run_start') return null;

  let status: AgentActivityStatus = 'running';
  let completedAt: number | undefined;
  let blocker: RunBlocker | undefined;
  let resourceState: AgentActivityResourceState | undefined;
  let currentStep: AgentActivityNodeView['currentStep'];
  let latestChecklist: AgentActivityPlanItem[] = [];
  const toolsById = new Map<string, SafeToolActivity>();
  const artifacts = new Map<string, PublicToolArtifact>();

  for (const event of events) {
    switch (event.kind) {
      case 'run_start':
      case 'catalog_frozen':
      case 'assistant_text':
      case 'resource_usage':
      case 'context_fact':
      case 'phase_note':
        break;
      case 'public_progress':
        if (event.summary?.trim()) {
          currentStep = {
            id: event.operationId,
            title: event.summary.trim(),
            summary: event.summary.trim(),
          };
        }
        break;
      case 'resource_state':
        resourceState = {
          usage: event.usage,
          remaining: event.remaining,
          clock: event.clock,
        };
        break;
      case 'tool_call':
        toolsById.set(event.toolCallId, {
          id: event.toolCallId,
          capability: canonicalCapability(event),
          status: 'running',
          startedAt: event.emittedAt,
          ...(event.summary?.trim() ? { summary: event.summary.trim() } : {}),
          ...(event.details ? { details: event.details } : {}),
        });
        break;
      case 'tool_result': {
        const existing = toolsById.get(event.toolCallId);
        if (existing) {
          existing.status =
            event.status === 'failed'
              ? 'failed'
              : event.status === 'skipped'
                ? 'skipped'
                : 'completed';
          existing.completedAt = event.emittedAt;
          existing.durationMs = event.durationMs;
          if (event.summary?.trim()) existing.summary = event.summary.trim();
          if (event.details) existing.details = event.details;
          if (event.errorCode) existing.errorCode = event.errorCode;
        }
        for (const artifact of event.artifacts ?? []) {
          const key = `${artifact.kind}:${artifact.id}`;
          if (!artifacts.has(key)) artifacts.set(key, artifact);
          if (artifact.kind === 'checklist') {
            latestChecklist = artifact.items.map((item) => ({
              id: item.id,
              title: item.label,
              status: checklistStatus(item.status),
            }));
          }
        }
        break;
      }
      case 'tool_confirm_prompt':
      case 'question_prompt':
        status = 'waiting_user';
        break;
      case 'user_confirmation':
      case 'user_answer':
      case 'run_resumed':
        if (status === 'waiting_user' || status === 'paused' || status === 'pausing') {
          status = 'running';
        }
        break;
      case 'run_paused':
        status = 'paused';
        break;
      case 'cancelled':
        status = 'cancelled';
        completedAt = event.emittedAt;
        break;
      case 'run_end':
        status = terminalStatus(event);
        completedAt = event.emittedAt;
        if (event.status === 'blocked') blocker = event.blocker;
        break;
    }
  }

  return {
    runId: start.runId,
    ...(start.parentRunId ? { parentRunId: start.parentRunId } : {}),
    ...(start.retryOfRunId ? { retryOfRunId: start.retryOfRunId } : {}),
    workType: start.workType,
    displayName: start.displayName?.trim() ?? '',
    ...(start.objective?.trim() ? { objective: start.objective.trim() } : {}),
    status,
    publicPlan: latestChecklist,
    ...(currentStep ? { currentStep } : {}),
    tools: [...toolsById.values()],
    artifacts: [...artifacts.values()],
    ...(blocker ? { blocker } : {}),
    startedAt: start.emittedAt,
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(resourceState ? { resourceState } : {}),
    childRunIds: [],
  };
}

function orderedTreeIds(
  rootRunId: string,
  nodesById: Record<string, AgentActivityNodeView>,
): string[] {
  const ordered: string[] = [];
  const visit = (runId: string) => {
    ordered.push(runId);
    for (const childRunId of nodesById[runId]?.childRunIds ?? []) visit(childRunId);
  };
  visit(rootRunId);
  return ordered;
}

function buildAgentActivityTrees(events: readonly TimelineEvent[]): AgentActivityTreeView[] {
  const eventsByRunId = new Map<string, TimelineEvent[]>();
  const runOrder: string[] = [];
  for (const event of events) {
    const existing = eventsByRunId.get(event.runId);
    if (existing) {
      existing.push(event);
      continue;
    }
    eventsByRunId.set(event.runId, [event]);
    runOrder.push(event.runId);
  }

  const nodesById: Record<string, AgentActivityNodeView> = {};
  for (const runId of runOrder) {
    const node = deriveActivityNode(eventsByRunId.get(runId) ?? []);
    if (node) nodesById[runId] = node;
  }

  const rootRunIds: string[] = [];
  for (const runId of runOrder) {
    const node = nodesById[runId];
    if (!node) continue;
    if (node.parentRunId && nodesById[node.parentRunId]) {
      nodesById[node.parentRunId].childRunIds.push(runId);
    } else {
      rootRunIds.push(runId);
    }
  }

  return rootRunIds.map((rootRunId) => {
    const orderedRunIds = orderedTreeIds(rootRunId, nodesById);
    const treeNodes = Object.fromEntries(
      orderedRunIds.map((runId) => [runId, nodesById[runId]]),
    ) as Record<string, AgentActivityNodeView>;
    return {
      rootRunId,
      nodesById: treeNodes,
      orderedRunIds,
      hasActiveDescendant: orderedRunIds.some((runId) =>
        isAgentActivityStatusActive(nodesById[runId].status),
      ),
    };
  });
}

export const selectAgentActivityTreesForSession = createSelector(
  [
    selectTimelineEvents,
    (state: RootState) => state.commanderTimeline.sessionIdByRunId,
    (_state: RootState, sessionId: string | null) => sessionId,
  ],
  (events, sessionIdByRunId, sessionId): AgentActivityTreeView[] => {
    if (!sessionId) return [];
    return buildAgentActivityTrees(
      events.filter((event) => sessionIdByRunId[event.runId] === sessionId),
    );
  },
);

export function selectAgentActivityTreeForSession(
  state: RootState,
  sessionId: string | null,
  rootRunId?: string,
): AgentActivityTreeView | null {
  const trees = selectAgentActivityTreesForSession(state, sessionId);
  if (rootRunId) return trees.find((tree) => tree.rootRunId === rootRunId) ?? null;
  return [...trees].reverse().find((tree) => tree.hasActiveDescendant) ?? trees.at(-1) ?? null;
}

/** Find the immutable tree that owns a historical or live Run. */
export function selectAgentActivityTreeContainingRunForSession(
  state: RootState,
  sessionId: string | null,
  runId: string | null,
): AgentActivityTreeView | null {
  if (!runId) return null;
  return (
    selectAgentActivityTreesForSession(state, sessionId).find((tree) =>
      Object.hasOwn(tree.nodesById, runId),
    ) ?? null
  );
}

function summarizeAgentActivityTrees(
  trees: readonly AgentActivityTreeView[],
): AgentActivitySessionSummary {
  const nodes = trees.flatMap((tree) => tree.orderedRunIds.map((runId) => tree.nodesById[runId]));
  const activeNodes = nodes.filter((node) => isAgentActivityStatusActive(node.status));
  const highestPriorityStatus = nodes.reduce<AgentActivityStatus | null>((highest, node) => {
    if (!highest || ACTIVITY_STATUS_PRIORITY[node.status] > ACTIVITY_STATUS_PRIORITY[highest]) {
      return node.status;
    }
    return highest;
  }, null);
  const activeTree = [...trees].reverse().find((tree) => tree.hasActiveDescendant) ?? null;

  return {
    activeCount: activeNodes.length,
    highestPriorityStatus,
    hasActiveDescendant: activeNodes.length > 0,
    rootRunId: activeTree?.rootRunId ?? null,
  };
}

/**
 * Stable session-keyed summaries for HistoryPanel. Both History and the
 * Commander trigger therefore consume the exact same public activity tree
 * projection rather than separately inferring whether a run is live.
 */
export const selectAgentActivitySummaryBySession = createSelector(
  [selectTimelineEvents, (state: RootState) => state.commanderTimeline.sessionIdByRunId],
  (events, sessionIdByRunId): Record<string, AgentActivitySessionSummary> => {
    const eventGroups = new Map<string, TimelineEvent[]>();
    for (const event of events) {
      const sessionId = sessionIdByRunId[event.runId];
      if (!sessionId) continue;
      const group = eventGroups.get(sessionId);
      if (group) group.push(event);
      else eventGroups.set(sessionId, [event]);
    }

    return Object.fromEntries(
      [...eventGroups.entries()].map(([sessionId, sessionEvents]) => [
        sessionId,
        summarizeAgentActivityTrees(buildAgentActivityTrees(sessionEvents)),
      ]),
    );
  },
);

export function selectSessionAgentActivitySummary(
  state: RootState,
  sessionId: string | null,
): AgentActivitySessionSummary {
  if (!sessionId) return EMPTY_AGENT_ACTIVITY_SESSION_SUMMARY;
  return selectAgentActivitySummaryBySession(state)[sessionId] ?? EMPTY_AGENT_ACTIVITY_SESSION_SUMMARY;
}
