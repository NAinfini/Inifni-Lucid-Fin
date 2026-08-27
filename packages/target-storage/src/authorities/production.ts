import {
  EntityIdSchema,
  IsoTimestampSchema,
  ProductionMutateDefinition,
  ProductionQueryDefinition,
  ProductionCitationFieldSchema,
  ProductionObjectTypeSchema,
  ProductionRefSchema,
  ProtectedMutationPlannedIdsSchema,
  Sha256Schema,
  WireSuccessV1Schema,
  canonicalJson,
  parseCanonical,
  parseRequestV1,
  strictObject,
  z,
  type ProductionObject,
  type ProductionObjectType,
  type ProductionObjectViewV1,
  type ProductionMutationReceipt,
  type ProductionRelation,
  type ProductionRef,
  type ProtectedFieldRef,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import type { TargetStore } from '../kernel/store.js';
import { causationColumns } from '../internal/causation.js';
import {
  executeWireMutation,
  TargetCommandContextSchema,
  type TargetCommandContext,
} from '../internal/command.js';
import {
  decodeCursor as decodeOpaqueCursor,
  encodeCursor as encodeOpaqueCursor,
} from '../internal/cursor.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { requireCurrentDomainObject } from '../internal/domain-object-resolver.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import { hashCanonical } from '../internal/hashes.js';
import { appendProjectEvent } from '../internal/project-events.js';
import {
  canonicalizeProductionRelations,
  factSourcesFor,
  finalizeProductionObject,
  loadProductionObject,
  loadProductionView,
  updateProductionSearchDocument,
  writeProductionObjectRecord,
} from '../internal/production-records.js';
import { encodeProductionContent } from '../internal/canonical-codecs.js';
import {
  assertProductionProtectionMutation,
  type CommandDispatchHost,
} from '../internal/protection-guard.js';

type RequestMap = {
  [Method in WireRequestV1['method']]: Extract<WireRequestV1, { method: Method }>;
};
type SuccessMap = {
  [Method in WireSuccessV1['method']]: Extract<WireSuccessV1, { method: Method }>;
};
type Request<Method extends keyof RequestMap> = RequestMap[Method];
type Success<Method extends keyof SuccessMap> = SuccessMap[Method];
export type ProductionToolQueryInput = ReturnType<typeof ProductionQueryDefinition.parseInput>;
export type ProductionToolQuerySuccess = ReturnType<typeof ProductionQueryDefinition.parseSuccess>;
export type ProductionToolMutationInput = ReturnType<typeof ProductionMutateDefinition.parseInput>;
export type ProductionToolMutationSuccess = ReturnType<
  typeof ProductionMutateDefinition.parseSuccess
>;
export type ProductionMutationPlannedIds = Extract<
  z.output<typeof ProtectedMutationPlannedIdsSchema>,
  { tool: 'production.mutate' }
>;
type ProductionTypedValue = Extract<ProductionToolMutationInput, { action: 'create' }>['value'];
type ProductionObjectCommonWithoutHash = Omit<
  Extract<ProductionObject, { type: 'direction' }>,
  'contentHash' | 'type' | 'content'
>;
type ShotResultDecisions = Extract<ProductionObject, { type: 'shot' }>['resultDecisions'];

const ProductionCursorSchema = strictObject({
  filterHash: Sha256Schema,
  type: ProductionObjectTypeSchema,
  id: EntityIdSchema,
});

function exactRequest<Method extends WireRequestV1['method']>(
  value: Request<Method>,
  method: Method,
): Request<Method> {
  const request = parseRequestV1(value);
  if (request.method !== method) {
    throw new TargetStorageError('INVALID_REQUEST', `Expected Wire method ${method}`);
  }
  return request as Request<Method>;
}

function success<Method extends WireSuccessV1['method']>(
  request: Request<Method>,
  result: unknown,
): Success<Method> {
  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result,
  }) as Success<Method>;
}

function requireProjectRevision(
  database: DatabaseSync,
  projectId: string,
  expectedRevision: number,
): void {
  const row = database
    .prepare('SELECT revision FROM projects WHERE id = ?')
    .get(projectId) as unknown as { revision: number } | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Project ${projectId} was not found`);
  }
  if (row.revision !== expectedRevision) {
    throw new TargetStorageError('REVISION_CONFLICT', `Project ${projectId} revision changed`);
  }
}

function writeProductionObject(
  database: DatabaseSync,
  object: ProductionObject,
  before: ProductionObject | null,
): void {
  const createdBy = causationColumns(object.createdBy);
  const updatedBy = causationColumns(object.updatedBy);
  if (before === null) {
    database
      .prepare(
        `INSERT INTO production_objects (
           id, project_id, object_type, revision, content_hash, lifecycle, content_v1_json,
           created_by_kind, created_by_id, updated_by_kind, updated_by_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        object.id,
        object.projectId,
        object.type,
        object.revision,
        object.contentHash,
        object.lifecycle,
        encodeProductionContent(object.type, object.content),
        createdBy[0],
        createdBy[1],
        updatedBy[0],
        updatedBy[1],
        object.createdAt,
        object.updatedAt,
      );
    return;
  }
  writeProductionObjectRecord(database, object, before);
}

const citationFields: Record<ProductionObjectType, ReadonlySet<string>> = {
  direction: new Set(['summary', 'visual_language', 'tone', 'constraints']),
  story: new Set(['title', 'premise', 'synopsis']),
  sequence: new Set(['title', 'summary']),
  scene: new Set(['title', 'summary']),
  beat: new Set(['title', 'summary']),
  character: new Set(['description', 'traits']),
  location: new Set(['description', 'traits']),
  equipment: new Set(['description', 'traits']),
  prop: new Set(['description', 'traits']),
  wardrobe: new Set(['description', 'traits']),
  world_fact: new Set(['description', 'traits']),
  shot: new Set(['title', 'description', 'duration', 'camera']),
};

function assertCitationField(object: ProductionObject, field: string): void {
  parseCanonical(ProductionCitationFieldSchema, field);
  if (!citationFields[object.type].has(field)) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      `Citation field ${field} does not belong to ${object.type} content`,
    );
  }
}

function requireProductionRef(
  database: DatabaseSync,
  projectId: string,
  ref: { id: string; revision: number; contentHash: string },
): ProductionObject {
  const object = loadProductionObject(database, ref.id);
  if (object.projectId !== projectId) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      `Production object ${object.id} belongs to another Project`,
    );
  }
  if (object.revision !== ref.revision || object.contentHash !== ref.contentHash) {
    throw new TargetStorageError('REVISION_CONFLICT', `Production object ${object.id} changed`);
  }
  return object;
}

function finalizeTypedProductionObject(
  common: ProductionObjectCommonWithoutHash,
  value: ProductionTypedValue,
  resultDecisions: ShotResultDecisions,
): ProductionObject {
  switch (value.objectType) {
    case 'direction':
      return finalizeProductionObject({ ...common, type: 'direction', content: value.content });
    case 'story':
      return finalizeProductionObject({ ...common, type: 'story', content: value.content });
    case 'sequence':
      return finalizeProductionObject({ ...common, type: 'sequence', content: value.content });
    case 'scene':
      return finalizeProductionObject({ ...common, type: 'scene', content: value.content });
    case 'beat':
      return finalizeProductionObject({ ...common, type: 'beat', content: value.content });
    case 'character':
      return finalizeProductionObject({ ...common, type: 'character', content: value.content });
    case 'location':
      return finalizeProductionObject({ ...common, type: 'location', content: value.content });
    case 'equipment':
      return finalizeProductionObject({ ...common, type: 'equipment', content: value.content });
    case 'prop':
      return finalizeProductionObject({ ...common, type: 'prop', content: value.content });
    case 'wardrobe':
      return finalizeProductionObject({ ...common, type: 'wardrobe', content: value.content });
    case 'world_fact':
      return finalizeProductionObject({ ...common, type: 'world_fact', content: value.content });
    case 'shot':
      return finalizeProductionObject({
        ...common,
        type: 'shot',
        content: value.content,
        resultDecisions,
      });
  }
}

type ProductionField = Extract<
  ProtectedFieldRef,
  { owner: 'production'; field: 'content' | 'relations' | 'lifecycle' }
>;
type ProductionMutationAction = ProductionToolMutationInput['action'];
type ProductionMutationMode = Extract<ProductionToolMutationInput, { action: 'relate' }>['mode'];
type ProductionMutationIdKind =
  'production' | 'production_relation' | 'production_fact_source' | 'project_event';
type ProductionMutationIdRole =
  | 'production_object'
  | 'containment_relation'
  | 'object_event'
  | 'parent_event'
  | 'relation'
  | 'source_event'
  | 'fact_source';

