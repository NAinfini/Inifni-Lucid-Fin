import {
  DeliveryQueryDefinition,
  DeliveryManifestSchema,
  DeliveryRefSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  Sha256Schema,
  WireSuccessV1Schema,
  canonicalJson,
  deliveryManifestContentHashInput,
  parseCanonical,
  parseRequestV1,
  strictObject,
  type DeliveryItem,
  type DeliveryItemSemanticSnapshot,
  type DeliveryManifest,
  type DeliveryMutationCommand,
  type DeliveryPlan,
  type DeliveryRef,
  type ProtectedFieldRef,
  type UserChoice,
  type UserChoiceEffect,
  type UserChoiceIntent,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { getProject } from './projects.js';
import { StorageError } from '../kernel/errors.js';
import type { Store } from '../kernel/store.js';
import {
  executeWireMutation,
  CommandContextSchema,
  type CommandContext,
} from '../internal/command.js';
import { decodeCursor, encodeCursor } from '../internal/cursor.js';
import { getStoreDatabase } from '../internal/database-access.js';
import {
  deliveryFieldKey,
  deliveryRef,
  finalizeDeliveryItem,
  finalizeDeliveryPlan,
  insertDeliveryPlanRecord,
  loadDeliveryPlanRecord,
  setDeliveryFieldChoices,
  updateDeliverySearchDocument,
  writeDeliveryPlanRecord,
} from '../internal/delivery-records.js';
import type { StorageEnvironment } from '../internal/environment.js';
import { hashCanonical } from '../internal/hashes.js';
import {
  loadGlobalMediaAsset,
  loadMediaBlob,
  loadProjectMediaRecord,
} from '../internal/media-records.js';
import {
  loadDeliveryManifest,
  loadGeneratedResultRecord,
  loadOperationOwnerRecord,
  operationRefForOwner,
} from '../internal/operation-owner-records.js';
import { authorizeChoiceMutation, type CommandDispatchHost } from '../internal/protection-guard.js';
import { appendProjectEvent } from '../internal/project-events.js';
import { loadProductionObject } from '../internal/production-records.js';
import {
  finalizeUserChoiceRecord,
  findUserChoiceByDispatch,
  insertUserChoiceRecord,
  loadUserChoiceRecord,
} from '../internal/user-choice-records.js';
import { withImmediateTransaction } from '../kernel/transaction.js';

type RequestMap = {
  [Method in WireRequestV1['method']]: Extract<WireRequestV1, { method: Method }>;
};
type SuccessMap = {
  [Method in WireSuccessV1['method']]: Extract<WireSuccessV1, { method: Method }>;
};
type Request<Method extends keyof RequestMap> = RequestMap[Method];
type Success<Method extends keyof SuccessMap> = SuccessMap[Method];
type ApplyRequest = Request<'delivery.apply'>;
type QueryRequest = Request<'delivery.query'>;
export type DeliveryToolQueryInput = ReturnType<typeof DeliveryQueryDefinition.parseInput>;
export type DeliveryToolQuerySuccess = ReturnType<typeof DeliveryQueryDefinition.parseSuccess>;
type DeliveryField = Extract<ProtectedFieldRef, { owner: 'delivery' }>;
type DeliveryEffect = Extract<UserChoiceEffect, { kind: 'delivery' }>;

export interface FreezeDeliveryInput {
  readonly plan: DeliveryRef;
}

export function deliveryFreezeCommandId(inputValue: FreezeDeliveryInput): string {
  const input = { plan: parseCanonical(DeliveryRefSchema, inputValue.plan) };
  return `delivery.freeze.${hashCanonical(input)}`;
}

const ZERO_HASH = '0'.repeat(64);

function invalid(message: string): StorageError {
  return new StorageError('INVALID_REQUEST', message);
}

function corrupt(message: string): StorageError {
  return new StorageError('CORRUPT_DATA', message);
}

function choiceActor(context: CommandContext): Exclude<UserChoice['actor'], 'import'> {
  if (context.actor !== 'user' && context.actor !== 'commander') {
    throw invalid('Only a user or Commander can mutate Delivery');
  }
  return context.actor;
}

function exactRequest<Method extends 'delivery.apply' | 'delivery.query'>(
  input: Request<Method>,
  method: Method,
): Request<Method> {
  const request = parseRequestV1(input);
  if (request.method !== method) throw invalid(`Expected Wire method ${method}`);
  return request as Request<Method>;
}

function success<Method extends 'delivery.apply' | 'delivery.query'>(
  request: Request<Method>,
  result: Success<Method>['result'],
): Success<Method> {
  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result,
  }) as Success<Method>;
}

function requireExactPlan(database: DatabaseSync, ref: DeliveryRef): DeliveryPlan {
  const plan = loadDeliveryPlanRecord(database, ref.id);
  if (plan.revision !== ref.revision || plan.contentHash !== ref.contentHash) {
    throw new StorageError('REVISION_CONFLICT', `Delivery ${ref.id} changed`);
  }
  return plan;
}

function planField(
  planId: string,
  field: 'name' | 'lifecycle' | 'formatIntent' | 'order',
): DeliveryField {
  return { owner: 'delivery', deliveryId: planId, itemId: null, field };
}

function itemField(
  planId: string,
  itemId: string,
  field: 'clip' | 'trim' | 'transition' | 'audioPolicy' | 'reviewState' | 'itemLifecycle',
): DeliveryField {
  return { owner: 'delivery', deliveryId: planId, itemId, field };
}

function itemSnapshot(item: DeliveryItem): DeliveryItemSemanticSnapshot {
  const { id: _id, revision: _revision, contentHash: _contentHash, ...snapshot } = item;
  return snapshot;
}

function settingsSnapshot(plan: DeliveryPlan): NonNullable<DeliveryEffect['settings']> {
  return {
    name: plan.name,
    lifecycle: plan.lifecycle,
    formatIntent: plan.formatIntent,
  };
}

