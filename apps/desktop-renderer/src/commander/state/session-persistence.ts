/**
 * `commander/state/session-persistence.ts` — Phase E split-1.
 *
 * localStorage persistence for Commander sessions + provider id. Extracted
 * from the original slice so reducers stay focused on state transitions.
 *
 * All functions are fault-tolerant: localStorage may be unavailable
 * (privacy mode), the blob may be malformed, or quota may be exceeded.
 * On failure we fall back to safe defaults — the user's in-memory state is
 * never corrupted by a broken persist.
 */

import {
  COMMANDER_PROVIDER_KEY,
  COMMANDER_SESSIONS_KEY,
  MAX_MESSAGES_PER_SESSION,
  MAX_SESSIONS,
  MAX_STORAGE_BYTES,
} from './constants.js';
import { createCommanderSessionRuntime, deriveSessionTitle, hasUserMessage } from './helpers.js';
import type {
  CommanderExitDecisionMeta,
  CommanderMessage,
  CommanderRunMeta,
  CommanderSession,
  CommanderState,
  CommanderToolCall,
  MessageSegment,
} from './types.js';
import {
  COMMANDER_ERROR_CODES,
  type PublicToolArtifact,
  type PublicToolDetails,
  type ResourceAmount,
  type ResourceRemaining,
  type ResourceStateCause,
  type RunBlocker,
} from '@lucid-fin/contracts';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function publicDetails(value: unknown): PublicToolDetails | undefined {
  const source = record(value);
  if (!source) return undefined;
  const details: PublicToolDetails = {};
  for (const [key, item] of Object.entries(source).slice(0, 32)) {
    if (typeof item === 'string') details[key.slice(0, 80)] = item.slice(0, 240);
    else if (typeof item === 'number' && Number.isFinite(item)) details[key.slice(0, 80)] = item;
    else if (typeof item === 'boolean' || item === null) details[key.slice(0, 80)] = item;
  }
  return Object.keys(details).length ? details : undefined;
}

function publicArtifacts(value: unknown): PublicToolArtifact[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const artifacts: PublicToolArtifact[] = [];
  for (const candidate of value.slice(0, 32)) {
    const item = record(candidate);
    if (!item || typeof item.id !== 'string') continue;
    const id = item.id.slice(0, 160);
    const label = typeof item.label === 'string' ? item.label.slice(0, 240) : undefined;
    if (item.kind === 'checklist' && Array.isArray(item.items)) {
      const items: Extract<PublicToolArtifact, { kind: 'checklist' }>['items'] = [];
      for (const entry of item.items.slice(0, 200)) {
        const row = record(entry);
        if (
          typeof row?.id !== 'string' ||
          typeof row.label !== 'string' ||
          (row.status !== 'pending' && row.status !== 'in_progress' && row.status !== 'done')
        ) continue;
        items.push({
          id: row.id.slice(0, 160),
          label: row.label.slice(0, 240),
          status: row.status,
        });
      }
      artifacts.push({ kind: 'checklist', id, ...(label ? { label } : {}), items });
    } else if (item.kind === 'asset') {
      const mediaType = item.mediaType;
      artifacts.push({
        kind: 'asset',
        id,
        ...(label ? { label } : {}),
        ...(typeof item.contentHash === 'string'
          ? { contentHash: item.contentHash.slice(0, 160) }
          : {}),
        ...(mediaType === 'image' || mediaType === 'video' || mediaType === 'audio' || mediaType === 'document'
          ? { mediaType }
          : {}),
      });
    } else if (item.kind === 'canvas_node') {
      artifacts.push({
        kind: 'canvas_node',
        id,
        ...(label ? { label } : {}),
        ...(typeof item.assetHash === 'string' ? { assetHash: item.assetHash.slice(0, 160) } : {}),
      });
    }
  }
  return artifacts.length ? artifacts : undefined;
}

