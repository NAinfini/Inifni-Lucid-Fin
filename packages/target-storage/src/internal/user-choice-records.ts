import {
  CausationRefSchema,
  EntityIdSchema,
  UserChoiceEffectSchema,
  UserChoiceIntentSchema,
  UserChoiceSchema,
  UserChoiceSubjectSchema,
  canonicalJson,
  parseCanonical,
  userChoiceHashInput,
  type UserChoice,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import { decodeCanonicalRecord } from './canonical-codecs.js';
import { hashCanonical } from './hashes.js';
import { loadOperationDispatch } from './operation-dispatch.js';

interface UserChoiceRow {
  id: string;
  project_id: string;
  actor: UserChoice['actor'];
  authorization_kind: UserChoice['authorization']['kind'];
  authorization_source_id: string;
  authorization_input_hash: string;
  dispatch_operation_id: string | null;
  confirmation_id: string | null;
  subject_v1_json: string;
  choice_v1_json: string;
  before_effect_v1_json: string;
  after_effect_v1_json: string;
  owner_kind: 'production' | 'delivery';
  production_owner_id: string | null;
  delivery_owner_id: string | null;
  owner_before_revision: number | null;
  owner_before_hash: string | null;
  owner_after_revision: number;
  owner_after_hash: string;
  causation_v1_json: string;
  choice_hash: string;
  created_at: string;
}

const ZERO_HASH = '0'.repeat(64);

function corrupt(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'CORRUPT_DATA',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function authorizationFromRow(database: DatabaseSync, row: UserChoiceRow) {
  if (row.authorization_kind === 'direct_user') {
    if (
      row.actor !== 'user' ||
      row.dispatch_operation_id !== null ||
      row.confirmation_id !== null
    ) {
      throw corrupt(`UserChoice ${row.id} direct authorization columns do not match`);
    }
    return {
      kind: 'direct_user' as const,
      requestId: row.authorization_source_id,
      inputHash: row.authorization_input_hash,
    };
  }
  if (row.authorization_kind === 'import') {
    if (
      row.actor !== 'import' ||
      row.dispatch_operation_id !== null ||
      row.confirmation_id !== null
    ) {
      throw corrupt(`UserChoice ${row.id} import authorization columns do not match`);
    }
    return {
      kind: 'import' as const,
      importId: row.authorization_source_id,
      inputHash: row.authorization_input_hash,
    };
  }
  if (
    row.actor !== 'commander' ||
    row.dispatch_operation_id === null ||
    row.authorization_source_id !== row.dispatch_operation_id
  ) {
    throw corrupt(`UserChoice ${row.id} Commander authorization columns do not match`);
  }
  const dispatch = loadOperationDispatch(database, row.dispatch_operation_id);
  if (
    dispatch.key.projectId !== row.project_id ||
    dispatch.key.inputHash !== row.authorization_input_hash ||
    dispatch.confirmationId !== row.confirmation_id
  ) {
    throw corrupt(`UserChoice ${row.id} Commander dispatch binding does not match`);
  }
  return {
    kind: 'commander_dispatch' as const,
    dispatchOperationId: row.dispatch_operation_id,
    inputHash: row.authorization_input_hash,
    confirmationId: row.confirmation_id,
  };
}

function ownerRef(
  row: UserChoiceRow,
  revision: number,
  contentHash: string,
): UserChoice['ownerAfter'] {
  const id = row.owner_kind === 'production' ? row.production_owner_id : row.delivery_owner_id;
  if (id === null) throw corrupt(`UserChoice ${row.id} owner columns do not match`);
  return {
    authority: row.owner_kind,
    id,
    revision,
    contentHash,
  };
}

function supersessions(database: DatabaseSync, choiceId: string): string[] {
  const rows = database
    .prepare(
      `SELECT ordinal, superseded_choice_id
       FROM user_choice_supersessions WHERE choice_id = ? ORDER BY ordinal`,
    )
    .all(choiceId) as unknown as Array<{ ordinal: number; superseded_choice_id: string }>;
  if (rows.some((row, index) => row.ordinal !== index)) {
    throw corrupt(`UserChoice ${choiceId} supersession ordinals are not contiguous`);
  }
  return rows.map((row) => row.superseded_choice_id);
}

function choiceFromRow(database: DatabaseSync, row: UserChoiceRow): UserChoice {
  const ownerId = row.owner_kind === 'production' ? row.production_owner_id : row.delivery_owner_id;
  const owner =
    ownerId === null
      ? undefined
      : (database
          .prepare(
            row.owner_kind === 'production'
              ? 'SELECT project_id FROM production_objects WHERE id = ?'
              : 'SELECT project_id FROM delivery_plans WHERE id = ?',
          )
          .get(ownerId) as unknown as { project_id: string } | undefined);
  if (owner === undefined || owner.project_id !== row.project_id) {
    throw corrupt(`UserChoice ${row.id} owner does not belong to its Project`);
  }
  const value = parseCanonical(UserChoiceSchema, {
    authority: 'user_choice',
    id: row.id,
    projectId: row.project_id,
    actor: row.actor,
    authorization: authorizationFromRow(database, row),
    causation: decodeCanonicalRecord(
      `UserChoice ${row.id} causation`,
      CausationRefSchema,
      row.causation_v1_json,
    ),
    subject: decodeCanonicalRecord(
      `UserChoice ${row.id} subject`,
      UserChoiceSubjectSchema,
      row.subject_v1_json,
    ),
    ownerBefore:
      row.owner_before_revision === null || row.owner_before_hash === null
        ? null
        : ownerRef(row, row.owner_before_revision, row.owner_before_hash),
    ownerAfter: ownerRef(row, row.owner_after_revision, row.owner_after_hash),
    choice: decodeCanonicalRecord(
      `UserChoice ${row.id} intent`,
      UserChoiceIntentSchema,
      row.choice_v1_json,
    ),
    beforeEffect: decodeCanonicalRecord(
      `UserChoice ${row.id} before effect`,
      UserChoiceEffectSchema,
      row.before_effect_v1_json,
    ),
    afterEffect: decodeCanonicalRecord(
      `UserChoice ${row.id} after effect`,
      UserChoiceEffectSchema,
      row.after_effect_v1_json,
    ),
    supersedesChoiceIds: supersessions(database, row.id),
    createdAt: row.created_at,
    choiceHash: row.choice_hash,
  });
  if (hashCanonical(userChoiceHashInput(value)) !== value.choiceHash) {
    throw corrupt(`UserChoice ${row.id} hash does not match`);
  }
  return value;
}

export function loadUserChoiceRecord(database: DatabaseSync, choiceIdValue: string): UserChoice {
  const choiceId = parseCanonical(EntityIdSchema, choiceIdValue);
  const row = database
    .prepare('SELECT * FROM user_choices WHERE id = ?')
    .get(choiceId) as unknown as UserChoiceRow | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `UserChoice ${choiceId} was not found`);
  }
  try {
    return choiceFromRow(database, row);
  } catch (cause) {
    if (cause instanceof TargetStorageError) throw cause;
    throw corrupt(`UserChoice ${choiceId} is invalid`, cause);
  }
}