function activeItems(plan: DeliveryPlan): DeliveryItem[] {
  return plan.items
    .filter((item) => item.lifecycle === 'active')
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function compareManifestFieldEntries(
  left: { readonly field: ProtectedFieldRef; readonly choice: { readonly id: string } },
  right: { readonly field: ProtectedFieldRef; readonly choice: { readonly id: string } },
): number {
  if (left.field.owner !== 'delivery' || right.field.owner !== 'delivery') {
    throw corrupt('Delivery Manifest contains a non-Delivery field');
  }
  const itemOrder =
    left.field.itemId === right.field.itemId
      ? 0
      : left.field.itemId === null
        ? -1
        : right.field.itemId === null
          ? 1
          : left.field.itemId.localeCompare(right.field.itemId);
  return (
    itemOrder ||
    deliveryFieldKey(left.field).localeCompare(deliveryFieldKey(right.field)) ||
    left.choice.id.localeCompare(right.choice.id)
  );
}

function currentChoiceMap(plan: DeliveryPlan): Map<string, DeliveryPlan['currentChoices'][number]> {
  return new Map(plan.currentChoices.map((entry) => [deliveryFieldKey(entry.field), entry]));
}

function withChoiceHeads(
  plan: DeliveryPlan,
  fields: readonly DeliveryField[],
  choiceId: string,
): DeliveryPlan['currentChoices'] {
  const choices = currentChoiceMap(plan);
  for (const field of fields) choices.set(deliveryFieldKey(field), { field, choiceId });
  return [...choices.values()];
}

function supersededChoiceIds(plan: DeliveryPlan, fields: readonly DeliveryField[]): string[] {
  const choices = currentChoiceMap(plan);
  return [
    ...new Set(
      fields
        .map((field) => choices.get(deliveryFieldKey(field))?.choiceId)
        .filter((id): id is string => id !== undefined),
    ),
  ].sort();
}

function reviseItem(item: DeliveryItem, value: DeliveryItemSemanticSnapshot): DeliveryItem {
  if (canonicalJson(itemSnapshot(item)) === canonicalJson(value)) return item;
  return finalizeDeliveryItem({
    id: item.id,
    revision: item.revision + 1,
    ...value,
  });
}

function mutationIntent(action: ApplyRequest['input']['action']): UserChoiceIntent {
  return { kind: 'delivery_mutation', action };
}

function commanderReplay(
  database: DatabaseSync,
  request: ApplyRequest,
  context: CommandContext,
  host: CommandDispatchHost | undefined,
): UserChoice | undefined {
  if (context.actor !== 'commander' || host === undefined) return undefined;
  const existing = findUserChoiceByDispatch(database, host.dispatchOperationId);
  if (existing === undefined) return undefined;
  const authorization = authorizeChoiceMutation(database, {
    requestId: request.requestId,
    projectId: existing.projectId,
    toolId: 'delivery.mutate',
    toolInput: request.input,
    owner: existing.ownerBefore ?? existing.ownerAfter,
    fields: [],
    activeProtections: [],
    proposedEffect: existing.afterEffect,
    context,
    host,
  });
  if (
    authorization.kind !== 'commander_dispatch' ||
    canonicalJson(existing.choice) !== canonicalJson(mutationIntent(request.input.action))
  ) {
    throw corrupt(`Dispatch ${host.dispatchOperationId} Delivery replay does not match`);
  }
  return existing;
}

interface MutationState {
  readonly items: DeliveryItem[];
  readonly name: string;
  readonly lifecycle: DeliveryPlan['lifecycle'];
  readonly formatIntent: DeliveryPlan['formatIntent'];
  readonly fields: DeliveryField[];
  readonly beforeEffect: DeliveryEffect;
  readonly afterEffect: DeliveryEffect;
}

function effects(
  before: DeliveryPlan,
  afterItems: DeliveryItem[],
  affectedIds: readonly string[],
  settings: boolean,
  order: boolean,
): Pick<MutationState, 'beforeEffect' | 'afterEffect'> {
  const beforeById = new Map(before.items.map((item) => [item.id, item]));
  const afterById = new Map(afterItems.map((item) => [item.id, item]));
  const itemIds = [...affectedIds].sort();
  return {
    beforeEffect: {
      kind: 'delivery',
      deliveryId: before.id,
      settings: settings ? settingsSnapshot(before) : null,
      items: itemIds.map((itemId) => ({
        itemId,
        value: beforeById.has(itemId) ? itemSnapshot(beforeById.get(itemId)!) : null,
      })),
      order: order ? activeItems(before).map((item) => item.id) : null,
    },
    afterEffect: {
      kind: 'delivery',
      deliveryId: before.id,
      settings: settings
        ? {
            name: before.name,
            lifecycle: before.lifecycle,
            formatIntent: before.formatIntent,
          }
        : null,
      items: itemIds.map((itemId) => ({
        itemId,
        value: afterById.has(itemId) ? itemSnapshot(afterById.get(itemId)!) : null,
      })),
      order: order
        ? afterItems
            .filter((item) => item.lifecycle === 'active')
            .sort((left, right) => left.order - right.order)
            .map((item) => item.id)
        : null,
    },
  };
}

function buildMutation(
  database: DatabaseSync,
  before: DeliveryPlan,
  input: Exclude<ApplyRequest['input'], { action: 'create' }>,
  now: string,
  plannedItemId: string | null,
): MutationState {
  if (input.action !== 'restore' && before.lifecycle !== 'active') {
    throw invalid(`Delivery ${before.id} is archived`);
  }
  const items = [...before.items];
  const byId = new Map(items.map((item, index) => [item.id, index]));
  const current = activeItems(before);
  let fields: DeliveryField[] = [];
  let affected: string[] = [];
  let name = before.name;
  let lifecycle = before.lifecycle;
  let formatIntent = before.formatIntent;
  let hasSettings = false;
  let hasOrder = false;

  const replaceItem = (item: DeliveryItem) => {
    const index = byId.get(item.id);
    if (index === undefined) {
      byId.set(item.id, items.length);
      items.push(item);
    } else items[index] = item;
  };
  const exactItem = (ref: { id: string; revision: number; contentHash: string }) => {
    const item = items[byId.get(ref.id) ?? -1];
    if (
      item === undefined ||
      item.revision !== ref.revision ||
      item.contentHash !== ref.contentHash
    ) {
      throw new StorageError('REVISION_CONFLICT', `Delivery item ${ref.id} changed`);
    }
    return item;
  };

  switch (input.action) {
    case 'updateSettings': {
      if (
        before.name === input.name &&
        canonicalJson(before.formatIntent) === canonicalJson(input.formatIntent)
      ) {
        throw invalid('Delivery settings did not change');
      }
      name = input.name;
      formatIntent = input.formatIntent;
      hasSettings = true;
      fields = [planField(before.id, 'name'), planField(before.id, 'formatIntent')];
      break;
    }
    case 'place': {
      if (input.order > current.length) throw invalid('Delivery placement order is out of range');
      const shot = loadProductionObject(database, input.shot.id);
      if (
        shot.projectId !== before.projectId ||
        shot.type !== 'shot' ||
        shot.lifecycle !== 'active' ||
        shot.revision !== input.shot.revision ||
        shot.contentHash !== input.shot.contentHash
      ) {
        throw invalid(`Production Shot ${input.shot.id} does not match this Delivery`);
      }
      const result = loadGeneratedResultRecord(database, input.result.id);
      if (
        result.projectId !== before.projectId ||
        result.targetProductionObjectId !== shot.id ||
        result.revision !== 0 ||
        input.result.revision !== 0 ||
        result.contentHash !== input.result.contentHash ||
        result.mediaKind !== 'video'
      ) {
        throw invalid(`Generated Result ${input.result.id} is not an exact video for this Shot`);
      }
      const projectMedia = loadProjectMediaRecord(database, result.projectMediaRefId);
      const asset = loadGlobalMediaAsset(database, result.globalMediaAssetId);
      const blob = loadMediaBlob(database, result.mediaBlobHash);
      if (
        projectMedia.projectId !== before.projectId ||
        projectMedia.lifecycle !== 'active' ||
        projectMedia.globalAssetId !== asset.id ||
        asset.blobHash !== blob.hash ||
        blob.technicalFacts.kind !== 'video' ||
        (blob.technicalFacts.durationMs !== null &&
          input.trim.endMs > blob.technicalFacts.durationMs)
      ) {
        throw invalid(`Generated Result ${result.id} media mapping is not deliverable`);
      }
      if (plannedItemId === null)
        throw corrupt('Delivery placement is missing its planned item ID');
      const itemId = plannedItemId;
      const reordered = [...current];
      reordered.splice(
        input.order,
        0,
        finalizeDeliveryItem({
          id: itemId,
          revision: 0,
          lifecycle: 'active',
          removedAt: null,
          shot: input.shot,
          result: input.result,
          projectMedia: {
            authority: 'project_media_ref',
            id: projectMedia.id,
            revision: projectMedia.revision,
            contentHash: projectMedia.contentHash,
          },
          order: input.order,
          trimStartMs: input.trim.startMs,
          trimEndMs: input.trim.endMs,
          audioPolicy: input.audioPolicy,
          transition: input.transition,
          reviewState: 'unreviewed',
        }),
      );
      for (const [order, item] of reordered.entries()) {
        const revised = reviseItem(item, { ...itemSnapshot(item), order });
        replaceItem(revised);
        if (revised !== item || item.id === itemId) affected.push(item.id);
      }
      fields = [
        planField(before.id, 'order'),
        itemField(before.id, itemId, 'clip'),
        itemField(before.id, itemId, 'trim'),
        itemField(before.id, itemId, 'transition'),
        itemField(before.id, itemId, 'audioPolicy'),
        itemField(before.id, itemId, 'reviewState'),
        itemField(before.id, itemId, 'itemLifecycle'),
      ];
      hasOrder = true;
      break;
    }
    case 'remove': {
      const target = exactItem(input.item);
      if (target.lifecycle !== 'active') throw invalid(`Delivery item ${target.id} is removed`);
      replaceItem(
        reviseItem(target, { ...itemSnapshot(target), lifecycle: 'removed', removedAt: now }),
      );
      affected.push(target.id);
      for (const [order, item] of current.filter((entry) => entry.id !== target.id).entries()) {
        const revised = reviseItem(item, { ...itemSnapshot(item), order });
        replaceItem(revised);
        if (revised !== item) affected.push(item.id);
      }
      fields = [planField(before.id, 'order'), itemField(before.id, target.id, 'itemLifecycle')];
      hasOrder = true;
      break;
    }
    case 'reorder': {
      if (input.orderedItems.length !== current.length) {
        throw invalid('Reorder must contain every active Delivery item');
      }
      const expected = new Set(current.map((item) => item.id));
      const ordered = input.orderedItems.map((ref) => {
        const item = exactItem(ref);
        if (item.lifecycle !== 'active' || !expected.delete(item.id)) {
          throw invalid('Reorder contains a removed or duplicate Delivery item');
        }
        return item;
      });
      if (expected.size > 0) throw invalid('Reorder omitted an active Delivery item');
      if (ordered.every((item, index) => item.id === current[index]?.id)) {
        throw invalid('Delivery order did not change');
      }
      affected = ordered.map((item) => item.id);
      for (const [order, item] of ordered.entries()) {
        replaceItem(reviseItem(item, { ...itemSnapshot(item), order }));
      }
      fields = [planField(before.id, 'order')];
      hasOrder = true;
      break;
    }
    case 'trim':
    case 'transition':
    case 'audioPolicy':
    case 'reviewState': {
      const target = exactItem(input.item);
      if (target.lifecycle !== 'active') throw invalid(`Delivery item ${target.id} is removed`);
      const value = itemSnapshot(target);
      const next =
        input.action === 'trim'
          ? { ...value, trimStartMs: input.value.startMs, trimEndMs: input.value.endMs }
          : input.action === 'transition'
            ? { ...value, transition: input.value }
            : input.action === 'audioPolicy'
              ? { ...value, audioPolicy: input.value }
              : { ...value, reviewState: input.value };
      const revised = reviseItem(target, next);
      if (revised === target) throw invalid(`Delivery ${input.action} did not change`);
      replaceItem(revised);
      affected = [target.id];
      fields = [itemField(before.id, target.id, input.action)];
      break;
    }
    case 'archive':
      lifecycle = 'archived';
      hasSettings = true;
      fields = [planField(before.id, 'lifecycle')];
      break;
    case 'restore':
      if (before.lifecycle !== 'archived') throw invalid(`Delivery ${before.id} is not archived`);
      lifecycle = 'active';
      hasSettings = true;
      fields = [planField(before.id, 'lifecycle')];
      break;
  }
  const state = effects(before, items, [...new Set(affected)], hasSettings, hasOrder);
  if (hasSettings) {
    state.afterEffect.settings = { name, lifecycle, formatIntent };
  }
  return { items, name, lifecycle, formatIntent, fields, ...state };
}

function appendDeliveryEvent(
  database: DatabaseSync,
  context: CommandContext,
  requestId: string,
  eventId: string,
  plan: DeliveryPlan,
  beforeRevision: number,
  manifestHash: string | null,
  occurredAt: string,
): string {
  return appendProjectEvent(database, {
    eventId,
    projectId: plan.projectId,
    occurredAt,
    actor: context.actor,
    subject: { authority: 'delivery', id: plan.id },
    causation: context.causation,
    correlationId: context.correlationId,
    idempotencyKey: requestId,
    payload: {
      type: 'delivery_changed',
      deliveryId: plan.id,
      beforeRevision,
      afterRevision: plan.revision,
      manifestHash,
    },
  }).id;
}

export interface DeliveryMutationPlannedIds {
  readonly tool: 'delivery.mutate';
  readonly userChoiceId: string;
  readonly projectEventId: string;
  readonly deliveryPlanId: string | null;
  readonly deliveryItemId: string | null;
}

export interface PlannedDeliveryMutation {
  readonly requestId: string;
  readonly command: DeliveryMutationCommand;
  readonly occurredAt: string;
  readonly projectId: string;
  readonly before: DeliveryPlan | null;
  readonly after: DeliveryPlan;
  readonly fields: readonly DeliveryField[];
  readonly activeChoiceIds: readonly string[];
  readonly beforeEffect: DeliveryEffect;
  readonly afterEffect: DeliveryEffect;
  readonly supersedesChoiceIds: readonly string[];
  readonly ids: DeliveryMutationPlannedIds;
}

export interface CommittedDeliveryMutation {
  readonly plan: DeliveryPlan;
  readonly choice: UserChoice;
  readonly projectEventId: string;
}

const DELIVERY_MUTATION_ID_SCHEMA = 'lucid-fin.delivery-mutation-planned-ids/v1';

function deterministicDeliveryMutationId(
  dispatchOperationId: string,
  role: 'delivery_plan' | 'delivery_item' | 'user_choice' | 'project_event',
): string {
  const id = parseCanonical(EntityIdSchema, dispatchOperationId);
  const prefix =
    role === 'delivery_plan'
      ? 'delivery'
      : role === 'delivery_item'
        ? 'delivery_item'
        : role === 'user_choice'
          ? 'user_choice'
          : 'project_event';
  return `${prefix}.${hashCanonical({
    schema: DELIVERY_MUTATION_ID_SCHEMA,
    dispatchOperationId: id,
    role,
  })}`;
}

export function plannedDeliveryMutationIds(
  dispatchOperationId: string,
  action: DeliveryMutationCommand['action'],
): DeliveryMutationPlannedIds {
  return Object.freeze({
    tool: 'delivery.mutate',
    userChoiceId: deterministicDeliveryMutationId(dispatchOperationId, 'user_choice'),
    projectEventId: deterministicDeliveryMutationId(dispatchOperationId, 'project_event'),
    deliveryPlanId:
      action === 'create'
        ? deterministicDeliveryMutationId(dispatchOperationId, 'delivery_plan')
        : null,
    deliveryItemId:
      action === 'place'
        ? deterministicDeliveryMutationId(dispatchOperationId, 'delivery_item')
        : null,
  });
}

function generatedDeliveryMutationIds(
  environment: StorageEnvironment,
  action: DeliveryMutationCommand['action'],
): DeliveryMutationPlannedIds {
  return Object.freeze({
    tool: 'delivery.mutate',
    userChoiceId: parseCanonical(EntityIdSchema, environment.createId('user_choice')),
    projectEventId: parseCanonical(EntityIdSchema, environment.createId('project_event')),
    deliveryPlanId:
      action === 'create' ? parseCanonical(EntityIdSchema, environment.createId('delivery')) : null,
    deliveryItemId:
      action === 'place'
        ? parseCanonical(EntityIdSchema, environment.createId('delivery_item'))
        : null,
  });
}

function exactDeliveryMutationIds(
  input: DeliveryMutationPlannedIds,
  action: DeliveryMutationCommand['action'],
): DeliveryMutationPlannedIds {
  if (input.tool !== 'delivery.mutate') {
    throw invalid('Delivery mutation planned IDs must be for delivery.mutate');
  }
  const ids = Object.freeze({
    tool: input.tool,
    userChoiceId: parseCanonical(EntityIdSchema, input.userChoiceId),
    projectEventId: parseCanonical(EntityIdSchema, input.projectEventId),
    deliveryPlanId:
      input.deliveryPlanId === null ? null : parseCanonical(EntityIdSchema, input.deliveryPlanId),
    deliveryItemId:
      input.deliveryItemId === null ? null : parseCanonical(EntityIdSchema, input.deliveryItemId),
  });
  if ((action === 'create') !== (ids.deliveryPlanId !== null)) {
    throw invalid('Delivery create plan ID does not match its action');
  }
  if ((action === 'place') !== (ids.deliveryItemId !== null)) {
    throw invalid('Delivery placement item ID does not match its action');
  }
  if (
    new Set(Object.values(ids).filter((id): id is string => id !== null)).size !==
    Object.values(ids).filter((id): id is string => id !== null).length
  ) {
    throw invalid('Delivery mutation planned IDs must be unique');
  }
  return ids;
}

function activeProtectionChoiceIds(
  fields: readonly DeliveryField[],
  protections: DeliveryPlan['protections'],
): string[] {
  const fieldKeys = new Set(fields.map((field) => canonicalJson(field)));
  return [
    ...new Set(
      protections
        .filter((protection) => fieldKeys.has(canonicalJson(protection.field)))
        .map((protection) => protection.choiceId),
    ),
  ].sort();
}

export function planDeliveryMutationInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  requestInput: ApplyRequest,
  occurredAtInput: string,
  plannedIdsInput?: DeliveryMutationPlannedIds,
): PlannedDeliveryMutation {
  if (!database.isTransaction) {
    throw invalid('Delivery mutation planning requires an active transaction');
  }
  const request = exactRequest(requestInput, 'delivery.apply');
  const now = parseCanonical(IsoTimestampSchema, occurredAtInput);
  const ids = exactDeliveryMutationIds(
    plannedIdsInput ?? generatedDeliveryMutationIds(environment, request.input.action),
    request.input.action,
  );

  if (request.input.action === 'create') {
    const project = getProject(database, request.input.project.id);
    if (
      project.revision !== request.input.project.revision ||
      project.contentHash !== request.input.project.contentHash
    ) {
      throw new StorageError('REVISION_CONFLICT', `Project ${project.id} changed`);
    }
    if (project.lifecycle !== 'active') throw invalid(`Project ${project.id} is not active`);
    const planId = ids.deliveryPlanId!;
    const fields = [
      planField(planId, 'name'),
      planField(planId, 'lifecycle'),
      planField(planId, 'formatIntent'),
      planField(planId, 'order'),
    ];
    const beforeEffect: DeliveryEffect = {
      kind: 'delivery',
      deliveryId: planId,
      settings: null,
      items: [],
      order: null,
    };
    const afterEffect: DeliveryEffect = {
      kind: 'delivery',
      deliveryId: planId,
      settings: {
        name: request.input.name,
        lifecycle: 'active',
        formatIntent: request.input.formatIntent,
      },
      items: [],
      order: [],
    };
    const after = finalizeDeliveryPlan({
      authority: 'delivery',
      id: planId,
      projectId: project.id,
      revision: 0,
      name: request.input.name,
      lifecycle: 'active',
      formatIntent: request.input.formatIntent,
      items: [],
      currentChoices: fields.map((field) => ({ field, choiceId: ids.userChoiceId })),
      protections: [],
      createdAt: now,
      updatedAt: now,
    });
    return Object.freeze({
      requestId: request.requestId,
      command: request.input,
      occurredAt: now,
      projectId: project.id,
      before: null,
      after,
      fields,
      activeChoiceIds: [],
      beforeEffect,
      afterEffect,
      supersedesChoiceIds: [],
      ids,
    });
  }

  const before = requireExactPlan(database, request.input.plan);
  const state = buildMutation(database, before, request.input, now, ids.deliveryItemId);
  const after = finalizeDeliveryPlan({
    ...before,
    revision: before.revision + 1,
    name: state.name,
    lifecycle: state.lifecycle,
    formatIntent: state.formatIntent,
    items: state.items,
    currentChoices: withChoiceHeads(before, state.fields, ids.userChoiceId),
    updatedAt: now,
  });
  return Object.freeze({
    requestId: request.requestId,
    command: request.input,
    occurredAt: now,
    projectId: before.projectId,
    before,
    after,
    fields: state.fields,
    activeChoiceIds: activeProtectionChoiceIds(state.fields, before.protections),
    beforeEffect: state.beforeEffect,
    afterEffect: state.afterEffect,
    supersedesChoiceIds: supersededChoiceIds(before, state.fields),
    ids,
  });
}

export function commitPlannedDeliveryMutationInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  planned: PlannedDeliveryMutation,
  contextInput: CommandContext,
  host?: CommandDispatchHost,
): CommittedDeliveryMutation {
  if (!database.isTransaction) {
    throw invalid('Delivery mutation commit requires an active transaction');
  }
  const context = parseCanonical(CommandContextSchema, contextInput);
  choiceActor(context);
  if (planned.before !== null) {
    const current = requireExactPlan(database, deliveryRef(planned.before));
    if (canonicalJson(current) !== canonicalJson(planned.before)) {
      throw new StorageError('REVISION_CONFLICT', `Delivery ${planned.before.id} changed`);
    }
  }
  const authorization = authorizeChoiceMutation(database, {
    requestId: planned.requestId,
    projectId: planned.projectId,
    toolId: 'delivery.mutate',
    toolInput: planned.command,
    owner: deliveryRef(planned.before ?? planned.after),
    fields: planned.fields,
    activeProtections: planned.before?.protections ?? [],
    proposedEffect: planned.afterEffect,
    plannedIds: planned.ids,
    context,
    host,
  });
  const choice = finalizeUserChoiceRecord({
    authority: 'user_choice',
    id: planned.ids.userChoiceId,
    projectId: planned.projectId,
    actor: choiceActor(context),
    authorization,
    causation: context.causation,
    subject: {
      kind: 'delivery',
      deliveryId: planned.after.id,
      itemIds: planned.afterEffect.items.map((entry) => entry.itemId),
    },
    ownerBefore: planned.before === null ? null : deliveryRef(planned.before),
    ownerAfter: deliveryRef(planned.after),
    choice: mutationIntent(planned.command.action),
    beforeEffect: planned.beforeEffect,
    afterEffect: planned.afterEffect,
    supersedesChoiceIds: [...planned.supersedesChoiceIds],
    createdAt: planned.occurredAt,
  });

  if (planned.before === null) insertDeliveryPlanRecord(database, planned.after);
  else writeDeliveryPlanRecord(database, planned.before, planned.after);
  insertUserChoiceRecord(database, choice);
  setDeliveryFieldChoices(database, planned.after.id, planned.fields, choice.id);
  const projectEventId = appendDeliveryEvent(
    database,
    context,
    planned.requestId,
    planned.ids.projectEventId,
    planned.after,
    planned.before?.revision ?? 0,
    null,
    planned.occurredAt,
  );
  const persisted = loadDeliveryPlanRecord(database, planned.after.id);
  updateDeliverySearchDocument(database, environment, persisted);
  return Object.freeze({
    plan: persisted,
    choice: loadUserChoiceRecord(database, choice.id),
    projectEventId,
  });
}

