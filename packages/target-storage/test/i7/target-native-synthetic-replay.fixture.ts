import {
  AgentSpawnDefinition,
  CanonicalModelRequestV1Schema,
  EXACT_TOOL_IDS,
  type CanonicalModelRequestV1,
} from '@lucid-fin/target-contracts';
import {
  openTargetStore,
  type HarnessActivationSnapshot,
  type TargetDataAccess,
  type TargetStore,
} from '@lucid-fin/target-storage';
import { createHostCatalogProvisioning } from '@lucid-fin/target-storage/host';
import { expect } from 'vitest';
import {
  NOW,
  PROVIDER_ID,
  PROVIDER_MODEL,
  ROOT_CATALOG,
  budget,
  commanderContext,
  createJourneyDataAccess,
  deterministicIds,
  formatPolicy,
  userContext,
  type JourneyDependencies,
} from '../i2h/fixture.js';

const MODEL_QUOTE = {
  inputTokens: { state: 'known' as const, value: 120 },
  outputTokens: { state: 'known' as const, value: 24 },
  cost: { state: 'known' as const, value: '0.5', currency: 'USD' },
};

export interface TargetNativeSyntheticReplayFixture {
  readonly databasePath: string;
  readonly store: TargetStore;
  readonly dependencies: JourneyDependencies;
  readonly createId: ReturnType<typeof deterministicIds>;
}

export interface TargetNativeSyntheticReplayResult {
  readonly nativeProjectId: string;
  readonly rootRunId: string;
  readonly childRunId: string;
  readonly retryRunId: string;
}

function getRun(data: TargetDataAccess, runId: string, suffix: string) {
  return data.runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId: `request.i7.target-native.run.${suffix}`,
    method: 'run.get',
    input: { runId },
  }).result;
}

function acceptanceSeed() {
  return {
    model: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
    locale: 'en-US',
    timeZone: 'UTC',
    capabilityCatalog: ROOT_CATALOG,
    projectMediaSelections: [],
    citedMemoryEntryIds: [],
  };
}

function requestFor(
  snapshot: HarnessActivationSnapshot,
  modelAttemptId: string,
  materializedToolIds: readonly string[],
): CanonicalModelRequestV1 {
  return CanonicalModelRequestV1Schema.parse({
    version: 1,
    runId: snapshot.run.id,
    modelAttemptId,
    activationId: snapshot.activationId,
    activationNumber: snapshot.activation.activationNumber,
    attemptNumber: snapshot.modelAttempts.length + 1,
    provider: snapshot.run.model,
    contextManifest: { id: snapshot.manifest.id, hash: snapshot.run.contextManifestHash },
    capabilityCatalog: {
      id: snapshot.run.capabilityCatalogSnapshotId,
      hash: snapshot.run.capabilityCatalogHash,
    },
    runRevision: snapshot.run.revision,
    runContentHash: snapshot.run.contentHash,
    eventHead: snapshot.run.publicEventHead,
    compactionView:
      snapshot.compactionView === null
        ? null
        : {
            id: snapshot.compactionView.id,
            hash: snapshot.compactionView.derivedViewHash,
            summary: snapshot.compactionView.summary,
          },
    facts: snapshot.facts,
    capabilityIndex: snapshot.catalog.capabilityIndex,
    skillIndex: snapshot.catalog.skills.map(
      ({ skillId, name, description, version, contentHash, provenance, trust }) => ({
        id: skillId,
        name,
        description,
        version,
        contentHash,
        provenance,
        trust,
      }),
    ),
    materializedTools: materializedToolIds.map((id) =>
      snapshot.catalog.tools.find(({ id: toolId }) => toolId === id),
    ),
    locale: snapshot.manifest.locale,
    timeZone: snapshot.manifest.timeZone,
    limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
    reasoningStrength: snapshot.run.model.reasoningStrength,
    systemPromptVersion: 'commander-minimal-v1',
  });
}

