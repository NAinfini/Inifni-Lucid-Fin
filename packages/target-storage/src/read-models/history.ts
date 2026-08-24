import {
  CausationRefSchema,
  CountSchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  HistoryQueryDefinition,
  IsoTimestampSchema,
  MessageBlockSchema,
  ProjectEventHistoryEntryViewSchema,
  ProjectEventPayloadSchema,
  ProjectEventSubjectSchema,
  ProjectHistoryEntryViewSchema,
  PublicRunEventPayloadSchema,
  SequenceSchema,
  Sha256Schema,
  UserChoiceDetailSchema,
  UserChoiceSubjectSchema,
  canonicalJson,
  parseCanonical,
  z,
  strictObject,
  type ProjectHistoryEntryView,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { causationFromColumns } from '../internal/causation.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { hashCanonical } from '../internal/hashes.js';
import { loadPublicRunEvents } from '../internal/run-journal.js';
import { TargetStorageError } from '../kernel/errors.js';
import type { TargetStore } from '../kernel/store.js';

type HistoryQueryInput = ReturnType<typeof HistoryQueryDefinition.parseInput>;
type HistoryQueryOutput = ReturnType<typeof HistoryQueryDefinition.parseSuccess>;

const MessageBlocksSchema = z.array(MessageBlockSchema).min(1).max(1_000);
const HistoryCursorSchema = strictObject({
  kind: z.literal('project_history'),
  filterHash: Sha256Schema,
  occurredAt: IsoTimestampSchema,
  sourcePriority: CountSchema,
  stableKey: z.string().min(1).max(600),
});

const sourcePriority = Object.freeze({
  message: 0,
  run_event: 1,
  project_event: 2,
  generated_result: 3,
  user_choice: 4,
} satisfies Record<ProjectHistoryEntryView['source'], number>);

interface MessageRow {
  id: string;
  project_id: string;
  chat_id: string;
  sequence: number;
  role: 'user' | 'assistant';
  content_hash: string;
  created_at: string;
  blocks_v1_json: string | null;
  payload_hash: string;
  erased_at: string | null;
}

interface ProjectEventRow {
  id: string;
  sequence: number;
  event_version: number;
  event_type: string;
  occurred_at: string;
  actor: string;
  subject_authority: string;
  subject_id: string;
  causation_kind: string;
  causation_id: string;
  correlation_id: string;
  payload_hash: string;
  payload_v1_json: string | null;
  erased_at: string | null;
  previous_event_hash: string | null;
  event_hash: string;
}

interface GeneratedResultRow {
  id: string;
  run_id: string;
  revision: number;
  content_hash: string;
  media_kind: string;
  variant_index: number;
  created_at: string;
}

interface UserChoiceRow {
  id: string;
  actor: string;
  subject_v1_json: string;
  choice_v1_json: string;
  causation_v1_json: string;
  created_at: string;
}

interface HistorySortKey {
  readonly occurredAt: string;
  readonly sourcePriority: number;
  readonly stableKey: string;
}

function corrupt(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'CORRUPT_DATA',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function decodeJson<Schema extends z.ZodType>(
  label: string,
  schema: Schema,
  json: string,
): z.output<Schema> {
  try {
    return parseCanonical(schema, JSON.parse(json));
  } catch (cause) {
    throw corrupt(`${label} is invalid`, cause);
  }
}

function requireProject(database: DatabaseSync, projectIdValue: string): string {
  const projectId = parseCanonical(EntityIdSchema, projectIdValue);
  if (database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId) === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Project was not found: ${projectId}`);
  }
  return projectId;
}

function boundedCanonicalSummary(value: unknown, identity: unknown): string {
  const summary = canonicalJson(value);
  return summary.length <= 20_000 ? summary : canonicalJson(identity);
}

function summaryForPublicRunPayload(
  payload: z.output<typeof PublicRunEventPayloadSchema>,
  eventId: string,
): string {
  const candidate =
    'summary' in payload
      ? payload.summary
      : 'prompt' in payload
        ? payload.prompt
        : 'message' in payload
          ? payload.message
          : canonicalJson(payload);
  return candidate.length <= 20_000
    ? candidate
    : canonicalJson({ eventId, payloadHash: hashCanonical(payload) });
}

function messageEntries(database: DatabaseSync, projectId: string): ProjectHistoryEntryView[] {
  const rows = database
    .prepare(
      `SELECT m.id, m.project_id, m.chat_id, m.sequence, m.role, m.content_hash, m.created_at,
              payload.blocks_v1_json, payload.payload_hash, payload.erased_at
       FROM messages AS m
       JOIN message_payloads AS payload ON payload.message_id = m.id
       WHERE m.project_id = ?`,
    )
    .all(projectId) as unknown as MessageRow[];
  return rows.map((row) => {
    let summary = canonicalJson({ contentHash: row.content_hash });
    if (row.blocks_v1_json !== null && row.erased_at === null) {
      const blocks = decodeJson(
        `Message ${row.id} blocks`,
        MessageBlocksSchema,
        row.blocks_v1_json,
      );
      if (hashCanonical(blocks) !== row.payload_hash) {
        throw corrupt(`Message ${row.id} payload hash does not match`);
      }
      summary = boundedCanonicalSummary(blocks, { contentHash: row.content_hash });
    }
    return parseCanonical(ProjectHistoryEntryViewSchema, {
      projectId: row.project_id,
      source: 'message',
      messageId: row.id,
      chatId: row.chat_id,
      sequence: row.sequence,
      role: row.role,
      contentHash: row.content_hash,
      occurredAt: row.created_at,
      summary,
    });
  });
}

function runEventEntries(database: DatabaseSync, projectId: string): ProjectHistoryEntryView[] {
  const runIds = database
    .prepare('SELECT id FROM runs WHERE project_id = ? ORDER BY id')
    .all(projectId) as unknown as Array<{ id: string }>;
  return runIds.flatMap(({ id: runId }) =>
    loadPublicRunEvents(database, runId).map((event) =>
      parseCanonical(ProjectHistoryEntryViewSchema, {
        projectId,
        source: 'run_event',
        runId,
        eventId: event.eventId,
        sequence: event.sequence,
        actor: event.actor,
        causation: event.causation,
        eventHash: event.eventHash,
        occurredAt: event.occurredAt,
        summary:
          event.payloadState.state === 'available'
            ? summaryForPublicRunPayload(event.payloadState.payload, event.eventId)
            : canonicalJson({ payloadHash: event.payloadHash }),
      }),
    ),
  );
}

function projectEventEntries(database: DatabaseSync, projectId: string): ProjectHistoryEntryView[] {
  const rows = database
    .prepare(
      `SELECT event.id, event.sequence, event.event_version, event.event_type, event.occurred_at,
              event.actor, event.subject_authority, event.subject_id, event.causation_kind,
              event.causation_id, event.correlation_id, event.payload_hash,
              payload.payload_v1_json, payload.erased_at, event.previous_event_hash, event.event_hash
       FROM project_events AS event
       JOIN project_event_payloads AS payload ON payload.project_event_id = event.id
       WHERE event.project_id = ?`,
    )
    .all(projectId) as unknown as ProjectEventRow[];
  return rows.map((row) => {
    const payloadState =
      row.payload_v1_json === null || row.erased_at !== null
        ? {
            state: 'redacted' as const,
            erasedAt: parseCanonical(IsoTimestampSchema, row.erased_at),
          }
        : {
            state: 'available' as const,
            payload: decodeJson(
              `ProjectEvent ${row.id} payload`,
              ProjectEventPayloadSchema,
              row.payload_v1_json,
            ),
          };
    if (
      payloadState.state === 'available' &&
      hashCanonical(payloadState.payload) !== row.payload_hash
    ) {
      throw corrupt(`ProjectEvent ${row.id} payload hash does not match`);
    }
    return parseCanonical(ProjectEventHistoryEntryViewSchema, {
      projectId,
      source: 'project_event',
      eventId: row.id,
      sequence: row.sequence,
      eventVersion: row.event_version,
      eventType: row.event_type,
      actor: row.actor,
      subject: parseCanonical(ProjectEventSubjectSchema, {
        authority: row.subject_authority,
        id: row.subject_id,
      }),
      causation: causationFromColumns(row.causation_kind, row.causation_id),
      correlationId: row.correlation_id,
      payloadHash: row.payload_hash,
      payloadState,
      previousEventHash: row.previous_event_hash,
      eventHash: row.event_hash,
      occurredAt: row.occurred_at,
      summary: boundedCanonicalSummary(payloadState, {
        eventId: row.id,
        payloadHash: row.payload_hash,
      }),
    });
  });
}

function generatedResultEntries(
  database: DatabaseSync,
  projectId: string,
): ProjectHistoryEntryView[] {
  const rows = database
    .prepare(
      `SELECT result.id, request.run_id, result.revision, result.content_hash,
              result.media_kind, result.variant_index, result.created_at
       FROM generated_results AS result
       JOIN generation_requests AS request ON request.id = result.request_id
       WHERE result.project_id = ?`,
    )
    .all(projectId) as unknown as GeneratedResultRow[];
  return rows.map((row) =>
    parseCanonical(ProjectHistoryEntryViewSchema, {
      projectId,
      source: 'generated_result',
      resultId: row.id,
      runId: row.run_id,
      revision: row.revision,
      contentHash: row.content_hash,
      occurredAt: row.created_at,
      summary: canonicalJson({
        mediaKind: row.media_kind,
        variantIndex: row.variant_index,
      }),
    }),
  );
}

function userChoiceEntries(database: DatabaseSync, projectId: string): ProjectHistoryEntryView[] {
  const rows = database
    .prepare(
      `SELECT id, actor, subject_v1_json, choice_v1_json, causation_v1_json, created_at
       FROM user_choices
       WHERE project_id = ?`,
    )
    .all(projectId) as unknown as UserChoiceRow[];
  return rows.map((row) => {
    const choice = decodeJson(
      `UserChoice ${row.id} detail`,
      UserChoiceDetailSchema,
      row.choice_v1_json,
    );
    return parseCanonical(ProjectHistoryEntryViewSchema, {
      projectId,
      source: 'user_choice',
      choiceId: row.id,
      actor: row.actor,
      subject: decodeJson(
        `UserChoice ${row.id} subject`,
        UserChoiceSubjectSchema,
        row.subject_v1_json,
      ),
      causation: decodeJson(
        `UserChoice ${row.id} causation`,
        CausationRefSchema,
        row.causation_v1_json,
      ),
      occurredAt: row.created_at,
      summary: boundedCanonicalSummary(choice, { choiceId: row.id }),
    });
  });
}

function stableKey(entry: ProjectHistoryEntryView): string {
  switch (entry.source) {
    case 'message':
      return canonicalJson([entry.chatId, entry.sequence, entry.messageId]);
    case 'run_event':
      return canonicalJson([entry.runId, entry.sequence, entry.eventId]);
    case 'project_event':
      return canonicalJson([entry.sequence, entry.eventId]);
    case 'generated_result':
      return canonicalJson([entry.resultId, entry.revision]);
    case 'user_choice':
      return entry.choiceId;
  }
}

function sortKey(entry: ProjectHistoryEntryView): HistorySortKey {
  return {
    occurredAt: entry.occurredAt,
    sourcePriority: sourcePriority[entry.source],
    stableKey: stableKey(entry),
  };
}

function compareKeys(left: HistorySortKey, right: HistorySortKey): number {
  return (
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.sourcePriority - right.sourcePriority ||
    left.stableKey.localeCompare(right.stableKey)
  );
}

function entryMatches(entry: ProjectHistoryEntryView, input: HistoryQueryInput): boolean {
  if (input.sources.length > 0 && !input.sources.includes(entry.source)) return false;
  if (input.time.from !== null && entry.occurredAt < input.time.from) return false;
  if (input.time.to !== null && entry.occurredAt > input.time.to) return false;
  if (
    input.eventTypes.length > 0 &&
    (entry.source !== 'project_event' || !input.eventTypes.includes(entry.eventType))
  ) {
    return false;
  }
  if (input.subjects.length > 0) {
    if (entry.source !== 'project_event' && entry.source !== 'user_choice') return false;
    if (entry.source === 'project_event') {
      if (
        !input.subjects.some(
          (subject) =>
            subject.authority === entry.subject.authority && subject.id === entry.subject.id,
        )
      ) {
        return false;
      }
    } else {
      const matches = input.subjects.some((subject) => {
        switch (entry.subject.kind) {
          case 'result_decision':
            return subject.authority === 'production' && subject.id === entry.subject.shotId;
          case 'protection':
            return entry.subject.field.owner === 'production'
              ? subject.authority === 'production' && subject.id === entry.subject.field.objectId
              : subject.authority === 'delivery' && subject.id === entry.subject.field.deliveryId;
          case 'delivery':
            return subject.authority === 'delivery' && subject.id === entry.subject.deliveryId;
        }
      });
      if (!matches) return false;
    }
  }
  if (input.actors.length > 0) {
    if (
      entry.source !== 'run_event' &&
      entry.source !== 'project_event' &&
      entry.source !== 'user_choice'
    ) {
      return false;
    }
    if (!input.actors.includes(entry.actor)) return false;
  }
  return true;
}

function encodeCursor(filterHash: string, entry: ProjectHistoryEntryView): string {
  const key = sortKey(entry);
  return `cur_${Buffer.from(
    canonicalJson({ kind: 'project_history', filterHash, ...key }),
    'utf8',
  ).toString('base64url')}`;
}

function decodeCursor(cursor: string): z.output<typeof HistoryCursorSchema> {
  try {
    return parseCanonical(
      HistoryCursorSchema,
      JSON.parse(Buffer.from(cursor.slice(4), 'base64url').toString('utf8')),
    );
  } catch (cause) {
    throw new TargetStorageError('INVALID_REQUEST', 'History cursor is invalid', { cause });
  }
}

export function historyWatermark(database: DatabaseSync, projectId: string): number {
  const row = database
    .prepare(
      'SELECT COALESCE(MAX(sequence), 0) AS watermark FROM project_events WHERE project_id = ?',
    )
    .get(projectId) as unknown as { watermark: number };
  return parseCanonical(CountSchema, row.watermark);
}

export interface ProjectHistoryReadModel {
  readonly query: (projectId: string, input: HistoryQueryInput) => HistoryQueryOutput;
  readonly getWatermark: (projectId: string) => number;
}

export function createProjectHistoryReadModel(store: TargetStore): ProjectHistoryReadModel {
  return Object.freeze({
    query(projectIdValue: string, inputValue: HistoryQueryInput) {
      const input = HistoryQueryDefinition.parseInput(inputValue);
      const database = getTargetStoreDatabase(store);
      const projectId = requireProject(database, projectIdValue);
      const filterHash = hashCanonical({
        projectId,
        sources: input.sources,
        eventTypes: input.eventTypes,
        subjects: input.subjects,
        actors: input.actors,
        time: input.time,
      });
      const cursor = input.page.cursor === null ? null : decodeCursor(input.page.cursor);
      if (cursor !== null && cursor.filterHash !== filterHash) {
        throw new TargetStorageError('INVALID_REQUEST', 'History cursor belongs to another query');
      }
      const entries = [
        ...messageEntries(database, projectId),
        ...runEventEntries(database, projectId),
        ...projectEventEntries(database, projectId),
        ...generatedResultEntries(database, projectId),
        ...userChoiceEntries(database, projectId),
      ]
        .filter((entry) => entryMatches(entry, input))
        .sort((left, right) => compareKeys(sortKey(left), sortKey(right)));
      const afterCursor =
        cursor === null
          ? entries
          : entries.filter((entry) => compareKeys(sortKey(entry), cursor) > 0);
      const items = afterCursor.slice(0, input.page.limit);
      return HistoryQueryDefinition.parseSuccess({
        items,
        nextCursor:
          afterCursor.length > items.length && items.length > 0
            ? encodeCursor(filterHash, items.at(-1)!)
            : null,
      });
    },
    getWatermark(projectIdValue: string) {
      const database = getTargetStoreDatabase(store);
      return historyWatermark(database, requireProject(database, projectIdValue));
    },
  });
}