export function applyDeliveryInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  requestInput: ApplyRequest,
  contextInput: CommandContext,
  occurredAtInput: string,
  host?: CommandDispatchHost,
): Success<'delivery.apply'>['result'] {
  if (!database.isTransaction) {
    throw invalid('Delivery mutation core requires an active transaction');
  }
  const request = exactRequest(requestInput, 'delivery.apply');
  const context = parseCanonical(CommandContextSchema, contextInput);
  choiceActor(context);
  const now = parseCanonical(IsoTimestampSchema, occurredAtInput);
  const replay = commanderReplay(database, request, context, host);
  if (replay !== undefined) {
    return {
      plan: loadDeliveryPlanRecord(database, replay.ownerAfter.id),
      choice: replay,
    };
  }
  const committed = commitPlannedDeliveryMutationInTransaction(
    database,
    environment,
    planDeliveryMutationInTransaction(
      database,
      environment,
      request,
      now,
      context.actor === 'commander' && host !== undefined
        ? plannedDeliveryMutationIds(host.dispatchOperationId, request.input.action)
        : undefined,
    ),
    context,
    host,
  );
  return {
    plan: committed.plan,
    choice: committed.choice,
  };
}

function applyDelivery(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: ApplyRequest,
  context: CommandContext,
  host?: CommandDispatchHost,
): Success<'delivery.apply'> {
  choiceActor(context);
  const now = environment.now();
  return executeWireMutation(
    database,
    request,
    context,
    now,
    () => {
      const result = applyDeliveryInTransaction(database, environment, request, context, now, host);
      return {
        projectId: result.plan.projectId,
        response: success<'delivery.apply'>(request, result),
      };
    },
    host,
  );
}

