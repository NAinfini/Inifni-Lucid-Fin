import { runInNewContext } from 'node:vm';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  AttemptStateSchema,
  AgentResultDefinition,
  AgentSendRecoveryPayloadV1Schema,
  CanonicalDecimalSchema,
  ChildObjectiveRecoveryPayloadV1Schema,
  CompactionEventSchema,
  CountSchema,
  DomainObjectRefSchema,
  EncryptedRecoveryEnvelopeSchema,
  GlobalMediaFolderSchema,
  MediaDerivationAttemptViewSchema,
  MediaSchema,
  ModelSurfaceRunEventSchema,
  OperationRefSchema,
  ProjectHistorySchema,
  ProjectSchema,
  ProtectedFieldRefSchema,
  PublicRunEventSchema,
  RunActivationSchema,
  RunEventSchema,
  RunInboxMessageSchema,
  RunSchema,
  assertActivationOrdering,
  assertActivationStateTransition,
  assertAppendOnlyRunEvents,
  assertAttemptStateTransition,
  assertInboxOrdering,
  assertInboxStateTransition,
  assertRunStateTransition,
  parseCanonical,
  validateCompactionTransaction,
} from './index.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const NOW = '2026-08-15T12:00:00.000Z';

function runBudget() {
  return {
    costUsd: { state: 'known', value: '25', currency: 'USD' },
    maxGenerationCount: 10,
    maxInputTokens: 100_000,
    maxOutputTokens: 20_000,
  } as const;
}

function projectInput() {
  return {
    authority: 'project',
    id: 'project-1',
    name: 'Film',
    lifecycle: 'active',
    schemaRevision: 1,
    revision: 0,
    contentHash: HASH_A,
    createdBy: { kind: 'direct_ui', actionId: 'action-1' },
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    deletedAt: null,
  } as const;
}

function globalMediaFolderInput() {
  return {
    authority: 'global_media_folder' as const,
    id: 'folder-1',
    revision: 0,
    contentHash: HASH_A,
    parentId: null,
    name: 'References',
    sortOrder: -1,
    createdAt: NOW,
    updatedAt: NOW,
  } as const;
}

function runEvent(sequence: number, previousEventHash: string | null, eventHash: string) {
  return {
    visibility: 'public',
    eventId: `event-${sequence}`,
    eventVersion: 1,
    runId: 'run-1',
    sequence,
    occurredAt: NOW,
    actor: 'commander',
    causation: { kind: 'run', runId: 'run-1' },
    correlationId: 'correlation-1',
    idempotencyKey: `event-key-${sequence}`,
    payloadHash: HASH_B,
    previousEventHash,
    eventHash,
    payloadState: {
      state: 'available',
      payload: { type: 'progress', summary: 'Working' },
    },
  } as const;
}

function modelSurfaceRunEvent(
  sequence: number,
  previousEventHash: string | null,
  eventHash: string,
) {
  return {
    visibility: 'model_surface',
    eventId: `model-event-${sequence}`,
    eventVersion: 1,
    runId: 'run-1',
    sequence,
    occurredAt: NOW,
    actor: 'system',
    causation: { kind: 'run', runId: 'run-1' },
    correlationId: null,
    idempotencyKey: null,
    payloadHash: HASH_A,
    previousEventHash,
    eventHash,
    payloadState: {
      state: 'available',
      payload: {
        type: 'message_ref',
        role: 'user',
        messageId: 'message-1',
        messageHash: HASH_B,
      },
    },
  } as const;
}