function sanitizeToolCall(value: unknown): CommanderToolCall | undefined {
  const tool = record(value);
  if (
    !tool ||
    typeof tool.id !== 'string' ||
    typeof tool.name !== 'string' ||
    typeof tool.startedAt !== 'number'
  ) return undefined;
  const status = tool.status === 'done' || tool.status === 'error' ? tool.status : 'pending';
  const details = publicDetails(tool.details);
  const artifacts = publicArtifacts(tool.artifacts);
  const errorCode =
    typeof tool.errorCode === 'string' &&
    (COMMANDER_ERROR_CODES as readonly string[]).includes(tool.errorCode)
      ? (tool.errorCode as CommanderToolCall['errorCode'])
      : undefined;
  return {
    id: tool.id,
    name: tool.name,
    startedAt: tool.startedAt,
    status,
    ...(typeof tool.completedAt === 'number' ? { completedAt: tool.completedAt } : {}),
    ...(typeof tool.durationMs === 'number' && tool.durationMs >= 0
      ? { durationMs: tool.durationMs }
      : {}),
    ...(typeof tool.summary === 'string' ? { summary: tool.summary.slice(0, 240) } : {}),
    ...(details ? { details } : {}),
    ...(artifacts ? { artifacts } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
}

function nonnegativeFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function safeNonnegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function sanitizeResourceAmount(value: unknown): ResourceAmount | undefined {
  const amount = record(value);
  if (!amount) return undefined;
  if (amount.knowledge === 'unknown') return { knowledge: 'unknown' };
  const numericValue = nonnegativeFinite(amount.value);
  if (numericValue === undefined) return undefined;
  if (amount.knowledge === 'known' || amount.knowledge === 'estimated') {
    return { knowledge: amount.knowledge, value: numericValue };
  }
  return undefined;
}

function sanitizeResourceRemaining(value: unknown): ResourceRemaining | undefined {
  const remaining = record(value);
  if (!remaining) return undefined;
  if (remaining.state === 'unlimited') return { state: 'unlimited' };
  if (remaining.state === 'unknown') return { state: 'unknown' };
  const numericValue = nonnegativeFinite(remaining.value);
  if (numericValue === undefined) return undefined;
  if (remaining.state === 'known' || remaining.state === 'estimated') {
    return { state: remaining.state, value: numericValue };
  }
  return undefined;
}

function sanitizeRunBlocker(value: unknown): RunBlocker | undefined {
  const blocker = record(value);
  if (!blocker) return undefined;
  if (
    blocker.kind === 'resource_budget' &&
    (blocker.metric === 'tokens' ||
      blocker.metric === 'tool_calls' ||
      blocker.metric === 'wall_time' ||
      blocker.metric === 'cost') &&
    (blocker.reason === 'exhausted' || blocker.reason === 'unavailable')
  ) {
    return { kind: 'resource_budget', metric: blocker.metric, reason: blocker.reason };
  }
  if (
    blocker.kind === 'safety_limit' &&
    (blocker.limit === 'context_window' ||
      blocker.limit === 'provider_limit' ||
      blocker.limit === 'recovery_required')
  ) {
    return { kind: 'safety_limit', limit: blocker.limit };
  }
  return undefined;
}

function sanitizeResourceStateCause(value: unknown): ResourceStateCause | undefined {
  const cause = record(value);
  if (!cause) return undefined;
  if (
    cause.kind === 'initialized' ||
    cause.kind === 'wait_started' ||
    cause.kind === 'wait_ended'
  ) {
    return { kind: cause.kind };
  }
  if (
    (cause.kind === 'reserved' || cause.kind === 'settled') &&
    typeof cause.operationId === 'string' &&
    (cause.source === 'model' || cause.source === 'tool')
  ) {
    return { kind: cause.kind, operationId: cause.operationId, source: cause.source };
  }
  if (cause.kind === 'boundary') {
    const blocker = sanitizeRunBlocker(cause.blocker);
    return blocker ? { kind: 'boundary', blocker } : undefined;
  }
  return undefined;
}

function sanitizeSegment(value: unknown): MessageSegment | undefined {
  const segment = record(value);
  if (!segment || typeof segment.id !== 'string' || typeof segment.kind !== 'string') return undefined;
  if (segment.kind === 'text' && typeof segment.content === 'string') {
    return { kind: 'text', id: segment.id, content: segment.content };
  }
  if (segment.kind === 'tool') {
    const toolCall = sanitizeToolCall(segment.toolCall);
    return toolCall ? { kind: 'tool', id: segment.id, toolCall } : undefined;
  }
  if (
    segment.kind === 'progress' &&
    typeof segment.operationId === 'string' &&
    (segment.status === 'running' || segment.status === 'completed' || segment.status === 'failed')
  ) {
    return {
      kind: 'progress',
      id: segment.id,
      operationId: segment.operationId,
      status: segment.status,
      ...(typeof segment.summary === 'string' ? { summary: segment.summary.slice(0, 240) } : {}),
    };
  }
  if (segment.kind === 'resource_usage' && typeof segment.operationId === 'string') {
    const count = (item: unknown) =>
      typeof item === 'number' && Number.isInteger(item) && item >= 0 ? item : undefined;
    return {
      kind: 'resource_usage',
      id: segment.id,
      operationId: segment.operationId,
      ...(count(segment.promptTokens) !== undefined ? { promptTokens: count(segment.promptTokens) } : {}),
      ...(count(segment.completionTokens) !== undefined ? { completionTokens: count(segment.completionTokens) } : {}),
      ...(count(segment.reasoningTokens) !== undefined ? { reasoningTokens: count(segment.reasoningTokens) } : {}),
    };
  }
  if (segment.kind === 'resource_state') {
    const cause = sanitizeResourceStateCause(segment.cause);
    const usage = record(segment.usage);
    const remaining = record(segment.remaining);
    const clock = record(segment.clock);
    const tokens = sanitizeResourceAmount(usage?.tokens);
    const costUsd = sanitizeResourceAmount(usage?.costUsd);
    const toolCalls = safeNonnegativeInteger(usage?.toolCalls);
    const wallTimeMs = safeNonnegativeInteger(usage?.wallTimeMs);
    const remainingTokens = sanitizeResourceRemaining(remaining?.tokens);
    const remainingToolCalls = sanitizeResourceRemaining(remaining?.toolCalls);
    const remainingWallTimeMs = sanitizeResourceRemaining(remaining?.wallTimeMs);
    const remainingCostUsd = sanitizeResourceRemaining(remaining?.costUsd);
    const activeMs = safeNonnegativeInteger(clock?.activeMs);
    const changedAt = safeNonnegativeInteger(clock?.changedAt);
    if (
      !cause ||
      !tokens ||
      !costUsd ||
      toolCalls === undefined ||
      wallTimeMs === undefined ||
      !remainingTokens ||
      !remainingToolCalls ||
      !remainingWallTimeMs ||
      !remainingCostUsd ||
      !clock ||
      (clock.state !== 'active' && clock.state !== 'waiting_user' && clock.state !== 'stopped') ||
      activeMs === undefined ||
      changedAt === undefined
    ) return undefined;
    return {
      kind: 'resource_state',
      id: segment.id,
      cause,
      usage: { tokens, toolCalls, wallTimeMs, costUsd },
      remaining: {
        tokens: remainingTokens,
        toolCalls: remainingToolCalls,
        wallTimeMs: remainingWallTimeMs,
        costUsd: remainingCostUsd,
      },
      clock: { state: clock.state, activeMs, changedAt },
    };
  }
  if (segment.kind === 'step_marker' && typeof segment.step === 'number' && typeof segment.at === 'number') {
    return { kind: 'step_marker', id: segment.id, step: segment.step, at: segment.at };
  }
  return undefined;
}

function sanitizeRunMeta(value: unknown): CommanderRunMeta | undefined {
  const meta = record(value);
  const summary = record(meta?.summary);
  if (
    !meta ||
    (meta.status !== 'completed' && meta.status !== 'failed' && meta.status !== 'blocked') ||
    typeof meta.collapsed !== 'boolean' ||
    typeof meta.startedAt !== 'number' ||
    typeof meta.completedAt !== 'number' ||
    !summary ||
    typeof summary.excerpt !== 'string' ||
    typeof summary.toolCount !== 'number' ||
    typeof summary.failedToolCount !== 'number' ||
    typeof summary.durationMs !== 'number'
  ) return undefined;
  const exit = record(meta.exitDecision);
  const exitOutcome = exit?.outcome;
  const exitDecision: CommanderExitDecisionMeta | undefined =
    exitOutcome === 'satisfied' ||
    exitOutcome === 'unsatisfied' ||
    exitOutcome === 'informational_answered' ||
    exitOutcome === 'blocked_waiting_user' ||
    exitOutcome === 'refused' ||
    exitOutcome === 'budget_exhausted' ||
    exitOutcome === 'error'
      ? {
          outcome: exitOutcome,
          ...(typeof exit?.contractId === 'string' ? { contractId: exit.contractId } : {}),
          ...(typeof exit?.blockerKind === 'string' ? { blockerKind: exit.blockerKind } : {}),
        }
      : undefined;
  const cancelled = record(meta.cancelled);
  const cancelledMeta: CommanderRunMeta['cancelled'] | undefined =
    cancelled &&
    (cancelled.reason === 'user' || cancelled.reason === 'timeout' || cancelled.reason === 'error') &&
    typeof cancelled.completedToolCalls === 'number' &&
    typeof cancelled.pendingToolCalls === 'number'
      ? {
          reason: cancelled.reason,
          completedToolCalls: cancelled.completedToolCalls,
          pendingToolCalls: cancelled.pendingToolCalls,
          ...(typeof cancelled.partialContent === 'string'
            ? { partialContent: cancelled.partialContent }
            : {}),
        }
      : undefined;
  const blocker = sanitizeRunBlocker(meta.blocker);
  if (meta.status === 'blocked' && !blocker) return undefined;
  return {
    status: meta.status,
    collapsed: meta.collapsed,
    startedAt: meta.startedAt,
    completedAt: meta.completedAt,
    summary: {
      excerpt: summary.excerpt,
      toolCount: summary.toolCount,
      failedToolCount: summary.failedToolCount,
      durationMs: summary.durationMs,
    },
    ...(exitDecision ? { exitDecision } : {}),
    ...(blocker ? { blocker } : {}),
    ...(cancelledMeta ? { cancelled: cancelledMeta } : {}),
  };
}

function sanitizeQuestionMeta(value: unknown): CommanderMessage['questionMeta'] {
  const question = record(value);
  if (!question || typeof question.question !== 'string' || !Array.isArray(question.options)) {
    return undefined;
  }
  return {
    question: question.question,
    options: question.options.flatMap((candidate) => {
      const option = record(candidate);
      if (!option || typeof option.label !== 'string') return [];
      return [{
        label: option.label,
        ...(typeof option.description === 'string' ? { description: option.description } : {}),
        ...(typeof option.previewAssetHash === 'string'
          ? { previewAssetHash: option.previewAssetHash }
          : {}),
      }];
    }),
  };
}

export function sanitizeCommanderMessages(value: unknown): CommanderMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const message = record(candidate);
    if (
      !message ||
      typeof message.id !== 'string' ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string' ||
      typeof message.timestamp !== 'number'
    ) return [];
    const segments = Array.isArray(message.segments)
      ? message.segments.flatMap((segment) => sanitizeSegment(segment) ?? [])
      : undefined;
    const toolCalls = Array.isArray(message.toolCalls)
      ? message.toolCalls.flatMap((tool) => sanitizeToolCall(tool) ?? [])
      : undefined;
    const runMeta = sanitizeRunMeta(message.runMeta);
    const questionMeta = sanitizeQuestionMeta(message.questionMeta);
    return [{
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      ...(segments?.length ? { segments } : {}),
      ...(toolCalls?.length ? { toolCalls } : {}),
      ...(runMeta ? { runMeta } : {}),
      ...(questionMeta ? { questionMeta } : {}),
    } satisfies CommanderMessage];
  });
}

