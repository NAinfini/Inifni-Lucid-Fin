import {
  EntityIdSchema,
  IsoTimestampSchema,
  ProjectSearchDocumentStateSchema,
  ProjectSearchSourceV1Schema,
  parseCanonical,
  type ProjectSearchSourceV1,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import { encodeProjectSearchSource } from './canonical-codecs.js';
import type { StorageEnvironment } from './environment.js';

interface SearchDocumentRow {
  search_document_id: number;
  search_text: string;
}

export type ProjectSearchSourceState = 'current' | 'historical';

export function projectSearchSourceIdentity(source: ProjectSearchSourceV1): {
  readonly kind: ProjectSearchSourceV1['kind'];
  readonly id: string;
  readonly revision: number | null;
  readonly hash: string;
} {
  if (source.kind === 'message') {
    return {
      kind: source.kind,
      id: source.messageId,
      revision: null,
      hash: source.contentHash,
    };
  }
  return {
    kind: source.kind,
    id: source.ref.id,
    revision: source.ref.revision,
    hash: source.ref.contentHash,
  };
}

function deleteFtsRow(database: DatabaseSync, row: SearchDocumentRow): void {
  database
    .prepare(
      `INSERT INTO project_search_fts (project_search_fts, rowid, search_text)
       VALUES ('delete', ?, ?)`,
    )
    .run(row.search_document_id, row.search_text);
}

export function deleteProjectSearchDocument(
  database: DatabaseSync,
  projectIdInput: string,
  sourceInput: ProjectSearchSourceV1,
): void {
  const projectId = parseCanonical(EntityIdSchema, projectIdInput);
  const source = parseCanonical(ProjectSearchSourceV1Schema, sourceInput);
  const identity = projectSearchSourceIdentity(source);
  const existing = database
    .prepare(
      `SELECT search_document_id, search_text
       FROM project_search_documents
       WHERE project_id = ? AND source_kind = ? AND source_id = ?`,
    )
    .get(projectId, identity.kind, identity.id) as unknown as SearchDocumentRow | undefined;
  if (existing === undefined) return;

  deleteFtsRow(database, existing);
  database
    .prepare('DELETE FROM project_search_documents WHERE search_document_id = ?')
    .run(existing.search_document_id);
}

export function upsertProjectSearchDocument(
  database: DatabaseSync,
  environment: StorageEnvironment,
  projectIdInput: string,
  sourceInput: ProjectSearchSourceV1,
  sourceStateInput: ProjectSearchSourceState,
  searchText: string,
  updatedAtInput: string,
  newDocumentIdInput?: string,
): void {
  const projectId = parseCanonical(EntityIdSchema, projectIdInput);
  const source = parseCanonical(ProjectSearchSourceV1Schema, sourceInput);
  const sourceState = parseCanonical(ProjectSearchDocumentStateSchema, sourceStateInput);
  const updatedAt = parseCanonical(IsoTimestampSchema, updatedAtInput);
  const identity = projectSearchSourceIdentity(source);
  if (searchText.length === 0) {
    deleteProjectSearchDocument(database, projectId, source);
    return;
  }
  if (searchText.length > 200_000) {
    throw new StorageError('INVALID_REQUEST', 'Project search text exceeds its limit');
  }

  const existing = database
    .prepare(
      `SELECT search_document_id, search_text
       FROM project_search_documents
       WHERE project_id = ? AND source_kind = ? AND source_id = ?`,
    )
    .get(projectId, identity.kind, identity.id) as unknown as SearchDocumentRow | undefined;
  const sourceJson = encodeProjectSearchSource(source);

  if (existing === undefined) {
    const id = parseCanonical(
      EntityIdSchema,
      newDocumentIdInput ?? environment.createId('project_search_document'),
    );
    database
      .prepare(
        `INSERT INTO project_search_documents (
           id, project_id, source_kind, source_id, source_revision, source_hash, source_state,
           source_v1_json, search_text, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        identity.kind,
        identity.id,
        identity.revision,
        identity.hash,
        sourceState,
        sourceJson,
        searchText,
        updatedAt,
      );
    const inserted = database
      .prepare(
        `SELECT search_document_id, search_text
         FROM project_search_documents
         WHERE project_id = ? AND source_kind = ? AND source_id = ?`,
      )
      .get(projectId, identity.kind, identity.id) as unknown as SearchDocumentRow | undefined;
    if (inserted === undefined) {
      throw new StorageError('CORRUPT_DATA', 'Project search insert was not visible');
    }
    database
      .prepare('INSERT INTO project_search_fts (rowid, search_text) VALUES (?, ?)')
      .run(inserted.search_document_id, searchText);
    return;
  }

  deleteFtsRow(database, existing);
  database
    .prepare(
      `UPDATE project_search_documents
       SET source_revision = ?, source_hash = ?, source_state = ?, source_v1_json = ?,
           search_text = ?, updated_at = ?
       WHERE search_document_id = ?`,
    )
    .run(
      identity.revision,
      identity.hash,
      sourceState,
      sourceJson,
      searchText,
      updatedAt,
      existing.search_document_id,
    );
  database
    .prepare('INSERT INTO project_search_fts (rowid, search_text) VALUES (?, ?)')
    .run(existing.search_document_id, searchText);
}

export function updateChatMessageSearchState(
  database: DatabaseSync,
  projectIdInput: string,
  chatIdInput: string,
  sourceStateInput: ProjectSearchSourceState,
  updatedAtInput: string,
): void {
  const projectId = parseCanonical(EntityIdSchema, projectIdInput);
  const chatId = parseCanonical(EntityIdSchema, chatIdInput);
  const sourceState = parseCanonical(ProjectSearchDocumentStateSchema, sourceStateInput);
  const updatedAt = parseCanonical(IsoTimestampSchema, updatedAtInput);
  database
    .prepare(
      `UPDATE project_search_documents
       SET source_state = ?, updated_at = ?
       WHERE project_id = ?
         AND source_kind = 'message'
         AND json_extract(source_v1_json, '$.chatId') = ?`,
    )
    .run(sourceState, updatedAt, projectId, chatId);
}
