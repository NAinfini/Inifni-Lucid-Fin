import { rm } from 'node:fs/promises';
import {
  AgentSpawnDefinition,
  TaskManageDefinition,
  canonicalJson,
  generationPromptAssemblyHashInput,
  providerReceiptHashInput,
  type GenerationSpec,
  type Run,
} from '@lucid-fin/target-contracts';
import {
  openTargetStore,
  type GenerationProviderReconcileRequest,
  type GenerationProviderState,
  type GenerationProviderSubmitRequest,
  type TargetDataAccess,
  type TargetStore,
} from '@lucid-fin/target-storage';
import { createHostCatalogProvisioning } from '@lucid-fin/target-storage/host';
import { describe, expect, it } from 'vitest';
import {
  NOW,
  PROVIDER_ID,
  PROVIDER_MODEL,
  ROOT_CATALOG,
  FakeGenerationProvider,
  budget,
  callCounts,
  commanderContext,
  createJourneyDataAccess,
  createJourneyDependencies,
  createJourneyFixture,
  formatPolicy,
  hashCanonical,
  sha256,
  userContext,
  type JourneyDependencies,
} from './fixture.js';

const PRIVATE_OBJECTIVE = 'PRIVATE_RECOVERY_OBJECTIVE_SENTINEL';
const PRIVATE_PROVIDER_ERROR = 'PRIVATE_PROVIDER_ERROR_SENTINEL';

function bytes(value: string): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield Buffer.from(value);
  })();
}

function providerSuccess(mode: 'before_accept' | 'after_success'): GenerationProviderState {
  const output = Buffer.from(`recovered-generation-${mode}`);
  const withoutHash = {
    providerOperationId: `provider.operation.i2h.${mode}`,
    submittedAt: NOW,
    reconciledAt: null,
    receiptHash: '',
  };
  return {
    state: 'succeeded',
    receipt: {
      ...withoutHash,
      receiptHash: hashCanonical(providerReceiptHashInput(withoutHash)),
    },
    usage: {
      inputTokens: { state: 'known', value: 0 },
      outputTokens: { state: 'known', value: 0 },
      generatedUnits: { state: 'known', value: 1 },
      cost: { state: 'known', value: '2', currency: 'USD' },
    },
    outputs: [
      {
        variantIndex: 0,
        blob: {
          hash: sha256(output),
          byteLength: output.byteLength,
          mimeType: 'image/png',
          technicalFacts: { kind: 'image', width: 1_280, height: 720 },
          publication: { state: 'pending', bytes: bytes(output) },
        },
        technicalValidation: {
          state: 'valid',
          mimeTypeValid: true,
          dimensionsValid: true,
          durationValid: true,
          failureCode: null,
        },
      },
    ],
  };
}

interface RecoveryPlan {
  readonly mode: 'before_accept' | 'after_success';
  success: GenerationProviderState | null;
  initialSubmitLost: boolean;
  authoritativeNotSubmitted: boolean;
}

class RecoverableGenerationProvider extends FakeGenerationProvider {
  readonly plans = new Map<string, RecoveryPlan>();
  providerCreations = 0;

  override async submit(
    request: GenerationProviderSubmitRequest,
  ): Promise<GenerationProviderState> {
    this.submitCalls += 1;
    let plan = this.plans.get(request.idempotencyKey);
    if (plan === undefined) {
      plan = {
        mode: this.plans.size === 0 ? 'before_accept' : 'after_success',
        success: null,
        initialSubmitLost: false,
        authoritativeNotSubmitted: false,
      };
      this.plans.set(request.idempotencyKey, plan);
    }
    if (!plan.initialSubmitLost) {
      plan.initialSubmitLost = true;
      if (plan.mode === 'after_success') {
        plan.success = providerSuccess(plan.mode);
        this.providerCreations += 1;
      }
      throw new Error(`${PRIVATE_PROVIDER_ERROR}:${plan.mode}`);
    }
    if (plan.mode === 'before_accept' && plan.authoritativeNotSubmitted && plan.success === null) {
      plan.success = providerSuccess(plan.mode);
      this.providerCreations += 1;
      return plan.success;
    }
    throw new Error(`Generation ${plan.mode} was resubmitted unexpectedly`);
  }

