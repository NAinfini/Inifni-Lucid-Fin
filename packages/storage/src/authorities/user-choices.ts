import {
  EntityIdSchema,
  IsoTimestampSchema,
  WireSuccessV1Schema,
  canonicalJson,
  parseCanonical,
  parseRequestV1,
  type ChoiceOwnerRef,
  type DeliveryItem,
  type DeliveryPlan,
  type GeneratedResult,
  type ProductionObject,
  type ProtectedFieldRef,
  type ShotResultDecision,
  type ShotResultDecisionValue,
  type UserChoice,
  type UserChoiceEffect,
  type UserChoiceIntent,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import type { Store } from '../kernel/store.js';
import {
  CommandContextSchema,
  executeWireMutation,
  type CommandContext,
} from '../internal/command.js';
import { getStoreDatabase } from '../internal/database-access.js';
import type { StorageEnvironment } from '../internal/environment.js';
import { hashCanonical } from '../internal/hashes.js';
import { decodeProtectedFieldRef } from '../internal/canonical-codecs.js';
import {
  deliveryFieldKey,
  deliveryRef,
  finalizeDeliveryItem,
  finalizeDeliveryPlan,
  loadDeliveryPlanRecord,
  setDeliveryFieldChoices,
  updateDeliverySearchDocument,
  writeDeliveryPlanRecord,
} from '../internal/delivery-records.js';
import { loadGeneratedResultRecord } from '../internal/operation-owner-records.js';
import {
  assertCommanderChoiceReplay,
  authorizeChoiceMutation,
  plannedProtectedChoiceMutationIds,
  type CommandDispatchHost,
  type ProtectedChoiceMutationPlannedIds,
} from '../internal/protection-guard.js';
import { appendProjectEvent } from '../internal/project-events.js';
import {
  finalizeProductionObject,
  loadProductionObject,
  updateProductionSearchDocument,
  writeProductionObjectRecord,
} from '../internal/production-records.js';
import {
  finalizeUserChoiceRecord,
  findUserChoiceByDispatch,
  insertUserChoiceRecord,
  loadUserChoiceRecord,
} from '../internal/user-choice-records.js';

type RequestMap = {
  [Method in WireRequestV1['method']]: Extract<WireRequestV1, { method: Method }>;
};
type SuccessMap = {
  [Method in WireSuccessV1['method']]: Extract<WireSuccessV1, { method: Method }>;
};
type Request<Method extends keyof RequestMap> = RequestMap[Method];
type Success<Method extends keyof SuccessMap> = SuccessMap[Method];
type ResultDecisionRequest = Request<'decision.record'> & {
  readonly input: Exclude<Request<'decision.record'>['input'], { action: 'undo' }>;
};
type UndoChoiceRequest = Request<'decision.record'> & {
  readonly input: Extract<Request<'decision.record'>['input'], { action: 'undo' }>;
};
type ShotObject = Extract<ProductionObject, { type: 'shot' }>;
type DeliveryEffect = Extract<UserChoiceEffect, { kind: 'delivery' }>;
type DeliveryField = Extract<ProtectedFieldRef, { owner: 'delivery' }>;
type DecisionCurrentState = 'selected' | 'rejected' | 'refine' | 'reference' | 'unreviewed';
type DecisionRecordAction = ResultDecisionRequest['input']['action'] | 'undo';

export type DecisionMutationKind =
  | 'production_result'
  | 'production_undo'
  | 'delivery_undo'
  | 'production_protection'
  | 'delivery_protection';

interface PlannedDecisionMutationBase<
  Method extends 'decision.record' | 'decision.protect',
  Before extends ProductionObject | DeliveryPlan,
  After extends ProductionObject | DeliveryPlan,
> {
  readonly kind: DecisionMutationKind;
  readonly toolId: Method;
  readonly request: Request<Method>;
  readonly requestId: string;
  readonly command: Request<Method>['input'];
  readonly occurredAt: string;
  readonly contextHash: string;
  readonly dispatchOperationId: string | null;
  readonly projectId: string;
  readonly before: Before;
  readonly after: After;
  readonly ownerBefore: ChoiceOwnerRef;
  readonly ownerAfter: ChoiceOwnerRef;
  readonly intent: UserChoiceIntent;
  readonly subject: UserChoice['subject'];
  readonly fields: readonly ProtectedFieldRef[];
  readonly activeChoiceIds: readonly string[];
  readonly beforeEffect: UserChoiceEffect;
  readonly afterEffect: UserChoiceEffect;
  readonly proposedEffectHash: string;
  readonly supersedesChoiceIds: readonly string[];
  readonly plannedIds: ProtectedChoiceMutationPlannedIds;
}

export interface PlannedProductionResultDecisionMutation extends PlannedDecisionMutationBase<
  'decision.record',
  ShotObject,
  ShotObject
> {
  readonly kind: 'production_result';
  readonly request: ResultDecisionRequest;
  readonly command: ResultDecisionRequest['input'];
  readonly resultIds: readonly string[];
  readonly currentState: DecisionCurrentState;
}

export interface PlannedProductionUndoDecisionMutation extends PlannedDecisionMutationBase<
  'decision.record',
  ShotObject,
  ShotObject
> {
  readonly kind: 'production_undo';
  readonly request: UndoChoiceRequest;
  readonly command: UndoChoiceRequest['input'];
  readonly currentState: DecisionCurrentState | null;
}

export interface PlannedDeliveryUndoDecisionMutation extends PlannedDecisionMutationBase<
  'decision.record',
  DeliveryPlan,
  DeliveryPlan
> {
  readonly kind: 'delivery_undo';
  readonly request: UndoChoiceRequest;
  readonly command: UndoChoiceRequest['input'];
  readonly currentState: null;
}

export interface PlannedProductionProtectionDecisionMutation extends PlannedDecisionMutationBase<
  'decision.protect',
  ProductionObject,
  ProductionObject
> {
  readonly kind: 'production_protection';
  readonly request: Request<'decision.protect'>;
  readonly command: Request<'decision.protect'>['input'];
  readonly active: boolean;
}

export interface PlannedDeliveryProtectionDecisionMutation extends PlannedDecisionMutationBase<
  'decision.protect',
  DeliveryPlan,
  DeliveryPlan
> {
  readonly kind: 'delivery_protection';
  readonly request: Request<'decision.protect'>;
  readonly command: Request<'decision.protect'>['input'];
  readonly active: boolean;
}

export type PlannedDecisionMutation =
  | PlannedProductionResultDecisionMutation
  | PlannedProductionUndoDecisionMutation
  | PlannedDeliveryUndoDecisionMutation
  | PlannedProductionProtectionDecisionMutation
  | PlannedDeliveryProtectionDecisionMutation;

export type CommittedDecisionMutation =
  | {
      readonly toolId: 'decision.record';
      readonly choice: UserChoice;
      readonly owner: ChoiceOwnerRef;
      readonly eventId: string;
      readonly currentState: DecisionCurrentState | null;
    }
  | {
      readonly toolId: 'decision.protect';
      readonly choice: UserChoice;
      readonly owner: ChoiceOwnerRef;
      readonly eventId: string;
      readonly active: boolean;
    };

export type DecisionMutationToolSuccess =
  | {
      readonly choice: {
        readonly authority: 'user_choice';
        readonly id: string;
        readonly choiceHash: string;
      };
      readonly action: DecisionRecordAction;
      readonly owner: ChoiceOwnerRef;
      readonly currentState: DecisionCurrentState | null;
      readonly eventId: string;
    }
  | {
      readonly choice: {
        readonly authority: 'user_choice';
        readonly id: string;
        readonly choiceHash: string;
      };
      readonly active: boolean;
      readonly owner: ChoiceOwnerRef;
      readonly eventId: string;
    };

export interface DecisionProtectionInTransactionResult {
  readonly choice: UserChoice;
  readonly active: boolean;
  readonly owner: ChoiceOwnerRef;
  readonly eventId: string;
}

function invalid(message: string): StorageError {
  return new StorageError('INVALID_REQUEST', message);
}

function corrupt(message: string): StorageError {
  return new StorageError('CORRUPT_DATA', message);
}

function exactRequest<Method extends 'decision.record' | 'decision.protect'>(
  value: Request<Method>,
  method: Method,
): Request<Method> {
  const request = parseRequestV1(value);
  if (request.method !== method) throw invalid(`Expected Wire method ${method}`);
  return request as Request<Method>;
}

function success<Method extends 'decision.record' | 'decision.protect'>(
  request: Request<Method>,
  choice: UserChoice,
): Success<Method> {
  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result: choice,
  }) as Success<Method>;
}

