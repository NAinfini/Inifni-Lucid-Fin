import { createHash } from 'node:crypto';
import {
  canonicalJson,
  type ProjectEvent,
  type RunEvent,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import type { TargetCommandContext } from './command.js';

export function hashUtf8(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashCanonical(value: unknown): string {
  return hashUtf8(canonicalJson(value));
}

export function hashWireSemanticInput(
  request: WireRequestV1,
  context: TargetCommandContext,
  hostSemanticInput?: unknown,
): string {
  const wireSemanticInput = {
    wireVersion: request.wireVersion,
    method: request.method,
    input: request.input,
    actor: context.actor,
    causation: context.causation,
    correlationId: context.correlationId,
  };
  return hashCanonical(
    hostSemanticInput === undefined
      ? wireSemanticInput
      : { ...wireSemanticInput, hostSemanticInput },
  );
}

export function hashWireSuccess(response: WireSuccessV1): string {
  return hashCanonical(response);
}

type HashableProjectEvent = Omit<ProjectEvent, 'eventHash'> | ProjectEvent;

export function hashProjectEventEnvelope(event: HashableProjectEvent): string {
  const { payloadState: _payloadState, ...withPossibleHash } = event;
  const { eventHash: _eventHash, ...immutableEnvelope } = withPossibleHash as Omit<
    ProjectEvent,
    'payloadState'
  >;
  return hashCanonical(immutableEnvelope);
}

type HashableRunEvent = Omit<RunEvent, 'eventHash'> | RunEvent;

export function hashRunEventEnvelope(event: HashableRunEvent): string {
  const { payloadState: _payloadState, ...withPossibleHash } = event;
  const { eventHash: _eventHash, ...immutableEnvelope } = withPossibleHash as Omit<
    RunEvent,
    'payloadState'
  >;
  return hashCanonical(immutableEnvelope);
}

export function hashContentObject<ObjectWithHash extends { readonly contentHash: string }>(
  value: ObjectWithHash,
): string {
  const { contentHash: _contentHash, ...content } = value;
  return hashCanonical(content);
}
