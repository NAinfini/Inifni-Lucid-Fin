import {
  EntityIdSchema,
  ImportedHistoryEntryViewSchema,
  ImportedHistoryQueryInputSchema,
  ImportedHistoryQuerySuccessSchema,
  parseCanonical,
  type ImportedHistoryEntryView,
  type ImportedHistoryQueryInput,
  type ImportedHistoryQuerySuccess,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { TargetStorageError } from '../kernel/errors.js';
import type { TargetStore } from '../kernel/store.js';

interface ImportedRunRow {
  id: string;
  batch_id: string;
  project_id: string;
  status: string;
  accepted_at: string;
}

interface ImportedRunEventRow {
  id: string;
  batch_id: string;
  project_id: string;
  run_id: string;
  event_kind: string;
  occurred_at: string;
  private_payload_present: number;
}

interface ImportedTaskListRow {
  id: string;
  batch_id: string;
  project_id: string;
  status: string;
  updated_at: string;
}

interface ImportedTaskItemRow {
  id: string;
  batch_id: string;
  project_id: string;
  task_list_id: string;
  task_kind: string;
  status: string;
  updated_at: string;
}

interface ImportedRecordRow {
  id: string;
  batch_id: string;
  project_id: string;
  schema_id: ImportedHistoryEntryView['schemaId'];
  occurred_at: string | null;
  created_at: string;
  private_payload_present: number;
}

interface ProductionCollectionRow {
  id: string;
  import_batch_id: string;
  project_id: string;
  updated_at: string;
}

function requireProject(database: DatabaseSync, projectIdValue: string): string {
  const projectId = parseCanonical(EntityIdSchema, projectIdValue);
  if (database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId) === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Project was not found: ${projectId}`);
  }
  return projectId;
}

function sourcesInclude(
  input: ImportedHistoryQueryInput,
  source: ImportedHistoryEntryView['source'],
): boolean {
  return input.sources.length === 0 || input.sources.includes(source);
}

function matchesIds(values: readonly string[], value: string): boolean {
  return values.length === 0 || values.includes(value);
}

function sortEntries(left: ImportedHistoryEntryView, right: ImportedHistoryEntryView): number {
  return (
    left.occurredAt.localeCompare(right.occurredAt) ||
    left.source.localeCompare(right.source) ||
    left.entryId.localeCompare(right.entryId)
  );
}

function runEntries(
  database: DatabaseSync,
  projectId: string,
  input: ImportedHistoryQueryInput,
): ImportedHistoryEntryView[] {
  if (!sourcesInclude(input, 'imported_run')) return [];
  const rows = database
    .prepare(
      `SELECT id, batch_id, project_id, status, accepted_at
       FROM imported_run_history
       WHERE project_id = ?`,
    )
    .all(projectId) as unknown as ImportedRunRow[];
  return rows
    .filter((row) => matchesIds(input.batchIds, row.batch_id) && matchesIds(input.runIds, row.id))
    .map((row) =>
      parseCanonical(ImportedHistoryEntryViewSchema, {
        historical: true,
        readOnly: true,
        source: 'imported_run',
        entryId: row.id,
        batchId: row.batch_id,
        projectId: row.project_id,
        runId: row.id,
        taskListId: null,
        schemaId: null,
        collectionId: null,
        occurredAt: row.accepted_at,
        evidenceUnavailable: false,
        summary: `Imported Run (${row.status})`,
      }),
    );
}

function runEventEntries(
  database: DatabaseSync,
  projectId: string,
  input: ImportedHistoryQueryInput,
): ImportedHistoryEntryView[] {
  if (!sourcesInclude(input, 'imported_run_event')) return [];
  const rows = database
    .prepare(
      `SELECT event.id, event.batch_id, run.project_id, event.run_id, event.event_kind,
              event.occurred_at, event.private_payload_present
       FROM imported_run_event_history AS event
       JOIN imported_run_history AS run ON run.id = event.run_id
       WHERE run.project_id = ?`,
    )
    .all(projectId) as unknown as ImportedRunEventRow[];
  return rows
    .filter(
      (row) => matchesIds(input.batchIds, row.batch_id) && matchesIds(input.runIds, row.run_id),
    )
    .map((row) =>
      parseCanonical(ImportedHistoryEntryViewSchema, {
        historical: true,
        readOnly: true,
        source: 'imported_run_event',
        entryId: row.id,
        batchId: row.batch_id,
        projectId: row.project_id,
        runId: row.run_id,
        taskListId: null,
        schemaId: null,
        collectionId: null,
        occurredAt: row.occurred_at,
        evidenceUnavailable: row.private_payload_present === 1,
        summary: `Imported Run event (${row.event_kind})`,
      }),
    );
}

function taskListEntries(
  database: DatabaseSync,
  projectId: string,
  input: ImportedHistoryQueryInput,
): ImportedHistoryEntryView[] {
  if (!sourcesInclude(input, 'imported_task_list')) return [];
  const rows = database
    .prepare(
      `SELECT id, batch_id, project_id, status, updated_at
       FROM imported_task_list_history
       WHERE project_id = ?`,
    )
    .all(projectId) as unknown as ImportedTaskListRow[];
  return rows
    .filter(
      (row) => matchesIds(input.batchIds, row.batch_id) && matchesIds(input.taskListIds, row.id),
    )
    .map((row) =>
      parseCanonical(ImportedHistoryEntryViewSchema, {
        historical: true,
        readOnly: true,
        source: 'imported_task_list',
        entryId: row.id,
        batchId: row.batch_id,
        projectId: row.project_id,
        runId: null,
        taskListId: row.id,
        schemaId: null,
        collectionId: null,
        occurredAt: row.updated_at,
        evidenceUnavailable: false,
        summary: `Imported Task List (${row.status})`,
      }),
    );
}

function taskItemEntries(
  database: DatabaseSync,
  projectId: string,
  input: ImportedHistoryQueryInput,
): ImportedHistoryEntryView[] {
  if (!sourcesInclude(input, 'imported_task_item')) return [];
  const rows = database
    .prepare(
      `SELECT id, batch_id, project_id, task_list_id, task_kind, status, updated_at
       FROM imported_task_item_history
       WHERE project_id = ?`,
    )
    .all(projectId) as unknown as ImportedTaskItemRow[];
  return rows
    .filter(
      (row) =>
        matchesIds(input.batchIds, row.batch_id) && matchesIds(input.taskListIds, row.task_list_id),
    )
    .map((row) =>
      parseCanonical(ImportedHistoryEntryViewSchema, {
        historical: true,
        readOnly: true,
        source: 'imported_task_item',
        entryId: row.id,
        batchId: row.batch_id,
        projectId: row.project_id,
        runId: null,
        taskListId: row.task_list_id,
        schemaId: null,
        collectionId: null,
        occurredAt: row.updated_at,
        evidenceUnavailable: false,
        summary: `Imported Task (${row.task_kind}, ${row.status})`,
      }),
    );
}

function recordEntries(
  database: DatabaseSync,
  projectId: string,
  input: ImportedHistoryQueryInput,
): ImportedHistoryEntryView[] {
  if (!sourcesInclude(input, 'imported_record')) return [];
  const rows = database
    .prepare(
      `SELECT id, batch_id, project_id, schema_id, occurred_at, created_at, private_payload_present
       FROM imported_history_records
       WHERE project_id = ?`,
    )
    .all(projectId) as unknown as ImportedRecordRow[];
  return rows
    .filter((row) => matchesIds(input.batchIds, row.batch_id))
    .map((row) =>
      parseCanonical(ImportedHistoryEntryViewSchema, {
        historical: true,
        readOnly: true,
        source: 'imported_record',
        entryId: row.id,
        batchId: row.batch_id,
        projectId: row.project_id,
        runId: null,
        taskListId: null,
        schemaId: row.schema_id,
        collectionId: null,
        occurredAt: row.occurred_at ?? row.created_at,
        evidenceUnavailable: row.private_payload_present === 1,
        summary: `Imported evidence (${row.schema_id})`,
      }),
    );
}

function productionCollectionEntries(
  database: DatabaseSync,
  projectId: string,
  input: ImportedHistoryQueryInput,
): ImportedHistoryEntryView[] {
  if (!sourcesInclude(input, 'production_collection')) return [];
  const rows = database
    .prepare(
      `SELECT id, import_batch_id, project_id, updated_at
       FROM production_collections
       WHERE project_id = ?`,
    )
    .all(projectId) as unknown as ProductionCollectionRow[];
  return rows
    .filter((row) => matchesIds(input.batchIds, row.import_batch_id))
    .map((row) =>
      parseCanonical(ImportedHistoryEntryViewSchema, {
        historical: true,
        readOnly: true,
        source: 'production_collection',
        entryId: row.id,
        batchId: row.import_batch_id,
        projectId: row.project_id,
        runId: null,
        taskListId: null,
        schemaId: null,
        collectionId: row.id,
        occurredAt: row.updated_at,
        evidenceUnavailable: false,
        summary: 'Imported Production Collection',
      }),
    );
}

export interface ImportedHistoryReadModel {
  readonly query: (
    projectId: string,
    input: ImportedHistoryQueryInput,
  ) => ImportedHistoryQuerySuccess;
}

export function createImportedHistoryReadModel(store: TargetStore): ImportedHistoryReadModel {
  return Object.freeze({
    query(projectIdValue: string, inputValue: ImportedHistoryQueryInput) {
      const input = parseCanonical(ImportedHistoryQueryInputSchema, inputValue);
      const database = getTargetStoreDatabase(store);
      const projectId = requireProject(database, projectIdValue);
      const items = [
        ...runEntries(database, projectId, input),
        ...runEventEntries(database, projectId, input),
        ...taskListEntries(database, projectId, input),
        ...taskItemEntries(database, projectId, input),
        ...recordEntries(database, projectId, input),
        ...productionCollectionEntries(database, projectId, input),
      ]
        .sort(sortEntries)
        .slice(0, input.limit);
      return parseCanonical(ImportedHistoryQuerySuccessSchema, { projectId, items });
    },
  });
}
