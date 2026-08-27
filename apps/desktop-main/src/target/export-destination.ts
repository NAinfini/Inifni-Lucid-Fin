import { createHash, randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  DeliveryDestinationGrantV1Schema,
  DeliveryDestinationIntentSchema,
  DeliveryContainerSchema,
  DeliveryRefSchema,
  EntityIdSchema,
  SafeLeafDisplayLabelSchema,
  ScopedDeliveryDestinationIntentSchema,
  Sha256Schema,
  canonicalJson,
  parseCanonical,
  type DeliveryDestinationIntent,
  type ScopedDeliveryDestinationIntent,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import {
  TargetStorageError,
  type DeliveryDestinationGrantResolver,
  type ResolveDeliveryDestinationGrantRequest,
  type ResolvedDeliveryDestinationGrant,
} from '@lucid-fin/target-storage';
import { TargetWirePublicError, type TargetWireHandler } from './ipc/router.js';

type ExportPickerRequest = Extract<WireRequestV1, { readonly method: 'os.export.pick' }>;
type ExportPickerSuccess = Extract<WireSuccessV1, { readonly method: 'os.export.pick' }>;
type ExportPickerInput = ExportPickerRequest['input'];

const DEFAULT_GRANT_LIFETIME_MS = 5 * 60 * 1_000;
const MAX_GRANTS = 1_000;

export type TargetExportDestinationPickerResult =
  | { readonly state: 'cancelled' }
  | {
      readonly state: 'selected';
      readonly destination: ExportPickerInput['destination'];
      readonly displayLabel: string;
      readonly writableGrant: unknown;
    };

export interface TargetExportDestinationPickerAdapter {
  pick(input: ExportPickerInput): Promise<TargetExportDestinationPickerResult>;
}

export interface TargetExportDestinationGatewayOptions {
  readonly picker?: TargetExportDestinationPickerAdapter;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
  readonly createGrantId?: () => string;
  readonly createSecret?: () => string;
}

export interface TargetExportDestinationGateway extends DeliveryDestinationGrantResolver {
  readonly pick: TargetWireHandler<'os.export.pick'>;
  close(): void;
}

interface GrantRecord {
  readonly chatId: string;
  readonly descriptor: ScopedDeliveryDestinationIntent;
  readonly deadline: number;
  readonly writableGrant: unknown;
  operation: {
    readonly projectId: string;
    readonly chatId: string;
    readonly runId: string;
    readonly deliveryPlan: ExportPickerInput['deliveryPlan'];
    readonly requiredExtension: ResolveDeliveryDestinationGrantRequest['requiredExtension'];
    readonly operationFingerprint: string;
  } | null;
}

function defaultGrantId(): string {
  return `grant_${randomBytes(32).toString('base64url')}`;
}

function defaultSecret(): string {
  return randomBytes(32).toString('base64url');
}

function invalid(message: string): TargetStorageError {
  return new TargetStorageError('INVALID_REQUEST', message);
}

function unavailable(): TargetWirePublicError {
  return new TargetWirePublicError({ code: 'unavailable', retryable: false });
}

function currentTime(now: () => Date): number {
  const value = now().getTime();
  if (!Number.isFinite(value)) throw new Error('Export destination gateway clock is invalid');
  return value;
}

function monotonicTime(now: () => number): number {
  const value = now();
  if (!Number.isFinite(value))
    throw new Error('Export destination gateway monotonic clock is invalid');
  return value;
}

function assertAllowedExtension(input: ExportPickerInput, displayLabel: string): void {
  if (input.destination !== 'file') return;
  const extension = extname(displayLabel).slice(1).toLowerCase();
  if (!input.allowedExtensions.some((allowed) => allowed.toLowerCase() === extension)) {
    throw new Error('Export destination picker returned a disallowed file extension');
  }
}

function destinationKind(
  destination: ExportPickerInput['destination'],
): DeliveryDestinationIntent['kind'] {
  return destination === 'file' ? 'user_selected_file' : 'user_selected_folder';
}

function sameOperation(
  left: NonNullable<GrantRecord['operation']>,
  right: NonNullable<GrantRecord['operation']>,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.chatId === right.chatId &&
    left.runId === right.runId &&
    canonicalJson(left.deliveryPlan) === canonicalJson(right.deliveryPlan) &&
    left.requiredExtension === right.requiredExtension &&
    left.operationFingerprint === right.operationFingerprint
  );
}

function requestOperation(
  request: ResolveDeliveryDestinationGrantRequest,
): NonNullable<GrantRecord['operation']> {
  try {
    return {
      projectId: parseCanonical(EntityIdSchema, request.projectId),
      chatId: parseCanonical(EntityIdSchema, request.chatId),
      runId: parseCanonical(EntityIdSchema, request.runId),
      deliveryPlan: parseCanonical(DeliveryRefSchema, request.deliveryPlan),
      requiredExtension: parseCanonical(DeliveryContainerSchema, request.requiredExtension),
      operationFingerprint: parseCanonical(Sha256Schema, request.operationFingerprint),
    };
  } catch {
    throw invalid('Delivery export grant scope is invalid');
  }
}

