import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ImportedRunAttachmentRoleSchema } from '@lucid-fin/target-contracts';
import { hashCanonical } from '../internal/hashes.js';
import {
  legacyTargetSafeInteger,
  legacyTargetTimestampMilliseconds,
} from './legacy-target-values.js';

const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'blocked', 'cancelled', 'max_steps']);

export type LegacyRunHistoryPreflightBlocker = Readonly<{
  kind:
    | 'invalid_run_identity'
    | 'nonterminal_run'
    | 'invalid_run_time_order'
    | 'missing_run_lineage'
    | 'cyclic_run_lineage'
    | 'run_lineage_session_mismatch'
    | 'run_event_sequence_mismatch'
    | 'invalid_run_event_scalar'
    | 'run_event_payload_mismatch'
    | 'run_terminal_mismatch'
    | 'invalid_run_scope'
    | 'invalid_run_attachment'
    | 'unverified_run_attachment';
  runId: string;
  detailId: string | null;
}>;

export interface LegacyRunHistoryPreflightReport {
  readonly schema: 'lucid-fin.legacy-run-history-preflight/v1';
  readonly counts: Readonly<{
    runs: number;
    events: number;
    scopes: number;
    attachments: number;
  }>;
  readonly sourceFingerprint: string;
  readonly blockers: readonly LegacyRunHistoryPreflightBlocker[];
  readonly fingerprint: string;
  readonly ok: boolean;
}

