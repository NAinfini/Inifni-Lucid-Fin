import {
  ActorSchema,
  CausationRefSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  WireSuccessV1Schema,
  parseCanonical,
  parseRequestV1,
  strictObject,
  z,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import { decodeWireSuccess, encodeWireSuccess } from './canonical-codecs.js';
import { hashUtf8, hashWireSemanticInput, hashWireSuccess } from './hashes.js';

export const TargetCommandContextSchema = strictObject({
  actor: ActorSchema,
  causation: CausationRefSchema,
  correlationId: EntityIdSchema,
});
export type TargetCommandContext = z.output<typeof TargetCommandContextSchema>;

interface ReceiptRow {
  input_hash: string;
  response_v1_json: string;
  response_hash: string;
}

export interface WireMutationResult<Response extends WireSuccessV1> {
  readonly projectId: string | null;
  readonly response: Response;
}

function corrupt(message: string): TargetStorageError {
  return new TargetStorageError('CORRUPT_DATA', message);
}

function readValidatedReceipt<Request extends WireRequestV1, Response extends WireSuccessV1>(
  database: DatabaseSync,
  request: Request,
  context: TargetCommandContext,
  hostSemanticInput?: unknown,
): Response | undefined {
  const inputHash = hashWireSemanticInput(request, context, hostSemanticInput);
  const existing = database
    .prepare(
      `SELECT input_hash, response_v1_json, response_hash
       FROM wire_command_receipts
       WHERE request_id = ?`,
    )
    .get(request.requestId) as unknown as ReceiptRow | undefined;
  if (existing === undefined) return undefined;
  if (existing.input_hash !== inputHash) {
    throw new TargetStorageError(
      'IDEMPOTENCY_CONFLICT',
      `Wire request ${request.requestId} was already used for different semantics`,
    );
  }
  const response = decodeWireSuccess(existing.response_v1_json);
  if (
    encodeWireSuccess(response) !== existing.response_v1_json ||
    hashWireSuccess(response) !== existing.response_hash ||
    hashUtf8(existing.response_v1_json) !== existing.response_hash
  ) {
    throw corrupt(`Wire receipt ${request.requestId} response hash does not match its payload`);
  }
  if (response.requestId !== request.requestId || response.method !== request.method) {
    throw corrupt(`Wire receipt ${request.requestId} is bound to a different response`);
  }
  return response as Response;
}

export function readWireMutationReceipt<
  Request extends WireRequestV1,
  Response extends WireSuccessV1,
>(
  database: DatabaseSync,
  requestInput: Request,
  contextInput: TargetCommandContext,
  hostSemanticInput?: unknown,
): Response | undefined {
  const request = parseRequestV1(requestInput) as Request;
  const context = parseCanonical(TargetCommandContextSchema, contextInput);
  return readValidatedReceipt<Request, Response>(database, request, context, hostSemanticInput);
}

export function executeWireMutation<Request extends WireRequestV1, Response extends WireSuccessV1>(
  database: DatabaseSync,
  requestInput: Request,
  contextInput: TargetCommandContext,
  committedAtInput: string,
  execute: () => WireMutationResult<Response>,
  hostSemanticInput?: unknown,
): Response {
  const request = parseRequestV1(requestInput) as Request;
  const context = parseCanonical(TargetCommandContextSchema, contextInput);
  const committedAt = parseCanonical(IsoTimestampSchema, committedAtInput);
  const inputHash = hashWireSemanticInput(request, context, hostSemanticInput);

  return withImmediateTransaction(database, () => {
    const existing = readValidatedReceipt<Request, Response>(
      database,
      request,
      context,
      hostSemanticInput,
    );
    if (existing !== undefined) return existing;

    const result = execute();
    const projectId =
      result.projectId === null ? null : parseCanonical(EntityIdSchema, result.projectId);
    const response = parseCanonical(WireSuccessV1Schema, result.response) as Response;
    if (response.requestId !== request.requestId || response.method !== request.method) {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        'Wire mutation returned a response for a different request',
      );
    }
    const responseJson = encodeWireSuccess(response);
    const responseHash = hashWireSuccess(response);
    if (hashUtf8(responseJson) !== responseHash) {
      throw corrupt('Canonical Wire response hash is not stable');
    }
    database
      .prepare(
        `INSERT INTO wire_command_receipts (
           request_id, input_hash, project_id, response_v1_json, response_hash, committed_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(request.requestId, inputHash, projectId, responseJson, responseHash, committedAt);
    return response;
  });
}
