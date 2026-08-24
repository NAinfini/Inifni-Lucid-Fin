import { rm } from 'node:fs/promises';
import {
  AgentCancelDefinition,
  AgentResultDefinition,
  AgentSendDefinition,
  AgentSpawnDefinition,
  AgentWaitDefinition,
  CanonicalModelRequestV1Schema,
  CanvasMutateDefinition,
  DecisionProtectDefinition,
  DecisionRecordDefinition,
  DeliveryMutateDefinition,
  GenerationQuoteDefinition,
  HistoryQueryDefinition,
  OperationGetDefinition,
  ProjectGetDefinition,
  ProjectSearchDefinition,
  ProductionMutateDefinition,
  RunInspectDefinition,
  TaskManageDefinition,
  ToolProgramDefinition,
  canonicalJson,
  canonicalModelRequestHashInput,
  generationPromptAssemblyHashInput,
  type CanonicalModelRequestV1,
  type CanonicalModelResponseV1,
  type GenerationSpec,
} from '@lucid-fin/target-contracts';
import { createAes256GcmPrivateRecoveryCodec, openTargetStore } from '@lucid-fin/target-storage';
import { createHostCatalogProvisioning } from '@lucid-fin/target-storage/host';
import { describe, expect, it } from 'vitest';
import {
  NOW,
  IMPORT_TOKEN,
  PROVIDER_ID,
  PROVIDER_MODEL,
  ROOT_CATALOG,
  FakeGenerationProvider,
  budget,
  commanderContext,
  createJourneyDataAccess,
  createJourneyDependencies,
  createJourneyFixture,
  createJourneyPrivateRecoveryCodec,
  formatPolicy,
  getJourneyTestDatabase,
  hashCanonical,
  userContext,
  type JourneyDependencies,
} from '../../test/i2h/fixture.js';
import {
  isRuntimeReadTool,
  isRecoverySafeRuntimeReadTool,
  type HarnessActivationSnapshot,
  type TargetDataAccess,
  type TargetStore,
} from '../kernel/index.js';
import { loadModelAttemptRecord } from '../internal/model-attempt-records.js';
import {
  findOperationByFingerprint,
  loadOperationDispatch,
  resolveOperationDispatchKey,
} from '../internal/operation-dispatch.js';
import { loadRunResourceEntries } from '../internal/run-resource-ledger.js';
import { hashUtf8 } from '../internal/hashes.js';

function getRun(data: TargetDataAccess, runId: string, suffix: string) {
  return data.runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId: `request.i3.run.${suffix}`,
    method: 'run.get',
    input: { runId },
  }).result;
}

async function activeHarnessFixture(
  mediaUse: 'attachment' | 'project_media' | null = null,
  dependencies?: JourneyDependencies,
) {
  const fixture = await createJourneyFixture(dependencies);
  const host = createHostCatalogProvisioning(fixture.store, { now: () => NOW });
  host.registerProviderProfile({
    id: PROVIDER_ID,
    displayName: 'I3 Fake Model',
    providerKind: fixture.dependencies.generation.providerKind,
    model: PROVIDER_MODEL,
    status: 'ready',
  });
  const created = fixture.data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.i3.project.create',
      method: 'project.create',
      input: {
        name: 'I3 runtime fixture',
        permissionMode: 'reversible',
        budget,
        formatPolicy,
      },
    },
    userContext,
  ).result;
  fixture.data.projects.updateSettings(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.i3.settings.update',
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
  const media =
    mediaUse === null
      ? null
      : await (async () => {
          const asset = (
            await fixture.data.globalMedia.importGlobal(
              {
                wireVersion: 1,
                kind: 'request',
                requestId: 'request.i3.media.import',
                method: 'media.global.import',
                input: {
                  capabilityToken: IMPORT_TOKEN,
                  displayName: 'I3 recovery reference',
                  tags: ['recovery'],
                },
              },
              userContext,
            )
          ).result.asset;
          const ref = fixture.data.projectMedia.attach(
            {
              wireVersion: 1,
              kind: 'request',
              requestId: 'request.i3.media.attach',
              method: 'media.project.attach',
              input: {
                projectId: created.project.id,
                expectedProjectRevision: created.project.revision,
                globalAssetId: asset.id,
                expectedExistingRef: null,
                label: 'I3 recovery reference',
                collections: [],
                roles: ['reference'],
                notes: '',
              },
            },
            userContext,
          ).result.object;
          return {
            ref,
            snapshot: {
              projectMediaRefId: ref.id,
              globalAssetId: asset.id,
              blobHash: asset.blobHash,
              role: mediaUse === 'attachment' ? ('attachment' as const) : ('reference' as const),
            },
          };
        })();
  const chat = fixture.data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.i3.chat.create',
      method: 'chat.create',
      input: { projectId: created.project.id, title: 'Runtime loop' },
    },
    userContext,
  ).result;
  const run = fixture.data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.i3.message.send',
      method: 'message.send',
      input: {
        chatId: chat.id,
        blocks: [{ type: 'text', text: 'Inspect the current Project.' }],
        attachments: mediaUse === 'attachment' ? [media!.snapshot] : [],
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
        supersedesMessageId: null,
      },
    },
    userContext,
    {
      model: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      locale: 'en-US',
      timeZone: 'UTC',
      capabilityCatalog: ROOT_CATALOG,
      projectMediaSelections:
        mediaUse === 'project_media'
          ? [{ projectMediaRefId: media!.ref.id, role: 'reference' }]
          : [],
      citedMemoryEntryIds: [],
    },
  ).result.acceptedRun;
  const context = commanderContext(run.id);
  const inbox = fixture.data.runs.listInbox(run.id)[0]!;
  fixture.data.runs.transitionInbox(
    {
      runId: run.id,
      expectedRevision: run.revision,
      inboxMessageId: inbox.id,
      sequence: inbox.sequence,
      action: 'deliver',
      commandId: 'command.i3.inbox.deliver',
    },
    context,
  );
  const delivered = getRun(fixture.data, run.id, 'delivered');
  fixture.data.runs.startActivation(
    {
      runId: run.id,
      expectedRevision: delivered.revision,
      commandId: 'command.i3.activation.start',
    },
    context,
  );
  const running = getRun(fixture.data, run.id, 'running');
  fixture.data.harness.consumeInbox(
    {
      runId: run.id,
      expectedRevision: running.revision,
      inboxMessageId: inbox.id,
      sequence: inbox.sequence,
      commandId: 'command.i3.inbox.consume',
    },
    context,
  );
  return { fixture, context, media, project: created.project, runId: run.id };
}

async function generatedDecisionCandidate(
  data: TargetDataAccess,
  projectId: string,
  runId: string,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
) {
  const project = data.projects.get({
    wireVersion: 1,
    kind: 'request',
    requestId: `request.i3.decision-candidate.project.${runId}`,
    method: 'project.get',
    input: { projectId },
  }).result;
  const target = data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: `request.i3.decision-candidate.shot.${runId}`,
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: project.id,
        expectedProjectRevision: project.revision,
        value: {
          objectType: 'shot',
          content: {
            title: 'Decision candidate target',
            description: 'A moonlit harbor for a model decision.',
            durationMs: null,
            shotSize: null,
            cameraMovement: null,
          },
        },
        relations: [],
      },
    },
    userContext,
  ).result.object;
  if (target.type !== 'shot') throw new Error('Expected a Shot decision target');
  const spec: GenerationSpec = {
    kind: 'video',
    task: 'create',
    target: {
      authority: 'production',
      id: target.id,
      revision: target.revision,
      contentHash: target.contentHash,
    },
    prompt: 'A cinematic moonlit harbor tracking shot.',
    negativePrompt: null,
    references: [],
    provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL },
    outputCount: 2,
    seed: 7,
    width: 1_920,
    height: 1_080,
    durationMs: 8_000,
    frameRate: 24,
    includeAudio: true,
  };
  const quote = await data.generation.quote({ runId, request: { spec } });
  const currentProject = data.projects.get({
    wireVersion: 1,
    kind: 'request',
    requestId: `request.i3.decision-candidate.project-current.${runId}`,
    method: 'project.get',
    input: { projectId },
  }).result;
  const submitted = await data.generation.submit(
    {
      runId,
      commandId: `command.i3.decision-candidate.generation.${runId}`,
      request: {
        spec,
        quote: quote.quote,
        expectedProjectRevision: currentProject.revision,
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
        outputIntents: [0, 1].map((variantIndex) => ({
          variantIndex,
          globalAsset: {
            filename: `decision-candidate-${variantIndex}.mp4`,
            displayName: `Decision candidate ${variantIndex}`,
            folderId: null,
            tags: ['decision'],
          },
          projectMediaRef: {
            label: `Decision candidate ${variantIndex}`,
            collections: ['Candidates'],
            roles: ['generated_candidate' as const],
            notes: '',
          },
        })),
      },
    },
    context,
  );
  if (submitted.state !== 'succeeded') throw new Error('Expected generated decision candidate');
  const result = data.results.query(projectId, {
    resultIds: [],
    requestIds: [],
    targetRefs: [],
    include: [],
    page: { cursor: null, limit: 100 },
  }).items[0];
  if (result === undefined) throw new Error('Expected a generated decision candidate result');
  return { target, result: result.resultRef };
}

function requestFor(
  snapshot: HarnessActivationSnapshot,
  id: string,
  materializedToolIds: readonly string[],
): CanonicalModelRequestV1 {
  return CanonicalModelRequestV1Schema.parse({
    version: 1,
    runId: snapshot.run.id,
    modelAttemptId: id,
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
      ({ skillId: idValue, name, description, version, contentHash, provenance, trust }) => ({
        id: idValue,
        name,
        description,
        version,
        contentHash,
        provenance,
        trust,
      }),
    ),
    materializedTools: materializedToolIds.map((idValue) =>
      snapshot.catalog.tools.find(({ id: toolId }) => toolId === idValue),
    ),
    locale: snapshot.manifest.locale,
    timeZone: snapshot.manifest.timeZone,
    limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
    reasoningStrength: snapshot.run.model.reasoningStrength,
    systemPromptVersion: 'commander-minimal-v1',
  });
}

const USAGE = {
  inputTokens: { state: 'known' as const, value: 120 },
  outputTokens: { state: 'known' as const, value: 24 },
  cost: { state: 'known' as const, value: '0.5', currency: 'USD' },
};

const UNKNOWN_USAGE = {
  inputTokens: { state: 'unknown' as const },
  outputTokens: { state: 'unknown' as const },
  cost: { state: 'unknown' as const, currency: 'USD' },
};

const AGENT_SPAWN_SENTINEL = 'SENTINEL_AGENT_SPAWN_OBJECTIVE_DO_NOT_PERSIST';
const AGENT_SEND_SENTINEL = 'SENTINEL_AGENT_SEND_DIRECTION_DO_NOT_PERSIST';
const TOOL_PROGRAM_SENTINEL = '2037-05-06T07:08:09.000Z';

class UnknownGenerationProvider extends FakeGenerationProvider {
  override async submit() {
    this.submitCalls += 1;
    return {
      state: 'unknown' as const,
      receipt: null,
      usage: null,
      outputs: [],
    };
  }
}

function agentSpawnInput(
  expectedParentRevision: number,
  overrides: Partial<ReturnType<typeof AgentSpawnDefinition.parseInput>> = {},
) {
  return AgentSpawnDefinition.parseInput({
    displayName: 'Private spawn boundary',
    objective: AGENT_SPAWN_SENTINEL,
    publicSummary: 'Delegating one isolated private objective.',
    contextRefs: [],
    toolAllowlist: null,
    permissionCeiling: null,
    budgetCaps: null,
    expectedParentRevision,
    ...overrides,
  });
}

function agentSpawnResponse(
  spawnInput: ReturnType<typeof AgentSpawnDefinition.parseInput>,
  providerCallId: string,
): CanonicalModelResponseV1 {
  return {
    version: 1,
    events: [
      {
        type: 'tool_call',
        providerCallId,
        toolId: AgentSpawnDefinition.id,
        canonicalArguments: spawnInput,
      },
      { type: 'usage', usage: USAGE },
      { type: 'model_completed', finishReason: 'tool_calls' },
    ],
  };
}

function prepareRunningAgentSpawn(
  data: TargetDataAccess,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
  runId: string,
  suffix: string,
  overrides: Partial<ReturnType<typeof AgentSpawnDefinition.parseInput>> = {},
) {
  const snapshot = data.harness.loadActivation(runId, 1);
  const spawnInput = agentSpawnInput(snapshot.run.revision, overrides);
  const prepared = prepareModelAttempt(
    data,
    {
      request: requestFor(snapshot, `model-attempt.i3.agent-spawn.${suffix}`, [
        AgentSpawnDefinition.id,
      ]),
      quote: USAGE,
      commandId: `command.i3.agent-spawn.${suffix}.prepare`,
    },
    context,
  );
  data.harness.markModelAttemptRunning(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      commandId: `command.i3.agent-spawn.${suffix}.running`,
    },
    context,
  );
  const providerCallId = `provider-call.i3.agent-spawn.${suffix}`;
  return {
    prepared,
    providerCallId,
    response: agentSpawnResponse(spawnInput, providerCallId),
    spawnInput,
  };
}

function settlePreparedAgentSpawn(
  data: TargetDataAccess,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
  prepared: ReturnType<typeof prepareRunningAgentSpawn>['prepared'],
  providerCallId: string,
  response: CanonicalModelResponseV1,
) {
  return data.harness.settleAgentSpawnBoundary(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      response,
      providerCallId,
      activationNumber: 1,
      turnNumber: 1,
      stepNumber: 1,
      settledAt: NOW,
    },
    context,
  );
}

function agentSendInput(
  childRunId: string,
  expectedChildRevision: number,
  overrides: Partial<ReturnType<typeof AgentSendDefinition.parseInput>> = {},
) {
  return AgentSendDefinition.parseInput({
    childRunId,
    expectedChildRevision,
    message: AGENT_SEND_SENTINEL,
    contextRefs: [],
    ...overrides,
  });
}

function agentSendResponse(
  sendInput: ReturnType<typeof AgentSendDefinition.parseInput>,
  providerCallId: string,
): CanonicalModelResponseV1 {
  return {
    version: 1,
    events: [
      {
        type: 'tool_call',
        providerCallId,
        toolId: AgentSendDefinition.id,
        canonicalArguments: sendInput,
      },
      { type: 'usage', usage: USAGE },
      { type: 'model_completed', finishReason: 'tool_calls' },
    ],
  };
}

function prepareRunningAgentSend(
  data: TargetDataAccess,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
  runId: string,
  childRunId: string,
  suffix: string,
  overrides: Partial<ReturnType<typeof AgentSendDefinition.parseInput>> = {},
) {
  const snapshot = data.harness.loadActivation(runId, 1);
  const child = getRun(data, childRunId, `agent-send-child-${suffix}`);
  const sendInput = agentSendInput(childRunId, child.revision, overrides);
  const prepared = prepareModelAttempt(
    data,
    {
      request: requestFor(snapshot, `model-attempt.i3.agent-send.${suffix}`, [
        AgentSendDefinition.id,
      ]),
      quote: USAGE,
      commandId: `command.i3.agent-send.${suffix}.prepare`,
    },
    context,
  );
  data.harness.markModelAttemptRunning(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      commandId: `command.i3.agent-send.${suffix}.running`,
    },
    context,
  );
  const providerCallId = `provider-call.i3.agent-send.${suffix}`;
  return {
    prepared,
    providerCallId,
    response: agentSendResponse(sendInput, providerCallId),
    sendInput,
  };
}

function settlePreparedAgentSend(
  data: TargetDataAccess,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
  prepared: ReturnType<typeof prepareRunningAgentSend>['prepared'],
  providerCallId: string,
  response: CanonicalModelResponseV1,
) {
  const steps = prepared.events.flatMap((event) => {
    if (event.payloadState.state !== 'available') return [];
    const payload = event.payloadState.payload;
    return payload.type === 'step_started' && payload.kind === 'model'
      ? [{ turnNumber: payload.turnNumber, stepNumber: payload.stepNumber }]
      : [];
  });
  if (steps.length !== 1) throw new Error('Expected exactly one prepared model step');
  const step = steps[0]!;
  return data.harness.settleAgentSendBoundary(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      response,
      providerCallId,
      activationNumber: prepared.value.request.activationNumber,
      turnNumber: step.turnNumber,
      stepNumber: step.stepNumber,
      settledAt: NOW,
    },
    context,
  );
}

function agentResultResponse(
  resultInput: ReturnType<typeof AgentResultDefinition.parseInput>,
  providerCallId: string,
): CanonicalModelResponseV1 {
  return {
    version: 1,
    events: [
      {
        type: 'tool_call',
        providerCallId,
        toolId: AgentResultDefinition.id,
        canonicalArguments: resultInput,
      },
      { type: 'usage', usage: USAGE },
      { type: 'model_completed', finishReason: 'tool_calls' },
    ],
  };
}

function prepareRunningAgentResult(
  data: TargetDataAccess,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
  runId: string,
  childRunIds: readonly string[],
  suffix: string,
) {
  const snapshot = data.harness.loadActivation(runId, 1);
  const resultInput = AgentResultDefinition.parseInput({ childRunIds });
  const prepared = prepareModelAttempt(
    data,
    {
      request: requestFor(snapshot, `model-attempt.i3.agent-result.${suffix}`, [
        AgentResultDefinition.id,
      ]),
      quote: USAGE,
      commandId: `command.i3.agent-result.${suffix}.prepare`,
    },
    context,
  );
  data.harness.markModelAttemptRunning(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      commandId: `command.i3.agent-result.${suffix}.running`,
    },
    context,
  );
  const providerCallId = `provider-call.i3.agent-result.${suffix}`;
  return {
    prepared,
    providerCallId,
    response: agentResultResponse(resultInput, providerCallId),
  };
}

function settlePreparedAgentResult(
  data: TargetDataAccess,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
  prepared: ReturnType<typeof prepareRunningAgentResult>['prepared'],
  providerCallId: string,
  response: CanonicalModelResponseV1,
) {
  const steps = prepared.events.flatMap((event) => {
    if (event.payloadState.state !== 'available') return [];
    const payload = event.payloadState.payload;
    return payload.type === 'step_started' && payload.kind === 'model'
      ? [{ turnNumber: payload.turnNumber, stepNumber: payload.stepNumber }]
      : [];
  });
  if (steps.length !== 1) throw new Error('Expected exactly one prepared model step');
  return data.harness.settleAgentResultBoundary(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      response,
      providerCallId,
      activationNumber: prepared.value.request.activationNumber,
      turnNumber: steps[0]!.turnNumber,
      stepNumber: steps[0]!.stepNumber,
      settledAt: NOW,
    },
    context,
  );
}

function agentWaitResponse(
  waitInput: ReturnType<typeof AgentWaitDefinition.parseInput>,
  providerCallId: string,
): CanonicalModelResponseV1 {
  return {
    version: 1,
    events: [
      {
        type: 'tool_call',
        providerCallId,
        toolId: AgentWaitDefinition.id,
        canonicalArguments: waitInput,
      },
      { type: 'usage', usage: USAGE },
      { type: 'model_completed', finishReason: 'tool_calls' },
    ],
  };
}

function prepareRunningAgentWait(
  data: TargetDataAccess,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
  runId: string,
  childRunIds: readonly string[],
  suffix: string,
  overrides: Partial<ReturnType<typeof AgentWaitDefinition.parseInput>> = {},
) {
  const snapshot = data.harness.loadActivation(runId, 1);
  const waitInput = AgentWaitDefinition.parseInput({
    childRunIds,
    condition: 'any_terminal',
    timeoutMs: null,
    ...overrides,
  });
  const prepared = prepareModelAttempt(
    data,
    {
      request: requestFor(snapshot, `model-attempt.i3.agent-wait.${suffix}`, [
        AgentWaitDefinition.id,
      ]),
      quote: USAGE,
      commandId: `command.i3.agent-wait.${suffix}.prepare`,
    },
    context,
  );
  data.harness.markModelAttemptRunning(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      commandId: `command.i3.agent-wait.${suffix}.running`,
    },
    context,
  );
  const providerCallId = `provider-call.i3.agent-wait.${suffix}`;
  return {
    prepared,
    providerCallId,
    response: agentWaitResponse(waitInput, providerCallId),
    waitInput,
  };
}

function settlePreparedAgentWaitStart(
  data: TargetDataAccess,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
  prepared: ReturnType<typeof prepareRunningAgentWait>['prepared'],
  providerCallId: string,
  response: CanonicalModelResponseV1,
) {
  const steps = prepared.events.flatMap((event) => {
    if (event.payloadState.state !== 'available') return [];
    const payload = event.payloadState.payload;
    return payload.type === 'step_started' && payload.kind === 'model'
      ? [{ turnNumber: payload.turnNumber, stepNumber: payload.stepNumber }]
      : [];
  });
  if (steps.length !== 1) throw new Error('Expected exactly one prepared model step');
  return data.harness.settleAgentWaitStartBoundary(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      response,
      providerCallId,
      activationNumber: prepared.value.request.activationNumber,
      turnNumber: steps[0]!.turnNumber,
      stepNumber: steps[0]!.stepNumber,
      settledAt: NOW,
    },
    context,
  );
}

function agentCancelResponse(
  cancelInput: ReturnType<typeof AgentCancelDefinition.parseInput>,
  providerCallId: string,
): CanonicalModelResponseV1 {
  return {
    version: 1,
    events: [
      {
        type: 'tool_call',
        providerCallId,
        toolId: AgentCancelDefinition.id,
        canonicalArguments: cancelInput,
      },
      { type: 'usage', usage: USAGE },
      { type: 'model_completed', finishReason: 'tool_calls' },
    ],
  };
}

function prepareRunningAgentCancel(
  data: TargetDataAccess,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
  runId: string,
  childRunId: string,
  suffix: string,
  overrides: Partial<ReturnType<typeof AgentCancelDefinition.parseInput>> = {},
) {
  const snapshot = data.harness.loadActivation(runId, 1);
  const child = getRun(data, childRunId, `agent-cancel-child-${suffix}`);
  const cancelInput = AgentCancelDefinition.parseInput({
    childRunId,
    expectedRevision: child.revision,
    reason: 'The delegated work is no longer needed.',
    ...overrides,
  });
  const prepared = prepareModelAttempt(
    data,
    {
      request: requestFor(snapshot, `model-attempt.i3.agent-cancel.${suffix}`, [
        AgentCancelDefinition.id,
      ]),
      quote: USAGE,
      commandId: `command.i3.agent-cancel.${suffix}.prepare`,
    },
    context,
  );
  data.harness.markModelAttemptRunning(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      commandId: `command.i3.agent-cancel.${suffix}.running`,
    },
    context,
  );
  const providerCallId = `provider-call.i3.agent-cancel.${suffix}`;
  return {
    prepared,
    providerCallId,
    response: agentCancelResponse(cancelInput, providerCallId),
  };
}

function settlePreparedAgentCancel(
  data: TargetDataAccess,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
  prepared: ReturnType<typeof prepareRunningAgentCancel>['prepared'],
  providerCallId: string,
  response: CanonicalModelResponseV1,
) {
  const steps = prepared.events.flatMap((event) => {
    if (event.payloadState.state !== 'available') return [];
    const payload = event.payloadState.payload;
    return payload.type === 'step_started' && payload.kind === 'model'
      ? [{ turnNumber: payload.turnNumber, stepNumber: payload.stepNumber }]
      : [];
  });
  if (steps.length !== 1) throw new Error('Expected exactly one prepared model step');
  return data.harness.settleAgentCancelBoundary(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      response,
      providerCallId,
      activationNumber: prepared.value.request.activationNumber,
      turnNumber: steps[0]!.turnNumber,
      stepNumber: steps[0]!.stepNumber,
      settledAt: NOW,
    },
    context,
  );
}

function toolProgramInput(
  expectedRunRevision: number,
  overrides: Partial<ReturnType<typeof ToolProgramDefinition.parseInput>> = {},
) {
  return ToolProgramDefinition.parseInput({
    version: 1,
    displayName: 'Private bounded history call',
    expectedRunRevision,
    contextRefs: [],
    steps: [
      {
        stepId: 'step.tool-program.history',
        operation: 'call',
        invocation: {
          toolId: HistoryQueryDefinition.id,
          toolVersion: HistoryQueryDefinition.version,
          input: {
            sources: ['message'],
            eventTypes: [],
            subjects: [],
            actors: [],
            time: { from: TOOL_PROGRAM_SENTINEL, to: null },
            page: { cursor: null, limit: 20 },
          },
        },
      },
    ],
    ...overrides,
  });
}

function toolProgramResponse(
  program: ReturnType<typeof ToolProgramDefinition.parseInput>,
  providerCallId: string,
): CanonicalModelResponseV1 {
  return {
    version: 1,
    events: [
      {
        type: 'tool_call',
        providerCallId,
        toolId: ToolProgramDefinition.id,
        canonicalArguments: program,
      },
      { type: 'usage', usage: USAGE },
      { type: 'model_completed', finishReason: 'tool_calls' },
    ],
  };
}

