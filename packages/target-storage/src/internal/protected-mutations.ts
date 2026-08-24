import {
  ConfirmationTargetSchema,
  DecisionProtectDefinition,
  DecisionRecordDefinition,
  DeliveryMutateDefinition,
  EntityIdSchema,
  ProductionMutateDefinition,
  canonicalJson,
  parseCanonical,
  toolSchemaDigestInput,
  type CapabilityCatalogSnapshotV1,
  type ChoiceOwnerRef,
  type ProtectedFieldRef,
  type RuntimeLoopOutcome,
  z,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import {
  commitPlannedDeliveryMutationInTransaction,
  planDeliveryMutationInTransaction,
  plannedDeliveryMutationIds,
} from '../authorities/delivery.js';
import {
  commitPlannedDecisionMutationInTransaction,
  decisionMutationToolSuccess,
  planDecisionMutationInTransaction,
} from '../authorities/user-choices.js';
import {
  commitPlannedProductionMutationInTransaction,
  planProductionMutationInTransaction,
  plannedProductionMutationIds,
  primaryProductionMutationEventId,
  productionMutationToolSuccess,
} from '../authorities/production.js';
import { TargetStorageError } from '../kernel/errors.js';
import { TargetCommandContextSchema, type TargetCommandContext } from './command.js';
import type { TargetStorageEnvironment } from './environment.js';
import { hashCanonical, hashUtf8 } from './hashes.js';
import {
  plannedProtectedChoiceMutationIds,
  protectedMutationConfirmationTarget,
  type CommandDispatchHost,
} from './protection-guard.js';
import type { OperationDispatchRecord } from './operation-dispatch.js';
import type { ProtectedMutationToolId } from './protected-mutation-tool-ids.js';

export {
  PROTECTED_MUTATION_TOOL_IDS,
  isProtectedMutationTool,
} from './protected-mutation-tool-ids.js';
export type { ProtectedMutationToolId } from './protected-mutation-tool-ids.js';

export type ProtectedMutationConfirmationTarget = Extract<
  z.output<typeof ConfirmationTargetSchema>,
  { readonly kind: 'protected_mutation' }
>;

export type ProtectedMutationInput =
  | {
      readonly toolId: typeof DeliveryMutateDefinition.id;
      readonly command: ReturnType<typeof DeliveryMutateDefinition.parseInput>;
    }
  | {
      readonly toolId: typeof DecisionRecordDefinition.id;
      readonly command: ReturnType<typeof DecisionRecordDefinition.parseInput>;
    }
  | {
      readonly toolId: typeof DecisionProtectDefinition.id;
      readonly command: ReturnType<typeof DecisionProtectDefinition.parseInput>;
    }
  | {
      readonly toolId: typeof ProductionMutateDefinition.id;
      readonly command: ReturnType<typeof ProductionMutateDefinition.parseInput>;
    };

export type ProtectedMutationSuccess =
  | ReturnType<typeof DeliveryMutateDefinition.parseSuccess>
  | ReturnType<typeof DecisionRecordDefinition.parseSuccess>
  | ReturnType<typeof DecisionProtectDefinition.parseSuccess>
  | ReturnType<typeof ProductionMutateDefinition.parseSuccess>;

export type ProtectedMutationConfirmationEffect =
  | {
      readonly kind: 'delivery_mutated';
      readonly dispatchOperationId: string;
      readonly plan: Extract<ProtectedMutationSuccess, { readonly plan: unknown }>['plan'];
      readonly choice: Extract<ProtectedMutationSuccess, { readonly plan: unknown }>['choice'];
      readonly outcomeHash: string;
    }
  | {
      readonly kind: 'decision_recorded';
      readonly dispatchOperationId: string;
      readonly choice: Extract<ProtectedMutationSuccess, { readonly action: unknown }>['choice'];
      readonly action: Extract<ProtectedMutationSuccess, { readonly action: unknown }>['action'];
      readonly owner: Extract<ProtectedMutationSuccess, { readonly action: unknown }>['owner'];
      readonly currentState: Extract<
        ProtectedMutationSuccess,
        { readonly action: unknown }
      >['currentState'];
      readonly eventId: Extract<ProtectedMutationSuccess, { readonly action: unknown }>['eventId'];
      readonly outcomeHash: string;
    }
  | {
      readonly kind: 'decision_protection_changed';
      readonly dispatchOperationId: string;
      readonly choice: Extract<ProtectedMutationSuccess, { readonly active: unknown }>['choice'];
      readonly active: Extract<ProtectedMutationSuccess, { readonly active: unknown }>['active'];
      readonly owner: Extract<ProtectedMutationSuccess, { readonly active: unknown }>['owner'];
      readonly eventId: Extract<ProtectedMutationSuccess, { readonly active: unknown }>['eventId'];
      readonly outcomeHash: string;
    }
  | {
      readonly kind: 'production_mutated';
      readonly dispatchOperationId: string;
      readonly action: ReturnType<typeof ProductionMutateDefinition.parseInput>['action'];
      readonly receipts: ReturnType<typeof ProductionMutateDefinition.parseSuccess>['receipts'];
      readonly outcomeHash: string;
    };

export type PlannedProtectedMutation =
  | {
      readonly toolId: typeof DeliveryMutateDefinition.id;
      readonly command: ReturnType<typeof DeliveryMutateDefinition.parseInput>;
      readonly planned: ReturnType<typeof planDeliveryMutationInTransaction>;
      readonly projectId: string;
      readonly owner: ChoiceOwnerRef;
      readonly fields: readonly ProtectedFieldRef[];
      readonly activeChoiceIds: readonly string[];
      readonly proposedEffect: unknown;
      readonly plannedIds: ReturnType<typeof plannedDeliveryMutationIds>;
    }
  | {
      readonly toolId: typeof DecisionRecordDefinition.id;
      readonly command: ReturnType<typeof DecisionRecordDefinition.parseInput>;
      readonly planned: ReturnType<typeof planDecisionMutationInTransaction>;
      readonly projectId: string;
      readonly owner: ChoiceOwnerRef;
      readonly fields: readonly ProtectedFieldRef[];
      readonly activeChoiceIds: readonly string[];
      readonly proposedEffect: unknown;
      readonly plannedIds: ReturnType<typeof planDecisionMutationInTransaction>['plannedIds'];
    }
  | {
      readonly toolId: typeof DecisionProtectDefinition.id;
      readonly command: ReturnType<typeof DecisionProtectDefinition.parseInput>;
      readonly planned: ReturnType<typeof planDecisionMutationInTransaction>;
      readonly projectId: string;
      readonly owner: ChoiceOwnerRef;
      readonly fields: readonly ProtectedFieldRef[];
      readonly activeChoiceIds: readonly string[];
      readonly proposedEffect: unknown;
      readonly plannedIds: ReturnType<typeof planDecisionMutationInTransaction>['plannedIds'];
    }
  | {
      readonly toolId: typeof ProductionMutateDefinition.id;
      readonly command: ReturnType<typeof ProductionMutateDefinition.parseInput>;
      readonly planned: ReturnType<typeof planProductionMutationInTransaction>;
      readonly projectId: string;
      readonly owner: ChoiceOwnerRef | null;
      readonly fields: readonly ProtectedFieldRef[];
      readonly activeChoiceIds: readonly string[];
      readonly proposedEffect: unknown;
      readonly plannedIds: ReturnType<typeof plannedProductionMutationIds>;
    };

export type CommittedProtectedMutation =
  | {
      readonly toolId: typeof DeliveryMutateDefinition.id;
      readonly planned: Extract<
        PlannedProtectedMutation,
        { readonly toolId: typeof DeliveryMutateDefinition.id }
      >;
      readonly committed: ReturnType<typeof commitPlannedDeliveryMutationInTransaction>;
      readonly result: ReturnType<typeof DeliveryMutateDefinition.parseSuccess>;
    }
  | {
      readonly toolId: typeof DecisionRecordDefinition.id;
      readonly planned: Extract<
        PlannedProtectedMutation,
        { readonly toolId: typeof DecisionRecordDefinition.id }
      >;
      readonly committed: ReturnType<typeof commitPlannedDecisionMutationInTransaction>;
      readonly result: ReturnType<typeof DecisionRecordDefinition.parseSuccess>;
    }
  | {
      readonly toolId: typeof DecisionProtectDefinition.id;
      readonly planned: Extract<
        PlannedProtectedMutation,
        { readonly toolId: typeof DecisionProtectDefinition.id }
      >;
      readonly committed: ReturnType<typeof commitPlannedDecisionMutationInTransaction>;
      readonly result: ReturnType<typeof DecisionProtectDefinition.parseSuccess>;
    }
  | {
      readonly toolId: typeof ProductionMutateDefinition.id;
      readonly planned: Extract<
        PlannedProtectedMutation,
        { readonly toolId: typeof ProductionMutateDefinition.id }
      >;
      readonly committed: ReturnType<typeof commitPlannedProductionMutationInTransaction>;
      readonly result: ReturnType<typeof ProductionMutateDefinition.parseSuccess>;
    };

function invalid(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'INVALID_REQUEST',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function corrupt(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'CORRUPT_DATA',
    message,
    cause === undefined ? undefined : { cause },
  );
}

export function protectedMutationDefinition(toolId: ProtectedMutationToolId) {
  switch (toolId) {
    case DeliveryMutateDefinition.id:
      return DeliveryMutateDefinition;
    case DecisionRecordDefinition.id:
      return DecisionRecordDefinition;
    case DecisionProtectDefinition.id:
      return DecisionProtectDefinition;
    case ProductionMutateDefinition.id:
      return ProductionMutateDefinition;
  }
}

export function parseProtectedMutationInput(
  toolId: string,
  input: unknown,
): ProtectedMutationInput {
  try {
    switch (toolId) {
      case DeliveryMutateDefinition.id:
        return Object.freeze({
          toolId,
          command: DeliveryMutateDefinition.parseInput(input as Record<string, unknown>),
        });
      case DecisionRecordDefinition.id:
        return Object.freeze({
          toolId,
          command: DecisionRecordDefinition.parseInput(input as Record<string, unknown>),
        });
      case DecisionProtectDefinition.id:
        return Object.freeze({
          toolId,
          command: DecisionProtectDefinition.parseInput(input as Record<string, unknown>),
        });
      case ProductionMutateDefinition.id:
        return Object.freeze({
          toolId,
          command: ProductionMutateDefinition.parseInput(input as Record<string, unknown>),
        });
      default:
        throw invalid(`${toolId} is not a protected mutation tool`);
    }
  } catch (cause) {
    if (cause instanceof TargetStorageError) throw cause;
    throw invalid(`${toolId} protected mutation input is invalid`, cause);
  }
}

export function protectedMutationInputFromDispatch(
  dispatch: OperationDispatchRecord,
): ProtectedMutationInput {
  const parsed = parseProtectedMutationInput(dispatch.key.toolId, dispatch.key.input);
  const definition = protectedMutationDefinition(parsed.toolId);
  if (
    dispatch.key.toolVersion !== definition.version ||
    canonicalJson(parsed.command) !== canonicalJson(dispatch.key.input)
  ) {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} changed durable semantics`);
  }
  return parsed;
}

export function protectedMutationSuccessFromDispatch(
  dispatch: OperationDispatchRecord,
): ProtectedMutationSuccess {
  const input = protectedMutationInputFromDispatch(dispatch);
  if (dispatch.outcome?.status !== 'succeeded') {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} has no successful outcome`);
  }
  switch (input.toolId) {
    case DeliveryMutateDefinition.id:
      return DeliveryMutateDefinition.parseSuccess(dispatch.outcome.data);
    case DecisionRecordDefinition.id:
      return DecisionRecordDefinition.parseSuccess(dispatch.outcome.data);
    case DecisionProtectDefinition.id:
      return DecisionProtectDefinition.parseSuccess(dispatch.outcome.data);
    case ProductionMutateDefinition.id:
      return ProductionMutateDefinition.parseSuccess(dispatch.outcome.data);
  }
}