interface ProductionRelationRecord {
  readonly id: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly relation: ProductionRelation['relation'];
  readonly targetId: string;
  readonly targetType: ProductionObjectType;
  readonly ordinal: number | null;
  readonly createdAt: string;
}

interface ProductionRelationWrites {
  readonly insert: readonly ProductionRelationRecord[];
  readonly remove: readonly string[];
  readonly ordinal: readonly { readonly id: string; readonly ordinal: number }[];
}

interface PlannedProductionObjectChange {
  readonly id: string;
  readonly projectId: string;
  readonly before: ProductionObject | null;
  readonly value: ProductionTypedValue;
  readonly lifecycle: ProductionObject['lifecycle'];
  readonly relations: readonly ProductionRelation[];
  readonly resultDecisions: ShotResultDecisions;
  readonly eventId: string;
  readonly changedPaths: readonly string[];
}

interface PlannedProductionFactSource {
  readonly id: string;
  readonly productionObjectId: string;
  readonly field: string;
  readonly source: ReturnType<typeof requireCurrentDomainObject>['ref'];
  readonly relation: 'supports' | 'supersedes' | 'contradicts';
  readonly createdAt: string;
}

export interface PlannedProductionMutation {
  readonly requestId: string;
  readonly projectId: string;
  readonly command: ProductionToolMutationInput | null;
  readonly action: ProductionMutationAction;
  readonly expectedProjectRevision: number | null;
  readonly occurredAt: string;
  readonly ids: ProductionMutationPlannedIds;
  readonly changes: readonly PlannedProductionObjectChange[];
  readonly relationWrites: ProductionRelationWrites;
  readonly factSource: PlannedProductionFactSource | null;
  readonly watchedProduction: readonly ProductionObject[];
  readonly citedSource: ReturnType<typeof requireCurrentDomainObject>['ref'] | null;
  readonly ownerBefore: ProductionRef | null;
  readonly fields: readonly ProductionField[];
  readonly activeChoiceIds: readonly string[];
  readonly proposedEffect: unknown;
}

export interface CommittedProductionMutation {
  readonly action: ProductionMutationAction;
  readonly receipts: readonly ProductionMutationReceipt[];
  readonly primaryEventId: string | null;
}

const PRODUCTION_MUTATION_ID_SCHEMA = 'lucid-fin.production-mutation-planned-ids/v1';
const EMPTY_RELATION_WRITES: ProductionRelationWrites = Object.freeze({
  insert: Object.freeze([]),
  remove: Object.freeze([]),
  ordinal: Object.freeze([]),
});

function invalidProductionMutation(message: string): TargetStorageError {
  return new TargetStorageError('INVALID_REQUEST', message);
}

function corruptProductionMutation(message: string): TargetStorageError {
  return new TargetStorageError('CORRUPT_DATA', message);
}

function productionRef(object: ProductionObject): ProductionRef {
  return parseCanonical(ProductionRefSchema, {
    authority: 'production',
    id: object.id,
    revision: object.revision,
    contentHash: object.contentHash,
  });
}

function typedValue(object: ProductionObject): ProductionTypedValue {
  const parsed = ProductionMutateDefinition.parseInput({
    action: 'create',
    expectedProjectRevision: 0,
    parentRef: null,
    order: null,
    value: { objectType: object.type, content: object.content },
  });
  if (parsed.action !== 'create') throw corruptProductionMutation('Production typed value changed');
  return parsed.value;
}

function productionMutationVariant(
  action: ProductionMutationAction,
  mode?: ProductionMutationMode,
): ProductionMutationPlannedIds['variant'] {
  switch (action) {
    case 'create':
      if (mode !== undefined)
        throw invalidProductionMutation('Production create does not have a mode');
      return 'production_create';
    case 'update':
      if (mode !== undefined)
        throw invalidProductionMutation('Production update does not have a mode');
      return 'production_update';
    case 'relate':
      if (mode === 'link') return 'production_relate_link';
      if (mode === 'unlink') return 'production_relate_unlink';
      throw invalidProductionMutation('Production relation mutation requires a mode');
    case 'reorder':
      if (mode !== undefined)
        throw invalidProductionMutation('Production reorder does not have a mode');
      return 'production_reorder';
    case 'archive':
      if (mode !== undefined)
        throw invalidProductionMutation('Production archive does not have a mode');
      return 'production_archive';
    case 'restore':
      if (mode !== undefined)
        throw invalidProductionMutation('Production restore does not have a mode');
      return 'production_restore';
    case 'cite':
      if (mode !== undefined)
        throw invalidProductionMutation('Production cite does not have a mode');
      return 'production_cite';
  }
}

function productionMutationId(
  dispatchOperationIdValue: string,
  variant: ProductionMutationPlannedIds['variant'],
  prefix: ProductionMutationIdKind,
  role: ProductionMutationIdRole,
): string {
  const dispatchOperationId = parseCanonical(EntityIdSchema, dispatchOperationIdValue);
  return `${prefix}.${hashCanonical({
    schema: PRODUCTION_MUTATION_ID_SCHEMA,
    dispatchOperationId,
    tool: ProductionMutateDefinition.id,
    variant,
    role,
  })}`;
}

export function productionMutationIdsForVariant(
  variant: ProductionMutationPlannedIds['variant'],
  hasCreateParent: boolean,
  createId: (kind: ProductionMutationIdKind, role: ProductionMutationIdRole) => string,
): ProductionMutationPlannedIds {
  const next = (kind: ProductionMutationIdKind, role: ProductionMutationIdRole) =>
    parseCanonical(EntityIdSchema, createId(kind, role));
  const ids =
    variant === 'production_create'
      ? {
          tool: ProductionMutateDefinition.id,
          variant,
          productionObjectId: next('production', 'production_object'),
          containmentRelationId: hasCreateParent
            ? next('production_relation', 'containment_relation')
            : null,
          objectEventId: next('project_event', 'object_event'),
          parentEventId: hasCreateParent ? next('project_event', 'parent_event') : null,
        }
      : variant === 'production_update' ||
          variant === 'production_archive' ||
          variant === 'production_restore'
        ? {
            tool: ProductionMutateDefinition.id,
            variant,
            objectEventId: next('project_event', 'object_event'),
          }
        : variant === 'production_relate_link'
          ? {
              tool: ProductionMutateDefinition.id,
              variant,
              relationId: next('production_relation', 'relation'),
              sourceEventId: next('project_event', 'source_event'),
            }
          : variant === 'production_relate_unlink'
            ? {
                tool: ProductionMutateDefinition.id,
                variant,
                sourceEventId: next('project_event', 'source_event'),
              }
            : variant === 'production_reorder'
              ? {
                  tool: ProductionMutateDefinition.id,
                  variant,
                  parentEventId: next('project_event', 'parent_event'),
                }
              : {
                  tool: ProductionMutateDefinition.id,
                  variant,
                  factSourceId: next('production_fact_source', 'fact_source'),
                  objectEventId: next('project_event', 'object_event'),
                };
  return parseCanonical(ProtectedMutationPlannedIdsSchema, ids) as ProductionMutationPlannedIds;
}

export function plannedProductionMutationIds(
  dispatchOperationId: string,
  input: ProductionToolMutationInput,
): ProductionMutationPlannedIds;
export function plannedProductionMutationIds(
  dispatchOperationId: string,
  action: ProductionMutationAction,
  mode?: ProductionMutationMode,
): ProductionMutationPlannedIds;
export function plannedProductionMutationIds(
  dispatchOperationId: string,
  inputOrAction: ProductionToolMutationInput | ProductionMutationAction,
  mode?: ProductionMutationMode,
): ProductionMutationPlannedIds {
  const input = typeof inputOrAction === 'string' ? null : inputOrAction;
  const action: ProductionMutationAction =
    typeof inputOrAction === 'string' ? inputOrAction : inputOrAction.action;
  const relationMode = input?.action === 'relate' ? input.mode : mode;
  const hasCreateParent = input?.action === 'create' && input.parentRef !== null;
  const variant = productionMutationVariant(action, relationMode);
  return productionMutationIdsForVariant(variant, hasCreateParent, (kind, role) =>
    productionMutationId(dispatchOperationId, variant, kind, role),
  );
}

function generatedProductionMutationIds(
  environment: TargetStorageEnvironment,
  input: ProductionToolMutationInput,
): ProductionMutationPlannedIds {
  const variant = productionMutationVariant(
    input.action,
    input.action === 'relate' ? input.mode : undefined,
  );
  return productionMutationIdsForVariant(
    variant,
    input.action === 'create' && input.parentRef !== null,
    (kind) => environment.createId(kind),
  );
}