function prepareRunningToolProgram(
  data: TargetDataAccess,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
  runId: string,
  suffix: string,
  overrides: Partial<ReturnType<typeof ToolProgramDefinition.parseInput>> = {},
) {
  const snapshot = data.harness.loadActivation(runId, 1);
  const program = toolProgramInput(snapshot.run.revision, overrides);
  const prepared = prepareModelAttempt(
    data,
    {
      request: requestFor(snapshot, `model-attempt.i3.tool-program.${suffix}`, [
        ToolProgramDefinition.id,
      ]),
      quote: USAGE,
      commandId: `command.i3.tool-program.${suffix}.prepare`,
    },
    context,
  );
  data.harness.markModelAttemptRunning(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      commandId: `command.i3.tool-program.${suffix}.running`,
    },
    context,
  );
  const providerCallId = `provider-call.i3.tool-program.${suffix}`;
  return {
    prepared,
    providerCallId,
    program,
    response: toolProgramResponse(program, providerCallId),
  };
}

function settlePreparedToolProgram(
  data: TargetDataAccess,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
  prepared: ReturnType<typeof prepareRunningToolProgram>['prepared'],
  providerCallId: string,
  response: CanonicalModelResponseV1,
) {
  return data.harness.settleToolProgramBoundary(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      response,
      providerCallId,
      activationNumber: 1,
      turnNumber: 1,
      stepNumber: 1,
      settledAt: NOW,
    },
    context,
  );
}

const RECOVERABLE_READS = [
  {
    toolId: ProjectSearchDefinition.id,
    input: ProjectSearchDefinition.examples.input,
  },
  {
    toolId: RunInspectDefinition.id,
    input: RunInspectDefinition.examples.input,
  },
  {
    toolId: GenerationQuoteDefinition.id,
    input: GenerationQuoteDefinition.examples.input,
  },
] as const;

function recoveryInput(snapshot: HarnessActivationSnapshot, commandId: string) {
  if (snapshot.run.publicEventHead === null) throw new Error('Expected a public Run event head');
  return {
    runId: snapshot.run.id,
    activationNumber: snapshot.activation.activationNumber,
    expectedRunRevision: snapshot.run.revision,
    expectedRunContentHash: snapshot.run.contentHash,
    expectedPublicEventHead: snapshot.run.publicEventHead,
    commandId,
  };
}

function prepareModelAttempt(
  data: TargetDataAccess,
  input: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[0],
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
) {
  const result = data.harness.prepareModelBoundary(input, context);
  if (result.kind !== 'prepared') {
    throw new Error('Expected Model Attempt preparation, not a pending-Inbox yield');
  }
  return result.commit;
}

function commitModelResponse(
  data: TargetDataAccess,
  context: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1],
  runId: string,
  suffix: string,
  materializedToolIds: readonly string[],
  response: CanonicalModelResponseV1,
) {
  const snapshot = data.harness.loadActivation(runId, 1);
  const prepared = prepareModelAttempt(
    data,
    {
      request: requestFor(snapshot, `model-attempt.i3.${suffix}`, materializedToolIds),
      quote: USAGE,
      commandId: `command.i3.${suffix}.prepare`,
    },
    context,
  );
  data.harness.markModelAttemptRunning(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      commandId: `command.i3.${suffix}.running`,
    },
    context,
  );
  data.harness.settleModelAttempt(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      response,
      settledAt: NOW,
      commandId: `command.i3.${suffix}.settle`,
    },
    context,
  );
  return prepared.value;
}

function eventTypes(events: readonly { payloadState: unknown }[]): string[] {
  return events.map((event) => {
    const state = event.payloadState as {
      state: 'available' | 'redacted';
      payload?: { type: string };
    };
    if (state.state !== 'available' || state.payload === undefined) {
      throw new Error('Expected an available recovery event payload');
    }
    return state.payload.type;
  });
}

function rowCount(store: TargetStore, table: string): number {
  const database = getJourneyTestDatabase(store);
  return Number(
    (
      database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as {
        count: number | bigint;
      }
    ).count,
  );
}

function serializedDatabaseRows(database: ReturnType<typeof getJourneyTestDatabase>): string {
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as unknown as Array<{ readonly name: string }>;
  return JSON.stringify(
    tables.map(({ name }) => ({ name, rows: database.prepare(`SELECT * FROM "${name}"`).all() })),
  );
}

function queueHarnessFollowup(data: TargetDataAccess, runId: string, suffix: string) {
  const run = getRun(data, runId, `followup-${suffix}`);
  return data.runs.sendFollowup(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: `request.i3.followup.${suffix}`,
      method: 'run.sendFollowup',
      input: {
        runId,
        expectedRevision: run.revision,
        text: `Follow-up ${suffix}`,
        selectedContext: [],
      },
    },
    userContext,
    {
      model: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      locale: 'en-US',
      timeZone: 'UTC',
      capabilityCatalog: ROOT_CATALOG,
      projectMediaSelections: [],
      citedMemoryEntryIds: [],
    },
  ).result;
}

function activateAcceptedRun(
  data: TargetDataAccess,
  runId: string,
  inboxId: string,
  inboxSequence: number,
) {
  const context = commanderContext(runId);
  const accepted = getRun(data, runId, 'retry-accepted');
  data.runs.transitionInbox(
    {
      runId,
      expectedRevision: accepted.revision,
      inboxMessageId: inboxId,
      sequence: inboxSequence,
      action: 'deliver',
      commandId: `command.${runId}.deliver`,
    },
    context,
  );
  const delivered = getRun(data, runId, 'retry-delivered');
  data.runs.startActivation(
    {
      runId,
      expectedRevision: delivered.revision,
      commandId: `command.${runId}.activate`,
    },
    context,
  );
  const running = getRun(data, runId, 'retry-running');
  data.harness.consumeInbox(
    {
      runId,
      expectedRevision: running.revision,
      inboxMessageId: inboxId,
      sequence: inboxSequence,
      commandId: `command.${runId}.consume`,
    },
    context,
  );
  return context;
}

function settleInitialChildBoundary(data: TargetDataAccess, runId: string, suffix: string) {
  const inbox = data.runs.listInbox(runId)[0];
  if (inbox === undefined) throw new Error(`Run ${runId} has no initial Inbox`);
  const context = activateAcceptedRun(data, runId, inbox.id, inbox.sequence);
  const active = getRun(data, runId, `agent-send-${suffix}-active`);
  data.runs.endActivation(
    {
      runId,
      expectedRevision: active.revision,
      activationNumber: 1,
      reason: 'safe_boundary',
      commandId: `command.i3.agent-send.${suffix}.initial-end`,
    },
    context,
  );
  return context;
}

interface InvalidAgentSendSetup {
  readonly childRunId: string;
  readonly senderRunId?: string;
  readonly senderContext?: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1];
  readonly overrides?: Partial<ReturnType<typeof AgentSendDefinition.parseInput>>;
  readonly code: 'INVALID_REQUEST' | 'REVISION_CONFLICT';
}

async function expectAgentSendRejectionWithoutWrites(
  suffix: string,
  setup: (state: Awaited<ReturnType<typeof activeHarnessFixture>>) => InvalidAgentSendSetup,
) {
  const state = await activeHarnessFixture();
  try {
    const target = setup(state);
    const prepared = prepareRunningAgentSend(
      state.fixture.data,
      target.senderContext ?? state.context,
      target.senderRunId ?? state.runId,
      target.childRunId,
      suffix,
      target.overrides,
    );
    const database = getJourneyTestDatabase(state.fixture.store);
    const before = serializedDatabaseRows(database);
    expect(() =>
      settlePreparedAgentSend(
        state.fixture.data,
        target.senderContext ?? state.context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      ),
    ).toThrowError(expect.objectContaining({ code: target.code }));
    expect(serializedDatabaseRows(database)).toBe(before);
  } finally {
    state.fixture.store.close();
    await rm(state.fixture.directory, { recursive: true, force: true });
  }
}