function schemaDocument(schema: z.ZodType): {
  readonly canonicalJson: string;
  readonly sha256: string;
} {
  const document = JSON.parse(
    JSON.stringify(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'throw' })),
  ) as unknown;
  const canonical = canonicalJson(document);
  return Object.freeze({ canonicalJson: canonical, sha256: hashUtf8(canonical) });
}

function liveToolSchemaDocuments(definition: ReturnType<typeof protectedMutationDefinition>) {
  return Object.freeze({
    inputSchema: schemaDocument(definition.inputSchema),
    successSchema: schemaDocument(definition.successSchema),
    outcomeSchema: schemaDocument(definition.outcomeSchema),
    examples: (() => {
      const canonical = canonicalJson(definition.examples);
      return Object.freeze({ canonicalJson: canonical, sha256: hashUtf8(canonical) });
    })(),
  });
}

export function protectedMutationCatalogTool(
  catalog: CapabilityCatalogSnapshotV1,
  materializedTools: readonly CapabilityCatalogSnapshotV1['tools'][number][],
  toolId: ProtectedMutationToolId,
): CapabilityCatalogSnapshotV1['tools'][number] {
  const definition = protectedMutationDefinition(toolId);
  const tools = catalog.tools.filter(({ id }) => id === toolId);
  const materialized = materializedTools.filter(({ id }) => id === toolId);
  if (
    tools.length !== 1 ||
    materialized.length !== 1 ||
    canonicalJson(tools[0]) !== canonicalJson(materialized[0])
  ) {
    throw corrupt(`${toolId} is absent or ambiguous in the frozen model catalog`);
  }
  const tool = tools[0]!;
  const documents = liveToolSchemaDocuments(definition);
  if (
    tool.version !== definition.version ||
    tool.description !== definition.description ||
    canonicalJson(tool.metadata) !== canonicalJson(definition.metadata) ||
    tool.metadataHash !== hashCanonical(definition.metadata) ||
    canonicalJson(tool.inputSchema) !== canonicalJson(documents.inputSchema) ||
    canonicalJson(tool.successSchema) !== canonicalJson(documents.successSchema) ||
    canonicalJson(tool.outcomeSchema) !== canonicalJson(documents.outcomeSchema) ||
    canonicalJson(tool.examples) !== canonicalJson(documents.examples) ||
    tool.schemaDigest !== hashUtf8(toolSchemaDigestInput({ ...documents })) ||
    tool.schemaDigest !== hashUtf8(toolSchemaDigestInput(tool))
  ) {
    throw corrupt(`${toolId} frozen catalog identity differs from its live definition`);
  }
  return tool;
}