function exactProductionMutationIds(
  inputValue: ProductionMutationPlannedIds,
  input: ProductionToolMutationInput,
): ProductionMutationPlannedIds {
  const ids = parseCanonical(
    ProtectedMutationPlannedIdsSchema,
    inputValue,
  ) as ProductionMutationPlannedIds;
  const variant = productionMutationVariant(
    input.action,
    input.action === 'relate' ? input.mode : undefined,
  );
  if (ids.tool !== ProductionMutateDefinition.id || ids.variant !== variant) {
    throw invalidProductionMutation('Production mutation planned IDs do not match its command');
  }
  if (ids.variant === 'production_create') {
    const needsParentIds = input.action === 'create' && input.parentRef !== null;
    if (
      (ids.containmentRelationId !== null) !== needsParentIds ||
      (ids.parentEventId !== null) !== needsParentIds
    ) {
      throw invalidProductionMutation('Production create planned IDs do not match its parent');
    }
  }
  const values = Object.values(ids).filter((value): value is string => typeof value === 'string');
  if (new Set(values).size !== values.length) {
    throw invalidProductionMutation('Production mutation planned IDs must be unique');
  }
  return ids;
}

function relationRecordsFor(database: DatabaseSync, sourceId: string): ProductionRelationRecord[] {
  const rows = database
    .prepare(
      `SELECT relation.id, relation.project_id, relation.source_object_id, relation.relation,
              relation.target_object_id, target.object_type AS target_type, relation.ordinal,
              relation.created_at
       FROM production_relations AS relation
       JOIN production_objects AS target ON target.id = relation.target_object_id
       WHERE relation.source_object_id = ?`,
    )
    .all(sourceId) as unknown as Array<{
    id: string;
    project_id: string;
    source_object_id: string;
    relation: ProductionRelation['relation'];
    target_object_id: string;
    target_type: ProductionObjectType;
    ordinal: number | null;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    sourceId: row.source_object_id,
    relation: row.relation,
    targetId: row.target_object_id,
    targetType: row.target_type,
    ordinal: row.ordinal,
    createdAt: row.created_at,
  }));
}

function relationValue(record: ProductionRelationRecord): ProductionRelation {
  return {
    relation: record.relation,
    targetType: record.targetType,
    targetId: record.targetId,
    ordinal: record.ordinal,
  };
}

function relationValues(records: readonly ProductionRelationRecord[]): ProductionRelation[] {
  return canonicalizeProductionRelations(records.map(relationValue));
}

function relationIdentity(
  relation: Pick<ProductionRelationRecord, 'relation' | 'targetId'>,
): string {
  return `${relation.relation}\u0000${relation.targetId}`;
}

function assertDenseContainment(records: readonly ProductionRelationRecord[]): void {
  const children = records
    .filter(({ relation }) => relation === 'contains')
    .sort((left, right) => left.ordinal! - right.ordinal! || left.id.localeCompare(right.id));
  if (children.some(({ ordinal }, index) => ordinal !== index)) {
    throw corruptProductionMutation('Production containment ordinals are not dense');
  }
}

function assertChildHasNoParent(database: DatabaseSync, projectId: string, childId: string): void {
  const rows = database
    .prepare(
      `SELECT source_object_id FROM production_relations
       WHERE project_id = ? AND target_object_id = ? AND relation = 'contains'`,
    )
    .all(projectId, childId) as unknown as Array<{ source_object_id: string }>;
  if (rows.length > 0) {
    throw invalidProductionMutation(`Production child ${childId} already has a parent`);
  }
}

function assertNoContainmentCycle(
  database: DatabaseSync,
  sourceId: string,
  targetId: string,
): void {
  if (sourceId === targetId) {
    throw invalidProductionMutation('Production objects cannot contain themselves');
  }
  const visited = new Set<string>();
  const pending = [targetId];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (!visited.add(current)) continue;
    if (current === sourceId) {
      throw invalidProductionMutation('Production containment cannot create a cycle');
    }
    const rows = database
      .prepare(
        `SELECT target_object_id FROM production_relations
         WHERE source_object_id = ? AND relation = 'contains'`,
      )
      .all(current) as unknown as Array<{ target_object_id: string }>;
    for (const row of rows) pending.push(row.target_object_id);
  }
}

function withContainmentInserted(
  records: readonly ProductionRelationRecord[],
  relation: ProductionRelationRecord,
): { readonly records: ProductionRelationRecord[]; readonly writes: ProductionRelationWrites } {
  assertDenseContainment(records);
  const children = records.filter(({ relation: kind }) => kind === 'contains');
  if (relation.ordinal === null || relation.ordinal > children.length) {
    throw invalidProductionMutation('Production containment ordinal is out of range');
  }
  const ordinal = relation.ordinal;
  const shifted = records.map((record) =>
    record.relation === 'contains' && record.ordinal! >= ordinal
      ? { ...record, ordinal: record.ordinal! + 1 }
      : record,
  );
  return {
    records: [...shifted, relation],
    writes: {
      insert: [relation],
      remove: [],
      ordinal: shifted
        .filter((record, index) => record.ordinal !== records[index]!.ordinal)
        .map(({ id, ordinal: nextOrdinal }) => ({ id, ordinal: nextOrdinal! })),
    },
  };
}

function withRelationRemoved(
  records: readonly ProductionRelationRecord[],
  removed: ProductionRelationRecord,
): { readonly records: ProductionRelationRecord[]; readonly writes: ProductionRelationWrites } {
  assertDenseContainment(records);
  const remaining = records
    .filter(({ id }) => id !== removed.id)
    .map((record) =>
      removed.relation === 'contains' &&
      record.relation === 'contains' &&
      record.ordinal! > removed.ordinal!
        ? { ...record, ordinal: record.ordinal! - 1 }
        : record,
    );
  const original = new Map(records.map((record) => [record.id, record]));
  return {
    records: remaining,
    writes: {
      insert: [],
      remove: [removed.id],
      ordinal: remaining
        .filter((record) => record.ordinal !== original.get(record.id)!.ordinal)
        .map(({ id, ordinal }) => ({ id, ordinal: ordinal! })),
    },
  };
}

function mergeRelationWrites(
  ...writes: readonly ProductionRelationWrites[]
): ProductionRelationWrites {
  return {
    insert: writes.flatMap(({ insert }) => insert),
    remove: writes.flatMap(({ remove }) => remove),
    ordinal: writes.flatMap(({ ordinal }) => ordinal),
  };
}