async function expectAgentResultRejectionWithoutWrites(
  suffix: string,
  targetRunIds: (state: Awaited<ReturnType<typeof activeHarnessFixture>>) => readonly string[],
) {
  const state = await activeHarnessFixture();
  try {
    const prepared = prepareRunningAgentResult(
      state.fixture.data,
      state.context,
      state.runId,
      targetRunIds(state),
      suffix,
    );
    const database = getJourneyTestDatabase(state.fixture.store);
    const before = serializedDatabaseRows(database);
    expect(() =>
      settlePreparedAgentResult(
        state.fixture.data,
        state.context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(serializedDatabaseRows(database)).toBe(before);
  } finally {
    state.fixture.store.close();
    await rm(state.fixture.directory, { recursive: true, force: true });
  }
}

interface InvalidAgentCancelSetup {
  readonly childRunId: string;
  readonly senderRunId?: string;
  readonly senderContext?: Parameters<TargetDataAccess['harness']['prepareModelBoundary']>[1];
  readonly overrides?: Partial<ReturnType<typeof AgentCancelDefinition.parseInput>>;
  readonly code: 'INVALID_REQUEST' | 'REVISION_CONFLICT';
}

async function expectAgentCancelRejectionWithoutWrites(
  suffix: string,
  setup: (state: Awaited<ReturnType<typeof activeHarnessFixture>>) => InvalidAgentCancelSetup,
) {
  const state = await activeHarnessFixture();
  try {
    const target = setup(state);
    const prepared = prepareRunningAgentCancel(
      state.fixture.data,
      target.senderContext ?? state.context,
      target.senderRunId ?? state.runId,
      target.childRunId,
      suffix,
      target.overrides,
    );
    const database = getJourneyTestDatabase(state.fixture.store);
    const before = serializedDatabaseRows(database);
    expect(() =>
      settlePreparedAgentCancel(
        state.fixture.data,
        target.senderContext ?? state.context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      ),
    ).toThrowError(expect.objectContaining({ code: target.code }));
    expect(serializedDatabaseRows(database)).toBe(before);
  } finally {
    state.fixture.store.close();
    await rm(state.fixture.directory, { recursive: true, force: true });
  }
}

describe('Harness persistence authority', () => {
  it('distinguishes live bounded reads from reads that are safe to replay after recovery', () => {
    expect(ROOT_CATALOG.tools.filter(isRuntimeReadTool).map(({ id }) => id)).toEqual([
      'canvas.query',
      'chat.query',
      'delivery.query',
      'generation.quote',
      'history.query',
      'media.inspect',
      'media.query',
      'memory.query',
      'operation.get',
      'production.query',
      'project.get',
      'project.search',
      'provider.capabilities',
      'result.query',
      'run.inspect',
      'skill.load',
      'tool.get',
    ]);
    expect(
      isRecoverySafeRuntimeReadTool(
        ROOT_CATALOG.tools.find(({ id }) => id === OperationGetDefinition.id)!,
      ),
    ).toBe(false);
  });

  it('selects the exact frozen recovery-safe R catalog without an ID allowlist', () => {
    expect(ROOT_CATALOG.tools.filter(isRecoverySafeRuntimeReadTool).map(({ id }) => id)).toEqual([
      'canvas.query',
      'chat.query',
      'delivery.query',
      'generation.quote',
      'history.query',
      'media.inspect',
      'media.query',
      'memory.query',
      'production.query',
      'project.get',
      'project.search',
      'provider.capabilities',
      'result.query',
      'run.inspect',
      'skill.load',
      'tool.get',
    ]);
  });

  it('atomically persists a durable agent.spawn boundary without serializing its objective', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const prepared = prepareRunningAgentSpawn(fixture.data, context, runId, 'private-happy');
      const settled = settlePreparedAgentSpawn(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      const database = getJourneyTestDatabase(fixture.store);
      const childRunId = settled.value.child.child.childRunId;
      const objectiveHash = hashUtf8(prepared.spawnInput.objective);
      const modelResponse = database
        .prepare('SELECT response_v1_json FROM model_attempts WHERE id = ?')
        .get(prepared.prepared.value.id) as { readonly response_v1_json: string };
      const dispatchInput = database
        .prepare('SELECT input_v1_json FROM dispatch_operations WHERE id = ?')
        .get(settled.value.dispatch.id) as { readonly input_v1_json: string };
      const ciphertext = database
        .prepare('SELECT ciphertext FROM private_recovery_envelopes WHERE run_id = ?')
        .get(childRunId) as { readonly ciphertext: Uint8Array };

      expect(prepared.prepared.value.request.runRevision).toBeLessThan(settled.run.revision);
      expect(settled.value.attempt.response).toEqual(expect.objectContaining({ version: 1 }));
      const durableToolCall = (
        JSON.parse(modelResponse.response_v1_json) as {
          readonly events: readonly Record<string, unknown>[];
        }
      ).events.find(({ type }) => type === 'tool_call');
      expect(durableToolCall).toMatchObject({
        type: 'tool_call',
        toolId: AgentSpawnDefinition.id,
        canonicalArguments: expect.objectContaining({ objectiveHash }),
      });
      expect(JSON.parse(dispatchInput.input_v1_json)).toMatchObject({ objectiveHash });
      expect(JSON.stringify(settled.value)).not.toContain(AGENT_SPAWN_SENTINEL);
      expect(serializedDatabaseRows(database)).not.toContain(AGENT_SPAWN_SENTINEL);
      expect(Buffer.from(ciphertext.ciphertext).includes(Buffer.from(AGENT_SPAWN_SENTINEL))).toBe(
        false,
      );
      expect(
        JSON.stringify(
          fixture.data.runs.listPublicEvents({
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.i3.agent-spawn.private-happy.events',
            method: 'run.events.list',
            input: { runId, afterSequence: null, page: { cursor: null, limit: 100 } },
          }).result,
        ),
      ).not.toContain(AGENT_SPAWN_SENTINEL);
      expect(JSON.stringify(fixture.data.runReplay.get(runId))).not.toContain(AGENT_SPAWN_SENTINEL);
      expect(fixture.data.harness.materializePrivateModelContext(runId)).toEqual({
        parentDirections: [],
        spawnObjectives: [
          expect.objectContaining({
            type: 'spawn_objective',
            dispatchOperationId: settled.value.dispatch.id,
            childRunId,
            objectiveHash,
            objective: AGENT_SPAWN_SENTINEL,
          }),
        ],
      });
      expect(fixture.data.harness.materializePrivateModelContext(childRunId)).toEqual({
        parentDirections: [
          expect.objectContaining({
            type: 'parent_direction',
            parentRunId: runId,
            directionHash: objectiveHash,
            objective: AGENT_SPAWN_SENTINEL,
          }),
        ],
        spawnObjectives: [],
      });
      const beforePrivateRecoveryReadFailures = serializedDatabaseRows(database);
      const missingKeyData = createJourneyDataAccess(
        fixture.store,
        fixture.dependencies,
        fixture.createId,
        createAes256GcmPrivateRecoveryCodec({
          encryptionKeyId: 'key.i3.agent-spawn.unavailable',
          encryptionKey: new Uint8Array(32).fill(0x7a),
          resolveEncryptionKey: () => undefined,
        }),
      );
      const wrongKeyData = createJourneyDataAccess(
        fixture.store,
        fixture.dependencies,
        fixture.createId,
        createJourneyPrivateRecoveryCodec(new Uint8Array(32).fill(0x6b)),
      );
      expect(() => missingKeyData.harness.materializePrivateModelContext(runId)).toThrowError(
        expect.objectContaining({ code: 'SECURITY_CONFIGURATION_FAILED' }),
      );
      expect(() => wrongKeyData.harness.materializePrivateModelContext(runId)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
      expect(serializedDatabaseRows(database)).toBe(beforePrivateRecoveryReadFailures);
      database
        .prepare('UPDATE private_recovery_envelopes SET ciphertext = ? WHERE run_id = ?')
        .run(Buffer.alloc(ciphertext.ciphertext.byteLength, 0x7f), childRunId);
      const afterEnvelopeTamper = serializedDatabaseRows(database);
      expect(() => fixture.data.harness.materializePrivateModelContext(runId)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
      expect(serializedDatabaseRows(database)).toBe(afterEnvelopeTamper);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('atomically persists a private agent.send direction through a continuous recovery chain', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const parentBefore = getRun(fixture.data, runId, 'agent-send-parent-before-child');
      const child = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parentBefore.revision,
          commandId: 'command.i3.agent-send.child.spawn',
          spawnInput: agentSpawnInput(parentBefore.revision, {
            displayName: 'Agent send target',
            objective: 'Initial private target direction.',
          }),
        },
        context,
      ).child;
      const childContext = commanderContext(child.childRunId);
      const initialInbox = fixture.data.runs.listInbox(child.childRunId)[0]!;
      activateAcceptedRun(fixture.data, child.childRunId, initialInbox.id, initialInbox.sequence);
      const activeChild = getRun(fixture.data, child.childRunId, 'agent-send-child-active');
      fixture.data.runs.endActivation(
        {
          runId: child.childRunId,
          expectedRevision: activeChild.revision,
          activationNumber: 1,
          reason: 'safe_boundary',
          commandId: 'command.i3.agent-send.child.end-initial',
        },
        childContext,
      );

      const prepared = prepareRunningAgentSend(
        fixture.data,
        context,
        runId,
        child.childRunId,
        'private-happy',
      );
      const before = serializedDatabaseRows(getJourneyTestDatabase(fixture.store));
      const settled = settlePreparedAgentSend(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      const database = getJourneyTestDatabase(fixture.store);
      const queued = fixture.data.runs
        .listInbox(child.childRunId)
        .find(({ id }) => id === settled.value.sent.inboxMessageId);
      if (queued === undefined) throw new Error('Expected queued agent.send Inbox');

      expect(settled.value.sent).toMatchObject({
        inboxSequence: queued.sequence,
        activationNumber: 2,
        deliveryState: 'queued',
        child: { childRunId: child.childRunId },
      });
      expect(settled.value.sent.child.revision).toBe(prepared.sendInput.expectedChildRevision + 1);
      expect(serializedDatabaseRows(database)).not.toContain(AGENT_SEND_SENTINEL);
      expect(
        JSON.stringify(
          database
            .prepare(
              `SELECT request_v1_json, response_v1_json
               FROM model_attempts WHERE id = ?`,
            )
            .get(prepared.prepared.value.id),
        ),
      ).not.toContain(AGENT_SEND_SENTINEL);
      expect(
        JSON.stringify(
          database
            .prepare('SELECT input_v1_json, outcome_v1_json FROM dispatch_operations WHERE id = ?')
            .get(settled.value.dispatch.id),
        ),
      ).not.toContain(AGENT_SEND_SENTINEL);
      expect(fixture.data.harness.materializePrivateModelContext(runId).sentDirections).toEqual([
        expect.objectContaining({
          dispatchOperationId: settled.value.dispatch.id,
          childRunId: child.childRunId,
          directionHash: hashUtf8(AGENT_SEND_SENTINEL),
          message: AGENT_SEND_SENTINEL,
        }),
      ]);
      expect(
        JSON.stringify(fixture.data.harness.materializePrivateModelContext(child.childRunId)),
      ).not.toContain(AGENT_SEND_SENTINEL);
      const afterFirstSettlement = serializedDatabaseRows(database);

      const replayData = createJourneyDataAccess(
        fixture.store,
        fixture.dependencies,
        (_kind: string) => {
          throw new Error('agent.send replay must not allocate an ID');
        },
        {
          algorithm: 'aes-256-gcm' as const,
          encryptionKeyId: 'key.i3.agent-send.replay-must-not-use-codec',
          seal() {
            throw new Error('agent.send replay must not seal private recovery data');
          },
          open() {
            throw new Error('agent.send replay must not open private recovery data');
          },
        },
      );
      const replay = settlePreparedAgentSend(
        replayData,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      expect(replay.events).toEqual([]);
      expect(replay.value.dispatch.id).toBe(settled.value.dispatch.id);
      expect(serializedDatabaseRows(database)).not.toBe(before);
      expect(serializedDatabaseRows(database)).toBe(afterFirstSettlement);

      const beforeDelivery = getRun(fixture.data, child.childRunId, 'agent-send-before-delivery');
      fixture.data.runs.transitionInbox(
        {
          runId: child.childRunId,
          expectedRevision: beforeDelivery.revision,
          inboxMessageId: queued.id,
          sequence: queued.sequence,
          action: 'deliver',
          commandId: 'command.i3.agent-send.child.deliver',
        },
        childContext,
      );
      expect(fixture.data.harness.materializePrivateModelContext(child.childRunId)).toMatchObject({
        parentDirections: expect.arrayContaining([
          expect.objectContaining({
            inboxMessageId: queued.id,
            directionHash: hashUtf8(AGENT_SEND_SENTINEL),
            message: AGENT_SEND_SENTINEL,
          }),
        ]),
      });

      const beforeActivation = getRun(
        fixture.data,
        child.childRunId,
        'agent-send-before-activation',
      );
      fixture.data.runs.startActivation(
        {
          runId: child.childRunId,
          expectedRevision: beforeActivation.revision,
          commandId: 'command.i3.agent-send.child.activate',
        },
        childContext,
      );
      const running = getRun(fixture.data, child.childRunId, 'agent-send-running');
      fixture.data.harness.consumeInbox(
        {
          runId: child.childRunId,
          expectedRevision: running.revision,
          inboxMessageId: queued.id,
          sequence: queued.sequence,
          commandId: 'command.i3.agent-send.child.consume',
        },
        childContext,
      );
      const followupFacts = fixture.data.harness
        .loadActivation(child.childRunId, 2)
        .facts.filter(
          (fact) => fact.type === 'parent_direction' && fact.inboxMessageId === queued.id,
        );
      expect(followupFacts).toEqual([
        expect.objectContaining({
          parentRunId: runId,
          parentEventId:
            queued.source.kind === 'parent_direction' ? queued.source.parentEventId : '',
          directionHash: hashUtf8(AGENT_SEND_SENTINEL),
        }),
      ]);

      database
        .prepare(
          `UPDATE private_recovery_envelopes
           SET ciphertext = zeroblob(byte_length)
           WHERE run_id = ? AND sequence = 2`,
        )
        .run(child.childRunId);
      expect(() => fixture.data.harness.materializePrivateModelContext(child.childRunId)).toThrow(
        /private recovery/i,
      );
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects stale, sibling, self, terminal, and unauthorized agent.send targets without writes', async () => {
    await expectAgentSendRejectionWithoutWrites('self', ({ runId }) => ({
      childRunId: runId,
      code: 'INVALID_REQUEST',
    }));

    await expectAgentSendRejectionWithoutWrites('stale', ({ fixture, context, runId }) => {
      const parent = getRun(fixture.data, runId, 'agent-send-stale-parent');
      const child = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-send.stale.child',
          spawnInput: agentSpawnInput(parent.revision),
        },
        context,
      ).child;
      return {
        childRunId: child.childRunId,
        overrides: { expectedChildRevision: 0 },
        code: 'REVISION_CONFLICT',
      };
    });

    await expectAgentSendRejectionWithoutWrites('terminal', ({ fixture, context, runId }) => {
      const parent = getRun(fixture.data, runId, 'agent-send-terminal-parent');
      const child = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-send.terminal.child',
          spawnInput: agentSpawnInput(parent.revision),
        },
        context,
      ).child;
      const childRun = getRun(fixture.data, child.childRunId, 'agent-send-terminal-child');
      fixture.data.runs.terminalize(
        {
          runId: child.childRunId,
          expectedRevision: childRun.revision,
          status: 'cancelled',
          summary: 'The target Run ended before receiving a follow-up.',
          resultIds: [],
          commandId: 'command.i3.agent-send.terminal.child-end',
        },
        commanderContext(child.childRunId),
      );
      return { childRunId: child.childRunId, code: 'INVALID_REQUEST' };
    });

    await expectAgentSendRejectionWithoutWrites(
      'unauthorized-context',
      ({ fixture, context, project, runId }) => {
        const parent = getRun(fixture.data, runId, 'agent-send-unauthorized-parent');
        const child = fixture.data.runs.spawnChild(
          {
            parentRunId: runId,
            expectedParentRevision: parent.revision,
            commandId: 'command.i3.agent-send.unauthorized.child',
            spawnInput: agentSpawnInput(parent.revision),
          },
          context,
        ).child;
        return {
          childRunId: child.childRunId,
          overrides: {
            contextRefs: [
              {
                authority: 'project',
                id: project.id,
                revision: project.revision,
                contentHash: 'f'.repeat(64),
              },
            ],
          },
          code: 'INVALID_REQUEST',
        };
      },
    );

    await expectAgentSendRejectionWithoutWrites('sibling', ({ fixture, context, runId }) => {
      const parent = getRun(fixture.data, runId, 'agent-send-sibling-parent');
      const sender = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-send.sibling.sender',
          spawnInput: agentSpawnInput(parent.revision),
        },
        context,
      ).child;
      const parentAfterSender = getRun(fixture.data, runId, 'agent-send-sibling-parent-after');
      const sibling = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parentAfterSender.revision,
          commandId: 'command.i3.agent-send.sibling.target',
          spawnInput: agentSpawnInput(parentAfterSender.revision),
        },
        context,
      ).child;
      const senderInbox = fixture.data.runs.listInbox(sender.childRunId)[0]!;
      const senderContext = activateAcceptedRun(
        fixture.data,
        sender.childRunId,
        senderInbox.id,
        senderInbox.sequence,
      );
      return {
        senderRunId: sender.childRunId,
        senderContext,
        childRunId: sibling.childRunId,
        code: 'INVALID_REQUEST',
      };
    });
  }, 120_000);

  it('assigns two queued agent.send directions to consecutive FIFO child activations', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    const secondDirection = 'SENTINEL_AGENT_SEND_SECOND_FIFO_DIRECTION_DO_NOT_PERSIST';
    try {
      const parent = getRun(fixture.data, runId, 'agent-send-fifo-parent');
      const child = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-send.fifo.child',
          spawnInput: agentSpawnInput(parent.revision),
        },
        context,
      ).child;
      const childContext = settleInitialChildBoundary(fixture.data, child.childRunId, 'fifo-child');
      const first = prepareRunningAgentSend(
        fixture.data,
        context,
        runId,
        child.childRunId,
        'fifo-first',
      );
      const firstSettled = settlePreparedAgentSend(
        fixture.data,
        context,
        first.prepared,
        first.providerCallId,
        first.response,
      );
      const second = prepareRunningAgentSend(
        fixture.data,
        context,
        runId,
        child.childRunId,
        'fifo-second',
        { message: secondDirection },
      );
      const secondSettled = settlePreparedAgentSend(
        fixture.data,
        context,
        second.prepared,
        second.providerCallId,
        second.response,
      );
      const firstSent = firstSettled.value.sent;
      const secondSent = secondSettled.value.sent;
      expect(firstSent).toMatchObject({ inboxSequence: 2, activationNumber: 2 });
      expect(secondSent).toMatchObject({ inboxSequence: 3, activationNumber: 3 });
      const database = getJourneyTestDatabase(fixture.store);
      expect(
        database
          .prepare(
            `SELECT sequence, activation_number
             FROM private_recovery_envelopes
             WHERE run_id = ?
             ORDER BY sequence`,
          )
          .all(child.childRunId),
      ).toEqual([
        { sequence: 1, activation_number: 1 },
        { sequence: 2, activation_number: firstSent.activationNumber },
        { sequence: 3, activation_number: secondSent.activationNumber },
      ]);
      expect(serializedDatabaseRows(database)).not.toContain(AGENT_SEND_SENTINEL);
      expect(serializedDatabaseRows(database)).not.toContain(secondDirection);

      let childRun = getRun(fixture.data, child.childRunId, 'agent-send-fifo-first-delivery');
      fixture.data.runs.transitionInbox(
        {
          runId: child.childRunId,
          expectedRevision: childRun.revision,
          inboxMessageId: firstSent.inboxMessageId,
          sequence: firstSent.inboxSequence,
          action: 'deliver',
          commandId: 'command.i3.agent-send.fifo.first-deliver',
        },
        childContext,
      );
      const firstPrivateContext = fixture.data.harness.materializePrivateModelContext(
        child.childRunId,
      );
      expect(JSON.stringify(firstPrivateContext)).toContain(AGENT_SEND_SENTINEL);
      expect(JSON.stringify(firstPrivateContext)).not.toContain(secondDirection);
      childRun = getRun(fixture.data, child.childRunId, 'agent-send-fifo-first-activation');
      const firstActivation = fixture.data.runs.startActivation(
        {
          runId: child.childRunId,
          expectedRevision: childRun.revision,
          commandId: 'command.i3.agent-send.fifo.first-activate',
        },
        childContext,
      );
      expect(firstActivation.activationNumber).toBe(firstSent.activationNumber);
      childRun = getRun(fixture.data, child.childRunId, 'agent-send-fifo-first-consume');
      fixture.data.harness.consumeInbox(
        {
          runId: child.childRunId,
          expectedRevision: childRun.revision,
          inboxMessageId: firstSent.inboxMessageId,
          sequence: firstSent.inboxSequence,
          commandId: 'command.i3.agent-send.fifo.first-consume',
        },
        childContext,
      );
      childRun = getRun(fixture.data, child.childRunId, 'agent-send-fifo-first-end');
      fixture.data.runs.endActivation(
        {
          runId: child.childRunId,
          expectedRevision: childRun.revision,
          activationNumber: firstActivation.activationNumber,
          reason: 'safe_boundary',
          commandId: 'command.i3.agent-send.fifo.first-end',
        },
        childContext,
      );

      childRun = getRun(fixture.data, child.childRunId, 'agent-send-fifo-second-delivery');
      fixture.data.runs.transitionInbox(
        {
          runId: child.childRunId,
          expectedRevision: childRun.revision,
          inboxMessageId: secondSent.inboxMessageId,
          sequence: secondSent.inboxSequence,
          action: 'deliver',
          commandId: 'command.i3.agent-send.fifo.second-deliver',
        },
        childContext,
      );
      childRun = getRun(fixture.data, child.childRunId, 'agent-send-fifo-second-activation');
      const secondActivation = fixture.data.runs.startActivation(
        {
          runId: child.childRunId,
          expectedRevision: childRun.revision,
          commandId: 'command.i3.agent-send.fifo.second-activate',
        },
        childContext,
      );
      expect(secondActivation.activationNumber).toBe(secondSent.activationNumber);
      childRun = getRun(fixture.data, child.childRunId, 'agent-send-fifo-second-consume');
      fixture.data.harness.consumeInbox(
        {
          runId: child.childRunId,
          expectedRevision: childRun.revision,
          inboxMessageId: secondSent.inboxMessageId,
          sequence: secondSent.inboxSequence,
          commandId: 'command.i3.agent-send.fifo.second-consume',
        },
        childContext,
      );
      expect(
        fixture.data.harness
          .loadActivation(child.childRunId, secondActivation.activationNumber)
          .facts.filter(
            (fact) =>
              fact.type === 'parent_direction' && fact.inboxMessageId === secondSent.inboxMessageId,
          ),
      ).toEqual([
        expect.objectContaining({
          parentRunId: runId,
          directionHash: hashUtf8(secondDirection),
        }),
      ]);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('atomically projects terminal descendant results without persisting private objectives', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const spawn = prepareRunningAgentSpawn(fixture.data, context, runId, 'result-child');
      const spawned = settlePreparedAgentSpawn(
        fixture.data,
        context,
        spawn.prepared,
        spawn.providerCallId,
        spawn.response,
      );
      const childRunId = spawned.value.child.child.childRunId;
      const childInbox = fixture.data.runs.listInbox(childRunId)[0];
      if (childInbox === undefined) throw new Error('Expected an initial child Inbox');
      const childContext = activateAcceptedRun(
        fixture.data,
        childRunId,
        childInbox.id,
        childInbox.sequence,
      );
      const activeChild = getRun(fixture.data, childRunId, 'agent-result-child-active');
      const terminalChild = fixture.data.runs.terminalize(
        {
          runId: childRunId,
          expectedRevision: activeChild.revision,
          status: 'completed',
          summary: 'The public continuity result is ready.',
          resultIds: [],
          commandId: 'command.i3.agent-result.child-terminal',
        },
        childContext,
      );
      const prepared = prepareRunningAgentResult(
        fixture.data,
        context,
        runId,
        [childRunId],
        'terminal-happy',
      );
      const settled = settlePreparedAgentResult(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      const result = AgentResultDefinition.parseSuccess(settled.value.result);
      expect(result.children).toEqual([
        {
          child: {
            childRunId,
            revision: terminalChild.revision,
            contentHash: terminalChild.contentHash,
            state: 'completed',
            objectiveHash: terminalChild.acceptedSource.directionHash,
          },
          displayName: terminalChild.displayName,
          summary: 'The public continuity result is ready.',
          resultRefs: [],
          artifacts: [],
          blockers: [],
          usage: {
            costUsd: { state: 'known', value: '0', currency: 'USD' },
            generationCount: { state: 'known', value: 0 },
            inputTokens: { state: 'known', value: 0 },
            outputTokens: { state: 'known', value: 0 },
          },
        },
      ]);
      expect(eventTypes(settled.events)).toEqual([
        'usage',
        'step_ended',
        'step_started',
        'tool_call_ref',
        'tool_result_ref',
        'tool_summary',
        'step_ended',
      ]);
      const database = getJourneyTestDatabase(fixture.store);
      expect(serializedDatabaseRows(database)).not.toContain(AGENT_SPAWN_SENTINEL);

      const beforeReplay = serializedDatabaseRows(database);
      expect(
        settlePreparedAgentResult(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          prepared.response,
        ).value.result,
      ).toEqual(result);
      expect(serializedDatabaseRows(database)).toBe(beforeReplay);

      const stored = database
        .prepare('SELECT outcome_v1_json FROM dispatch_operations WHERE id = ?')
        .get(settled.value.dispatch.id) as { readonly outcome_v1_json: string };
      const tampered = JSON.parse(stored.outcome_v1_json) as {
        data: { children: Array<Record<string, unknown>> };
      };
      tampered.data.children[0]!.objective = AGENT_SPAWN_SENTINEL;
      database
        .prepare('UPDATE dispatch_operations SET outcome_v1_json = ? WHERE id = ?')
        .run(JSON.stringify(tampered), settled.value.dispatch.id);
      const afterTamper = serializedDatabaseRows(database);
      expect(() =>
        settlePreparedAgentResult(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          prepared.response,
        ),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
      expect(serializedDatabaseRows(database)).toBe(afterTamper);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('returns only requested terminal descendants in stable input order across every terminal state', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const terminalChildren = [];
      for (const [index, status] of (
        ['completed', 'blocked', 'failed', 'cancelled'] as const
      ).entries()) {
        const parent = getRun(fixture.data, runId, `agent-result-parent-${status}`);
        const spawned = fixture.data.runs.spawnChild(
          {
            parentRunId: runId,
            expectedParentRevision: parent.revision,
            commandId: `command.i3.agent-result.${status}.spawn`,
            spawnInput: agentSpawnInput(parent.revision, {
              displayName: `Terminal ${status}`,
              objective: `Private terminal-state direction ${index}.`,
              publicSummary: `Preparing ${status} public state.`,
            }),
          },
          context,
        ).child;
        const inbox = fixture.data.runs.listInbox(spawned.childRunId)[0];
        if (inbox === undefined) throw new Error('Expected an initial child Inbox');
        const childContext = activateAcceptedRun(
          fixture.data,
          spawned.childRunId,
          inbox.id,
          inbox.sequence,
        );
        const active = getRun(fixture.data, spawned.childRunId, `agent-result-${status}-active`);
        terminalChildren.push(
          fixture.data.runs.terminalize(
            {
              runId: spawned.childRunId,
              expectedRevision: active.revision,
              status,
              summary: `Public ${status} summary.`,
              resultIds: [],
              commandId: `command.i3.agent-result.${status}.terminal`,
            },
            childContext,
          ),
        );
      }
      const requested = [
        terminalChildren[2]!,
        terminalChildren[0]!,
        terminalChildren[3]!,
        terminalChildren[1]!,
      ];
      const prepared = prepareRunningAgentResult(
        fixture.data,
        context,
        runId,
        requested.map(({ id }) => id),
        'terminal-order',
      );
      const settled = settlePreparedAgentResult(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      expect(settled.value.result.children.map(({ child }) => child.childRunId)).toEqual(
        requested.map(({ id }) => id),
      );
      expect(settled.value.result.children.map(({ child }) => child.state)).toEqual([
        'failed',
        'completed',
        'cancelled',
        'blocked',
      ]);
      expect(settled.value.result.children.map(({ summary }) => summary)).toEqual([
        'Public failed summary.',
        'Public completed summary.',
        'Public cancelled summary.',
        'Public blocked summary.',
      ]);
      expect(settled.value.result.children).toHaveLength(4);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('rejects self and nonterminal agent.result targets without settlement writes', async () => {
    await expectAgentResultRejectionWithoutWrites('self', ({ runId }) => [runId]);
    await expectAgentResultRejectionWithoutWrites('nonterminal', ({ fixture, context, runId }) => {
      const parent = getRun(fixture.data, runId, 'agent-result-nonterminal-parent');
      const child = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-result.nonterminal.spawn',
          spawnInput: agentSpawnInput(parent.revision, {
            displayName: 'Nonterminal result target',
            objective: 'Remain nonterminal for a strict result rejection.',
          }),
        },
        context,
      ).child;
      return [child.childRunId];
    });
  }, 120_000);

  it('opens agent.wait atomically and preserves ordered all-terminal results at the deadline', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const parent = getRun(fixture.data, runId, 'agent-wait-parent');
      const child = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-wait.child.spawn',
          spawnInput: agentSpawnInput(parent.revision, {
            displayName: 'Wait target',
            objective: AGENT_SPAWN_SENTINEL,
            publicSummary: 'Waiting for the delegated review.',
          }),
        },
        context,
      ).child;
      const afterFirstChild = getRun(fixture.data, runId, 'agent-wait-parent-after-first-child');
      const secondChild = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: afterFirstChild.revision,
          commandId: 'command.i3.agent-wait.second-child.spawn',
          spawnInput: agentSpawnInput(afterFirstChild.revision, {
            displayName: 'Second wait target',
            objective: 'Finish after the first wait target.',
            publicSummary: 'Waiting for the first delegated review.',
          }),
        },
        context,
      ).child;
      const prepared = prepareRunningAgentWait(
        fixture.data,
        context,
        runId,
        [secondChild.childRunId, child.childRunId],
        'atomic',
        { condition: 'all_terminal' },
      );
      const database = getJourneyTestDatabase(fixture.store);
      const beforeGenericPaths = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: prepared.prepared.value.id,
            requestHash: prepared.prepared.value.requestHash,
            response: prepared.response,
            settledAt: NOW,
            commandId: 'command.i3.agent-wait.generic-settle',
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: prepared.prepared.value.id,
            providerCallId: prepared.providerCallId,
            toolId: AgentWaitDefinition.id,
            input: prepared.waitInput,
            authorityWatermarkHash: null,
            activationNumber: 1,
            turnNumber: 1,
            stepNumber: 2,
            commandId: 'command.i3.agent-wait.generic-dispatch',
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(beforeGenericPaths);
      const started = settlePreparedAgentWaitStart(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      expect(started.value.dispatch.key.authorityWatermarkHash).toBe(
        hashCanonical({
          kind: 'agent_wait_v1',
          children: [
            {
              childRunId: secondChild.childRunId,
              revision: secondChild.revision,
              contentHash: secondChild.contentHash,
              state: secondChild.state,
            },
            {
              childRunId: child.childRunId,
              revision: child.revision,
              contentHash: child.contentHash,
              state: child.state,
            },
          ],
        }),
      );
      expect(started.value).toMatchObject({
        conditionMet: false,
        deadlineAt: '2026-08-16T12:05:00.000Z',
        observedAt: NOW,
        remainingMs: 300_000,
      });
      expect(eventTypes(started.events)).toEqual([
        'usage',
        'step_ended',
        'step_started',
        'tool_call_ref',
      ]);
      const beforeReplay = serializedDatabaseRows(database);
      expect(
        settlePreparedAgentWaitStart(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          prepared.response,
        ).value.dispatch.id,
      ).toBe(started.value.dispatch.id);
      expect(serializedDatabaseRows(database)).toBe(beforeReplay);

      const inbox = fixture.data.runs.listInbox(child.childRunId)[0];
      if (inbox === undefined) throw new Error('Expected an initial child Inbox');
      const childContext = activateAcceptedRun(
        fixture.data,
        child.childRunId,
        inbox.id,
        inbox.sequence,
      );
      const active = getRun(fixture.data, child.childRunId, 'agent-wait-child-active');
      const terminal = fixture.data.runs.terminalize(
        {
          runId: child.childRunId,
          expectedRevision: active.revision,
          status: 'completed',
          summary: 'The waited public result is ready.',
          resultIds: [],
          commandId: 'command.i3.agent-wait.child.terminal',
        },
        childContext,
      );
      expect(
        fixture.data.harness.loadAgentWaitBoundary(started.value.dispatch.id).conditionMet,
      ).toBe(false);
      const secondInbox = fixture.data.runs.listInbox(secondChild.childRunId)[0];
      if (secondInbox === undefined) throw new Error('Expected a second child Inbox');
      const secondContext = activateAcceptedRun(
        fixture.data,
        secondChild.childRunId,
        secondInbox.id,
        secondInbox.sequence,
      );
      const secondActive = getRun(
        fixture.data,
        secondChild.childRunId,
        'agent-wait-second-child-active',
      );
      const secondTerminal = fixture.data.runs.terminalize(
        {
          runId: secondChild.childRunId,
          expectedRevision: secondActive.revision,
          status: 'blocked',
          summary: 'The second wait target needs outside input.',
          resultIds: [],
          commandId: 'command.i3.agent-wait.second-child.terminal',
        },
        secondContext,
      );
      const settled = fixture.data.harness.settleAgentWaitBoundary(
        {
          dispatchOperationId: started.value.dispatch.id,
          activationNumber: 1,
          completedAt: '2026-08-16T12:05:00.000Z',
          commandId: 'command.i3.agent-wait.settle',
        },
        context,
      );
      expect(AgentWaitDefinition.parseSuccess(settled.value.result)).toMatchObject({
        timedOut: false,
        children: [
          {
            child: {
              childRunId: secondChild.childRunId,
              revision: secondTerminal.revision,
              contentHash: secondTerminal.contentHash,
              state: 'blocked',
              objectiveHash: secondTerminal.acceptedSource.directionHash,
            },
            displayName: secondTerminal.displayName,
            summary: 'The second wait target needs outside input.',
          },
          {
            child: {
              childRunId: child.childRunId,
              revision: terminal.revision,
              contentHash: terminal.contentHash,
              state: 'completed',
              objectiveHash: terminal.acceptedSource.directionHash,
            },
            displayName: terminal.displayName,
            summary: 'The waited public result is ready.',
          },
        ],
      });
      expect(eventTypes(settled.events)).toEqual(['tool_result_ref', 'tool_summary', 'step_ended']);
      const beforeSettlementReplay = serializedDatabaseRows(database);
      const replayed = fixture.data.harness.settleAgentWaitBoundary(
        {
          dispatchOperationId: started.value.dispatch.id,
          activationNumber: 1,
          completedAt: '2026-08-16T12:05:00.000Z',
          commandId: 'command.i3.agent-wait.settle',
        },
        context,
      );
      expect(replayed.value.result).toEqual(settled.value.result);
      expect(replayed.events).toEqual([]);
      expect(serializedDatabaseRows(database)).toBe(beforeSettlementReplay);
      expect(serializedDatabaseRows(database)).not.toContain(AGENT_SPAWN_SENTINEL);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('settles agent.wait any_change only after a requested child vector changes', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const parent = getRun(fixture.data, runId, 'agent-wait-any-change-parent');
      const child = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-wait.any-change.child.spawn',
          spawnInput: agentSpawnInput(parent.revision, {
            displayName: 'Changing wait target',
            objective: 'Change the public child state after the wait begins.',
            publicSummary: 'Waiting for state to change.',
          }),
        },
        context,
      ).child;
      const prepared = prepareRunningAgentWait(
        fixture.data,
        context,
        runId,
        [child.childRunId],
        'any-change',
        { condition: 'any_change' },
      );
      const started = settlePreparedAgentWaitStart(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      expect(
        fixture.data.harness.loadAgentWaitBoundary(started.value.dispatch.id).conditionMet,
      ).toBe(false);
      const inbox = fixture.data.runs.listInbox(child.childRunId)[0];
      if (inbox === undefined) throw new Error('Expected an initial child Inbox');
      activateAcceptedRun(fixture.data, child.childRunId, inbox.id, inbox.sequence);
      expect(
        fixture.data.harness.loadAgentWaitBoundary(started.value.dispatch.id).conditionMet,
      ).toBe(true);
      const settled = fixture.data.harness.settleAgentWaitBoundary(
        {
          dispatchOperationId: started.value.dispatch.id,
          activationNumber: 1,
          completedAt: NOW,
          commandId: 'command.i3.agent-wait.any-change.settle',
        },
        context,
      );
      expect(AgentWaitDefinition.parseSuccess(settled.value.result)).toMatchObject({
        timedOut: false,
        children: [
          {
            child: expect.objectContaining({ childRunId: child.childRunId, state: 'running' }),
            summary: 'Waiting for state to change.',
          },
        ],
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('keeps agent.wait targeted, then times out only after its final authoritative read', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const parent = getRun(fixture.data, runId, 'agent-wait-timeout-parent');
      const target = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-wait.timeout.target.spawn',
          spawnInput: agentSpawnInput(parent.revision, {
            displayName: 'Requested wait target',
            objective: 'Remain unchanged while another child moves.',
          }),
        },
        context,
      ).child;
      const afterTarget = getRun(fixture.data, runId, 'agent-wait-timeout-after-target');
      const unrelated = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: afterTarget.revision,
          commandId: 'command.i3.agent-wait.timeout.unrelated.spawn',
          spawnInput: agentSpawnInput(afterTarget.revision, {
            displayName: 'Unrequested child',
            objective: 'Change without satisfying the selected wait.',
          }),
        },
        context,
      ).child;
      const prepared = prepareRunningAgentWait(
        fixture.data,
        context,
        runId,
        [target.childRunId],
        'timeout',
        { condition: 'any_change', timeoutMs: 1 },
      );
      const started = settlePreparedAgentWaitStart(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      const inbox = fixture.data.runs.listInbox(unrelated.childRunId)[0];
      if (inbox === undefined) throw new Error('Expected an initial unrelated child Inbox');
      activateAcceptedRun(fixture.data, unrelated.childRunId, inbox.id, inbox.sequence);
      expect(
        fixture.data.harness.loadAgentWaitBoundary(started.value.dispatch.id).conditionMet,
      ).toBe(false);
      const settled = fixture.data.harness.settleAgentWaitBoundary(
        {
          dispatchOperationId: started.value.dispatch.id,
          activationNumber: 1,
          completedAt: '2026-08-16T12:00:00.001Z',
          commandId: 'command.i3.agent-wait.timeout.settle',
        },
        context,
      );
      expect(AgentWaitDefinition.parseSuccess(settled.value.result)).toMatchObject({
        timedOut: true,
        children: [
          {
            child: expect.objectContaining({ childRunId: target.childRunId, state: 'accepted' }),
          },
        ],
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('rejects agent.wait targets outside the strict descendant lineage without settlement writes', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const prepared = prepareRunningAgentWait(fixture.data, context, runId, [runId], 'self');
      const database = getJourneyTestDatabase(fixture.store);
      const before = serializedDatabaseRows(database);
      expect(() =>
        settlePreparedAgentWaitStart(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          prepared.response,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(before);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('atomically cancels an active descendant subtree leaf-first and preserves terminal descendants', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const parent = getRun(fixture.data, runId, 'agent-cancel-parent');
      const target = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-cancel.target.spawn',
          spawnInput: agentSpawnInput(parent.revision, {
            displayName: 'Cancellation target',
            objective: 'Private cancellation target objective.',
            publicSummary: 'Preparing cancellable delegated work.',
          }),
        },
        context,
      ).child;
      let targetRun = getRun(fixture.data, target.childRunId, 'agent-cancel-target');
      const activeGrandchild = fixture.data.runs.spawnChild(
        {
          parentRunId: target.childRunId,
          expectedParentRevision: targetRun.revision,
          commandId: 'command.i3.agent-cancel.active-grandchild.spawn',
          spawnInput: agentSpawnInput(targetRun.revision, {
            displayName: 'Active grandchild',
            objective: 'Private active grandchild objective.',
          }),
        },
        commanderContext(target.childRunId),
      ).child;
      targetRun = getRun(fixture.data, target.childRunId, 'agent-cancel-target-after-active');
      const completedGrandchild = fixture.data.runs.spawnChild(
        {
          parentRunId: target.childRunId,
          expectedParentRevision: targetRun.revision,
          commandId: 'command.i3.agent-cancel.completed-grandchild.spawn',
          spawnInput: agentSpawnInput(targetRun.revision, {
            displayName: 'Completed grandchild',
            objective: 'Private completed grandchild objective.',
          }),
        },
        commanderContext(target.childRunId),
      ).child;
      const completedInbox = fixture.data.runs.listInbox(completedGrandchild.childRunId)[0];
      if (completedInbox === undefined) throw new Error('Expected completed grandchild Inbox');
      const completedContext = activateAcceptedRun(
        fixture.data,
        completedGrandchild.childRunId,
        completedInbox.id,
        completedInbox.sequence,
      );
      const completedActive = getRun(
        fixture.data,
        completedGrandchild.childRunId,
        'agent-cancel-completed-active',
      );
      fixture.data.runs.terminalize(
        {
          runId: completedGrandchild.childRunId,
          expectedRevision: completedActive.revision,
          status: 'completed',
          summary: 'Completed evidence remains available.',
          resultIds: [],
          commandId: 'command.i3.agent-cancel.completed-grandchild.terminal',
        },
        completedContext,
      );

      const reason = 'The parent no longer needs this delegated branch.';
      const prepared = prepareRunningAgentCancel(
        fixture.data,
        context,
        runId,
        target.childRunId,
        'subtree',
        { reason },
      );
      const database = getJourneyTestDatabase(fixture.store);
      const beforeGenericPaths = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: prepared.prepared.value.id,
            requestHash: prepared.prepared.value.requestHash,
            response: prepared.response,
            settledAt: NOW,
            commandId: 'command.i3.agent-cancel.generic-settle',
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: prepared.prepared.value.id,
            providerCallId: prepared.providerCallId,
            toolId: AgentCancelDefinition.id,
            input: AgentCancelDefinition.parseInput({
              childRunId: target.childRunId,
              expectedRevision: getRun(
                fixture.data,
                target.childRunId,
                'agent-cancel-generic-target',
              ).revision,
              reason,
            }),
            authorityWatermarkHash: null,
            activationNumber: 1,
            turnNumber: 1,
            stepNumber: 2,
            commandId: 'command.i3.agent-cancel.generic-dispatch',
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(beforeGenericPaths);
      const settled = settlePreparedAgentCancel(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      const children = settled.value.result.children;
      expect(children[0]).toMatchObject({
        child: { childRunId: target.childRunId, state: 'cancelled' },
        summary: reason,
      });
      expect(children.map(({ child }) => child.childRunId)).toEqual([
        target.childRunId,
        activeGrandchild.childRunId,
        completedGrandchild.childRunId,
      ]);
      expect(
        children.find(({ child }) => child.childRunId === activeGrandchild.childRunId),
      ).toMatchObject({ child: { state: 'cancelled' }, summary: reason });
      expect(
        children.find(({ child }) => child.childRunId === completedGrandchild.childRunId),
      ).toMatchObject({
        child: { state: 'completed' },
        summary: 'Completed evidence remains available.',
      });
      expect(settled.value.result).toMatchObject({
        retainedArtifactCount: 0,
        unknownOperationCount: 0,
      });
      expect(fixture.data.runs.listInbox(target.childRunId)[0]).toMatchObject({
        state: 'cancelled',
      });
      expect(fixture.data.runs.listInbox(activeGrandchild.childRunId)[0]).toMatchObject({
        state: 'cancelled',
      });
      expect(fixture.data.runs.listInbox(completedGrandchild.childRunId)[0]).toMatchObject({
        state: 'consumed',
      });
      expect(settled.run.status).toBe('running');

      const beforeReplay = serializedDatabaseRows(database);
      expect(
        settlePreparedAgentCancel(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          prepared.response,
        ).value.result,
      ).toEqual(settled.value.result);
      expect(serializedDatabaseRows(database)).toBe(beforeReplay);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('requests owner cancellation once and reports authoritative unknown operations without a provider call', async () => {
    const generation = new UnknownGenerationProvider();
    const dependencies = { ...createJourneyDependencies(), generation };
    const { fixture, context, project, runId } = await activeHarnessFixture(null, dependencies);
    try {
      const generationProviderId = 'provider.i3.agent-cancel-generation';
      createHostCatalogProvisioning(fixture.store, { now: () => NOW }).registerProviderProfile({
        id: generationProviderId,
        displayName: 'Agent cancel generation provider',
        providerKind: generation.providerKind,
        model: 'video-model',
        status: 'ready',
      });
      const target = fixture.data.production.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.agent-cancel.production',
          method: 'production.apply',
          input: {
            action: 'create',
            projectId: project.id,
            expectedProjectRevision: project.revision,
            value: {
              objectType: 'shot',
              content: {
                title: 'Cancellable generation target',
                description: 'A public generation target.',
                durationMs: null,
                shotSize: null,
                cameraMovement: null,
              },
            },
            relations: [],
          },
        },
        userContext,
      ).result.object;
      const parent = getRun(fixture.data, runId, 'agent-cancel-operation-parent');
      const child = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-cancel.operation-child.spawn',
          spawnInput: agentSpawnInput(parent.revision, {
            displayName: 'Unknown operation child',
            objective: 'Own one unknown generation Operation before cancellation.',
          }),
        },
        context,
      ).child;
      const spec: GenerationSpec = {
        kind: 'image',
        task: 'create',
        target: {
          authority: 'production',
          id: target.id,
          revision: target.revision,
          contentHash: target.contentHash,
        },
        prompt: 'A restrained moonlit harbor.',
        negativePrompt: null,
        references: [],
        provider: { providerId: generationProviderId, model: 'video-model' },
        outputCount: 1,
        seed: 7,
        width: 1_280,
        height: 720,
        guidanceScale: null,
        sourceMaskRefId: null,
      };
      const quote = await fixture.data.generation.quote({
        runId: child.childRunId,
        request: { spec },
      });
      const currentProject = fixture.data.projects.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3.agent-cancel.project-current',
        method: 'project.get',
        input: { projectId: project.id },
      }).result;
      const unknown = await fixture.data.generation.submit(
        {
          runId: child.childRunId,
          commandId: 'command.i3.agent-cancel.generation-submit',
          request: {
            spec,
            quote: quote.quote,
            expectedProjectRevision: currentProject.revision,
            promptProvenance: {
              sourceObjectId: spec.target.id,
              sourceRevision: spec.target.revision,
              sourceHash: spec.target.contentHash,
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
                  filename: 'cancelled-generation.png',
                  displayName: 'Cancelled generation',
                  folderId: null,
                  tags: ['cancelled'],
                },
                projectMediaRef: {
                  label: 'Cancelled generation',
                  collections: [],
                  roles: ['generated_candidate'],
                  notes: '',
                },
              },
            ],
          },
        },
        commanderContext(child.childRunId),
      );
      expect(unknown.state).toBe('unknown');
      const prepared = prepareRunningAgentCancel(
        fixture.data,
        context,
        runId,
        child.childRunId,
        'unknown-operation',
      );
      const database = getJourneyTestDatabase(fixture.store);
      const beforeInjectedFailure = serializedDatabaseRows(database);
      database.exec(`
        CREATE TEMP TRIGGER fail_agent_cancel_boundary
        BEFORE UPDATE ON runs
        BEGIN
          SELECT RAISE(ABORT, 'injected agent.cancel boundary failure');
        END;
      `);
      expect(() =>
        settlePreparedAgentCancel(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          prepared.response,
        ),
      ).toThrow('injected agent.cancel boundary failure');
      database.exec('DROP TRIGGER fail_agent_cancel_boundary');
      expect(serializedDatabaseRows(database)).toBe(beforeInjectedFailure);
      const settled = settlePreparedAgentCancel(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      expect(settled.value.result.unknownOperationCount).toBe(1);
      expect(generation.cancelCalls).toBe(0);
      const operation = fixture.data.operations.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3.agent-cancel.operation-current',
        method: 'operation.get',
        input: { operations: [unknown.operation] },
      }).result.operations[0];
      expect(operation).toMatchObject({ state: 'unknown', cancelRequested: true });
      const beforeReplay = serializedDatabaseRows(database);
      expect(
        settlePreparedAgentCancel(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          prepared.response,
        ).value.result,
      ).toEqual(settled.value.result);
      expect(serializedDatabaseRows(database)).toBe(beforeReplay);
      expect(generation.cancelCalls).toBe(0);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('rejects a late descendant Model response after cancellation without effects or fabricated usage', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const parent = getRun(fixture.data, runId, 'agent-cancel-late-parent');
      const child = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-cancel.late.spawn',
          spawnInput: agentSpawnInput(parent.revision),
        },
        context,
      ).child;
      const childInbox = fixture.data.runs.listInbox(child.childRunId)[0];
      if (childInbox === undefined) throw new Error('Expected late-response child Inbox');
      const childContext = activateAcceptedRun(
        fixture.data,
        child.childRunId,
        childInbox.id,
        childInbox.sequence,
      );
      const childSnapshot = fixture.data.harness.loadActivation(child.childRunId, 1);
      const childAttempt = prepareModelAttempt(
        fixture.data,
        {
          request: requestFor(childSnapshot, 'model-attempt.i3.agent-cancel.late-child', [
            HistoryQueryDefinition.id,
          ]),
          quote: USAGE,
          commandId: 'command.i3.agent-cancel.late-child.prepare',
        },
        childContext,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: childAttempt.value.id,
          requestHash: childAttempt.value.requestHash,
          commandId: 'command.i3.agent-cancel.late-child.running',
        },
        childContext,
      );

      const prepared = prepareRunningAgentCancel(
        fixture.data,
        context,
        runId,
        child.childRunId,
        'late-response',
      );
      settlePreparedAgentCancel(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      expect(
        loadModelAttemptRecord(getJourneyTestDatabase(fixture.store), childAttempt.value.id),
      ).toMatchObject({
        state: 'running',
        response: null,
        usage: null,
      });

      const database = getJourneyTestDatabase(fixture.store);
      const beforeLateResponse = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: childAttempt.value.id,
            requestHash: childAttempt.value.requestHash,
            response: {
              version: 1,
              events: [
                { type: 'assistant_delta', publicText: 'This late response must be discarded.' },
                { type: 'usage', usage: USAGE },
                { type: 'model_completed', finishReason: 'stop' },
              ],
            },
            settledAt: NOW,
            commandId: 'command.i3.agent-cancel.late-child.settle',
          },
          childContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(beforeLateResponse);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('rejects self, stale, and terminal agent.cancel targets without settlement writes', async () => {
    await expectAgentCancelRejectionWithoutWrites('self', ({ runId }) => ({
      childRunId: runId,
      code: 'INVALID_REQUEST',
    }));
    await expectAgentCancelRejectionWithoutWrites('stale', ({ fixture, context, runId }) => {
      const parent = getRun(fixture.data, runId, 'agent-cancel-stale-parent');
      const child = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-cancel.stale.spawn',
          spawnInput: agentSpawnInput(parent.revision),
        },
        context,
      ).child;
      return {
        childRunId: child.childRunId,
        overrides: { expectedRevision: child.revision + 1 },
        code: 'REVISION_CONFLICT',
      };
    });
    await expectAgentCancelRejectionWithoutWrites('terminal', ({ fixture, context, runId }) => {
      const parent = getRun(fixture.data, runId, 'agent-cancel-terminal-parent');
      const child = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-cancel.terminal.spawn',
          spawnInput: agentSpawnInput(parent.revision),
        },
        context,
      ).child;
      const current = getRun(fixture.data, child.childRunId, 'agent-cancel-terminal-child');
      fixture.data.runs.terminalize(
        {
          runId: child.childRunId,
          expectedRevision: current.revision,
          status: 'cancelled',
          summary: 'Already cancelled.',
          resultIds: [],
          commandId: 'command.i3.agent-cancel.terminal.end',
        },
        commanderContext(child.childRunId),
      );
      return { childRunId: child.childRunId, code: 'INVALID_REQUEST' };
    });
    await expectAgentCancelRejectionWithoutWrites('sibling', ({ fixture, context, runId }) => {
      const parent = getRun(fixture.data, runId, 'agent-cancel-sibling-parent');
      const sender = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-cancel.sibling.sender',
          spawnInput: agentSpawnInput(parent.revision),
        },
        context,
      ).child;
      const parentAfterSender = getRun(
        fixture.data,
        runId,
        'agent-cancel-sibling-parent-after-sender',
      );
      const sibling = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parentAfterSender.revision,
          commandId: 'command.i3.agent-cancel.sibling.target',
          spawnInput: agentSpawnInput(parentAfterSender.revision),
        },
        context,
      ).child;
      const senderInbox = fixture.data.runs.listInbox(sender.childRunId)[0];
      if (senderInbox === undefined) throw new Error('Expected sender Inbox');
      return {
        senderRunId: sender.childRunId,
        senderContext: activateAcceptedRun(
          fixture.data,
          sender.childRunId,
          senderInbox.id,
          senderInbox.sequence,
        ),
        childRunId: sibling.childRunId,
        code: 'INVALID_REQUEST',
      };
    });
  }, 120_000);

  it('rejects an agent.cancel subtree larger than the complete 100-Run result boundary', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const parent = getRun(fixture.data, runId, 'agent-cancel-large-parent');
      const target = fixture.data.runs.spawnChild(
        {
          parentRunId: runId,
          expectedParentRevision: parent.revision,
          commandId: 'command.i3.agent-cancel.large.target',
          spawnInput: agentSpawnInput(parent.revision),
        },
        context,
      ).child;
      for (let index = 0; index < 100; index += 1) {
        const current = getRun(
          fixture.data,
          target.childRunId,
          `agent-cancel-large-target-${index}`,
        );
        fixture.data.runs.spawnChild(
          {
            parentRunId: target.childRunId,
            expectedParentRevision: current.revision,
            commandId: `command.i3.agent-cancel.large.child-${index}`,
            spawnInput: agentSpawnInput(current.revision, {
              displayName: `Large subtree child ${index}`,
              objective: `Private large-subtree objective ${index}.`,
            }),
          },
          commanderContext(target.childRunId),
        );
      }
      const prepared = prepareRunningAgentCancel(
        fixture.data,
        context,
        runId,
        target.childRunId,
        'large-subtree',
      );
      const database = getJourneyTestDatabase(fixture.store);
      const before = serializedDatabaseRows(database);
      expect(() =>
        settlePreparedAgentCancel(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          prepared.response,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(before);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 180_000);

  it('persists a private tool.program boundary, rejects generic paths, and validates program-origin lineage', async () => {
    const { fixture, context, project, runId } = await activeHarnessFixture();
    try {
      const programContextRef = {
        authority: 'project' as const,
        id: project.id,
        revision: project.revision,
        contentHash: project.contentHash,
      };
      const prepared = prepareRunningToolProgram(fixture.data, context, runId, 'private-happy', {
        contextRefs: [programContextRef],
      });
      const database = getJourneyTestDatabase(fixture.store);
      const beforeDedicatedBoundary = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: prepared.prepared.value.id,
            requestHash: prepared.prepared.value.requestHash,
            response: prepared.response,
            settledAt: NOW,
            commandId: 'command.i3.tool-program.private-happy.generic-settle',
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: prepared.prepared.value.id,
            providerCallId: prepared.providerCallId,
            toolId: ToolProgramDefinition.id,
            input: prepared.program,
            authorityWatermarkHash: null,
            activationNumber: 1,
            turnNumber: 1,
            stepNumber: 2,
            commandId: 'command.i3.tool-program.private-happy.generic-dispatch',
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(beforeDedicatedBoundary);

      const settled = settlePreparedToolProgram(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      const childRunId = settled.value.child.child.id;
      const modelResponse = database
        .prepare('SELECT response_v1_json FROM model_attempts WHERE id = ?')
        .get(prepared.prepared.value.id) as { readonly response_v1_json: string };
      const dispatchInput = database
        .prepare('SELECT input_v1_json FROM dispatch_operations WHERE id = ?')
        .get(settled.value.dispatch.id) as { readonly input_v1_json: string };
      const ciphertext = database
        .prepare('SELECT ciphertext FROM private_recovery_envelopes WHERE run_id = ?')
        .get(childRunId) as { readonly ciphertext: Uint8Array };
      const durableCall = (
        JSON.parse(modelResponse.response_v1_json) as {
          readonly events: readonly Record<string, unknown>[];
        }
      ).events.find(({ type }) => type === 'tool_call');

      expect(durableCall).toMatchObject({
        type: 'tool_call',
        toolId: ToolProgramDefinition.id,
        canonicalArguments: expect.objectContaining({
          version: 1,
          calls: [
            expect.objectContaining({
              stepId: 'step.tool-program.history',
              callIndex: 0,
              toolId: HistoryQueryDefinition.id,
              toolVersion: HistoryQueryDefinition.version,
            }),
          ],
        }),
      });
      expect(JSON.parse(dispatchInput.input_v1_json)).toMatchObject({
        version: 1,
        calls: [
          expect.objectContaining({
            callIndex: 0,
            toolId: HistoryQueryDefinition.id,
            toolVersion: HistoryQueryDefinition.version,
          }),
        ],
      });
      expect(JSON.stringify(durableCall)).not.toContain('invocation');
      expect(JSON.stringify(durableCall)).not.toContain(TOOL_PROGRAM_SENTINEL);
      expect(serializedDatabaseRows(database)).not.toContain(TOOL_PROGRAM_SENTINEL);
      expect(Buffer.from(ciphertext.ciphertext).includes(Buffer.from(TOOL_PROGRAM_SENTINEL))).toBe(
        false,
      );
      expect(fixture.data.harness.materializePrivateRunContext(childRunId)).toMatchObject({
        kind: 'tool_program',
        program: {
          parentDispatchOperationId: settled.value.dispatch.id,
          program: prepared.program,
        },
      });
      database
        .prepare('UPDATE dispatch_operations SET tool_version = ? WHERE id = ?')
        .run('9.0.0', settled.value.dispatch.id);
      expect(() => fixture.data.harness.materializePrivateRunContext(childRunId)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
      database
        .prepare('UPDATE dispatch_operations SET tool_version = ? WHERE id = ?')
        .run(ToolProgramDefinition.version, settled.value.dispatch.id);
      expect(fixture.data.harness.materializePrivateRunContext(childRunId)).toMatchObject({
        kind: 'tool_program',
      });
      expect(() => fixture.data.harness.materializePrivateModelContext(childRunId)).toThrowError(
        expect.objectContaining({ code: 'INVALID_REQUEST' }),
      );

      const beforeReplay = serializedDatabaseRows(database);
      const replay = settlePreparedToolProgram(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      expect(replay.events).toEqual([]);
      expect(replay.value.dispatch.id).toBe(settled.value.dispatch.id);
      expect(serializedDatabaseRows(database)).toBe(beforeReplay);

      const storedManifest = database
        .prepare('SELECT manifest_v1_json FROM context_manifests WHERE run_id = ?')
        .get(childRunId) as { readonly manifest_v1_json: string };
      const tamperedManifest = {
        ...(JSON.parse(storedManifest.manifest_v1_json) as Record<string, unknown>),
        selectedContext: [],
      };
      database
        .prepare('UPDATE context_manifests SET manifest_v1_json = ? WHERE run_id = ?')
        .run(JSON.stringify(tamperedManifest), childRunId);
      expect(() =>
        settlePreparedToolProgram(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          prepared.response,
        ),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
      database
        .prepare('UPDATE context_manifests SET manifest_v1_json = ? WHERE run_id = ?')
        .run(storedManifest.manifest_v1_json, childRunId);
      expect(serializedDatabaseRows(database)).toBe(beforeReplay);

      const changed = toolProgramResponse(
        toolProgramInput(prepared.program.expectedRunRevision, {
          displayName: 'Changed private Tool Program semantics',
        }),
        prepared.providerCallId,
      );
      expect(() =>
        settlePreparedToolProgram(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          changed,
        ),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(serializedDatabaseRows(database)).toBe(beforeReplay);

      const scheduled = fixture.data.harness.startToolProgramChildActivation(
        settled.value.dispatch.id,
        context,
      );
      const childContext = commanderContext(childRunId);
      const childSnapshot = fixture.data.harness.loadActivation(
        childRunId,
        scheduled.activation.activationNumber,
      );
      expect(childSnapshot.manifest.selectedContext).toEqual([
        { ref: programContextRef, role: 'target' },
      ]);
      fixture.data.harness.consumeInbox(
        {
          runId: childRunId,
          expectedRevision: childSnapshot.run.revision,
          inboxMessageId: scheduled.activation.triggerInboxMessageId,
          sequence: scheduled.activation.triggerInboxSequence,
          commandId: 'command.i3.tool-program.private-happy.child-consume',
        },
        childContext,
      );
      const advanced = fixture.data.harness.advanceToolProgramChild(
        {
          runId: childRunId,
          activationNumber: scheduled.activation.activationNumber,
          commandId: 'command.i3.tool-program.private-happy.child-prepare',
        },
        childContext,
      ).value;
      if (advanced.kind !== 'execute') throw new Error('Expected a Tool Program call step');
      const childDispatch = advanced.calls[0]!;
      expect(childDispatch.dispatch.origin).toEqual({
        kind: 'tool_program',
        parentDispatchOperationId: settled.value.dispatch.id,
        programStepId: 'step.tool-program.history',
        programCallIndex: 0,
      });
      expect(
        fixture.data.harness.loadActivation(childRunId, scheduled.activation.activationNumber)
          .dispatches,
      ).toEqual([
        expect.objectContaining({
          id: childDispatch.dispatch.id,
          origin: childDispatch.dispatch.origin,
        }),
      ]);

      const childOutcome = HistoryQueryDefinition.parseOutcome({
        status: 'succeeded',
        data: { items: [], nextCursor: null },
      });
      const childSettlement = {
        dispatchOperationId: childDispatch.dispatch.id,
        activationNumber: childDispatch.activationNumber,
        turnNumber: childDispatch.turnNumber,
        stepNumber: childDispatch.stepNumber,
        outcome: childOutcome,
        completedAt: NOW,
        commandId: 'command.i3.tool-program.private-happy.child-settle',
      };
      fixture.data.harness.settleToolProgramChildCall(childSettlement, childContext);
      const beforeChildReplay = serializedDatabaseRows(database);
      expect(
        fixture.data.harness.settleToolProgramChildCall(childSettlement, childContext),
      ).toMatchObject({ events: [], value: { outcome: childOutcome } });
      expect(serializedDatabaseRows(database)).toBe(beforeChildReplay);

      database.exec('PRAGMA ignore_check_constraints = ON');
      database
        .prepare('UPDATE dispatch_operations SET origin_model_attempt_id = ? WHERE id = ?')
        .run(settled.value.attempt.id, childDispatch.dispatch.id);
      database.exec('PRAGMA ignore_check_constraints = OFF');
      expect(() => loadOperationDispatch(database, childDispatch.dispatch.id)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );

      const missingKeyData = createJourneyDataAccess(
        fixture.store,
        fixture.dependencies,
        fixture.createId,
        createAes256GcmPrivateRecoveryCodec({
          encryptionKeyId: 'key.i3.tool-program.unavailable',
          encryptionKey: new Uint8Array(32).fill(0x7a),
          resolveEncryptionKey: () => undefined,
        }),
      );
      const wrongKeyData = createJourneyDataAccess(
        fixture.store,
        fixture.dependencies,
        fixture.createId,
        createJourneyPrivateRecoveryCodec(new Uint8Array(32).fill(0x6b)),
      );
      expect(() => missingKeyData.harness.materializePrivateRunContext(childRunId)).toThrowError(
        expect.objectContaining({ code: 'SECURITY_CONFIGURATION_FAILED' }),
      );
      expect(() => wrongKeyData.harness.materializePrivateRunContext(childRunId)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
      database
        .prepare('UPDATE private_recovery_envelopes SET ciphertext = ? WHERE run_id = ?')
        .run(Buffer.alloc(ciphertext.ciphertext.byteLength, 0x7f), childRunId);
      expect(() => fixture.data.harness.materializePrivateRunContext(childRunId)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('accepts a bounded multi-call tool.program AST and persists every hash-only call projection', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const prepared = prepareRunningToolProgram(fixture.data, context, runId, 'unsupported-shape');
      const firstStep = prepared.program.steps[0];
      if (firstStep?.operation !== 'call') throw new Error('Expected the Tool Program call step');
      const multiCallProgram = ToolProgramDefinition.parseInput({
        ...prepared.program,
        steps: [
          firstStep,
          {
            ...firstStep,
            stepId: 'step.tool-program.second-history',
          },
        ],
      });
      const database = getJourneyTestDatabase(fixture.store);
      const settled = settlePreparedToolProgram(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        toolProgramResponse(multiCallProgram, prepared.providerCallId),
      );
      expect(settled.value.child.child.publicSummary).toBe('Execute a bounded Tool Program.');
      expect(settled.value.dispatch.key.input).toMatchObject({
        calls: [
          {
            stepId: firstStep.stepId,
            callIndex: 0,
            toolId: HistoryQueryDefinition.id,
            toolVersion: HistoryQueryDefinition.version,
          },
          {
            stepId: 'step.tool-program.second-history',
            callIndex: 0,
            toolId: HistoryQueryDefinition.id,
            toolVersion: HistoryQueryDefinition.version,
          },
        ],
      });
      expect(serializedDatabaseRows(database)).not.toContain(TOOL_PROGRAM_SENTINEL);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects a non-read tool.program before persisting its boundary', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const prepared = prepareRunningToolProgram(fixture.data, context, runId, 'non-read');
      const program = ToolProgramDefinition.parseInput({
        ...prepared.program,
        steps: [
          {
            stepId: 'step.tool-program.non-read',
            operation: 'call',
            invocation: {
              toolId: TaskManageDefinition.id,
              toolVersion: TaskManageDefinition.version,
              input: TaskManageDefinition.examples.input,
            },
          },
        ],
      });
      const database = getJourneyTestDatabase(fixture.store);
      const before = serializedDatabaseRows(database);

      expect(() =>
        settlePreparedToolProgram(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          toolProgramResponse(program, prepared.providerCallId),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(before);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    {
      name: 'an unavailable child tool version',
      invocation: { toolVersion: '9.0.0' },
    },
    {
      name: 'a non-canonical child tool input',
      invocation: { input: { sources: [] } },
    },
  ])('rejects $name before persisting a tool.program boundary', async ({ invocation }) => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const prepared = prepareRunningToolProgram(fixture.data, context, runId, 'invalid-child');
      const first = prepared.program.steps[0];
      if (first?.operation !== 'call') throw new Error('Expected the Tool Program call step');
      const program = ToolProgramDefinition.parseInput({
        ...prepared.program,
        steps: [{ ...first, invocation: { ...first.invocation, ...invocation } }],
      });
      const database = getJourneyTestDatabase(fixture.store);
      const before = serializedDatabaseRows(database);

      expect(() =>
        settlePreparedToolProgram(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          toolProgramResponse(program, prepared.providerCallId),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(before);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it('rejects a non-canonical parent tool.program input before persisting its boundary', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const prepared = prepareRunningToolProgram(
        fixture.data,
        context,
        runId,
        'non-canonical-parent',
      );
      const database = getJourneyTestDatabase(fixture.store);
      const before = serializedDatabaseRows(database);
      const response = toolProgramResponse(
        {
          ...prepared.program,
          displayName: ` ${prepared.program.displayName} `,
        },
        prepared.providerCallId,
      );

      expect(() =>
        settlePreparedToolProgram(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          response,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(before);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('rolls back a failed private tool.program boundary and rejects a stale request snapshot', async () => {
    const rollback = await activeHarnessFixture();
    try {
      const prepared = prepareRunningToolProgram(
        rollback.fixture.data,
        rollback.context,
        rollback.runId,
        'rollback',
      );
      const database = getJourneyTestDatabase(rollback.fixture.store);
      const before = serializedDatabaseRows(database);
      database.exec(`
        CREATE TEMP TRIGGER fail_tool_program_private_recovery
        BEFORE INSERT ON private_recovery_envelopes
        BEGIN
          SELECT RAISE(ABORT, 'injected tool program private recovery failure');
        END;
      `);
      expect(() =>
        settlePreparedToolProgram(
          rollback.fixture.data,
          rollback.context,
          prepared.prepared,
          prepared.providerCallId,
          prepared.response,
        ),
      ).toThrow('injected tool program private recovery failure');
      expect(serializedDatabaseRows(database)).toBe(before);
      database.exec('DROP TRIGGER fail_tool_program_private_recovery');
    } finally {
      rollback.fixture.store.close();
      await rm(rollback.fixture.directory, { recursive: true, force: true });
    }

    const stale = await activeHarnessFixture();
    try {
      const prepared = prepareRunningToolProgram(
        stale.fixture.data,
        stale.context,
        stale.runId,
        'stale',
      );
      queueHarnessFollowup(stale.fixture.data, stale.runId, 'tool-program-stale');
      const database = getJourneyTestDatabase(stale.fixture.store);
      const before = serializedDatabaseRows(database);
      expect(() =>
        settlePreparedToolProgram(
          stale.fixture.data,
          stale.context,
          prepared.prepared,
          prepared.providerCallId,
          prepared.response,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(before);
    } finally {
      stale.fixture.store.close();
      await rm(stale.fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects raw agent.spawn from the generic settlement and dispatch paths without writes', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const prepared = prepareRunningAgentSpawn(fixture.data, context, runId, 'generic-reject');
      const database = getJourneyTestDatabase(fixture.store);
      const before = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: prepared.prepared.value.id,
            requestHash: prepared.prepared.value.requestHash,
            response: prepared.response,
            settledAt: NOW,
            commandId: 'command.i3.agent-spawn.generic-reject.settle',
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(before);
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: prepared.prepared.value.id,
            providerCallId: prepared.providerCallId,
            toolId: AgentSpawnDefinition.id,
            input: prepared.spawnInput,
            authorityWatermarkHash: null,
            activationNumber: 1,
            turnNumber: 1,
            stepNumber: 2,
            commandId: 'command.i3.agent-spawn.generic-reject.dispatch',
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(before);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('replays an identical agent.spawn raw response without writes and rejects changed private or safe semantics', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const prepared = prepareRunningAgentSpawn(fixture.data, context, runId, 'replay');
      const first = settlePreparedAgentSpawn(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      const database = getJourneyTestDatabase(fixture.store);
      const beforeReplay = serializedDatabaseRows(database);
      const replay = settlePreparedAgentSpawn(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      expect(replay.events).toEqual([]);
      expect(replay.value.dispatch.id).toBe(first.value.dispatch.id);
      expect(replay.value.child.child.childRunId).toBe(first.value.child.child.childRunId);
      expect(serializedDatabaseRows(database)).toBe(beforeReplay);

      const changedObjective = agentSpawnResponse(
        agentSpawnInput(prepared.spawnInput.expectedParentRevision, {
          objective: `${AGENT_SPAWN_SENTINEL}.changed`,
        }),
        prepared.providerCallId,
      );
      const changedSafeField = agentSpawnResponse(
        agentSpawnInput(prepared.spawnInput.expectedParentRevision, {
          publicSummary: 'A different durable public summary.',
        }),
        prepared.providerCallId,
      );
      for (const response of [changedObjective, changedSafeField]) {
        expect(() =>
          settlePreparedAgentSpawn(
            fixture.data,
            context,
            prepared.prepared,
            prepared.providerCallId,
            response,
          ),
        ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
        expect(serializedDatabaseRows(database)).toBe(beforeReplay);
      }
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('rolls back the entire agent.spawn boundary when private recovery insertion fails', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const prepared = prepareRunningAgentSpawn(fixture.data, context, runId, 'rollback');
      const database = getJourneyTestDatabase(fixture.store);
      const before = serializedDatabaseRows(database);
      database.exec(`
        CREATE TEMP TRIGGER fail_agent_spawn_private_recovery
        BEFORE INSERT ON private_recovery_envelopes
        BEGIN
          SELECT RAISE(ABORT, 'injected agent spawn private recovery failure');
        END;
      `);
      expect(() =>
        settlePreparedAgentSpawn(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          prepared.response,
        ),
      ).toThrow('injected agent spawn private recovery failure');
      expect(serializedDatabaseRows(database)).toBe(before);
      database.exec('DROP TRIGGER fail_agent_spawn_private_recovery');
      const settled = settlePreparedAgentSpawn(
        fixture.data,
        context,
        prepared.prepared,
        prepared.providerCallId,
        prepared.response,
      );
      expect(settled.value.child.child.childRunId).toMatch(/^run\./);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects an agent.spawn settlement after the request snapshot is externally superseded', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const prepared = prepareRunningAgentSpawn(fixture.data, context, runId, 'stale-snapshot');
      const currentAfterBoundary = getRun(fixture.data, runId, 'agent-spawn-stale-boundary');
      expect(currentAfterBoundary.revision).toBe(prepared.prepared.value.request.runRevision + 1);
      queueHarnessFollowup(fixture.data, runId, 'agent-spawn-stale-snapshot');
      const database = getJourneyTestDatabase(fixture.store);
      const afterExternalChange = serializedDatabaseRows(database);
      expect(() =>
        settlePreparedAgentSpawn(
          fixture.data,
          context,
          prepared.prepared,
          prepared.providerCallId,
          prepared.response,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(afterExternalChange);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('keys identical runtime reads by model origin while preserving their semantic fingerprint', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      const prepared = prepareModelAttempt(
        fixture.data,
        {
          request: requestFor(snapshot, 'model-attempt.i3.dispatch-identity', ['project.get']),
          quote: USAGE,
          commandId: 'command.i3.dispatch-identity.model.prepare',
        },
        context,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          commandId: 'command.i3.dispatch-identity.model.running',
        },
        context,
      );
      fixture.data.harness.settleModelAttempt(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          response: {
            version: 1,
            events: [
              {
                type: 'tool_call',
                providerCallId: 'provider-call.identity.first',
                toolId: 'project.get',
                canonicalArguments: { include: ['metadata'] },
              },
              {
                type: 'tool_call',
                providerCallId: 'provider-call.identity.second',
                toolId: 'project.get',
                canonicalArguments: { include: ['metadata'] },
              },
              { type: 'usage', usage: USAGE },
              { type: 'model_completed', finishReason: 'tool_calls' },
            ],
          },
          settledAt: NOW,
          commandId: 'command.i3.dispatch-identity.model.settle',
        },
        context,
      );
      const firstInput = {
        runId,
        modelAttemptId: prepared.value.id,
        providerCallId: 'provider-call.identity.first',
        toolId: 'project.get' as const,
        input: { include: ['metadata'] },
        authorityWatermarkHash: null,
        activationNumber: 1,
        turnNumber: 1,
        stepNumber: 2,
        commandId: 'command.i3.dispatch-identity.first.prepare',
      };
      const first = fixture.data.harness.prepareDispatch(firstInput, context);
      const dispatchCount = rowCount(fixture.store, 'dispatch_operations');
      expect(fixture.data.harness.prepareDispatch(firstInput, context)).toEqual({
        value: first.value,
        run: first.run,
        events: [],
      });
      expect(rowCount(fixture.store, 'dispatch_operations')).toBe(dispatchCount);
      fixture.data.harness.settleDispatch(
        {
          dispatchOperationId: first.value.id,
          modelAttemptId: prepared.value.id,
          providerCallId: 'provider-call.identity.first',
          outcome: {
            status: 'recovery_required',
            operation: null,
            message: 'Close the first read without executing it.',
          },
          activationNumber: 1,
          turnNumber: 1,
          stepNumber: 2,
          completedAt: NOW,
          commandId: 'command.i3.dispatch-identity.first.settle',
        },
        context,
      );
      const second = fixture.data.harness.prepareDispatch(
        {
          ...firstInput,
          providerCallId: 'provider-call.identity.second',
          stepNumber: 3,
          commandId: 'command.i3.dispatch-identity.second.prepare',
        },
        context,
      );
      expect(second.value.id).not.toBe(first.value.id);
      expect(second.value.key.fingerprint).toBe(first.value.key.fingerprint);
      expect(first.value.idempotencyKey).toBe(
        hashCanonical({
          version: 1,
          kind: 'runtime_dispatch',
          operationFingerprint: first.value.key.fingerprint,
          modelAttemptId: prepared.value.id,
          providerCallId: 'provider-call.identity.first',
        }),
      );
      expect(second.value.idempotencyKey).toBe(
        hashCanonical({
          version: 1,
          kind: 'runtime_dispatch',
          operationFingerprint: second.value.key.fingerprint,
          modelAttemptId: prepared.value.id,
          providerCallId: 'provider-call.identity.second',
        }),
      );
      expect(second.value.idempotencyKey).not.toBe(first.value.idempotencyKey);

      const database = getJourneyTestDatabase(fixture.store);
      database
        .prepare('UPDATE dispatch_operations SET idempotency_key = ? WHERE id = ?')
        .run(second.value.key.fingerprint, second.value.id);
      expect(() => loadOperationDispatch(database, second.value.id)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('atomically creates one pending Skill proposal and exactly replays it after denial', async () => {
    const { fixture, context, project, runId } = await activeHarnessFixture();
    try {
      const database = getJourneyTestDatabase(fixture.store);
      const settings = database
        .prepare('SELECT revision, content_hash FROM project_settings WHERE project_id = ?')
        .get(project.id) as { revision: number; content_hash: string };
      const input = {
        name: 'Continuity reviewer',
        description: 'Review shots for visible continuity errors.',
        content: 'Check props, wardrobe, lighting, and screen direction.',
      };
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      const modelVisibleRunRevision = snapshot.run.revision;
      const prepared = prepareModelAttempt(
        fixture.data,
        {
          request: requestFor(snapshot, 'model-attempt.i3.skill-propose', ['skill.propose']),
          quote: USAGE,
          commandId: 'command.i3.skill-propose.model.prepare',
        },
        context,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          commandId: 'command.i3.skill-propose.model.running',
        },
        context,
      );
      const settled = fixture.data.harness.settleModelAttempt(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          response: {
            version: 1,
            events: [
              {
                type: 'tool_call',
                providerCallId: 'provider-call.skill-propose',
                toolId: 'skill.propose',
                canonicalArguments: input,
              },
              { type: 'usage', usage: USAGE },
              { type: 'model_completed', finishReason: 'tool_calls' },
            ],
          },
          settledAt: NOW,
          commandId: 'command.i3.skill-propose.model.settle',
        },
        context,
      );
      expect(settled.run.revision).toBeGreaterThan(modelVisibleRunRevision);
      const proposalInput = {
        runId,
        modelAttemptId: prepared.value.id,
        providerCallId: 'provider-call.skill-propose',
        input,
        activationNumber: 1,
        turnNumber: 1,
        stepNumber: 2,
        commandId: 'command.i3.skill-propose.prepare',
      };
      const proposal = fixture.data.harness.prepareSkillProposal(proposalInput, context);
      expect(proposal.run).toMatchObject({
        status: 'waiting_confirmation',
        revision: settled.run.revision + 1,
      });
      expect(proposal.value).toMatchObject({
        immutableInputHash: proposal.value.dispatch.key.inputHash,
        target: {
          kind: 'skill_registration',
          projectId: project.id,
          expectedProjectSettingsRevision: settings.revision,
          expectedProjectSettingsContentHash: settings.content_hash,
          skill: {
            name: input.name,
            description: input.description,
            version: '1.0.0',
            contentHash: hashUtf8(input.content),
            provenance: 'project',
            trust: 'reviewed',
            content: input.content,
            createdAt: NOW,
          },
        },
        dispatch: {
          guardOutcome: 'confirmation_required',
          outcome: {
            status: 'permission_required',
            confirmationId: proposal.value.confirmationId,
          },
        },
      });
      expect(eventTypes(proposal.events)).toEqual([
        'step_started',
        'tool_call_ref',
        'tool_result_ref',
        'tool_summary',
        'step_ended',
        'confirmation_requested',
        'activation_changed',
        'run_state_changed',
      ]);
      expect(
        proposal.events.flatMap((event) => {
          if (event.payloadState.state !== 'available') return [];
          return canonicalJson(event.payloadState.payload).includes(input.content)
            ? [event.payloadState.payload.type]
            : [];
        }),
      ).toEqual(['confirmation_requested']);
      expect(fixture.data.harness.loadActivation(runId, 1).activation).toMatchObject({
        state: 'ended',
        endReason: 'waiting',
      });
      expect(rowCount(fixture.store, 'skills')).toBe(0);
      expect(rowCount(fixture.store, 'skill_effective_versions')).toBe(0);
      expect(rowCount(fixture.store, 'skill_enablements')).toBe(0);
      expect(
        database
          .prepare('SELECT revision, content_hash FROM project_settings WHERE project_id = ?')
          .get(project.id),
      ).toEqual(settings);

      const objective = database
        .prepare('SELECT objective_message_id FROM runs WHERE id = ?')
        .get(runId) as { objective_message_id: string };
      database
        .prepare(
          `UPDATE run_interactions
           SET state = 'answered', answer_message_id = ?, resolved_at = ?
           WHERE id = ?`,
        )
        .run(
          objective.objective_message_id,
          NOW,
          (
            database
              .prepare('SELECT interaction_id FROM run_confirmations WHERE id = ?')
              .get(proposal.value.confirmationId) as { interaction_id: string }
          ).interaction_id,
        );
      database
        .prepare(
          `UPDATE run_confirmations
           SET decision = 'denied', decided_by_message_id = ?, decided_at = ?
           WHERE id = ?`,
        )
        .run(objective.objective_message_id, NOW, proposal.value.confirmationId);
      const counts = {
        dispatches: rowCount(fixture.store, 'dispatch_operations'),
        confirmations: rowCount(fixture.store, 'run_confirmations'),
        interactions: rowCount(fixture.store, 'run_interactions'),
        events: rowCount(fixture.store, 'run_events'),
      };
      expect(fixture.data.harness.prepareSkillProposal(proposalInput, context)).toEqual({
        value: proposal.value,
        run: proposal.run,
        events: [],
      });
      expect(rowCount(fixture.store, 'dispatch_operations')).toBe(counts.dispatches);
      expect(rowCount(fixture.store, 'run_confirmations')).toBe(counts.confirmations);
      expect(rowCount(fixture.store, 'run_interactions')).toBe(counts.interactions);
      expect(rowCount(fixture.store, 'run_events')).toBe(counts.events);

      database
        .prepare("UPDATE dispatch_operations SET guard_outcome = 'allowed' WHERE id = ?")
        .run(proposal.value.dispatch.id);
      expect(() => loadOperationDispatch(database, proposal.value.dispatch.id)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
      database
        .prepare("UPDATE dispatch_operations SET guard_outcome = 'denied' WHERE id = ?")
        .run(proposal.value.dispatch.id);
      expect(() => loadOperationDispatch(database, proposal.value.dispatch.id)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
      database
        .prepare(
          "UPDATE dispatch_operations SET guard_outcome = 'confirmation_required' WHERE id = ?",
        )
        .run(proposal.value.dispatch.id);
      database
        .prepare('UPDATE run_confirmations SET immutable_input_hash = ? WHERE id = ?')
        .run(hashUtf8('different-input'), proposal.value.confirmationId);
      expect(() => loadOperationDispatch(database, proposal.value.dispatch.id)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps direct dispatch idempotency on the semantic fingerprint', async () => {
    const { fixture, runId } = await activeHarnessFixture();
    try {
      const database = getJourneyTestDatabase(fixture.store);
      const key = resolveOperationDispatchKey(database, {
        runId,
        toolId: 'project.get',
        input: { include: ['budget'] },
      });
      database
        .prepare(
          `INSERT INTO dispatch_operations (
             id, run_id, tool_id, tool_version, guard_outcome, idempotency_key,
             input_hash, input_v1_json, authority_watermark_hash, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'allowed', ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          'dispatch-operation.i3.direct-fingerprint',
          runId,
          key.toolId,
          key.toolVersion,
          key.fingerprint,
          key.inputHash,
          key.inputJson,
          NOW,
          NOW,
        );
      const direct = loadOperationDispatch(database, 'dispatch-operation.i3.direct-fingerprint');
      expect(direct.idempotencyKey).toBe(key.fingerprint);
      expect(findOperationByFingerprint(database, key)?.id).toBe(direct.id);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('atomically closes a prepared frontier and exactly replays the recovery command', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      const prepared = prepareModelAttempt(
        fixture.data,
        {
          request: requestFor(snapshot, 'model-attempt.i3.prepared-recovery', []),
          quote: USAGE,
          commandId: 'command.i3.prepared.prepare',
        },
        context,
      );
      const input = recoveryInput(
        fixture.data.harness.loadActivation(runId, 1),
        'command.i3.prepared.recover',
      );
      const closed = fixture.data.harness.closeInterruptedActivation(input, context);
      expect(closed.frontier).toEqual({
        kind: 'model_attempt',
        attemptId: prepared.value.id,
        state: 'prepared',
      });
      expect(closed.run).toMatchObject({ status: 'blocked' });
      expect(closed.activation).toMatchObject({
        state: 'ended',
        endReason: 'process_exit',
      });
      expect(eventTypes(closed.events)).toEqual([
        'usage',
        'step_ended',
        'blocker',
        'turn_ended',
        'activation_changed',
        'run_state_changed',
        'terminal_summary',
      ]);
      expect(
        loadModelAttemptRecord(getJourneyTestDatabase(fixture.store), prepared.value.id),
      ).toMatchObject({
        state: 'failed',
        usage: {
          inputTokens: { state: 'known', value: 0 },
          outputTokens: { state: 'known', value: 0 },
          cost: { state: 'known', value: '0', currency: 'USD' },
        },
        response: {
          events: [
            { type: 'usage' },
            {
              type: 'model_failed',
              typedCode: 'process_interrupted',
              retrySafety: 'before_submission',
              providerState: 'not_submitted',
            },
          ],
        },
      });

      const counts = {
        events: rowCount(fixture.store, 'run_events'),
        ledger: rowCount(fixture.store, 'run_resource_entries'),
      };
      const replay = fixture.data.harness.closeInterruptedActivation(input, context);
      expect(replay).toEqual(closed);
      expect(rowCount(fixture.store, 'run_events')).toBe(counts.events);
      expect(rowCount(fixture.store, 'run_resource_entries')).toBe(counts.ledger);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('closes a running frontier with unknown exposure and no provider replay', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      const prepared = prepareModelAttempt(
        fixture.data,
        {
          request: requestFor(snapshot, 'model-attempt.i3.running-recovery', []),
          quote: USAGE,
          commandId: 'command.i3.running.prepare',
        },
        context,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          commandId: 'command.i3.running.mark',
        },
        context,
      );
      const closed = fixture.data.harness.closeInterruptedActivation(
        recoveryInput(fixture.data.harness.loadActivation(runId, 1), 'command.i3.running.recover'),
        context,
      );
      expect(closed.frontier).toMatchObject({ kind: 'model_attempt', state: 'running' });
      const attempt = loadModelAttemptRecord(
        getJourneyTestDatabase(fixture.store),
        prepared.value.id,
      );
      expect(attempt).toMatchObject({
        state: 'unknown',
        usage: UNKNOWN_USAGE,
        response: {
          events: [
            { type: 'usage' },
            {
              type: 'model_failed',
              typedCode: 'provider_state_unknown',
              retrySafety: 'never',
              providerState: 'unknown',
            },
          ],
        },
      });
      expect(eventTypes(closed.events).slice(0, 2)).toEqual(['usage', 'step_ended']);
      expect(loadRunResourceEntries(getJourneyTestDatabase(fixture.store), runId)).toHaveLength(9);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('does not rewrite an already unknown frontier or duplicate its ledger closure', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      const prepared = prepareModelAttempt(
        fixture.data,
        {
          request: requestFor(snapshot, 'model-attempt.i3.unknown-recovery', []),
          quote: USAGE,
          commandId: 'command.i3.unknown.prepare',
        },
        context,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          commandId: 'command.i3.unknown.mark',
        },
        context,
      );
      fixture.data.harness.settleModelAttempt(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          response: {
            version: 1,
            events: [
              { type: 'usage', usage: UNKNOWN_USAGE },
              {
                type: 'model_failed',
                typedCode: 'provider_state_unknown',
                retrySafety: 'never',
                providerState: 'unknown',
              },
            ],
          },
          settledAt: NOW,
          commandId: 'command.i3.unknown.settle',
        },
        context,
      );
      const database = getJourneyTestDatabase(fixture.store);
      const beforeAttempt = loadModelAttemptRecord(database, prepared.value.id);
      const beforeLedger = loadRunResourceEntries(database, runId);
      const closed = fixture.data.harness.closeInterruptedActivation(
        recoveryInput(fixture.data.harness.loadActivation(runId, 1), 'command.i3.unknown.recover'),
        context,
      );
      expect(closed.frontier).toMatchObject({ kind: 'model_attempt', state: 'unknown' });
      expect(eventTypes(closed.events)).toEqual([
        'blocker',
        'turn_ended',
        'activation_changed',
        'run_state_changed',
        'terminal_summary',
      ]);
      expect(loadModelAttemptRecord(database, prepared.value.id)).toEqual(beforeAttempt);
      expect(loadRunResourceEntries(database, runId)).toEqual(beforeLedger);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('settles only an open project.get dispatch as recovery-required', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      let snapshot = fixture.data.harness.loadActivation(runId, 1);
      const prepared = prepareModelAttempt(
        fixture.data,
        {
          request: requestFor(snapshot, 'model-attempt.i3.dispatch-recovery', ['project.get']),
          quote: USAGE,
          commandId: 'command.i3.dispatch-model.prepare',
        },
        context,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          commandId: 'command.i3.dispatch-model.mark',
        },
        context,
      );
      fixture.data.harness.settleModelAttempt(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          response: {
            version: 1,
            events: [
              {
                type: 'tool_call',
                providerCallId: 'provider-call-recovery-project-get',
                toolId: 'project.get',
                canonicalArguments: { include: ['metadata'] },
              },
              { type: 'usage', usage: USAGE },
              { type: 'model_completed', finishReason: 'tool_calls' },
            ],
          },
          settledAt: NOW,
          commandId: 'command.i3.dispatch-model.settle',
        },
        context,
      );
      snapshot = fixture.data.harness.loadActivation(runId, 1);
      const dispatch = fixture.data.harness.prepareDispatch(
        {
          runId,
          modelAttemptId: prepared.value.id,
          providerCallId: 'provider-call-recovery-project-get',
          toolId: 'project.get',
          input: { include: ['metadata'] },
          authorityWatermarkHash: null,
          activationNumber: 1,
          turnNumber: 1,
          stepNumber: 2,
          commandId: 'command.i3.dispatch-recovery.prepare',
        },
        context,
      );
      const closed = fixture.data.harness.closeInterruptedActivation(
        recoveryInput(
          fixture.data.harness.loadActivation(runId, 1),
          'command.i3.dispatch-recovery.close',
        ),
        context,
      );
      expect(closed.frontier).toEqual({
        kind: 'dispatch',
        dispatchOperationId: dispatch.value.id,
        toolId: 'project.get',
      });
      expect(eventTypes(closed.events)).toEqual([
        'tool_result_ref',
        'tool_summary',
        'step_ended',
        'blocker',
        'turn_ended',
        'activation_changed',
        'run_state_changed',
        'terminal_summary',
      ]);
      expect(
        loadOperationDispatch(getJourneyTestDatabase(fixture.store), dispatch.value.id).outcome,
      ).toEqual({
        status: 'recovery_required',
        operation: null,
        message:
          'Recovery required after process interruption. Uncommitted provider or tool work was not replayed.',
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('cold-reopens and atomically closes one committed undispatched safe R call', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    let reopened: TargetStore | undefined;
    try {
      const attempt = commitModelResponse(
        fixture.data,
        context,
        runId,
        'undispatched.project-search',
        [ProjectSearchDefinition.id],
        {
          version: 1,
          events: [
            {
              type: 'tool_call',
              providerCallId: 'provider-call.undispatched.project-search',
              toolId: ProjectSearchDefinition.id,
              canonicalArguments: ProjectSearchDefinition.examples.input,
            },
            { type: 'usage', usage: USAGE },
            { type: 'model_completed', finishReason: 'tool_calls' },
          ],
        },
      );
      expect(fixture.data.harness.loadActivation(runId, 1)).toMatchObject({
        recoveryRequired: true,
        modelAttempts: [{ id: attempt.id, state: 'succeeded' }],
        dispatches: [],
      });

      fixture.store.close();
      reopened = await openTargetStore(fixture.databasePath);
      const data = createJourneyDataAccess(reopened, fixture.dependencies, fixture.createId);
      const interrupted = data.harness.loadActivation(runId, 1);
      expect(interrupted.recoveryRequired).toBe(true);
      const input = recoveryInput(interrupted, 'command.i3.undispatched.project-search.close');
      const closed = data.harness.closeInterruptedActivation(input, context);

      expect(closed.frontier).toMatchObject({ kind: 'dispatch', toolId: 'project.search' });
      expect(eventTypes(closed.events)).toEqual([
        'step_started',
        'tool_call_ref',
        'tool_result_ref',
        'tool_summary',
        'step_ended',
        'blocker',
        'turn_ended',
        'activation_changed',
        'run_state_changed',
        'terminal_summary',
      ]);
      if (closed.frontier.kind !== 'dispatch') throw new Error('Expected a dispatch frontier');
      const dispatch = loadOperationDispatch(
        getJourneyTestDatabase(reopened),
        closed.frontier.dispatchOperationId,
      );
      expect(dispatch).toMatchObject({
        originModelAttemptId: attempt.id,
        originProviderCallId: 'provider-call.undispatched.project-search',
        guardOutcome: 'allowed',
        key: {
          toolId: 'project.search',
          authorityWatermarkHash: null,
          input: ProjectSearchDefinition.examples.input,
        },
        outcome: { status: 'recovery_required' },
      });
      expect(
        interrupted.journal.filter(
          ({ payloadState }) =>
            payloadState.state === 'available' && payloadState.payload.type === 'usage',
        ),
      ).toHaveLength(1);
      expect(
        closed.events.filter(
          ({ payloadState }) =>
            payloadState.state === 'available' && payloadState.payload.type === 'usage',
        ),
      ).toEqual([]);

      const counts = {
        events: rowCount(reopened, 'run_events'),
        ledger: rowCount(reopened, 'run_resource_entries'),
        dispatches: rowCount(reopened, 'dispatch_operations'),
      };
      expect(data.harness.closeInterruptedActivation(input, context)).toEqual(closed);
      expect({
        events: rowCount(reopened, 'run_events'),
        ledger: rowCount(reopened, 'run_resource_entries'),
        dispatches: rowCount(reopened, 'dispatch_operations'),
      }).toEqual(counts);
    } finally {
      reopened?.close();
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    {
      name: 'receipt-aware operation.get',
      materializedToolIds: [OperationGetDefinition.id],
      calls: [
        {
          providerCallId: 'provider-call.undispatched.operation-get',
          toolId: OperationGetDefinition.id,
          canonicalArguments: OperationGetDefinition.examples.input,
        },
      ],
    },
    {
      name: 'multiple safe R calls',
      materializedToolIds: [ProjectSearchDefinition.id, RunInspectDefinition.id],
      calls: [
        {
          providerCallId: 'provider-call.undispatched.project-search.first',
          toolId: ProjectSearchDefinition.id,
          canonicalArguments: ProjectSearchDefinition.examples.input,
        },
        {
          providerCallId: 'provider-call.undispatched.run-inspect.second',
          toolId: RunInspectDefinition.id,
          canonicalArguments: RunInspectDefinition.examples.input,
        },
      ],
    },
    {
      name: 'invalid safe R input',
      materializedToolIds: [ProjectSearchDefinition.id],
      calls: [
        {
          providerCallId: 'provider-call.undispatched.project-search.invalid',
          toolId: ProjectSearchDefinition.id,
          canonicalArguments: { ...ProjectSearchDefinition.examples.input, query: '' },
        },
      ],
    },
  ])(
    'rejects undispatched $name recovery with zero writes',
    async ({ name, materializedToolIds, calls }) => {
      const { fixture, context, runId } = await activeHarnessFixture();
      try {
        commitModelResponse(
          fixture.data,
          context,
          runId,
          `undispatched.invalid.${name.replaceAll(' ', '-')}`,
          materializedToolIds,
          {
            version: 1,
            events: [
              ...calls.map((call) => ({ type: 'tool_call' as const, ...call })),
              { type: 'usage', usage: USAGE },
              { type: 'model_completed', finishReason: 'tool_calls' },
            ],
          },
        );
        const before = fixture.data.harness.loadActivation(runId, 1);
        expect(before.recoveryRequired).toBe(true);
        const counts = {
          events: rowCount(fixture.store, 'run_events'),
          ledger: rowCount(fixture.store, 'run_resource_entries'),
          dispatches: rowCount(fixture.store, 'dispatch_operations'),
        };
        expect(() =>
          fixture.data.harness.closeInterruptedActivation(
            recoveryInput(before, `command.i3.undispatched.invalid.${name.replaceAll(' ', '-')}`),
            context,
          ),
        ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
        expect(fixture.data.harness.loadActivation(runId, 1)).toEqual(before);
        expect({
          events: rowCount(fixture.store, 'run_events'),
          ledger: rowCount(fixture.store, 'run_resource_entries'),
          dispatches: rowCount(fixture.store, 'dispatch_operations'),
        }).toEqual(counts);
      } finally {
        fixture.store.close();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('rejects a later Model Attempt behind an undispatched safe R call with zero writes', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      commitModelResponse(
        fixture.data,
        context,
        runId,
        'undispatched.non-tail.first',
        [ProjectSearchDefinition.id],
        {
          version: 1,
          events: [
            {
              type: 'tool_call',
              providerCallId: 'provider-call.undispatched.non-tail',
              toolId: ProjectSearchDefinition.id,
              canonicalArguments: ProjectSearchDefinition.examples.input,
            },
            { type: 'usage', usage: USAGE },
            { type: 'model_completed', finishReason: 'tool_calls' },
          ],
        },
      );
      const before = fixture.data.harness.loadActivation(runId, 1);
      expect(before.recoveryRequired).toBe(true);
      const counts = {
        events: rowCount(fixture.store, 'run_events'),
        ledger: rowCount(fixture.store, 'run_resource_entries'),
        attempts: rowCount(fixture.store, 'model_attempts'),
        dispatches: rowCount(fixture.store, 'dispatch_operations'),
      };
      expect(() =>
        commitModelResponse(fixture.data, context, runId, 'undispatched.non-tail.second', [], {
          version: 1,
          events: [
            { type: 'assistant_delta', publicText: 'Later committed response.' },
            { type: 'usage', usage: USAGE },
            { type: 'model_completed', finishReason: 'stop' },
          ],
        }),
      ).toThrowError(
        expect.objectContaining({
          code: 'INVALID_REQUEST',
          message: 'Model Attempt preparation cannot cross a recovery frontier',
        }),
      );
      expect(fixture.data.harness.loadActivation(runId, 1)).toEqual(before);
      expect({
        events: rowCount(fixture.store, 'run_events'),
        ledger: rowCount(fixture.store, 'run_resource_entries'),
        attempts: rowCount(fixture.store, 'model_attempts'),
        dispatches: rowCount(fixture.store, 'dispatch_operations'),
      }).toEqual(counts);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it.each(RECOVERABLE_READS)(
    'recovery-closes frozen safe read $toolId without executing it',
    async ({ toolId, input }) => {
      const { fixture, context, runId } = await activeHarnessFixture();
      try {
        const snapshot = fixture.data.harness.loadActivation(runId, 1);
        const prepared = prepareModelAttempt(
          fixture.data,
          {
            request: requestFor(snapshot, `model-attempt.i3.recovery.${toolId}`, [toolId]),
            quote: USAGE,
            commandId: `command.i3.recovery.${toolId}.model.prepare`,
          },
          context,
        );
        fixture.data.harness.markModelAttemptRunning(
          {
            attemptId: prepared.value.id,
            requestHash: prepared.value.requestHash,
            commandId: `command.i3.recovery.${toolId}.model.running`,
          },
          context,
        );
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: prepared.value.id,
            requestHash: prepared.value.requestHash,
            response: {
              version: 1,
              events: [
                {
                  type: 'tool_call',
                  providerCallId: `provider-call.recovery.${toolId}`,
                  toolId,
                  canonicalArguments: input,
                },
                { type: 'usage', usage: USAGE },
                { type: 'model_completed', finishReason: 'tool_calls' },
              ],
            },
            settledAt: NOW,
            commandId: `command.i3.recovery.${toolId}.model.settle`,
          },
          context,
        );
        const dispatch = fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: prepared.value.id,
            providerCallId: `provider-call.recovery.${toolId}`,
            toolId,
            input,
            authorityWatermarkHash: null,
            activationNumber: 1,
            turnNumber: 1,
            stepNumber: 2,
            commandId: `command.i3.recovery.${toolId}.dispatch.prepare`,
          },
          context,
        );
        const closed = fixture.data.harness.closeInterruptedActivation(
          recoveryInput(
            fixture.data.harness.loadActivation(runId, 1),
            `command.i3.recovery.${toolId}.close`,
          ),
          context,
        );
        expect(closed.frontier).toEqual({
          kind: 'dispatch',
          dispatchOperationId: dispatch.value.id,
          toolId,
        });
        expect(
          loadOperationDispatch(getJourneyTestDatabase(fixture.store), dispatch.value.id).outcome,
        ).toMatchObject({ status: 'recovery_required' });
      } finally {
        fixture.store.close();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it.each([
    {
      name: 'non-R task.manage',
      toolId: TaskManageDefinition.id,
      input: TaskManageDefinition.examples.input,
    },
    {
      name: 'receipt-aware operation.get',
      toolId: OperationGetDefinition.id,
      input: OperationGetDefinition.examples.input,
    },
  ])(
    'rejects $name recovery without writing any closure state',
    async ({ toolId, input }) => {
      const { fixture, context, runId } = await activeHarnessFixture();
      try {
        const snapshot = fixture.data.harness.loadActivation(runId, 1);
        const prepared = prepareModelAttempt(
          fixture.data,
          {
            request: requestFor(snapshot, `model-attempt.i3.recovery.${toolId}`, [toolId]),
            quote: USAGE,
            commandId: `command.i3.recovery.${toolId}.model.prepare`,
          },
          context,
        );
        fixture.data.harness.markModelAttemptRunning(
          {
            attemptId: prepared.value.id,
            requestHash: prepared.value.requestHash,
            commandId: `command.i3.recovery.${toolId}.model.running`,
          },
          context,
        );
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: prepared.value.id,
            requestHash: prepared.value.requestHash,
            response: {
              version: 1,
              events: [
                {
                  type: 'tool_call',
                  providerCallId: `provider-call.recovery.${toolId}`,
                  toolId,
                  canonicalArguments: input,
                },
                { type: 'usage', usage: USAGE },
                { type: 'model_completed', finishReason: 'tool_calls' },
              ],
            },
            settledAt: NOW,
            commandId: `command.i3.recovery.${toolId}.model.settle`,
          },
          context,
        );
        const dispatch = fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: prepared.value.id,
            providerCallId: `provider-call.recovery.${toolId}`,
            toolId,
            input,
            authorityWatermarkHash: null,
            activationNumber: 1,
            turnNumber: 1,
            stepNumber: 2,
            commandId: `command.i3.recovery.${toolId}.dispatch.prepare`,
          },
          context,
        );
        const recovery = recoveryInput(
          fixture.data.harness.loadActivation(runId, 1),
          `command.i3.recovery.${toolId}.close`,
        );
        const before = {
          events: rowCount(fixture.store, 'run_events'),
          ledger: rowCount(fixture.store, 'run_resource_entries'),
          dispatches: rowCount(fixture.store, 'dispatch_operations'),
        };
        expect(() =>
          fixture.data.harness.closeInterruptedActivation(recovery, context),
        ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
        expect({
          events: rowCount(fixture.store, 'run_events'),
          ledger: rowCount(fixture.store, 'run_resource_entries'),
          dispatches: rowCount(fixture.store, 'dispatch_operations'),
        }).toEqual(before);
        expect(
          loadOperationDispatch(getJourneyTestDatabase(fixture.store), dispatch.value.id).outcome,
        ).toBeNull();
        expect(fixture.data.harness.loadActivation(runId, 1).run.status).toBe('running');
      } finally {
        fixture.store.close();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('accepts one replay-safe retry root per source and supports A to B to C lineage', async () => {
    const { fixture, context, media, project, runId } = await activeHarnessFixture('attachment');
    try {
      if (media === null) throw new Error('Expected an accepted attachment');
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      prepareModelAttempt(
        fixture.data,
        {
          request: requestFor(snapshot, 'model-attempt.i3.retry-source-a', []),
          quote: USAGE,
          commandId: 'command.i3.retry-a.prepare',
        },
        context,
      );
      const closedA = fixture.data.harness.closeInterruptedActivation(
        recoveryInput(fixture.data.harness.loadActivation(runId, 1), 'command.i3.retry-a.close'),
        context,
      );
      if (closedA.run.publicEventHead === null) throw new Error('Expected source A event head');
      const acceptAInput = {
        sourceRunId: closedA.run.id,
        expectedSourceRevision: closedA.run.revision,
        expectedSourceContentHash: closedA.run.contentHash,
        expectedSourceEventHead: closedA.run.publicEventHead,
        commandId: 'command.i3.retry-a.accept',
      };
      fixture.data.projectMedia.detach(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.retry-attachment.detach',
          method: 'media.project.detach',
          input: {
            projectMediaRefId: media.ref.id,
            expectedRevision: media.ref.revision,
            expectedContentHash: media.ref.contentHash,
          },
        },
        userContext,
      );
      const liveSkill = {
        skillId: 'skill.live-after-crash',
        name: 'Live post-crash Skill',
        description: 'Must be visible only to later fresh root Runs.',
        version: '1.0.0',
        content: 'Use only in root Runs accepted after this setting change.',
        contentHash: hashUtf8('Use only in root Runs accepted after this setting change.'),
        provenance: 'installed' as const,
        trust: 'reviewed' as const,
        createdAt: NOW,
      };
      createHostCatalogProvisioning(fixture.store, { now: () => NOW }).registerSkill({
        document: liveSkill,
        projectId: null,
      });
      const liveSettings = fixture.data.projects.getSettings({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3.retry-live-skill.settings.get',
        method: 'project.settings.get',
        input: { projectId: project.id },
      }).result;
      fixture.data.projects.updateSettings(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.retry-live-skill.settings.update',
          method: 'project.settings.update',
          input: {
            projectId: project.id,
            expectedRevision: liveSettings.revision,
            expectedContentHash: liveSettings.contentHash,
            defaultProviderProfileId: liveSettings.defaultProviderProfileId,
            formatPolicy: liveSettings.formatPolicy,
            permission: liveSettings.permission,
            budget: liveSettings.budget,
            enabledSkills: [{ id: liveSkill.skillId, version: liveSkill.version }],
          },
        },
        userContext,
      );
      const before = {
        messages: rowCount(fixture.store, 'messages'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      };
      const acceptedB = fixture.data.harness.acceptCrashRetryRun(acceptAInput, context);
      expect(acceptedB).toMatchObject({
        created: true,
        sourceRun: { id: closedA.run.id },
        retryRun: {
          retryOfRunId: closedA.run.id,
          retrySeedHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          status: 'accepted',
        },
        manifest: {
          retryOfRunId: closedA.run.id,
          retrySeedHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        inbox: { state: 'queued', sequence: 1 },
      });
      expect(acceptedB.retryRun.acceptedSource).toEqual(closedA.run.acceptedSource);
      expect(acceptedB.manifest.attachments).toEqual([media.snapshot]);
      expect(acceptedB.catalog.skills).toEqual([]);
      expect(acceptedB.manifest.projectSettings.enabledSkills).toEqual([
        { id: liveSkill.skillId, version: liveSkill.version },
      ]);
      expect(rowCount(fixture.store, 'messages')).toBe(before.messages);
      expect(rowCount(fixture.store, 'project_events')).toBe(before.projectEvents);

      const replayB = fixture.data.harness.acceptCrashRetryRun(
        { ...acceptAInput, commandId: 'command.i3.retry-a.accept-again' },
        context,
      );
      expect(replayB).toMatchObject({ created: false, retryRun: { id: acceptedB.retryRun.id } });
      expect(rowCount(fixture.store, 'messages')).toBe(before.messages);
      expect(rowCount(fixture.store, 'project_events')).toBe(before.projectEvents);

      const contextB = activateAcceptedRun(
        fixture.data,
        acceptedB.retryRun.id,
        acceptedB.inbox.id,
        acceptedB.inbox.sequence,
      );
      const snapshotB = fixture.data.harness.loadActivation(acceptedB.retryRun.id, 1);
      prepareModelAttempt(
        fixture.data,
        {
          request: requestFor(snapshotB, 'model-attempt.i3.retry-source-b', []),
          quote: USAGE,
          commandId: 'command.i3.retry-b.prepare',
        },
        contextB,
      );
      const closedB = fixture.data.harness.closeInterruptedActivation(
        recoveryInput(
          fixture.data.harness.loadActivation(acceptedB.retryRun.id, 1),
          'command.i3.retry-b.close',
        ),
        contextB,
      );
      if (closedB.run.publicEventHead === null) throw new Error('Expected source B event head');
      const acceptedC = fixture.data.harness.acceptCrashRetryRun(
        {
          sourceRunId: closedB.run.id,
          expectedSourceRevision: closedB.run.revision,
          expectedSourceContentHash: closedB.run.contentHash,
          expectedSourceEventHead: closedB.run.publicEventHead,
          commandId: 'command.i3.retry-b.accept',
        },
        contextB,
      );
      expect(acceptedC).toMatchObject({
        created: true,
        retryRun: { retryOfRunId: acceptedB.retryRun.id },
      });
      expect(acceptedC.retryRun.id).not.toBe(acceptedB.retryRun.id);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects a detached Project Media selection without creating a retry Run', async () => {
    const { fixture, context, media, runId } = await activeHarnessFixture('project_media');
    try {
      if (media === null) throw new Error('Expected a selected Project Media reference');
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      prepareModelAttempt(
        fixture.data,
        {
          request: requestFor(snapshot, 'model-attempt.i3.retry-detached-project-media', []),
          quote: USAGE,
          commandId: 'command.i3.retry-project-media.prepare',
        },
        context,
      );
      const closed = fixture.data.harness.closeInterruptedActivation(
        recoveryInput(
          fixture.data.harness.loadActivation(runId, 1),
          'command.i3.retry-project-media.close',
        ),
        context,
      );
      if (closed.run.publicEventHead === null) throw new Error('Expected source event head');
      fixture.data.projectMedia.detach(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.retry-project-media.detach',
          method: 'media.project.detach',
          input: {
            projectMediaRefId: media.ref.id,
            expectedRevision: media.ref.revision,
            expectedContentHash: media.ref.contentHash,
          },
        },
        userContext,
      );

      expect(() =>
        fixture.data.harness.acceptCrashRetryRun(
          {
            sourceRunId: closed.run.id,
            expectedSourceRevision: closed.run.revision,
            expectedSourceContentHash: closed.run.contentHash,
            expectedSourceEventHead: closed.run.publicEventHead!,
            commandId: 'command.i3.retry-project-media.accept',
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM runs WHERE retry_of_run_id = ?')
          .get(closed.run.id),
      ).toEqual({ count: 0 });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('commits a two-attempt tool loop, canonical resources, assistant output, and exact replay once', async () => {
    const { fixture, context, project, runId } = await activeHarnessFixture();
    try {
      let snapshot = fixture.data.harness.loadActivation(runId, 1);
      expect(snapshot.facts.map(({ type }) => type)).toEqual(['message']);
      const firstRequest = requestFor(snapshot, 'model-attempt.i3.1', ['project.get']);
      const firstPrepared = prepareModelAttempt(
        fixture.data,
        { request: firstRequest, quote: USAGE, commandId: 'command.i3.model.1.prepare' },
        context,
      );
      expect(firstPrepared.value.state).toBe('prepared');
      expect(firstPrepared.events).toHaveLength(2);
      const firstRunning = fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: firstPrepared.value.id,
          requestHash: firstPrepared.value.requestHash,
          commandId: 'command.i3.model.1.running',
        },
        context,
      );
      expect(firstRunning.value.state).toBe('running');
      const firstResponse = {
        version: 1 as const,
        events: [
          { type: 'assistant_delta' as const, publicText: 'I will inspect the Project.' },
          {
            type: 'tool_call' as const,
            providerCallId: 'provider-call-project-get',
            toolId: 'project.get' as const,
            canonicalArguments: { include: ['metadata'] },
          },
          { type: 'usage' as const, usage: USAGE },
          { type: 'model_completed' as const, finishReason: 'tool_calls' as const },
        ],
      };
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: firstPrepared.value.id,
            requestHash: firstPrepared.value.requestHash,
            response: {
              ...firstResponse,
              events: firstResponse.events.map((event) =>
                event.type === 'tool_call'
                  ? { ...event, toolId: 'project.search' as const }
                  : event,
              ),
            },
            settledAt: NOW,
            commandId: 'command.i3.model.1.unmaterialized',
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(fixture.data.harness.loadActivation(runId, 1).modelAttempts[0]).toMatchObject({
        response: null,
        state: 'running',
      });
      const firstSettled = fixture.data.harness.settleModelAttempt(
        {
          attemptId: firstPrepared.value.id,
          requestHash: firstPrepared.value.requestHash,
          response: firstResponse,
          settledAt: NOW,
          commandId: 'command.i3.model.1.settle',
        },
        context,
      );
      expect(firstSettled.value.state).toBe('succeeded');

      const currentProject = fixture.data.projects.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3.project.read',
        method: 'project.get',
        input: { projectId: project.id },
      }).result;
      const preparedDispatch = fixture.data.harness.prepareDispatch(
        {
          runId,
          modelAttemptId: firstPrepared.value.id,
          providerCallId: 'provider-call-project-get',
          toolId: 'project.get',
          input: { include: ['metadata'] },
          authorityWatermarkHash: currentProject.contentHash,
          activationNumber: 1,
          turnNumber: 1,
          stepNumber: 2,
          commandId: 'command.i3.dispatch.project-get.prepare',
        },
        context,
      );
      expect(preparedDispatch.value.guardOutcome).toBe('allowed');
      expect(fixture.data.harness.loadActivation(runId, 1).recoveryRequired).toBe(true);
      const outcome = ProjectGetDefinition.parseOutcome({
        status: 'succeeded',
        data: {
          sections: [
            {
              section: 'metadata',
              revision: currentProject.revision,
              contentHash: currentProject.contentHash,
              name: currentProject.name,
              lifecycle: currentProject.lifecycle,
            },
          ],
        },
      });
      const settledDispatch = fixture.data.harness.settleDispatch(
        {
          dispatchOperationId: preparedDispatch.value.id,
          modelAttemptId: firstPrepared.value.id,
          providerCallId: 'provider-call-project-get',
          outcome,
          activationNumber: 1,
          turnNumber: 1,
          stepNumber: 2,
          completedAt: NOW,
          commandId: 'command.i3.dispatch.project-get.settle',
        },
        context,
      );
      expect(settledDispatch.value.outcome).toEqual(outcome);
      expect(fixture.data.harness.loadActivation(runId, 1).recoveryRequired).toBe(false);

      const beforeTask = fixture.data.harness.loadActivation(runId, 1);
      fixture.data.taskLists.manage(
        runId,
        TaskManageDefinition.parseInput({
          action: 'create',
          expectedRunRevision: beforeTask.run.revision,
          title: 'Inspect the Project',
          tasks: [],
          publicSummary: 'Track the runtime read.',
        }),
        { commandId: 'command.i3.task.create', context },
      );

      snapshot = fixture.data.harness.loadActivation(runId, 1);
      expect(snapshot.facts.map(({ type }) => type)).toEqual([
        'message',
        'tool_call',
        'tool_result',
      ]);
      const secondRequest = requestFor(snapshot, 'model-attempt.i3.2', []);
      const secondPrepared = prepareModelAttempt(
        fixture.data,
        { request: secondRequest, quote: USAGE, commandId: 'command.i3.model.2.prepare' },
        context,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: secondPrepared.value.id,
          requestHash: secondPrepared.value.requestHash,
          commandId: 'command.i3.model.2.running',
        },
        context,
      );
      const finalResponse = {
        version: 1 as const,
        events: [
          { type: 'assistant_delta' as const, publicText: '  The Project is active. \n' },
          { type: 'usage' as const, usage: USAGE },
          { type: 'model_completed' as const, finishReason: 'stop' as const },
        ],
      };
      const finalSettlement = {
        attemptId: secondPrepared.value.id,
        requestHash: secondPrepared.value.requestHash,
        response: finalResponse,
        settledAt: NOW,
        commandId: 'command.i3.model.2.settle',
      };
      const finalSettled = fixture.data.harness.settleModelAttempt(finalSettlement, context);
      expect(eventTypes(finalSettled.events)).toEqual([
        'usage',
        'message_ref',
        'step_ended',
        'turn_ended',
        'activation_changed',
        'task_list_changed',
        'run_state_changed',
        'terminal_summary',
      ]);
      const finalSnapshot = fixture.data.harness.loadActivation(runId, 1);
      expect(finalSnapshot.run).toMatchObject({
        revision: finalSettled.run.revision,
        status: 'completed',
        terminalOutcome: { status: 'completed', summary: 'The Project is active.' },
      });
      expect(finalSnapshot.activation).toMatchObject({ state: 'ended', endReason: 'terminal' });
      expect(finalSnapshot.taskList).toMatchObject({ state: 'completed', terminalizedAt: NOW });
      expect(finalSnapshot.modelAttempts).toHaveLength(2);
      expect(finalSnapshot.dispatches).toHaveLength(1);
      expect(finalSnapshot.facts.map(({ type }) => type)).toEqual([
        'message',
        'tool_call',
        'tool_result',
        'message',
      ]);
      expect(finalSnapshot.resourceExposure).toMatchObject({
        inputTokens: 240n,
        outputTokens: 48n,
      });
      expect(finalSnapshot.resourceExposure.cost?.coefficient).toBe(10n);
      expect(finalSnapshot.recoveryRequired).toBe(false);
      const messagesBefore = fixture.data.conversations.listMessages({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3.messages.before-replay',
        method: 'message.list',
        input: {
          chatId: finalSnapshot.run.chatId,
          beforeSequence: null,
          page: { cursor: null, limit: 100 },
        },
      }).result;
      const eventsBefore = finalSnapshot.journal.length;

      expect(
        prepareModelAttempt(
          fixture.data,
          { request: firstRequest, quote: USAGE, commandId: 'command.i3.model.1.prepare' },
          context,
        ).events,
      ).toEqual([]);
      expect(fixture.data.harness.settleModelAttempt(finalSettlement, context).events).toEqual([]);
      expect(
        fixture.data.harness.settleDispatch(
          {
            dispatchOperationId: preparedDispatch.value.id,
            modelAttemptId: firstPrepared.value.id,
            providerCallId: 'provider-call-project-get',
            outcome,
            activationNumber: 1,
            turnNumber: 1,
            stepNumber: 2,
            completedAt: NOW,
            commandId: 'command.i3.dispatch.project-get.settle',
          },
          context,
        ).events,
      ).toEqual([]);
      const replayed = fixture.data.harness.loadActivation(runId, 1);
      expect(replayed.journal).toHaveLength(eventsBefore);
      expect(
        fixture.data.conversations.listMessages({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.messages.after-replay',
          method: 'message.list',
          input: {
            chatId: finalSnapshot.run.chatId,
            beforeSequence: null,
            page: { cursor: null, limit: 100 },
          },
        }).result,
      ).toEqual(messagesBefore);
      expect(firstPrepared.value.requestHash).toBe(
        hashCanonical(canonicalModelRequestHashInput(firstRequest)),
      );
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('replays a safe-boundary final settlement after a later Activation terminalizes the Run', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      const request = requestFor(snapshot, 'model-attempt.i3.safe-final.1', []);
      const prepared = prepareModelAttempt(
        fixture.data,
        { request, quote: USAGE, commandId: 'command.i3.safe-final.1.prepare' },
        context,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          commandId: 'command.i3.safe-final.1.running',
        },
        context,
      );
      const followup = queueHarnessFollowup(fixture.data, runId, 'safe-final');
      const response = {
        version: 1 as const,
        events: [
          { type: 'assistant_delta' as const, publicText: 'First boundary.' },
          { type: 'usage' as const, usage: USAGE },
          { type: 'model_completed' as const, finishReason: 'stop' as const },
        ],
      };
      const settlement = {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        settledAt: NOW,
        commandId: 'command.i3.safe-final.1.settle',
      };
      const yielded = fixture.data.harness.settleModelAttempt(settlement, context);

      expect(eventTypes(yielded.events)).toEqual([
        'usage',
        'step_ended',
        'turn_ended',
        'activation_changed',
      ]);
      expect(yielded.run.status).toBe('running');
      expect(fixture.data.harness.loadActivation(runId, 1).activation).toMatchObject({
        state: 'ended',
        endReason: 'safe_boundary',
      });
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM messages WHERE originating_run_id = ?')
          .get(runId),
      ).toEqual({ count: 0 });

      activateAcceptedRun(fixture.data, runId, followup.id, followup.sequence);
      const secondSnapshot = fixture.data.harness.loadActivation(runId, 2);
      const secondRequest = requestFor(secondSnapshot, 'model-attempt.i3.safe-final.2', []);
      const secondPrepared = prepareModelAttempt(
        fixture.data,
        { request: secondRequest, quote: USAGE, commandId: 'command.i3.safe-final.2.prepare' },
        context,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: secondPrepared.value.id,
          requestHash: secondPrepared.value.requestHash,
          commandId: 'command.i3.safe-final.2.running',
        },
        context,
      );
      fixture.data.harness.settleModelAttempt(
        {
          attemptId: secondPrepared.value.id,
          requestHash: secondPrepared.value.requestHash,
          response: {
            version: 1,
            events: [
              { type: 'assistant_delta', publicText: 'Handled the follow-up.' },
              { type: 'usage', usage: USAGE },
              { type: 'model_completed', finishReason: 'stop' },
            ],
          },
          settledAt: NOW,
          commandId: 'command.i3.safe-final.2.settle',
        },
        context,
      );
      expect(getRun(fixture.data, runId, 'safe-final-completed').status).toBe('completed');
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM messages WHERE originating_run_id = ?')
          .get(runId),
      ).toEqual({ count: 1 });

      const eventsBeforeReplay = rowCount(fixture.store, 'run_events');
      const replay = fixture.data.harness.settleModelAttempt(settlement, context);
      expect(replay.events).toEqual([]);
      expect(replay.run.status).toBe('completed');
      expect(rowCount(fixture.store, 'run_events')).toBe(eventsBeforeReplay);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('replays a safe-boundary Dispatch settlement after its follow-up is consumed', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      const request = requestFor(snapshot, 'model-attempt.i3.safe-dispatch', [
        ProjectSearchDefinition.id,
      ]);
      const prepared = prepareModelAttempt(
        fixture.data,
        { request, quote: USAGE, commandId: 'command.i3.safe-dispatch.model.prepare' },
        context,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          commandId: 'command.i3.safe-dispatch.model.running',
        },
        context,
      );
      const providerCallId = 'provider-call.i3.safe-dispatch';
      fixture.data.harness.settleModelAttempt(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          response: {
            version: 1,
            events: [
              {
                type: 'tool_call',
                providerCallId,
                toolId: ProjectSearchDefinition.id,
                canonicalArguments: ProjectSearchDefinition.examples.input,
              },
              { type: 'usage', usage: USAGE },
              { type: 'model_completed', finishReason: 'tool_calls' },
            ],
          },
          settledAt: NOW,
          commandId: 'command.i3.safe-dispatch.model.settle',
        },
        context,
      );
      const dispatch = fixture.data.harness.prepareDispatch(
        {
          runId,
          modelAttemptId: prepared.value.id,
          providerCallId,
          toolId: ProjectSearchDefinition.id,
          input: ProjectSearchDefinition.examples.input,
          authorityWatermarkHash: null,
          activationNumber: 1,
          turnNumber: 1,
          stepNumber: 2,
          commandId: 'command.i3.safe-dispatch.prepare',
        },
        context,
      );
      const followup = queueHarnessFollowup(fixture.data, runId, 'safe-dispatch');
      const settlement = {
        dispatchOperationId: dispatch.value.id,
        modelAttemptId: prepared.value.id,
        providerCallId,
        outcome: ProjectSearchDefinition.parseOutcome({
          status: 'succeeded',
          data: { items: [], nextCursor: null },
        }),
        activationNumber: 1,
        turnNumber: 1,
        stepNumber: 2,
        completedAt: NOW,
        commandId: 'command.i3.safe-dispatch.settle',
      };
      const yielded = fixture.data.harness.settleDispatch(settlement, context);

      expect(eventTypes(yielded.events)).toEqual([
        'tool_result_ref',
        'tool_summary',
        'step_ended',
        'turn_ended',
        'activation_changed',
      ]);
      expect(yielded.run.status).toBe('running');
      expect(fixture.data.harness.loadActivation(runId, 1).activation).toMatchObject({
        state: 'ended',
        endReason: 'safe_boundary',
      });

      activateAcceptedRun(fixture.data, runId, followup.id, followup.sequence);
      expect(fixture.data.runs.listInbox(runId).at(-1)).toMatchObject({
        id: followup.id,
        state: 'consumed',
      });
      const eventsBeforeReplay = rowCount(fixture.store, 'run_events');
      const replay = fixture.data.harness.settleDispatch(settlement, context);
      expect(replay.events).toEqual([]);
      expect(rowCount(fixture.store, 'run_events')).toBe(eventsBeforeReplay);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects a pending-Inbox yield when the stale request crossed a non-Inbox event', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      const request = requestFor(snapshot, 'model-attempt.i3.non-inbox-stale', []);
      fixture.data.taskLists.manage(
        runId,
        TaskManageDefinition.parseInput({
          action: 'create',
          expectedRunRevision: snapshot.run.revision,
          title: 'Concurrent public progress',
          tasks: [],
          publicSummary: 'Changed after the Model request snapshot.',
        }),
        { commandId: 'command.i3.non-inbox-stale.task', context },
      );
      queueHarnessFollowup(fixture.data, runId, 'non-inbox-stale');
      const counts = {
        events: rowCount(fixture.store, 'run_events'),
        attempts: rowCount(fixture.store, 'model_attempts'),
        resources: rowCount(fixture.store, 'run_resource_entries'),
      };

      expect(() =>
        fixture.data.harness.prepareModelBoundary(
          {
            request,
            quote: USAGE,
            commandId: 'command.i3.non-inbox-stale.prepare',
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(rowCount(fixture.store, 'run_events')).toBe(counts.events);
      expect(rowCount(fixture.store, 'model_attempts')).toBe(counts.attempts);
      expect(rowCount(fixture.store, 'run_resource_entries')).toBe(counts.resources);
      expect(fixture.data.harness.loadActivation(runId, 1).activation).toMatchObject({
        state: 'active',
        endReason: null,
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects empty or oversized final text before settlement without truncating or writing', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    try {
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      const request = requestFor(snapshot, 'model-attempt.i3.final-text-boundary', []);
      const prepared = prepareModelAttempt(
        fixture.data,
        { request, quote: USAGE, commandId: 'command.i3.final-text.prepare' },
        context,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          commandId: 'command.i3.final-text.running',
        },
        context,
      );
      const before = fixture.data.harness.loadActivation(runId, 1);
      const counts = {
        events: rowCount(fixture.store, 'run_events'),
        ledger: rowCount(fixture.store, 'run_resource_entries'),
        messages: rowCount(fixture.store, 'messages'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      };
      const responses = [
        {
          version: 1 as const,
          events: [
            { type: 'assistant_delta' as const, publicText: ' \n ' },
            { type: 'usage' as const, usage: USAGE },
            { type: 'model_completed' as const, finishReason: 'stop' as const },
          ],
        },
        {
          version: 1 as const,
          events: [
            { type: 'assistant_delta' as const, publicText: 'x'.repeat(60_000) },
            { type: 'assistant_delta' as const, publicText: 'y'.repeat(40_001) },
            { type: 'usage' as const, usage: USAGE },
            { type: 'model_completed' as const, finishReason: 'stop' as const },
          ],
        },
      ];
      for (const [index, response] of responses.entries()) {
        expect(() =>
          fixture.data.harness.settleModelAttempt(
            {
              attemptId: prepared.value.id,
              requestHash: prepared.value.requestHash,
              response,
              settledAt: NOW,
              commandId: `command.i3.final-text.reject.${index}`,
            },
            context,
          ),
        ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
        expect(fixture.data.harness.loadActivation(runId, 1)).toEqual(before);
        expect({
          events: rowCount(fixture.store, 'run_events'),
          ledger: rowCount(fixture.store, 'run_resource_entries'),
          messages: rowCount(fixture.store, 'messages'),
          projectEvents: rowCount(fixture.store, 'project_events'),
        }).toEqual(counts);
      }
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('commits an unprotected delivery.mutate create atomically through its dedicated boundary', async () => {
    const { fixture, context, project, runId } = await activeHarnessFixture();
    try {
      const command = DeliveryMutateDefinition.parseInput({
        action: 'create',
        project: {
          authority: 'project',
          id: project.id,
          revision: project.revision,
          contentHash: project.contentHash,
        },
        name: 'Harness-created Delivery',
        formatIntent: DeliveryMutateDefinition.examples.input.formatIntent,
      });
      const providerCallId = 'provider-call.delivery-mutate.unprotected';
      const attempt = commitModelResponse(
        fixture.data,
        context,
        runId,
        'delivery-mutate-unprotected',
        [DeliveryMutateDefinition.id],
        {
          version: 1,
          events: [
            {
              type: 'tool_call',
              providerCallId,
              toolId: DeliveryMutateDefinition.id,
              canonicalArguments: command,
            },
            { type: 'usage', usage: USAGE },
            { type: 'model_completed', finishReason: 'tool_calls' },
          ],
        },
      );
      const boundaryInput = {
        runId,
        modelAttemptId: attempt.id,
        providerCallId,
        input: command,
        activationNumber: 1,
        turnNumber: 1,
        stepNumber: 2,
        commandId: 'command.i3.delivery-mutate.unprotected.prepare',
      };
      const database = getJourneyTestDatabase(fixture.store);
      const beforeGenericBoundary = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: prepared.value.id,
            requestHash: prepared.value.requestHash,
            response,
            settledAt: NOW,
            commandId: 'command.i3.canvas-mutate.generic-settle',
          },
          context,
        ),
      ).toThrow('canvas.mutate');
      expect(serializedDatabaseRows(database)).toBe(beforeGenericBoundary);
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            ...boundaryInput,
            toolId: DeliveryMutateDefinition.id,
            authorityWatermarkHash: null,
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(beforeGenericBoundary);

      const beforeDomain = {
        plans: rowCount(fixture.store, 'delivery_plans'),
        choices: rowCount(fixture.store, 'user_choices'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      };
      const committed = fixture.data.harness.prepareProtectedMutationBoundary(
        boundaryInput,
        context,
      );
      if (committed.value.kind !== 'succeeded') {
        throw new Error('Expected an unprotected Delivery mutation to succeed');
      }
      expect(committed.value).toMatchObject({
        kind: 'succeeded',
        dispatch: {
          guardOutcome: 'allowed',
          confirmationId: null,
          projectEventId: expect.any(String),
          outcome: { status: 'succeeded', data: committed.value.result },
        },
        result: {
          plan: { authority: 'delivery', id: expect.any(String), revision: 0 },
          choice: { authority: 'user_choice', id: expect.any(String) },
        },
      });
      expect(eventTypes(committed.events)).toEqual([
        'step_started',
        'tool_call_ref',
        'tool_result_ref',
        'tool_summary',
        'step_ended',
      ]);
      expect({
        plans: rowCount(fixture.store, 'delivery_plans'),
        choices: rowCount(fixture.store, 'user_choices'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      }).toEqual({
        plans: beforeDomain.plans + 1,
        choices: beforeDomain.choices + 1,
        projectEvents: beforeDomain.projectEvents + 1,
      });

      const beforeGenericSettlement = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.settleDispatch(
          {
            dispatchOperationId: committed.value.dispatch.id,
            modelAttemptId: attempt.id,
            providerCallId,
            outcome: committed.value.dispatch.outcome,
            activationNumber: 1,
            turnNumber: 1,
            stepNumber: 2,
            completedAt: NOW,
            commandId: 'command.i3.delivery-mutate.unprotected.generic-settle',
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(beforeGenericSettlement);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('preserves a protected delivery.mutate pause through replay and cold recovery', async () => {
    const { fixture, context, project, runId } = await activeHarnessFixture();
    let reopened: TargetStore | undefined;
    try {
      const created = fixture.data.delivery.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.delivery-mutate.protected.create',
          method: 'delivery.apply',
          input: {
            action: 'create',
            project: {
              authority: 'project',
              id: project.id,
              revision: project.revision,
              contentHash: project.contentHash,
            },
            name: 'Protected Delivery',
            formatIntent: DeliveryMutateDefinition.examples.input.formatIntent,
          },
        },
        userContext,
      ).result;
      const protectedField = {
        owner: 'delivery' as const,
        deliveryId: created.plan.id,
        itemId: null,
        field: 'name' as const,
      };
      const protection = fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.delivery-mutate.protected.protect',
          method: 'decision.protect',
          input: {
            mode: 'protect',
            owner: {
              authority: 'delivery',
              id: created.plan.id,
              revision: created.plan.revision,
              contentHash: created.plan.contentHash,
            },
            field: protectedField,
            reason: 'The user chose this Delivery title.',
          },
        },
        userContext,
      ).result;
      const plan = fixture.data.delivery.query({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3.delivery-mutate.protected.query',
        method: 'delivery.query',
        input: {
          projectId: project.id,
          deliveryPlanIds: [created.plan.id],
          page: { cursor: null, limit: 1 },
        },
      }).result.plans[0]!;
      const command = DeliveryMutateDefinition.parseInput({
        action: 'updateSettings',
        plan: {
          authority: 'delivery',
          id: plan.id,
          revision: plan.revision,
          contentHash: plan.contentHash,
        },
        name: 'Commander wants another title',
        formatIntent: { ...plan.formatIntent, quality: 'standard' },
      });
      const providerCallId = 'provider-call.delivery-mutate.protected';
      const attempt = commitModelResponse(
        fixture.data,
        context,
        runId,
        'delivery-mutate-protected',
        [DeliveryMutateDefinition.id],
        {
          version: 1,
          events: [
            {
              type: 'tool_call',
              providerCallId,
              toolId: DeliveryMutateDefinition.id,
              canonicalArguments: command,
            },
            { type: 'usage', usage: USAGE },
            { type: 'model_completed', finishReason: 'tool_calls' },
          ],
        },
      );
      const boundaryInput = {
        runId,
        modelAttemptId: attempt.id,
        providerCallId,
        input: command,
        activationNumber: 1,
        turnNumber: 1,
        stepNumber: 2,
        commandId: 'command.i3.delivery-mutate.protected.prepare',
      };
      const database = getJourneyTestDatabase(fixture.store);
      const beforeDomain = {
        plans: rowCount(fixture.store, 'delivery_plans'),
        choices: rowCount(fixture.store, 'user_choices'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      };
      const paused = fixture.data.harness.prepareProtectedMutationBoundary(boundaryInput, context);
      if (paused.value.kind !== 'waiting_confirmation') {
        throw new Error('Expected a protected Delivery mutation to wait for confirmation');
      }
      expect(paused.value).toMatchObject({
        kind: 'waiting_confirmation',
        dispatch: {
          guardOutcome: 'confirmation_required',
          confirmationId: paused.value.confirmationId,
          outcome: null,
          projectEventId: null,
        },
        target: {
          kind: 'protected_mutation',
          dispatch: {
            operationId: paused.value.dispatch.id,
            toolId: DeliveryMutateDefinition.id,
            toolVersion: DeliveryMutateDefinition.version,
            inputHash: paused.value.dispatch.key.inputHash,
            fingerprint: paused.value.dispatch.key.fingerprint,
            authorityWatermarkHash: null,
          },
          owner: {
            authority: 'delivery',
            id: plan.id,
            revision: plan.revision,
            contentHash: plan.contentHash,
          },
          fields: [
            {
              owner: 'delivery',
              deliveryId: plan.id,
              itemId: null,
              field: 'formatIntent',
            },
            protectedField,
          ],
          activeChoiceIds: [protection.id],
          proposedEffectHash: expect.any(String),
          plannedIds: {
            userChoiceId: expect.any(String),
            projectEventId: expect.any(String),
            deliveryPlanId: null,
            deliveryItemId: null,
          },
        },
      });
      expect(paused.run.status).toBe('waiting_confirmation');
      expect(eventTypes(paused.events)).toEqual([
        'step_started',
        'tool_call_ref',
        'confirmation_requested',
        'run_state_changed',
      ]);
      expect(eventTypes(paused.events)).not.toContain('tool_result_ref');
      expect(eventTypes(paused.events)).not.toContain('step_ended');
      expect({
        plans: rowCount(fixture.store, 'delivery_plans'),
        choices: rowCount(fixture.store, 'user_choices'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      }).toEqual(beforeDomain);
      expect(fixture.data.harness.loadActivation(runId, 1)).toMatchObject({
        run: { status: 'waiting_confirmation' },
        activation: { state: 'active' },
        recoveryRequired: false,
        dispatches: [
          {
            id: paused.value.dispatch.id,
            guardOutcome: 'confirmation_required',
            outcome: null,
          },
        ],
      });

      const beforeReplay = serializedDatabaseRows(database);
      const replay = fixture.data.harness.prepareProtectedMutationBoundary(boundaryInput, context);
      expect(replay).toEqual({ value: paused.value, run: paused.run, events: [] });
      expect(serializedDatabaseRows(database)).toBe(beforeReplay);

      fixture.store.close();
      reopened = await openTargetStore(fixture.databasePath);
      const data = createJourneyDataAccess(reopened, fixture.dependencies, fixture.createId);
      const suspended = data.harness.loadActivation(runId, 1);
      expect(suspended).toMatchObject({
        run: { status: 'waiting_confirmation' },
        activation: { state: 'active' },
        recoveryRequired: false,
        dispatches: [
          {
            id: paused.value.dispatch.id,
            guardOutcome: 'confirmation_required',
            confirmationId: paused.value.confirmationId,
            outcome: null,
          },
        ],
      });
      const beforeRecovery = serializedDatabaseRows(getJourneyTestDatabase(reopened));
      expect(() =>
        data.harness.closeInterruptedActivation(
          recoveryInput(suspended, 'command.i3.delivery-mutate.protected.close'),
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(getJourneyTestDatabase(reopened))).toBe(beforeRecovery);
    } finally {
      reopened?.close();
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('commits an unprotected production root create atomically through the protected mutation boundary', async () => {
    const { fixture, context, project, runId } = await activeHarnessFixture();
    try {
      const command = ProductionMutateDefinition.parseInput({
        action: 'create',
        expectedProjectRevision: project.revision,
        parentRef: null,
        order: null,
        value: {
          objectType: 'story',
          content: {
            title: 'Harness production root',
            premise: 'A commander creates a root story.',
            synopsis: 'The root object is committed through the protected mutation boundary.',
          },
        },
      });
      const providerCallId = 'provider-call.production-mutate.unprotected';
      const attempt = commitModelResponse(
        fixture.data,
        context,
        runId,
        'production-mutate-unprotected',
        [ProductionMutateDefinition.id],
        {
          version: 1,
          events: [
            {
              type: 'tool_call',
              providerCallId,
              toolId: ProductionMutateDefinition.id,
              canonicalArguments: command,
            },
            { type: 'usage', usage: USAGE },
            { type: 'model_completed', finishReason: 'tool_calls' },
          ],
        },
      );
      const boundaryInput = {
        runId,
        modelAttemptId: attempt.id,
        providerCallId,
        input: command,
        activationNumber: 1,
        turnNumber: 1,
        stepNumber: 2,
        commandId: 'command.i3.production-mutate.unprotected.prepare',
      };
      const database = getJourneyTestDatabase(fixture.store);
      const before = {
        objects: rowCount(fixture.store, 'production_objects'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      };
      const beforeGenericBoundary = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            ...boundaryInput,
            toolId: ProductionMutateDefinition.id,
            authorityWatermarkHash: null,
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(beforeGenericBoundary);

      const committed = fixture.data.harness.prepareProtectedMutationBoundary(
        boundaryInput,
        context,
      );
      if (committed.value.kind !== 'succeeded') {
        throw new Error('Expected an unprotected Production root create to succeed');
      }
      const success = ProductionMutateDefinition.parseSuccess(committed.value.result);
      const receipt = success.receipts[0];
      if (receipt === undefined) throw new Error('Expected a Production mutation receipt');
      expect(committed.value).toMatchObject({
        kind: 'succeeded',
        dispatch: {
          guardOutcome: 'allowed',
          confirmationId: null,
          projectEventId: receipt.eventId,
          outcome: { status: 'succeeded', data: success },
        },
        result: { receipts: [expect.objectContaining({ previousRevision: null, undoRef: null })] },
      });
      expect({
        objects: rowCount(fixture.store, 'production_objects'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      }).toEqual({ objects: before.objects + 1, projectEvents: before.projectEvents + 1 });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('settles an unprotected no-op production update without binding a Project event', async () => {
    const { fixture, context, project, runId } = await activeHarnessFixture();
    try {
      const object = fixture.data.production.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.production-mutate.noop.create',
          method: 'production.apply',
          input: {
            action: 'create',
            projectId: project.id,
            expectedProjectRevision: project.revision,
            value: {
              objectType: 'story',
              content: {
                title: 'No-op Production target',
                premise: 'This content remains unchanged.',
                synopsis: 'A no-op update must not create a project event.',
              },
            },
            relations: [],
          },
        },
        userContext,
      ).result.object;
      if (object.type !== 'story') throw new Error('Expected a Story target');
      const command = ProductionMutateDefinition.parseInput({
        action: 'update',
        ref: {
          authority: 'production',
          id: object.id,
          revision: object.revision,
          contentHash: object.contentHash,
        },
        expectedRevision: object.revision,
        expectedContentHash: object.contentHash,
        value: { objectType: 'story', content: object.content },
      });
      const providerCallId = 'provider-call.production-mutate.noop';
      const attempt = commitModelResponse(
        fixture.data,
        context,
        runId,
        'production-mutate-noop',
        [ProductionMutateDefinition.id],
        {
          version: 1,
          events: [
            {
              type: 'tool_call',
              providerCallId,
              toolId: ProductionMutateDefinition.id,
              canonicalArguments: command,
            },
            { type: 'usage', usage: USAGE },
            { type: 'model_completed', finishReason: 'tool_calls' },
          ],
        },
      );
      const before = rowCount(fixture.store, 'project_events');
      const committed = fixture.data.harness.prepareProtectedMutationBoundary(
        {
          runId,
          modelAttemptId: attempt.id,
          providerCallId,
          input: command,
          activationNumber: 1,
          turnNumber: 1,
          stepNumber: 2,
          commandId: 'command.i3.production-mutate.noop.prepare',
        },
        context,
      );
      if (committed.value.kind !== 'succeeded') {
        throw new Error('Expected a no-op Production update to succeed');
      }
      expect(committed.value).toMatchObject({
        dispatch: { guardOutcome: 'allowed', projectEventId: null },
        result: { receipts: [] },
      });
      expect(rowCount(fixture.store, 'project_events')).toBe(before);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('pauses a protected production update without domain writes and recognizes it after a cold reopen', async () => {
    const { fixture, context, project, runId } = await activeHarnessFixture();
    let reopened: TargetStore | undefined;
    try {
      const created = fixture.data.production.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.production-mutate.protected.create',
          method: 'production.apply',
          input: {
            action: 'create',
            projectId: project.id,
            expectedProjectRevision: project.revision,
            value: {
              objectType: 'story',
              content: {
                title: 'Protected Production target',
                premise: 'A protected story must pause before update.',
                synopsis: 'Cold recovery must keep the pending confirmation intact.',
              },
            },
            relations: [],
          },
        },
        userContext,
      ).result.object;
      if (created.type !== 'story') throw new Error('Expected a Story target');
      const protectedField = {
        owner: 'production' as const,
        objectId: created.id,
        field: 'content' as const,
      };
      fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.production-mutate.protected.protect',
          method: 'decision.protect',
          input: {
            mode: 'protect',
            owner: {
              authority: 'production',
              id: created.id,
              revision: created.revision,
              contentHash: created.contentHash,
            },
            field: protectedField,
            reason: 'Protect this Production content.',
          },
        },
        userContext,
      );
      const protectedObject = fixture.data.production.get(created.id).object;
      if (protectedObject.type !== 'story') throw new Error('Expected a protected Story target');
      const command = ProductionMutateDefinition.parseInput({
        action: 'update',
        ref: {
          authority: 'production',
          id: protectedObject.id,
          revision: protectedObject.revision,
          contentHash: protectedObject.contentHash,
        },
        expectedRevision: protectedObject.revision,
        expectedContentHash: protectedObject.contentHash,
        value: {
          objectType: 'story',
          content: { ...protectedObject.content, title: 'Pending protected update' },
        },
      });
      const providerCallId = 'provider-call.production-mutate.protected';
      const attempt = commitModelResponse(
        fixture.data,
        context,
        runId,
        'production-mutate-protected',
        [ProductionMutateDefinition.id],
        {
          version: 1,
          events: [
            {
              type: 'tool_call',
              providerCallId,
              toolId: ProductionMutateDefinition.id,
              canonicalArguments: command,
            },
            { type: 'usage', usage: USAGE },
            { type: 'model_completed', finishReason: 'tool_calls' },
          ],
        },
      );
      const database = getJourneyTestDatabase(fixture.store);
      const beforeDomain = {
        objects: rowCount(fixture.store, 'production_objects'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      };
      const paused = fixture.data.harness.prepareProtectedMutationBoundary(
        {
          runId,
          modelAttemptId: attempt.id,
          providerCallId,
          input: command,
          activationNumber: 1,
          turnNumber: 1,
          stepNumber: 2,
          commandId: 'command.i3.production-mutate.protected.prepare',
        },
        context,
      );
      if (paused.value.kind !== 'waiting_confirmation') {
        throw new Error('Expected a protected Production update to wait for confirmation');
      }
      expect(paused.value).toMatchObject({
        dispatch: {
          guardOutcome: 'confirmation_required',
          confirmationId: paused.value.confirmationId,
          projectEventId: null,
          outcome: null,
        },
        target: {
          kind: 'protected_mutation',
          dispatch: { toolId: ProductionMutateDefinition.id },
          owner: { authority: 'production', id: protectedObject.id },
          fields: [protectedField],
          activeChoiceIds: [expect.any(String)],
          plannedIds: { tool: ProductionMutateDefinition.id, variant: 'production_update' },
        },
      });
      expect({
        objects: rowCount(fixture.store, 'production_objects'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      }).toEqual(beforeDomain);

      fixture.store.close();
      reopened = await openTargetStore(fixture.databasePath);
      const data = createJourneyDataAccess(reopened, fixture.dependencies, fixture.createId);
      const suspended = data.harness.loadActivation(runId, 1);
      expect(suspended).toMatchObject({
        run: { status: 'waiting_confirmation' },
        activation: { state: 'active' },
        recoveryRequired: false,
        dispatches: [
          {
            id: paused.value.dispatch.id,
            guardOutcome: 'confirmation_required',
            confirmationId: paused.value.confirmationId,
            outcome: null,
            projectEventId: null,
          },
        ],
      });
      const beforeRecovery = serializedDatabaseRows(getJourneyTestDatabase(reopened));
      expect(() =>
        data.harness.closeInterruptedActivation(
          recoveryInput(suspended, 'command.i3.production-mutate.protected.close'),
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(getJourneyTestDatabase(reopened))).toBe(beforeRecovery);
      expect(database).toBeDefined();
    } finally {
      reopened?.close();
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('commits an unprotected decision.record atomically through the protected mutation boundary', async () => {
    const { fixture, context, project, runId } = await activeHarnessFixture();
    try {
      const candidate = await generatedDecisionCandidate(fixture.data, project.id, runId, context);
      const command = DecisionRecordDefinition.parseInput({
        action: 'select',
        shot: {
          authority: 'production',
          id: candidate.target.id,
          revision: candidate.target.revision,
          contentHash: candidate.target.contentHash,
        },
        result: candidate.result,
        feedback: 'Use this candidate.',
      });
      const providerCallId = 'provider-call.decision-record.unprotected';
      const attempt = commitModelResponse(
        fixture.data,
        context,
        runId,
        'decision-record-unprotected',
        [DecisionRecordDefinition.id],
        {
          version: 1,
          events: [
            {
              type: 'tool_call',
              providerCallId,
              toolId: DecisionRecordDefinition.id,
              canonicalArguments: command,
            },
            { type: 'usage', usage: USAGE },
            { type: 'model_completed', finishReason: 'tool_calls' },
          ],
        },
      );
      const boundaryInput = {
        runId,
        modelAttemptId: attempt.id,
        providerCallId,
        input: command,
        activationNumber: 1,
        turnNumber: 1,
        stepNumber: 2,
        commandId: 'command.i3.decision-record.unprotected.prepare',
      };
      const database = getJourneyTestDatabase(fixture.store);
      const beforeGenericBoundary = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            ...boundaryInput,
            toolId: DecisionRecordDefinition.id,
            authorityWatermarkHash: null,
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(beforeGenericBoundary);

      const beforeDomain = {
        choices: rowCount(fixture.store, 'user_choices'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      };
      const committed = fixture.data.harness.prepareProtectedMutationBoundary(
        boundaryInput,
        context,
      );
      if (committed.value.kind !== 'succeeded') {
        throw new Error('Expected an unprotected Decision record to succeed');
      }
      expect(committed.value).toMatchObject({
        kind: 'succeeded',
        dispatch: {
          guardOutcome: 'allowed',
          confirmationId: null,
          projectEventId: expect.any(String),
          outcome: { status: 'succeeded', data: committed.value.result },
        },
        result: {
          action: 'select',
          choice: { authority: 'user_choice', id: expect.any(String) },
          owner: { authority: 'production', id: candidate.target.id },
          currentState: 'selected',
          eventId: expect.any(String),
        },
      });
      expect(eventTypes(committed.events)).toEqual([
        'step_started',
        'tool_call_ref',
        'tool_result_ref',
        'tool_summary',
        'step_ended',
      ]);
      expect({
        choices: rowCount(fixture.store, 'user_choices'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      }).toEqual({
        choices: beforeDomain.choices + 1,
        projectEvents: beforeDomain.projectEvents + 1,
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('pauses a decision.record only while an active protected field would change', async () => {
    const { fixture, context, project, runId } = await activeHarnessFixture();
    try {
      const candidate = await generatedDecisionCandidate(fixture.data, project.id, runId, context);
      const protection = fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.decision-record.protected.protect',
          method: 'decision.protect',
          input: {
            mode: 'protect',
            owner: {
              authority: 'production',
              id: candidate.target.id,
              revision: candidate.target.revision,
              contentHash: candidate.target.contentHash,
            },
            field: {
              owner: 'production',
              objectId: candidate.target.id,
              field: 'resultDecision',
              resultId: candidate.result.id,
            },
            reason: 'The user protects this candidate decision.',
          },
        },
        userContext,
      ).result;
      const protectedTarget = fixture.data.production.get(candidate.target.id).object;
      if (protectedTarget.type !== 'shot') throw new Error('Expected protected Shot target');
      const command = DecisionRecordDefinition.parseInput({
        action: 'select',
        shot: {
          authority: 'production',
          id: protectedTarget.id,
          revision: protectedTarget.revision,
          contentHash: protectedTarget.contentHash,
        },
        result: candidate.result,
        feedback: 'Use this protected candidate.',
      });
      const providerCallId = 'provider-call.decision-record.protected';
      const attempt = commitModelResponse(
        fixture.data,
        context,
        runId,
        'decision-record-protected',
        [DecisionRecordDefinition.id],
        {
          version: 1,
          events: [
            {
              type: 'tool_call',
              providerCallId,
              toolId: DecisionRecordDefinition.id,
              canonicalArguments: command,
            },
            { type: 'usage', usage: USAGE },
            { type: 'model_completed', finishReason: 'tool_calls' },
          ],
        },
      );
      const beforeDomain = {
        choices: rowCount(fixture.store, 'user_choices'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      };
      const paused = fixture.data.harness.prepareProtectedMutationBoundary(
        {
          runId,
          modelAttemptId: attempt.id,
          providerCallId,
          input: command,
          activationNumber: 1,
          turnNumber: 1,
          stepNumber: 2,
          commandId: 'command.i3.decision-record.protected.prepare',
        },
        context,
      );
      if (paused.value.kind !== 'waiting_confirmation') {
        throw new Error('Expected a protected Decision record to wait for confirmation');
      }
      expect(paused.value).toMatchObject({
        kind: 'waiting_confirmation',
        dispatch: {
          guardOutcome: 'confirmation_required',
          confirmationId: paused.value.confirmationId,
          outcome: null,
          projectEventId: null,
        },
        target: {
          kind: 'protected_mutation',
          dispatch: { toolId: DecisionRecordDefinition.id },
          owner: { authority: 'production', id: protectedTarget.id },
          activeChoiceIds: [protection.id],
        },
      });
      expect(paused.run.status).toBe('waiting_confirmation');
      expect(eventTypes(paused.events)).toEqual([
        'step_started',
        'tool_call_ref',
        'confirmation_requested',
        'run_state_changed',
      ]);
      expect({
        choices: rowCount(fixture.store, 'user_choices'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      }).toEqual(beforeDomain);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('pauses decision.protect with no active choices and preserves that pause through replay and cold recovery', async () => {
    const { fixture, context, project, runId } = await activeHarnessFixture();
    let reopened: TargetStore | undefined;
    try {
      const created = fixture.data.delivery.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.decision-protect.exact.create',
          method: 'delivery.apply',
          input: {
            action: 'create',
            project: {
              authority: 'project',
              id: project.id,
              revision: project.revision,
              contentHash: project.contentHash,
            },
            name: 'Decision protection target',
            formatIntent: DeliveryMutateDefinition.examples.input.formatIntent,
          },
        },
        userContext,
      ).result;
      const command = DecisionProtectDefinition.parseInput({
        mode: 'protect',
        owner: {
          authority: 'delivery',
          id: created.plan.id,
          revision: created.plan.revision,
          contentHash: created.plan.contentHash,
        },
        field: {
          owner: 'delivery',
          deliveryId: created.plan.id,
          itemId: null,
          field: 'name',
        },
        reason: 'Protect the Delivery name.',
      });
      const providerCallId = 'provider-call.decision-protect.exact';
      const attempt = commitModelResponse(
        fixture.data,
        context,
        runId,
        'decision-protect-exact',
        [DecisionProtectDefinition.id],
        {
          version: 1,
          events: [
            {
              type: 'tool_call',
              providerCallId,
              toolId: DecisionProtectDefinition.id,
              canonicalArguments: command,
            },
            { type: 'usage', usage: USAGE },
            { type: 'model_completed', finishReason: 'tool_calls' },
          ],
        },
      );
      const boundaryInput = {
        runId,
        modelAttemptId: attempt.id,
        providerCallId,
        input: command,
        activationNumber: 1,
        turnNumber: 1,
        stepNumber: 2,
        commandId: 'command.i3.decision-protect.exact.prepare',
      };
      const database = getJourneyTestDatabase(fixture.store);
      const beforeGenericBoundary = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            ...boundaryInput,
            toolId: DecisionProtectDefinition.id,
            authorityWatermarkHash: null,
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(database)).toBe(beforeGenericBoundary);

      const beforeDomain = {
        choices: rowCount(fixture.store, 'user_choices'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      };
      const paused = fixture.data.harness.prepareProtectedMutationBoundary(boundaryInput, context);
      if (paused.value.kind !== 'waiting_confirmation') {
        throw new Error('Expected exact protected Decision protection to wait for confirmation');
      }
      expect(paused.value).toMatchObject({
        kind: 'waiting_confirmation',
        dispatch: {
          guardOutcome: 'confirmation_required',
          confirmationId: paused.value.confirmationId,
          outcome: null,
          projectEventId: null,
        },
        target: {
          kind: 'protected_mutation',
          dispatch: { toolId: DecisionProtectDefinition.id },
          owner: { authority: 'delivery', id: created.plan.id },
          activeChoiceIds: [],
        },
      });
      expect({
        choices: rowCount(fixture.store, 'user_choices'),
        projectEvents: rowCount(fixture.store, 'project_events'),
      }).toEqual(beforeDomain);

      const beforeReplay = serializedDatabaseRows(database);
      const replay = fixture.data.harness.prepareProtectedMutationBoundary(boundaryInput, context);
      expect(replay).toEqual({ value: paused.value, run: paused.run, events: [] });
      expect(serializedDatabaseRows(database)).toBe(beforeReplay);

      fixture.store.close();
      reopened = await openTargetStore(fixture.databasePath);
      const data = createJourneyDataAccess(reopened, fixture.dependencies, fixture.createId);
      const suspended = data.harness.loadActivation(runId, 1);
      expect(suspended).toMatchObject({
        run: { status: 'waiting_confirmation' },
        activation: { state: 'active' },
        recoveryRequired: false,
        dispatches: [
          {
            id: paused.value.dispatch.id,
            guardOutcome: 'confirmation_required',
            confirmationId: paused.value.confirmationId,
            outcome: null,
          },
        ],
      });
      const beforeRecovery = serializedDatabaseRows(getJourneyTestDatabase(reopened));
      expect(() =>
        data.harness.closeInterruptedActivation(
          recoveryInput(suspended, 'command.i3.decision-protect.exact.close'),
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(serializedDatabaseRows(getJourneyTestDatabase(reopened))).toBe(beforeRecovery);
    } finally {
      reopened?.close();
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('atomically settles canvas.mutate, binds one ProjectEvent, and replays without writes', async () => {
    const { fixture, context, project, runId } = await activeHarnessFixture();
    try {
      const currentProject = fixture.data.projects.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3.canvas-mutate.project',
        method: 'project.get',
        input: { projectId: project.id },
      }).result;
      const target = fixture.data.production.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.canvas-mutate.target',
          method: 'production.apply',
          input: {
            action: 'create',
            projectId: project.id,
            expectedProjectRevision: currentProject.revision,
            value: {
              objectType: 'story',
              content: {
                title: 'Canvas target',
                premise: 'A durable Canvas placement target.',
                synopsis: 'The Harness must commit this Canvas mutation atomically.',
              },
            },
            relations: [],
          },
        },
        userContext,
      ).result.object;
      const canvas = fixture.data.canvas.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3.canvas-mutate.canvas',
        method: 'canvas.get',
        input: { projectId: project.id },
      }).result;
      const command = CanvasMutateDefinition.parseInput({
        action: 'place',
        target: { targetType: 'production', targetId: target.id },
        geometry: { position: { x: 40, y: 60 }, size: { width: 320, height: 180 } },
        expectedCanvasRevision: canvas.revision,
      });
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      const prepared = prepareModelAttempt(
        fixture.data,
        {
          request: requestFor(snapshot, 'model-attempt.i3.canvas-mutate', [
            CanvasMutateDefinition.id,
          ]),
          quote: USAGE,
          commandId: 'command.i3.canvas-mutate.prepare',
        },
        context,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          commandId: 'command.i3.canvas-mutate.running',
        },
        context,
      );
      const providerCallId = 'provider-call.i3.canvas-mutate';
      const response: CanonicalModelResponseV1 = {
        version: 1,
        events: [
          {
            type: 'tool_call',
            providerCallId,
            toolId: CanvasMutateDefinition.id,
            canonicalArguments: command,
          },
          { type: 'usage', usage: USAGE },
          { type: 'model_completed', finishReason: 'tool_calls' },
        ],
      };
      const boundaryInput = {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId,
        activationNumber: 1,
        turnNumber: 1,
        stepNumber: 1,
        settledAt: NOW,
      };
      const database = getJourneyTestDatabase(fixture.store);
      const beforeGenericBoundary = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: prepared.value.id,
            providerCallId,
            toolId: CanvasMutateDefinition.id,
            input: command,
            authorityWatermarkHash: null,
            activationNumber: 1,
            turnNumber: 1,
            stepNumber: 2,
            commandId: 'command.i3.canvas-mutate.generic',
          },
          context,
        ),
      ).toThrow('canvas.mutate requires its dedicated durable settlement boundary');
      expect(serializedDatabaseRows(database)).toBe(beforeGenericBoundary);

      const before = {
        projectEvents: rowCount(fixture.store, 'project_events'),
        dispatches: rowCount(fixture.store, 'dispatch_operations'),
      };
      const settled = fixture.data.harness.settleCanvasMutateBoundary(boundaryInput, context);
      expect(settled.value).toMatchObject({
        dispatch: {
          guardOutcome: 'allowed',
          projectEventId: expect.any(String),
          outcome: { status: 'succeeded', data: settled.value.result },
        },
        result: {
          canvasRevision: canvas.revision + 1,
          receipts: [
            {
              object: { kind: 'placement', revision: 0 },
              previousRevision: null,
              eventId: settled.value.dispatch.projectEventId,
            },
          ],
        },
      });
      expect(new Set(settled.value.result.receipts.map(({ eventId }) => eventId))).toEqual(
        new Set([settled.value.dispatch.projectEventId]),
      );
      expect(eventTypes(settled.events)).toEqual([
        'usage',
        'step_ended',
        'step_started',
        'tool_call_ref',
        'tool_result_ref',
        'tool_summary',
        'step_ended',
      ]);
      expect({
        projectEvents: rowCount(fixture.store, 'project_events'),
        dispatches: rowCount(fixture.store, 'dispatch_operations'),
      }).toEqual({
        projectEvents: before.projectEvents + 1,
        dispatches: before.dispatches + 1,
      });
      const persistedCanvas = fixture.data.canvas.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3.canvas-mutate.persisted',
        method: 'canvas.get',
        input: { projectId: project.id },
      }).result;
      expect(persistedCanvas).toMatchObject({
        revision: canvas.revision + 1,
        placements: [{ id: settled.value.result.receipts[0]!.object.id, revision: 0 }],
      });
      fixture.data.canvas.mutateTool(
        project.id,
        CanvasMutateDefinition.parseInput({
          action: 'annotate',
          placementId: settled.value.result.receipts[0]!.object.id,
          text: 'A later valid Canvas mutation must not invalidate replay.',
          geometry: null,
          expectedCanvasRevision: persistedCanvas.revision,
        }),
        context,
        { dispatchOperationId: 'dispatch.i3.canvas-mutate.later-annotation' },
      );

      const beforeReplay = serializedDatabaseRows(database);
      expect(fixture.data.harness.settleCanvasMutateBoundary(boundaryInput, context)).toEqual({
        value: settled.value,
        run: settled.run,
        events: [],
      });
      expect(serializedDatabaseRows(database)).toBe(beforeReplay);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('rolls back a stale canvas.mutate child CAS without partial Canvas, Dispatch, or Run writes', async () => {
    const { fixture, context, project, runId } = await activeHarnessFixture();
    try {
      const currentProject = fixture.data.projects.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3.canvas-stale.project',
        method: 'project.get',
        input: { projectId: project.id },
      }).result;
      const target = fixture.data.production.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3.canvas-stale.target',
          method: 'production.apply',
          input: {
            action: 'create',
            projectId: project.id,
            expectedProjectRevision: currentProject.revision,
            value: {
              objectType: 'story',
              content: {
                title: 'Stale Canvas target',
                premise: 'A child CAS must reject stale placement revision.',
                synopsis: 'No partial boundary write may survive a Canvas CAS conflict.',
              },
            },
            relations: [],
          },
        },
        userContext,
      ).result.object;
      const initialCanvas = fixture.data.canvas.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3.canvas-stale.initial',
        method: 'canvas.get',
        input: { projectId: project.id },
      }).result;
      fixture.data.canvas.mutateTool(
        project.id,
        CanvasMutateDefinition.parseInput({
          action: 'place',
          target: { targetType: 'production', targetId: target.id },
          geometry: { position: { x: 0, y: 0 }, size: { width: 100, height: 80 } },
          expectedCanvasRevision: initialCanvas.revision,
        }),
        context,
        { dispatchOperationId: 'dispatch.i3.canvas-stale.initial-placement' },
      );
      const canvas = fixture.data.canvas.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3.canvas-stale.current',
        method: 'canvas.get',
        input: { projectId: project.id },
      }).result;
      const placement = canvas.placements[0]!;
      const command = CanvasMutateDefinition.parseInput({
        action: 'move',
        placementId: placement.id,
        geometry: { position: { x: 100, y: 40 }, size: placement.size },
        expectedCanvasRevision: canvas.revision,
        expectedPlacementRevision: placement.revision + 1,
      });
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      const prepared = prepareModelAttempt(
        fixture.data,
        {
          request: requestFor(snapshot, 'model-attempt.i3.canvas-stale', [
            CanvasMutateDefinition.id,
          ]),
          quote: USAGE,
          commandId: 'command.i3.canvas-stale.prepare',
        },
        context,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          commandId: 'command.i3.canvas-stale.running',
        },
        context,
      );
      const providerCallId = 'provider-call.i3.canvas-stale';
      const database = getJourneyTestDatabase(fixture.store);
      const before = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.settleCanvasMutateBoundary(
          {
            attemptId: prepared.value.id,
            requestHash: prepared.value.requestHash,
            response: {
              version: 1,
              events: [
                {
                  type: 'tool_call',
                  providerCallId,
                  toolId: CanvasMutateDefinition.id,
                  canonicalArguments: command,
                },
                { type: 'usage', usage: USAGE },
                { type: 'model_completed', finishReason: 'tool_calls' },
              ],
            },
            providerCallId,
            activationNumber: 1,
            turnNumber: 1,
            stepNumber: 1,
            settledAt: NOW,
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(serializedDatabaseRows(database)).toBe(before);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('reopens a running Model Attempt as recovery-required without repeating provider work', async () => {
    const { fixture, context, runId } = await activeHarnessFixture();
    let reopened: TargetStore | undefined;
    try {
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      const request = requestFor(snapshot, 'model-attempt.i3.recovery', []);
      const prepared = prepareModelAttempt(
        fixture.data,
        { request, quote: USAGE, commandId: 'command.i3.recovery.prepare' },
        context,
      );
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: prepared.value.id,
          requestHash: prepared.value.requestHash,
          commandId: 'command.i3.recovery.running',
        },
        context,
      );
      expect(fixture.data.harness.loadActivation(runId, 1).recoveryRequired).toBe(true);

      fixture.store.close();
      reopened = await openTargetStore(fixture.databasePath);
      const data = createJourneyDataAccess(reopened, fixture.dependencies, fixture.createId);
      const recovered = data.harness.loadActivation(runId, 1);
      expect(recovered.recoveryRequired).toBe(true);
      expect(recovered.modelAttempts).toHaveLength(1);
      expect(recovered.modelAttempts[0]).toMatchObject({
        id: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response: null,
        state: 'running',
      });
      expect(recovered.resourceExposure).toMatchObject({
        inputTokens: 120n,
        outputTokens: 24n,
      });
      expect(recovered.resourceExposure.cost?.coefficient).toBe(5n);
    } finally {
      reopened?.close();
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);
});