  override async reconcileByIdempotencyKey(
    request: GenerationProviderReconcileRequest,
  ): Promise<GenerationProviderState> {
    this.reconcileCalls += 1;
    const plan = this.plans.get(request.idempotencyKey);
    if (plan === undefined) throw new Error('Unknown recovery idempotency key');
    if (plan.success !== null) return plan.success;
    plan.authoritativeNotSubmitted = true;
    return { state: 'not_submitted' };
  }
}

function productionRef(object: { id: string; revision: number; contentHash: string }) {
  return {
    authority: 'production' as const,
    id: object.id,
    revision: object.revision,
    contentHash: object.contentHash,
  };
}

function systemContext(runId: string) {
  return {
    actor: 'system' as const,
    causation: { kind: 'run' as const, runId },
    correlationId: 'correlation.i2h.recovery.system',
  };
}

function getRun(data: TargetDataAccess, runId: string, suffix: string): Run {
  return data.runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId: `request.i2h.recovery.run.${suffix}`,
    method: 'run.get',
    input: { runId },
  }).result;
}

function activate(data: TargetDataAccess, run: Run, suffix: string): Run {
  const inbox = data.runs.listInbox(run.id)[0]!;
  data.runs.transitionInbox(
    {
      runId: run.id,
      expectedRevision: run.revision,
      inboxMessageId: inbox.id,
      sequence: inbox.sequence,
      action: 'deliver',
      commandId: `command.i2h.recovery.${suffix}.deliver`,
    },
    systemContext(run.id),
  );
  const delivered = getRun(data, run.id, `${suffix}.delivered`);
  data.runs.startActivation(
    {
      runId: run.id,
      expectedRevision: delivered.revision,
      commandId: `command.i2h.recovery.${suffix}.activate`,
    },
    systemContext(run.id),
  );
  const running = getRun(data, run.id, `${suffix}.running`);
  expect(running.status).toBe('running');
  return running;
}

async function generationSubmission(
  data: TargetDataAccess,
  runId: string,
  target: { id: string; revision: number; contentHash: string },
  index: number,
) {
  const spec: GenerationSpec = {
    kind: 'image',
    task: 'create',
    target: productionRef(target),
    prompt: `Recovery candidate ${index} for the moonlit harbor.`,
    negativePrompt: null,
    references: [],
    provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL },
    outputCount: 1,
    seed: 100 + index,
    width: 1_280,
    height: 720,
    guidanceScale: null,
    sourceMaskRefId: null,
  };
  const quote = await data.generation.quote({ runId, request: { spec } });
  return {
    runId,
    commandId: `command.i2h.recovery.generation.${index}`,
    request: {
      spec,
      quote: quote.quote,
      expectedProjectRevision: 0,
      promptProvenance: {
        sourceObjectId: target.id,
        sourceRevision: target.revision,
        sourceHash: target.contentHash,
        assemblyHash: hashCanonical(
          generationPromptAssemblyHashInput({
            target: spec.target,
            prompt: spec.prompt,
            negativePrompt: spec.negativePrompt,
            references: spec.references,
            loadedSkillDigests: [],
          }),
        ),
        loadedSkillDigests: [],
      },
      outputIntents: [
        {
          variantIndex: 0,
          globalAsset: {
            filename: `recovery-candidate-${index}.png`,
            displayName: `Recovery candidate ${index}`,
            folderId: null,
            tags: ['recovery'],
          },
          projectMediaRef: {
            label: `Recovery candidate ${index}`,
            collections: ['Recovery'],
            roles: ['generated_candidate' as const],
            notes: '',
          },
        },
      ],
    },
  };
}

