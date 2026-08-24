import { describe, expect, it } from 'vitest';
import {
  ContextManifestSchema,
  PublicRunEventSchema,
  RunAcceptedSourceSchema,
  RunSchema,
  RunStateChangedRunEventPayloadSchema,
  TaskListSchema,
  TOOL_DEFINITION_BY_ID,
  assertPolicyNarrowing,
  assertRunContextManifest,
  assertRunStateTransition,
  parseRequestV1,
} from './index.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const NOW = '2026-08-15T12:00:00.000Z';
const budget = {
  costUsd: { state: 'known' as const, value: '10', currency: 'USD' },
  maxGenerationCount: 5,
  maxInputTokens: 10_000,
  maxOutputTokens: 2_000,
};
const model = { providerId: 'provider.1', model: 'model.1', reasoningStrength: null };

function manifestFixture(
  source: 'root' | 'child',
  settingsPermission: 'read_only' | 'reversible' | 'full',
  effectivePermission: 'read_only' | 'reversible' | 'full',
  settingsBudget = budget,
  effectiveBudget = settingsBudget,
) {
  return {
    authority: 'context_manifest' as const,
    id: source === 'root' ? 'manifest.root' : 'manifest.child',
    runId: source === 'root' ? 'run.root' : 'run.child',
    retryOfRunId: null,
    retrySeedHash: null,
    projectId: 'project.1',
    projectRevision: 2,
    projectSettings: {
      authority: 'project_settings' as const,
      projectId: 'project.1',
      revision: 3,
      contentHash: HASH_B,
      defaultProviderProfileId: 'provider.1',
      formatPolicy: { aspectRatio: '16:9' as const, customDimensions: null, frameRate: 24 },
      permission: settingsPermission,
      budget: settingsBudget,
      enabledSkills: [],
      updatedAt: NOW,
    },
    chatId: 'chat.1',
    acceptedSource:
      source === 'root'
        ? { kind: 'message' as const, messageId: 'message.1', contentHash: HASH_A }
        : {
            kind: 'parent_direction' as const,
            parentRunId: 'run.root',
            parentEventId: 'event.delegate',
            directionHash: HASH_B,
          },
    locale: 'en-US',
    timeZone: 'America/New_York',
    selectedContext: [],
    projectMedia: [],
    attachments: [],
    historyWatermark: 0,
    memory: { state: 'unavailable' as const, reason: 'not_built' as const },
    model,
    permissionMode: effectivePermission,
    budget: effectiveBudget,
    capabilityCatalogSnapshotId: 'catalog.1',
    capabilityCatalogHash: HASH_A,
    capabilityIndex: [],
    capabilityIndexDigest: HASH_B,
    skillCatalogDigest: HASH_A,
    createdAt: NOW,
  };
}

function runBase() {
  return {
    authority: 'run' as const,
    revision: 0,
    contentHash: HASH_A,
    retryOfRunId: null,
    retrySeedHash: null,
    projectId: 'project.1',
    chatId: 'chat.1',
    status: 'accepted' as const,
    model,
    permissionMode: 'reversible' as const,
    budget,
    contextManifestId: 'manifest.1',
    contextManifestHash: HASH_B,
    capabilityCatalogSnapshotId: 'catalog.1',
    capabilityCatalogHash: HASH_A,
    publicEventHead: null,
    privateRecoveryHead: null,
    acceptedAt: NOW,
    terminalOutcome: null,
  };
}