function deliveryOwner(plan: {
  readonly id: string;
  readonly revision: number;
  readonly contentHash: string;
}): ChoiceOwnerRef {
  return {
    authority: 'delivery',
    id: plan.id,
    revision: plan.revision,
    contentHash: plan.contentHash,
  };
}

function decisionPlanOwner(
  planned: ReturnType<typeof planDecisionMutationInTransaction>,
): ChoiceOwnerRef {
  if (planned.ownerBefore === null) {
    throw corrupt(`Decision ${planned.toolId} plan has no owner before mutation`);
  }
  return planned.ownerBefore;
}

function decisionPlan(
  toolId: typeof DecisionRecordDefinition.id | typeof DecisionProtectDefinition.id,
  command:
    | ReturnType<typeof DecisionRecordDefinition.parseInput>
    | ReturnType<typeof DecisionProtectDefinition.parseInput>,
  planned: ReturnType<typeof planDecisionMutationInTransaction>,
): PlannedProtectedMutation {
  if (
    planned.toolId !== toolId ||
    canonicalJson(planned.command) !== canonicalJson(command) ||
    planned.proposedEffectHash !== hashCanonical(planned.afterEffect)
  ) {
    throw corrupt(`Decision ${toolId} planning changed durable semantics`);
  }
  const value = {
    toolId,
    command,
    planned,
    projectId: planned.projectId,
    owner: decisionPlanOwner(planned),
    fields: planned.fields,
    activeChoiceIds: planned.activeChoiceIds,
    proposedEffect: planned.afterEffect,
    plannedIds: planned.plannedIds,
  } as const;
  return Object.freeze(value) as PlannedProtectedMutation;
}

