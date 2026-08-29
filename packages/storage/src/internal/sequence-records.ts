import {
  SequenceDocumentSchema,
  SequenceItemSchema,
  parseCanonical,
  sequenceDocumentContentHashInput,
  sequenceItemContentHashInput,
  type SequenceDocument,
  type SequenceItem,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import { hashCanonical } from './hashes.js';

const ZERO_HASH = '0'.repeat(64);

interface SequenceRow {
  id: string;
  project_id: string;
  revision: number;
  content_hash: string;
  name: string;
  lifecycle: 'active' | 'archived';
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

function compareItems(left: SequenceItem, right: SequenceItem): number {
  const leftParent = left.parentItemId ?? '';
  const rightParent = right.parentItemId ?? '';
  return (
    leftParent.localeCompare(rightParent) || left.ordinal - right.ordinal || left.id.localeCompare(right.id)
  );
}

export function canonicalizeSequence(sequence: SequenceDocument): SequenceDocument {
  return { ...sequence, items: [...sequence.items].sort(compareItems) };
}

export function finalizeSequenceItem(value: Omit<SequenceItem, 'contentHash'>): SequenceItem {
  const normalized = parseCanonical(SequenceItemSchema, { ...value, contentHash: ZERO_HASH });
  return parseCanonical(SequenceItemSchema, {
    ...normalized,
    contentHash: hashCanonical(sequenceItemContentHashInput(normalized)),
  });
}

export function finalizeSequence(
  value: Omit<SequenceDocument, 'contentHash'>,
): SequenceDocument {
  const normalized = canonicalizeSequence(
    parseCanonical(SequenceDocumentSchema, { ...value, contentHash: ZERO_HASH }),
  );
  return parseCanonical(SequenceDocumentSchema, {
    ...normalized,
    contentHash: hashCanonical(sequenceDocumentContentHashInput(normalized)),
  });
}

export function createEmptySequence(
  projectId: string,
  sequenceId: string,
  name: string,
  createdAt: string,
): SequenceDocument {
  return finalizeSequence({
    authority: 'sequence',
    id: sequenceId,
    projectId,
    revision: 0,
    name,
    lifecycle: 'active',
    items: [],
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  });
}

export function sequenceRef(sequence: SequenceDocument) {
  return {
    authority: 'sequence' as const,
    id: sequence.id,
    revision: sequence.revision,
    contentHash: sequence.contentHash,
  };
}

export function insertSequence(database: DatabaseSync, sequence: SequenceDocument): void {
  database
    .prepare(
      `INSERT INTO sequence_documents (
         id, project_id, revision, content_hash, name, lifecycle, created_at, updated_at, archived_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sequence.id,
      sequence.projectId,
      sequence.revision,
      sequence.contentHash,
      sequence.name,
      sequence.lifecycle,
      sequence.createdAt,
      sequence.updatedAt,
      sequence.archivedAt,
    );
  insertSequenceItems(database, sequence);
}

function insertSequenceItems(database: DatabaseSync, sequence: SequenceDocument): void {
  const insert = database.prepare(
    `INSERT INTO sequence_items (
       id, sequence_id, kind, parent_item_id, ordinal, revision, content_hash,
       target_authority, target_id, target_revision, target_content_hash,
       trim_start_ms, trim_end_ms, audio_policy, transition_kind, transition_duration_ms,
       review_state, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of sequence.items) {
    const target =
      item.kind === 'scene' ? item.scene : item.kind === 'shot' ? item.shot : item.result;
    insert.run(
      item.id,
      sequence.id,
      item.kind,
      item.parentItemId,
      item.ordinal,
      item.revision,
      item.contentHash,
      target.authority,
      target.id,
      target.revision,
      target.contentHash,
      item.kind === 'clip' ? item.trim.startMs : null,
      item.kind === 'clip' ? item.trim.endMs : null,
      item.kind === 'clip' ? item.audioPolicy : null,
      item.kind === 'clip' ? item.transition.kind : null,
      item.kind === 'clip' ? item.transition.durationMs : null,
      item.kind === 'clip' ? item.reviewState : null,
      item.createdAt,
      item.updatedAt,
    );
  }
}

export function replaceSequence(
  database: DatabaseSync,
  before: SequenceDocument,
  after: SequenceDocument,
): void {
  const updated = database
    .prepare(
      `UPDATE sequence_documents
       SET revision = ?, content_hash = ?, name = ?, lifecycle = ?, updated_at = ?, archived_at = ?
       WHERE id = ? AND revision = ? AND content_hash = ?`,
    )
    .run(
      after.revision,
      after.contentHash,
      after.name,
      after.lifecycle,
      after.updatedAt,
      after.archivedAt,
      before.id,
      before.revision,
      before.contentHash,
    );
  if (Number(updated.changes) !== 1) {
    throw new StorageError('REVISION_CONFLICT', `Sequence ${before.id} changed concurrently`);
  }
  database.prepare('DELETE FROM sequence_items WHERE sequence_id = ?').run(before.id);
  insertSequenceItems(database, after);
}

export function loadSequenceDocument(database: DatabaseSync, sequenceId: string): SequenceDocument {
  const row = database
    .prepare('SELECT * FROM sequence_documents WHERE id = ?')
    .get(sequenceId) as unknown as SequenceRow | undefined;
  if (row === undefined) throw new StorageError('NOT_FOUND', `Sequence ${sequenceId} was not found`);
  const itemRows = database
    .prepare(
      `SELECT * FROM sequence_items
       WHERE sequence_id = ?
       ORDER BY parent_item_id, ordinal, id`,
    )
    .all(row.id) as unknown as Array<Record<string, unknown>>;
  try {
    const items = itemRows.map((item): SequenceItem => {
      const base = {
        id: item.id,
        revision: item.revision,
        contentHash: item.content_hash,
        ordinal: item.ordinal,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      };
      if (item.kind === 'scene') {
        return parseCanonical(SequenceItemSchema, {
          ...base,
          kind: 'scene',
          parentItemId: item.parent_item_id,
          scene: {
            authority: item.target_authority,
            id: item.target_id,
            revision: item.target_revision,
            contentHash: item.target_content_hash,
          },
        });
      }
      if (item.kind === 'shot') {
        return parseCanonical(SequenceItemSchema, {
          ...base,
          kind: 'shot',
          parentItemId: item.parent_item_id,
          shot: {
            authority: item.target_authority,
            id: item.target_id,
            revision: item.target_revision,
            contentHash: item.target_content_hash,
          },
        });
      }
      return parseCanonical(SequenceItemSchema, {
        ...base,
        kind: item.kind,
        parentItemId: item.parent_item_id,
        result: {
          authority: item.target_authority,
          id: item.target_id,
          revision: item.target_revision,
          contentHash: item.target_content_hash,
        },
        trim: { startMs: item.trim_start_ms, endMs: item.trim_end_ms },
        audioPolicy: item.audio_policy,
        transition: { kind: item.transition_kind, durationMs: item.transition_duration_ms },
        reviewState: item.review_state,
      });
    });
    for (const item of items) {
      if (hashCanonical(sequenceItemContentHashInput(item)) !== item.contentHash) {
        throw new StorageError('CORRUPT_DATA', `Sequence item ${item.id} content hash does not match`);
      }
    }
    const sequence = canonicalizeSequence(
      parseCanonical(SequenceDocumentSchema, {
        authority: 'sequence',
        id: row.id,
        projectId: row.project_id,
        revision: row.revision,
        contentHash: row.content_hash,
        name: row.name,
        lifecycle: row.lifecycle,
        items,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        archivedAt: row.archived_at,
      }),
    );
    if (hashCanonical(sequenceDocumentContentHashInput(sequence)) !== sequence.contentHash) {
      throw new StorageError('CORRUPT_DATA', `Sequence ${sequence.id} content hash does not match`);
    }
    return sequence;
  } catch (cause) {
    if (cause instanceof StorageError) throw cause;
    throw new StorageError('CORRUPT_DATA', `Sequence ${row.id} is invalid`, { cause });
  }
}
