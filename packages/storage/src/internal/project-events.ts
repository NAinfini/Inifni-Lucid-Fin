import {
  ActorSchema,
  CausationRefSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  ProjectEventPayloadSchema,
  ProjectEventSchema,
  ProjectEventSubjectSchema,
  SequenceSchema,
  Sha256Schema,
  parseCanonical,
  strictObject,
  type CausationRef,
  type ProjectEvent,
  type ProjectEventPayload,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { encodeProjectEventPayload } from './canonical-codecs.js';
import { causationColumns } from './causation.js';
import { hashCanonical, hashProjectEventEnvelope } from './hashes.js';

const AppendProjectEventInputSchema = strictObject({
  eventId: EntityIdSchema,
  projectId: EntityIdSchema,
  occurredAt: IsoTimestampSchema,
  actor: ActorSchema,
  subject: ProjectEventSubjectSchema,
  causation: CausationRefSchema,
  correlationId: EntityIdSchema,
  idempotencyKey: EntityIdSchema,
  payload: ProjectEventPayloadSchema,
});

export interface AppendProjectEventInput {
  readonly eventId: string;
  readonly projectId: string;
  readonly occurredAt: string;
  readonly actor: ProjectEvent['actor'];
  readonly subject: ProjectEvent['subject'];
  readonly causation: CausationRef;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payload: ProjectEventPayload;
}

interface ProjectEventHeadRow {
  sequence: number;
  event_hash: string;
}

export function appendProjectEvent(
  database: DatabaseSync,
  inputValue: AppendProjectEventInput,
): ProjectEvent {
  const input = parseCanonical(AppendProjectEventInputSchema, inputValue);
  const head = database
    .prepare(
      `SELECT sequence, event_hash
       FROM project_events
       WHERE project_id = ?
       ORDER BY sequence DESC
       LIMIT 1`,
    )
    .get(input.projectId) as unknown as ProjectEventHeadRow | undefined;
  const sequence = parseCanonical(SequenceSchema, (head?.sequence ?? 0) + 1);
  const previousEventHash =
    head === undefined ? null : parseCanonical(Sha256Schema, head.event_hash);
  const payloadHash = hashCanonical(input.payload);
  const eventWithoutHash: Omit<ProjectEvent, 'eventHash'> = {
    authority: 'project_event',
    id: input.eventId,
    projectId: input.projectId,
    sequence,
    eventVersion: 1,
    eventType: input.payload.type,
    occurredAt: input.occurredAt,
    actor: input.actor,
    subject: input.subject,
    causation: input.causation,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    payloadHash,
    payloadState: { state: 'available', payload: input.payload },
    previousEventHash,
  };
  const event = parseCanonical(ProjectEventSchema, {
    ...eventWithoutHash,
    eventHash: hashProjectEventEnvelope(eventWithoutHash),
  });
  const [causationKind, causationId] = causationColumns(event.causation);
  database
    .prepare(
      `INSERT INTO project_events (
         id, project_id, sequence, event_version, event_type, occurred_at, actor,
         subject_authority, subject_id, causation_kind, causation_id, correlation_id,
         idempotency_key, payload_hash, previous_event_hash, event_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.id,
      event.projectId,
      event.sequence,
      event.eventVersion,
      event.eventType,
      event.occurredAt,
      event.actor,
      event.subject.authority,
      event.subject.id,
      causationKind,
      causationId,
      event.correlationId,
      event.idempotencyKey,
      event.payloadHash,
      event.previousEventHash,
      event.eventHash,
    );
  database
    .prepare(
      `INSERT INTO project_event_payloads (project_event_id, payload_v1_json, erased_at)
       VALUES (?, ?, NULL)`,
    )
    .run(event.id, encodeProjectEventPayload(input.payload));
  return event;
}
