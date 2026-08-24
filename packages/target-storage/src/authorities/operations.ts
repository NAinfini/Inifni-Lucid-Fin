import {
  AttemptTerminalStateSchema,
  EntityIdSchema,
  OperationCancelDefinition,
  OperationGetDefinition,
  WireSuccessV1Schema,
  parseCanonical,
  parseRequestV1,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import {
  executeWireMutation,
  readWireMutationReceipt,
  type TargetCommandContext,
} from '../internal/command.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import {
  assertOperationRefIdentity,
  commitOperationOwnerTransitions,
  loadBoundOperation,
  prepareOperationOwnerTransitions,
  type BoundOperationRecord,
  type PreparedOperationOwnerTransitionBatch,
} from '../internal/operation-dispatch.js';
import {
  operationPublicViewForOwner,
  requestOperationOwnerCancellation,
} from '../internal/operation-owner-records.js';
import { TargetStorageError } from '../kernel/errors.js';
import type { TargetStore } from '../kernel/store.js';

type RequestMap = {
  [Method in WireRequestV1['method']]: Extract<WireRequestV1, { method: Method }>;
};
type SuccessMap = {
  [Method in WireSuccessV1['method']]: Extract<WireSuccessV1, { method: Method }>;
};
type Request<Method extends keyof RequestMap> = RequestMap[Method];
type Success<Method extends keyof SuccessMap> = SuccessMap[Method];

function exactRequest<Method extends WireRequestV1['method']>(
  value: Request<Method>,
  method: Method,
): Request<Method> {
  let request: WireRequestV1;
  try {
    request = parseRequestV1(value);
  } catch (cause) {
    throw new TargetStorageError('INVALID_REQUEST', `Wire request ${method} is invalid`, {
      cause,
    });
  }
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

function sameBoundary(operations: readonly BoundOperationRecord[]): {
  projectId: string;
  runId: string;
} {
  const first = operations[0];
  if (first === undefined) {
    throw new TargetStorageError('INVALID_REQUEST', 'Operation batch cannot be empty');
  }
  if (
    operations.some(
      ({ dispatch }) =>
        dispatch.key.projectId !== first.dispatch.key.projectId ||
        dispatch.key.runId !== first.dispatch.key.runId,
    )
  ) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Operation batch must belong to one Project and Run',
    );
  }
  return { projectId: first.dispatch.key.projectId, runId: first.dispatch.key.runId };
}

function getOperations(
  database: DatabaseSync,
  request: Request<'operation.get'>,
): Success<'operation.get'> {
  return success<'operation.get'>(request, operationResult(database, request.input).result);
}

function operationResult(
  database: DatabaseSync,
  input: ReturnType<typeof OperationGetDefinition.parseInput>,
) {
  const operations = input.operations.map((ref) => {
    const operation = loadBoundOperation(database, ref.id);
    assertOperationRefIdentity(operation, ref);
    return operation;
  });
  const boundary = sameBoundary(operations);
  return {
    boundary,
    result: OperationGetDefinition.parseSuccess({
      operations: operations.map(({ dispatch, owner }) =>
        operationPublicViewForOwner(database, dispatch.id, owner, dispatch.key.input),
      ),
    }),
  };
}

function queryOperations(
  database: DatabaseSync,
  projectIdValue: string,
  runIdValue: string,
  inputValue: ReturnType<typeof OperationGetDefinition.parseInput>,
): ReturnType<typeof OperationGetDefinition.parseSuccess> {
  const projectId = parseCanonical(EntityIdSchema, projectIdValue);
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  const input = OperationGetDefinition.parseInput(inputValue);
  const { boundary, result } = operationResult(database, input);
  if (boundary.projectId !== projectId || boundary.runId !== runId) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Operation batch belongs to another Project or Run',
    );
  }
  return result;
}

export interface OperationCancelInTransactionResult extends PreparedOperationOwnerTransitionBatch {
  readonly projectId: string;
  readonly runId: string;
  readonly result: ReturnType<typeof OperationCancelDefinition.parseSuccess>;
}

