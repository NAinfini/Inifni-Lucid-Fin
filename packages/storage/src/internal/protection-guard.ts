import {
  ConfirmationTargetSchema,
  EntityIdSchema,
  ProtectedMutationPlannedIdsSchema,
  ProtectedFieldRefSchema,
  canonicalJson,
  parseCanonical,
  z,
  type ChoiceOwnerRef,
  type ProtectedFieldRef,
  type UserChoice,
  type UserChoiceAuthorization,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import { CommandContextSchema, type CommandContext } from './command.js';
import { hashCanonical } from './hashes.js';
import {
  loadAllowedCommandDispatch,
  loadApprovedRunConfirmation,
  loadOperationDispatch,
  type OperationDispatchRecord,
} from './operation-dispatch.js';

export interface CommandDispatchHost {
  readonly dispatchOperationId: string;
}

export type ProtectedMutationPlannedIds = z.output<typeof ProtectedMutationPlannedIdsSchema>;
export type ProtectedChoiceMutationPlannedIds =
  | Extract<ProtectedMutationPlannedIds, { tool: 'decision.record' }>
  | Extract<ProtectedMutationPlannedIds, { tool: 'decision.protect' }>;

const PROTECTED_CHOICE_ID_SCHEMA = 'lucid-fin.protected-choice-planned-ids/v1';

export function plannedProtectedChoiceMutationIds(
  dispatchOperationIdValue: string,
  toolId: 'decision.record' | 'decision.protect',
): ProtectedChoiceMutationPlannedIds {
  const dispatchOperationId = parseCanonical(EntityIdSchema, dispatchOperationIdValue);
  const plannedId = (prefix: 'user_choice' | 'project_event', role: string) =>
    `${prefix}.${hashCanonical({
      schema: PROTECTED_CHOICE_ID_SCHEMA,
      dispatchOperationId,
      toolId,
      role,
    })}`;
  const ids = parseCanonical(ProtectedMutationPlannedIdsSchema, {
    tool: toolId,
    userChoiceId: plannedId('user_choice', 'user_choice'),
    projectEventId: plannedId('project_event', 'project_event'),
  });
  if (ids.tool !== 'decision.record' && ids.tool !== 'decision.protect') {
    throw corrupt(`Protected choice ${toolId} planned IDs are invalid`);
  }
  return ids;
}

function invalid(message: string): StorageError {
  return new StorageError('INVALID_REQUEST', message);
}

function corrupt(message: string): StorageError {
  return new StorageError('CORRUPT_DATA', message);
}

function sortFields(fields: readonly ProtectedFieldRef[]): ProtectedFieldRef[] {
  return [...fields]
    .map((field) => parseCanonical(ProtectedFieldRefSchema, field))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function sameField(left: ProtectedFieldRef, right: ProtectedFieldRef): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export interface ProtectedMutationConfirmationTargetInput {
  readonly owner: ChoiceOwnerRef;
  readonly fields: readonly ProtectedFieldRef[];
  readonly activeChoiceIds: readonly string[];
  readonly proposedEffect: unknown;
  readonly plannedIds: ProtectedMutationPlannedIds;
}

export function protectedMutationConfirmationTarget(
  dispatch: OperationDispatchRecord,
  input: ProtectedMutationConfirmationTargetInput,
) {
  return parseCanonical(ConfirmationTargetSchema, {
    kind: 'protected_mutation',
    dispatch: {
      operationId: dispatch.id,
      toolId: dispatch.key.toolId,
      toolVersion: dispatch.key.toolVersion,
      inputHash: dispatch.key.inputHash,
      fingerprint: dispatch.key.fingerprint,
      authorityWatermarkHash: dispatch.key.authorityWatermarkHash,
    },
    owner: input.owner,
    fields: sortFields(input.fields),
    activeChoiceIds: [...new Set(input.activeChoiceIds)].sort(),
    proposedEffectHash: hashCanonical(input.proposedEffect),
    plannedIds: input.plannedIds,
  });
}

function commanderRunId(context: CommandContext): string {
  if (context.actor !== 'commander' || context.causation.kind !== 'run') {
    throw invalid('Commander mutation requires Run causation');
  }
  return context.causation.runId;
}

function requireToolDispatch(
  database: DatabaseSync,
  context: CommandContext,
  host: CommandDispatchHost | undefined,
  projectId: string,
  toolId: 'decision.record' | 'decision.protect' | 'delivery.mutate' | 'production.mutate',
  input: unknown | undefined,
): OperationDispatchRecord {
  if (host === undefined) throw invalid('Commander mutation requires its host dispatch');
  const runId = commanderRunId(context);
  if (input !== undefined) {
    return loadAllowedCommandDispatch(database, {
      dispatchOperationId: host.dispatchOperationId,
      projectId,
      runId,
      toolId,
      input,
    });
  }
  const dispatch = loadOperationDispatch(database, host.dispatchOperationId);
  if (
    dispatch.key.projectId !== projectId ||
    dispatch.key.runId !== runId ||
    dispatch.key.toolId !== toolId ||
    dispatch.guardOutcome !== 'allowed' ||
    dispatch.operationKind !== null ||
    dispatch.ownerAuthority !== null ||
    dispatch.ownerId !== null
  ) {
    throw invalid(`Dispatch ${dispatch.id} does not authorize this protected mutation`);
  }
  return dispatch;
}

export interface AuthorizeChoiceInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly toolId: 'decision.record' | 'decision.protect' | 'delivery.mutate';
  readonly toolInput: unknown;
  readonly owner: ChoiceOwnerRef;
  readonly fields: readonly ProtectedFieldRef[];
  readonly activeProtections?: readonly { field: ProtectedFieldRef; choiceId: string }[];
  /**
   * A frozen plan may supply the exact protected Choice heads it observed.
   * Callers without a plan continue to derive them from activeProtections.
   */
  readonly activeChoiceIds?: readonly string[];
  readonly proposedEffect: unknown;
  readonly plannedIds?: ProtectedMutationPlannedIds;
  readonly context: CommandContext;
  readonly host?: CommandDispatchHost;
}

export function authorizeChoiceMutation(
  database: DatabaseSync,
  input: AuthorizeChoiceInput,
): UserChoiceAuthorization {
  const context = parseCanonical(CommandContextSchema, input.context);
  const requestId = parseCanonical(EntityIdSchema, input.requestId);
  const fields = sortFields(input.fields);
  const activeChoiceIds =
    input.activeChoiceIds === undefined
      ? [
          ...new Set(
            (input.activeProtections ?? [])
              .filter((protection) => fields.some((field) => sameField(field, protection.field)))
              .map((protection) => protection.choiceId),
          ),
        ].sort()
      : [...new Set(input.activeChoiceIds)].sort();
  const inputHash = hashCanonical(input.toolInput);
  if (context.actor === 'user') return { kind: 'direct_user', requestId, inputHash };
  if (context.actor === 'import') {
    if (context.causation.kind !== 'import')
      throw invalid('Import mutation requires Import causation');
    if (activeChoiceIds.length > 0) throw invalid('Import cannot overwrite a protected field');
    return { kind: 'import', importId: context.causation.importId, inputHash };
  }
  if (context.actor !== 'commander') throw invalid('System cannot record a UserChoice');
  const dispatch = requireToolDispatch(
    database,
    context,
    input.host,
    input.projectId,
    input.toolId,
    input.toolInput,
  );
  const requiresConfirmation = input.toolId === 'decision.protect' || activeChoiceIds.length > 0;
  if (requiresConfirmation) {
    if (dispatch.confirmationId === null) {
      throw invalid('Protected mutation requires an approved confirmation');
    }
    const confirmation = loadApprovedRunConfirmation(
      database,
      dispatch.confirmationId,
      dispatch.key,
    );
    if (input.plannedIds === undefined) {
      throw invalid('Protected Commander mutation requires frozen planned IDs');
    }
    const expected = protectedMutationConfirmationTarget(dispatch, {
      owner: input.owner,
      fields,
      activeChoiceIds,
      proposedEffect: input.proposedEffect,
      plannedIds: input.plannedIds,
    });
    if (canonicalJson(confirmation.target) !== canonicalJson(expected)) {
      throw invalid('Protected mutation confirmation is stale or bound to another effect');
    }
  }
  return {
    kind: 'commander_dispatch',
    dispatchOperationId: dispatch.id,
    inputHash: dispatch.key.inputHash,
    confirmationId: dispatch.confirmationId,
  };
}

export function assertCommanderChoiceReplay(
  database: DatabaseSync,
  input: {
    readonly request: {
      readonly method: 'decision.record' | 'decision.protect';
      readonly input: unknown;
    };
    readonly context: CommandContext;
    readonly host: CommandDispatchHost;
    readonly choice: UserChoice;
    readonly expectedIntent: UserChoice['choice'];
  },
): void {
  const context = parseCanonical(CommandContextSchema, input.context);
  const dispatch = requireToolDispatch(
    database,
    context,
    input.host,
    input.choice.projectId,
    input.request.method,
    input.request.input,
  );
  const authorization = input.choice.authorization;
  if (
    authorization.kind !== 'commander_dispatch' ||
    authorization.dispatchOperationId !== input.host.dispatchOperationId ||
    authorization.inputHash !== dispatch.key.inputHash ||
    authorization.confirmationId !== dispatch.confirmationId ||
    canonicalJson(input.choice.choice) !== canonicalJson(input.expectedIntent)
  ) {
    throw corrupt(`Dispatch ${input.host.dispatchOperationId} Choice replay does not match`);
  }
}

export interface AssertProductionProtectionInput {
  readonly projectId: string;
  readonly owner: ChoiceOwnerRef;
  readonly fields: readonly ProtectedFieldRef[];
  readonly activeProtections: readonly { field: ProtectedFieldRef; choiceId: string }[];
  readonly proposedEffect: unknown;
  readonly plannedIds?: ProtectedMutationPlannedIds;
  readonly context: CommandContext;
  readonly host?: CommandDispatchHost;
}

export function assertProductionProtectionMutation(
  database: DatabaseSync,
  input: AssertProductionProtectionInput,
): void {
  const context = parseCanonical(CommandContextSchema, input.context);
  const fields = sortFields(input.fields);
  const activeChoiceIds = [
    ...new Set(
      input.activeProtections
        .filter((protection) => fields.some((field) => sameField(field, protection.field)))
        .map((protection) => protection.choiceId),
    ),
  ].sort();
  if (activeChoiceIds.length === 0 || context.actor === 'user') return;
  if (context.actor === 'import') throw invalid('Import cannot overwrite a protected field');
  if (context.actor !== 'commander') throw invalid('System cannot overwrite a protected field');
  const dispatch = requireToolDispatch(
    database,
    context,
    input.host,
    input.projectId,
    'production.mutate',
    undefined,
  );
  if (dispatch.confirmationId === null) {
    throw invalid('Protected mutation requires an approved confirmation');
  }
  const confirmation = loadApprovedRunConfirmation(database, dispatch.confirmationId, dispatch.key);
  if (input.plannedIds === undefined) {
    throw invalid('Protected Commander mutation requires frozen planned IDs');
  }
  const expected = protectedMutationConfirmationTarget(dispatch, {
    owner: input.owner,
    fields,
    activeChoiceIds,
    proposedEffect: input.proposedEffect,
    plannedIds: input.plannedIds,
  });
  if (canonicalJson(confirmation.target) !== canonicalJson(expected)) {
    throw invalid('Protected mutation confirmation is stale or bound to another effect');
  }
}