function operationRefsForManifests(database: DatabaseSync, manifestIds: readonly string[]) {
  if (manifestIds.length === 0) return [];
  const placeholders = manifestIds.map(() => '?').join(', ');
  const rows = database
    .prepare(
      `SELECT dispatch.id, dispatch.owner_authority, dispatch.owner_id
       FROM dispatch_operations AS dispatch
       JOIN review_cut_attempts AS attempt ON attempt.id = dispatch.owner_id
       WHERE dispatch.owner_authority = 'review_cut_attempt'
         AND attempt.delivery_manifest_id IN (${placeholders})
       UNION ALL
       SELECT dispatch.id, dispatch.owner_authority, dispatch.owner_id
       FROM dispatch_operations AS dispatch
       JOIN delivery_exports AS attempt ON attempt.id = dispatch.owner_id
       WHERE dispatch.owner_authority = 'delivery_export'
         AND attempt.delivery_manifest_id IN (${placeholders})
       ORDER BY 1`,
    )
    .all(...manifestIds, ...manifestIds) as unknown as Array<{
    id: string;
    owner_authority: 'review_cut_attempt' | 'delivery_export';
    owner_id: string;
  }>;
  if (rows.length > 500) throw invalid('Delivery query operation result exceeds its limit');
  return rows.map((row) =>
    operationRefForOwner(
      row.id,
      loadOperationOwnerRecord(database, row.owner_authority, row.owner_id),
    ),
  );
}