function writeRelationChanges(database: DatabaseSync, writes: ProductionRelationWrites): void {
  const remove = database.prepare('DELETE FROM production_relations WHERE id = ?');
  for (const id of writes.remove) {
    if (Number(remove.run(id).changes) !== 1) {
      throw new TargetStorageError('REVISION_CONFLICT', `Production relation ${id} changed`);
    }
  }
  const elevate = database.prepare(
    'UPDATE production_relations SET ordinal = ordinal + 1000000 WHERE id = ?',
  );
  for (const { id } of writes.ordinal) {
    if (Number(elevate.run(id).changes) !== 1) {
      throw new TargetStorageError('REVISION_CONFLICT', `Production relation ${id} changed`);
    }
  }
  const setOrdinal = database.prepare('UPDATE production_relations SET ordinal = ? WHERE id = ?');
  for (const { id, ordinal } of writes.ordinal) setOrdinal.run(ordinal, id);
  const insert = database.prepare(
    `INSERT INTO production_relations (
       id, project_id, source_object_id, target_object_id, relation, ordinal, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const relation of writes.insert) {
    insert.run(
      relation.id,
      relation.projectId,
      relation.sourceId,
      relation.targetId,
      relation.relation,
      relation.ordinal,
      relation.createdAt,
    );
  }
}

function validateNonContainmentRelations(
  database: DatabaseSync,
  projectId: string,
  sourceId: string,
  relations: readonly ProductionRelation[],
): ProductionRelation[] {
  const canonical = canonicalizeProductionRelations(relations);
  const identities = new Set<string>();
  for (const relation of canonical) {
    if (relation.relation === 'contains') {
      throw invalidProductionMutation('Production legacy replacement cannot reparent or reorder');
    }
    if (relation.targetId === sourceId) {
      throw invalidProductionMutation('Production objects cannot relate to themselves');
    }
    const target = loadProductionObject(database, relation.targetId);
    if (target.projectId !== projectId || target.type !== relation.targetType) {
      throw invalidProductionMutation(
        `Production relation target ${relation.targetId} does not match`,
      );
    }
    const identity = relationIdentity(relation);
    if (!identities.add(identity)) {
      throw invalidProductionMutation('Production relations contain a duplicate target');
    }
  }
  return canonical;
}

function nonContainmentReplacementWrites(
  environment: TargetStorageEnvironment,
  projectId: string,
  sourceId: string,
  records: readonly ProductionRelationRecord[],
  desired: readonly ProductionRelation[],
  occurredAt: string,
): { readonly records: ProductionRelationRecord[]; readonly writes: ProductionRelationWrites } {
  const currentNonContains = records.filter(({ relation }) => relation !== 'contains');
  const currentByIdentity = new Map(
    currentNonContains.map((record) => [relationIdentity(record), record]),
  );
  const desiredByIdentity = new Map(
    desired.map((relation) => [relationIdentity(relation), relation]),
  );
  const remove = currentNonContains
    .filter((record) => !desiredByIdentity.has(relationIdentity(record)))
    .map(({ id }) => id);
  const insert = desired
    .filter((relation) => !currentByIdentity.has(relationIdentity(relation)))
    .map((relation) => ({
      id: parseCanonical(EntityIdSchema, environment.createId('production_relation')),
      projectId,
      sourceId,
      relation: relation.relation,
      targetId: relation.targetId,
      targetType: relation.targetType,
      ordinal: null,
      createdAt: occurredAt,
    }));
  const unchanged = records.filter(
    (record) => record.relation === 'contains' || desiredByIdentity.has(relationIdentity(record)),
  );
  return { records: [...unchanged, ...insert], writes: { insert, remove, ordinal: [] } };
}

function productionFields(
  object: ProductionObject,
  changedPaths: readonly string[],
): ProductionField[] {
  return changedPaths
    .filter(
      (field): field is ProductionField['field'] =>
        field === 'content' || field === 'relations' || field === 'lifecycle',
    )
    .map((field) => ({ owner: 'production', objectId: object.id, field }));
}

function activeProductionChoiceIds(
  object: ProductionObject,
  fields: readonly ProductionField[],
): string[] {
  const fieldKeys = new Set(fields.map((field) => canonicalJson(field)));
  return [
    ...new Set(
      object.protections
        .filter((protection) => fieldKeys.has(canonicalJson(protection.field)))
        .map((protection) => protection.choiceId),
    ),
  ].sort();
}

function primaryPlanEventId(ids: ProductionMutationPlannedIds): string {
  switch (ids.variant) {
    case 'production_create':
      return ids.parentEventId ?? ids.objectEventId;
    case 'production_update':
    case 'production_archive':
    case 'production_restore':
    case 'production_cite':
      return ids.objectEventId;
    case 'production_relate_link':
    case 'production_relate_unlink':
      return ids.sourceEventId;
    case 'production_reorder':
      return ids.parentEventId;
  }
}

function mutationProposedEffect(
  action: ProductionMutationAction,
  changes: readonly PlannedProductionObjectChange[],
  factSource: PlannedProductionFactSource | null,
): unknown {
  return {
    action,
    objects: changes.map((change) => ({
      id: change.id,
      previousRevision: change.before?.revision ?? null,
      type: change.value.objectType,
      content: change.value.content,
      lifecycle: change.lifecycle,
      relations: change.relations,
      changedPaths: change.changedPaths,
    })),
    factSource:
      factSource === null
        ? null
        : {
            productionObjectId: factSource.productionObjectId,
            field: factSource.field,
            source: factSource.source,
            relation: factSource.relation,
          },
  };
}

function plannedProductionMutation(
  value: Omit<
    PlannedProductionMutation,
    'requestId' | 'expectedProjectRevision' | 'proposedEffect'
  > & { readonly expectedProjectRevision?: number | null },
): PlannedProductionMutation {
  const expectedProjectRevision =
    value.expectedProjectRevision ??
    (value.command?.action === 'create' ? value.command.expectedProjectRevision : null);
  return Object.freeze({
    ...value,
    requestId: primaryPlanEventId(value.ids),
    expectedProjectRevision,
    proposedEffect: mutationProposedEffect(value.action, value.changes, value.factSource),
  });
}

function objectChange(
  before: ProductionObject | null,
  value: ProductionTypedValue,
  lifecycle: ProductionObject['lifecycle'],
  relations: readonly ProductionRelation[],
  resultDecisions: ShotResultDecisions,
  eventId: string,
  changedPaths: readonly string[],
): PlannedProductionObjectChange {
  return {
    id: before?.id ?? '',
    projectId: before?.projectId ?? '',
    before,
    value,
    lifecycle,
    relations,
    resultDecisions,
    eventId,
    changedPaths,
  };
}

function createObjectChange(
  id: string,
  projectId: string,
  value: ProductionTypedValue,
  relations: readonly ProductionRelation[],
  eventId: string,
): PlannedProductionObjectChange {
  return {
    id,
    projectId,
    before: null,
    value,
    lifecycle: 'active',
    relations,
    resultDecisions: [],
    eventId,
    changedPaths: ['content'],
  };
}

function reviseObjectChange(
  before: ProductionObject,
  value: ProductionTypedValue,
  lifecycle: ProductionObject['lifecycle'],
  relations: readonly ProductionRelation[],
  eventId: string,
  changedPaths: readonly string[],
): PlannedProductionObjectChange {
  return {
    ...objectChange(
      before,
      value,
      lifecycle,
      relations,
      before.type === 'shot' ? before.resultDecisions : [],
      eventId,
      changedPaths,
    ),
    id: before.id,
    projectId: before.projectId,
  };
}

function planCreateMutation(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  projectId: string,
  expectedProjectRevision: number,
  value: ProductionTypedValue,
  parent: ProductionObject | null,
  order: number | null,
  nonContainmentRelations: readonly ProductionRelation[],
  occurredAt: string,
  ids: ProductionMutationPlannedIds,
  command: ProductionToolMutationInput | null,
): PlannedProductionMutation {
  if (ids.variant !== 'production_create') {
    throw invalidProductionMutation('Production create requires create planned IDs');
  }
  requireProjectRevision(database, projectId, expectedProjectRevision);
  const childId = ids.productionObjectId;
  const childRelations = validateNonContainmentRelations(
    database,
    projectId,
    childId,
    nonContainmentRelations,
  );
  const childRecords = childRelations.map((relation) => ({
    id: parseCanonical(EntityIdSchema, environment.createId('production_relation')),
    projectId,
    sourceId: childId,
    relation: relation.relation,
    targetId: relation.targetId,
    targetType: relation.targetType,
    ordinal: null,
    createdAt: occurredAt,
  }));
  const childChange = createObjectChange(
    childId,
    projectId,
    value,
    relationValues(childRecords),
    ids.objectEventId,
  );
  const childWrites: ProductionRelationWrites = {
    insert: childRecords,
    remove: [],
    ordinal: [],
  };
  if (parent === null) {
    if (order !== null || ids.containmentRelationId !== null || ids.parentEventId !== null) {
      throw invalidProductionMutation('Production root create cannot have containment IDs');
    }
    return plannedProductionMutation({
      projectId,
      command,
      action: 'create',
      expectedProjectRevision,
      occurredAt,
      ids,
      changes: [childChange],
      relationWrites: childWrites,
      factSource: null,
      watchedProduction: [],
      citedSource: null,
      ownerBefore: null,
      fields: [],
      activeChoiceIds: [],
    });
  }
  if (order === null || ids.containmentRelationId === null || ids.parentEventId === null) {
    throw invalidProductionMutation('Production child create requires containment IDs');
  }
  const parentRecords = relationRecordsFor(database, parent.id);
  const relationship: ProductionRelationRecord = {
    id: ids.containmentRelationId,
    projectId,
    sourceId: parent.id,
    relation: 'contains',
    targetId: childId,
    targetType: value.objectType,
    ordinal: order,
    createdAt: occurredAt,
  };
  const containment = withContainmentInserted(parentRecords, relationship);
  const parentChange = reviseObjectChange(
    parent,
    typedValue(parent),
    parent.lifecycle,
    relationValues(containment.records),
    ids.parentEventId,
    ['relations'],
  );
  const fields = productionFields(parent, parentChange.changedPaths);
  return plannedProductionMutation({
    projectId,
    command,
    action: 'create',
    expectedProjectRevision,
    occurredAt,
    ids,
    changes: [childChange, parentChange],
    relationWrites: mergeRelationWrites(childWrites, containment.writes),
    factSource: null,
    watchedProduction: [parent],
    citedSource: null,
    ownerBefore: productionRef(parent),
    fields,
    activeChoiceIds: activeProductionChoiceIds(parent, fields),
  });
}

function planUpdateMutation(
  database: DatabaseSync,
  projectId: string,
  input: Extract<ProductionToolMutationInput, { action: 'update' }>,
  occurredAt: string,
  ids: ProductionMutationPlannedIds,
): PlannedProductionMutation {
  if (ids.variant !== 'production_update') {
    throw invalidProductionMutation('Production update requires update planned IDs');
  }
  const before = requireProductionRef(database, projectId, input.ref);
  if (before.type !== input.value.objectType) {
    throw invalidProductionMutation('Production object type is immutable');
  }
  if (canonicalJson(before.content) === canonicalJson(input.value.content)) {
    return plannedProductionMutation({
      projectId,
      command: input,
      action: input.action,
      occurredAt,
      ids,
      changes: [],
      relationWrites: EMPTY_RELATION_WRITES,
      factSource: null,
      watchedProduction: [before],
      citedSource: null,
      ownerBefore: productionRef(before),
      fields: [],
      activeChoiceIds: [],
    });
  }
  const change = reviseObjectChange(
    before,
    input.value,
    before.lifecycle,
    before.relations,
    ids.objectEventId,
    ['content'],
  );
  const fields = productionFields(before, change.changedPaths);
  return plannedProductionMutation({
    projectId,
    command: input,
    action: input.action,
    occurredAt,
    ids,
    changes: [change],
    relationWrites: EMPTY_RELATION_WRITES,
    factSource: null,
    watchedProduction: [before],
    citedSource: null,
    ownerBefore: productionRef(before),
    fields,
    activeChoiceIds: activeProductionChoiceIds(before, fields),
  });
}

function planRelateMutation(
  database: DatabaseSync,
  projectId: string,
  input: Extract<ProductionToolMutationInput, { action: 'relate' }>,
  occurredAt: string,
  ids: ProductionMutationPlannedIds,
): PlannedProductionMutation {
  const source = requireProductionRef(database, projectId, input.source.ref);
  const target = requireProductionRef(database, projectId, input.target.ref);
  if (source.id === target.id) {
    throw invalidProductionMutation('Production objects cannot relate to themselves');
  }
  const records = relationRecordsFor(database, source.id);
  const existing = records.find(
    (record) => record.relation === input.relation && record.targetId === target.id,
  );
  const empty = (): PlannedProductionMutation =>
    plannedProductionMutation({
      projectId,
      command: input,
      action: input.action,
      occurredAt,
      ids,
      changes: [],
      relationWrites: EMPTY_RELATION_WRITES,
      factSource: null,
      watchedProduction: [source, target],
      citedSource: null,
      ownerBefore: productionRef(source),
      fields: [],
      activeChoiceIds: [],
    });
  if (input.mode === 'link') {
    if (ids.variant !== 'production_relate_link') {
      throw invalidProductionMutation('Production relation link requires link planned IDs');
    }
    if (existing !== undefined) {
      if (existing.ordinal !== input.ordinal) {
        throw invalidProductionMutation('Production relation already exists with another ordinal');
      }
      return empty();
    }
    let relationWrites: ProductionRelationWrites;
    let afterRecords: ProductionRelationRecord[];
    const relation: ProductionRelationRecord = {
      id: ids.relationId,
      projectId,
      sourceId: source.id,
      relation: input.relation,
      targetId: target.id,
      targetType: target.type,
      ordinal: input.ordinal,
      createdAt: occurredAt,
    };
    if (input.relation === 'contains') {
      assertChildHasNoParent(database, projectId, target.id);
      assertNoContainmentCycle(database, source.id, target.id);
      const containment = withContainmentInserted(records, relation);
      afterRecords = containment.records;
      relationWrites = containment.writes;
    } else {
      afterRecords = [...records, relation];
      relationWrites = { insert: [relation], remove: [], ordinal: [] };
    }
    const change = reviseObjectChange(
      source,
      typedValue(source),
      source.lifecycle,
      relationValues(afterRecords),
      ids.sourceEventId,
      ['relations'],
    );
    const fields = productionFields(source, change.changedPaths);
    return plannedProductionMutation({
      projectId,
      command: input,
      action: input.action,
      occurredAt,
      ids,
      changes: [change],
      relationWrites,
      factSource: null,
      watchedProduction: [source, target],
      citedSource: null,
      ownerBefore: productionRef(source),
      fields,
      activeChoiceIds: activeProductionChoiceIds(source, fields),
    });
  }
  if (ids.variant !== 'production_relate_unlink') {
    throw invalidProductionMutation('Production relation unlink requires unlink planned IDs');
  }
  if (existing === undefined) return empty();
  const removed = withRelationRemoved(records, existing);
  const change = reviseObjectChange(
    source,
    typedValue(source),
    source.lifecycle,
    relationValues(removed.records),
    ids.sourceEventId,
    ['relations'],
  );
  const fields = productionFields(source, change.changedPaths);
  return plannedProductionMutation({
    projectId,
    command: input,
    action: input.action,
    occurredAt,
    ids,
    changes: [change],
    relationWrites: removed.writes,
    factSource: null,
    watchedProduction: [source, target],
    citedSource: null,
    ownerBefore: productionRef(source),
    fields,
    activeChoiceIds: activeProductionChoiceIds(source, fields),
  });
}

function planReorderMutation(
  database: DatabaseSync,
  projectId: string,
  input: Extract<ProductionToolMutationInput, { action: 'reorder' }>,
  occurredAt: string,
  ids: ProductionMutationPlannedIds,
): PlannedProductionMutation {
  if (ids.variant !== 'production_reorder') {
    throw invalidProductionMutation('Production reorder requires reorder planned IDs');
  }
  const parent = requireProductionRef(database, projectId, input.parent.ref);
  const records = relationRecordsFor(database, parent.id);
  assertDenseContainment(records);
  const children = records
    .filter(({ relation }) => relation === 'contains')
    .sort((left, right) => left.ordinal! - right.ordinal!);
  const currentIds = children.map(({ targetId }) => targetId);
  if (
    currentIds.length !== input.orderedChildIds.length ||
    [...currentIds].sort().join('\u0000') !== [...input.orderedChildIds].sort().join('\u0000')
  ) {
    throw invalidProductionMutation('Production reorder must name exactly the current children');
  }
  const order = new Map(input.orderedChildIds.map((id, index) => [id, index]));
  const afterRecords = records.map((record) =>
    record.relation === 'contains' ? { ...record, ordinal: order.get(record.targetId)! } : record,
  );
  const ordinal = afterRecords
    .filter((record, index) => record.ordinal !== records[index]!.ordinal)
    .map(({ id, ordinal: nextOrdinal }) => ({ id, ordinal: nextOrdinal! }));
  if (ordinal.length === 0) {
    return plannedProductionMutation({
      projectId,
      command: input,
      action: input.action,
      occurredAt,
      ids,
      changes: [],
      relationWrites: EMPTY_RELATION_WRITES,
      factSource: null,
      watchedProduction: [parent],
      citedSource: null,
      ownerBefore: productionRef(parent),
      fields: [],
      activeChoiceIds: [],
    });
  }
  const change = reviseObjectChange(
    parent,
    typedValue(parent),
    parent.lifecycle,
    relationValues(afterRecords),
    ids.parentEventId,
    ['relations'],
  );
  const fields = productionFields(parent, change.changedPaths);
  return plannedProductionMutation({
    projectId,
    command: input,
    action: input.action,
    occurredAt,
    ids,
    changes: [change],
    relationWrites: { insert: [], remove: [], ordinal },
    factSource: null,
    watchedProduction: [parent],
    citedSource: null,
    ownerBefore: productionRef(parent),
    fields,
    activeChoiceIds: activeProductionChoiceIds(parent, fields),
  });
}

function planLifecycleMutation(
  database: DatabaseSync,
  projectId: string,
  input: Extract<ProductionToolMutationInput, { action: 'archive' | 'restore' }>,
  occurredAt: string,
  ids: ProductionMutationPlannedIds,
): PlannedProductionMutation {
  const before = requireProductionRef(database, projectId, input.ref);
  const expectedLifecycle = input.action === 'archive' ? 'archived' : 'active';
  if (before.lifecycle === 'deleted') {
    throw invalidProductionMutation('Deleted Production objects cannot be archived or restored');
  }
  if (before.lifecycle === expectedLifecycle) {
    return plannedProductionMutation({
      projectId,
      command: input,
      action: input.action,
      occurredAt,
      ids,
      changes: [],
      relationWrites: EMPTY_RELATION_WRITES,
      factSource: null,
      watchedProduction: [before],
      citedSource: null,
      ownerBefore: productionRef(before),
      fields: [],
      activeChoiceIds: [],
    });
  }
  const eventId =
    ids.variant === 'production_archive' || ids.variant === 'production_restore'
      ? ids.objectEventId
      : (() => {
          throw invalidProductionMutation(
            'Production lifecycle planned IDs do not match its action',
          );
        })();
  const change = reviseObjectChange(
    before,
    typedValue(before),
    expectedLifecycle,
    before.relations,
    eventId,
    ['lifecycle'],
  );
  const fields = productionFields(before, change.changedPaths);
  return plannedProductionMutation({
    projectId,
    command: input,
    action: input.action,
    occurredAt,
    ids,
    changes: [change],
    relationWrites: EMPTY_RELATION_WRITES,
    factSource: null,
    watchedProduction: [before],
    citedSource: null,
    ownerBefore: productionRef(before),
    fields,
    activeChoiceIds: activeProductionChoiceIds(before, fields),
  });
}

function planCitationMutation(
  database: DatabaseSync,
  projectId: string,
  input: Extract<ProductionToolMutationInput, { action: 'cite' }>,
  occurredAt: string,
  ids: ProductionMutationPlannedIds,
): PlannedProductionMutation {
  if (ids.variant !== 'production_cite') {
    throw invalidProductionMutation('Production citation requires citation planned IDs');
  }
  const before = requireProductionRef(database, projectId, input.ref);
  assertCitationField(before, input.field);
  const source = requireCurrentDomainObject(database, projectId, input.sourceRef).ref;
  const existing = database
    .prepare(
      `SELECT relation, source_hash FROM production_fact_sources
       WHERE production_object_id = ? AND field_ref = ? AND source_authority = ?
         AND source_id = ? AND source_revision = ?`,
    )
    .get(before.id, input.field, source.authority, source.id, source.revision) as unknown as
    { relation: string; source_hash: string } | undefined;
  if (existing !== undefined) {
    if (existing.relation !== input.relation || existing.source_hash !== source.contentHash) {
      throw invalidProductionMutation(
        'The cited source already has a different relation for this field',
      );
    }
    return plannedProductionMutation({
      projectId,
      command: input,
      action: input.action,
      occurredAt,
      ids,
      changes: [],
      relationWrites: EMPTY_RELATION_WRITES,
      factSource: null,
      watchedProduction: [before],
      citedSource: source,
      ownerBefore: productionRef(before),
      fields: [],
      activeChoiceIds: [],
    });
  }
  const factSource: PlannedProductionFactSource = {
    id: ids.factSourceId,
    productionObjectId: before.id,
    field: input.field,
    source,
    relation: input.relation,
    createdAt: occurredAt,
  };
  const change = reviseObjectChange(
    before,
    typedValue(before),
    before.lifecycle,
    before.relations,
    ids.objectEventId,
    ['citations'],
  );
  return plannedProductionMutation({
    projectId,
    command: input,
    action: input.action,
    occurredAt,
    ids,
    changes: [change],
    relationWrites: EMPTY_RELATION_WRITES,
    factSource,
    watchedProduction: [before],
    citedSource: source,
    ownerBefore: productionRef(before),
    fields: [],
    activeChoiceIds: [],
  });
}

export function planProductionMutationInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  projectIdValue: string,
  inputValue: ProductionToolMutationInput,
  occurredAtInput: string,
  plannedIdsInput?: ProductionMutationPlannedIds,
): PlannedProductionMutation {
  if (!database.isTransaction) {
    throw invalidProductionMutation('Production mutation planning requires an active transaction');
  }
  const projectId = parseCanonical(EntityIdSchema, projectIdValue);
  const input = ProductionMutateDefinition.parseInput(inputValue);
  const occurredAt = parseCanonical(IsoTimestampSchema, occurredAtInput);
  const ids = exactProductionMutationIds(
    plannedIdsInput ?? generatedProductionMutationIds(environment, input),
    input,
  );
  switch (input.action) {
    case 'create': {
      const parent =
        input.parentRef === null
          ? null
          : requireProductionRef(database, projectId, input.parentRef);
      return planCreateMutation(
        database,
        environment,
        projectId,
        input.expectedProjectRevision,
        input.value,
        parent,
        input.order,
        [],
        occurredAt,
        ids,
        input,
      );
    }
    case 'update':
      return planUpdateMutation(database, projectId, input, occurredAt, ids);
    case 'relate':
      return planRelateMutation(database, projectId, input, occurredAt, ids);
    case 'reorder':
      return planReorderMutation(database, projectId, input, occurredAt, ids);
    case 'archive':
    case 'restore':
      return planLifecycleMutation(database, projectId, input, occurredAt, ids);
    case 'cite':
      return planCitationMutation(database, projectId, input, occurredAt, ids);
  }
}

function materializeProductionObject(
  change: PlannedProductionObjectChange,
  context: TargetCommandContext,
  occurredAt: string,
): ProductionObject {
  const before = change.before;
  return finalizeTypedProductionObject(
    {
      authority: 'production',
      id: change.id,
      projectId: change.projectId,
      revision: before === null ? 0 : before.revision + 1,
      lifecycle: change.lifecycle,
      relations: [...change.relations],
      protections: before?.protections ?? [],
      createdBy: before?.createdBy ?? context.causation,
      updatedBy: context.causation,
      createdAt: before?.createdAt ?? occurredAt,
      updatedAt: occurredAt,
    },
    change.value,
    change.resultDecisions,
  );
}

function assertProductionPlanCurrent(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  planned: PlannedProductionMutation,
): void {
  if (planned.expectedProjectRevision !== null) {
    requireProjectRevision(database, planned.projectId, planned.expectedProjectRevision);
  }
  if (planned.command !== null) {
    let current: PlannedProductionMutation;
    try {
      current = planProductionMutationInTransaction(
        database,
        environment,
        planned.projectId,
        planned.command,
        planned.occurredAt,
        planned.ids,
      );
    } catch (cause) {
      if (cause instanceof TargetStorageError && cause.code === 'CORRUPT_DATA') throw cause;
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        'Production mutation changed before commit',
        { cause },
      );
    }
    if (canonicalJson(current) !== canonicalJson(planned)) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        'Production mutation changed before commit',
      );
    }
    return;
  }
  for (const before of planned.watchedProduction) {
    const current = requireProductionRef(database, planned.projectId, productionRef(before));
    if (canonicalJson(current) !== canonicalJson(before)) {
      throw new TargetStorageError('REVISION_CONFLICT', `Production ${before.id} changed`);
    }
  }
  if (planned.citedSource !== null) {
    requireCurrentDomainObject(database, planned.projectId, planned.citedSource);
  }
}

function insertFactSource(database: DatabaseSync, source: PlannedProductionFactSource): void {
  database
    .prepare(
      `INSERT INTO production_fact_sources (
       id, production_object_id, field_ref, source_authority, source_id,
       source_revision, source_hash, relation, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      source.id,
      source.productionObjectId,
      source.field,
      source.source.authority,
      source.source.id,
      source.source.revision,
      source.source.contentHash,
      source.relation,
      source.createdAt,
    );
}

function appendPlannedProductionEvent(
  database: DatabaseSync,
  planned: PlannedProductionMutation,
  context: TargetCommandContext,
  before: ProductionObject | null,
  after: ProductionObject,
  eventId: string,
): void {
  appendProjectEvent(database, {
    eventId,
    projectId: after.projectId,
    occurredAt: planned.occurredAt,
    actor: context.actor,
    subject: { authority: 'production', id: after.id },
    causation: context.causation,
    correlationId: context.correlationId,
    idempotencyKey: eventId,
    payload:
      before === null
        ? { type: 'object_created', revision: 0, contentHash: after.contentHash }
        : {
            type: 'object_revision_changed',
            beforeRevision: before.revision,
            afterRevision: after.revision,
            beforeHash: before.contentHash,
            afterHash: after.contentHash,
          },
  });
}

export function commitPlannedProductionMutationInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  planned: PlannedProductionMutation,
  contextInput: TargetCommandContext,
  host?: CommandDispatchHost,
): CommittedProductionMutation {
  if (!database.isTransaction) {
    throw invalidProductionMutation('Production mutation commit requires an active transaction');
  }
  const context = parseCanonical(TargetCommandContextSchema, contextInput);
  assertProductionPlanCurrent(database, environment, planned);
  if (planned.ownerBefore !== null && planned.fields.length > 0) {
    const owner = requireProductionRef(database, planned.projectId, planned.ownerBefore);
    assertProductionProtectionMutation(database, {
      projectId: planned.projectId,
      owner: planned.ownerBefore,
      fields: planned.fields,
      activeProtections: owner.protections,
      proposedEffect: planned.proposedEffect,
      plannedIds: planned.ids,
      context,
      host,
    });
  }
  if (planned.changes.length === 0) {
    return Object.freeze({
      action: planned.action,
      receipts: Object.freeze([]),
      primaryEventId: null,
    });
  }
  const afterById = new Map<string, ProductionObject>();
  for (const change of planned.changes) {
    const after = materializeProductionObject(change, context, planned.occurredAt);
    afterById.set(change.id, after);
    writeProductionObject(database, after, change.before);
  }
  writeRelationChanges(database, planned.relationWrites);
  if (planned.factSource !== null) insertFactSource(database, planned.factSource);
  const receipts: ProductionMutationReceipt[] = [];
  for (const change of planned.changes) {
    const after = afterById.get(change.id)!;
    const persisted = loadProductionObject(database, after.id);
    if (canonicalJson(persisted) !== canonicalJson(after)) {
      throw corruptProductionMutation(`Production ${after.id} persisted outside its mutation plan`);
    }
    appendPlannedProductionEvent(
      database,
      planned,
      context,
      change.before,
      persisted,
      change.eventId,
    );
    updateProductionSearchDocument(database, environment, persisted);
    receipts.push({
      object: productionRef(persisted),
      previousRevision: change.before?.revision ?? null,
      eventId: change.eventId,
      changedPaths: [...change.changedPaths],
      undoRef: null,
    });
  }
  return Object.freeze({
    action: planned.action,
    receipts: Object.freeze(receipts),
    primaryEventId: primaryPlanEventId(planned.ids),
  });
}