export function loadPersistedProviderId(): string | null {
  try {
    return localStorage.getItem(COMMANDER_PROVIDER_KEY);
  } catch {
    return null;
  }
}

export function writePersistedProviderId(providerId: string | null): void {
  try {
    if (providerId) {
      localStorage.setItem(COMMANDER_PROVIDER_KEY, providerId);
    } else {
      localStorage.removeItem(COMMANDER_PROVIDER_KEY);
    }
  } catch {
    /* localStorage unavailable */
  }
}

export function loadPersistedSessions(): CommanderSession[] {
  try {
    const raw = localStorage.getItem(COMMANDER_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const session = value as Partial<CommanderSession>;
      if (
        typeof session.id !== 'string' ||
        typeof session.title !== 'string' ||
        !Array.isArray(session.messages) ||
        typeof session.createdAt !== 'number' ||
        typeof session.updatedAt !== 'number'
      ) {
        return [];
      }
      const persistedRuntime =
        session.runtime && typeof session.runtime === 'object' ? session.runtime : undefined;
      const messages = sanitizeCommanderMessages(session.messages);
      return [
        {
          id: session.id,
          defaultCanvasId:
            typeof session.defaultCanvasId === 'string' ? session.defaultCanvasId : null,
          title: session.title,
          messages,
          messageCount: messages.length,
          runtime: { ...createCommanderSessionRuntime(), ...persistedRuntime },
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
      ];
    });
  } catch {
    return [];
  }
}