const DeliveryToolCursorSchema = strictObject({
  filterHash: Sha256Schema,
  planId: EntityIdSchema,
});

function decodeDeliveryToolCursor(cursor: string | null) {
  const value = decodeCursor(cursor, DeliveryQueryDefinition.id);
  if (value === null) return null;
  try {
    return parseCanonical(DeliveryToolCursorSchema, JSON.parse(value) as unknown);
  } catch (cause) {
    throw new StorageError('INVALID_REQUEST', 'Delivery tool query cursor is invalid', {
      cause,
    });
  }
}

function filteredDeliveryPlanIds(
  database: DatabaseSync,
  projectId: string,
  input: DeliveryToolQueryInput,
  afterPlanId: string | null,
): string[] {
  const clauses = ['plan.project_id = ?'];
  const parameters: Array<string | number> = [projectId];
  if (input.planIds.length > 0) {
    clauses.push(`plan.id IN (${input.planIds.map(() => '?').join(', ')})`);
    parameters.push(...input.planIds);
  }
  if (input.itemIds.length > 0) {
    clauses.push(
      `EXISTS (
         SELECT 1 FROM delivery_items AS item
         WHERE item.delivery_plan_id = plan.id
           AND item.id IN (${input.itemIds.map(() => '?').join(', ')})
       )`,
    );
    parameters.push(...input.itemIds);
  }
  if (input.manifestIds.length > 0) {
    clauses.push(
      `EXISTS (
         SELECT 1 FROM delivery_manifests AS manifest
         WHERE manifest.delivery_plan_id = plan.id
           AND manifest.id IN (${input.manifestIds.map(() => '?').join(', ')})
       )`,
    );
    parameters.push(...input.manifestIds);
  }
  if (afterPlanId !== null) {
    clauses.push('plan.id > ?');
    parameters.push(afterPlanId);
  }
  parameters.push(input.page.limit + 1);
  return (
    database
      .prepare(
        `SELECT plan.id
         FROM delivery_plans AS plan
         WHERE ${clauses.join(' AND ')}
         ORDER BY plan.id
         LIMIT ?`,
      )
      .all(...parameters) as unknown as Array<{ id: string }>
  ).map(({ id }) => id);
}

function toolManifestIds(
  database: DatabaseSync,
  planId: string,
  requestedManifestIds: readonly string[],
): string[] {
  const requestedClause =
    requestedManifestIds.length === 0
      ? ''
      : ` AND id IN (${requestedManifestIds.map(() => '?').join(', ')})`;
  return (
    database
      .prepare(
        `SELECT id FROM delivery_manifests
         WHERE delivery_plan_id = ?${requestedClause}
         ORDER BY delivery_revision, id`,
      )
      .all(planId, ...requestedManifestIds) as unknown as Array<{ id: string }>
  ).map(({ id }) => id);
}

function queryDeliveryTool(
  database: DatabaseSync,
  projectIdValue: string,
  inputValue: DeliveryToolQueryInput,
): DeliveryToolQuerySuccess {
  const projectId = parseCanonical(EntityIdSchema, projectIdValue);
  const project = getProject(database, projectId);
  const input = DeliveryQueryDefinition.parseInput(inputValue);
  const filterHash = hashCanonical({
    projectId: project.id,
    planIds: input.planIds,
    itemIds: input.itemIds,
    manifestIds: input.manifestIds,
    include: input.include,
  });
  const cursor = decodeDeliveryToolCursor(input.page.cursor);
  if (cursor !== null && cursor.filterHash !== filterHash) {
    throw new StorageError(
      'INVALID_REQUEST',
      'Delivery tool query cursor belongs to another query',
    );
  }
  const matchingIds = filteredDeliveryPlanIds(database, project.id, input, cursor?.planId ?? null);
  const pageIds = matchingIds.slice(0, input.page.limit);
  const include = new Set(input.include);
  // A DeliveryPlan is a hash-bound canonical snapshot, so only separate related collections can be projected away.
  const items = pageIds.map((planId) => {
    const plan = loadDeliveryPlanRecord(database, planId);
    if (plan.projectId !== project.id) {
      throw corrupt(`Delivery ${plan.id} no longer matches its Project query`);
    }
    const manifestIds =
      include.has('manifests') || include.has('operations')
        ? toolManifestIds(database, plan.id, input.manifestIds)
        : [];
    return {
      plan,
      manifests: include.has('manifests')
        ? manifestIds.map((manifestId) => {
            const manifest = loadDeliveryManifest(database, manifestId);
            return {
              authority: manifest.authority,
              id: manifest.id,
              revision: manifest.revision,
              contentHash: manifest.contentHash,
            };
          })
        : [],
      operations: include.has('operations') ? operationRefsForManifests(database, manifestIds) : [],
    };
  });
  const lastPlanId = pageIds.at(-1);
  return DeliveryQueryDefinition.parseSuccess({
    items,
    nextCursor:
      matchingIds.length > pageIds.length && lastPlanId !== undefined
        ? encodeCursor(
            DeliveryQueryDefinition.id,
            canonicalJson({ filterHash, planId: lastPlanId }),
          )
        : null,
  });
}

