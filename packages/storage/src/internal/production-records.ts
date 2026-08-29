import {
  FactProtectionSchema,
  ProductionFactSourceSchema,
  ProductionObjectSchema,
  ShotResultDecisionValueSchema,
  UserChoiceRefSchema,
  canonicalJson,
  parseCanonical,
  type CausationRef,
  type ProductionFactSource,
  type ProductionObject,
  type ProductionObjectViewV1,
  type ProductionRelation,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import type { StorageEnvironment } from './environment.js';
import {
  decodeProductionContent,
  decodeProtectedFieldRef,
  encodeProductionContent,
} from './canonical-codecs.js';
import { causationColumns, causationFromColumns } from './causation.js';
import { hashContentObject } from './hashes.js';
import { upsertProjectSearchDocument } from './search-projection.js';

const ZERO_HASH = '0'.repeat(64);
type ProductionObjectWithoutHash = ProductionObject extends infer ObjectType
  ? ObjectType extends ProductionObject
    ? Omit<ObjectType, 'contentHash'>
    : never
  : never;

interface ProductionRow {
  id: string;
  project_id: string;
  object_type: ProductionObject['type'];
  revision: number;
  content_hash: string;
  lifecycle: ProductionObject['lifecycle'];
  content_v1_json: string;
  created_by_kind: CausationRef['kind'];
  created_by_id: string;
  updated_by_kind: CausationRef['kind'];
  updated_by_id: string;
  created_at: string;
  updated_at: string;
}

interface RelationRow {
  relation: ProductionRelation['relation'];
  target_object_id: string;
  target_type: ProductionObject['type'];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalizeProductionRelations(
  relations: readonly ProductionRelation[],
): ProductionRelation[] {
  return [...relations].sort(
    (left, right) =>
      compareText(left.relation, right.relation) ||
      compareText(left.targetType, right.targetType) ||
      compareText(left.targetId, right.targetId),
  );
}

function relationsFor(database: DatabaseSync, productionObjectId: string): ProductionRelation[] {
  const rows = database
    .prepare(
      `SELECT relation.relation, relation.target_object_id, target.object_type AS target_type
       FROM production_relations AS relation
       JOIN production_objects AS target ON target.id = relation.target_object_id
       WHERE relation.source_object_id = ?`,
    )
    .all(productionObjectId) as unknown as RelationRow[];
  return canonicalizeProductionRelations(
    rows.map((row) => ({
      relation: row.relation,
      targetType: row.target_type,
      targetId: row.target_object_id,
    })),
  );
}

function protectionsFor(
  database: DatabaseSync,
  productionObjectId: string,
): ProductionObject['protections'] {
  const rows = database
    .prepare(
      `SELECT field_ref, choice_id, protected_at
       FROM production_protections
       WHERE production_object_id = ? AND released_by_choice_id IS NULL
       ORDER BY field_ref, protected_at, id`,
    )
    .all(productionObjectId) as unknown as Array<{
    field_ref: string;
    choice_id: string;
    protected_at: string;
  }>;
  return rows.map((row) => {
    const field = decodeProtectedFieldRef(row.field_ref);
    if (field.owner !== 'production' || field.objectId !== productionObjectId) {
      throw new StorageError(
        'CORRUPT_DATA',
        `Production protection for ${productionObjectId} has the wrong owner`,
      );
    }
    return parseCanonical(FactProtectionSchema, {
      field,
      choiceId: row.choice_id,
      protectedAt: row.protected_at,
    });
  });
}

function resultDecisionsFor(
  database: DatabaseSync,
  productionObjectId: string,
  projectId: string,
): Extract<ProductionObject, { type: 'shot' }>['resultDecisions'] {
  const rows = database
    .prepare(
      `SELECT decision.project_id, decision.generated_result_id,
              decision.generated_result_revision, decision.generated_result_hash,
              decision.state, decision.feedback, decision.instruction,
              decision.current_choice_id, result.project_id AS result_project_id,
              choice.project_id AS choice_project_id,
              choice.owner_kind, choice.production_owner_id
       FROM production_result_decisions AS decision
       JOIN generated_results AS result
         ON result.id = decision.generated_result_id
        AND result.revision = decision.generated_result_revision
        AND result.content_hash = decision.generated_result_hash
       JOIN user_choices AS choice ON choice.id = decision.current_choice_id
       WHERE decision.shot_id = ?
       ORDER BY decision.generated_result_id`,
    )
    .all(productionObjectId) as unknown as Array<{
    project_id: string;
    generated_result_id: string;
    generated_result_revision: 0;
    generated_result_hash: string;
    state: 'selected' | 'rejected' | 'refine' | 'reference';
    feedback: string | null;
    instruction: string | null;
    current_choice_id: string;
    result_project_id: string;
    choice_project_id: string;
    owner_kind: string;
    production_owner_id: string | null;
  }>;
  return rows.map((row) => {
    if (
      row.project_id !== projectId ||
      row.result_project_id !== projectId ||
      row.choice_project_id !== projectId ||
      row.owner_kind !== 'production' ||
      row.production_owner_id !== productionObjectId
    ) {
      throw new StorageError(
        'CORRUPT_DATA',
        `Shot decision for ${productionObjectId} has a mismatched Project or Choice owner`,
      );
    }
    const value = parseCanonical(
      ShotResultDecisionValueSchema,
      row.state === 'refine'
        ? { state: row.state, instruction: row.instruction }
        : { state: row.state, feedback: row.feedback },
    );
    return {
      result: {
        authority: 'generated_result',
        id: row.generated_result_id,
        revision: row.generated_result_revision,
        contentHash: row.generated_result_hash,
      },
      value,
      currentChoiceId: row.current_choice_id,
    };
  });
}

function currentChoicesFor(
  database: DatabaseSync,
  object: ProductionObject,
): ProductionObjectViewV1['currentChoices'] {
  if (object.type !== 'shot') return [];
  const rows = database
    .prepare(
      `SELECT decision.current_choice_id, choice.choice_hash
       FROM production_result_decisions AS decision
       JOIN user_choices AS choice ON choice.id = decision.current_choice_id
       WHERE decision.shot_id = ?
       ORDER BY decision.generated_result_id`,
    )
    .all(object.id) as unknown as Array<{ current_choice_id: string; choice_hash: string }>;
  if (
    rows.length !== object.resultDecisions.length ||
    rows.some(
      (row, index) => row.current_choice_id !== object.resultDecisions[index]?.currentChoiceId,
    )
  ) {
    throw new StorageError(
      'CORRUPT_DATA',
      `Shot decision Choice refs for ${object.id} do not match its current decisions`,
    );
  }
  return rows.map((row) =>
    parseCanonical(UserChoiceRefSchema, {
      authority: 'user_choice',
      id: row.current_choice_id,
      choiceHash: row.choice_hash,
    }),
  );
}

export function factSourcesFor(
  database: DatabaseSync,
  productionObjectId: string,
): ProductionFactSource[] {
  const rows = database
    .prepare(
      `SELECT * FROM production_fact_sources
       WHERE production_object_id = ? ORDER BY field_ref, created_at, id`,
    )
    .all(productionObjectId) as unknown as Array<Record<string, unknown>>;
  return rows.map((row) =>
    parseCanonical(ProductionFactSourceSchema, {
      id: row.id,
      productionObjectId: row.production_object_id,
      field: row.field_ref,
      source: {
        authority: row.source_authority,
        id: row.source_id,
        revision: row.source_revision,
        contentHash: row.source_hash,
      },
      relation: row.relation,
      createdAt: row.created_at,
    }),
  );
}

function productionFromRow(database: DatabaseSync, row: ProductionRow): ProductionObject {
  let object: ProductionObject;
  try {
    object = parseCanonical(ProductionObjectSchema, {
      authority: 'production',
      id: row.id,
      projectId: row.project_id,
      revision: row.revision,
      contentHash: row.content_hash,
      lifecycle: row.lifecycle,
      type: row.object_type,
      content: decodeProductionContent(row.object_type, row.content_v1_json),
      relations: relationsFor(database, row.id),
      ...(row.object_type === 'shot'
        ? { resultDecisions: resultDecisionsFor(database, row.id, row.project_id) }
        : {}),
      protections: protectionsFor(database, row.id),
      createdBy: causationFromColumns(row.created_by_kind, row.created_by_id),
      updatedBy: causationFromColumns(row.updated_by_kind, row.updated_by_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (cause) {
    if (cause instanceof StorageError) throw cause;
    throw new StorageError('CORRUPT_DATA', `Production object ${row.id} is invalid`, {
      cause,
    });
  }
  if (hashContentObject(object) !== object.contentHash) {
    throw new StorageError(
      'CORRUPT_DATA',
      `Production object ${object.id} content hash does not match`,
    );
  }
  return object;
}

export function loadProductionObject(
  database: DatabaseSync,
  productionObjectId: string,
): ProductionObject {
  const row = database
    .prepare('SELECT * FROM production_objects WHERE id = ?')
    .get(productionObjectId) as unknown as ProductionRow | undefined;
  if (row === undefined) {
    throw new StorageError('NOT_FOUND', `Production object ${productionObjectId} was not found`);
  }
  return productionFromRow(database, row);
}

export function loadProductionView(
  database: DatabaseSync,
  productionObjectId: string,
  includeFactSources = true,
): ProductionObjectViewV1 {
  const object = loadProductionObject(database, productionObjectId);
  return {
    object,
    factSources: includeFactSources ? factSourcesFor(database, productionObjectId) : [],
    currentChoices: currentChoicesFor(database, object),
  };
}

export function productionComparable(object: ProductionObject): string {
  return canonicalJson({
    lifecycle: object.lifecycle,
    type: object.type,
    content: object.content,
    relations: object.relations,
  });
}

export function finalizeProductionObject(value: ProductionObjectWithoutHash): ProductionObject {
  const normalized = parseCanonical(ProductionObjectSchema, {
    ...value,
    relations: canonicalizeProductionRelations(value.relations),
    contentHash: ZERO_HASH,
  });
  return parseCanonical(ProductionObjectSchema, {
    ...normalized,
    contentHash: hashContentObject(normalized),
  });
}

export function writeProductionObjectRecord(
  database: DatabaseSync,
  object: ProductionObject,
  before: ProductionObject,
): void {
  const updatedBy = causationColumns(object.updatedBy);
  const updated = database
    .prepare(
      `UPDATE production_objects
       SET revision = ?, content_hash = ?, lifecycle = ?, content_v1_json = ?,
           updated_by_kind = ?, updated_by_id = ?, updated_at = ?
       WHERE id = ? AND revision = ? AND content_hash = ?`,
    )
    .run(
      object.revision,
      object.contentHash,
      object.lifecycle,
      encodeProductionContent(object.type, object.content),
      updatedBy[0],
      updatedBy[1],
      object.updatedAt,
      before.id,
      before.revision,
      before.contentHash,
    );
  if (Number(updated.changes) !== 1) {
    throw new StorageError(
      'REVISION_CONFLICT',
      `Production object ${before.id} changed concurrently`,
    );
  }
}

function collectSearchValues(value: unknown, output: string[]): void {
  if (typeof value === 'string' || typeof value === 'number') output.push(String(value));
  else if (Array.isArray(value)) for (const entry of value) collectSearchValues(entry, output);
  else if (value !== null && typeof value === 'object')
    for (const entry of Object.values(value)) collectSearchValues(entry, output);
}

export function updateProductionSearchDocument(
  database: DatabaseSync,
  environment: StorageEnvironment,
  object: ProductionObject,
): void {
  const text = [object.type];
  collectSearchValues(object.content, text);
  upsertProjectSearchDocument(
    database,
    environment,
    object.projectId,
    {
      kind: 'production',
      ref: {
        authority: 'production',
        id: object.id,
        revision: object.revision,
        contentHash: object.contentHash,
      },
    },
    object.lifecycle === 'active' ? 'current' : 'historical',
    text.join('\n'),
    object.updatedAt,
  );
}