function productionRef(object: ProductionObject): ChoiceOwnerRef {
  return {
    authority: 'production',
    id: object.id,
    revision: object.revision,
    contentHash: object.contentHash,
  };
}

function requireExactProductionOwner(
  database: DatabaseSync,
  ref: Extract<ChoiceOwnerRef, { authority: 'production' }>,
): ProductionObject {
  const object = loadProductionObject(database, ref.id);
  if (object.revision !== ref.revision || object.contentHash !== ref.contentHash) {
    throw new StorageError('REVISION_CONFLICT', `Production object ${ref.id} changed`);
  }
  return object;
}

function choiceActor(context: CommandContext): UserChoice['actor'] {
  if (context.actor === 'system') throw invalid('System cannot record a UserChoice');
  return context.actor;
}

function appendChoiceEvent(
  database: DatabaseSync,
  environment: StorageEnvironment,
  requestId: string,
  choice: UserChoice,
  context: CommandContext,
  eventId: string = environment.createId('project_event'),
): string {
  return appendProjectEvent(database, {
    eventId,
    projectId: choice.projectId,
    occurredAt: choice.createdAt,
    actor: context.actor,
    subject: { authority: 'user_choice', id: choice.id },
    causation: context.causation,
    correlationId: context.correlationId,
    idempotencyKey: requestId,
    payload: { type: 'choice_recorded', choiceId: choice.id },
  }).id;
}

function choiceMutationPlannedIds(
  environment: StorageEnvironment,
  context: CommandContext,
  host: CommandDispatchHost | undefined,
  toolId: 'decision.record' | 'decision.protect',
): ProtectedChoiceMutationPlannedIds {
  if (context.actor === 'commander' && host !== undefined) {
    return plannedProtectedChoiceMutationIds(host.dispatchOperationId, toolId);
  }
  const userChoiceId = parseCanonical(EntityIdSchema, environment.createId('user_choice'));
  const projectEventId = parseCanonical(EntityIdSchema, environment.createId('project_event'));
  return toolId === 'decision.record'
    ? Object.freeze({ tool: toolId, userChoiceId, projectEventId })
    : Object.freeze({ tool: toolId, userChoiceId, projectEventId });
}

function plannedDecisionContext(
  context: CommandContext,
  host: CommandDispatchHost | undefined,
): Pick<
  PlannedDecisionMutationBase<'decision.record', ShotObject, ShotObject>,
  'contextHash' | 'dispatchOperationId'
> {
  return {
    contextHash: hashCanonical(context),
    dispatchOperationId: context.actor === 'commander' ? (host?.dispatchOperationId ?? null) : null,
  };
}

function activeProtectionChoiceIds(
  fields: readonly ProtectedFieldRef[],
  protections: readonly { field: ProtectedFieldRef; choiceId: string }[],
): string[] {
  const fieldKeys = new Set(fields.map(protectionFieldKey));
  return [
    ...new Set(
      protections
        .filter((protection) => fieldKeys.has(protectionFieldKey(protection.field)))
        .map((protection) => protection.choiceId),
    ),
  ].sort();
}

function currentDecisionState(shot: ShotObject, resultId: string): DecisionCurrentState {
  return decisionMap(shot).get(resultId)?.value.state ?? 'unreviewed';
}

function freezePlannedDecisionMutation<
  Plan extends {
    readonly fields: readonly ProtectedFieldRef[];
    readonly activeChoiceIds: readonly string[];
    readonly supersedesChoiceIds: readonly string[];
  },
>(plan: Plan): Plan {
  return Object.freeze({
    ...plan,
    fields: Object.freeze([...plan.fields]),
    activeChoiceIds: Object.freeze([...plan.activeChoiceIds]),
    supersedesChoiceIds: Object.freeze([...plan.supersedesChoiceIds]),
  }) as unknown as Plan;
}

function choiceEventId(database: DatabaseSync, choice: UserChoice): string {
  const rows = database
    .prepare(
      `SELECT id FROM project_events
       WHERE project_id = ? AND event_type = 'choice_recorded'
         AND subject_authority = 'user_choice' AND subject_id = ?`,
    )
    .all(choice.projectId, choice.id) as Array<{ id: string }>;
  if (rows.length !== 1) {
    throw corrupt(`Choice ${choice.id} does not have exactly one recorded event`);
  }
  return parseCanonical(EntityIdSchema, rows[0]!.id);
}

function resultIntent(input: ResultDecisionRequest['input']): UserChoiceIntent {
  switch (input.action) {
    case 'select':
      return { kind: 'select', resultId: input.result.id, feedback: input.feedback };
    case 'reject':
      return { kind: 'reject', resultId: input.result.id, feedback: input.feedback };
    case 'refine':
      return { kind: 'refine', resultId: input.result.id, instruction: input.instruction };
    case 'use_as_reference':
      return { kind: 'use_as_reference', resultId: input.result.id, feedback: input.feedback };
  }
}

function decisionValue(input: ResultDecisionRequest['input']): ShotResultDecisionValue {
  switch (input.action) {
    case 'select':
      return { state: 'selected', feedback: input.feedback };
    case 'reject':
      return { state: 'rejected', feedback: input.feedback };
    case 'refine':
      return { state: 'refine', instruction: input.instruction };
    case 'use_as_reference':
      return { state: 'reference', feedback: input.feedback };
  }
}

function requireResultForShot(
  database: DatabaseSync,
  shot: ShotObject,
  ref: ResultDecisionRequest['input']['result'],
): GeneratedResult {
  const result = loadGeneratedResultRecord(database, ref.id);
  if (
    result.projectId !== shot.projectId ||
    result.targetProductionObjectId !== shot.id ||
    result.revision !== 0 ||
    ref.revision !== 0 ||
    result.contentHash !== ref.contentHash
  ) {
    throw invalid(`Generated Result ${ref.id} does not belong to this exact Shot`);
  }
  return result;
}

function decisionMap(shot: ShotObject): Map<string, ShotResultDecision> {
  return new Map(shot.resultDecisions.map((decision) => [decision.result.id, decision]));
}

function sortedDecisions(decisions: Iterable<ShotResultDecision>): ShotResultDecision[] {
  return [...decisions].sort((left, right) => left.result.id.localeCompare(right.result.id));
}

function resultField(shotId: string, resultId: string): ProtectedFieldRef {
  return { owner: 'production', objectId: shotId, field: 'resultDecision', resultId };
}