export function productionMutationToolSuccess(
  committed: CommittedProductionMutation,
): ProductionToolMutationSuccess {
  return ProductionMutateDefinition.parseSuccess({ receipts: committed.receipts });
}

export function primaryProductionMutationEventId(
  committed: CommittedProductionMutation,
): string | null {
  return committed.primaryEventId;
}

function wireProductionMutationIds(
  environment: TargetStorageEnvironment,
  variant: Extract<
    ProductionMutationPlannedIds['variant'],
    'production_create' | 'production_update' | 'production_cite'
  >,
  hasCreateParent = false,
): ProductionMutationPlannedIds {
  return productionMutationIdsForVariant(variant, hasCreateParent, (kind) =>
    environment.createId(kind),
  );
}

function planWireProductionMutationInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  request: Request<'production.apply'>,
  occurredAt: string,
): PlannedProductionMutation {
  if (request.input.action === 'create') {
    const containment = request.input.relations.filter(({ relation }) => relation === 'contains');
    if (containment.length > 1) {
      throw invalidProductionMutation(
        'Production wire create accepts at most one containment parent',
      );
    }
    const parentRelation = containment[0] ?? null;
    const parent =
      parentRelation === null
        ? null
        : requireProductionRef(database, request.input.projectId, {
            id: parentRelation.targetId,
            revision: loadProductionObject(database, parentRelation.targetId).revision,
            contentHash: loadProductionObject(database, parentRelation.targetId).contentHash,
          });
    if (parent !== null && parent.type !== parentRelation!.targetType) {
      throw invalidProductionMutation('Production wire containment parent type does not match');
    }
    return planCreateMutation(
      database,
      environment,
      request.input.projectId,
      request.input.expectedProjectRevision,
      request.input.value,
      parent,
      parentRelation?.ordinal ?? null,
      request.input.relations.filter(({ relation }) => relation !== 'contains'),
      occurredAt,
      wireProductionMutationIds(environment, 'production_create', parent !== null),
      null,
    );
  }
  if (request.input.action === 'cite') {
    const before = requireProductionRef(database, request.input.projectId, request.input.ref);
    const parsed = ProductionMutateDefinition.parseInput({
      action: 'cite',
      ref: productionRef(before),
      expectedRevision: before.revision,
      expectedContentHash: before.contentHash,
      field: request.input.field,
      sourceRef: request.input.source,
      relation: request.input.relation,
    });
    if (parsed.action !== 'cite')
      throw corruptProductionMutation('Production wire citation changed');
    return planCitationMutation(
      database,
      request.input.projectId,
      parsed,
      occurredAt,
      wireProductionMutationIds(environment, 'production_cite'),
    );
  }
  const before = requireProductionRef(database, request.input.projectId, request.input.ref);
  if (before.type !== request.input.value.objectType) {
    throw invalidProductionMutation('Production object type is immutable');
  }
  const desiredNonContains = validateNonContainmentRelations(
    database,
    before.projectId,
    before.id,
    request.input.relations,
  );
  const records = relationRecordsFor(database, before.id);
  const replacement = nonContainmentReplacementWrites(
    environment,
    before.projectId,
    before.id,
    records,
    desiredNonContains,
    occurredAt,
  );
  const contentChanged =
    canonicalJson(before.content) !== canonicalJson(request.input.value.content);
  const relationsChanged =
    canonicalJson(before.relations) !== canonicalJson(relationValues(replacement.records));
  const lifecycleChanged = before.lifecycle !== request.input.lifecycle;
  const changedPaths = [
    ...(contentChanged ? ['content'] : []),
    ...(relationsChanged ? ['relations'] : []),
    ...(lifecycleChanged ? ['lifecycle'] : []),
  ];
  const ids = wireProductionMutationIds(environment, 'production_update');
  if (ids.variant !== 'production_update') {
    throw corruptProductionMutation('Production wire replacement planned IDs changed');
  }
  if (changedPaths.length === 0) {
    return plannedProductionMutation({
      projectId: before.projectId,
      command: null,
      action: 'update',
      occurredAt,
      ids,
      changes: [],
      relationWrites: EMPTY_RELATION_WRITES,
      factSource: null,
      watchedProduction: [before],
      citedSource: null,
      ownerBefore: productionRef(before),
      fields: [],
      activeChoiceIds: [],
    });
  }
  const change = reviseObjectChange(
    before,
    request.input.value,
    request.input.lifecycle,
    relationValues(replacement.records),
    ids.objectEventId,
    changedPaths,
  );
  const fields = productionFields(before, changedPaths);
  return plannedProductionMutation({
    projectId: before.projectId,
    command: null,
    action: 'update',
    occurredAt,
    ids,
    changes: [change],
    relationWrites: replacement.writes,
    factSource: null,
    watchedProduction: [before],
    citedSource: null,
    ownerBefore: productionRef(before),
    fields,
    activeChoiceIds: activeProductionChoiceIds(before, fields),
  });
}

