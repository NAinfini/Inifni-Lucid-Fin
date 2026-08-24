import { describe, expect, it } from 'vitest';
import {
  OperationCancelInputSchema,
  OperationCancelOutputSchema,
  OperationGetInputSchema,
  OperationGetOutputSchema,
} from './operation.js';
import {
  PUBLIC_WIRE_METHODS_V1,
  TARGET_DESKTOP_API_GLOBAL_V1,
  TARGET_WIRE_INVOKE_CHANNEL_V1,
  TARGET_WIRE_PUSH_CHANNEL_V1,
  parseRequestV1,
  parseResponseV1,
  parseWireEnvelopeV1,
} from './wire.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const publicEvent = {
  visibility: 'public',
  eventId: 'event_1',
  eventVersion: 1,
  runId: 'run_1',
  sequence: 1,
  occurredAt: '2026-08-15T12:00:00.000Z',
  actor: 'commander',
  causation: { kind: 'run', runId: 'run_1' },
  correlationId: null,
  idempotencyKey: null,
  payloadHash: HASH_A,
  previousEventHash: null,
  eventHash: HASH_B,
  payloadState: {
    state: 'available',
    payload: { type: 'progress', summary: 'Inspecting references' },
  },
} as const;

describe('public wire v1', () => {
  it('freezes one target desktop invoke channel, push channel, and global API name', () => {
    expect(TARGET_WIRE_INVOKE_CHANNEL_V1).toBe('lucid-fin:target:wire:v1');
    expect(TARGET_WIRE_PUSH_CHANNEL_V1).toBe('lucid-fin:target:push:v1');
    expect(TARGET_DESKTOP_API_GLOBAL_V1).toBe('lucidTarget');
  });

  it('freezes the exact typed method registry', () => {
    expect(Object.keys(PUBLIC_WIRE_METHODS_V1)).toEqual([
      'canvas.apply',
      'canvas.get',
      'chat.archive',
      'chat.create',
      'chat.delete',
      'chat.list',
      'chat.rename',
      'confirmation.respond',
      'decision.protect',
      'decision.record',
      'delivery.apply',
      'delivery.query',
      'interaction.answer',
      'media.global.import',
      'media.global.list',
      'media.global.remove',
      'media.project.attach',
      'media.project.detach',
      'media.project.link',
      'media.project.list',
      'message.list',
      'message.send',
      'operation.cancel',
      'operation.get',
      'os.export.pick',
      'os.media.pick',
      'overview.get',
      'production.apply',
      'production.query',
      'project.create',
      'project.get',
      'project.list',
      'project.settings.get',
      'project.settings.update',
      'project.update',
      'run.control',
      'run.events.list',
      'run.get',
      'run.sendFollowup',
    ]);
    expect(Object.isFrozen(PUBLIC_WIRE_METHODS_V1)).toBe(true);
    expect(PUBLIC_WIRE_METHODS_V1['operation.get'].inputSchema).toBe(OperationGetInputSchema);
    expect(PUBLIC_WIRE_METHODS_V1['operation.get'].outputSchema).toBe(OperationGetOutputSchema);
    expect(PUBLIC_WIRE_METHODS_V1['operation.cancel'].inputSchema).toBe(OperationCancelInputSchema);
    expect(PUBLIC_WIRE_METHODS_V1['operation.cancel'].outputSchema).toBe(
      OperationCancelOutputSchema,
    );
  });

  it('accepts only strict version-1 method-correlated requests', () => {
    const request = parseRequestV1({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request_1',
      method: 'project.get',
      input: { projectId: 'project_1' },
    });
    expect(request.method).toBe('project.get');
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.input)).toBe(true);

    expect(() =>
      parseRequestV1({
        wireVersion: 0,
        kind: 'request',
        requestId: 'request_1',
        method: 'project.get',
        input: { projectId: 'project_1' },
      }),
    ).toThrow();
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request_1',
        method: 'run.get',
        input: { projectId: 'project_1' },
      }),
    ).toThrow();
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request_1',
        method: 'project.get',
        input: { projectId: 'project_1', legacyFallback: true },
      }),
    ).toThrow();
  });

  it('rejects an accessor without invoking it', () => {
    let getterCalls = 0;
    const request: { [key: string]: unknown } = {};
    Object.defineProperty(request, 'wireVersion', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    request.kind = 'request';
    request.requestId = 'request_1';
    request.method = 'project.get';
    request.input = { projectId: 'project_1' };

    expect(() => parseRequestV1(request)).toThrow(/Accessor/);
    expect(getterCalls).toBe(0);
  });

  it('parses sanitized success and failure responses without raw transport details', () => {
    expect(
      parseResponseV1({
        wireVersion: 1,
        kind: 'success',
        requestId: 'request_1',
        method: 'os.media.pick',
        result: {
          capabilityToken: 'cap_1234567890abcdefgh',
          displayLabel: 'Reference image',
          expiresAt: '2026-08-15T12:30:00.000Z',
        },
      }).kind,
    ).toBe('success');

    expect(
      parseResponseV1({
        wireVersion: 1,
        kind: 'failure',
        requestId: 'request_1',
        method: 'project.get',
        error: {
          code: 'not_found',
          publicSummary: 'Project not found',
          retryable: false,
          correlationId: 'correlation_1',
        },
      }).kind,
    ).toBe('failure');

    expect(() =>
      parseResponseV1({
        wireVersion: 1,
        kind: 'success',
        requestId: 'request_1',
        method: 'os.media.pick',
        result: {
          capabilityToken: 'cap_1234567890abcdefgh',
          displayLabel: 'Reference image',
          expiresAt: '2026-08-15T12:30:00.000Z',
          path: 'C:\\secret.png',
        },
      }),
    ).toThrow();
    expect(() =>
      parseResponseV1({
        wireVersion: 1,
        kind: 'failure',
        requestId: 'request_1',
        method: 'project.get',
        error: {
          code: 'internal_failure',
          publicSummary: 'Unable to load project',
          retryable: false,
          correlationId: 'correlation_1',
          stack: 'private stack',
        },
      }),
    ).toThrow();
  });

  it('binds destructive confirmations to the exact immutable input', () => {
    const confirmation = parseResponseV1({
      wireVersion: 1,
      kind: 'failure',
      requestId: 'request_delete_1',
      method: 'chat.delete',
      error: {
        code: 'confirmation_required',
        publicSummary: 'Confirm permanent chat deletion',
        retryable: false,
        correlationId: 'correlation_delete_1',
        confirmationId: 'confirmation_delete_1',
        immutableInputHash: HASH_A,
      },
    });
    expect(confirmation.kind).toBe('failure');

    expect(() =>
      parseResponseV1({
        wireVersion: 1,
        kind: 'failure',
        requestId: 'request_delete_1',
        method: 'chat.delete',
        error: {
          code: 'confirmation_required',
          publicSummary: 'Confirm permanent chat deletion',
          retryable: false,
          correlationId: 'correlation_delete_1',
        },
      }),
    ).toThrow();
    expect(() =>
      parseResponseV1({
        wireVersion: 1,
        kind: 'failure',
        requestId: 'request_1',
        method: 'project.get',
        error: {
          code: 'not_found',
          publicSummary: 'Project not found',
          retryable: false,
          correlationId: 'correlation_1',
          confirmationId: 'confirmation_1',
          immutableInputHash: HASH_A,
        },
      }),
    ).toThrow();
  });

  it('returns no confirmation effect, a next-root Skill registration, or an exact mutation receipt', () => {
    const response = {
      wireVersion: 1 as const,
      kind: 'success' as const,
      requestId: 'request_confirmation_1',
      method: 'confirmation.respond' as const,
      result: {
        confirmationId: 'confirmation.skill.1',
        messageId: 'message.confirmation.1',
        decision: 'approved' as const,
        effect: {
          kind: 'skill_registered' as const,
          projectId: 'project.1',
          skillId: 'skill.project.1',
          version: '1.0.0',
          contentHash: HASH_A,
          projectSettingsRevision: 3,
          projectSettingsContentHash: HASH_B,
          effectiveFrom: 'next_root_run' as const,
        },
      },
    };

    expect(parseResponseV1(response)).toEqual(response);
    expect(
      parseResponseV1({
        ...response,
        requestId: 'request_confirmation_2',
        result: { ...response.result, decision: 'denied', effect: null },
      }),
    ).toMatchObject({ result: { decision: 'denied', effect: null } });
    expect(() =>
      parseResponseV1({
        ...response,
        result: {
          ...response.result,
          effect: { ...response.result.effect, effectiveFrom: 'current_run' },
        },
      }),
    ).toThrow();
    expect(() =>
      parseResponseV1({
        ...response,
        result: { ...response.result, effect: { kind: 'skill_registered' } },
      }),
    ).toThrow();
    const deliveryResponse = {
      ...response,
      requestId: 'request_confirmation_3',
      result: {
        ...response.result,
        effect: {
          kind: 'delivery_mutated' as const,
          dispatchOperationId: 'dispatch.delivery.1',
          plan: {
            authority: 'delivery' as const,
            id: 'delivery.1',
            revision: 2,
            contentHash: HASH_A,
          },
          choice: {
            authority: 'user_choice' as const,
            id: 'choice.delivery.1',
            choiceHash: HASH_B,
          },
          outcomeHash: HASH_A,
        },
      },
    };
    expect(parseResponseV1(deliveryResponse)).toEqual(deliveryResponse);
    const productionResponse = {
      ...response,
      requestId: 'request_confirmation_production',
      result: {
        ...response.result,
        effect: {
          kind: 'production_mutated' as const,
          dispatchOperationId: 'dispatch.production.1',
          action: 'update' as const,
          receipts: [
            {
              object: {
                authority: 'production' as const,
                id: 'scene.1',
                revision: 3,
                contentHash: HASH_A,
              },
              previousRevision: 2,
              eventId: 'event.production.1',
              changedPaths: ['content'],
              undoRef: 'undo.production.1',
            },
          ],
          outcomeHash: HASH_B,
        },
      },
    };
    expect(parseResponseV1(productionResponse)).toEqual(productionResponse);
    expect(() =>
      parseResponseV1({
        ...productionResponse,
        result: {
          ...productionResponse.result,
          effect: { ...productionResponse.result.effect, receipts: [] },
        },
      }),
    ).toThrow();
    expect(() =>
      parseResponseV1({
        ...deliveryResponse,
        result: {
          ...deliveryResponse.result,
          effect: { ...deliveryResponse.result.effect, outcomeHash: 'invalid' },
        },
      }),
    ).toThrow();
    const decisionResponse = {
      ...response,
      requestId: 'request_confirmation_4',
      result: {
        ...response.result,
        effect: {
          kind: 'decision_recorded' as const,
          dispatchOperationId: 'dispatch.decision.1',
          choice: {
            authority: 'user_choice' as const,
            id: 'choice.decision.1',
            choiceHash: HASH_A,
          },
          action: 'undo' as const,
          owner: {
            authority: 'production' as const,
            id: 'shot.1',
            revision: 2,
            contentHash: HASH_B,
          },
          currentState: null,
          eventId: 'event.decision.1',
          outcomeHash: HASH_B,
        },
      },
    };
    expect(parseResponseV1(decisionResponse)).toEqual(decisionResponse);
    const protectionResponse = {
      ...decisionResponse,
      requestId: 'request_confirmation_5',
      result: {
        ...decisionResponse.result,
        effect: {
          kind: 'decision_protection_changed' as const,
          dispatchOperationId: 'dispatch.decision.2',
          choice: {
            authority: 'user_choice' as const,
            id: 'choice.decision.2',
            choiceHash: HASH_B,
          },
          active: true,
          owner: decisionResponse.result.effect.owner,
          eventId: 'event.decision.2',
          outcomeHash: HASH_A,
        },
      },
    };
    expect(parseResponseV1(protectionResponse)).toEqual(protectionResponse);
    expect(() =>
      parseResponseV1({
        ...decisionResponse,
        result: {
          ...decisionResponse.result,
          effect: { ...decisionResponse.result.effect, currentState: 'unknown' },
        },
      }),
    ).toThrow();
  });

  it('requires CAS inputs for mutable and destructive direct actions', () => {
    const requests = [
      {
        method: 'chat.rename',
        input: { chatId: 'chat_1', expectedRevision: 2, title: 'New title' },
      },
      {
        method: 'run.control',
        input: {
          runId: 'run_1',
          expectedRevision: 3,
          action: 'pause',
          expectedStatus: 'running',
        },
      },
      {
        method: 'run.sendFollowup',
        input: { runId: 'run_1', expectedRevision: 3, text: 'Continue', selectedContext: [] },
      },
      {
        method: 'media.global.remove',
        input: {
          globalAssetId: 'asset_1',
          expectedRevision: 4,
          expectedContentHash: HASH_A,
        },
      },
    ] as const;

    for (const [index, request] of requests.entries()) {
      const envelope = {
        wireVersion: 1,
        kind: 'request',
        requestId: `request_cas_${index}`,
        ...request,
      };
      expect(parseRequestV1(envelope).method).toBe(request.method);

      const missingRevision = structuredClone(envelope) as {
        input: Record<string, unknown>;
      };
      delete missingRevision.input.expectedRevision;
      expect(() => parseRequestV1(missingRevision)).toThrow();
    }

    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request_remove_without_hash',
        method: 'media.global.remove',
        input: { globalAssetId: 'asset_1', expectedRevision: 4 },
      }),
    ).toThrow();

    const operationRef = {
      id: 'operation_1',
      revision: 2,
      kind: 'generation_attempt' as const,
      ownerRef: {
        authority: 'generation_attempt' as const,
        id: 'attempt_1',
        revision: 2,
        contentHash: HASH_A,
      },
    };
    expect(
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request_cancel_1',
        method: 'operation.cancel',
        input: {
          operations: [{ ref: operationRef, expectedRevision: 2, expectedState: 'running' }],
        },
      }).method,
    ).toBe('operation.cancel');
  });

  it('allows only the persisted public RunEvent push with a matching cursor', () => {
    const push = parseWireEnvelopeV1({
      wireVersion: 1,
      kind: 'push',
      method: 'run.events.appended',
      payload: {
        cursor: { sequence: publicEvent.sequence, eventHash: publicEvent.eventHash },
        event: publicEvent,
      },
    });
    expect(push.kind).toBe('push');

    const persistBeforePushFixture = [
      {
        phase: 'persisted',
        eventId: publicEvent.eventId,
        cursor: { sequence: publicEvent.sequence, eventHash: publicEvent.eventHash },
      },
      { phase: 'pushed', envelope: push },
    ] as const;
    expect(persistBeforePushFixture[0].phase).toBe('persisted');
    expect(persistBeforePushFixture[1].phase).toBe('pushed');
    if (push.kind !== 'push') throw new Error('Expected push fixture');
    expect(push.payload.event.eventId).toBe(persistBeforePushFixture[0].eventId);
    expect(push.payload.cursor).toEqual(persistBeforePushFixture[0].cursor);

    expect(() =>
      parseWireEnvelopeV1({
        wireVersion: 1,
        kind: 'push',
        method: 'run.events.appended',
        payload: {
          cursor: { sequence: 2, eventHash: publicEvent.eventHash },
          event: publicEvent,
        },
      }),
    ).toThrow(/Cursor sequence mismatch/);
    expect(() =>
      parseWireEnvelopeV1({
        wireVersion: 1,
        kind: 'push',
        method: 'run.state.changed',
        payload: {},
      }),
    ).toThrow();
  });
});