function trimSessionForStorage(session: CommanderSession): CommanderSession {
  const pendingQueue = session.runtime.messageQueue.slice(session.runtime.messageQueueCursor);
  const queueDropCount = Math.max(0, pendingQueue.length - MAX_MESSAGES_PER_SESSION);
  const messages = sanitizeCommanderMessages(session.messages).slice(-MAX_MESSAGES_PER_SESSION);
  return {
    ...session,
    messages,
    messageCount: messages.length,
    runtime: {
      ...session.runtime,
      finalizedRunIds: session.runtime.finalizedRunIds.slice(-MAX_MESSAGES_PER_SESSION),
      messageQueue: pendingQueue.slice(-MAX_MESSAGES_PER_SESSION),
      messageQueueCursor: 0,
      messageQueueFirstIndex:
        session.runtime.messageQueueFirstIndex +
        session.runtime.messageQueueCursor +
        queueDropCount,
      pendingInjectedMessages:
        session.runtime.pendingInjectedMessages.slice(-MAX_MESSAGES_PER_SESSION),
    },
  };
}

export function persistSessions(sessions: CommanderSession[]): void {
  const trimmed = sessions.slice(0, MAX_SESSIONS).map(trimSessionForStorage);
  try {
    const json = JSON.stringify(trimmed);
    if (json.length > MAX_STORAGE_BYTES) {
      const serializedSessions = trimmed.map((session) => JSON.stringify(session));
      let retainedCount = 0;
      let retainedBytes = 2;
      for (const serializedSession of serializedSessions) {
        const nextBytes = retainedBytes + serializedSession.length + (retainedCount > 0 ? 1 : 0);
        if (retainedCount > 0 && nextBytes > MAX_STORAGE_BYTES) break;
        retainedBytes = nextBytes;
        retainedCount += 1;
      }
      localStorage.setItem(
        COMMANDER_SESSIONS_KEY,
        `[${serializedSessions.slice(0, retainedCount).join(',')}]`,
      );
      return;
    }
    localStorage.setItem(COMMANDER_SESSIONS_KEY, json);
  } catch {
    // QuotaExceededError — evict oldest half and retry once
    try {
      const halved = trimmed.slice(0, Math.max(1, Math.floor(trimmed.length / 2)));
      localStorage.setItem(COMMANDER_SESSIONS_KEY, JSON.stringify(halved));
    } catch {
      // Completely full — clear sessions to prevent data loss elsewhere
      try {
        localStorage.removeItem(COMMANDER_SESSIONS_KEY);
      } catch {
        /* noop */
      }
    }
  }
}

/**
 * Persist the current in-memory session into `state.sessions` AND to
 * localStorage. Mutates `state` — exclusively called from within reducers.
 */
export function persistSession(state: CommanderState, sessionId: string): void {
  const session = state.sessions.find((candidate) => candidate.id === sessionId);
  if (!session) return;
  session.messageCount = session.messages.length;
  if (hasUserMessage(session.messages)) session.title = deriveSessionTitle(session.messages);
  session.updatedAt = Date.now();
  persistSessions(state.sessions);
}