describe('I2-E0 Run and Context contracts', () => {
  it('uses one strict accepted-source union and exact root/child Run shapes', () => {
    const messageSource = { kind: 'message', messageId: 'message.1', contentHash: HASH_A } as const;
    const parentSource = {
      kind: 'parent_direction',
      parentRunId: 'run.root',
      parentEventId: 'event.delegate',
      directionHash: HASH_B,
    } as const;
    expect(RunAcceptedSourceSchema.parse(messageSource)).toEqual(messageSource);
    expect(RunAcceptedSourceSchema.parse(parentSource)).toEqual(parentSource);

    expect(
      RunSchema.parse({
        ...runBase(),
        id: 'run.root',
        rootRunId: 'run.root',
        parentRunId: null,
        acceptedSource: messageSource,
      }),
    ).toMatchObject({ id: 'run.root', acceptedSource: messageSource });
    expect(
      RunSchema.parse({
        ...runBase(),
        id: 'run.child',
        rootRunId: 'run.root',
        parentRunId: 'run.root',
        acceptedSource: parentSource,
        displayName: 'Continuity review',
        publicSummary: 'Checking continuity against selected shots.',
      }),
    ).toMatchObject({ id: 'run.child', displayName: 'Continuity review' });
    expect(() =>
      RunSchema.parse({
        ...runBase(),
        id: 'run.invalid',
        rootRunId: 'run.invalid',
        parentRunId: null,
        acceptedSource: parentSource,
      }),
    ).toThrow();
  });

  it('freezes complete Project settings and selected-source identity in ContextManifest', () => {
    const acceptedSource = {
      kind: 'message' as const,
      messageId: 'message.1',
      contentHash: HASH_A,
    };
    const manifest = ContextManifestSchema.parse({
      authority: 'context_manifest',
      id: 'manifest.1',
      runId: 'run.root',
      retryOfRunId: null,
      retrySeedHash: null,
      projectId: 'project.1',
      projectRevision: 2,
      projectSettings: {
        authority: 'project_settings',
        projectId: 'project.1',
        revision: 3,
        contentHash: HASH_B,
        defaultProviderProfileId: 'provider.1',
        formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
        permission: 'reversible',
        budget,
        enabledSkills: [],
        updatedAt: NOW,
      },
      chatId: 'chat.1',
      acceptedSource,
      locale: 'en-US',
      timeZone: 'America/New_York',
      selectedContext: [],
      projectMedia: [],
      attachments: [],
      historyWatermark: 0,
      memory: { state: 'unavailable', reason: 'not_built' },
      model,
      permissionMode: 'reversible',
      budget,
      capabilityCatalogSnapshotId: 'catalog.1',
      capabilityCatalogHash: HASH_A,
      capabilityIndex: [],
      capabilityIndexDigest: HASH_B,
      skillCatalogDigest: HASH_A,
      createdAt: NOW,
    });
    expect(manifest.acceptedSource).toEqual(acceptedSource);
    expect(() => ContextManifestSchema.parse({ ...manifest, permissionMode: 'full' })).toThrow();
    expect(() =>
      ContextManifestSchema.parse({
        ...manifest,
        projectSettings: { ...manifest.projectSettings, projectId: 'project.other' },
      }),
    ).toThrow();
    const run = RunSchema.parse({
      ...runBase(),
      id: 'run.root',
      rootRunId: 'run.root',
      parentRunId: null,
      acceptedSource,
    });
    expect(() => assertRunContextManifest(run, manifest)).not.toThrow();
    expect(() => assertRunContextManifest(run, { ...manifest, chatId: 'chat.other' })).toThrow();
  });

  it('keeps root policy exact and permits only equal-or-narrower child policy', () => {
    const permissions = ['read_only', 'reversible', 'full'] as const;
    for (const [ceilingIndex, ceiling] of permissions.entries()) {
      for (const [effectiveIndex, effective] of permissions.entries()) {
        const root = () => ContextManifestSchema.parse(manifestFixture('root', ceiling, effective));
        const child = () =>
          ContextManifestSchema.parse(manifestFixture('child', ceiling, effective));
        if (ceilingIndex === effectiveIndex) expect(root).not.toThrow();
        else expect(root).toThrow();
        if (effectiveIndex <= ceilingIndex) expect(child).not.toThrow();
        else expect(child).toThrow();
      }
    }

    const narrower = {
      costUsd: { state: 'estimated' as const, value: '9.99999999999999999999', currency: 'USD' },
      maxGenerationCount: 4,
      maxInputTokens: 9_999,
      maxOutputTokens: 1_999,
    };
    const child = ContextManifestSchema.parse(
      manifestFixture('child', 'reversible', 'read_only', budget, narrower),
    );
    expect(child.projectSettings).toEqual(
      manifestFixture('child', 'reversible', 'read_only', budget, narrower).projectSettings,
    );
    expect(child.permissionMode).toBe('read_only');
    expect(child.budget).toEqual(narrower);
    expect(() =>
      ContextManifestSchema.parse(
        manifestFixture('root', 'reversible', 'reversible', budget, narrower),
      ),
    ).toThrow();
  });

  it('checks every child budget ceiling without floating-point loss', () => {
    const finite = (
      state: 'known' | 'estimated',
      value: string,
      overrides: Partial<typeof budget> = {},
    ) => ({
      ...budget,
      ...overrides,
      costUsd: { state, value, currency: 'USD' as const },
    });
    const unknown = {
      ...budget,
      costUsd: { state: 'unknown' as const, currency: 'USD' },
    };
    const parseChild = (ceiling: typeof budget, effective: typeof budget) =>
      ContextManifestSchema.parse(
        manifestFixture('child', 'reversible', 'reversible', ceiling, effective),
      );

    for (const field of ['maxGenerationCount', 'maxInputTokens', 'maxOutputTokens'] as const) {
      expect(() => parseChild(budget, { ...budget, [field]: budget[field] - 1 })).not.toThrow();
      expect(() => parseChild(budget, { ...budget, [field]: budget[field] + 1 })).toThrow();
    }

    expect(() => parseChild(unknown, unknown)).not.toThrow();
    expect(() => parseChild(unknown, finite('known', '999999999999999999999'))).not.toThrow();
    expect(() => parseChild(unknown, finite('estimated', '0.00000000000000000001'))).not.toThrow();
    expect(() => parseChild(finite('known', '20'), unknown)).toThrow();
    expect(() => parseChild(finite('estimated', '20'), unknown)).toThrow();
    expect(() => parseChild(finite('known', '20'), finite('estimated', '20'))).not.toThrow();
    expect(() => parseChild(finite('estimated', '20'), finite('known', '20'))).not.toThrow();
    expect(() =>
      parseChild(
        finite('known', '9007199254740993.0000000000000000001'),
        finite('estimated', '9007199254740993.00000000000000000009'),
      ),
    ).not.toThrow();
    expect(() =>
      parseChild(
        finite('known', '9007199254740993.0000000000000000001'),
        finite('estimated', '9007199254740993.0000000000000000002'),
      ),
    ).toThrow();
    expect(() =>
      parseChild(budget, {
        ...budget,
        costUsd: { state: 'known', value: '19', currency: 'EUR' },
      }),
    ).toThrow();

    expect(() =>
      assertPolicyNarrowing('reversible', budget, 'read_only', {
        costUsd: {
          state: 'estimated',
          value: '9.99999999999999999999',
          currency: 'USD',
        },
        maxGenerationCount: 4,
        maxInputTokens: 9_999,
        maxOutputTokens: 1_999,
      }),
    ).not.toThrow();
    expect(() => assertPolicyNarrowing('read_only', budget, 'full', budget)).toThrow();
  });

  it('aligns recovery and cancellation transitions', () => {
    expect(() => assertRunStateTransition('accepted', 'cancelled')).not.toThrow();
    expect(() => assertRunStateTransition('running', 'recovering')).not.toThrow();
    expect(() => assertRunStateTransition('recovering', 'cancelled')).not.toThrow();
  });

  it('maps pause and resume controls to typed state events without invented prose', () => {
    const controls = [
      {
        requestId: 'request.pause',
        input: {
          runId: 'run.root',
          expectedRevision: 2,
          action: 'pause',
          expectedStatus: 'running',
        },
        nextState: 'paused',
      },
      {
        requestId: 'request.resume',
        input: {
          runId: 'run.root',
          expectedRevision: 3,
          action: 'resume',
          expectedStatus: 'paused',
        },
        nextState: 'running',
      },
    ] as const;

    const events = controls.map(({ requestId, input, nextState }) => {
      const request = parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId,
        method: 'run.control',
        input,
      });
      if (request.method !== 'run.control' || request.input.action === 'cancel') {
        throw new Error('Expected a pause or resume control');
      }
      return RunStateChangedRunEventPayloadSchema.parse({
        type: 'run_state_changed',
        previousState: request.input.expectedStatus,
        state: nextState,
        runRevision: request.input.expectedRevision + 1,
      });
    });

    expect(events).toEqual([
      { type: 'run_state_changed', previousState: 'running', state: 'paused', runRevision: 3 },
      { type: 'run_state_changed', previousState: 'paused', state: 'running', runRevision: 4 },
    ]);
    expect(() =>
      RunStateChangedRunEventPayloadSchema.parse({
        ...events[0],
        publicSummary: 'Paused the Run.',
      }),
    ).toThrow();
  });
});