function publicState(
  data: TargetDataAccess,
  projectId: string,
  rootRunId: string,
  childRunId: string,
  operationRefs: readonly Parameters<
    TargetDataAccess['operations']['get']
  >[0]['input']['operations'][number][],
) {
  const operationViews = data.operations.get({
    wireVersion: 1,
    kind: 'request',
    requestId: 'request.i2h.recovery.operations',
    method: 'operation.get',
    input: { operations: [...operationRefs] },
  }).result.operations;
  const results = data.results.query(projectId, {
    resultIds: [],
    requestIds: [],
    targetRefs: [],
    include: ['artifact', 'prompt', 'references', 'provider', 'assessments'],
    page: { cursor: null, limit: 100 },
  });
  const globalMedia = data.globalMedia.listGlobal({
    wireVersion: 1,
    kind: 'request',
    requestId: 'request.i2h.recovery.global-media',
    method: 'media.global.list',
    input: { kinds: [], query: '', page: { cursor: null, limit: 100 } },
  }).result;
  const projectMedia = data.projectMedia.list({
    wireVersion: 1,
    kind: 'request',
    requestId: 'request.i2h.recovery.project-media',
    method: 'media.project.list',
    input: { projectId, roles: [], query: '', page: { cursor: null, limit: 100 } },
  }).result;
  const publicEvents = [rootRunId, childRunId].map(
    (runId) =>
      data.runs.listPublicEvents({
        wireVersion: 1,
        kind: 'request',
        requestId: `request.i2h.recovery.events.${runId}`,
        method: 'run.events.list',
        input: { runId, afterSequence: null, page: { cursor: null, limit: 100 } },
      }).result.items,
  );
  return {
    operationViews,
    results,
    globalMedia,
    projectMedia,
    publicEvents,
    rootReplay: data.runReplay.get(rootRunId),
    childReplay: data.runReplay.get(childRunId),
    taskList: data.taskLists.get(childRunId),
    history: data.history.query(projectId, {
      sources: [],
      eventTypes: [],
      subjects: [],
      actors: [],
      time: { from: null, to: null },
      page: { cursor: null, limit: 100 },
    }),
  };
}