function queryDelivery(database: DatabaseSync, request: QueryRequest): Success<'delivery.query'> {
  const project = getProject(database, request.input.projectId);
  const cursor = decodeCursor(request.input.page.cursor, 'delivery.query');
  const planIds =
    request.input.deliveryPlanIds.length === 0
      ? (
          database
            .prepare(
              `SELECT id FROM delivery_plans
               WHERE project_id = ? AND (? IS NULL OR id > ?)
               ORDER BY id LIMIT ?`,
            )
            .all(project.id, cursor, cursor, request.input.page.limit + 1) as unknown as Array<{
            id: string;
          }>
        ).map((row) => row.id)
      : request.input.deliveryPlanIds
          .filter((id) => cursor === null || id > cursor)
          .sort()
          .slice(0, request.input.page.limit + 1);
  const hasMore = planIds.length > request.input.page.limit;
  const pageIds = planIds.slice(0, request.input.page.limit);
  const plans = pageIds.map((id) => {
    const plan = loadDeliveryPlanRecord(database, id);
    if (plan.projectId !== project.id) throw invalid(`Delivery ${id} belongs to another Project`);
    return plan;
  });
  const manifests = plans.flatMap((plan) =>
    (
      database
        .prepare(
          `SELECT id FROM delivery_manifests
           WHERE delivery_plan_id = ? ORDER BY delivery_revision, id`,
        )
        .all(plan.id) as unknown as Array<{ id: string }>
    ).map((row) => loadDeliveryManifest(database, row.id)),
  );
  return success<'delivery.query'>(request, {
    plans,
    manifests,
    operations: operationRefsForManifests(
      database,
      manifests.map((manifest) => manifest.id),
    ),
    nextCursor: hasMore ? encodeCursor('delivery.query', pageIds.at(-1)!) : null,
  });
}

function freezeItem(database: DatabaseSync, plan: DeliveryPlan, item: DeliveryItem) {
  const shot = loadProductionObject(database, item.shot.id);
  if (
    shot.projectId !== plan.projectId ||
    shot.type !== 'shot' ||
    shot.lifecycle !== 'active' ||
    shot.revision !== item.shot.revision ||
    shot.contentHash !== item.shot.contentHash
  ) {
    throw invalid(`Delivery item ${item.id} Shot reference is no longer exact`);
  }
  const result = loadGeneratedResultRecord(database, item.result.id);
  const projectMedia = loadProjectMediaRecord(database, item.projectMedia.id);
  const asset = loadGlobalMediaAsset(database, result.globalMediaAssetId);
  const blob = loadMediaBlob(database, result.mediaBlobHash);
  if (
    result.projectId !== plan.projectId ||
    result.targetProductionObjectId !== shot.id ||
    result.revision !== item.result.revision ||
    result.contentHash !== item.result.contentHash ||
    result.technicalValidation.state !== 'valid' ||
    result.mediaKind !== 'video' ||
    projectMedia.projectId !== plan.projectId ||
    projectMedia.lifecycle !== 'active' ||
    projectMedia.revision !== item.projectMedia.revision ||
    projectMedia.contentHash !== item.projectMedia.contentHash ||
    projectMedia.globalAssetId !== asset.id ||
    asset.blobHash !== blob.hash ||
    blob.technicalFacts.kind !== 'video' ||
    (blob.technicalFacts.durationMs !== null && item.trimEndMs > blob.technicalFacts.durationMs)
  ) {
    throw invalid(`Delivery item ${item.id} media references are not technically valid`);
  }
  return {
    deliveryItemId: item.id,
    deliveryItemRevision: item.revision,
    deliveryItemContentHash: item.contentHash,
    shotId: shot.id,
    shotRevision: shot.revision,
    shotContentHash: shot.contentHash,
    generatedResultId: result.id,
    generatedResultRevision: result.revision,
    generatedResultContentHash: result.contentHash,
    projectMediaRefId: projectMedia.id,
    projectMediaRevision: projectMedia.revision,
    projectMediaContentHash: projectMedia.contentHash,
    globalAssetId: asset.id,
    globalAssetRevision: asset.revision,
    globalAssetContentHash: asset.contentHash,
    blobHash: blob.hash,
    order: item.order,
    trimStartMs: item.trimStartMs,
    trimEndMs: item.trimEndMs,
    audioPolicy: item.audioPolicy,
    transition: item.transition,
    reviewState: item.reviewState,
  };
}