function applyProduction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  request: Request<'production.apply'>,
  context: TargetCommandContext,
  host?: CommandDispatchHost,
): Success<'production.apply'> {
  const now = environment.now();
  return executeWireMutation(
    database,
    request,
    context,
    now,
    () => {
      const planned = planWireProductionMutationInTransaction(database, environment, request, now);
      const committed = commitPlannedProductionMutationInTransaction(
        database,
        environment,
        planned,
        context,
        host,
      );
      const primary = committed.receipts[0]?.object;
      if (primary === undefined) {
        const before = planned.watchedProduction[0];
        if (before === undefined) {
          throw corruptProductionMutation('Production create cannot complete without a receipt');
        }
        return {
          projectId: planned.projectId,
          response: success<'production.apply'>(request, loadProductionView(database, before.id)),
        };
      }
      return {
        projectId: planned.projectId,
        response: success<'production.apply'>(request, loadProductionView(database, primary.id)),
      };
    },
    host,
  );
}

function encodeProductionCursor(value: z.output<typeof ProductionCursorSchema>): string {
  return encodeOpaqueCursor('production.query', canonicalJson(value));
}

function decodeProductionCursor(cursor: string): z.output<typeof ProductionCursorSchema> {
  try {
    const encoded = decodeOpaqueCursor(cursor, 'production.query');
    if (encoded === null) throw new Error('Missing cursor payload');
    return parseCanonical(ProductionCursorSchema, JSON.parse(encoded) as unknown);
  } catch (cause) {
    throw new TargetStorageError('INVALID_REQUEST', 'Production query cursor is invalid', {
      cause,
    });
  }
}