interface RunRow extends Record<string, unknown> {
  readonly id: unknown;
  readonly session_id: unknown;
  readonly parent_run_id: unknown;
  readonly retry_of_run_id: unknown;
  readonly status: unknown;
  readonly accepted_at: unknown;
  readonly started_at: unknown;
  readonly completed_at: unknown;
  readonly last_seq: unknown;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

function payload(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function rows(database: DatabaseSync, sql: string): readonly Record<string, unknown>[] {
  const statement = database.prepare(sql);
  statement.setReadBigInts(true);
  return statement.all() as unknown as readonly Record<string, unknown>[];
}

function rowFingerprint(row: Readonly<Record<string, unknown>>): string {
  const normalized = Object.keys(row)
    .sort(compareText)
    .map((key) => {
      const value = row[key];
      if (value instanceof Uint8Array) {
        return [
          key,
          { bytes: value.byteLength, sha256: createHash('sha256').update(value).digest('hex') },
        ];
      }
      return [key, typeof value === 'bigint' ? value.toString() : value];
    });
  return hashCanonical(normalized);
}

function add(
  blockers: LegacyRunHistoryPreflightBlocker[],
  kind: LegacyRunHistoryPreflightBlocker['kind'],
  runId: string,
  detailId: string | null = null,
): void {
  blockers.push({ kind, runId, detailId });
}

function validTimes(run: RunRow): boolean {
  const accepted = legacyTargetTimestampMilliseconds(run.accepted_at);
  const started = legacyTargetTimestampMilliseconds(run.started_at);
  const completed = legacyTargetTimestampMilliseconds(run.completed_at);
  return (
    accepted !== null &&
    started !== null &&
    completed !== null &&
    accepted <= started &&
    started <= completed
  );
}

/** Validates immutable Legacy run evidence without constructing live Target Runs. */
export function preflightLegacyRunHistory(
  database: DatabaseSync,
  verifiedMediaHashes: ReadonlySet<string>,
): LegacyRunHistoryPreflightReport {
  const runRows = rows(database, 'SELECT * FROM commander_runs ORDER BY id') as readonly RunRow[];
  const eventRows = rows(database, 'SELECT * FROM commander_events ORDER BY run_id, seq');
  const scopeRows = rows(
    database,
    'SELECT * FROM commander_run_canvases ORDER BY run_id, ordinal, canvas_id',
  );
  const attachmentRows = rows(
    database,
    'SELECT * FROM commander_run_attachments ORDER BY run_id, ordinal, content_hash',
  );
  const blockers: LegacyRunHistoryPreflightBlocker[] = [];
  const runs = new Map<string, RunRow>();

  for (const run of runRows) {
    const runId = validId(run.id) ? run.id : 'invalid-run';
    if (!validId(run.id) || !validId(run.session_id) || runs.has(run.id)) {
      add(blockers, 'invalid_run_identity', runId);
      continue;
    }
    runs.set(run.id, run);
    if (typeof run.status !== 'string' || !TERMINAL_STATUSES.has(run.status)) {
      add(blockers, 'nonterminal_run', run.id);
    }
    if (!validTimes(run)) add(blockers, 'invalid_run_time_order', run.id);
  }

  const visitLineage = (run: RunRow, field: 'parent_run_id' | 'retry_of_run_id'): void => {
    const runId = run.id as string;
    const lineageId = run[field];
    if (lineageId === null) return;
    if (!validId(lineageId) || !runs.has(lineageId)) {
      add(blockers, 'missing_run_lineage', runId, validId(lineageId) ? lineageId : null);
      return;
    }
    const lineage = runs.get(lineageId)!;
    if (lineage.session_id !== run.session_id) {
      add(blockers, 'run_lineage_session_mismatch', runId, lineageId);
    }
    const seen = new Set([runId]);
    let cursor: RunRow | undefined = lineage;
    while (cursor) {
      const cursorId = cursor.id as string;
      if (seen.has(cursorId)) {
        add(blockers, 'cyclic_run_lineage', runId, cursorId);
        break;
      }
      seen.add(cursorId);
      const next: unknown = cursor[field];
      cursor = validId(next) ? runs.get(next) : undefined;
    }
  };
  for (const run of runs.values()) {
    visitLineage(run, 'parent_run_id');
    visitLineage(run, 'retry_of_run_id');
  }

  const eventsByRun = new Map<string, Record<string, unknown>[]>();
  for (const event of eventRows) {
    const runId = validId(event.run_id) ? event.run_id : 'invalid-run';
    const group = eventsByRun.get(runId) ?? [];
    group.push(event);
    eventsByRun.set(runId, group);
  }
  for (const [runId, run] of runs) {
    const events = eventsByRun.get(runId) ?? [];
    const lastSequence = legacyTargetSafeInteger(run.last_seq);
    if (
      lastSequence === null ||
      lastSequence < 1 ||
      lastSequence >= Number.MAX_SAFE_INTEGER ||
      events.length !== lastSequence + 1 ||
      events.some((event, index) => legacyTargetSafeInteger(event.seq) !== index)
    ) {
      add(blockers, 'run_event_sequence_mismatch', runId);
      continue;
    }
    let payloadsValid = true;
    for (const event of events) {
      const parsed = payload(event.payload);
      if (typeof event.kind !== 'string' || parsed?.kind !== event.kind) payloadsValid = false;
      const step = legacyTargetSafeInteger(event.step);
      if (
        step === null ||
        step < 0 ||
        legacyTargetTimestampMilliseconds(event.emitted_at) === null
      ) {
        add(
          blockers,
          'invalid_run_event_scalar',
          runId,
          String(legacyTargetSafeInteger(event.seq) ?? 'invalid'),
        );
      }
    }
    if (!payloadsValid) add(blockers, 'run_event_payload_mismatch', runId);
    const first = events[0];
    const last = events.at(-1);
    if (
      first?.kind !== 'run_start' ||
      last?.kind !== 'run_end' ||
      payload(last.payload)?.status !== run.status
    ) {
      add(blockers, 'run_terminal_mismatch', runId);
    }
  }
  for (const runId of eventsByRun.keys()) {
    if (!runs.has(runId)) add(blockers, 'invalid_run_identity', runId);
  }

  const scopeOrdinals = new Map<string, Set<string>>();
  for (const scope of scopeRows) {
    const runId = validId(scope.run_id) ? scope.run_id : 'invalid-run';
    const ordinal = legacyTargetSafeInteger(scope.ordinal);
    const key = ordinal?.toString() ?? 'invalid';
    const seen = scopeOrdinals.get(runId) ?? new Set<string>();
    if (
      !runs.has(runId) ||
      !validId(scope.canvas_id) ||
      ordinal === null ||
      ordinal < 0 ||
      (scope.released_at !== null &&
        scope.released_at !== undefined &&
        legacyTargetTimestampMilliseconds(scope.released_at) === null) ||
      seen.has(key)
    ) {
      add(blockers, 'invalid_run_scope', runId, key);
    }
    seen.add(key);
    scopeOrdinals.set(runId, seen);
  }

  const attachmentOrdinals = new Map<string, Set<string>>();
  for (const attachment of attachmentRows) {
    const runId = validId(attachment.run_id) ? attachment.run_id : 'invalid-run';
    const ordinal = legacyTargetSafeInteger(attachment.ordinal);
    const ordinalKey = ordinal?.toString() ?? 'invalid';
    const hash = typeof attachment.content_hash === 'string' ? attachment.content_hash : '';
    const seen = attachmentOrdinals.get(runId) ?? new Set<string>();
    if (
      !runs.has(runId) ||
      ordinal === null ||
      ordinal < 0 ||
      seen.has(ordinalKey) ||
      !SHA256_PATTERN.test(hash) ||
      typeof attachment.mime_type !== 'string' ||
      attachment.mime_type.length === 0 ||
      !ImportedRunAttachmentRoleSchema.safeParse(attachment.role).success
    ) {
      add(blockers, 'invalid_run_attachment', runId, ordinalKey);
    } else if (!verifiedMediaHashes.has(hash)) {
      add(blockers, 'unverified_run_attachment', runId, hash);
    }
    seen.add(ordinalKey);
    attachmentOrdinals.set(runId, seen);
  }

  blockers.sort(
    (left, right) =>
      compareText(left.runId, right.runId) ||
      compareText(left.kind, right.kind) ||
      compareText(left.detailId ?? '', right.detailId ?? ''),
  );
  const sourceFingerprint = hashCanonical({
    runs: runRows.map(rowFingerprint),
    events: eventRows.map(rowFingerprint),
    scopes: scopeRows.map(rowFingerprint),
    attachments: attachmentRows.map(rowFingerprint),
  });
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-run-history-preflight/v1' as const,
    counts: {
      runs: runRows.length,
      events: eventRows.length,
      scopes: scopeRows.length,
      attachments: attachmentRows.length,
    },
    sourceFingerprint,
    blockers,
  };
  return {
    ...withoutFingerprint,
    fingerprint: hashCanonical(withoutFingerprint),
    ok: blockers.length === 0,
  };
}