function productionPlan(
  dispatch: OperationDispatchRecord,
  command: ReturnType<typeof ProductionMutateDefinition.parseInput>,
  planned: ReturnType<typeof planProductionMutationInTransaction>,
): Extract<PlannedProtectedMutation, { readonly toolId: typeof ProductionMutateDefinition.id }> {
  const plannedIds = plannedProductionMutationIds(dispatch.id, command);
  const rootCreate = command.action === 'create' && command.parentRef === null;
  if (
    planned.projectId !== dispatch.key.projectId ||
    planned.command === null ||
    canonicalJson(planned.command) !== canonicalJson(command) ||
    canonicalJson(planned.ids) !== canonicalJson(plannedIds) ||
    planned.action !== command.action ||
    (planned.ownerBefore === null &&
      (!rootCreate || planned.fields.length !== 0 || planned.activeChoiceIds.length !== 0))
  ) {
    throw corrupt(`Production mutation Dispatch ${dispatch.id} planning changed durable semantics`);
  }
  return Object.freeze({
    toolId: ProductionMutateDefinition.id,
    command,
    planned,
    projectId: planned.projectId,
    owner: planned.ownerBefore,
    fields: planned.fields,
    activeChoiceIds: planned.activeChoiceIds,
    proposedEffect: planned.proposedEffect,
    plannedIds: planned.ids,
  });
}