export function cancelOperationsInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  inputValue: ReturnType<typeof OperationCancelDefinition.parseInput>,
  occurredAt: string,
  context: TargetCommandContext,
): OperationCancelInTransactionResult {
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Operation cancellation requires an active transaction',
    );
  }
  const input = OperationCancelDefinition.parseInput(inputValue);
  const operations = input.operations.map((cancel) => {
    const operation = loadBoundOperation(database, cancel.ref.id);
    assertOperationRefIdentity(operation, cancel.ref);
    const current = operation.owner.view;
    if (
      current.revision !== cancel.ref.revision ||
      current.contentHash !== cancel.ref.ownerRef.contentHash ||
      current.revision !== cancel.expectedRevision ||
      current.state !== cancel.expectedState
    ) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        `Operation ${operation.dispatch.id} no longer matches the cancellation request`,
      );
    }
    if (AttemptTerminalStateSchema.safeParse(current.state).success) {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        `Terminal Operation ${operation.dispatch.id} cannot be cancelled`,
      );
    }
    if (current.cancelRequested) {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        `Operation ${operation.dispatch.id} already has cancellation requested`,
      );
    }
    return operation;
  });
  const boundary = sameBoundary(operations);
  const prepared = prepareOperationOwnerTransitions(
    database,
    environment,
    operations.map((operation) => ({
      dispatch: operation.dispatch,
      before: operation.owner,
      after: requestOperationOwnerCancellation(database, operation.owner),
    })),
    occurredAt,
    context,
  );
  if (prepared.run.id !== boundary.runId || prepared.run.projectId !== boundary.projectId) {
    throw new TargetStorageError(
      'CORRUPT_DATA',
      'Operation cancellation changed its Project or Run boundary',
    );
  }
  return {
    ...prepared,
    projectId: boundary.projectId,
    runId: boundary.runId,
    result: OperationCancelDefinition.parseSuccess({ operations: prepared.operations }),
  };
}

function cancelOperations(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  request: Request<'operation.cancel'>,
  context: TargetCommandContext,
): Success<'operation.cancel'> {
  const replay = readWireMutationReceipt<Request<'operation.cancel'>, Success<'operation.cancel'>>(
    database,
    request,
    context,
  );
  if (replay !== undefined) return replay;
  const occurredAt = environment.now();
  return executeWireMutation(database, request, context, occurredAt, () => {
    const cancellation = cancelOperationsInTransaction(
      database,
      environment,
      request.input,
      occurredAt,
      context,
    );
    commitOperationOwnerTransitions(database, cancellation, request.requestId);
    return {
      projectId: cancellation.projectId,
      response: success<'operation.cancel'>(request, cancellation.result),
    };
  });
}

export interface OperationsAuthority {
  readonly get: (request: Request<'operation.get'>) => Success<'operation.get'>;
  readonly query: (
    projectId: string,
    runId: string,
    input: ReturnType<typeof OperationGetDefinition.parseInput>,
  ) => ReturnType<typeof OperationGetDefinition.parseSuccess>;
  readonly cancel: (
    request: Request<'operation.cancel'>,
    context: TargetCommandContext,
  ) => Success<'operation.cancel'>;
}

export function createOperationsAuthority(
  store: TargetStore,
  environment: TargetStorageEnvironment,
): OperationsAuthority {
  const authority: OperationsAuthority = {
    get(request) {
      return getOperations(getTargetStoreDatabase(store), exactRequest(request, 'operation.get'));
    },
    query(projectId, runId, input) {
      return queryOperations(getTargetStoreDatabase(store), projectId, runId, input);
    },
    cancel(request, context) {
      return cancelOperations(
        getTargetStoreDatabase(store),
        environment,
        exactRequest(request, 'operation.cancel'),
        context,
      );
    },
  };
  return Object.freeze(authority);
}
