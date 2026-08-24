import {
  ActorSchema,
  CausationRefSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  ModelSurfaceRunEventPayloadSchema,
  ModelSurfaceRunEventSchema,
  PublicRunEventPayloadSchema,
  PublicRunEventSchema,
  SequenceSchema,
  Sha256Schema,
  parseCanonical,
  strictObject,
  z,
  type PublicRunEvent,
  type RunEvent,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import {
  decodeCausationRef,
  decodeModelSurfaceRunEventPayload,
  decodePublicRunEventPayload,
  encodeCausationRef,
  encodeRunEventPayload,
} from './canonical-codecs.js';
import { hashCanonical, hashRunEventEnvelope } from './hashes.js';

const RunEventDraftCommonShape = {
  eventId: EntityIdSchema,
  occurredAt: IsoTimestampSchema,
  actor: ActorSchema,
  causation: CausationRefSchema,
  correlationId: EntityIdSchema.nullable(),
} as const;
const RunEventDraftSchema = z.union([
  strictObject({
    ...RunEventDraftCommonShape,
    visibility: z.literal('public'),
    payload: PublicRunEventPayloadSchema,
  }),
  strictObject({
    ...RunEventDraftCommonShape,
    visibility: z.literal('model_surface'),
    payload: ModelSurfaceRunEventPayloadSchema,
  }),
]);
const AppendRunEventBatchInputSchema = strictObject({
  runId: EntityIdSchema,
  commandId: EntityIdSchema,
  events: z.array(RunEventDraftSchema).min(1).max(100),
}).superRefine(({ events }, context) => {
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.eventId)) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'RunEvent IDs must be unique',
      });
    }
    ids.add(event.eventId);
  }
});

export type AppendRunEventBatchInput = z.output<typeof AppendRunEventBatchInputSchema>;

interface RunEventRow {
  id: string;
  run_id: string;
  sequence: number;
  event_version: number;
  surface: 'public' | 'model_surface';
  occurred_at: string;
  actor: RunEvent['actor'];
  causation_v1_json: string;
  correlation_id: string | null;
  idempotency_key: string | null;
  payload_hash: string;
  previous_event_hash: string | null;
  event_hash: string;
}

interface PayloadStateRow {
  payload_v1_json: string | null;
  payload_hash: string;
  redacted: number;
  erased_at: string | null;
}

interface PublicPayloadRow extends PayloadStateRow {
  payload_v1_json: string | null;
}

export interface RunEventHead {
  readonly eventId: string;
  readonly sequence: number;
  readonly eventHash: string;
}

function corrupt(message: string): TargetStorageError {
  return new TargetStorageError('CORRUPT_DATA', message);
}

