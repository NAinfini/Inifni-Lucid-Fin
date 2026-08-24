import {
  EntityIdSchema,
  PUBLIC_WIRE_METHODS_V1,
  PublicWireMethodV1Schema,
  WireResponseV1Schema,
  parseCanonical,
  parseRequestV1,
  type PublicWireMethodV1,
  type WireFailureV1,
  type WireRequestV1,
  type WireResponseV1,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import {
  TargetStorageError,
  type TargetCommandContext,
  type TargetStorageErrorCode,
} from '@lucid-fin/target-storage';

type RequestFor<Method extends PublicWireMethodV1> = Extract<
  WireRequestV1,
  { readonly method: Method }
>;
type SuccessFor<Method extends PublicWireMethodV1> = Extract<
  WireSuccessV1,
  { readonly method: Method }
>;

export type TargetWireHandler<Method extends PublicWireMethodV1> = (
  request: RequestFor<Method>,
  context: TargetCommandContext,
) => SuccessFor<Method> | Promise<SuccessFor<Method>>;

export type TargetWireHandlers = {
  readonly [Method in PublicWireMethodV1]: TargetWireHandler<Method>;
};

export type TargetWireStandardErrorCode = Exclude<
  WireFailureV1['error']['code'],
  'confirmation_required'
>;

export interface TargetWireErrorDescriptor {
  readonly code: TargetWireStandardErrorCode;
  readonly retryable: boolean;
}

export interface TargetWireRouterOptions<Invocation> {
  readonly contextForRequest: (
    request: WireRequestV1,
    invocation: Invocation,
  ) => TargetCommandContext | Promise<TargetCommandContext>;
  readonly localizeError?: (descriptor: TargetWireErrorDescriptor) => string;
  readonly onInternalError?: (cause: unknown, request: WireRequestV1) => void;
}

export interface TargetWireRouter<Invocation> {
  invoke(input: unknown, invocation: Invocation): Promise<WireResponseV1>;
}

export interface TargetIpcMainLike<Event> {
  handle(
    channel: string,
    listener: (event: Event, input: unknown) => Promise<WireResponseV1>,
  ): void;
  removeHandler(channel: string): void;
}

export class TargetWireProtocolError extends Error {
  readonly code = 'invalid_request' as const;

  constructor() {
    super('The target IPC request envelope is invalid');
    this.name = 'TargetWireProtocolError';
  }
}

export class TargetWirePublicError extends Error {
  readonly descriptor: TargetWireErrorDescriptor;

  constructor(descriptor: TargetWireErrorDescriptor, options?: ErrorOptions) {
    super(descriptor.code, options);
    this.name = 'TargetWirePublicError';
    this.descriptor = Object.freeze({ ...descriptor });
  }
}

const DEFAULT_PUBLIC_SUMMARIES: Readonly<Record<TargetWireStandardErrorCode, string>> =
  Object.freeze({
    budget_exceeded: 'The request exceeds the available budget.',
    cancelled: 'The request was cancelled.',
    idempotency_conflict: 'This request identifier was already used for another command.',
    internal_failure: 'The request could not be completed.',
    invalid_request: 'The request is invalid.',
    not_found: 'The requested item was not found.',
    permission_denied: 'The request is not permitted.',
    revision_conflict: 'The item changed before the request could be applied.',
    unavailable: 'The requested capability is temporarily unavailable.',
  });

const STORAGE_ERROR_DESCRIPTORS: Readonly<
  Record<TargetStorageErrorCode, TargetWireErrorDescriptor>
> = Object.freeze({
  CORRUPT_DATA: { code: 'internal_failure', retryable: false },
  DATABASE_ALREADY_EXISTS: { code: 'idempotency_conflict', retryable: false },
  FOREIGN_KEY_CHECK_FAILED: { code: 'internal_failure', retryable: false },
  IDEMPOTENCY_CONFLICT: { code: 'idempotency_conflict', retryable: false },
  INTEGRITY_CHECK_FAILED: { code: 'internal_failure', retryable: false },
  INVALID_REQUEST: { code: 'invalid_request', retryable: false },
  NOT_FOUND: { code: 'not_found', retryable: false },
  REVISION_CONFLICT: { code: 'revision_conflict', retryable: false },
  SCHEMA_ARTIFACT_HASH_MISMATCH: { code: 'internal_failure', retryable: false },
  SCHEMA_ARTIFACT_INVALID: { code: 'internal_failure', retryable: false },
  SCHEMA_DRIFT: { code: 'internal_failure', retryable: false },
  SECURITY_CONFIGURATION_FAILED: { code: 'internal_failure', retryable: false },
  STORE_NOT_OPEN: { code: 'unavailable', retryable: true },
});

interface RequestIdentity {
  readonly requestId: string;
  readonly method: PublicWireMethodV1;
}

function requestIdentity(value: unknown): RequestIdentity | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const requestId = descriptors.requestId;
  const method = descriptors.method;
  if (
    requestId === undefined ||
    method === undefined ||
    'get' in requestId ||
    'set' in requestId ||
    'get' in method ||
    'set' in method
  ) {
    return null;
  }
  const parsedRequestId = EntityIdSchema.safeParse(requestId.value);
  const parsedMethod = PublicWireMethodV1Schema.safeParse(method.value);
  if (!parsedRequestId.success || !parsedMethod.success) return null;
  return Object.freeze({ requestId: parsedRequestId.data, method: parsedMethod.data });
}