export function findUserChoiceByDispatch(
  database: DatabaseSync,
  dispatchOperationId: string,
): UserChoice | undefined {
  const rows = database
    .prepare('SELECT id FROM user_choices WHERE dispatch_operation_id = ? ORDER BY id')
    .all(dispatchOperationId) as unknown as Array<{ id: string }>;
  if (rows.length > 1) throw corrupt(`Dispatch ${dispatchOperationId} recorded multiple choices`);
  return rows[0] === undefined ? undefined : loadUserChoiceRecord(database, rows[0].id);
}

export function insertUserChoiceRecord(
  database: DatabaseSync,
  choiceInput: UserChoice,
): UserChoice {
  const choice = parseCanonical(UserChoiceSchema, choiceInput);
  if (hashCanonical(userChoiceHashInput(choice)) !== choice.choiceHash) {
    throw new TargetStorageError('INVALID_REQUEST', 'UserChoice hash does not match its content');
  }
  const authorization = choice.authorization;
  const owner = choice.ownerAfter;
  database
    .prepare(
      `INSERT INTO user_choices (
         id, project_id, actor, authorization_kind, authorization_source_id,
         authorization_input_hash, dispatch_operation_id, confirmation_id,
         subject_v1_json, choice_v1_json, before_effect_v1_json, after_effect_v1_json,
         owner_kind, production_owner_id, delivery_owner_id,
         owner_before_revision, owner_before_hash, owner_after_revision, owner_after_hash,
         causation_v1_json, choice_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      choice.id,
      choice.projectId,
      choice.actor,
      authorization.kind,
      authorization.kind === 'direct_user'
        ? authorization.requestId
        : authorization.kind === 'commander_dispatch'
          ? authorization.dispatchOperationId
          : authorization.importId,
      authorization.inputHash,
      authorization.kind === 'commander_dispatch' ? authorization.dispatchOperationId : null,
      authorization.kind === 'commander_dispatch' ? authorization.confirmationId : null,
      canonicalJson(choice.subject),
      canonicalJson(choice.choice),
      canonicalJson(choice.beforeEffect),
      canonicalJson(choice.afterEffect),
      owner.authority,
      owner.authority === 'production' ? owner.id : null,
      owner.authority === 'delivery' ? owner.id : null,
      choice.ownerBefore?.revision ?? null,
      choice.ownerBefore?.contentHash ?? null,
      owner.revision,
      owner.contentHash,
      canonicalJson(choice.causation),
      choice.choiceHash,
      choice.createdAt,
    );
  const insertSupersession = database.prepare(
    `INSERT INTO user_choice_supersessions (choice_id, ordinal, superseded_choice_id)
     VALUES (?, ?, ?)`,
  );
  choice.supersedesChoiceIds.forEach((supersededId, ordinal) =>
    insertSupersession.run(choice.id, ordinal, supersededId),
  );
  return loadUserChoiceRecord(database, choice.id);
}

export function finalizeUserChoiceRecord(value: Omit<UserChoice, 'choiceHash'>): UserChoice {
  const normalized = parseCanonical(UserChoiceSchema, { ...value, choiceHash: ZERO_HASH });
  return parseCanonical(UserChoiceSchema, {
    ...normalized,
    choiceHash: hashCanonical(userChoiceHashInput(normalized)),
  });
}