describe('I2-E0 TaskList and Wire contracts', () => {
  const validList = {
    authority: 'task_list' as const,
    id: 'tasks.1',
    runId: 'run.root',
    title: 'Current work',
    state: 'active' as const,
    revision: 1,
    contentHash: HASH_A,
    items: [
      {
        id: 'task.parent',
        title: 'Parent',
        state: 'in_progress' as const,
        order: 0,
        parentItemId: null,
        childRunIds: ['run.child'],
        publicNote: '',
      },
      {
        id: 'task.child',
        title: 'Child',
        state: 'pending' as const,
        order: 0,
        parentItemId: 'task.parent',
        childRunIds: [],
        publicNote: '',
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    terminalizedAt: null,
  };

  it('enforces TaskList lifecycle, tree, sibling order, and child Run uniqueness', () => {
    expect(TaskListSchema.parse(validList).items).toHaveLength(2);
    expect(() =>
      TaskListSchema.parse({ ...validList, state: 'completed', terminalizedAt: null }),
    ).toThrow();
    expect(() =>
      TaskListSchema.parse({
        ...validList,
        items: [
          { ...validList.items[0], parentItemId: 'task.child' },
          { ...validList.items[1], parentItemId: 'task.parent' },
        ],
      }),
    ).toThrow();
    expect(() =>
      TaskListSchema.parse({
        ...validList,
        items: [validList.items[0], { ...validList.items[1], parentItemId: null, order: 2 }],
      }),
    ).toThrow();
    expect(() =>
      TaskListSchema.parse({
        ...validList,
        items: [validList.items[0], { ...validList.items[1], childRunIds: ['run.child'] }],
      }),
    ).toThrow();
  });

  it('preserves selected-context roles and requires cancellation summaries', () => {
    const selectedContext = [
      {
        ref: { authority: 'production', id: 'shot.1', revision: 2, contentHash: HASH_A },
        role: 'target',
      },
    ] as const;
    expect(
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.message',
        method: 'message.send',
        input: {
          chatId: 'chat.1',
          blocks: [{ type: 'text', text: 'Continue' }],
          attachments: [],
          selectedContext,
          supersedesMessageId: null,
        },
      }).input,
    ).toMatchObject({ selectedContext });
    expect(
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.followup',
        method: 'run.sendFollowup',
        input: {
          runId: 'run.root',
          expectedRevision: 2,
          text: 'Continue with the selected shot.',
          selectedContext,
        },
      }).input,
    ).toMatchObject({ selectedContext });
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.cancel.missing',
        method: 'run.control',
        input: {
          runId: 'run.root',
          expectedRevision: 2,
          action: 'cancel',
          expectedStatus: 'running',
        },
      }),
    ).toThrow();
    expect(() =>
      parseRequestV1({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.cancel',
        method: 'run.control',
        input: {
          runId: 'run.root',
          expectedRevision: 2,
          action: 'cancel',
          expectedStatus: 'running',
          terminalSummary: 'Cancelled at user request.',
        },
      }),
    ).not.toThrow();
  });

  it('carries agent.spawn selected roles and one direction hash into the child context', () => {
    const spawnInput = TOOL_DEFINITION_BY_ID['agent.spawn'].parseInput({
      displayName: 'Continuity review',
      objective: 'Compare the selected shot against the established continuity.',
      publicSummary: 'Checking the selected shot for continuity.',
      contextRefs: [
        {
          ref: { authority: 'production', id: 'shot.1', revision: 2, contentHash: HASH_A },
          role: 'target',
        },
      ],
      toolAllowlist: null,
      permissionCeiling: null,
      budgetCaps: null,
      expectedParentRevision: 3,
    });
    const acceptedSource = RunAcceptedSourceSchema.parse({
      kind: 'parent_direction',
      parentRunId: 'run.root',
      parentEventId: 'event.delegate',
      directionHash: HASH_B,
    });
    const manifest = ContextManifestSchema.parse({
      authority: 'context_manifest',
      id: 'manifest.child',
      runId: 'run.child',
      retryOfRunId: null,
      retrySeedHash: null,
      projectId: 'project.1',
      projectRevision: 2,
      projectSettings: {
        authority: 'project_settings',
        projectId: 'project.1',
        revision: 3,
        contentHash: HASH_B,
        defaultProviderProfileId: 'provider.1',
        formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
        permission: 'reversible',
        budget,
        enabledSkills: [],
        updatedAt: NOW,
      },
      chatId: 'chat.1',
      acceptedSource,
      locale: 'en-US',
      timeZone: 'America/New_York',
      selectedContext: spawnInput.contextRefs,
      projectMedia: [],
      attachments: [],
      historyWatermark: 0,
      memory: { state: 'unavailable', reason: 'not_built' },
      model,
      permissionMode: 'reversible',
      budget,
      capabilityCatalogSnapshotId: 'catalog.child',
      capabilityCatalogHash: HASH_A,
      capabilityIndex: [],
      capabilityIndexDigest: HASH_B,
      skillCatalogDigest: HASH_A,
      createdAt: NOW,
    });
    const event = PublicRunEventSchema.parse({
      visibility: 'public',
      eventId: acceptedSource.parentEventId,
      eventVersion: 1,
      runId: acceptedSource.parentRunId,
      sequence: 1,
      occurredAt: NOW,
      actor: 'commander',
      causation: { kind: 'run', runId: acceptedSource.parentRunId },
      correlationId: null,
      idempotencyKey: null,
      payloadHash: HASH_A,
      previousEventHash: null,
      eventHash: HASH_B,
      payloadState: {
        state: 'available',
        payload: {
          type: 'child_run_delegated',
          childRunId: 'run.child',
          displayName: spawnInput.displayName,
          publicSummary: spawnInput.publicSummary,
          directionHash: acceptedSource.directionHash,
          operationFingerprint: HASH_A,
        },
      },
    });

    expect(manifest.selectedContext).toEqual(spawnInput.contextRefs);
    expect(manifest.selectedContext[0]?.role).toBe('target');
    expect(event.payloadState).toMatchObject({
      state: 'available',
      payload: {
        directionHash: acceptedSource.directionHash,
        operationFingerprint: HASH_A,
      },
    });
  });

  it('requires a model-provided public summary for every TaskList mutation and draft IDs on create', () => {
    const definition = TOOL_DEFINITION_BY_ID['task.manage'];
    const mutations = [
      {
        action: 'create',
        expectedRunRevision: 1,
        title: 'Current work',
        tasks: [
          {
            draftId: 'draft.1',
            title: 'Inspect references',
            parentDraftId: null,
            order: 0,
          },
        ],
      },
      { action: 'rename', expectedRevision: 1, title: 'Revised work' },
      {
        action: 'add',
        expectedRevision: 1,
        parentTaskId: null,
        order: 0,
        title: 'Inspect references',
      },
      {
        action: 'update',
        expectedRevision: 1,
        taskId: 'task.1',
        title: null,
        state: 'in_progress',
        resultSummary: null,
        childRunId: null,
      },
      {
        action: 'reorder',
        expectedRevision: 1,
        parentTaskId: null,
        orderedTaskIds: ['task.1'],
      },
      { action: 'remove', expectedRevision: 1, taskId: 'task.1' },
      { action: 'terminalize', expectedRevision: 1, state: 'completed' },
    ] as const;

    for (const mutation of mutations) {
      expect(() =>
        definition.parseInput({ ...mutation, publicSummary: `Applied ${mutation.action}.` }),
      ).not.toThrow();
      expect(() => definition.parseInput(mutation)).toThrow();
    }
    expect(() =>
      definition.parseInput({
        ...mutations[0],
        publicSummary: 'Created the list.',
        tasks: [{ title: 'Old draft shape', parentTaskId: null, order: 0 }],
      }),
    ).toThrow();
  });

  it('represents public RunEvent payload availability/redaction and safe child delegation', () => {
    const envelope = {
      visibility: 'public' as const,
      eventId: 'event.1',
      eventVersion: 1,
      runId: 'run.root',
      sequence: 1,
      occurredAt: NOW,
      actor: 'commander' as const,
      causation: { kind: 'run' as const, runId: 'run.root' },
      correlationId: null,
      idempotencyKey: null,
      payloadHash: HASH_A,
      previousEventHash: null,
      eventHash: HASH_B,
    };
    expect(
      PublicRunEventSchema.parse({
        ...envelope,
        payloadState: {
          state: 'available',
          payload: {
            type: 'child_run_delegated',
            childRunId: 'run.child',
            displayName: 'Continuity review',
            publicSummary: 'Checking selected shots for continuity.',
            directionHash: HASH_B,
            operationFingerprint: HASH_A,
          },
        },
      }).payloadState.state,
    ).toBe('available');
    expect(() =>
      PublicRunEventSchema.parse({
        ...envelope,
        payloadState: {
          state: 'available',
          payload: {
            type: 'child_run_delegated',
            childRunId: 'run.child',
            displayName: 'Continuity review',
            publicSummary: 'Checking selected shots for continuity.',
            operationFingerprint: HASH_A,
          },
        },
      }),
    ).toThrow();
    expect(() =>
      PublicRunEventSchema.parse({
        ...envelope,
        payloadState: {
          state: 'available',
          payload: {
            type: 'child_run_delegated',
            childRunId: 'run.child',
            displayName: 'Continuity review',
            publicSummary: 'Checking selected shots for continuity.',
            directionHash: 'not-a-sha256',
            operationFingerprint: HASH_A,
          },
        },
      }),
    ).toThrow();
    expect(() =>
      PublicRunEventSchema.parse({
        ...envelope,
        payloadState: {
          state: 'available',
          payload: {
            type: 'child_run_delegated',
            childRunId: 'run.child',
            displayName: 'Continuity review',
            publicSummary: 'Checking selected shots for continuity.',
            directionHash: HASH_B,
          },
        },
      }),
    ).toThrow();
    expect(() =>
      PublicRunEventSchema.parse({
        ...envelope,
        payloadState: {
          state: 'available',
          payload: {
            type: 'child_run_delegated',
            childRunId: 'run.child',
            displayName: 'Continuity review',
            publicSummary: 'Checking selected shots for continuity.',
            directionHash: HASH_B,
            operationFingerprint: 'not-a-sha256',
          },
        },
      }),
    ).toThrow();
    expect(
      PublicRunEventSchema.parse({
        ...envelope,
        payloadState: { state: 'redacted', erasedAt: NOW },
      }).payloadState.state,
    ).toBe('redacted');
    expect(() =>
      PublicRunEventSchema.parse({
        ...envelope,
        payloadState: {
          state: 'available',
          payload: {
            type: 'run_state_changed',
            previousState: 'running',
            state: 'recovering',
            runRevision: 3,
          },
        },
      }),
    ).not.toThrow();
    expect(() =>
      PublicRunEventSchema.parse({
        ...envelope,
        payload: { type: 'progress', summary: 'Old payload shape' },
      }),
    ).toThrow();
  });
});