describe('strict canonical contracts', () => {
  it('keeps private child objectives out of durable agent results', () => {
    const childSummary = {
      child: {
        childRunId: 'run.child.1',
        revision: 3,
        contentHash: HASH_B,
        state: 'completed' as const,
        objectiveHash: HASH_A,
      },
      displayName: 'Continuity check',
      summary: 'The prop moves between shots.',
      resultRefs: [],
      artifacts: [],
      blockers: [],
      usage: {
        costUsd: { state: 'known' as const, value: '0.1', currency: 'USD' },
        generationCount: { state: 'known' as const, value: 0 },
        inputTokens: { state: 'known' as const, value: 2_000 },
        outputTokens: { state: 'known' as const, value: 500 },
      },
    };

    expect(AgentResultDefinition.parseSuccess({ children: [childSummary] })).toEqual({
      children: [childSummary],
    });
    expect(() =>
      AgentResultDefinition.parseSuccess({
        children: [{ ...childSummary, objective: 'private child objective' }],
      }),
    ).toThrow();
  });

  it('rejects unknown keys, non-plain objects, and non-finite numbers', () => {
    expect(ProjectSchema.safeParse({ ...projectInput(), extra: true }).success).toBe(false);

    class ProjectInput {
      authority = 'project' as const;
      id = 'project-1';
      name = 'Film';
      lifecycle = 'active' as const;
      schemaRevision = 1;
      revision = 0;
      contentHash = HASH_A;
      createdBy = projectInput().createdBy;
      createdAt = NOW;
      updatedAt = NOW;
      archivedAt = null;
      deletedAt = null;
    }

    expect(ProjectSchema.safeParse(new ProjectInput()).success).toBe(false);
    expect(
      ProjectSchema.safeParse({
        ...projectInput(),
        revision: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
  });

  it('preflights the entire input without invoking accessors', () => {
    let getterCalls = 0;
    const accessorInput = { ...projectInput() } as { [key: string]: unknown };
    Object.defineProperty(accessorInput, 'name', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'Film';
      },
    });
    expect(() => parseCanonical(ProjectSchema, accessorInput)).toThrow(/accessor/i);
    expect(getterCalls).toBe(0);

    const symbolInput = { ...projectInput(), [Symbol('hidden')]: true };
    expect(() => parseCanonical(ProjectSchema, symbolInput)).toThrow(/symbol/i);

    const cyclicInput = { ...projectInput() } as { [key: string]: unknown };
    cyclicInput.self = cyclicInput;
    expect(() => parseCanonical(ProjectSchema, cyclicInput)).toThrow(/cycle/i);

    class ProjectInput extends Object {
      authority = 'project' as const;
    }
    expect(() => parseCanonical(ProjectSchema, new ProjectInput())).toThrow(/non-plain/i);
    expect(() => parseCanonical(ProjectSchema, { ...projectInput(), name: undefined })).toThrow(
      /non-canonical/i,
    );
    expect(() =>
      parseCanonical(ProjectSchema, {
        ...projectInput(),
        revision: 1n,
      }),
    ).toThrow(/non-canonical/i);
    expect(() =>
      parseCanonical(ProjectSchema, {
        ...projectInput(),
        revision: Number.NaN,
      }),
    ).toThrow(/non-finite/i);
  });

  it('clones, orders, and deeply freezes canonical output', () => {
    const raw = projectInput();
    const parsed = parseCanonical(ProjectSchema, raw);

    expect(parsed).toEqual(raw);
    expect(parsed).not.toBe(raw);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.createdBy)).toBe(true);
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
  });

  it('accepts ordinary arrays produced in another JavaScript realm', () => {
    const crossRealmArray = runInNewContext("['continuity', 'prompt']") as unknown;
    expect(Array.isArray(crossRealmArray)).toBe(true);
    expect(parseCanonical(z.array(z.string()), crossRealmArray)).toEqual(['continuity', 'prompt']);
  });

  it('uses canonical money strings and safe integer counts', () => {
    expect(CanonicalDecimalSchema.safeParse('25.01').success).toBe(true);
    expect(CanonicalDecimalSchema.safeParse(25.01).success).toBe(false);
    expect(CanonicalDecimalSchema.safeParse('025.01').success).toBe(false);
    expect(CanonicalDecimalSchema.safeParse('25.010').success).toBe(false);
    expect(CountSchema.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(true);
    expect(CountSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
  });

  it('keeps Global Media Folders strict, canonical, and outside Domain Objects', () => {
    const folder = globalMediaFolderInput();
    expect(GlobalMediaFolderSchema.parse(folder)).toEqual(folder);
    expect(MediaSchema.parse(folder)).toEqual(folder);
    expect(GlobalMediaFolderSchema.safeParse({ ...folder, parentId: folder.id }).success).toBe(
      false,
    );
    expect(GlobalMediaFolderSchema.safeParse({ ...folder, name: '   ' }).success).toBe(false);
    expect(
      GlobalMediaFolderSchema.safeParse({
        ...folder,
        sortOrder: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    expect(GlobalMediaFolderSchema.safeParse({ ...folder, unexpected: true }).success).toBe(false);
  });

  it('binds protected fields and operations to exact authority owners', () => {
    expect(
      ProtectedFieldRefSchema.safeParse({
        owner: 'delivery',
        deliveryId: 'delivery-1',
        itemId: null,
        field: 'order',
      }).success,
    ).toBe(true);
    expect(ProtectedFieldRefSchema.safeParse({ path: 'anything.user.wants' }).success).toBe(false);
    expect(
      OperationRefSchema.safeParse({
        id: 'operation-1',
        kind: 'generation_attempt',
        revision: 1,
        ownerRef: {
          authority: 'delivery_export',
          id: 'export-1',
          revision: 1,
          contentHash: HASH_A,
        },
      }).success,
    ).toBe(false);
    expect(
      OperationRefSchema.safeParse({
        id: 'operation-derive-1',
        kind: 'media_derivation',
        revision: 2,
        ownerRef: {
          authority: 'media_derivation_attempt',
          id: 'derive-attempt-1',
          revision: 2,
          contentHash: HASH_A,
        },
      }).success,
    ).toBe(true);
    expect(
      MediaDerivationAttemptViewSchema.safeParse({
        authority: 'media_derivation_attempt',
        id: 'derive-attempt-1',
        derivation: {
          authority: 'media_derivation',
          id: 'derive-1',
          projectId: 'project-1',
          runId: 'run-1',
          sourceBlobHash: HASH_A,
          transform: { operation: 'resize', width: 1920, height: 1080, fit: 'contain' },
          requestHash: HASH_B,
          idempotencyKey: HASH_B,
          createdAt: NOW,
        },
        revision: 2,
        contentHash: HASH_A,
        attemptNumber: 1,
        state: 'running',
        provider: null,
        receipt: null,
        usage: null,
        cancelRequested: false,
        progressPercent: 20,
        publicErrorCode: null,
        createdAt: NOW,
        finishedAt: null,
      }).success,
    ).toBe(true);
  });

  it('limits Project object references to revision-and-hash authorities', () => {
    expect(
      DomainObjectRefSchema.parse({
        authority: 'project',
        id: 'project-1',
        revision: 1,
        contentHash: HASH_A,
      }),
    ).toMatchObject({ authority: 'project' });
    expect(
      DomainObjectRefSchema.parse({
        authority: 'canvas',
        id: 'canvas-1',
        revision: 1,
        contentHash: HASH_B,
      }),
    ).toMatchObject({ authority: 'canvas' });

    for (const authority of [
      'media_blob',
      'global_media_asset',
      'media_derivation',
      'chat',
      'message',
      'run',
      'context_manifest',
      'task_list',
      'user_choice',
      'project_event',
      'project_memory',
    ] as const) {
      expect(
        DomainObjectRefSchema.safeParse({
          authority,
          id: 'not-a-project-object',
          revision: 0,
          contentHash: HASH_A,
        }).success,
      ).toBe(false);
    }
  });
});

describe('state machines', () => {
  it('allows documented Run transitions and rejects shortcuts or terminal revival', () => {
    expect(() => assertRunStateTransition('accepted', 'running')).not.toThrow();
    expect(() => assertRunStateTransition('accepted', 'completed')).toThrow(/run transition/i);
    expect(() => assertRunStateTransition('completed', 'running')).toThrow(/terminal/i);
  });

  it('requires receipt reconciliation when an attempt is unknown', () => {
    expect(AttemptStateSchema.parse('unknown')).toBe('unknown');
    expect(() => assertAttemptStateTransition('unknown', 'succeeded', true)).not.toThrow();
    expect(() => assertAttemptStateTransition('unknown', 'succeeded', false)).toThrow(
      /reconciliation/i,
    );
    expect(() => assertAttemptStateTransition('prepared', 'failed', false)).not.toThrow();
    expect(() => assertAttemptStateTransition('succeeded', 'running', true)).toThrow(/terminal/i);
  });

  it('prevents Inbox terminal states from reviving', () => {
    expect(() => assertInboxStateTransition('queued', 'delivered')).not.toThrow();
    expect(() => assertInboxStateTransition('delivered', 'cancelled')).toThrow(/illegal/i);
    expect(() => assertInboxStateTransition('consumed', 'delivered')).toThrow(/terminal/i);
  });

  it('ends an Activation once with an explicit reason', () => {
    expect(() => assertActivationStateTransition('active', 'ended')).not.toThrow();
    expect(() => assertActivationStateTransition('ended', 'active')).toThrow(/terminal/i);
    expect(
      RunActivationSchema.safeParse({
        runId: 'run-1',
        activationNumber: 1,
        triggerInboxMessageId: 'inbox-1',
        triggerInboxSequence: 1,
        state: 'active',
        eventStartSequence: 1,
        eventEndSequence: null,
        startedAt: NOW,
        endedAt: null,
        endReason: 'process_exit',
      }).success,
    ).toBe(false);
  });
});

describe('durable Run order', () => {
  it('enforces monotonic FIFO Inbox messages and activation epochs', () => {
    const inbox = [
      {
        id: 'inbox-1',
        runId: 'run-1',
        sequence: 1,
        actor: 'user',
        source: { kind: 'message', messageId: 'message-1', contentHash: HASH_A },
        selectedContext: [],
        contentHash: HASH_A,
        state: 'consumed',
        createdAt: NOW,
      },
      {
        id: 'inbox-2',
        runId: 'run-1',
        sequence: 2,
        actor: 'user',
        source: { kind: 'message', messageId: 'message-2', contentHash: HASH_B },
        selectedContext: [],
        contentHash: HASH_B,
        state: 'queued',
        createdAt: NOW,
      },
    ] as const;

    expect(() => inbox.forEach((message) => RunInboxMessageSchema.parse(message))).not.toThrow();
    expect(() => assertInboxOrdering(inbox)).not.toThrow();
    expect(() => assertInboxOrdering([inbox[1], inbox[0]])).toThrow(/sequence/i);
    expect(() =>
      assertInboxOrdering([
        { ...inbox[0], state: 'queued' },
        { ...inbox[1], state: 'consumed' },
      ]),
    ).toThrow(/FIFO/i);

    expect(() =>
      assertActivationOrdering([
        {
          runId: 'run-1',
          activationNumber: 1,
          triggerInboxMessageId: 'inbox-1',
          triggerInboxSequence: 1,
          state: 'ended',
          eventStartSequence: 1,
          eventEndSequence: 4,
          startedAt: NOW,
          endedAt: NOW,
          endReason: 'safe_boundary',
        },
        {
          runId: 'run-1',
          activationNumber: 2,
          triggerInboxMessageId: 'inbox-2',
          triggerInboxSequence: 2,
          state: 'active',
          eventStartSequence: 5,
          eventEndSequence: null,
          startedAt: NOW,
          endedAt: null,
          endReason: null,
        },
      ]),
    ).not.toThrow();
  });

  it('requires contiguous append-only event sequences and hashes', () => {
    const events = [runEvent(1, null, HASH_A), modelSurfaceRunEvent(2, HASH_A, HASH_B)];
    expect(() => events.forEach((event) => RunEventSchema.parse(event))).not.toThrow();
    expect(() => assertAppendOnlyRunEvents(events)).not.toThrow();
    expect(() => assertAppendOnlyRunEvents([events[1], events[0]])).toThrow(/sequence/i);
    expect(() =>
      assertAppendOnlyRunEvents([events[0], { ...events[1], previousEventHash: null }]),
    ).toThrow(/hash chain/i);
  });

  it('separates public projection, model surface, private recovery, and derived History', () => {
    const publicEvent = runEvent(1, null, HASH_A);
    const modelEvent = modelSurfaceRunEvent(1, null, HASH_A);
    expect(PublicRunEventSchema.safeParse(publicEvent).success).toBe(true);
    expect(ModelSurfaceRunEventSchema.safeParse(publicEvent).success).toBe(false);
    expect(ModelSurfaceRunEventSchema.safeParse(modelEvent).success).toBe(true);
    expect(PublicRunEventSchema.safeParse(modelEvent).success).toBe(false);
    expect(
      ModelSurfaceRunEventSchema.safeParse({
        ...modelEvent,
        payloadState: {
          state: 'available',
          payload: {
            type: 'compaction_started',
            transactionId: 'compact-1',
            activationNumber: 1,
            sourceEventFrom: 1,
            sourceEventTo: 20,
            originalTokenCount: 12_000,
            model: 'gpt-5.6-sol',
            operationFingerprint: HASH_A,
          },
        },
      }).success,
    ).toBe(true);
    expect(
      PublicRunEventSchema.safeParse({
        ...publicEvent,
        payloadState: {
          state: 'available',
          payload: {
            type: 'compaction_started',
            transactionId: 'compact-1',
            activationNumber: 1,
            sourceEventFrom: 1,
            sourceEventTo: 20,
            originalTokenCount: 12_000,
            model: 'gpt-5.6-sol',
            operationFingerprint: HASH_A,
          },
        },
      }).success,
    ).toBe(false);

    const recovery = EncryptedRecoveryEnvelopeSchema.parse({
      boundary: 'private_recovery',
      id: 'recovery-1',
      runId: 'run-1',
      sequence: 1,
      activationNumber: 1,
      schemaVersion: 1,
      algorithm: 'aes-256-gcm',
      encryptionKeyId: 'key-1',
      nonceBase64: 'a'.repeat(24),
      ciphertextBase64: 'encrypted',
      authenticationTagBase64: 'b'.repeat(24),
      ciphertextHash: HASH_A,
      aadHash: HASH_B,
      previousEnvelopeHash: null,
      envelopeHash: HASH_A,
      byteLength: 9,
      createdAt: NOW,
    });
    const childObjective = ChildObjectiveRecoveryPayloadV1Schema.parse({
      schemaVersion: 1,
      kind: 'child_objective',
      runId: 'run-1',
      inboxMessageId: 'inbox-1',
      parentRunId: 'parent-run-1',
      parentEventId: 'parent-event-1',
      parentDispatchOperationId: null,
      directionHash: HASH_A,
      objective: 'Compare the two harbor shots for continuity.',
    });
    expect(
      ChildObjectiveRecoveryPayloadV1Schema.safeParse({
        ...childObjective,
        publicSummary: 'This must never become a recovery payload field.',
      }).success,
    ).toBe(false);
    const sentDirection = AgentSendRecoveryPayloadV1Schema.parse({
      schemaVersion: 1,
      kind: 'agent_send',
      runId: 'run-1',
      inboxMessageId: 'inbox-2',
      inboxSequence: 2,
      parentRunId: 'parent-run-1',
      parentEventId: 'parent-event-2',
      parentDispatchOperationId: 'dispatch-1',
      directionHash: HASH_B,
      message: 'Private follow-up direction.',
    });
    expect(
      AgentSendRecoveryPayloadV1Schema.safeParse({
        ...sentDirection,
        publicSummary: 'This must never become a recovery payload field.',
      }).success,
    ).toBe(false);
    expect(RunEventSchema.safeParse(recovery).success).toBe(false);
    expect(
      RunEventSchema.safeParse({
        ...publicEvent,
        visibility: 'private_recovery',
        payloadState: {
          state: 'available',
          payload: { type: 'private_recovery_appended', envelope: recovery },
        },
      }).success,
    ).toBe(false);

    const history = ProjectHistorySchema.parse({
      view: 'project_history',
      projectId: 'project-1',
      watermark: 0,
      entries: [],
    });
    expect(history.view).toBe('project_history');
    expect(
      DomainObjectRefSchema.safeParse({
        authority: 'project_history',
        id: 'history-1',
        revision: 0,
        contentHash: HASH_A,
      }).success,
    ).toBe(false);
  });
});

describe('compaction transaction', () => {
  const started = {
    type: 'compaction_started',
    transactionId: 'compact-1',
    activationNumber: 1,
    sourceEventFrom: 1,
    sourceEventTo: 20,
    originalTokenCount: 12_000,
    model: 'gpt-5.6-sol',
    operationFingerprint: HASH_B,
  } as const;
  const view = {
    type: 'compaction_view_derived',
    transactionId: 'compact-1',
    viewId: 'view-1',
    sourceEventFrom: 1,
    sourceEventTo: 20,
    derivedViewHash: HASH_A,
    summary: 'Cited compact model view',
    citedEventSequences: [1, 5, 20],
    compactedTokenCount: 1_500,
    operationFingerprint: HASH_B,
  } as const;
  const completed = {
    type: 'compaction_completed',
    transactionId: 'compact-1',
    viewId: 'view-1',
    derivedViewHash: HASH_A,
    operationFingerprint: HASH_B,
  } as const;

  it('accepts bracketed complete and interrupted transactions', () => {
    expect(() =>
      [started, view, completed].forEach((event) => CompactionEventSchema.parse(event)),
    ).not.toThrow();
    expect(() => validateCompactionTransaction([started, view, completed])).not.toThrow();
    expect(() =>
      validateCompactionTransaction([
        started,
        {
          type: 'compaction_interrupted',
          transactionId: 'compact-1',
          reason: 'process_restarted',
          operationFingerprint: HASH_B,
        },
      ]),
    ).not.toThrow();
  });

  it('rejects missing/mismatched boundaries and events after terminalization', () => {
    expect(() => validateCompactionTransaction([started, completed])).toThrow(/derived view/i);
    expect(() =>
      validateCompactionTransaction([started, view, { ...completed, derivedViewHash: HASH_B }]),
    ).toThrow(/view hash/i);
    expect(() =>
      validateCompactionTransaction([started, view, { ...completed, viewId: 'view-2' }]),
    ).toThrow(/view identity/i);
    expect(() => validateCompactionTransaction([started, view, completed, completed])).toThrow(
      /terminal/i,
    );
  });
});

describe('Run contract', () => {
  it('binds one immutable accepted objective to one Project and Chat', () => {
    expect(
      RunSchema.parse({
        authority: 'run',
        id: 'run-1',
        revision: 0,
        contentHash: HASH_A,
        rootRunId: 'run-1',
        parentRunId: null,
        retryOfRunId: null,
        retrySeedHash: null,
        projectId: 'project-1',
        chatId: 'chat-1',
        acceptedSource: { kind: 'message', messageId: 'message-1', contentHash: HASH_A },
        status: 'accepted',
        model: { providerId: 'openai', model: 'gpt-5.6-sol', reasoningStrength: null },
        permissionMode: 'reversible',
        budget: runBudget(),
        contextManifestId: 'manifest-1',
        contextManifestHash: HASH_B,
        capabilityCatalogSnapshotId: 'catalog-1',
        capabilityCatalogHash: HASH_A,
        publicEventHead: null,
        privateRecoveryHead: null,
        acceptedAt: NOW,
        terminalOutcome: null,
      }),
    ).toMatchObject({ projectId: 'project-1', chatId: 'chat-1', status: 'accepted' });
  });
});
