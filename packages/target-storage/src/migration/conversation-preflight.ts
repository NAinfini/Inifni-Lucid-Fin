import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';

const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'blocked', 'cancelled', 'max_steps']);

export interface LegacyAssistantMessageOrigin {
  readonly sessionId: string;
  readonly messageId: string;
  readonly runId: string;
  readonly status: 'completed' | 'interrupted';
}

export type LegacyConversationPreflightBlocker = Readonly<{
  kind:
    | 'invalid_session_messages'
    | 'duplicate_message_identity'
    | 'assistant_message_missing_run_meta'
    | 'assistant_message_run_missing'
    | 'assistant_message_run_session_mismatch'
    | 'assistant_message_run_not_terminal'
    | 'assistant_message_run_time_mismatch'
    | 'assistant_message_run_event_projection_mismatch'
    | 'assistant_message_run_reused';
  sessionId: string;
  messageId: string | null;
  runId: string | null;
}>;

export interface LegacyConversationPreflightReport {
  readonly schema: 'lucid-fin.legacy-conversation-preflight/v1';
  readonly sessionCount: number;
  readonly messageCount: number;
  readonly assistantMessageCount: number;
  readonly assistantOrigins: readonly LegacyAssistantMessageOrigin[];
  readonly blockers: readonly LegacyConversationPreflightBlocker[];
  readonly fingerprint: string;
  readonly ok: boolean;
}

interface RunRow {
  readonly id: unknown;
  readonly session_id: unknown;
  readonly status: unknown;
  readonly accepted_at: unknown;
  readonly started_at: unknown;
  readonly completed_at: unknown;
  readonly last_seq: unknown;
}