function exactHandlerMap(handlers: TargetWireHandlers): TargetWireHandlers {
  const expected = Object.keys(PUBLIC_WIRE_METHODS_V1).sort();
  const ownKeys = Reflect.ownKeys(handlers);
  if (ownKeys.some((key) => typeof key !== 'string')) {
    throw new Error('Target Wire handlers must not use symbol keys');
  }
  const actual = (ownKeys as string[]).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Target Wire handler registry must exactly match PUBLIC_WIRE_METHODS_V1');
  }
  const copy = Object.create(null) as Record<string, unknown>;
  const descriptors = Object.getOwnPropertyDescriptors(handlers);
  for (const method of expected) {
    const descriptor = descriptors[method];
    if (
      descriptor === undefined ||
      'get' in descriptor ||
      'set' in descriptor ||
      typeof descriptor.value !== 'function'
    ) {
      throw new Error(`Target Wire handler ${method} must be an own data function`);
    }
    copy[method] = descriptor.value;
  }
  return Object.freeze(copy) as TargetWireHandlers;
}

function descriptorForCause(cause: unknown): TargetWireErrorDescriptor {
  if (cause instanceof TargetWirePublicError) return cause.descriptor;
  if (cause instanceof TargetStorageError) return STORAGE_ERROR_DESCRIPTORS[cause.code];
  return { code: 'internal_failure', retryable: false };
}

function failureResponse(
  identity: RequestIdentity,
  correlationId: string,
  descriptor: TargetWireErrorDescriptor,
  localize: (descriptor: TargetWireErrorDescriptor) => string,
): WireFailureV1 {
  return parseCanonical(WireResponseV1Schema, {
    wireVersion: 1,
    kind: 'failure',
    requestId: identity.requestId,
    method: identity.method,
    error: {
      ...descriptor,
      publicSummary: localize(descriptor),
      correlationId,
    },
  }) as WireFailureV1;
}

export function createTargetWireRouter<Invocation>(
  handlersValue: TargetWireHandlers,
  options: TargetWireRouterOptions<Invocation>,
): TargetWireRouter<Invocation> {
  const handlers = exactHandlerMap(handlersValue);
  const localize =
    options.localizeError ??
    ((descriptor: TargetWireErrorDescriptor) => DEFAULT_PUBLIC_SUMMARIES[descriptor.code]);

  return Object.freeze({
    async invoke(input: unknown, invocation: Invocation): Promise<WireResponseV1> {
      const identity = requestIdentity(input);
      let request: WireRequestV1;
      try {
        request = parseRequestV1(input);
      } catch {
        if (identity === null) throw new TargetWireProtocolError();
        return failureResponse(
          identity,
          identity.requestId,
          { code: 'invalid_request', retryable: false },
          localize,
        );
      }

      let context: TargetCommandContext | undefined;
      try {
        context = await options.contextForRequest(request, invocation);
        const handler = handlers[request.method] as (
          request: WireRequestV1,
          context: TargetCommandContext,
        ) => WireSuccessV1 | Promise<WireSuccessV1>;
        const response = parseCanonical(
          WireResponseV1Schema,
          await handler(request, context),
        ) as WireResponseV1;
        if (
          response.kind !== 'success' ||
          response.requestId !== request.requestId ||
          response.method !== request.method
        ) {
          throw new Error('Target Wire handler returned a mismatched response');
        }
        return response as WireSuccessV1;
      } catch (cause) {
        const descriptor = descriptorForCause(cause);
        if (descriptor.code === 'internal_failure') options.onInternalError?.(cause, request);
        return failureResponse(
          { requestId: request.requestId, method: request.method },
          context?.correlationId ?? request.requestId,
          descriptor,
          localize,
        );
      }
    },
  });
}

export function registerTargetWireRouter<Event>(
  ipcMain: TargetIpcMainLike<Event>,
  channel: string,
  router: TargetWireRouter<Event>,
): () => void {
  ipcMain.handle(channel, (event, input) => router.invoke(input, event));
  return () => ipcMain.removeHandler(channel);
}
