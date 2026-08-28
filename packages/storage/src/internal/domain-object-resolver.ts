import {
  DomainObjectRefSchema,
  EntityIdSchema,
  parseCanonical,
  type DomainObjectAuthority,
  type DomainObjectRef,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';

interface ResolvedRow {
  project_id: string;
  revision: number;
  content_hash: string;
}

function queryFor(authority: DomainObjectAuthority): string {
  switch (authority) {
    case 'project':
      return 'SELECT id AS project_id, revision, content_hash FROM projects WHERE id = ?';
    case 'project_media_ref':
      return 'SELECT project_id, revision, content_hash FROM project_media_refs WHERE id = ?';
    case 'media_derivation_attempt':
      return `SELECT derivation.project_id, attempt.revision, attempt.content_hash
              FROM media_derivation_attempts AS attempt
              JOIN media_derivations AS derivation ON derivation.id = attempt.derivation_id
              WHERE attempt.id = ?`;
    case 'production':
      return 'SELECT project_id, revision, content_hash FROM production_objects WHERE id = ?';
    case 'canvas':
      return 'SELECT project_id, revision, content_hash FROM canvas_documents WHERE id = ?';
    case 'generation_attempt':
      return `SELECT request.project_id, attempt.revision, attempt.content_hash
              FROM generation_attempts AS attempt
              JOIN generation_requests AS request ON request.id = attempt.request_id
              WHERE attempt.id = ?`;
    case 'generated_result':
      return 'SELECT project_id, revision, content_hash FROM generated_results WHERE id = ?';
    case 'result_assessment_attempt':
      return 'SELECT project_id, revision, content_hash FROM result_assessment_attempts WHERE id = ?';
    case 'delivery':
      return 'SELECT project_id, revision, content_hash FROM delivery_plans WHERE id = ?';
    case 'delivery_manifest':
      return 'SELECT project_id, revision, content_hash FROM delivery_manifests WHERE id = ?';
    case 'review_cut_attempt':
      return 'SELECT project_id, revision, content_hash FROM review_cut_attempts WHERE id = ?';
    case 'delivery_export':
      return 'SELECT project_id, revision, content_hash FROM delivery_exports WHERE id = ?';
  }
}

export interface ResolvedDomainObject {
  readonly projectId: string;
  readonly ref: DomainObjectRef;
}

export function resolveCurrentDomainObject(
  database: DatabaseSync,
  authority: DomainObjectAuthority,
  idInput: string,
): ResolvedDomainObject {
  const id = parseCanonical(EntityIdSchema, idInput);
  const row = database.prepare(queryFor(authority)).get(id) as unknown as ResolvedRow | undefined;
  if (row === undefined) {
    throw new StorageError('NOT_FOUND', `${authority}:${id} was not found`);
  }
  return {
    projectId: row.project_id,
    ref: parseCanonical(DomainObjectRefSchema, {
      authority,
      id,
      revision: row.revision,
      contentHash: row.content_hash,
    }),
  };
}

export function requireCurrentDomainObject(
  database: DatabaseSync,
  projectId: string,
  expectedInput: DomainObjectRef,
): ResolvedDomainObject {
  const expected = parseCanonical(DomainObjectRefSchema, expectedInput);
  const current = resolveCurrentDomainObject(database, expected.authority, expected.id);
  if (current.projectId !== projectId) {
    throw new StorageError(
      'INVALID_REQUEST',
      `${expected.authority}:${expected.id} belongs to another Project`,
    );
  }
  if (
    current.ref.revision !== expected.revision ||
    current.ref.contentHash !== expected.contentHash
  ) {
    throw new StorageError(
      'REVISION_CONFLICT',
      `${expected.authority}:${expected.id} no longer matches`,
    );
  }
  return current;
}