interface EventRow {
  readonly seq: unknown;
  readonly kind: unknown;
  readonly payload: unknown;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function integer(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  return typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : null;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

function parsePayload(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

function loadRun(database: DatabaseSync, runId: string): RunRow | undefined {
  try {
    const statement = database.prepare(
      `SELECT id, session_id, status, accepted_at, started_at, completed_at, last_seq
         FROM commander_runs WHERE id = ?`,
    );
    statement.setReadBigInts(true);
    return statement.get(runId) as unknown as RunRow | undefined;
  } catch {
    return undefined;
  }
}

function loadRunEvents(database: DatabaseSync, runId: string): readonly EventRow[] {
  try {
    const statement = database.prepare(
      'SELECT seq, kind, payload FROM commander_events WHERE run_id = ? ORDER BY seq',
    );
    statement.setReadBigInts(true);
    return statement.all(runId) as unknown as readonly EventRow[];
  } catch {
    return [];
  }
}

function projectedAssistantText(events: readonly EventRow[]): string | null {
  const finalTexts: string[] = [];
  const deltas: string[] = [];
  for (const event of events) {
    const payload = parsePayload(event.payload);
    if (event.kind !== 'assistant_text' || payload?.kind !== 'assistant_text') continue;
    if (typeof payload.content !== 'string') return null;
    if (payload.isDelta === false) finalTexts.push(payload.content);
    else if (payload.isDelta === true) deltas.push(payload.content);
    else return null;
  }
  if (finalTexts.length === 1) return finalTexts[0]!;
  if (finalTexts.length > 1 || deltas.length === 0) return null;
  return deltas.join('');
}

function eventsProveRun(run: RunRow, events: readonly EventRow[], content: string): boolean {
  const lastSequence = integer(run.last_seq);
  if (
    lastSequence === null ||
    lastSequence < 1n ||
    lastSequence >= BigInt(Number.MAX_SAFE_INTEGER) ||
    events.length !== Number(lastSequence + 1n)
  ) {
    return false;
  }
  for (const [index, event] of events.entries()) {
    if (integer(event.seq) !== BigInt(index)) return false;
  }
  const first = events[0];
  const last = events.at(-1);
  const firstPayload = parsePayload(first?.payload);
  const lastPayload = parsePayload(last?.payload);
  if (
    first?.kind !== 'run_start' ||
    firstPayload?.kind !== 'run_start' ||
    last?.kind !== 'run_end' ||
    lastPayload?.kind !== 'run_end' ||
    lastPayload.status !== run.status
  ) {
    return false;
  }
  return projectedAssistantText(events) === content;
}

function runTimeMatches(run: RunRow, messageTimestamp: unknown, runMeta: Record<string, unknown>) {
  const acceptedAt = integer(run.accepted_at);
  const startedAt = integer(run.started_at);
  const completedAt = integer(run.completed_at);
  const timestamp = integer(messageTimestamp);
  if (
    acceptedAt === null ||
    startedAt === null ||
    completedAt === null ||
    timestamp === null ||
    acceptedAt > startedAt ||
    startedAt > completedAt ||
    timestamp < acceptedAt ||
    timestamp > completedAt
  ) {
    return false;
  }
  const metaStartedAt = runMeta.startedAt;
  const metaCompletedAt = runMeta.completedAt;
  return (
    (metaStartedAt === undefined || integer(metaStartedAt) === startedAt) &&
    (metaCompletedAt === undefined || integer(metaCompletedAt) === completedAt)
  );
}

function blocker(
  kind: LegacyConversationPreflightBlocker['kind'],
  sessionId: string,
  messageId: string | null,
  runId: string | null,
): LegacyConversationPreflightBlocker {
  return { kind, sessionId, messageId, runId };
}

/**
 * Proves the only permitted origin for canonical imported assistant Messages.
 * The report contains identities and verdicts only; message/event text is
 * never copied into diagnostics.
 */
export function preflightLegacyConversation(
  database: DatabaseSync,
): LegacyConversationPreflightReport {
  const sessionStatement = database.prepare(
    'SELECT id, messages FROM commander_sessions ORDER BY id',
  );
  const sessionRows = sessionStatement.all() as unknown as readonly {
    readonly id: unknown;
    readonly messages: unknown;
  }[];
  const assistantOrigins: LegacyAssistantMessageOrigin[] = [];
  const assistantOriginRunIds = new Set<string>();
  const messageIds = new Set<string>();
  const blockers: LegacyConversationPreflightBlocker[] = [];
  let messageCount = 0;
  let assistantMessageCount = 0;

  for (const sessionRow of sessionRows) {
    const sessionId = validId(sessionRow.id) ? sessionRow.id : 'invalid-session';
    let messages: unknown;
    try {
      messages = typeof sessionRow.messages === 'string' ? JSON.parse(sessionRow.messages) : null;
    } catch {
      messages = null;
    }
    if (!validId(sessionRow.id) || !Array.isArray(messages)) {
      blockers.push(blocker('invalid_session_messages', sessionId, null, null));
      continue;
    }
    messageCount += messages.length;
    for (const candidate of messages) {
      const message = record(candidate);
      const candidateMessageId = validId(message?.id) ? message.id : null;
      if (candidateMessageId !== null) {
        if (messageIds.has(candidateMessageId)) {
          blockers.push(
            blocker('duplicate_message_identity', sessionRow.id, candidateMessageId, null),
          );
        } else {
          messageIds.add(candidateMessageId);
        }
      }
      if (message?.role !== 'assistant') continue;
      assistantMessageCount += 1;
      const messageId = candidateMessageId;
      const runMeta = record(message.runMeta);
      const runId = validId(runMeta?.runId) ? runMeta.runId : null;
      if (messageId === null || runMeta === null || runId === null) {
        blockers.push(
          blocker('assistant_message_missing_run_meta', sessionRow.id, messageId, runId),
        );
        continue;
      }
      const run = loadRun(database, runId);
      if (!run) {
        blockers.push(blocker('assistant_message_run_missing', sessionRow.id, messageId, runId));
        continue;
      }
      if (run.session_id !== sessionRow.id) {
        blockers.push(
          blocker('assistant_message_run_session_mismatch', sessionRow.id, messageId, runId),
        );
        continue;
      }
      if (
        typeof run.status !== 'string' ||
        !TERMINAL_RUN_STATUSES.has(run.status) ||
        (runMeta.status !== undefined && runMeta.status !== run.status)
      ) {
        blockers.push(
          blocker('assistant_message_run_not_terminal', sessionRow.id, messageId, runId),
        );
        continue;
      }
      if (!runTimeMatches(run, message.timestamp, runMeta)) {
        blockers.push(
          blocker('assistant_message_run_time_mismatch', sessionRow.id, messageId, runId),
        );
        continue;
      }
      const events = loadRunEvents(database, runId);
      if (typeof message.content !== 'string' || !eventsProveRun(run, events, message.content)) {
        blockers.push(
          blocker(
            'assistant_message_run_event_projection_mismatch',
            sessionRow.id,
            messageId,
            runId,
          ),
        );
        continue;
      }
      if (assistantOriginRunIds.has(runId)) {
        blockers.push(blocker('assistant_message_run_reused', sessionRow.id, messageId, runId));
        continue;
      }
      assistantOriginRunIds.add(runId);
      assistantOrigins.push({
        sessionId: sessionRow.id,
        messageId,
        runId,
        status: run.status === 'completed' ? 'completed' : 'interrupted',
      });
    }
  }

  assistantOrigins.sort(
    (left, right) =>
      compareText(left.sessionId, right.sessionId) || compareText(left.messageId, right.messageId),
  );
  blockers.sort(
    (left, right) =>
      compareText(left.sessionId, right.sessionId) ||
      compareText(left.messageId ?? '', right.messageId ?? '') ||
      compareText(left.kind, right.kind),
  );
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-conversation-preflight/v1' as const,
    sessionCount: sessionRows.length,
    messageCount,
    assistantMessageCount,
    assistantOrigins,
    blockers,
  };
  return {
    ...withoutFingerprint,
    fingerprint: hashCanonical(withoutFingerprint),
    ok: blockers.length === 0,
  };
}