export function planProtectedMutationInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  dispatch: OperationDispatchRecord,
  contextInput: TargetCommandContext,
  occurredAt: string,
): PlannedProtectedMutation {
  if (!database.isTransaction) {
    throw invalid('Protected mutation planning requires an active transaction');
  }
  const context = parseCanonical(TargetCommandContextSchema, contextInput);
  const input = protectedMutationInputFromDispatch(dispatch);
  const host: CommandDispatchHost = { dispatchOperationId: dispatch.id };
  switch (input.toolId) {
    case DeliveryMutateDefinition.id: {
      const planned = planDeliveryMutationInTransaction(
        database,
        environment,
        {
          wireVersion: 1,
          kind: 'request',
          requestId: dispatch.id,
          method: 'delivery.apply',
          input: input.command,
        },
        occurredAt,
        plannedDeliveryMutationIds(dispatch.id, input.command.action),
      );
      if (
        planned.projectId !== dispatch.key.projectId ||
        canonicalJson(planned.command) !== canonicalJson(input.command) ||
        canonicalJson(planned.ids) !==
          canonicalJson(plannedDeliveryMutationIds(dispatch.id, input.command.action))
      ) {
        throw corrupt(`Delivery mutation Dispatch ${dispatch.id} planning changed its target`);
      }
      return Object.freeze({
        toolId: input.toolId,
        command: input.command,
        planned,
        projectId: planned.projectId,
        owner: deliveryOwner(planned.before ?? planned.after),
        fields: planned.fields,
        activeChoiceIds: planned.activeChoiceIds,
        proposedEffect: planned.afterEffect,
        plannedIds: planned.ids,
      });
    }
    case DecisionRecordDefinition.id: {
      const planned = planDecisionMutationInTransaction(
        database,
        environment,
        {
          wireVersion: 1,
          kind: 'request',
          requestId: dispatch.id,
          method: input.toolId,
          input: input.command,
        },
        context,
        occurredAt,
        host,
      );
      if (planned.projectId !== dispatch.key.projectId) {
        throw corrupt(`Decision ${input.toolId} Dispatch ${dispatch.id} changed its Project`);
      }
      return decisionPlan(input.toolId, input.command, planned);
    }
    case DecisionProtectDefinition.id: {
      const planned = planDecisionMutationInTransaction(
        database,
        environment,
        {
          wireVersion: 1,
          kind: 'request',
          requestId: dispatch.id,
          method: input.toolId,
          input: input.command,
        },
        context,
        occurredAt,
        host,
      );
      if (planned.projectId !== dispatch.key.projectId) {
        throw corrupt(`Decision ${input.toolId} Dispatch ${dispatch.id} changed its Project`);
      }
      return decisionPlan(input.toolId, input.command, planned);
    }
    case ProductionMutateDefinition.id: {
      const planned = planProductionMutationInTransaction(
        database,
        environment,
        dispatch.key.projectId,
        input.command,
        occurredAt,
        plannedProductionMutationIds(dispatch.id, input.command),
      );
      return productionPlan(dispatch, input.command, planned);
    }
  }
}