function deliverConsume(
  data: TargetDataAccess,
  runId: string,
  inbox: { readonly id: string; readonly sequence: number },
  suffix: string,
  endAtSafeBoundary: boolean,
) {
  const context = commanderContext(runId);
  const accepted = getRun(data, runId, `${suffix}.accepted`);
  data.runs.transitionInbox(
    {
      runId,
      expectedRevision: accepted.revision,
      inboxMessageId: inbox.id,
      sequence: inbox.sequence,
      action: 'deliver',
      commandId: `command.i7.target-native.${suffix}.deliver`,
    },
    context,
  );
  const delivered = getRun(data, runId, `${suffix}.delivered`);
  const activation = data.runs.startActivation(
    {
      runId,
      expectedRevision: delivered.revision,
      commandId: `command.i7.target-native.${suffix}.activate`,
    },
    context,
  );
  const running = getRun(data, runId, `${suffix}.running`);
  data.harness.consumeInbox(
    {
      runId,
      expectedRevision: running.revision,
      inboxMessageId: inbox.id,
      sequence: inbox.sequence,
      commandId: `command.i7.target-native.${suffix}.consume`,
    },
    context,
  );
  if (endAtSafeBoundary) {
    const consumed = getRun(data, runId, `${suffix}.consumed`);
    data.runs.endActivation(
      {
        runId,
        expectedRevision: consumed.revision,
        activationNumber: activation.activationNumber,
        reason: 'safe_boundary',
        commandId: `command.i7.target-native.${suffix}.end`,
      },
      context,
    );
  }
  return activation;
}

function stepForPreparedAttempt(
  prepared: Exclude<
    ReturnType<TargetDataAccess['harness']['prepareModelBoundary']>,
    { readonly kind: 'yielded' }
  >,
) {
  const step = prepared.commit.events.flatMap((event) => {
    if (event.payloadState.state !== 'available') return [];
    const payload = event.payloadState.payload;
    return payload.type === 'step_started' && payload.kind === 'model'
      ? [{ turnNumber: payload.turnNumber, stepNumber: payload.stepNumber }]
      : [];
  });
  if (step.length !== 1) throw new Error('Expected one prepared target-native model step');
  return step[0]!;
}

function recoveryInput(snapshot: HarnessActivationSnapshot, commandId: string) {
  if (snapshot.run.publicEventHead === null) {
    throw new Error('Expected a public event head before target-native recovery');
  }
  return {
    runId: snapshot.run.id,
    activationNumber: snapshot.activation.activationNumber,
    expectedRunRevision: snapshot.run.revision,
    expectedRunContentHash: snapshot.run.contentHash,
    expectedPublicEventHead: snapshot.run.publicEventHead,
    commandId,
  };
}