export function createTargetExportDestinationGateway(
  options: TargetExportDestinationGatewayOptions = {},
): TargetExportDestinationGateway {
  const grants = new Map<string, GrantRecord>();
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const createGrantId = options.createGrantId ?? defaultGrantId;
  const createSecret = options.createSecret ?? defaultSecret;
  let closed = false;

  const pruneExpired = (time: number) => {
    for (const [grantId, grant] of grants) {
      if (grant.deadline <= time) grants.delete(grantId);
    }
  };

  const nextGrantId = () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const grantId = parseCanonical(EntityIdSchema, createGrantId());
      if (!grants.has(grantId)) return grantId;
    }
    throw new Error('Export destination grant generation collided repeatedly');
  };

  const pick: TargetWireHandler<'os.export.pick'> = async (request) => {
    if (closed || options.picker === undefined) throw unavailable();
    const selection = await options.picker.pick(request.input);
    if (closed) throw unavailable();
    if (selection.state === 'cancelled') {
      return {
        wireVersion: 1,
        kind: 'success',
        requestId: request.requestId,
        method: 'os.export.pick',
        result: { state: 'cancelled' },
      } as ExportPickerSuccess;
    }
    if (
      selection.state !== 'selected' ||
      selection.destination !== request.input.destination ||
      selection.writableGrant === null ||
      selection.writableGrant === undefined
    ) {
      throw new Error('Export destination picker returned an invalid selection');
    }

    const displayLabel = parseCanonical(SafeLeafDisplayLabelSchema, selection.displayLabel);
    assertAllowedExtension(request.input, displayLabel);
    const issuedAt = currentTime(now);
    const issuedAtMonotonic = monotonicTime(monotonicNow);
    pruneExpired(issuedAtMonotonic);
    if (grants.size >= MAX_GRANTS) throw unavailable();
    const grantId = nextGrantId();
    const expiresAt = issuedAt + DEFAULT_GRANT_LIFETIME_MS;
    const descriptor = parseCanonical(ScopedDeliveryDestinationIntentSchema, {
      kind: destinationKind(selection.destination),
      grantId,
      grantHash: createHash('sha256').update(createSecret()).digest('hex'),
      displayLabel,
      projectId: request.input.projectId,
      deliveryPlan: request.input.deliveryPlan,
      allowedExtensions: request.input.allowedExtensions,
    });
    const grant = parseCanonical(DeliveryDestinationGrantV1Schema, {
      destination: descriptor,
      expiresAt: new Date(expiresAt).toISOString(),
    });
    grants.set(
      descriptor.grantId,
      Object.freeze({
        chatId: request.input.chatId,
        descriptor,
        deadline: issuedAtMonotonic + DEFAULT_GRANT_LIFETIME_MS,
        writableGrant: selection.writableGrant,
        operation: null,
      }),
    );
    return {
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'os.export.pick',
      result: { state: 'selected', grant },
    } as ExportPickerSuccess;
  };

  return Object.freeze({
    pick,

    async resolve(
      request: ResolveDeliveryDestinationGrantRequest,
    ): Promise<ResolvedDeliveryDestinationGrant> {
      if (closed) throw invalid('Delivery export destination gateway is closed');
      const operation = requestOperation(request);
      let descriptor: DeliveryDestinationIntent;
      try {
        descriptor = parseCanonical(DeliveryDestinationIntentSchema, request.descriptor);
      } catch {
        throw invalid('Delivery export destination descriptor is invalid');
      }
      const time = monotonicTime(monotonicNow);
      pruneExpired(time);
      const grant = grants.get(descriptor.grantId);
      if (grant === undefined)
        throw new TargetStorageError('NOT_FOUND', 'Delivery export destination expired');
      if (
        grant.chatId !== operation.chatId ||
        grant.descriptor.projectId !== operation.projectId ||
        canonicalJson(grant.descriptor.deliveryPlan) !== canonicalJson(operation.deliveryPlan) ||
        !grant.descriptor.allowedExtensions.some(
          (extension) => extension.toLowerCase() === operation.requiredExtension,
        ) ||
        grant.descriptor.kind !== descriptor.kind ||
        grant.descriptor.grantHash !== descriptor.grantHash ||
        grant.descriptor.displayLabel !== descriptor.displayLabel
      ) {
        throw invalid('Delivery export destination does not match its bound grant');
      }
      if (grant.operation !== null && !sameOperation(grant.operation, operation)) {
        throw invalid('Delivery export destination is already bound to another operation');
      }
      if (grant.operation === null) {
        grants.set(descriptor.grantId, Object.freeze({ ...grant, operation }));
      }
      return Object.freeze({ descriptor, writableGrant: grant.writableGrant });
    },

    close(): void {
      if (closed) return;
      closed = true;
      grants.clear();
    },
  });
}