function queryProduction(
  database: DatabaseSync,
  request: Request<'production.query'>,
): Success<'production.query'> {
  if (
    database.prepare('SELECT 1 FROM projects WHERE id = ?').get(request.input.projectId) ===
    undefined
  ) {
    throw new TargetStorageError('NOT_FOUND', `Project ${request.input.projectId} was not found`);
  }
  const filterHash = hashCanonical({
    projectId: request.input.projectId,
    ids: [...request.input.ids].sort(),
    types: [...request.input.types].sort(),
    includeArchived: request.input.includeArchived,
    includeFactSources: request.input.includeFactSources,
  });
  const cursor =
    request.input.page.cursor === null ? null : decodeProductionCursor(request.input.page.cursor);
  if (cursor !== null && cursor.filterHash !== filterHash) {
    throw new TargetStorageError('INVALID_REQUEST', 'Production cursor belongs to another query');
  }
  const idClause =
    request.input.ids.length === 0
      ? ''
      : ` AND id IN (${request.input.ids.map(() => '?').join(',')})`;
  const typeClause =
    request.input.types.length === 0
      ? ''
      : ` AND object_type IN (${request.input.types.map(() => '?').join(',')})`;
  const lifecycleClause = request.input.includeArchived
    ? ` AND lifecycle IN ('active', 'archived')`
    : ` AND lifecycle = 'active'`;
  const cursorClause =
    cursor === null ? '' : ' AND (object_type > ? OR (object_type = ? AND id > ?))';
  const parameters: Array<string | number> = [
    request.input.projectId,
    ...request.input.ids,
    ...request.input.types,
  ];
  if (cursor !== null) parameters.push(cursor.type, cursor.type, cursor.id);
  parameters.push(request.input.page.limit + 1);
  const rows = database
    .prepare(
      `SELECT id, object_type FROM production_objects
       WHERE project_id = ?${idClause}${typeClause}${lifecycleClause}${cursorClause}
       ORDER BY object_type, id LIMIT ?`,
    )
    .all(...parameters) as unknown as Array<{ id: string; object_type: ProductionObjectType }>;
  const hasMore = rows.length > request.input.page.limit;
  const pageRows = rows.slice(0, request.input.page.limit);
  const last = pageRows.at(-1);
  return success<'production.query'>(request, {
    items: pageRows.map((row) =>
      loadProductionView(database, row.id, request.input.includeFactSources),
    ),
    nextCursor:
      hasMore && last !== undefined
        ? encodeProductionCursor({ filterHash, type: last.object_type, id: last.id })
        : null,
  });
}