export function protectedMutationRequiresConfirmation(planned: PlannedProtectedMutation): boolean {
  const mode = protectedMutationDefinition(planned.toolId).metadata.confirmation.mode;
  if (mode === 'exact_protected') return true;
  if (mode === 'dynamic_protection') return planned.activeChoiceIds.length > 0;
  throw corrupt(`${planned.toolId} must declare protected mutation confirmation metadata`);
}

export function protectedMutationConfirmationTargetForPlan(
  dispatch: OperationDispatchRecord,
  planned: PlannedProtectedMutation,
): ProtectedMutationConfirmationTarget {
  if (!protectedMutationRequiresConfirmation(planned)) {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} does not require confirmation`);
  }
  if (planned.owner === null) {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} has no confirmation owner`);
  }
  if (
    planned.toolId === ProductionMutateDefinition.id &&
    (planned.fields.length === 0 || planned.activeChoiceIds.length === 0)
  ) {
    throw corrupt(`Production mutation Dispatch ${dispatch.id} has no protected target`);
  }
  const target = protectedMutationConfirmationTarget(dispatch, {
    owner: planned.owner,
    fields: planned.fields,
    activeChoiceIds: planned.activeChoiceIds,
    proposedEffect: planned.proposedEffect,
    plannedIds: planned.plannedIds,
  });
  if (target.kind !== 'protected_mutation') {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} lost its confirmation target`);
  }
  return target;
}

function plannedIdsForProtectedMutation(
  dispatch: OperationDispatchRecord,
  input: ProtectedMutationInput,
) {
  switch (input.toolId) {
    case DeliveryMutateDefinition.id:
      return plannedDeliveryMutationIds(dispatch.id, input.command.action);
    case DecisionRecordDefinition.id:
    case DecisionProtectDefinition.id:
      return plannedProtectedChoiceMutationIds(dispatch.id, input.toolId);
    case ProductionMutateDefinition.id:
      return plannedProductionMutationIds(dispatch.id, input.command);
  }
}

function parseProtectedMutationTarget(target: unknown): ProtectedMutationConfirmationTarget {
  try {
    const parsed = parseCanonical(ConfirmationTargetSchema, target);
    if (parsed.kind !== 'protected_mutation') {
      throw corrupt('Confirmation target is not a protected mutation');
    }
    return parsed;
  } catch (cause) {
    if (cause instanceof TargetStorageError) throw cause;
    throw corrupt('Protected mutation confirmation target is invalid', cause);
  }
}

export function assertProtectedMutationTargetBinding(
  dispatch: OperationDispatchRecord,
  target: unknown,
): ProtectedMutationInput {
  const input = protectedMutationInputFromDispatch(dispatch);
  const parsedTarget = parseProtectedMutationTarget(target);
  const expectedDispatch = {
    operationId: dispatch.id,
    toolId: dispatch.key.toolId,
    toolVersion: dispatch.key.toolVersion,
    inputHash: dispatch.key.inputHash,
    fingerprint: dispatch.key.fingerprint,
    authorityWatermarkHash: dispatch.key.authorityWatermarkHash,
  };
  if (
    canonicalJson(parsedTarget.dispatch) !== canonicalJson(expectedDispatch) ||
    canonicalJson(parsedTarget.plannedIds) !==
      canonicalJson(plannedIdsForProtectedMutation(dispatch, input))
  ) {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} target binding is invalid`);
  }
  return input;
}