function requireRun(database: DatabaseSync, runId: string): void {
  if (database.prepare('SELECT 1 FROM runs WHERE id = ?').get(runId) === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Run was not found: ${runId}`);
  }
}

function idempotencyKey(runId: string, commandId: string, ordinal: number): string {
  return `run-event.${ordinal}.${hashCanonical({ commandId, runId })}`;
}

export function loadPublicRunEventForCommand(
  database: DatabaseSync,
  runIdValue: string,
  commandIdValue: string,
  ordinal = 0,
): PublicRunEvent | undefined {
  const event = loadRunEventForCommand(database, runIdValue, commandIdValue, ordinal);
  if (event === undefined) return undefined;
  if (event.visibility !== 'public') {
    throw corrupt(`RunEvent command ${commandIdValue} does not identify a public event`);
  }
  return event;
}

export function loadRunEventForCommand(
  database: DatabaseSync,
  runIdValue: string,
  commandIdValue: string,
  ordinal = 0,
): RunEvent | undefined {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  const commandId = parseCanonical(EntityIdSchema, commandIdValue);
  const row = database
    .prepare('SELECT id, surface FROM run_events WHERE run_id = ? AND idempotency_key = ?')
    .get(runId, idempotencyKey(runId, commandId, ordinal)) as unknown as
    { id: string; surface: 'public' | 'model_surface' } | undefined;
  if (row === undefined) return undefined;
  const event = loadRunEvents(database, runId).find(({ eventId }) => eventId === row.id);
  if (event === undefined) throw corrupt(`RunEvent command ${commandId} could not be loaded`);
  if (event.visibility !== row.surface) {
    throw corrupt(`RunEvent command ${commandId} surface does not match its row`);
  }
  return event;
}

function envelopeFromRow(row: RunEventRow): Omit<RunEvent, 'payloadState'> {
  const envelope = {
    visibility: row.surface,
    eventId: parseCanonical(EntityIdSchema, row.id),
    eventVersion: row.event_version,
    runId: parseCanonical(EntityIdSchema, row.run_id),
    sequence: parseCanonical(SequenceSchema, row.sequence),
    occurredAt: parseCanonical(IsoTimestampSchema, row.occurred_at),
    actor: parseCanonical(ActorSchema, row.actor),
    causation: decodeCausationRef(row.causation_v1_json),
    correlationId:
      row.correlation_id === null ? null : parseCanonical(EntityIdSchema, row.correlation_id),
    idempotencyKey:
      row.idempotency_key === null ? null : parseCanonical(EntityIdSchema, row.idempotency_key),
    payloadHash: parseCanonical(Sha256Schema, row.payload_hash),
    previousEventHash:
      row.previous_event_hash === null
        ? null
        : parseCanonical(Sha256Schema, row.previous_event_hash),
    eventHash: parseCanonical(Sha256Schema, row.event_hash),
  } as Omit<RunEvent, 'payloadState'>;
  if (encodeCausationRef(envelope.causation) !== row.causation_v1_json) {
    throw corrupt(`RunEvent ${row.id} causation is not canonical`);
  }
  if (
    hashRunEventEnvelope({
      ...envelope,
      payloadState: { state: 'redacted', erasedAt: row.occurred_at },
    } as RunEvent) !== envelope.eventHash
  ) {
    throw corrupt(`RunEvent ${row.id} envelope hash does not match`);
  }
  return envelope;
}

function loadEnvelopeRows(database: DatabaseSync, runId: string): RunEventRow[] {
  requireRun(database, runId);
  const rows = database
    .prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY sequence')
    .all(runId) as unknown as RunEventRow[];
  let previous: Omit<RunEvent, 'payloadState'> | undefined;
  for (const row of rows) {
    const event = envelopeFromRow(row);
    if (
      event.sequence !== (previous?.sequence ?? 0) + 1 ||
      event.previousEventHash !== (previous?.eventHash ?? null)
    ) {
      throw corrupt(`Run ${runId} event chain is not contiguous`);
    }
    const payload = database
      .prepare(
        `SELECT payload_v1_json, payload_hash, payload_v1_json IS NULL AS redacted, erased_at
         FROM run_event_payloads WHERE run_event_id = ?`,
      )
      .get(event.eventId) as unknown as PayloadStateRow | undefined;
    if (payload === undefined || payload.payload_hash !== event.payloadHash) {
      throw corrupt(`RunEvent ${event.eventId} payload row does not match its envelope`);
    }
    if ((payload.redacted === 1) !== (payload.erased_at !== null)) {
      throw corrupt(`RunEvent ${event.eventId} payload state is inconsistent`);
    }
    if (payload.erased_at !== null) parseCanonical(IsoTimestampSchema, payload.erased_at);
    if (payload.payload_v1_json !== null) {
      if (event.visibility === 'public') {
        const decoded = decodePublicRunEventPayload(payload.payload_v1_json);
        if (
          encodeRunEventPayload('public', decoded) !== payload.payload_v1_json ||
          hashCanonical(decoded) !== event.payloadHash
        ) {
          throw corrupt(`RunEvent ${event.eventId} payload is not canonical or does not match`);
        }
      } else {
        const decoded = decodeModelSurfaceRunEventPayload(payload.payload_v1_json);
        if (
          encodeRunEventPayload('model_surface', decoded) !== payload.payload_v1_json ||
          hashCanonical(decoded) !== event.payloadHash
        ) {
          throw corrupt(`RunEvent ${event.eventId} payload is not canonical or does not match`);
        }
      }
    }
    previous = event;
  }
  return rows;
}

export function loadRunEventHead(database: DatabaseSync, runId: string): RunEventHead | null {
  const rows = loadEnvelopeRows(database, runId);
  const last = rows.at(-1);
  return last === undefined
    ? null
    : { eventId: last.id, sequence: last.sequence, eventHash: last.event_hash };
}

export function loadRunEvents(database: DatabaseSync, runId: string): RunEvent[] {
  return loadEnvelopeRows(database, runId).map((row) => {
    const envelope = envelopeFromRow(row);
    const payload = database
      .prepare(
        `SELECT payload_v1_json, payload_hash, payload_v1_json IS NULL AS redacted, erased_at
           FROM run_event_payloads WHERE run_event_id = ?`,
      )
      .get(row.id) as unknown as PublicPayloadRow;
    const payloadState =
      payload.redacted === 1
        ? {
            state: 'redacted' as const,
            erasedAt: parseCanonical(IsoTimestampSchema, payload.erased_at),
          }
        : {
            state: 'available' as const,
            payload:
              envelope.visibility === 'public'
                ? decodePublicRunEventPayload(payload.payload_v1_json!)
                : decodeModelSurfaceRunEventPayload(payload.payload_v1_json!),
          };
    if (
      payloadState.state === 'available' &&
      hashCanonical(payloadState.payload) !== envelope.payloadHash
    ) {
      throw corrupt(`RunEvent ${row.id} payload hash does not match`);
    }
    return parseCanonical(
      envelope.visibility === 'public' ? PublicRunEventSchema : ModelSurfaceRunEventSchema,
      { ...envelope, payloadState },
    );
  });
}

export function loadPublicRunEvents(database: DatabaseSync, runId: string): PublicRunEvent[] {
  return loadRunEvents(database, runId).filter(
    (event): event is PublicRunEvent => event.visibility === 'public',
  );
}

export function appendRunEventBatch(
  database: DatabaseSync,
  inputValue: AppendRunEventBatchInput,
): RunEvent[] {
  if (!database.isTransaction) {
    throw new TargetStorageError('INVALID_REQUEST', 'RunJournal append requires a transaction');
  }
  const input = parseCanonical(AppendRunEventBatchInputSchema, inputValue);
  const rows = loadEnvelopeRows(database, input.runId);
  let sequence = rows.at(-1)?.sequence ?? 0;
  let previousEventHash = rows.at(-1)?.event_hash ?? null;
  const appended: RunEvent[] = [];

  for (const [ordinal, draft] of input.events.entries()) {
    const key = idempotencyKey(input.runId, input.commandId, ordinal);
    if (
      database
        .prepare('SELECT 1 FROM run_events WHERE run_id = ? AND idempotency_key = ?')
        .get(input.runId, key) !== undefined
    ) {
      throw new TargetStorageError(
        'IDEMPOTENCY_CONFLICT',
        `RunEvent command was already appended: ${input.commandId}`,
      );
    }
    sequence = parseCanonical(SequenceSchema, sequence + 1);
    const payloadHash = hashCanonical(draft.payload);
    const eventWithoutHash = {
      visibility: draft.visibility,
      eventId: draft.eventId,
      eventVersion: 1,
      runId: input.runId,
      sequence,
      occurredAt: draft.occurredAt,
      actor: draft.actor,
      causation: draft.causation,
      correlationId: draft.correlationId,
      idempotencyKey: key,
      payloadHash,
      payloadState: { state: 'available' as const, payload: draft.payload },
      previousEventHash,
    };
    const event = parseCanonical(
      draft.visibility === 'public' ? PublicRunEventSchema : ModelSurfaceRunEventSchema,
      { ...eventWithoutHash, eventHash: hashRunEventEnvelope(eventWithoutHash as RunEvent) },
    ) as RunEvent;
    database
      .prepare(
        `INSERT INTO run_events (
           id, run_id, sequence, event_version, surface, occurred_at, actor,
           causation_v1_json, correlation_id, idempotency_key, payload_hash,
           previous_event_hash, event_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        event.runId,
        event.sequence,
        event.eventVersion,
        event.visibility,
        event.occurredAt,
        event.actor,
        encodeCausationRef(event.causation),
        event.correlationId,
        event.idempotencyKey,
        event.payloadHash,
        event.previousEventHash,
        event.eventHash,
      );
    const payloadJson =
      draft.visibility === 'public'
        ? encodeRunEventPayload('public', draft.payload)
        : encodeRunEventPayload('model_surface', draft.payload);
    database
      .prepare(
        `INSERT INTO run_event_payloads (
           run_event_id, payload_v1_json, payload_hash, erased_at
         ) VALUES (?, ?, ?, NULL)`,
      )
      .run(event.eventId, payloadJson, event.payloadHash);
    appended.push(event);
    previousEventHash = event.eventHash;
  }
  return appended;
}