function applyDecisionRows(
  database: DatabaseSync,
  shot: ShotObject,
  resultIds: readonly string[],
  after: ReadonlyMap<string, ShotResultDecision>,
): void {
  const remove = database.prepare(
    'DELETE FROM production_result_decisions WHERE shot_id = ? AND generated_result_id = ?',
  );
  for (const resultId of resultIds) remove.run(shot.id, resultId);
  const insert = database.prepare(
    `INSERT INTO production_result_decisions (
       project_id, shot_id, generated_result_id, generated_result_revision,
       generated_result_hash, state, feedback, instruction, current_choice_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const resultId of resultIds) {
    const decision = after.get(resultId);
    if (decision === undefined) continue;
    insert.run(
      shot.projectId,
      shot.id,
      decision.result.id,
      decision.result.revision,
      decision.result.contentHash,
      decision.value.state,
      'feedback' in decision.value ? decision.value.feedback : null,
      'instruction' in decision.value ? decision.value.instruction : null,
      decision.currentChoiceId,
    );
  }
}

function commanderReplay(
  database: DatabaseSync,
  request: Request<'decision.record'> | Request<'decision.protect'>,
  context: CommandContext,
  host: CommandDispatchHost | undefined,
  expectedIntent: UserChoiceIntent,
): UserChoice | undefined {
  if (context.actor !== 'commander' || host === undefined) return undefined;
  const existing = findUserChoiceByDispatch(database, host.dispatchOperationId);
  if (existing === undefined) return undefined;
  assertCommanderChoiceReplay(database, {
    request,
    context,
    host,
    choice: existing,
    expectedIntent,
  });
  return existing;
}

function planProductionResultDecisionMutation(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: ResultDecisionRequest,
  context: CommandContext,
  now: string,
  host?: CommandDispatchHost,
): PlannedProductionResultDecisionMutation {
  const intent = resultIntent(request.input);
  const plannedIds = choiceMutationPlannedIds(environment, context, host, 'decision.record');
  const beforeObject = requireExactProductionOwner(database, request.input.shot);
  if (beforeObject.type !== 'shot') throw invalid('Result decisions require a Shot owner');
  const result = requireResultForShot(database, beforeObject, request.input.result);
  const before = decisionMap(beforeObject);
  const affectedIds = new Set<string>([result.id]);
  if (request.input.action === 'select') {
    for (const decision of before.values()) {
      if (decision.value.state === 'selected' && decision.result.id !== result.id) {
        affectedIds.add(decision.result.id);
      }
    }
  }
  const resultIds = [...affectedIds].sort();
  const beforeEffect: UserChoiceEffect = {
    kind: 'result_decisions',
    shotId: beforeObject.id,
    entries: resultIds.map((resultId) => ({
      resultId,
      value: before.get(resultId)?.value ?? null,
    })),
  };
  const after = new Map(before);
  if (request.input.action === 'select') {
    for (const resultId of resultIds) if (resultId !== result.id) after.delete(resultId);
  }
  const choiceId = plannedIds.userChoiceId;
  after.set(result.id, {
    result: {
      authority: 'generated_result',
      id: result.id,
      revision: 0,
      contentHash: result.contentHash,
    },
    value: decisionValue(request.input),
    currentChoiceId: choiceId,
  });
  const afterEffect: UserChoiceEffect = {
    kind: 'result_decisions',
    shotId: beforeObject.id,
    entries: resultIds.map((resultId) => ({
      resultId,
      value: after.get(resultId)?.value ?? null,
    })),
  };
  const fields = resultIds.map((resultId) => resultField(beforeObject.id, resultId));
  const afterInput: Omit<ShotObject, 'contentHash'> = {
    ...beforeObject,
    revision: beforeObject.revision + 1,
    resultDecisions: sortedDecisions(after.values()),
    updatedBy: context.causation,
    updatedAt: now,
  };
  const afterObject = finalizeProductionObject(afterInput);
  if (afterObject.type !== 'shot') throw corrupt('Shot decision owner changed type');
  const supersedesChoiceIds = [
    ...new Set(
      resultIds
        .map((resultId) => before.get(resultId)?.currentChoiceId)
        .filter((id): id is string => id !== undefined),
    ),
  ].sort();
  return freezePlannedDecisionMutation({
    kind: 'production_result',
    toolId: 'decision.record',
    request,
    requestId: request.requestId,
    command: request.input,
    occurredAt: now,
    ...plannedDecisionContext(context, host),
    projectId: beforeObject.projectId,
    before: beforeObject,
    after: afterObject,
    ownerBefore: productionRef(beforeObject),
    ownerAfter: productionRef(afterObject),
    intent,
    subject: { kind: 'result_decision', shotId: beforeObject.id, resultIds },
    fields,
    activeChoiceIds: activeProtectionChoiceIds(fields, beforeObject.protections),
    beforeEffect,
    afterEffect,
    proposedEffectHash: hashCanonical(afterEffect),
    supersedesChoiceIds,
    plannedIds,
    resultIds,
    currentState: decisionValue(request.input).state,
  });
}

function protectionFieldKey(field: ProtectedFieldRef): string {
  return canonicalJson(field);
}

function protectionResult(
  choice: UserChoice,
  active: boolean,
  eventId: string,
): DecisionProtectionInTransactionResult {
  if (choice.ownerAfter === null) throw corrupt(`Protection Choice ${choice.id} has no owner`);
  return { choice, active, owner: choice.ownerAfter, eventId };
}

function planProductionProtectionDecisionMutation(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: Request<'decision.protect'>,
  context: CommandContext,
  now: string,
  host?: CommandDispatchHost,
): PlannedProductionProtectionDecisionMutation {
  if (
    request.input.owner.authority !== 'production' ||
    request.input.field.owner !== 'production'
  ) {
    throw invalid('Delivery protection belongs to the Delivery authority');
  }
  const intent: UserChoiceIntent = {
    kind: request.input.mode,
    field: request.input.field,
    reason: request.input.reason,
  };
  const plannedIds = choiceMutationPlannedIds(environment, context, host, 'decision.protect');
  const beforeObject = requireExactProductionOwner(database, request.input.owner);
  if (request.input.field.objectId !== beforeObject.id) {
    throw invalid('Protection field does not belong to its Production owner');
  }
  const fieldKey = protectionFieldKey(request.input.field);
  const active = beforeObject.protections.find(
    (protection) => protectionFieldKey(protection.field) === fieldKey,
  );
  if ((request.input.mode === 'protect') === (active !== undefined)) {
    throw invalid(
      request.input.mode === 'protect'
        ? 'Production field is already protected'
        : 'Production field is not protected',
    );
  }
  const beforeEffect: UserChoiceEffect = {
    kind: 'protection',
    field: request.input.field,
    active: active !== undefined,
  };
  const afterEffect: UserChoiceEffect = {
    kind: 'protection',
    field: request.input.field,
    active: request.input.mode === 'protect',
  };
  const choiceId = plannedIds.userChoiceId;
  const protections =
    request.input.mode === 'protect'
      ? [
          ...beforeObject.protections,
          { field: request.input.field, choiceId, protectedAt: now },
        ].sort((left, right) =>
          protectionFieldKey(left.field).localeCompare(protectionFieldKey(right.field)),
        )
      : beforeObject.protections.filter(
          (protection) => protectionFieldKey(protection.field) !== fieldKey,
        );
  const afterObject = finalizeProductionObject({
    ...beforeObject,
    revision: beforeObject.revision + 1,
    protections,
    updatedBy: context.causation,
    updatedAt: now,
  });
  return freezePlannedDecisionMutation({
    kind: 'production_protection',
    toolId: 'decision.protect',
    request,
    requestId: request.requestId,
    command: request.input,
    occurredAt: now,
    ...plannedDecisionContext(context, host),
    projectId: beforeObject.projectId,
    before: beforeObject,
    after: afterObject,
    ownerBefore: productionRef(beforeObject),
    ownerAfter: productionRef(afterObject),
    intent,
    subject: { kind: 'protection', field: request.input.field },
    fields: [request.input.field],
    activeChoiceIds: activeProtectionChoiceIds([request.input.field], beforeObject.protections),
    beforeEffect,
    afterEffect,
    proposedEffectHash: hashCanonical(afterEffect),
    supersedesChoiceIds: active === undefined ? [] : [active.choiceId],
    plannedIds,
    active: request.input.mode === 'protect',
  });
}

function requireExactDeliveryOwner(
  database: DatabaseSync,
  ref: Extract<ChoiceOwnerRef, { authority: 'delivery' }>,
): DeliveryPlan {
  const plan = loadDeliveryPlanRecord(database, ref.id);
  if (plan.revision !== ref.revision || plan.contentHash !== ref.contentHash) {
    throw new StorageError('REVISION_CONFLICT', `Delivery ${ref.id} changed`);
  }
  return plan;
}

function planDeliveryProtectionDecisionMutation(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: Request<'decision.protect'>,
  context: CommandContext,
  now: string,
  host?: CommandDispatchHost,
): PlannedDeliveryProtectionDecisionMutation {
  if (context.actor === 'import') throw invalid('Import cannot change Delivery protection');
  if (request.input.owner.authority !== 'delivery' || request.input.field.owner !== 'delivery') {
    throw invalid('Delivery protection requires a Delivery owner and field');
  }
  const field = request.input.field;
  const intent: UserChoiceIntent = {
    kind: request.input.mode,
    field,
    reason: request.input.reason,
  };
  const plannedIds = choiceMutationPlannedIds(environment, context, host, 'decision.protect');
  const before = requireExactDeliveryOwner(database, request.input.owner);
  if (field.deliveryId !== before.id) {
    throw invalid('Protection field does not belong to its Delivery owner');
  }
  if (field.itemId !== null && !before.items.some((item) => item.id === field.itemId)) {
    throw invalid(`Delivery item ${field.itemId} was not found`);
  }
  const key = deliveryFieldKey(field);
  const active = before.protections.find(
    (protection) => deliveryFieldKey(protection.field) === key,
  );
  if ((request.input.mode === 'protect') === (active !== undefined)) {
    throw invalid(
      request.input.mode === 'protect'
        ? 'Delivery field is already protected'
        : 'Delivery field is not protected',
    );
  }
  const beforeEffect: UserChoiceEffect = {
    kind: 'protection',
    field,
    active: active !== undefined,
  };
  const afterEffect: UserChoiceEffect = {
    kind: 'protection',
    field,
    active: request.input.mode === 'protect',
  };
  const choiceId = plannedIds.userChoiceId;
  const protections =
    request.input.mode === 'protect'
      ? [...before.protections, { field, choiceId, protectedAt: now }]
      : before.protections.filter((protection) => deliveryFieldKey(protection.field) !== key);
  const after = finalizeDeliveryPlan({
    ...before,
    revision: before.revision + 1,
    protections,
    updatedAt: now,
  });
  return freezePlannedDecisionMutation({
    kind: 'delivery_protection',
    toolId: 'decision.protect',
    request,
    requestId: request.requestId,
    command: request.input,
    occurredAt: now,
    ...plannedDecisionContext(context, host),
    projectId: before.projectId,
    before,
    after,
    ownerBefore: deliveryRef(before),
    ownerAfter: deliveryRef(after),
    intent,
    subject: { kind: 'protection', field },
    fields: [field],
    activeChoiceIds: activeProtectionChoiceIds([field], before.protections),
    beforeEffect,
    afterEffect,
    proposedEffectHash: hashCanonical(afterEffect),
    supersedesChoiceIds: active === undefined ? [] : [active.choiceId],
    plannedIds,
    active: request.input.mode === 'protect',
  });
}

export function setDecisionProtectionInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  requestInput: Request<'decision.protect'>,
  contextInput: CommandContext,
  occurredAtInput: string,
  host?: CommandDispatchHost,
): DecisionProtectionInTransactionResult {
  if (!database.isTransaction) {
    throw invalid('UserChoice protection core requires an active transaction');
  }
  const request = exactRequest(requestInput, 'decision.protect');
  const context = parseCanonical(CommandContextSchema, contextInput);
  const replay = commanderReplay(database, request, context, host, {
    kind: request.input.mode,
    field: request.input.field,
    reason: request.input.reason,
  });
  if (replay !== undefined) {
    return protectionResult(
      replay,
      request.input.mode === 'protect',
      choiceEventId(database, replay),
    );
  }
  const committed = commitPlannedDecisionMutationInTransaction(
    database,
    environment,
    planDecisionMutationInTransaction(
      database,
      environment,
      request,
      context,
      occurredAtInput,
      host,
    ),
    context,
    host,
  );
  if (committed.toolId !== 'decision.protect') {
    throw corrupt('Decision protection plan committed as a record');
  }
  return protectionResult(committed.choice, committed.active, committed.eventId);
}

function setDecisionProtection(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: Request<'decision.protect'>,
  context: CommandContext,
  host?: CommandDispatchHost,
): Success<'decision.protect'> {
  const now = environment.now();
  return executeWireMutation(
    database,
    request,
    context,
    now,
    () => {
      const result = setDecisionProtectionInTransaction(
        database,
        environment,
        request,
        context,
        now,
        host,
      );
      return {
        projectId: result.choice.projectId,
        response: success<'decision.protect'>(request, result.choice),
      };
    },
    host,
  );
}

function currentEffect(shot: ShotObject, effect: UserChoiceEffect): UserChoiceEffect {
  if (effect.kind === 'result_decisions') {
    const current = decisionMap(shot);
    return {
      ...effect,
      entries: effect.entries.map(({ resultId }) => ({
        resultId,
        value: current.get(resultId)?.value ?? null,
      })),
    };
  }
  if (effect.kind !== 'protection') throw invalid('Delivery undo belongs to Delivery authority');
  const fieldKey = protectionFieldKey(effect.field);
  return {
    ...effect,
    active: shot.protections.some(
      (protection) => protectionFieldKey(protection.field) === fieldKey,
    ),
  };
}

function effectFields(effect: UserChoiceEffect): ProtectedFieldRef[] {
  if (effect.kind === 'result_decisions') {
    return effect.entries.map(({ resultId }) => resultField(effect.shotId, resultId));
  }
  if (effect.kind === 'protection') return [effect.field];
  throw invalid('Delivery undo belongs to Delivery authority');
}

function applyUndoEffect(
  database: DatabaseSync,
  shot: ShotObject,
  effect: UserChoiceEffect,
  choiceId: string,
  now: string,
): { decisions: ShotResultDecision[]; protections: ShotObject['protections'] } {
  if (effect.kind === 'result_decisions') {
    const decisions = decisionMap(shot);
    for (const entry of effect.entries) {
      if (entry.value === null) decisions.delete(entry.resultId);
      else {
        const existing = decisions.get(entry.resultId);
        if (existing === undefined) {
          const row = database
            .prepare(
              `SELECT generated_result_revision, generated_result_hash
               FROM production_result_decisions
               WHERE shot_id = ? AND generated_result_id = ?`,
            )
            .get(shot.id, entry.resultId) as unknown as
            { generated_result_revision: 0; generated_result_hash: string } | undefined;
          if (row === undefined) {
            const result = loadGeneratedResultRecord(database, entry.resultId);
            if (
              result.projectId !== shot.projectId ||
              result.targetProductionObjectId !== shot.id
            ) {
              throw corrupt(`Undo Result ${entry.resultId} no longer belongs to its Shot`);
            }
            decisions.set(entry.resultId, {
              result: {
                authority: 'generated_result',
                id: result.id,
                revision: 0,
                contentHash: result.contentHash,
              },
              value: entry.value,
              currentChoiceId: choiceId,
            });
          } else {
            decisions.set(entry.resultId, {
              result: {
                authority: 'generated_result',
                id: entry.resultId,
                revision: row.generated_result_revision,
                contentHash: row.generated_result_hash,
              },
              value: entry.value,
              currentChoiceId: choiceId,
            });
          }
        } else
          decisions.set(entry.resultId, {
            ...existing,
            value: entry.value,
            currentChoiceId: choiceId,
          });
      }
    }
    return { decisions: sortedDecisions(decisions.values()), protections: shot.protections };
  }
  if (effect.kind !== 'protection') throw invalid('Delivery undo belongs to Delivery authority');
  const fieldKey = protectionFieldKey(effect.field);
  const active = shot.protections.find(
    (protection) => protectionFieldKey(protection.field) === fieldKey,
  );
  if (effect.active) {
    if (active !== undefined) throw corrupt('Undo protection target is already active');
    return {
      decisions: shot.resultDecisions,
      protections: [...shot.protections, { field: effect.field, choiceId, protectedAt: now }].sort(
        (left, right) =>
          protectionFieldKey(left.field).localeCompare(protectionFieldKey(right.field)),
      ),
    };
  }
  if (active === undefined) throw corrupt('Undo protection target is already inactive');
  return {
    decisions: shot.resultDecisions,
    protections: shot.protections.filter(
      (protection) => protectionFieldKey(protection.field) !== fieldKey,
    ),
  };
}

function persistUndoEffect(
  database: DatabaseSync,
  environment: StorageEnvironment,
  shot: ShotObject,
  effect: UserChoiceEffect,
  choiceId: string,
  now: string,
): void {
  if (effect.kind === 'result_decisions') {
    const after = decisionMap(shot);
    for (const entry of effect.entries) {
      if (entry.value === null) after.delete(entry.resultId);
      else {
        const result = loadGeneratedResultRecord(database, entry.resultId);
        after.set(entry.resultId, {
          result: {
            authority: 'generated_result',
            id: result.id,
            revision: 0,
            contentHash: result.contentHash,
          },
          value: entry.value,
          currentChoiceId: choiceId,
        });
      }
    }
    applyDecisionRows(
      database,
      shot,
      effect.entries.map(({ resultId }) => resultId),
      after,
    );
    return;
  }
  if (effect.kind !== 'protection') throw invalid('Delivery undo belongs to Delivery authority');
  const fieldKey = protectionFieldKey(effect.field);
  if (effect.active) {
    database
      .prepare(
        `INSERT INTO production_protections (
           id, project_id, production_object_id, field_ref, choice_id,
           protected_at, released_by_choice_id
         ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        environment.createId('production_protection'),
        shot.projectId,
        shot.id,
        fieldKey,
        choiceId,
        now,
      );
  } else {
    const released = database
      .prepare(
        `UPDATE production_protections SET released_by_choice_id = ?
         WHERE production_object_id = ? AND field_ref = ? AND released_by_choice_id IS NULL`,
      )
      .run(choiceId, shot.id, fieldKey);
    if (Number(released.changes) !== 1) {
      throw new StorageError('REVISION_CONFLICT', 'Production protection changed');
    }
  }
}

