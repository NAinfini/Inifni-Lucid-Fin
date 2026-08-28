import {
  EntityIdSchema,
  Sha256Schema,
  SkillDocumentSchema,
  canonicalJson,
  parseCanonical,
  strictObject,
  z,
  type SkillDocument,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import { hashUtf8 } from './hashes.js';

interface SkillRow {
  id: string;
  version: string;
  name: string;
  description: string;
  content_text: string;
  content_hash: string;
  provenance: SkillDocument['provenance'];
  trust: SkillDocument['trust'];
  project_id: string | null;
  created_by_confirmation_id: string | null;
  created_at: string;
}

export const SkillRegistrationInputSchema = strictObject({
  document: SkillDocumentSchema,
  projectId: EntityIdSchema.nullable(),
}).superRefine(({ document, projectId }, context) => {
  if ((document.provenance === 'project') !== (projectId !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['projectId'],
      message: 'Project Skills require one owner and global Skills cannot have one',
    });
  }
});

export const SkillRegistrationBatchInputSchema = strictObject({
  sourceFingerprint: Sha256Schema,
  entries: z.array(SkillRegistrationInputSchema).min(1).max(100_000),
}).superRefine(({ entries }, context) => {
  const identities = new Set<string>();
  entries.forEach(({ document }, index) => {
    const identity = `${document.skillId}\u0000${document.version}`;
    if (identities.has(identity)) {
      context.addIssue({
        code: 'custom',
        path: ['entries', index],
        message: 'Skill batch identities must be unique',
      });
    }
    identities.add(identity);
  });
});

export type SkillRegistrationInput = z.output<typeof SkillRegistrationInputSchema>;
export interface SkillRegistrationResult extends SkillRegistrationInput {
  readonly status: 'inserted' | 'unchanged';
}
export type SkillRegistrationBatchInput = z.output<typeof SkillRegistrationBatchInputSchema>;
export interface SkillRegistrationBatchResult {
  readonly sourceFingerprint: string;
  readonly results: readonly SkillRegistrationResult[];
}

export interface WriteSkillRegistrationOptions {
  readonly createdByConfirmationId: string | null;
  readonly effectiveAt: string;
  readonly allowExactExisting: boolean;
  readonly activateEffectiveVersion: boolean;
}

function corrupt(message: string, cause?: unknown): StorageError {
  return new StorageError('CORRUPT_DATA', message, cause === undefined ? undefined : { cause });
}

function conflict(message: string): StorageError {
  return new StorageError('IDEMPOTENCY_CONFLICT', message);
}

function skillFromRow(row: SkillRow): SkillDocument {
  let skill: SkillDocument;
  try {
    skill = parseCanonical(SkillDocumentSchema, {
      skillId: row.id,
      version: row.version,
      name: row.name,
      description: row.description,
      content: row.content_text,
      contentHash: row.content_hash,
      provenance: row.provenance,
      trust: row.trust,
      createdAt: row.created_at,
    });
  } catch (cause) {
    throw corrupt(`Stored Skill ${row.id}@${row.version} is invalid`, cause);
  }
  if (hashUtf8(skill.content) !== skill.contentHash) {
    throw corrupt(`Stored Skill ${row.id}@${row.version} content digest does not match`);
  }
  return skill;
}

function skillRegistrationFromRow(row: SkillRow): SkillRegistrationInput {
  return parseCanonical(SkillRegistrationInputSchema, {
    document: skillFromRow(row),
    projectId: row.project_id,
  });
}

function ensureSkillQuarantine(database: DatabaseSync, document: SkillDocument): void {
  if (document.trust !== 'unreviewed') return;
  database
    .prepare(
      `INSERT INTO skill_quarantines (skill_id, skill_version, reason)
       VALUES (?, ?, 'Unreviewed Skill content is not runtime-eligible')
       ON CONFLICT(skill_id, skill_version) DO NOTHING`,
    )
    .run(document.skillId, document.version);
}