export function assertProtectedMutationPendingBinding(
  dispatch: OperationDispatchRecord,
  target: unknown,
): ProtectedMutationInput {
  const input = assertProtectedMutationTargetBinding(dispatch, target);
  if (
    dispatch.origin.kind !== 'model' ||
    dispatch.guardOutcome !== 'confirmation_required' ||
    dispatch.confirmationId === null ||
    dispatch.outcome !== null ||
    dispatch.outcomeHash !== null ||
    dispatch.completedAt !== null ||
    dispatch.operationKind !== null ||
    dispatch.ownerAuthority !== null ||
    dispatch.ownerId !== null ||
    dispatch.projectEventId !== null
  ) {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} pending binding is invalid`);
  }
  return input;
}

export function assertProtectedMutationPlanMatchesTarget(
  dispatch: OperationDispatchRecord,
  target: unknown,
  planned: PlannedProtectedMutation,
): void {
  const parsedTarget = parseProtectedMutationTarget(target);
  if (
    planned.toolId !== dispatch.key.toolId ||
    !protectedMutationRequiresConfirmation(planned) ||
    canonicalJson(protectedMutationConfirmationTargetForPlan(dispatch, planned)) !==
      canonicalJson(parsedTarget)
  ) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Protected mutation ${dispatch.id} changed before approval`,
    );
  }
}

function deliveryMutationToolSuccess(
  committed: ReturnType<typeof commitPlannedDeliveryMutationInTransaction>,
): ReturnType<typeof DeliveryMutateDefinition.parseSuccess> {
  return DeliveryMutateDefinition.parseSuccess({
    plan: deliveryOwner(committed.plan),
    choice: {
      authority: 'user_choice',
      id: committed.choice.id,
      choiceHash: committed.choice.choiceHash,
    },
  });
}

export function commitPlannedProtectedMutationInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  planned: PlannedProtectedMutation,
  contextInput: TargetCommandContext,
  host?: CommandDispatchHost,
): CommittedProtectedMutation {
  if (!database.isTransaction) {
    throw invalid('Protected mutation commit requires an active transaction');
  }
  const context = parseCanonical(TargetCommandContextSchema, contextInput);
  switch (planned.toolId) {
    case DeliveryMutateDefinition.id: {
      const committed = commitPlannedDeliveryMutationInTransaction(
        database,
        environment,
        planned.planned,
        context,
        host,
      );
      return Object.freeze({
        toolId: planned.toolId,
        planned,
        committed,
        result: deliveryMutationToolSuccess(committed),
      });
    }
    case DecisionRecordDefinition.id: {
      const committed = commitPlannedDecisionMutationInTransaction(
        database,
        environment,
        planned.planned,
        context,
        host,
      );
      if (committed.toolId !== DecisionRecordDefinition.id) {
        throw corrupt(`Decision ${planned.toolId} commit returned ${committed.toolId}`);
      }
      return Object.freeze({
        toolId: planned.toolId,
        planned,
        committed,
        result: DecisionRecordDefinition.parseSuccess(decisionMutationToolSuccess(committed)),
      });
    }
    case DecisionProtectDefinition.id: {
      const committed = commitPlannedDecisionMutationInTransaction(
        database,
        environment,
        planned.planned,
        context,
        host,
      );
      if (committed.toolId !== DecisionProtectDefinition.id) {
        throw corrupt(`Decision ${planned.toolId} commit returned ${committed.toolId}`);
      }
      return Object.freeze({
        toolId: planned.toolId,
        planned,
        committed,
        result: DecisionProtectDefinition.parseSuccess(decisionMutationToolSuccess(committed)),
      });
    }
    case ProductionMutateDefinition.id: {
      const committed = commitPlannedProductionMutationInTransaction(
        database,
        environment,
        planned.planned,
        context,
        host,
      );
      if (committed.action !== planned.command.action) {
        throw corrupt(`Production ${planned.toolId} commit changed its action`);
      }
      return Object.freeze({
        toolId: planned.toolId,
        planned,
        committed,
        result: productionMutationToolSuccess(committed),
      });
    }
  }
}