function deliveryItemSnapshot(item: DeliveryItem) {
  const { id: _id, revision: _revision, contentHash: _contentHash, ...snapshot } = item;
  return snapshot;
}

function currentDeliveryEffect(plan: DeliveryPlan, template: DeliveryEffect): DeliveryEffect {
  const items = new Map(plan.items.map((item) => [item.id, item]));
  return {
    kind: 'delivery',
    deliveryId: plan.id,
    settings:
      template.settings === null
        ? null
        : {
            name: plan.name,
            lifecycle: plan.lifecycle,
            formatIntent: plan.formatIntent,
          },
    items: template.items.map((entry) => {
      const item = items.get(entry.itemId);
      return {
        itemId: entry.itemId,
        value:
          item === undefined || (entry.value === null && item.lifecycle === 'removed')
            ? null
            : deliveryItemSnapshot(item),
      };
    }),
    order:
      template.order === null
        ? null
        : plan.items
            .filter((item) => item.lifecycle === 'active')
            .sort((left, right) => left.order - right.order)
            .map((item) => item.id),
  };
}

function restoreDeliveryEffect(
  plan: DeliveryPlan,
  effect: DeliveryEffect,
  now: string,
): Pick<DeliveryPlan, 'name' | 'lifecycle' | 'formatIntent' | 'items'> {
  const items = new Map(plan.items.map((item) => [item.id, item]));
  for (const entry of effect.items) {
    const current = items.get(entry.itemId);
    if (current === undefined) throw corrupt(`Delivery undo item ${entry.itemId} was not found`);
    const value =
      entry.value === null
        ? { ...deliveryItemSnapshot(current), lifecycle: 'removed' as const, removedAt: now }
        : entry.value;
    if (canonicalJson(deliveryItemSnapshot(current)) !== canonicalJson(value)) {
      items.set(
        current.id,
        finalizeDeliveryItem({ id: current.id, revision: current.revision + 1, ...value }),
      );
    }
  }
  if (effect.order !== null) {
    const expected = new Set(effect.order);
    const active = [...items.values()].filter((item) => item.lifecycle === 'active');
    if (expected.size !== active.length || active.some((item) => !expected.has(item.id))) {
      throw new StorageError('REVISION_CONFLICT', 'Delivery undo order is no longer exact');
    }
    for (const [order, itemId] of effect.order.entries()) {
      const current = items.get(itemId)!;
      if (current.order !== order) {
        items.set(
          current.id,
          finalizeDeliveryItem({
            id: current.id,
            revision: current.revision + 1,
            ...deliveryItemSnapshot(current),
            order,
          }),
        );
      }
    }
  }
  return {
    name: effect.settings?.name ?? plan.name,
    lifecycle: effect.settings?.lifecycle ?? plan.lifecycle,
    formatIntent: effect.settings?.formatIntent ?? plan.formatIntent,
    items: [...items.values()],
  };
}