export function setEffectiveSkillVersionInTransaction(
  database: DatabaseSync,
  skillId: string,
  skillVersion: string,
  changedAt: string,
): void {
  if (!database.isTransaction) {
    throw new StorageError(
      'INVALID_REQUEST',
      'Effective Skill version changes require a transaction',
    );
  }
  database
    .prepare(
      `INSERT INTO skill_effective_versions (skill_id, skill_version, changed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(skill_id) DO UPDATE SET
         skill_version = excluded.skill_version,
         changed_at = excluded.changed_at`,
    )
    .run(skillId, skillVersion, changedAt);
}

export function writeSkillRegistrationInTransaction(
  database: DatabaseSync,
  inputValue: SkillRegistrationInput,
  options: WriteSkillRegistrationOptions,
): SkillRegistrationResult {
  if (!database.isTransaction) {
    throw new StorageError('INVALID_REQUEST', 'Skill registration requires a transaction');
  }
  let input: SkillRegistrationInput;
  try {
    input = parseCanonical(SkillRegistrationInputSchema, inputValue);
  } catch (cause) {
    throw new StorageError('INVALID_REQUEST', 'Skill registration is invalid', { cause });
  }
  const { document, projectId } = input;
  if ((document.provenance === 'project') !== (options.createdByConfirmationId !== null)) {
    throw new StorageError(
      'INVALID_REQUEST',
      'Project Skill registration requires its creating confirmation',
    );
  }
  if (hashUtf8(document.content) !== document.contentHash) {
    throw new StorageError(
      'INVALID_REQUEST',
      `Skill ${document.skillId}@${document.version} content digest does not match`,
    );
  }
  if (
    projectId !== null &&
    database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId) === undefined
  ) {
    throw new StorageError('NOT_FOUND', `Project ${projectId} was not found`);
  }
  const existing = database
    .prepare(
      `SELECT id, version, name, description, content_text, content_hash, provenance, trust,
              project_id, created_by_confirmation_id, created_at
       FROM skills WHERE id = ? AND version = ?`,
    )
    .get(document.skillId, document.version) as unknown as SkillRow | undefined;
  if (existing !== undefined) {
    if (
      !options.allowExactExisting ||
      canonicalJson(skillRegistrationFromRow(existing)) !== canonicalJson(input) ||
      existing.created_by_confirmation_id !== options.createdByConfirmationId
    ) {
      throw conflict(
        `Skill ${document.skillId}@${document.version} already exists with different content or ownership`,
      );
    }
    ensureSkillQuarantine(database, document);
    return Object.freeze({ ...input, status: 'unchanged' });
  }
  database
    .prepare(
      `INSERT INTO skills (
         id, version, name, description, content_text, content_hash, provenance, trust,
         project_id, created_by_confirmation_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      document.skillId,
      document.version,
      document.name,
      document.description,
      document.content,
      document.contentHash,
      document.provenance,
      document.trust,
      projectId,
      options.createdByConfirmationId,
      document.createdAt,
    );
  if (options.activateEffectiveVersion) {
    setEffectiveSkillVersionInTransaction(
      database,
      document.skillId,
      document.version,
      options.effectiveAt,
    );
  }
  ensureSkillQuarantine(database, document);
  const inserted = database
    .prepare(
      `SELECT id, version, name, description, content_text, content_hash, provenance, trust,
              project_id, created_by_confirmation_id, created_at
       FROM skills WHERE id = ? AND version = ?`,
    )
    .get(document.skillId, document.version) as unknown as SkillRow;
  return Object.freeze({ ...skillRegistrationFromRow(inserted), status: 'inserted' });
}

export function registerGlobalSkillInTransaction(
  database: DatabaseSync,
  inputValue: SkillRegistrationInput,
  effectiveAt: string,
): SkillRegistrationResult {
  let input: SkillRegistrationInput;
  try {
    input = parseCanonical(SkillRegistrationInputSchema, inputValue);
  } catch (cause) {
    throw new StorageError('INVALID_REQUEST', 'Skill registration is invalid', { cause });
  }
  if (input.document.provenance === 'project') {
    throw new StorageError(
      'INVALID_REQUEST',
      'Project Skills must be registered through confirmation.respond',
    );
  }
  return writeSkillRegistrationInTransaction(database, input, {
    createdByConfirmationId: null,
    effectiveAt,
    allowExactExisting: true,
    activateEffectiveVersion: true,
  });
}