function productionToolTitleAndSummary(object: ProductionObject): {
  title: string;
  summary: string;
} {
  switch (object.type) {
    case 'direction':
      return { title: 'Creative direction', summary: object.content.summary };
    case 'story':
      return { title: object.content.title, summary: object.content.premise };
    case 'sequence':
    case 'scene':
    case 'beat':
      return { title: object.content.title, summary: object.content.summary };
    case 'character':
    case 'location':
    case 'equipment':
    case 'prop':
    case 'wardrobe':
    case 'world_fact':
      return { title: object.content.name, summary: object.content.description };
    case 'shot':
      return { title: object.content.title, summary: object.content.description };
  }
}

function productionToolView(
  database: DatabaseSync,
  object: ProductionObject,
  include: ProductionToolQueryInput['include'],
) {
  const { title, summary } = productionToolTitleAndSummary(object);
  return {
    ref: {
      authority: 'production' as const,
      id: object.id,
      revision: object.revision,
      contentHash: object.contentHash,
    },
    type: object.type,
    lifecycle: object.lifecycle,
    title,
    summary,
    sections: include.map((section) => {
      switch (section) {
        case 'content':
          return {
            section,
            content: { objectType: object.type, content: object.content },
          };
        case 'relations':
          return { section, relations: object.relations };
        case 'citations':
          return { section, factSources: factSourcesFor(database, object.id) };
        case 'protections':
          return { section, protections: object.protections };
      }
    }),
  };
}

function decodeProductionToolCursor(cursor: string | null) {
  if (cursor === null) return null;
  try {
    const encoded = decodeOpaqueCursor(cursor, ProductionQueryDefinition.id);
    if (encoded === null) throw new Error('Missing cursor payload');
    return parseCanonical(ProductionCursorSchema, JSON.parse(encoded) as unknown);
  } catch (cause) {
    throw new TargetStorageError('INVALID_REQUEST', 'Production tool query cursor is invalid', {
      cause,
    });
  }
}

function queryProductionTool(
  database: DatabaseSync,
  projectIdValue: string,
  inputValue: ProductionToolQueryInput,
): ProductionToolQuerySuccess {
  const projectId = parseCanonical(EntityIdSchema, projectIdValue);
  if (database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId) === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Project ${projectId} was not found`);
  }
  const input = ProductionQueryDefinition.parseInput(inputValue);
  for (const ref of input.refs) requireProductionRef(database, projectId, ref);
  if (input.parentRef !== null) requireProductionRef(database, projectId, input.parentRef);
  const refs = [...input.refs].sort((left, right) => {
    const leftValue = canonicalJson(left);
    const rightValue = canonicalJson(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  });
  const filterHash = hashCanonical({
    projectId,
    refs,
    kinds: [...input.kinds].sort(),
    parentRef: input.parentRef,
    relation: input.relation,
    include: input.include,
  });
  const cursor = decodeProductionToolCursor(input.page.cursor);
  if (cursor !== null && cursor.filterHash !== filterHash) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Production tool query cursor belongs to another query',
    );
  }
  const clauses = ['object.project_id = ?', "object.lifecycle <> 'deleted'"];
  const parameters: Array<string | number> = [projectId];
  if (input.refs.length > 0) {
    clauses.push(`object.id IN (${input.refs.map(() => '?').join(', ')})`);
    parameters.push(...input.refs.map(({ id }) => id));
  }
  if (input.kinds.length > 0) {
    clauses.push(`object.object_type IN (${input.kinds.map(() => '?').join(', ')})`);
    parameters.push(...input.kinds);
  }
  if (input.parentRef !== null) {
    clauses.push(
      `EXISTS (
         SELECT 1 FROM production_relations AS parent_relation
         WHERE parent_relation.project_id = object.project_id
           AND parent_relation.source_object_id = ?
           AND parent_relation.target_object_id = object.id
           AND parent_relation.relation = 'contains'
       )`,
    );
    parameters.push(input.parentRef.id);
  }
  if (input.relation !== null) {
    clauses.push(
      `EXISTS (
         SELECT 1 FROM production_relations AS relation
         WHERE relation.project_id = object.project_id
           AND relation.source_object_id = object.id
           AND relation.relation = ?
       )`,
    );
    parameters.push(input.relation);
  }
  if (cursor !== null) {
    clauses.push('(object.object_type > ? OR (object.object_type = ? AND object.id > ?))');
    parameters.push(cursor.type, cursor.type, cursor.id);
  }
  parameters.push(input.page.limit + 1);
  const rows = database
    .prepare(
      `SELECT object.id, object.object_type
       FROM production_objects AS object
       WHERE ${clauses.join(' AND ')}
       ORDER BY object.object_type, object.id
       LIMIT ?`,
    )
    .all(...parameters) as unknown as Array<{ id: string; object_type: ProductionObjectType }>;
  const pageRows = rows.slice(0, input.page.limit);
  const items = pageRows.map((row) => {
    const object = loadProductionObject(database, row.id);
    if (object.projectId !== projectId || object.type !== row.object_type) {
      throw new TargetStorageError(
        'CORRUPT_DATA',
        `Production object ${object.id} no longer matches its query row`,
      );
    }
    return productionToolView(database, object, input.include);
  });
  const last = pageRows.at(-1);
  return ProductionQueryDefinition.parseSuccess({
    items,
    nextCursor:
      rows.length > pageRows.length && last !== undefined
        ? encodeOpaqueCursor(
            ProductionQueryDefinition.id,
            canonicalJson({ filterHash, type: last.object_type, id: last.id }),
          )
        : null,
  });
}

export interface ProductionAuthority {
  readonly apply: (
    request: Request<'production.apply'>,
    context: TargetCommandContext,
    host?: CommandDispatchHost,
  ) => Success<'production.apply'>;
  readonly get: (
    productionObjectId: string,
    includeFactSources?: boolean,
  ) => ProductionObjectViewV1;
  readonly query: (request: Request<'production.query'>) => Success<'production.query'>;
  readonly queryTool: (
    projectId: string,
    input: ProductionToolQueryInput,
  ) => ProductionToolQuerySuccess;
}

export function createProductionAuthority(
  store: TargetStore,
  environment: TargetStorageEnvironment,
): ProductionAuthority {
  const authority: ProductionAuthority = {
    apply(request, context, host) {
      return applyProduction(
        getTargetStoreDatabase(store),
        environment,
        exactRequest(request, 'production.apply'),
        context,
        host,
      );
    },
    get(productionObjectId, includeFactSources = true) {
      return loadProductionView(
        getTargetStoreDatabase(store),
        parseCanonical(EntityIdSchema, productionObjectId),
        includeFactSources,
      );
    },
    query(request) {
      return queryProduction(
        getTargetStoreDatabase(store),
        exactRequest(request, 'production.query'),
      );
    },
    queryTool(projectId, input) {
      return queryProductionTool(getTargetStoreDatabase(store), projectId, input);
    },
  };
  return Object.freeze(authority);
}

export type { CommandDispatchHost as ProductionCommandHost };