function currentDeliveryChoiceFields(
  database: DatabaseSync,
  plan: DeliveryPlan,
  choiceId: string,
): DeliveryField[] {
  const rows = database
    .prepare(
      `SELECT field_ref FROM delivery_field_choices
       WHERE delivery_plan_id = ? AND choice_id = ? ORDER BY field_ref`,
    )
    .all(plan.id, choiceId) as unknown as Array<{ field_ref: string }>;
  if (rows.length === 0) {
    throw new StorageError('REVISION_CONFLICT', 'Delivery undo Choice is not current');
  }
  return rows.map((row) => {
    const field = decodeProtectedFieldRef(row.field_ref);
    if (field.owner !== 'delivery' || field.deliveryId !== plan.id) {
      throw corrupt(`Delivery ${plan.id} current Choice field has the wrong owner`);
    }
    return field;
  });
}

function updateDeliveryChoiceHeads(
  plan: DeliveryPlan,
  fields: readonly DeliveryField[],
  choiceId: string,
) {
  const choices = new Map(
    plan.currentChoices.map((entry) => [deliveryFieldKey(entry.field), entry]),
  );
  for (const field of fields) choices.set(deliveryFieldKey(field), { field, choiceId });
  return [...choices.values()];
}

function persistDeliveryProtectionUndo(
  database: DatabaseSync,
  environment: StorageEnvironment,
  plan: DeliveryPlan,
  effect: Extract<UserChoiceEffect, { kind: 'protection' }>,
  choiceId: string,
  now: string,
): void {
  if (effect.field.owner !== 'delivery' || effect.field.deliveryId !== plan.id) {
    throw corrupt('Delivery undo protection field has the wrong owner');
  }
  const key = deliveryFieldKey(effect.field);
  if (effect.active) {
    database
      .prepare(
        `INSERT INTO delivery_protections (
           id, project_id, delivery_plan_id, delivery_item_id, field_ref,
           choice_id, protected_at, released_by_choice_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        environment.createId('delivery_protection'),
        plan.projectId,
        plan.id,
        effect.field.itemId,
        key,
        choiceId,
        now,
      );
  } else {
    const released = database
      .prepare(
        `UPDATE delivery_protections SET released_by_choice_id = ?
         WHERE delivery_plan_id = ? AND delivery_item_id IS ? AND field_ref = ?
           AND released_by_choice_id IS NULL`,
      )
      .run(choiceId, plan.id, effect.field.itemId, key);
    if (Number(released.changes) !== 1) {
      throw new StorageError('REVISION_CONFLICT', 'Delivery protection changed');
    }
  }
}

function planDeliveryUndoDecisionMutation(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: UndoChoiceRequest,
  context: CommandContext,
  now: string,
  host?: CommandDispatchHost,
): PlannedDeliveryUndoDecisionMutation {
  if (context.actor === 'import') throw invalid('Import cannot undo Delivery');
  const intent: UserChoiceIntent = {
    kind: 'undo',
    targetChoiceId: request.input.targetChoice.id,
  };
  const plannedIds = choiceMutationPlannedIds(environment, context, host, 'decision.record');
  const target = loadUserChoiceRecord(database, request.input.targetChoice.id);
  if (target.choiceHash !== request.input.targetChoice.choiceHash) {
    throw invalid(`UserChoice ${target.id} hash does not match`);
  }
  if (
    target.ownerBefore === null ||
    target.ownerAfter.authority !== 'delivery' ||
    request.input.currentOwner.authority !== 'delivery' ||
    canonicalJson(target.ownerAfter) !== canonicalJson(request.input.currentOwner)
  ) {
    throw new StorageError(
      'REVISION_CONFLICT',
      'Undo target is not the exact current Delivery owner',
    );
  }
  const before = requireExactDeliveryOwner(database, request.input.currentOwner);
  if (before.projectId !== target.projectId) {
    throw invalid('Delivery undo target belongs to another Project');
  }
  const choiceId = plannedIds.userChoiceId;
  let fields: DeliveryField[];
  let after: DeliveryPlan;
  if (target.afterEffect.kind === 'delivery' && target.beforeEffect.kind === 'delivery') {
    if (
      canonicalJson(currentDeliveryEffect(before, target.afterEffect)) !==
      canonicalJson(target.afterEffect)
    ) {
      throw new StorageError('REVISION_CONFLICT', 'Delivery undo target is no longer current');
    }
    fields = currentDeliveryChoiceFields(database, before, target.id);
    const restored = restoreDeliveryEffect(before, target.beforeEffect, now);
    after = finalizeDeliveryPlan({
      ...before,
      ...restored,
      revision: before.revision + 1,
      currentChoices: updateDeliveryChoiceHeads(before, fields, choiceId),
      updatedAt: now,
    });
  } else if (
    target.afterEffect.kind === 'protection' &&
    target.beforeEffect.kind === 'protection' &&
    target.afterEffect.field.owner === 'delivery' &&
    target.beforeEffect.field.owner === 'delivery'
  ) {
    const field = target.afterEffect.field;
    const active = before.protections.find(
      (entry) => deliveryFieldKey(entry.field) === deliveryFieldKey(field),
    );
    if (
      target.afterEffect.active !== (active !== undefined) ||
      (target.afterEffect.active && active?.choiceId !== target.id)
    ) {
      throw new StorageError('REVISION_CONFLICT', 'Delivery protection undo is no longer current');
    }
    fields = [field];
    const protections = target.beforeEffect.active
      ? [...before.protections, { field, choiceId, protectedAt: now }]
      : before.protections.filter(
          (entry) => deliveryFieldKey(entry.field) !== deliveryFieldKey(field),
        );
    after = finalizeDeliveryPlan({
      ...before,
      revision: before.revision + 1,
      protections,
      updatedAt: now,
    });
  } else {
    throw invalid('Undo target does not belong to the Delivery authority');
  }
  return freezePlannedDecisionMutation({
    kind: 'delivery_undo',
    toolId: 'decision.record',
    request,
    requestId: request.requestId,
    command: request.input,
    occurredAt: now,
    ...plannedDecisionContext(context, host),
    projectId: before.projectId,
    before,
    after,
    ownerBefore: deliveryRef(before),
    ownerAfter: deliveryRef(after),
    intent,
    subject: target.subject,
    fields,
    activeChoiceIds: activeProtectionChoiceIds(fields, before.protections),
    beforeEffect: target.afterEffect,
    afterEffect: target.beforeEffect,
    proposedEffectHash: hashCanonical(target.beforeEffect),
    supersedesChoiceIds: [target.id],
    plannedIds,
    currentState: null,
  });
}

function planProductionUndoDecisionMutation(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: UndoChoiceRequest,
  context: CommandContext,
  now: string,
  host?: CommandDispatchHost,
): PlannedProductionUndoDecisionMutation {
  const intent: UserChoiceIntent = {
    kind: 'undo',
    targetChoiceId: request.input.targetChoice.id,
  };
  const plannedIds = choiceMutationPlannedIds(environment, context, host, 'decision.record');
  const target = loadUserChoiceRecord(database, request.input.targetChoice.id);
  if (target.choiceHash !== request.input.targetChoice.choiceHash) {
    throw invalid(`UserChoice ${target.id} hash does not match`);
  }
  if (
    target.ownerBefore === null ||
    target.ownerAfter.authority !== 'production' ||
    request.input.currentOwner.authority !== 'production' ||
    canonicalJson(target.ownerAfter) !== canonicalJson(request.input.currentOwner)
  ) {
    throw new StorageError('REVISION_CONFLICT', 'Undo target is not the exact current owner');
  }
  const beforeObject = requireExactProductionOwner(database, request.input.currentOwner);
  if (beforeObject.projectId !== target.projectId || beforeObject.type !== 'shot') {
    throw invalid('Undo target belongs to another Project or is not a Shot');
  }
  const current = currentEffect(beforeObject, target.afterEffect);
  if (canonicalJson(current) !== canonicalJson(target.afterEffect)) {
    throw new StorageError('REVISION_CONFLICT', 'Undo target is no longer current');
  }
  if (target.afterEffect.kind === 'result_decisions') {
    const decisions = decisionMap(beforeObject);
    for (const entry of target.afterEffect.entries) {
      if (entry.value !== null && decisions.get(entry.resultId)?.currentChoiceId !== target.id) {
        throw new StorageError('REVISION_CONFLICT', 'Undo target Choice is not current');
      }
    }
  } else if (target.afterEffect.kind === 'protection' && target.afterEffect.active) {
    const targetAfterEffect = target.afterEffect;
    const active = beforeObject.protections.find(
      (protection) =>
        protectionFieldKey(protection.field) === protectionFieldKey(targetAfterEffect.field),
    );
    if (active?.choiceId !== target.id) {
      throw new StorageError('REVISION_CONFLICT', 'Undo protection Choice is not current');
    }
  }
  const fields = effectFields(target.afterEffect);
  const choiceId = plannedIds.userChoiceId;
  const restored = applyUndoEffect(database, beforeObject, target.beforeEffect, choiceId, now);
  const afterInput: Omit<ShotObject, 'contentHash'> = {
    ...beforeObject,
    revision: beforeObject.revision + 1,
    resultDecisions: restored.decisions,
    protections: restored.protections,
    updatedBy: context.causation,
    updatedAt: now,
  };
  const afterObject = finalizeProductionObject(afterInput);
  if (afterObject.type !== 'shot') throw corrupt('Undo owner changed type');
  const currentState =
    target.afterEffect.kind === 'result_decisions' && target.afterEffect.entries.length === 1
      ? currentDecisionState(afterObject, target.afterEffect.entries[0]!.resultId)
      : null;
  return freezePlannedDecisionMutation({
    kind: 'production_undo',
    toolId: 'decision.record',
    request,
    requestId: request.requestId,
    command: request.input,
    occurredAt: now,
    ...plannedDecisionContext(context, host),
    projectId: target.projectId,
    before: beforeObject,
    after: afterObject,
    ownerBefore: productionRef(beforeObject),
    ownerAfter: productionRef(afterObject),
    intent,
    subject: target.subject,
    fields,
    activeChoiceIds: activeProtectionChoiceIds(fields, beforeObject.protections),
    beforeEffect: target.afterEffect,
    afterEffect: target.beforeEffect,
    proposedEffectHash: hashCanonical(target.beforeEffect),
    supersedesChoiceIds: [target.id],
    plannedIds,
    currentState,
  });
}

export function planDecisionMutationInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  requestInput: Request<'decision.record'> | Request<'decision.protect'>,
  contextInput: CommandContext,
  occurredAtInput: string,
  host?: CommandDispatchHost,
): PlannedDecisionMutation {
  if (!database.isTransaction) {
    throw invalid('Decision mutation planning requires an active transaction');
  }
  const parsedRequest = parseRequestV1(requestInput);
  if (parsedRequest.method !== 'decision.record' && parsedRequest.method !== 'decision.protect') {
    throw invalid(`Expected a Decision Wire method, received ${parsedRequest.method}`);
  }
  const context = parseCanonical(CommandContextSchema, contextInput);
  choiceActor(context);
  const occurredAt = parseCanonical(IsoTimestampSchema, occurredAtInput);
  if (parsedRequest.method === 'decision.protect') {
    const request = parsedRequest as Request<'decision.protect'>;
    return request.input.owner.authority === 'delivery'
      ? planDeliveryProtectionDecisionMutation(
          database,
          environment,
          request,
          context,
          occurredAt,
          host,
        )
      : planProductionProtectionDecisionMutation(
          database,
          environment,
          request,
          context,
          occurredAt,
          host,
        );
  }
  const request = parsedRequest as Request<'decision.record'>;
  if (request.input.action !== 'undo') {
    return planProductionResultDecisionMutation(
      database,
      environment,
      request as ResultDecisionRequest,
      context,
      occurredAt,
      host,
    );
  }
  return request.input.currentOwner.authority === 'delivery'
    ? planDeliveryUndoDecisionMutation(
        database,
        environment,
        request as UndoChoiceRequest,
        context,
        occurredAt,
        host,
      )
    : planProductionUndoDecisionMutation(
        database,
        environment,
        request as UndoChoiceRequest,
        context,
        occurredAt,
        host,
      );
}

function assertPlannedDecisionSnapshot(
  database: DatabaseSync,
  planned: PlannedDecisionMutation,
): void {
  if (hashCanonical(planned.afterEffect) !== planned.proposedEffectHash) {
    throw invalid('Decision mutation plan effect hash does not match');
  }
  if (planned.before.authority === 'production') {
    const current = requireExactProductionOwner(
      database,
      planned.ownerBefore as Extract<ChoiceOwnerRef, { authority: 'production' }>,
    );
    if (canonicalJson(current) !== canonicalJson(planned.before)) {
      throw new StorageError('REVISION_CONFLICT', `Production object ${current.id} changed`);
    }
    return;
  }
  const current = requireExactDeliveryOwner(
    database,
    planned.ownerBefore as Extract<ChoiceOwnerRef, { authority: 'delivery' }>,
  );
  if (canonicalJson(current) !== canonicalJson(planned.before)) {
    throw new StorageError('REVISION_CONFLICT', `Delivery ${current.id} changed`);
  }
}

function finalizedChoiceForPlan(
  planned: PlannedDecisionMutation,
  context: CommandContext,
  authorization: UserChoice['authorization'],
): UserChoice {
  return finalizeUserChoiceRecord({
    authority: 'user_choice',
    id: planned.plannedIds.userChoiceId,
    projectId: planned.projectId,
    actor: choiceActor(context),
    authorization,
    causation: context.causation,
    subject: planned.subject,
    ownerBefore: planned.ownerBefore,
    ownerAfter: planned.ownerAfter,
    choice: planned.intent,
    beforeEffect: planned.beforeEffect,
    afterEffect: planned.afterEffect,
    supersedesChoiceIds: [...planned.supersedesChoiceIds],
    createdAt: planned.occurredAt,
  });
}

function persistProductionProtectionMutation(
  database: DatabaseSync,
  environment: StorageEnvironment,
  planned: PlannedProductionProtectionDecisionMutation,
  choice: UserChoice,
): void {
  const field = planned.fields[0];
  if (field === undefined || field.owner !== 'production') {
    throw corrupt('Production protection plan field is invalid');
  }
  const fieldKey = protectionFieldKey(field);
  if (planned.active) {
    database
      .prepare(
        `INSERT INTO production_protections (
           id, project_id, production_object_id, field_ref, choice_id,
           protected_at, released_by_choice_id
         ) VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        environment.createId('production_protection'),
        planned.projectId,
        planned.before.id,
        fieldKey,
        choice.id,
        planned.occurredAt,
      );
    return;
  }
  const priorChoiceId = planned.activeChoiceIds[0];
  if (priorChoiceId === undefined) throw corrupt('Production unprotect plan has no active Choice');
  const released = database
    .prepare(
      `UPDATE production_protections SET released_by_choice_id = ?
       WHERE production_object_id = ? AND field_ref = ?
         AND choice_id = ? AND released_by_choice_id IS NULL`,
    )
    .run(choice.id, planned.before.id, fieldKey, priorChoiceId);
  if (Number(released.changes) !== 1) {
    throw new StorageError('REVISION_CONFLICT', 'Production protection changed');
  }
}