export async function runTargetNativeSyntheticReplay(
  fixture: TargetNativeSyntheticReplayFixture,
): Promise<TargetNativeSyntheticReplayResult> {
  let store: TargetStore = fixture.store;
  try {
    let data = createJourneyDataAccess(store, fixture.dependencies, fixture.createId);
    createHostCatalogProvisioning(store, { now: () => NOW }).registerProviderProfile({
      id: PROVIDER_ID,
      displayName: 'I7 synthetic provider',
      providerKind: fixture.dependencies.generation.providerKind,
      model: PROVIDER_MODEL,
      status: 'ready',
    });
    const created = data.projects.create(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i7.target-native.project.create',
        method: 'project.create',
        input: {
          name: 'I7 Target-native replay',
          permissionMode: 'reversible',
          budget,
          formatPolicy,
        },
      },
      userContext,
    ).result;
    data.projects.updateSettings(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i7.target-native.project.settings',
        method: 'project.settings.update',
        input: {
          projectId: created.project.id,
          expectedRevision: created.settings.revision,
          expectedContentHash: created.settings.contentHash,
          defaultProviderProfileId: PROVIDER_ID,
          formatPolicy,
          permission: 'reversible',
          budget,
          enabledSkills: [],
        },
      },
      userContext,
    );
    const chat = data.conversations.createChat(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i7.target-native.chat.create',
        method: 'chat.create',
        input: { projectId: created.project.id, title: 'I7 target-native replay' },
      },
      userContext,
    ).result;
    const root = data.conversations.sendMessage(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i7.target-native.message.send',
        method: 'message.send',
        input: {
          chatId: chat.id,
          blocks: [{ type: 'text', text: 'Run the target-native replay fixture.' }],
          attachments: [],
          selectedContext: [
            {
              ref: {
                authority: 'project',
                id: created.project.id,
                revision: created.project.revision,
                contentHash: created.project.contentHash,
              },
              role: 'target',
            },
          ],
          exportDestinationGrant: null,
          supersedesMessageId: null,
        },
      },
      userContext,
      acceptanceSeed(),
    ).result.acceptedRun;

    const firstFollowup = data.runs.sendFollowup(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i7.target-native.followup.one',
        method: 'run.sendFollowup',
        input: {
          runId: root.id,
          expectedRevision: getRun(data, root.id, 'followup.one').revision,
          text: 'First target-native follow-up.',
          selectedContext: [],
          exportDestinationGrant: null,
        },
      },
      userContext,
      acceptanceSeed(),
    ).result;
    const secondFollowup = data.runs.sendFollowup(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i7.target-native.followup.two',
        method: 'run.sendFollowup',
        input: {
          runId: root.id,
          expectedRevision: getRun(data, root.id, 'followup.two').revision,
          text: 'Second target-native follow-up.',
          selectedContext: [],
          exportDestinationGrant: null,
        },
      },
      userContext,
      acceptanceSeed(),
    ).result;
    const initialInbox = data.runs.listInbox(root.id)[0]!;
    expect(data.runs.listInbox(root.id).map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
    expect(() =>
      data.runs.transitionInbox(
        {
          runId: root.id,
          expectedRevision: getRun(data, root.id, 'fifo.reject').revision,
          inboxMessageId: firstFollowup.id,
          sequence: firstFollowup.sequence,
          action: 'deliver',
          commandId: 'command.i7.target-native.fifo.reject',
        },
        commanderContext(root.id),
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

    deliverConsume(data, root.id, initialInbox, 'root.first', true);
    deliverConsume(data, root.id, firstFollowup, 'root.second', true);
    const thirdActivation = deliverConsume(data, root.id, secondFollowup, 'root.third', false);
    expect(data.runs.listActivations(root.id)).toMatchObject([
      { activationNumber: 1, state: 'ended', triggerInboxSequence: 1 },
      { activationNumber: 2, state: 'ended', triggerInboxSequence: 2 },
      { activationNumber: 3, state: 'active', triggerInboxSequence: 3 },
    ]);

    const rootSnapshot = data.harness.loadActivation(root.id, thirdActivation.activationNumber);
    expect(rootSnapshot.catalog.tools.map(({ id }) => id)).toEqual(EXACT_TOOL_IDS);
    expect(rootSnapshot.catalog.tools).toHaveLength(40);
    expect(rootSnapshot.manifest.capabilityIndex).toHaveLength(40);

    const spawnInput = AgentSpawnDefinition.parseInput({
      displayName: 'Synthetic child',
      objective: 'Verify one target-native child run.',
      publicSummary: 'Verifying target-native child lineage.',
      contextRefs: [],
      toolAllowlist: null,
      permissionCeiling: null,
      budgetCaps: null,
      expectedParentRevision: rootSnapshot.run.revision,
    });
    const preparedSpawn = data.harness.prepareModelBoundary(
      {
        request: requestFor(rootSnapshot, 'model-attempt.i7.target-native.spawn', [
          AgentSpawnDefinition.id,
        ]),
        quote: MODEL_QUOTE,
        commandId: 'command.i7.target-native.spawn.prepare',
      },
      commanderContext(root.id),
    );
    if (preparedSpawn.kind !== 'prepared') {
      throw new Error('Expected a target-native spawn Model Attempt');
    }
    data.harness.markModelAttemptRunning(
      {
        attemptId: preparedSpawn.commit.value.id,
        requestHash: preparedSpawn.commit.value.requestHash,
        commandId: 'command.i7.target-native.spawn.running',
      },
      commanderContext(root.id),
    );
    const spawnStep = stepForPreparedAttempt(preparedSpawn);
    const spawnCallId = 'provider-call.i7.target-native.spawn';
    const spawned = data.harness.settleAgentSpawnBoundary(
      {
        attemptId: preparedSpawn.commit.value.id,
        requestHash: preparedSpawn.commit.value.requestHash,
        response: {
          version: 1,
          events: [
            {
              type: 'tool_call',
              providerCallId: spawnCallId,
              toolId: AgentSpawnDefinition.id,
              canonicalArguments: spawnInput,
            },
            { type: 'usage', usage: MODEL_QUOTE },
            { type: 'model_completed', finishReason: 'tool_calls' },
          ],
        },
        providerCallId: spawnCallId,
        activationNumber: thirdActivation.activationNumber,
        turnNumber: spawnStep.turnNumber,
        stepNumber: spawnStep.stepNumber,
        settledAt: NOW,
      },
      commanderContext(root.id),
    ).value;
    const child = getRun(data, spawned.child.child.childRunId, 'child.accepted');
    expect(child).toMatchObject({
      parentRunId: root.id,
      acceptedSource: { kind: 'parent_direction', parentRunId: root.id },
      status: 'accepted',
    });
    const childInbox = data.runs.listInbox(child.id)[0]!;
    deliverConsume(data, child.id, childInbox, 'child.first', true);

    const beforeCompaction = getRun(data, root.id, 'compaction.before');
    const sourceEventTo = data.runReplay.get(root.id).journal.at(-1)!.sequence;
    const citations = sourceEventTo === 1 ? [1] : [1, sourceEventTo];
    const compactionStart = data.compactions.start(
      {
        runId: root.id,
        expectedRevision: beforeCompaction.revision,
        expectedRunHash: beforeCompaction.contentHash,
        transactionId: 'compaction.i7.target-native',
        activationNumber: thirdActivation.activationNumber,
        sourceEventFrom: 1,
        sourceEventTo,
        originalTokenCount: 4_000,
        model: PROVIDER_MODEL,
      },
      commanderContext(root.id),
    );
    const afterStart = getRun(data, root.id, 'compaction.started');
    const compactionView = data.compactions.deriveView(
      {
        runId: root.id,
        expectedRevision: afterStart.revision,
        expectedRunHash: afterStart.contentHash,
        transactionId: compactionStart.transaction.id,
        viewId: 'compaction-view.i7.target-native',
        sourceEventFrom: 1,
        sourceEventTo,
        summary: 'Retain the target-native root, child, and queued follow-up evidence.',
        citedEventSequences: citations,
        compactedTokenCount: 240,
      },
      commanderContext(root.id),
    );
    const afterView = getRun(data, root.id, 'compaction.view');
    const completed = data.compactions.complete(
      {
        runId: root.id,
        expectedRevision: afterView.revision,
        expectedRunHash: afterView.contentHash,
        transactionId: compactionStart.transaction.id,
        viewId: compactionView.view!.id,
        derivedViewHash: compactionView.view!.derivedViewHash,
      },
      commanderContext(root.id),
    );
    expect(completed.transaction).toMatchObject({ state: 'completed' });
    expect(completed.view).toMatchObject({ id: 'compaction-view.i7.target-native' });

    const retrySnapshot = data.harness.loadActivation(root.id, thirdActivation.activationNumber);
    const preparedRetry = data.harness.prepareModelBoundary(
      {
        request: requestFor(retrySnapshot, 'model-attempt.i7.target-native.retry', []),
        quote: MODEL_QUOTE,
        commandId: 'command.i7.target-native.retry.prepare',
      },
      commanderContext(root.id),
    );
    if (preparedRetry.kind !== 'prepared') {
      throw new Error('Expected a target-native retry Model Attempt');
    }
    const closed = data.harness.closeInterruptedActivation(
      recoveryInput(
        data.harness.loadActivation(root.id, thirdActivation.activationNumber),
        'command.i7.target-native.retry.close',
      ),
      commanderContext(root.id),
    );
    if (closed.run.publicEventHead === null) {
      throw new Error('Expected the closed target-native root event head');
    }
    const retry = data.harness.acceptCrashRetryRun(
      {
        sourceRunId: closed.run.id,
        expectedSourceRevision: closed.run.revision,
        expectedSourceContentHash: closed.run.contentHash,
        expectedSourceEventHead: closed.run.publicEventHead,
        commandId: 'command.i7.target-native.retry.accept',
      },
      commanderContext(root.id),
    );
    expect(retry).toMatchObject({
      created: true,
      retryRun: { retryOfRunId: root.id, status: 'accepted' },
      inbox: { sequence: 1, state: 'queued' },
    });
    expect(retry.catalog.tools.map(({ id }) => id)).toEqual(EXACT_TOOL_IDS);

    const beforeReopen = {
      child: data.runReplay.get(child.id),
      retry: data.runReplay.get(retry.retryRun.id),
      root: data.runReplay.get(root.id),
    };
    store.close();
    store = await openTargetStore(fixture.databasePath);
    data = createJourneyDataAccess(store, fixture.dependencies, fixture.createId);
    expect(data.runReplay.get(root.id)).toEqual(beforeReopen.root);
    expect(data.runReplay.get(child.id)).toEqual(beforeReopen.child);
    expect(data.runReplay.get(retry.retryRun.id)).toEqual(beforeReopen.retry);
    expect(data.runReplay.get(root.id)).toMatchObject({
      compactionTransactions: [{ state: 'completed' }],
      compactionViews: [{ id: 'compaction-view.i7.target-native' }],
      run: { status: 'blocked' },
    });
    expect(data.runs.listActivations(root.id)).toMatchObject([
      { activationNumber: 1, state: 'ended' },
      { activationNumber: 2, state: 'ended' },
      { activationNumber: 3, state: 'ended', endReason: 'process_exit' },
    ]);
    expect(getRun(data, retry.retryRun.id, 'retry.reopened')).toMatchObject({
      retryOfRunId: root.id,
      status: 'accepted',
    });
    return {
      nativeProjectId: created.project.id,
      rootRunId: root.id,
      childRunId: child.id,
      retryRunId: retry.retryRun.id,
    };
  } finally {
    store.close();
  }
}