export function freezeDeliveryInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: FreezeDeliveryInput,
  contextValue: CommandContext,
  occurredAt: string,
): DeliveryManifest {
  const input = { plan: parseCanonical(DeliveryRefSchema, inputValue.plan) };
  const context = parseCanonical(CommandContextSchema, contextValue);
  if (context.actor === 'import') throw invalid('Import cannot freeze Delivery');
  const existing = database
    .prepare(
      `SELECT id FROM delivery_manifests
         WHERE delivery_plan_id = ? AND delivery_revision = ? AND delivery_content_hash = ?`,
    )
    .get(input.plan.id, input.plan.revision, input.plan.contentHash) as unknown as
    { id: string } | undefined;
  if (existing !== undefined) return loadDeliveryManifest(database, existing.id);
  const plan = requireExactPlan(database, input.plan);
  if (plan.lifecycle !== 'active') throw invalid(`Delivery ${plan.id} is archived`);
  const active = activeItems(plan);
  if (active.length === 0) throw invalid('Delivery has no active items to freeze');
  const choiceByField = currentChoiceMap(plan);
  const requiredFields = [
    planField(plan.id, 'order'),
    ...active.flatMap((item) => [
      itemField(plan.id, item.id, 'clip'),
      itemField(plan.id, item.id, 'reviewState'),
    ]),
  ];
  if (requiredFields.some((field) => !choiceByField.has(deliveryFieldKey(field)))) {
    throw invalid('Delivery has no explicit current selection chain');
  }
  const activeIds = new Set(active.map((item) => item.id));
  const relevant = (field: ProtectedFieldRef): field is DeliveryField =>
    field.owner === 'delivery' &&
    field.deliveryId === plan.id &&
    (field.itemId === null || activeIds.has(field.itemId));
  const manifestChoices = plan.currentChoices
    .filter((entry) => relevant(entry.field))
    .map((entry) => {
      const choice = loadUserChoiceRecord(database, entry.choiceId);
      if (choice.projectId !== plan.projectId) {
        throw corrupt(`Delivery Choice ${choice.id} belongs to another Project`);
      }
      return {
        field: entry.field,
        choice: {
          authority: 'user_choice' as const,
          id: choice.id,
          choiceHash: choice.choiceHash,
        },
      };
    })
    .sort(compareManifestFieldEntries);
  const protections = plan.protections
    .filter((entry) => relevant(entry.field))
    .map((entry) => {
      const choice = loadUserChoiceRecord(database, entry.choiceId);
      if (choice.projectId !== plan.projectId) {
        throw corrupt(`Delivery protection Choice ${choice.id} belongs to another Project`);
      }
      return {
        field: entry.field,
        choice: {
          authority: 'user_choice' as const,
          id: choice.id,
          choiceHash: choice.choiceHash,
        },
      };
    })
    .sort(compareManifestFieldEntries);
  const manifestId = environment.createId('delivery_manifest');
  const normalized = parseCanonical(DeliveryManifestSchema, {
    authority: 'delivery_manifest',
    id: manifestId,
    projectId: plan.projectId,
    revision: 0,
    contentHash: ZERO_HASH,
    sourcePlan: deliveryRef(plan),
    formatIntent: plan.formatIntent,
    items: active.map((item) => freezeItem(database, plan, item)),
    currentChoices: manifestChoices,
    protections,
    createdBy: context.causation,
    frozenAt: occurredAt,
  });
  const manifest = parseCanonical(DeliveryManifestSchema, {
    ...normalized,
    contentHash: hashCanonical(deliveryManifestContentHashInput(normalized)),
  });
  database
    .prepare(
      `INSERT INTO delivery_manifests (
           id, project_id, delivery_plan_id, delivery_revision, delivery_content_hash,
           revision, content_hash, format_intent_v1_json, created_by_v1_json, frozen_at
         ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      manifest.id,
      manifest.projectId,
      manifest.sourcePlan.id,
      manifest.sourcePlan.revision,
      manifest.sourcePlan.contentHash,
      manifest.contentHash,
      canonicalJson(manifest.formatIntent),
      canonicalJson(manifest.createdBy),
      manifest.frozenAt,
    );
  const insertItem = database.prepare(
    `INSERT INTO delivery_manifest_items (
         id, delivery_manifest_id, delivery_item_id, delivery_item_revision,
         delivery_item_content_hash, shot_id, shot_revision, shot_content_hash,
         generated_result_id, generated_result_revision, generated_result_content_hash,
         project_media_ref_id, project_media_revision, project_media_content_hash,
         global_asset_id, global_asset_revision, global_asset_content_hash, blob_hash,
         ordinal, trim_start_ms, trim_end_ms, audio_policy,
         transition_kind, transition_duration_ms, review_state
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of manifest.items) {
    insertItem.run(
      environment.createId('delivery_manifest_item'),
      manifest.id,
      item.deliveryItemId,
      item.deliveryItemRevision,
      item.deliveryItemContentHash,
      item.shotId,
      item.shotRevision,
      item.shotContentHash,
      item.generatedResultId,
      item.generatedResultRevision,
      item.generatedResultContentHash,
      item.projectMediaRefId,
      item.projectMediaRevision,
      item.projectMediaContentHash,
      item.globalAssetId,
      item.globalAssetRevision,
      item.globalAssetContentHash,
      item.blobHash,
      item.order,
      item.trimStartMs,
      item.trimEndMs,
      item.audioPolicy,
      item.transition.kind,
      item.transition.durationMs,
      item.reviewState,
    );
  }
  const insertSnapshot = (table: 'delivery_manifest_choices' | 'delivery_manifest_protections') =>
    database.prepare(
      `INSERT INTO ${table} (
           delivery_manifest_id, delivery_item_id, field_ref, choice_id, choice_hash
         ) VALUES (?, ?, ?, ?, ?)`,
    );
  for (const [table, entries] of [
    ['delivery_manifest_choices', manifest.currentChoices],
    ['delivery_manifest_protections', manifest.protections],
  ] as const) {
    const insert = insertSnapshot(table);
    for (const entry of entries) {
      insert.run(
        manifest.id,
        entry.field.itemId,
        deliveryFieldKey(entry.field),
        entry.choice.id,
        entry.choice.choiceHash,
      );
    }
  }
  appendDeliveryEvent(
    database,
    context,
    deliveryFreezeCommandId(input),
    environment.createId('project_event'),
    plan,
    plan.revision,
    manifest.contentHash,
    occurredAt,
  );
  return loadDeliveryManifest(database, manifest.id);
}

function freezeDelivery(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: FreezeDeliveryInput,
  contextValue: CommandContext,
): DeliveryManifest {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    return freezeDeliveryInTransaction(database, environment, inputValue, contextValue, occurredAt);
  });
}

export interface DeliveryAuthority {
  readonly apply: (
    request: ApplyRequest,
    context: CommandContext,
    host?: CommandDispatchHost,
  ) => Success<'delivery.apply'>;
  readonly query: (request: QueryRequest) => Success<'delivery.query'>;
  readonly queryTool: (
    projectId: string,
    input: DeliveryToolQueryInput,
  ) => DeliveryToolQuerySuccess;
  readonly freeze: (input: FreezeDeliveryInput, context: CommandContext) => DeliveryManifest;
  readonly getManifest: (manifestId: string) => DeliveryManifest;
}

export function createDeliveryAuthority(
  store: Store,
  environment: StorageEnvironment,
): DeliveryAuthority {
  const database = () => getStoreDatabase(store);
  return Object.freeze({
    apply(request: ApplyRequest, context: CommandContext, host?: CommandDispatchHost) {
      return applyDelivery(
        database(),
        environment,
        exactRequest(request, 'delivery.apply'),
        context,
        host,
      );
    },
    query(request: QueryRequest) {
      return queryDelivery(database(), exactRequest(request, 'delivery.query'));
    },
    queryTool(projectId: string, input: DeliveryToolQueryInput) {
      return queryDeliveryTool(database(), projectId, input);
    },
    freeze(input: FreezeDeliveryInput, context: CommandContext) {
      return freezeDelivery(database(), environment, input, context);
    },
    getManifest(manifestId: string) {
      return loadDeliveryManifest(database(), manifestId);
    },
  });
}

export type { CommandDispatchHost as DeliveryCommandHost };