function persistDeliveryProtectionMutation(
  database: DatabaseSync,
  environment: StorageEnvironment,
  planned: PlannedDeliveryProtectionDecisionMutation,
  choice: UserChoice,
): void {
  const field = planned.fields[0];
  if (field === undefined || field.owner !== 'delivery') {
    throw corrupt('Delivery protection plan field is invalid');
  }
  const key = deliveryFieldKey(field);
  if (planned.active) {
    database
      .prepare(
        `INSERT INTO delivery_protections (
           id, project_id, delivery_plan_id, delivery_item_id, field_ref,
           choice_id, protected_at, released_by_choice_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        environment.createId('delivery_protection'),
        planned.projectId,
        planned.before.id,
        field.itemId,
        key,
        choice.id,
        planned.occurredAt,
      );
    return;
  }
  const priorChoiceId = planned.activeChoiceIds[0];
  if (priorChoiceId === undefined) throw corrupt('Delivery unprotect plan has no active Choice');
  const released = database
    .prepare(
      `UPDATE delivery_protections SET released_by_choice_id = ?
       WHERE delivery_plan_id = ? AND delivery_item_id IS ? AND field_ref = ?
         AND choice_id = ? AND released_by_choice_id IS NULL`,
    )
    .run(choice.id, planned.before.id, field.itemId, key, priorChoiceId);
  if (Number(released.changes) !== 1) {
    throw new StorageError('REVISION_CONFLICT', 'Delivery protection changed');
  }
}

export function commitPlannedDecisionMutationInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  planned: PlannedDecisionMutation,
  contextInput: CommandContext,
  host?: CommandDispatchHost,
): CommittedDecisionMutation {
  if (!database.isTransaction) {
    throw invalid('Decision mutation commit requires an active transaction');
  }
  const context = parseCanonical(CommandContextSchema, contextInput);
  choiceActor(context);
  const dispatchOperationId =
    context.actor === 'commander' ? (host?.dispatchOperationId ?? null) : null;
  if (
    hashCanonical(context) !== planned.contextHash ||
    dispatchOperationId !== planned.dispatchOperationId
  ) {
    throw invalid('Decision mutation plan context or dispatch changed');
  }
  assertPlannedDecisionSnapshot(database, planned);
  const authorization = authorizeChoiceMutation(database, {
    requestId: planned.requestId,
    projectId: planned.projectId,
    toolId: planned.toolId,
    toolInput: planned.command,
    owner: planned.ownerBefore,
    fields: planned.fields,
    activeChoiceIds: planned.activeChoiceIds,
    proposedEffect: planned.afterEffect,
    plannedIds: planned.plannedIds,
    context,
    host,
  });
  const choice = finalizedChoiceForPlan(planned, context, authorization);
  let eventId: string;
  switch (planned.kind) {
    case 'production_result':
      insertUserChoiceRecord(database, choice);
      applyDecisionRows(database, planned.before, planned.resultIds, decisionMap(planned.after));
      writeProductionObjectRecord(database, planned.after, planned.before);
      eventId = appendChoiceEvent(
        database,
        environment,
        planned.requestId,
        choice,
        context,
        planned.plannedIds.projectEventId,
      );
      updateProductionSearchDocument(database, environment, planned.after);
      return {
        toolId: 'decision.record',
        choice: loadUserChoiceRecord(database, choice.id),
        owner: planned.ownerAfter,
        eventId,
        currentState: planned.currentState,
      };
    case 'production_undo':
      insertUserChoiceRecord(database, choice);
      persistUndoEffect(
        database,
        environment,
        planned.before,
        planned.afterEffect,
        choice.id,
        planned.occurredAt,
      );
      writeProductionObjectRecord(database, planned.after, planned.before);
      eventId = appendChoiceEvent(
        database,
        environment,
        planned.requestId,
        choice,
        context,
        planned.plannedIds.projectEventId,
      );
      updateProductionSearchDocument(database, environment, planned.after);
      return {
        toolId: 'decision.record',
        choice: loadUserChoiceRecord(database, choice.id),
        owner: planned.ownerAfter,
        eventId,
        currentState: planned.currentState,
      };
    case 'delivery_undo':
      writeDeliveryPlanRecord(database, planned.before, planned.after);
      insertUserChoiceRecord(database, choice);
      if (planned.beforeEffect.kind === 'delivery') {
        setDeliveryFieldChoices(
          database,
          planned.after.id,
          planned.fields as readonly DeliveryField[],
          choice.id,
        );
      } else if (planned.afterEffect.kind === 'protection') {
        persistDeliveryProtectionUndo(
          database,
          environment,
          planned.before,
          planned.afterEffect,
          choice.id,
          planned.occurredAt,
        );
      } else {
        throw corrupt('Delivery undo plan effect is invalid');
      }
      eventId = appendChoiceEvent(
        database,
        environment,
        planned.requestId,
        choice,
        context,
        planned.plannedIds.projectEventId,
      );
      updateDeliverySearchDocument(database, environment, planned.after);
      return {
        toolId: 'decision.record',
        choice: loadUserChoiceRecord(database, choice.id),
        owner: planned.ownerAfter,
        eventId,
        currentState: null,
      };
    case 'production_protection':
      insertUserChoiceRecord(database, choice);
      persistProductionProtectionMutation(database, environment, planned, choice);
      writeProductionObjectRecord(database, planned.after, planned.before);
      eventId = appendChoiceEvent(
        database,
        environment,
        planned.requestId,
        choice,
        context,
        planned.plannedIds.projectEventId,
      );
      updateProductionSearchDocument(database, environment, planned.after);
      return {
        toolId: 'decision.protect',
        choice: loadUserChoiceRecord(database, choice.id),
        owner: planned.ownerAfter,
        eventId,
        active: planned.active,
      };
    case 'delivery_protection':
      writeDeliveryPlanRecord(database, planned.before, planned.after);
      insertUserChoiceRecord(database, choice);
      persistDeliveryProtectionMutation(database, environment, planned, choice);
      eventId = appendChoiceEvent(
        database,
        environment,
        planned.requestId,
        choice,
        context,
        planned.plannedIds.projectEventId,
      );
      updateDeliverySearchDocument(database, environment, planned.after);
      return {
        toolId: 'decision.protect',
        choice: loadUserChoiceRecord(database, choice.id),
        owner: planned.ownerAfter,
        eventId,
        active: planned.active,
      };
  }
}

export function decisionMutationToolSuccess(
  committed: Extract<CommittedDecisionMutation, { readonly toolId: 'decision.record' }>,
): Extract<DecisionMutationToolSuccess, { readonly action: unknown }>;
export function decisionMutationToolSuccess(
  committed: Extract<CommittedDecisionMutation, { readonly toolId: 'decision.protect' }>,
): Extract<DecisionMutationToolSuccess, { readonly active: unknown }>;
export function decisionMutationToolSuccess(
  committed: CommittedDecisionMutation,
): DecisionMutationToolSuccess {
  const choice = {
    authority: 'user_choice' as const,
    id: committed.choice.id,
    choiceHash: committed.choice.choiceHash,
  };
  if (committed.toolId === 'decision.protect') {
    return { choice, active: committed.active, owner: committed.owner, eventId: committed.eventId };
  }
  const action = committed.choice.choice.kind;
  if (
    action !== 'select' &&
    action !== 'reject' &&
    action !== 'refine' &&
    action !== 'use_as_reference' &&
    action !== 'undo'
  ) {
    throw corrupt(`Decision record Choice ${committed.choice.id} has an invalid action`);
  }
  return {
    choice,
    action,
    owner: committed.owner,
    currentState: committed.currentState,
    eventId: committed.eventId,
  };
}

export function recordDecisionInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  requestInput: Request<'decision.record'>,
  contextInput: CommandContext,
  occurredAtInput: string,
  host?: CommandDispatchHost,
): UserChoice {
  if (!database.isTransaction) {
    throw invalid('UserChoice decision core requires an active transaction');
  }
  const request = exactRequest(requestInput, 'decision.record');
  const context = parseCanonical(CommandContextSchema, contextInput);
  const replay = commanderReplay(
    database,
    request,
    context,
    host,
    request.input.action === 'undo'
      ? { kind: 'undo', targetChoiceId: request.input.targetChoice.id }
      : resultIntent(request.input),
  );
  if (replay !== undefined) return replay;
  const committed = commitPlannedDecisionMutationInTransaction(
    database,
    environment,
    planDecisionMutationInTransaction(
      database,
      environment,
      request,
      context,
      occurredAtInput,
      host,
    ),
    context,
    host,
  );
  if (committed.toolId !== 'decision.record')
    throw corrupt('Decision record plan committed as protection');
  return committed.choice;
}

function recordDecision(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: Request<'decision.record'>,
  context: CommandContext,
  host?: CommandDispatchHost,
): Success<'decision.record'> {
  const now = environment.now();
  return executeWireMutation(
    database,
    request,
    context,
    now,
    () => {
      const choice = recordDecisionInTransaction(
        database,
        environment,
        request,
        context,
        now,
        host,
      );
      return {
        projectId: choice.projectId,
        response: success<'decision.record'>(request, choice),
      };
    },
    host,
  );
}

export interface UserChoicesAuthority {
  readonly recordResultDecision: (
    request: ResultDecisionRequest,
    context: CommandContext,
    host?: CommandDispatchHost,
  ) => Success<'decision.record'>;
  readonly setProtection: (
    request: Request<'decision.protect'>,
    context: CommandContext,
    host?: CommandDispatchHost,
  ) => Success<'decision.protect'>;
  readonly undoChoice: (
    request: UndoChoiceRequest,
    context: CommandContext,
    host?: CommandDispatchHost,
  ) => Success<'decision.record'>;
  readonly getChoice: (choiceId: string) => UserChoice;
}

export function createUserChoicesAuthority(
  store: Store,
  environment: StorageEnvironment,
): UserChoicesAuthority {
  const authority: UserChoicesAuthority = {
    recordResultDecision(request, context, host) {
      const exact = exactRequest(request, 'decision.record');
      if (exact.input.action === 'undo') throw invalid('Use undoChoice for an undo command');
      return recordDecision(getStoreDatabase(store), environment, exact, context, host);
    },
    setProtection(request, context, host) {
      const exact = exactRequest(request, 'decision.protect');
      return setDecisionProtection(getStoreDatabase(store), environment, exact, context, host);
    },
    undoChoice(request, context, host) {
      const exact = exactRequest(request, 'decision.record');
      if (exact.input.action !== 'undo') throw invalid('undoChoice requires an undo command');
      return recordDecision(getStoreDatabase(store), environment, exact, context, host);
    },
    getChoice(choiceId) {
      return loadUserChoiceRecord(
        getStoreDatabase(store),
        parseCanonical(EntityIdSchema, choiceId),
      );
    },
  };
  return Object.freeze(authority);
}

export type { CommandDispatchHost as UserChoiceCommandHost };
