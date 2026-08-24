import {
  ActiveProtectionSchema,
  DeliveryFormatIntentSchema,
  DeliveryItemSchema,
  DeliveryPlanSchema,
  canonicalJson,
  deliveryPlanContentHashInput,
  parseCanonical,
  type DeliveryItem,
  type DeliveryPlan,
  type ProtectedFieldRef,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import { decodeCanonicalRecord, decodeProtectedFieldRef } from './canonical-codecs.js';
import type { TargetStorageEnvironment } from './environment.js';
import { hashCanonical, hashContentObject } from './hashes.js';
import { upsertProjectSearchDocument } from './search-projection.js';
import { loadUserChoiceRecord } from './user-choice-records.js';

const ZERO_HASH = '0'.repeat(64);
const ORDER_SHIFT = 1_000_000_000;
type DeliveryProtectedFieldRef = Extract<ProtectedFieldRef, { owner: 'delivery' }>;

interface DeliveryPlanRow {
  id: string;
  project_id: string;
  revision: number;
  content_hash: string;
  name: string;
  lifecycle: DeliveryPlan['lifecycle'];
  format_intent_v1_json: string;
  created_at: string;
  updated_at: string;
}

interface DeliveryItemRow {
  id: string;
  delivery_plan_id: string;
  revision: number;
  content_hash: string;
  lifecycle: DeliveryItem['lifecycle'];
  removed_at: string | null;
  shot_id: string;
  shot_revision: number;
  shot_content_hash: string;
  generated_result_id: string;
  generated_result_revision: 0;
  generated_result_content_hash: string;
  project_media_ref_id: string;
  project_media_revision: number;
  project_media_content_hash: string;
  ordinal: number;
  trim_start_ms: number;
  trim_end_ms: number;
  audio_policy: DeliveryItem['audioPolicy'];
  transition_kind: DeliveryItem['transition']['kind'];
  transition_duration_ms: number;
  review_state: DeliveryItem['reviewState'];
}

interface DeliveryFieldRow {
  delivery_item_id: string | null;
  field_ref: string;
  choice_id: string;
}

interface DeliveryProtectionRow extends DeliveryFieldRow {
  protected_at: string;
}

function corrupt(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'CORRUPT_DATA',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function fieldKey(field: ProtectedFieldRef): string {
  return canonicalJson(field);
}

function sameItemSemantic(left: DeliveryItem, right: DeliveryItem): boolean {
  const { id: _leftId, revision: _leftRevision, contentHash: _leftHash, ...leftValue } = left;
  const { id: _rightId, revision: _rightRevision, contentHash: _rightHash, ...rightValue } = right;
  return canonicalJson(leftValue) === canonicalJson(rightValue);
}

function itemFromRow(row: DeliveryItemRow): DeliveryItem {
  const item = parseCanonical(DeliveryItemSchema, {
    id: row.id,
    revision: row.revision,
    contentHash: row.content_hash,
    lifecycle: row.lifecycle,
    removedAt: row.removed_at,
    shot: {
      authority: 'production',
      id: row.shot_id,
      revision: row.shot_revision,
      contentHash: row.shot_content_hash,
    },
    result: {
      authority: 'generated_result',
      id: row.generated_result_id,
      revision: row.generated_result_revision,
      contentHash: row.generated_result_content_hash,
    },
    projectMedia: {
      authority: 'project_media_ref',
      id: row.project_media_ref_id,
      revision: row.project_media_revision,
      contentHash: row.project_media_content_hash,
    },
    order: row.ordinal,
    trimStartMs: row.trim_start_ms,
    trimEndMs: row.trim_end_ms,
    audioPolicy: row.audio_policy,
    transition: {
      kind: row.transition_kind,
      durationMs: row.transition_duration_ms,
    },
    reviewState: row.review_state,
  });
  if (hashContentObject(item) !== item.contentHash) {
    throw corrupt(`Delivery item ${item.id} content hash does not match`);
  }
  return item;
}

function loadFields(database: DatabaseSync, planId: string): DeliveryPlan['currentChoices'] {
  const rows = database
    .prepare(
      `SELECT delivery_item_id, field_ref, choice_id
       FROM delivery_field_choices
       WHERE delivery_plan_id = ?
       ORDER BY field_ref, choice_id`,
    )
    .all(planId) as unknown as DeliveryFieldRow[];
  return rows.map((row) => {
    const field = decodeProtectedFieldRef(row.field_ref);
    if (
      field.owner !== 'delivery' ||
      field.deliveryId !== planId ||
      field.itemId !== row.delivery_item_id
    ) {
      throw corrupt(`Delivery ${planId} current Choice field has the wrong owner`);
    }
    const choice = loadUserChoiceRecord(database, row.choice_id);
    if (
      choice.ownerAfter.authority !== 'delivery' ||
      choice.ownerAfter.id !== planId ||
      choice.subject.kind !== 'delivery'
    ) {
      throw corrupt(`Delivery ${planId} current Choice ${choice.id} has the wrong owner`);
    }
    return { field, choiceId: choice.id };
  });
}

function loadProtections(database: DatabaseSync, planId: string): DeliveryPlan['protections'] {
  const rows = database
    .prepare(
      `SELECT delivery_item_id, field_ref, choice_id, protected_at
       FROM delivery_protections
       WHERE delivery_plan_id = ? AND released_by_choice_id IS NULL
       ORDER BY field_ref, protected_at, id`,
    )
    .all(planId) as unknown as DeliveryProtectionRow[];
  return rows.map((row) => {
    const field = decodeProtectedFieldRef(row.field_ref);
    if (
      field.owner !== 'delivery' ||
      field.deliveryId !== planId ||
      field.itemId !== row.delivery_item_id
    ) {
      throw corrupt(`Delivery ${planId} protection field has the wrong owner`);
    }
    const choice = loadUserChoiceRecord(database, row.choice_id);
    if (
      choice.ownerAfter.authority !== 'delivery' ||
      choice.ownerAfter.id !== planId ||
      choice.afterEffect.kind !== 'protection' ||
      !choice.afterEffect.active ||
      canonicalJson(choice.afterEffect.field) !== canonicalJson(field)
    ) {
      throw corrupt(`Delivery ${planId} protection Choice ${choice.id} does not match`);
    }
    return parseCanonical(ActiveProtectionSchema, {
      field,
      choiceId: choice.id,
      protectedAt: row.protected_at,
    });
  });
}

export function finalizeDeliveryItem(value: Omit<DeliveryItem, 'contentHash'>): DeliveryItem {
  const normalized = parseCanonical(DeliveryItemSchema, { ...value, contentHash: ZERO_HASH });
  return parseCanonical(DeliveryItemSchema, {
    ...normalized,
    contentHash: hashContentObject(normalized),
  });
}

export function finalizeDeliveryPlan(value: Omit<DeliveryPlan, 'contentHash'>): DeliveryPlan {
  const normalized = parseCanonical(DeliveryPlanSchema, {
    ...value,
    items: [...value.items].sort((left, right) => left.id.localeCompare(right.id)),
    currentChoices: [...value.currentChoices].sort((left, right) =>
      fieldKey(left.field).localeCompare(fieldKey(right.field)),
    ),
    protections: [...value.protections].sort((left, right) =>
      fieldKey(left.field).localeCompare(fieldKey(right.field)),
    ),
    contentHash: ZERO_HASH,
  });
  return parseCanonical(DeliveryPlanSchema, {
    ...normalized,
    contentHash: hashCanonical(deliveryPlanContentHashInput(normalized)),
  });
}

export function deliveryRef(plan: DeliveryPlan) {
  return {
    authority: 'delivery' as const,
    id: plan.id,
    revision: plan.revision,
    contentHash: plan.contentHash,
  };
}

export function loadDeliveryPlanRecord(database: DatabaseSync, planId: string): DeliveryPlan {
  const row = database
    .prepare('SELECT * FROM delivery_plans WHERE id = ?')
    .get(planId) as unknown as DeliveryPlanRow | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Delivery plan was not found: ${planId}`);
  }
  try {
    const items = (
      database
        .prepare('SELECT * FROM delivery_items WHERE delivery_plan_id = ? ORDER BY id')
        .all(row.id) as unknown as DeliveryItemRow[]
    ).map(itemFromRow);
    const active = items
      .filter((item) => item.lifecycle === 'active')
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    if (active.some((item, index) => item.order !== index)) {
      throw corrupt(`Delivery ${row.id} active item order is not contiguous`);
    }
    const plan = parseCanonical(DeliveryPlanSchema, {
      authority: 'delivery',
      id: row.id,
      projectId: row.project_id,
      revision: row.revision,
      contentHash: row.content_hash,
      name: row.name,
      lifecycle: row.lifecycle,
      formatIntent: decodeCanonicalRecord(
        `Delivery ${row.id} format intent`,
        DeliveryFormatIntentSchema,
        row.format_intent_v1_json,
      ),
      items,
      currentChoices: loadFields(database, row.id),
      protections: loadProtections(database, row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    if (hashCanonical(deliveryPlanContentHashInput(plan)) !== plan.contentHash) {
      throw corrupt(`Delivery ${plan.id} content hash does not match`);
    }
    return plan;
  } catch (cause) {
    if (cause instanceof TargetStorageError) throw cause;
    throw corrupt(`Delivery ${row.id} is invalid`, cause);
  }
}

export function insertDeliveryPlanRecord(database: DatabaseSync, plan: DeliveryPlan): void {
  database
    .prepare(
      `INSERT INTO delivery_plans (
         id, project_id, revision, content_hash, name, lifecycle,
         format_intent_v1_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      plan.id,
      plan.projectId,
      plan.revision,
      plan.contentHash,
      plan.name,
      plan.lifecycle,
      canonicalJson(plan.formatIntent),
      plan.createdAt,
      plan.updatedAt,
    );
}

function insertItem(database: DatabaseSync, planId: string, item: DeliveryItem): void {
  database
    .prepare(
      `INSERT INTO delivery_items (
         id, delivery_plan_id, revision, content_hash, lifecycle, removed_at,
         shot_id, shot_revision, shot_content_hash,
         generated_result_id, generated_result_revision, generated_result_content_hash,
         project_media_ref_id, project_media_revision, project_media_content_hash,
         ordinal, trim_start_ms, trim_end_ms, audio_policy,
         transition_kind, transition_duration_ms, review_state
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      item.id,
      planId,
      item.revision,
      item.contentHash,
      item.lifecycle,
      item.removedAt,
      item.shot.id,
      item.shot.revision,
      item.shot.contentHash,
      item.result.id,
      item.result.revision,
      item.result.contentHash,
      item.projectMedia.id,
      item.projectMedia.revision,
      item.projectMedia.contentHash,
      item.order,
      item.trimStartMs,
      item.trimEndMs,
      item.audioPolicy,
      item.transition.kind,
      item.transition.durationMs,
      item.reviewState,
    );
}

function updateItem(
  database: DatabaseSync,
  planId: string,
  before: DeliveryItem,
  after: DeliveryItem,
): void {
  const changed = !sameItemSemantic(before, after);
  if (
    after.id !== before.id ||
    (changed
      ? after.revision !== before.revision + 1
      : after.revision !== before.revision || after.contentHash !== before.contentHash)
  ) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      `Delivery item ${before.id} revision is invalid`,
    );
  }
  const result = database
    .prepare(
      `UPDATE delivery_items
       SET revision = ?, content_hash = ?, lifecycle = ?, removed_at = ?,
           shot_id = ?, shot_revision = ?, shot_content_hash = ?,
           generated_result_id = ?, generated_result_revision = ?, generated_result_content_hash = ?,
           project_media_ref_id = ?, project_media_revision = ?, project_media_content_hash = ?,
           ordinal = ?, trim_start_ms = ?, trim_end_ms = ?, audio_policy = ?,
           transition_kind = ?, transition_duration_ms = ?, review_state = ?
       WHERE delivery_plan_id = ? AND id = ? AND revision = ? AND content_hash = ?`,
    )
    .run(
      after.revision,
      after.contentHash,
      after.lifecycle,
      after.removedAt,
      after.shot.id,
      after.shot.revision,
      after.shot.contentHash,
      after.result.id,
      after.result.revision,
      after.result.contentHash,
      after.projectMedia.id,
      after.projectMedia.revision,
      after.projectMedia.contentHash,
      after.order,
      after.trimStartMs,
      after.trimEndMs,
      after.audioPolicy,
      after.transition.kind,
      after.transition.durationMs,
      after.reviewState,
      planId,
      before.id,
      before.revision,
      before.contentHash,
    );
  if (Number(result.changes) !== 1) {
    throw new TargetStorageError('REVISION_CONFLICT', `Delivery item ${before.id} changed`);
  }
}

export function writeDeliveryPlanRecord(
  database: DatabaseSync,
  before: DeliveryPlan,
  after: DeliveryPlan,
): void {
  if (
    after.id !== before.id ||
    after.projectId !== before.projectId ||
    after.revision !== before.revision + 1
  ) {
    throw new TargetStorageError('INVALID_REQUEST', 'Delivery owner revision is invalid');
  }
  const beforeItems = new Map(before.items.map((item) => [item.id, item]));
  const afterItems = new Map(after.items.map((item) => [item.id, item]));
  if ([...beforeItems.keys()].some((id) => !afterItems.has(id))) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Delivery items are historical and cannot vanish',
    );
  }
  const itemRowsChanged =
    before.items.length !== after.items.length ||
    after.items.some((item) => {
      const old = beforeItems.get(item.id);
      return old === undefined || canonicalJson(old) !== canonicalJson(item);
    });
  if (itemRowsChanged) {
    database
      .prepare(
        `UPDATE delivery_items SET ordinal = ordinal + ?
         WHERE delivery_plan_id = ? AND lifecycle = 'active'`,
      )
      .run(ORDER_SHIFT, before.id);
    for (const item of after.items) {
      const old = beforeItems.get(item.id);
      if (old === undefined) {
        if (item.revision !== 0) {
          throw new TargetStorageError(
            'INVALID_REQUEST',
            `New Delivery item ${item.id} is invalid`,
          );
        }
        insertItem(database, after.id, item);
      } else if (item.lifecycle === 'active' || canonicalJson(old) !== canonicalJson(item)) {
        updateItem(database, after.id, old, item);
      }
    }
  }
  const updated = database
    .prepare(
      `UPDATE delivery_plans
       SET revision = ?, content_hash = ?, name = ?, lifecycle = ?,
           format_intent_v1_json = ?, updated_at = ?
       WHERE id = ? AND revision = ? AND content_hash = ?`,
    )
    .run(
      after.revision,
      after.contentHash,
      after.name,
      after.lifecycle,
      canonicalJson(after.formatIntent),
      after.updatedAt,
      before.id,
      before.revision,
      before.contentHash,
    );
  if (Number(updated.changes) !== 1) {
    throw new TargetStorageError('REVISION_CONFLICT', `Delivery ${before.id} changed`);
  }
}

export function setDeliveryFieldChoices(
  database: DatabaseSync,
  planId: string,
  fields: readonly DeliveryProtectedFieldRef[],
  choiceId: string,
): void {
  const remove = database.prepare(
    `DELETE FROM delivery_field_choices
     WHERE delivery_plan_id = ? AND delivery_item_id IS ? AND field_ref = ?`,
  );
  const insert = database.prepare(
    `INSERT INTO delivery_field_choices (
       delivery_plan_id, delivery_item_id, field_ref, choice_id
     ) VALUES (?, ?, ?, ?)`,
  );
  for (const field of fields) {
    remove.run(planId, field.itemId, fieldKey(field));
    insert.run(planId, field.itemId, fieldKey(field), choiceId);
  }
}

export function updateDeliverySearchDocument(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  plan: DeliveryPlan,
): void {
  const active = plan.items
    .filter((item) => item.lifecycle === 'active')
    .sort((left, right) => left.order - right.order);
  upsertProjectSearchDocument(
    database,
    environment,
    plan.projectId,
    { kind: 'delivery', ref: deliveryRef(plan) },
    plan.lifecycle === 'active' ? 'current' : 'historical',
    [
      plan.name,
      plan.lifecycle,
      plan.formatIntent.container,
      plan.formatIntent.videoCodec,
      plan.formatIntent.audioCodec ?? '',
      plan.formatIntent.quality,
      ...active.flatMap((item) => [item.reviewState, item.audioPolicy, item.transition.kind]),
    ]
      .filter(Boolean)
      .join('\n'),
    plan.updatedAt,
  );
}

export { fieldKey as deliveryFieldKey };