describe('I2-H2 cold recovery composition journey', () => {
  it('recovers root before child and reconciles receiptless provider state without duplicate side effects', async () => {
    const generation = new RecoverableGenerationProvider();
    const dependencies: JourneyDependencies = { ...createJourneyDependencies(), generation };
    const fixture = await createJourneyFixture(dependencies);
    let activeStore: TargetStore = fixture.store;
    try {
      let data = fixture.data;
      const host = createHostCatalogProvisioning(activeStore, { now: () => NOW });
      host.registerProviderProfile({
        id: PROVIDER_ID,
        displayName: 'I2-H Recovery Provider',
        providerKind: generation.providerKind,
        model: PROVIDER_MODEL,
        status: 'ready',
      });
      const createdProject = data.projects.create(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i2h.recovery.project',
          method: 'project.create',
          input: {
            name: 'Recovery Harbor',
            permissionMode: 'reversible',
            budget,
            formatPolicy,
          },
        },
        userContext,
      );
      const project = createdProject.result.project;
      data.projects.updateSettings(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i2h.recovery.settings',
          method: 'project.settings.update',
          input: {
            projectId: project.id,
            expectedRevision: createdProject.result.settings.revision,
            expectedContentHash: createdProject.result.settings.contentHash,
            defaultProviderProfileId: PROVIDER_ID,
            formatPolicy,
            permission: 'reversible',
            budget,
            enabledSkills: [],
          },
        },
        userContext,
      );
      const story = data.production.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i2h.recovery.story',
          method: 'production.apply',
          input: {
            action: 'create',
            projectId: project.id,
            expectedProjectRevision: project.revision,
            value: {
              objectType: 'story',
              content: {
                title: 'Recovery at Midnight',
                premise: 'A harbor run survives a process restart.',
                synopsis: 'The root and child recover without duplicating provider work.',
              },
            },
            relations: [],
          },
        },
        userContext,
      ).result.object;
      const chat = data.conversations.createChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i2h.recovery.chat',
          method: 'chat.create',
          input: { projectId: project.id, title: 'Recovery' },
        },
        userContext,
      ).result;
      const accepted = data.conversations.sendMessage(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i2h.recovery.message',
          method: 'message.send',
          input: {
            chatId: chat.id,
            blocks: [{ type: 'text', text: 'Recover this film run exactly once.' }],
            attachments: [],
            selectedContext: [{ ref: productionRef(story), role: 'target' }],
            exportDestinationGrant: null,
            supersedesMessageId: null,
          },
        },
        userContext,
        {
          model: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
          locale: 'en-US',
          timeZone: 'America/New_York',
          capabilityCatalog: ROOT_CATALOG,
          projectMediaSelections: [],
          citedMemoryEntryIds: [],
        },
      ).result.acceptedRun;

      let root = activate(data, accepted, 'root');
      const spawnInput = AgentSpawnDefinition.parseInput({
        displayName: 'Recovery child',
        objective: PRIVATE_OBJECTIVE,
        publicSummary: 'Recovering one bounded generation branch.',
        contextRefs: [{ ref: productionRef(story), role: 'target' }],
        toolAllowlist: null,
        permissionCeiling: null,
        budgetCaps: null,
        expectedParentRevision: root.revision,
      });
      const spawnRequest = {
        parentRunId: root.id,
        expectedParentRevision: root.revision,
        commandId: 'command.i2h.recovery.spawn',
        spawnInput,
      };
      const spawned = data.runs.spawnChild(spawnRequest, systemContext(root.id));
      root = getRun(data, root.id, 'root.after-spawn');
      const child = activate(
        data,
        getRun(data, spawned.child.childRunId, 'child.accepted'),
        'child',
      );

      const taskCreated = data.taskLists.manage(
        child.id,
        TaskManageDefinition.parseInput({
          action: 'create',
          expectedRunRevision: child.revision,
          title: 'Recovery work',
          tasks: [
            {
              draftId: 'draft.recovery',
              title: 'Wait for recovery',
              parentDraftId: null,
              order: 0,
            },
          ],
          publicSummary: 'Created the recovery task list.',
        }),
        { commandId: 'command.i2h.recovery.tasks.create', context: systemContext(child.id) },
      );
      const blockedTasks = data.taskLists.manage(
        child.id,
        TaskManageDefinition.parseInput({
          action: 'update',
          expectedRevision: taskCreated.taskList!.revision,
          taskId: taskCreated.taskList!.items[0]!.id,
          title: null,
          state: 'blocked',
          resultSummary: null,
          childRunId: null,
          publicSummary: 'Marked the optional recovery task blocked.',
        }),
        { commandId: 'command.i2h.recovery.tasks.block', context: systemContext(child.id) },
      );
      expect(blockedTasks.taskList!.items[0]!.state).toBe('blocked');

      const rootBeforeCompaction = data.runReplay.get(root.id);
      const sourceEventFrom = 1;
      const sourceEventTo = rootBeforeCompaction.journal.at(-1)!.sequence;
      const compactionStartInput = {
        runId: root.id,
        expectedRevision: rootBeforeCompaction.run.revision,
        expectedRunHash: rootBeforeCompaction.run.contentHash,
        transactionId: 'compaction.i2h.recovery',
        activationNumber: 1,
        sourceEventFrom,
        sourceEventTo,
        originalTokenCount: 4_000,
        model: rootBeforeCompaction.run.model.model,
      };
      data.compactions.start(compactionStartInput, systemContext(root.id));
      root = getRun(data, root.id, 'root.compaction-started');
      const compactionDeriveInput = {
        runId: root.id,
        expectedRevision: root.revision,
        expectedRunHash: root.contentHash,
        transactionId: compactionStartInput.transactionId,
        viewId: 'compaction.view.i2h.recovery',
        sourceEventFrom,
        sourceEventTo,
        summary: 'Retain the active recovery branch and its exact provider state.',
        citedEventSequences: [sourceEventFrom, sourceEventTo],
        compactedTokenCount: 240,
      };
      data.compactions.deriveView(compactionDeriveInput, systemContext(root.id));

      const submissions = await Promise.all([
        generationSubmission(data, child.id, story, 1),
        generationSubmission(data, child.id, story, 2),
      ]);
      const unknown = [];
      for (const submission of submissions) {
        const result = await data.generation.submit(submission, commanderContext(child.id));
        expect(result.state).toBe('unknown');
        unknown.push(result);
        expect(await data.generation.submit(submission, commanderContext(child.id))).toEqual(
          result,
        );
      }
      expect(generation).toMatchObject({
        submitCalls: 2,
        reconcileCalls: 0,
        providerCreations: 1,
      });
      expect(dependencies.mediaCas.putCalls).toBe(0);

      const beforeRecovery = {
        root: data.runReplay.get(root.id),
        child: data.runReplay.get(child.id),
        calls: callCounts(dependencies),
      };
      activeStore.close();
      activeStore = await openTargetStore(fixture.databasePath);
      data = createJourneyDataAccess(activeStore, dependencies, fixture.createId);
      expect(data.runReplay.get(root.id)).toEqual(beforeRecovery.root);
      expect(data.runReplay.get(child.id)).toEqual(beforeRecovery.child);
      expect(data.runReplay.listRecoveryCandidates(project.id).map(({ id }) => id)).toEqual([
        root.id,
        child.id,
      ]);

      const rootAtRecovery = getRun(data, root.id, 'root.recovery');
      const interruptInput = {
        runId: root.id,
        expectedRevision: rootAtRecovery.revision,
        expectedRunHash: rootAtRecovery.contentHash,
        transactionId: compactionStartInput.transactionId,
      };
      const interrupted = data.compactions.interruptAfterRestart(
        interruptInput,
        systemContext(root.id),
      );
      expect(interrupted).toMatchObject({
        transaction: { state: 'interrupted' },
        view: { id: compactionDeriveInput.viewId },
      });

      const recovered = [];
      for (const [index, result] of unknown.entries()) {
        recovered.push(
          await data.generation.reconcile(
            {
              operation: result.operation,
              expectedRevision: result.operation.revision,
              commandId: `command.i2h.recovery.reconcile.${index}`,
            },
            commanderContext(child.id),
          ),
        );
      }
      expect(recovered.map(({ state }) => state)).toEqual(['succeeded', 'succeeded']);
      expect(generation).toMatchObject({
        submitCalls: 3,
        reconcileCalls: 2,
        providerCreations: 2,
      });
      expect(dependencies.mediaCas.putCalls).toBe(2);

      const operationRefs = unknown.map(({ operation }) => operation);
      const settled = publicState(data, project.id, root.id, child.id, operationRefs);
      expect(settled).toMatchObject({
        operationViews: [{ state: 'succeeded' }, { state: 'succeeded' }],
        results: { items: [{}, {}] },
        globalMedia: { items: [{}, {}] },
        projectMedia: { items: [{}, {}] },
        rootReplay: {
          run: { privateRecoveryHead: null },
          compactionTransactions: [{ state: 'interrupted' }],
          compactionViews: [{ id: compactionDeriveInput.viewId }],
          providerContinuation: { state: 'unavailable' },
        },
        childReplay: {
          run: { privateRecoveryHead: { sequence: 1, hash: expect.any(String) } },
          providerContinuation: { state: 'unavailable' },
        },
        taskList: { items: [{ state: 'blocked' }] },
      });
      const rootJournalTypes = settled.rootReplay.journal.flatMap((event) =>
        event.payloadState.state === 'available' ? [event.payloadState.payload.type] : [],
      );
      expect(rootJournalTypes).toEqual(
        expect.arrayContaining([
          'compaction_started',
          'compaction_view_derived',
          'compaction_interrupted',
        ]),
      );
      expect(
        settled.publicEvents
          .flat()
          .flatMap((event) =>
            event.payloadState.state === 'available' ? [event.payloadState.payload.type] : [],
          ),
      ).not.toEqual(
        expect.arrayContaining(rootJournalTypes.filter((type) => type.startsWith('compaction_'))),
      );
      for (const replay of [settled.rootReplay, settled.childReplay]) {
        expect(replay.journal.map(({ sequence }) => sequence)).toEqual(
          replay.journal.map((_, index) => index + 1),
        );
        expect(new Set(replay.journal.map(({ eventId }) => eventId)).size).toBe(
          replay.journal.length,
        );
      }
      const serializedPublicState = canonicalJson(settled);
      expect(serializedPublicState).not.toContain(PRIVATE_OBJECTIVE);
      expect(serializedPublicState).not.toContain(PRIVATE_PROVIDER_ERROR);

      const settledCalls = callCounts(dependencies);
      expect(settledCalls).toMatchObject({
        cas: { puts: 2, objects: 2 },
        generation: { quote: 4, submit: 3, reconcile: 2 },
      });
      activeStore.close();
      activeStore = await openTargetStore(fixture.databasePath);
      data = createJourneyDataAccess(activeStore, dependencies, fixture.createId);
      expect(
        data.compactions.interruptAfterRestart(interruptInput, systemContext(root.id)),
      ).toEqual(interrupted);
      for (const submission of submissions) {
        expect((await data.generation.submit(submission, commanderContext(child.id))).state).toBe(
          'succeeded',
        );
      }
      expect(data.runs.spawnChild(spawnRequest, systemContext(root.id))).toEqual(spawned);
      expect(callCounts(dependencies)).toEqual(settledCalls);
      expect(canonicalJson(publicState(data, project.id, root.id, child.id, operationRefs))).toBe(
        canonicalJson(settled),
      );
      expect(data.runReplay.listRecoveryCandidates(project.id).map(({ id }) => id)).toEqual([
        root.id,
        child.id,
      ]);
    } finally {
      activeStore.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);
});