export function protectedMutationOutcome(
  committed: CommittedProtectedMutation,
): RuntimeLoopOutcome {
  switch (committed.toolId) {
    case DeliveryMutateDefinition.id:
      return DeliveryMutateDefinition.parseOutcome({ status: 'succeeded', data: committed.result });
    case DecisionRecordDefinition.id:
      return DecisionRecordDefinition.parseOutcome({ status: 'succeeded', data: committed.result });
    case DecisionProtectDefinition.id:
      return DecisionProtectDefinition.parseOutcome({
        status: 'succeeded',
        data: committed.result,
      });
    case ProductionMutateDefinition.id:
      return ProductionMutateDefinition.parseOutcome({
        status: 'succeeded',
        data: committed.result,
      });
  }
}

export function protectedMutationDeniedOutcome(
  toolId: ProtectedMutationToolId,
): RuntimeLoopOutcome {
  const outcome = {
    status: 'permission_denied' as const,
    code: 'protected_denied',
    message: `${toolId} protected mutation denied`,
  };
  switch (toolId) {
    case DeliveryMutateDefinition.id:
      return DeliveryMutateDefinition.parseOutcome(outcome);
    case DecisionRecordDefinition.id:
      return DecisionRecordDefinition.parseOutcome(outcome);
    case DecisionProtectDefinition.id:
      return DecisionProtectDefinition.parseOutcome(outcome);
    case ProductionMutateDefinition.id:
      return ProductionMutateDefinition.parseOutcome(outcome);
  }
}

export function protectedMutationConfirmationEffectFor(
  dispatch: OperationDispatchRecord,
  committed: CommittedProtectedMutation,
): ProtectedMutationConfirmationEffect {
  const outcome = protectedMutationOutcome(committed);
  if (
    dispatch.key.toolId !== committed.toolId ||
    dispatch.outcomeHash === null ||
    dispatch.outcome?.status !== 'succeeded' ||
    canonicalJson(dispatch.outcome) !== canonicalJson(outcome)
  ) {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} is not settled for its commit`);
  }
  switch (committed.toolId) {
    case DeliveryMutateDefinition.id:
      return Object.freeze({
        kind: 'delivery_mutated',
        dispatchOperationId: dispatch.id,
        plan: committed.result.plan,
        choice: committed.result.choice,
        outcomeHash: dispatch.outcomeHash,
      });
    case DecisionRecordDefinition.id:
      return Object.freeze({
        kind: 'decision_recorded',
        dispatchOperationId: dispatch.id,
        choice: committed.result.choice,
        action: committed.result.action,
        owner: committed.result.owner,
        currentState: committed.result.currentState,
        eventId: committed.result.eventId,
        outcomeHash: dispatch.outcomeHash,
      });
    case DecisionProtectDefinition.id:
      return Object.freeze({
        kind: 'decision_protection_changed',
        dispatchOperationId: dispatch.id,
        choice: committed.result.choice,
        active: committed.result.active,
        owner: committed.result.owner,
        eventId: committed.result.eventId,
        outcomeHash: dispatch.outcomeHash,
      });
    case ProductionMutateDefinition.id:
      if (committed.result.receipts.length === 0) {
        throw corrupt(`Production mutation Dispatch ${dispatch.id} cannot emit an empty effect`);
      }
      return Object.freeze({
        kind: 'production_mutated',
        dispatchOperationId: dispatch.id,
        action: committed.committed.action,
        receipts: committed.result.receipts,
        outcomeHash: dispatch.outcomeHash,
      });
  }
}

export function protectedMutationProjectEventId(
  committed: CommittedProtectedMutation,
): string | null {
  const eventId =
    committed.toolId === DeliveryMutateDefinition.id
      ? committed.committed.projectEventId
      : committed.toolId === ProductionMutateDefinition.id
        ? primaryProductionMutationEventId(committed.committed)
        : committed.committed.eventId;
  return eventId === null ? null : parseCanonical(EntityIdSchema, eventId);
}
