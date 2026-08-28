import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  CanonicalModelRequestV1Schema,
  CapabilityCatalogSnapshotV1Schema,
  DecisionProtectDefinition,
  DecisionRecordDefinition,
  DeliveryMutateDefinition,
  ProductionMutateDefinition,
  canonicalJson,
  type CanonicalModelRequestV1,
  type CanonicalModelResponseV1,
  type SkillDocument,
} from '@lucid-fin/contracts';
import { describe, expect, it } from 'vitest';
import { registerStoreDatabase, unregisterStoreDatabase } from '../internal/database-access.js';
import { hashUtf8 } from '../internal/hashes.js';
import { deliveryRef, loadDeliveryPlanRecord } from '../internal/delivery-records.js';
import { loadOperationDispatch } from '../internal/operation-dispatch.js';
import { loadProviderProfileRecord } from '../internal/provider-profile-records.js';
import { createDataAccess } from '../kernel/data-access.js';
import type { HarnessActivationSnapshot } from '../authorities/harness-runtime.js';
import type { DataAccess } from '../kernel/data-access.js';
import { openStore, type Store } from '../kernel/store.js';
import { loadRunEvents } from '../internal/run-journal.js';
import {
  NOW as JOURNEY_NOW,
  PROVIDER_ID,
  PROVIDER_MODEL,
  ROOT_CATALOG,
  budget,
  commanderContext,
  createJourneyFixture,
  formatPolicy,
  getJourneyTestDatabase,
  userContext,
} from '../../test/i2h/fixture.js';
import { createHostCatalogProvisioning, createHostConfirmationAuthority } from './index.js';

const NOW = '2026-08-16T12:00:00.000Z';
const rootCatalog = CapabilityCatalogSnapshotV1Schema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../contracts/generated/tool-catalog.v1.json', import.meta.url),
      'utf8',
    ),
  ),
);
const provider = {
  id: 'provider.host',
  displayName: 'Host Provider',
  providerKind: 'openai',
  model: 'image-model',
  status: 'ready' as const,
};

function skill(version = '1.0.0'): SkillDocument {
  const content = `Generate storyboard candidates using version ${version}.`;
  return {
    skillId: 'skill.storyboard',
    name: 'Storyboard generation',
    description: 'Turns an approved shot into bounded generation instructions.',
    version,
    contentHash: hashUtf8(content),
    provenance: 'installed',
    trust: 'reviewed',
    content,
    createdAt: NOW,
  };
}

function memoryStore(): { store: Store; database: DatabaseSync } {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(
    readFileSync(new URL('../../../contracts/ddl/project-v1.sql', import.meta.url), 'utf8'),
  );
  const store: Store = {
    databasePath: ':memory:',
    schemaFingerprint: {} as Store['schemaFingerprint'],
    security: { defensive: true, extensionLoading: false, foreignKeys: true },
    close() {
      unregisterStoreDatabase(store);
      database.close();
    },
  };
  registerStoreDatabase(store, database);
  return { store, database };
}

function ids() {
  const values = new Map<string, number>();
  return (kind: string) => {
    const value = (values.get(kind) ?? 0) + 1;
    values.set(kind, value);
    return `${kind}.${value}`;
  };
}

const USAGE = {
  inputTokens: { state: 'known' as const, value: 120 },
  outputTokens: { state: 'known' as const, value: 24 },
  cost: { state: 'known' as const, value: '0.5', currency: 'USD' },
};

function run(data: DataAccess, runId: string, suffix: string) {
  return data.runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId: `request.host.skill.run.${suffix}`,
    method: 'run.get',
    input: { runId },
  }).result;
}

function modelRequest(
  snapshot: HarnessActivationSnapshot,
  id: string,
  toolId = 'skill.propose',
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
    compactionView: null,
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
    materializedTools: [snapshot.catalog.tools.find(({ id }) => id === toolId)],
    locale: snapshot.manifest.locale,
    timeZone: snapshot.manifest.timeZone,
    limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
    reasoningStrength: snapshot.run.model.reasoningStrength,
    systemPromptVersion: 'commander-minimal-v1',
  });
}

function tableCounts(store: Store) {
  const database = getJourneyTestDatabase(store);
  const count = (table: string) =>
    Number(
      (
        database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as {
          count: number | bigint;
        }
      ).count,
    );
  return {
    skills: count('skills'),
    effective: count('skill_effective_versions'),
    enablements: count('skill_enablements'),
    settingsEvents: count('project_events'),
    messages: count('messages'),
    inbox: count('run_inbox_messages'),
    events: count('run_events'),
  };
}

function deliveryMutationCounts(database: DatabaseSync) {
  const count = (sql: string) =>
    Number((database.prepare(sql).get() as { count: number | bigint }).count);
  return {
    choices: count('SELECT COUNT(*) AS count FROM user_choices'),
    deliveryEvents: count(
      "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'delivery_changed'",
    ),
    messages: count('SELECT COUNT(*) AS count FROM messages'),
    inbox: count('SELECT COUNT(*) AS count FROM run_inbox_messages'),
    runEvents: count('SELECT COUNT(*) AS count FROM run_events'),
  };
}

function productionMutationCounts(database: DatabaseSync) {
  const count = (sql: string) =>
    Number((database.prepare(sql).get() as { count: number | bigint }).count);
  return {
    objects: count('SELECT COUNT(*) AS count FROM production_objects'),
    relations: count('SELECT COUNT(*) AS count FROM production_relations'),
    factSources: count('SELECT COUNT(*) AS count FROM production_fact_sources'),
    projectEvents: count('SELECT COUNT(*) AS count FROM project_events'),
    messages: count('SELECT COUNT(*) AS count FROM messages'),
    inbox: count('SELECT COUNT(*) AS count FROM run_inbox_messages'),
    runEvents: count('SELECT COUNT(*) AS count FROM run_events'),
  };
}

async function pendingSkillProposalFixture() {
  const fixture = await createJourneyFixture();
  registerStoreDatabase(fixture.store, getJourneyTestDatabase(fixture.store));
  const provisioner = createHostCatalogProvisioning(fixture.store, { now: () => JOURNEY_NOW });
  provisioner.registerProviderProfile({
    id: PROVIDER_ID,
    displayName: 'Host confirmation model',
    providerKind: 'fake-model',
    model: PROVIDER_MODEL,
    status: 'ready',
  });
  const created = fixture.data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.host.skill.project',
      method: 'project.create',
      input: {
        name: 'Skill confirmation fixture',
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
      requestId: 'request.host.skill.settings',
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
  const chat = fixture.data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.host.skill.chat',
      method: 'chat.create',
      input: { projectId: created.project.id, title: 'Skill confirmation' },
    },
    userContext,
  ).result;
  const accepted = fixture.data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.host.skill.message',
      method: 'message.send',
      input: {
        chatId: chat.id,
        blocks: [{ type: 'text', text: 'Create a continuity Skill.' }],
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
    {
      model: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      locale: 'en-US',
      timeZone: 'UTC',
      capabilityCatalog: ROOT_CATALOG,
      projectMediaSelections: [],
      citedMemoryEntryIds: [],
    },
  ).result.acceptedRun;
  const commandContext = commanderContext(accepted.id);
  const originalInbox = fixture.data.runs.listInbox(accepted.id)[0]!;
  fixture.data.runs.transitionInbox(
    {
      runId: accepted.id,
      expectedRevision: accepted.revision,
      inboxMessageId: originalInbox.id,
      sequence: originalInbox.sequence,
      action: 'deliver',
      commandId: 'command.host.skill.deliver',
    },
    commandContext,
  );
  const delivered = run(fixture.data, accepted.id, 'delivered');
  fixture.data.runs.startActivation(
    {
      runId: accepted.id,
      expectedRevision: delivered.revision,
      commandId: 'command.host.skill.activate',
    },
    commandContext,
  );
  const running = run(fixture.data, accepted.id, 'running');
  fixture.data.harness.consumeInbox(
    {
      runId: accepted.id,
      expectedRevision: running.revision,
      inboxMessageId: originalInbox.id,
      sequence: originalInbox.sequence,
      commandId: 'command.host.skill.consume',
    },
    commandContext,
  );
  const snapshot = fixture.data.harness.loadActivation(accepted.id, 1);
  const proposalInput = {
    name: 'Continuity reviewer',
    description: 'Review shots for visible continuity errors.',
    content: 'Check props, wardrobe, lighting, and screen direction.',
  };
  const preparation = fixture.data.harness.prepareModelBoundary(
    {
      request: modelRequest(snapshot, 'model-attempt.host.skill'),
      quote: USAGE,
      commandId: 'command.host.skill.model.prepare',
    },
    commandContext,
  );
  if (preparation.kind !== 'prepared') throw new Error('Expected Skill model preparation');
  const prepared = preparation.commit;
  fixture.data.harness.markModelAttemptRunning(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      commandId: 'command.host.skill.model.running',
    },
    commandContext,
  );
  const response: CanonicalModelResponseV1 = {
    version: 1,
    events: [
      {
        type: 'tool_call',
        providerCallId: 'provider-call.host.skill',
        toolId: 'skill.propose',
        canonicalArguments: proposalInput,
      },
      { type: 'usage', usage: USAGE },
      { type: 'model_completed', finishReason: 'tool_calls' },
    ],
  };
  fixture.data.harness.settleModelAttempt(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      response,
      settledAt: JOURNEY_NOW,
      commandId: 'command.host.skill.model.settle',
    },
    commandContext,
  );
  const proposal = fixture.data.harness.prepareSkillProposal(
    {
      runId: accepted.id,
      modelAttemptId: prepared.value.id,
      providerCallId: 'provider-call.host.skill',
      input: proposalInput,
      activationNumber: 1,
      turnNumber: 1,
      stepNumber: 2,
      commandId: 'command.host.skill.propose',
    },
    commandContext,
  );
  return {
    fixture,
    proposal,
    project: created.project,
    host: createHostConfirmationAuthority(fixture.store, {
      now: () => JOURNEY_NOW,
      createId: fixture.createId,
    }),
  };
}

async function preparePendingProtectedMutation(
  base: Awaited<ReturnType<typeof pendingSkillProposalFixture>>,
  toolId: 'delivery.mutate' | 'decision.record' | 'decision.protect' | 'production.mutate',
  input: Record<string, unknown>,
  suffix: string,
) {
  const resumed = run(base.fixture.data, base.proposal.run.id, `${suffix}-resumed`);
  const queued = base.fixture.data.runs
    .listInbox(resumed.id)
    .find(({ state }) => state === 'queued');
  if (queued === undefined) throw new Error('Expected queued confirmation answer');
  base.fixture.data.runs.transitionInbox(
    {
      runId: resumed.id,
      expectedRevision: resumed.revision,
      inboxMessageId: queued.id,
      sequence: queued.sequence,
      action: 'deliver',
      commandId: `command.host.${suffix}.deliver`,
    },
    commanderContext(resumed.id),
  );
  const delivered = run(base.fixture.data, resumed.id, `${suffix}-delivered`);
  base.fixture.data.runs.startActivation(
    {
      runId: resumed.id,
      expectedRevision: delivered.revision,
      commandId: `command.host.${suffix}.activate`,
    },
    commanderContext(resumed.id),
  );
  const running = run(base.fixture.data, resumed.id, `${suffix}-running`);
  base.fixture.data.harness.consumeInbox(
    {
      runId: resumed.id,
      expectedRevision: running.revision,
      inboxMessageId: queued.id,
      sequence: queued.sequence,
      commandId: `command.host.${suffix}.consume`,
    },
    commanderContext(resumed.id),
  );
  const snapshot = base.fixture.data.harness.loadActivation(resumed.id, 2);
  const preparation = base.fixture.data.harness.prepareModelBoundary(
    {
      request: modelRequest(snapshot, `model-attempt.host.${suffix}`, toolId),
      quote: USAGE,
      commandId: `command.host.${suffix}.model.prepare`,
    },
    commanderContext(resumed.id),
  );
  if (preparation.kind !== 'prepared') {
    throw new Error(`Expected ${toolId} model preparation`);
  }
  const prepared = preparation.commit;
  base.fixture.data.harness.markModelAttemptRunning(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      commandId: `command.host.${suffix}.model.running`,
    },
    commanderContext(resumed.id),
  );
  const providerCallId = `provider-call.host.${suffix}`;
  const response: CanonicalModelResponseV1 = {
    version: 1,
    events: [
      { type: 'tool_call', providerCallId, toolId, canonicalArguments: input },
      { type: 'usage', usage: USAGE },
      { type: 'model_completed', finishReason: 'tool_calls' },
    ],
  };
  base.fixture.data.harness.settleModelAttempt(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      response,
      settledAt: JOURNEY_NOW,
      commandId: `command.host.${suffix}.model.settle`,
    },
    commanderContext(resumed.id),
  );
  const boundary = base.fixture.data.harness.prepareProtectedMutationBoundary(
    {
      runId: resumed.id,
      modelAttemptId: prepared.value.id,
      providerCallId,
      input,
      activationNumber: 2,
      turnNumber: 1,
      stepNumber: 2,
      commandId: `command.host.${suffix}.mutate`,
    },
    commanderContext(resumed.id),
  );
  if (boundary.value.kind !== 'waiting_confirmation') {
    throw new Error(`Expected protected ${toolId} confirmation`);
  }
  return {
    boundary,
    runId: resumed.id,
    database: getJourneyTestDatabase(base.fixture.store),
  };
}

async function deniedSkillProposalFixture(suffix: string) {
  const base = await pendingSkillProposalFixture();
  const proposal = base.proposal.value;
  base.host.respond(
    confirmationRequest(
      proposal.confirmationId,
      proposal.immutableInputHash,
      'denied',
      `${suffix}-setup`,
    ),
    userContext,
  );
  return base;
}

function createFixtureDelivery(
  base: Awaited<ReturnType<typeof pendingSkillProposalFixture>>,
  suffix: string,
) {
  return base.fixture.data.delivery.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: `request.host.${suffix}.delivery.create`,
      method: 'delivery.apply',
      input: {
        action: 'create',
        project: {
          authority: 'project',
          id: base.project.id,
          revision: base.project.revision,
          contentHash: base.project.contentHash,
        },
        name: `${suffix} protected cut`,
        formatIntent: DeliveryMutateDefinition.examples.input.formatIntent,
      },
    },
    userContext,
  ).result.plan;
}

function createFixtureProduction(
  base: Awaited<ReturnType<typeof pendingSkillProposalFixture>>,
  suffix: string,
) {
  return base.fixture.data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: `request.host.${suffix}.production.create`,
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: base.project.id,
        expectedProjectRevision: base.project.revision,
        value: {
          objectType: 'story',
          content: {
            title: `${suffix} protected story`,
            premise: 'A protected Production field must await confirmation.',
            synopsis: 'The Host applies the approved Production update atomically.',
          },
        },
        relations: [],
      },
    },
    userContext,
  ).result.object;
}

async function pendingDeliveryMutationFixture() {
  const base = await deniedSkillProposalFixture('delivery');
  const created = createFixtureDelivery(base, 'delivery');
  const protectedField = {
    owner: 'delivery' as const,
    deliveryId: created.id,
    itemId: null,
    field: 'name' as const,
  };
  base.fixture.data.userChoices.setProtection(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.host.delivery.protect',
      method: 'decision.protect',
      input: {
        mode: 'protect',
        owner: deliveryRef(created),
        field: protectedField,
        reason: 'Keep the approved Delivery title.',
      },
    },
    userContext,
  );
  const database = getJourneyTestDatabase(base.fixture.store);
  const protectedPlan = loadDeliveryPlanRecord(database, created.id);
  const command = {
    action: 'updateSettings' as const,
    plan: deliveryRef(protectedPlan),
    name: 'Commander cut',
    formatIntent: protectedPlan.formatIntent,
  };
  const pending = await preparePendingProtectedMutation(
    base,
    'delivery.mutate',
    command,
    'delivery',
  );
  return {
    ...base,
    ...pending,
    command,
    protectedPlan,
  };
}

async function pendingProductionMutationFixture() {
  const base = await deniedSkillProposalFixture('production-mutate');
  const created = createFixtureProduction(base, 'production-mutate');
  if (created.type !== 'story') throw new Error('Expected a Story Production target');
  const field = {
    owner: 'production' as const,
    objectId: created.id,
    field: 'content' as const,
  };
  base.fixture.data.userChoices.setProtection(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.host.production-mutate.protect',
      method: 'decision.protect',
      input: {
        mode: 'protect',
        owner: {
          authority: 'production',
          id: created.id,
          revision: created.revision,
          contentHash: created.contentHash,
        },
        field,
        reason: 'Keep the approved Production story content.',
      },
    },
    userContext,
  );
  const protectedObject = base.fixture.data.production.get(created.id).object;
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
      content: {
        ...protectedObject.content,
        title: 'Commander-approved protected story',
      },
    },
  });
  const pending = await preparePendingProtectedMutation(
    base,
    ProductionMutateDefinition.id,
    command,
    'production-mutate',
  );
  return { ...base, ...pending, command, field, protectedObject };
}

async function pendingDecisionProtectFixture() {
  const base = await deniedSkillProposalFixture('decision-protect');
  const plan = createFixtureDelivery(base, 'decision-protect');
  const field = {
    owner: 'delivery' as const,
    deliveryId: plan.id,
    itemId: null,
    field: 'name' as const,
  };
  const command = DecisionProtectDefinition.parseInput({
    mode: 'protect',
    owner: deliveryRef(plan),
    field,
    reason: 'Keep the approved Delivery title.',
  });
  const pending = await preparePendingProtectedMutation(
    base,
    DecisionProtectDefinition.id,
    command,
    'decision-protect',
  );
  return { ...base, ...pending, command, field, plan };
}

async function pendingDecisionRecordUndoFixture() {
  const base = await deniedSkillProposalFixture('decision-record');
  const plan = createFixtureDelivery(base, 'decision-record');
  const field = {
    owner: 'delivery' as const,
    deliveryId: plan.id,
    itemId: null,
    field: 'name' as const,
  };
  const protection = base.fixture.data.userChoices.setProtection(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.host.decision-record.protect',
      method: 'decision.protect',
      input: {
        mode: 'protect',
        owner: deliveryRef(plan),
        field,
        reason: 'Keep the approved Delivery title.',
      },
    },
    userContext,
  ).result;
  if (protection.ownerAfter === null) throw new Error('Expected a protected Delivery owner');
  const command = DecisionRecordDefinition.parseInput({
    action: 'undo',
    targetChoice: {
      authority: 'user_choice',
      id: protection.id,
      choiceHash: protection.choiceHash,
    },
    currentOwner: protection.ownerAfter,
  });
  const pending = await preparePendingProtectedMutation(
    base,
    DecisionRecordDefinition.id,
    command,
    'decision-record',
  );
  return { ...base, ...pending, command, field, plan, protection };
}

function confirmationRequest(
  confirmationId: string,
  immutableInputHash: string,
  decision: 'approved' | 'denied',
  suffix: string,
) {
  return {
    wireVersion: 1 as const,
    kind: 'request' as const,
    requestId: `request.host.skill.confirm.${suffix}`,
    method: 'confirmation.respond' as const,
    input: { confirmationId, immutableInputHash, decision },
  };
}

async function closeJourneyFixture(fixture: Awaited<ReturnType<typeof createJourneyFixture>>) {
  unregisterStoreDatabase(fixture.store);
  fixture.store.close();
  await rm(fixture.directory, { recursive: true, force: true });
}

describe('I2-H0 host-only Provider and Skill provisioning', () => {
  it('registers safe provider rows, replays exact content, and conflicts on the same changed key', () => {
    const { store, database } = memoryStore();
    try {
      const host = createHostCatalogProvisioning(store, { now: () => NOW });
      expect(host.registerProviderProfile(provider)).toEqual(provider);
      expect(host.registerProviderProfile(provider)).toEqual(provider);
      expect(
        database
          .prepare(
            `SELECT id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
                    credential_handle, status, configuration_v1_json, revision, created_at,
                    updated_at
             FROM provider_profiles`,
          )
          .all(),
      ).toEqual([
        {
          id: provider.id,
          display_name: provider.displayName,
          provider_kind: provider.providerKind,
          model: provider.model,
          reasoning_strength: null,
          endpoint_origin: null,
          credential_handle: null,
          status: provider.status,
          configuration_v1_json: '{}',
          revision: 0,
          created_at: NOW,
          updated_at: NOW,
        },
      ]);
      expect(() =>
        host.registerProviderProfile({ ...provider, displayName: 'Changed Provider' }),
      ).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    } finally {
      store.close();
    }
  });

  it('stores exact Skill documents across versions and rejects digest or same-version conflicts', () => {
    const { store, database } = memoryStore();
    try {
      const host = createHostCatalogProvisioning(store, { now: () => NOW });
      const first = skill();
      const second = skill('2.0.0');
      expect(host.registerSkill({ document: first, projectId: null })).toMatchObject({
        status: 'inserted',
        document: first,
        projectId: null,
      });
      expect(host.registerSkill({ document: first, projectId: null })).toMatchObject({
        status: 'unchanged',
        document: first,
        projectId: null,
      });
      expect(host.registerSkill({ document: second, projectId: null })).toMatchObject({
        status: 'inserted',
        document: second,
        projectId: null,
      });
      expect(database.prepare('SELECT id, version FROM skills ORDER BY id, version').all()).toEqual(
        [
          { id: first.skillId, version: '1.0.0' },
          { id: first.skillId, version: '2.0.0' },
        ],
      );
      expect(() =>
        host.registerSkill({ document: { ...first, name: 'Changed name' }, projectId: null }),
      ).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(() =>
        host.registerSkill({
          document: { ...skill('3.0.0'), contentHash: 'f'.repeat(64) },
          projectId: null,
        }),
      ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      store.close();
    }
  });

  it('freezes host-provisioned Project Skills without exposing the builder on DataAccess', () => {
    const { store, database } = memoryStore();
    try {
      const host = createHostCatalogProvisioning(store, { now: () => NOW });
      const enabledSkill = skill();
      host.registerProviderProfile(provider);
      host.registerSkill({ document: enabledSkill, projectId: null });
      expect(
        loadProviderProfileRecord(
          database,
          provider.id,
          { providerKind: provider.providerKind },
          'Generation',
        ),
      ).toEqual({
        id: provider.id,
        providerKind: provider.providerKind,
        model: { providerId: provider.id, model: provider.model, reasoningStrength: null },
      });
      const data = createDataAccess(store, {
        now: () => NOW,
        createId: ids(),
        mediaCas: {
          async putVerified() {
            throw new Error('unused');
          },
          async stat() {
            return null;
          },
          async verify() {
            throw new Error('unused');
          },
        },
        mediaImportCapabilities: {
          async resolve() {
            throw new Error('unused');
          },
        },
        generationProvider: {
          providerKind: provider.providerKind,
          async quote() {
            throw new Error('unused');
          },
          async submit() {
            throw new Error('unused');
          },
          async reconcileByIdempotencyKey() {
            throw new Error('unused');
          },
          async cancel() {
            throw new Error('unused');
          },
        },
      });
      expect(data).not.toHaveProperty('hostCatalog');
      const context = {
        actor: 'user' as const,
        causation: { kind: 'direct_ui' as const, actionId: 'action.host.setup' },
        correlationId: 'correlation.host.setup',
      };
      const created = data.projects.create(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.project.host',
          method: 'project.create',
          input: {
            name: 'Host Film',
            permissionMode: 'reversible',
            budget: {
              costUsd: { state: 'known', value: '20', currency: 'USD' },
              maxGenerationCount: 12,
              maxInputTokens: 100_000,
              maxOutputTokens: 20_000,
            },
            formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
          },
        },
        context,
      ).result;
      data.projects.updateSettings(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.settings.host',
          method: 'project.settings.update',
          input: {
            projectId: created.project.id,
            expectedRevision: created.settings.revision,
            expectedContentHash: created.settings.contentHash,
            defaultProviderProfileId: provider.id,
            formatPolicy: created.settings.formatPolicy,
            permission: created.settings.permission,
            budget: created.settings.budget,
            enabledSkills: [{ id: enabledSkill.skillId, version: enabledSkill.version }],
          },
        },
        context,
      );
      const chat = data.conversations.createChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.chat.host',
          method: 'chat.create',
          input: { projectId: created.project.id, title: 'Main' },
        },
        context,
      ).result;
      const accepted = data.conversations.sendMessage(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.message.host',
          method: 'message.send',
          input: {
            chatId: chat.id,
            blocks: [{ type: 'text', text: 'Create the opening shot.' }],
            attachments: [],
            selectedContext: [],
            exportDestinationGrant: null,
            supersedesMessageId: null,
          },
        },
        context,
        {
          model: { providerId: provider.id, model: provider.model, reasoningStrength: null },
          locale: 'en-US',
          timeZone: 'America/New_York',
          capabilityCatalog: rootCatalog,
          projectMediaSelections: [],
          citedMemoryEntryIds: [],
        },
      ).result.acceptedRun;
      expect(
        data.runs.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.host',
          method: 'run.get',
          input: { runId: accepted.id },
        }).result,
      ).toMatchObject({
        id: accepted.id,
        projectId: created.project.id,
        model: { providerId: provider.id, model: provider.model, reasoningStrength: null },
      });
      expect(data.runReplay.get(accepted.id).catalog.skills).toEqual([enabledSkill]);
    } finally {
      store.close();
    }
  });
});

describe('K7B host Skill confirmation response', () => {
  it('rejects a late confirmation response after its waiting Run was cancelled without treating valid cancellation as corruption', async () => {
    const state = await pendingSkillProposalFixture();
    try {
      const pending = state.proposal.value;
      const waiting = run(state.fixture.data, state.proposal.run.id, 'cancel-before-confirmation');
      expect(waiting.status).toBe('waiting_confirmation');
      const cancelled = state.fixture.data.runs.control(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.host.skill.cancel-before-confirmation',
          method: 'run.control',
          input: {
            runId: waiting.id,
            expectedRevision: waiting.revision,
            action: 'cancel',
            expectedStatus: 'waiting_confirmation',
            terminalSummary: 'The user cancelled this pending confirmation.',
          },
        },
        userContext,
      );
      expect(cancelled.result.status).toBe('cancelled');

      expect(() =>
        state.host.respond(
          confirmationRequest(
            pending.confirmationId,
            pending.immutableInputHash,
            'approved',
            'late-after-cancel',
          ),
          userContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      await closeJourneyFixture(state.fixture);
    }
  }, 30_000);

  it('approves one exact pending proposal, keeps the current frozen catalog, and replays only through its receipt', async () => {
    const state = await pendingSkillProposalFixture();
    try {
      const database = getJourneyTestDatabase(state.fixture.store);
      const confirmationEvent = loadRunEvents(database, state.proposal.run.id).find(
        (event) =>
          event.payloadState.state === 'available' &&
          event.payloadState.payload.type === 'confirmation_requested',
      );
      if (
        confirmationEvent === undefined ||
        confirmationEvent.payloadState.state !== 'available' ||
        confirmationEvent.payloadState.payload.type !== 'confirmation_requested'
      ) {
        throw new Error('Expected a public confirmation request event');
      }
      const confirmation = confirmationEvent.payloadState.payload;
      const interaction = database
        .prepare('SELECT interaction_id FROM run_confirmations WHERE id = ?')
        .get(state.proposal.value.confirmationId) as { interaction_id: string };
      expect(confirmation).toMatchObject({
        confirmationId: state.proposal.value.confirmationId,
        interactionId: interaction.interaction_id,
      });
      expect(confirmation.confirmationId).not.toBe(confirmation.interactionId);
      const request = confirmationRequest(
        confirmation.confirmationId,
        state.proposal.value.immutableInputHash,
        'approved',
        'approve',
      );
      const before = tableCounts(state.fixture.store);
      const first = state.host.respond(request, userContext);
      const after = tableCounts(state.fixture.store);
      expect(first.result).toMatchObject({
        confirmationId: state.proposal.value.confirmationId,
        decision: 'approved',
        effect: {
          kind: 'skill_registered',
          projectId: state.project.id,
          skillId: state.proposal.value.target.skill.skillId,
          version: state.proposal.value.target.skill.version,
          contentHash: state.proposal.value.target.skill.contentHash,
          effectiveFrom: 'next_root_run',
        },
      });
      expect(state.host.respond(request, userContext)).toEqual(first);
      expect(tableCounts(state.fixture.store)).toEqual(after);
      expect(after).toMatchObject({
        skills: before.skills + 1,
        effective: before.effective + 1,
        enablements: before.enablements + 1,
        messages: before.messages + 1,
        inbox: before.inbox + 1,
        events: before.events + 3,
      });
      expect(
        database
          .prepare(
            `SELECT project_id, created_by_confirmation_id, content_hash
             FROM skills WHERE id = ? AND version = ?`,
          )
          .get(
            state.proposal.value.target.skill.skillId,
            state.proposal.value.target.skill.version,
          ),
      ).toEqual({
        project_id: state.project.id,
        created_by_confirmation_id: state.proposal.value.confirmationId,
        content_hash: state.proposal.value.target.skill.contentHash,
      });
      const settings = state.fixture.data.projects.getSettings({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.host.skill.settings.after.approve',
        method: 'project.settings.get',
        input: { projectId: state.project.id },
      }).result;
      expect(settings.enabledSkills).toContainEqual({
        id: state.proposal.value.target.skill.skillId,
        version: state.proposal.value.target.skill.version,
      });
      expect(first.result.effect).toMatchObject({
        projectSettingsRevision: settings.revision,
        projectSettingsContentHash: settings.contentHash,
      });
      expect(
        database
          .prepare(
            `SELECT interaction.state, interaction.answer_message_id,
                    confirmation.decision, confirmation.decided_by_message_id
             FROM run_confirmations AS confirmation
             JOIN run_interactions AS interaction ON interaction.id = confirmation.interaction_id
             WHERE confirmation.id = ?`,
          )
          .get(state.proposal.value.confirmationId),
      ).toMatchObject({
        state: 'answered',
        decision: 'approved',
        answer_message_id: first.result.messageId,
        decided_by_message_id: first.result.messageId,
      });
      expect(run(state.fixture.data, state.proposal.run.id, 'after-approve')).toMatchObject({
        status: 'running',
        revision: state.proposal.run.revision + 1,
      });
      expect(
        loadRunEvents(database, state.proposal.run.id)
          .slice(-3)
          .map((event) =>
            event.payloadState.state === 'available' ? event.payloadState.payload.type : null,
          ),
      ).toEqual(['confirmation_answered', 'inbox_state_changed', 'run_state_changed']);
      expect(
        state.fixture.data.runReplay.get(state.proposal.run.id).catalog.skills,
      ).not.toContainEqual(
        expect.objectContaining({ skillId: state.proposal.value.target.skill.skillId }),
      );

      const provisioner = createHostCatalogProvisioning(state.fixture.store);
      const nextCatalog = provisioner.buildRootCapabilityCatalog({
        projectId: state.project.id,
        baseCatalog: ROOT_CATALOG,
      });
      expect(nextCatalog.skills).toContainEqual(state.proposal.value.target.skill);
      const nextChat = state.fixture.data.conversations.createChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.host.skill.next.chat',
          method: 'chat.create',
          input: { projectId: state.project.id, title: 'Next Skill-aware Run' },
        },
        userContext,
      ).result;
      const nextRun = state.fixture.data.conversations.sendMessage(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.host.skill.next.message',
          method: 'message.send',
          input: {
            chatId: nextChat.id,
            blocks: [{ type: 'text', text: 'Use the new continuity Skill.' }],
            attachments: [],
            selectedContext: [
              {
                ref: {
                  authority: 'project',
                  id: state.project.id,
                  revision: state.project.revision,
                  contentHash: state.project.contentHash,
                },
                role: 'target',
              },
            ],
            exportDestinationGrant: null,
            supersedesMessageId: null,
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
      ).result.acceptedRun;
      expect(state.fixture.data.runReplay.get(nextRun.id).catalog.skills).toContainEqual(
        state.proposal.value.target.skill,
      );

      const other = state.fixture.data.projects.create(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.host.skill.other-project',
          method: 'project.create',
          input: {
            name: 'Other Skill boundary',
            permissionMode: 'reversible',
            budget,
            formatPolicy,
          },
        },
        userContext,
      ).result.project;
      database.exec('DROP TRIGGER validate_skill_enablement_insert');
      database.exec('DROP TRIGGER validate_skill_enablement_update');
      database
        .prepare(
          `INSERT INTO skill_enablements (
             project_id, skill_id, skill_version, enabled, enabled_at
           ) VALUES (?, ?, ?, 1, ?)`,
        )
        .run(
          other.id,
          state.proposal.value.target.skill.skillId,
          state.proposal.value.target.skill.version,
          JOURNEY_NOW,
        );
      expect(() =>
        provisioner.buildRootCapabilityCatalog({ projectId: other.id, baseCatalog: ROOT_CATALOG }),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
    } finally {
      await closeJourneyFixture(state.fixture);
    }
  }, 30_000);

  it('keeps an approved Project Skill available to the next root catalog after a cold reopen', async () => {
    const state = await pendingSkillProposalFixture();
    let reopened: Store | undefined;
    try {
      state.host.respond(
        confirmationRequest(
          state.proposal.value.confirmationId,
          state.proposal.value.immutableInputHash,
          'approved',
          'cold-reopen',
        ),
        userContext,
      );
      const expectedSkill = state.proposal.value.target.skill;
      const databasePath = state.fixture.store.databasePath;
      state.fixture.store.close();

      reopened = await openStore(databasePath);
      const catalog = createHostCatalogProvisioning(reopened).buildRootCapabilityCatalog({
        projectId: state.project.id,
        baseCatalog: ROOT_CATALOG,
      });
      expect(catalog.skills).toContainEqual(expectedSkill);
    } finally {
      if (reopened === undefined) state.fixture.store.close();
      else reopened.close();
      await rm(state.fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('denies without registering or enabling the proposed Skill while it resumes the Run', async () => {
    const state = await pendingSkillProposalFixture();
    try {
      const database = getJourneyTestDatabase(state.fixture.store);
      const settingsBefore = state.fixture.data.projects.getSettings({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.host.skill.settings.before.deny',
        method: 'project.settings.get',
        input: { projectId: state.project.id },
      }).result;
      const before = tableCounts(state.fixture.store);
      const response = state.host.respond(
        confirmationRequest(
          state.proposal.value.confirmationId,
          state.proposal.value.immutableInputHash,
          'denied',
          'deny',
        ),
        userContext,
      );
      const settingsAfter = state.fixture.data.projects.getSettings({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.host.skill.settings.after.deny',
        method: 'project.settings.get',
        input: { projectId: state.project.id },
      }).result;
      const after = tableCounts(state.fixture.store);
      expect(response.result).toMatchObject({ decision: 'denied', effect: null });
      expect(settingsAfter).toEqual(settingsBefore);
      expect(after).toMatchObject({
        skills: before.skills,
        effective: before.effective,
        enablements: before.enablements,
        settingsEvents: before.settingsEvents + 1,
        messages: before.messages + 1,
        inbox: before.inbox + 1,
        events: before.events + 3,
      });
      expect(
        database
          .prepare('SELECT decision FROM run_confirmations WHERE id = ?')
          .get(state.proposal.value.confirmationId),
      ).toEqual({ decision: 'denied' });
      expect(run(state.fixture.data, state.proposal.run.id, 'after-deny').status).toBe('running');
    } finally {
      await closeJourneyFixture(state.fixture);
    }
  }, 30_000);

  it('fails closed on a wrong hash or non-user actor without writing', async () => {
    const state = await pendingSkillProposalFixture();
    try {
      const before = tableCounts(state.fixture.store);
      expect(() =>
        state.host.respond(
          confirmationRequest(
            state.proposal.value.confirmationId,
            'f'.repeat(64),
            'approved',
            'wrong-hash',
          ),
          userContext,
        ),
      ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(tableCounts(state.fixture.store)).toEqual(before);
      expect(() =>
        state.host.respond(
          confirmationRequest(
            state.proposal.value.confirmationId,
            state.proposal.value.immutableInputHash,
            'approved',
            'non-user',
          ),
          {
            actor: 'commander',
            causation: { kind: 'run', runId: state.proposal.run.id },
            correlationId: 'correlation.host.skill.non-user',
          },
        ),
      ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(tableCounts(state.fixture.store)).toEqual(before);
    } finally {
      await closeJourneyFixture(state.fixture);
    }
  }, 30_000);

  it('fails closed on stale Settings and a tampered proposal target without writing a response effect', async () => {
    const stale = await pendingSkillProposalFixture();
    try {
      const beforeSettings = stale.fixture.data.projects.getSettings({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.host.skill.settings.stale.before',
        method: 'project.settings.get',
        input: { projectId: stale.project.id },
      }).result;
      stale.fixture.data.projects.updateSettings(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.host.skill.settings.stale.mutate',
          method: 'project.settings.update',
          input: {
            projectId: stale.project.id,
            expectedRevision: beforeSettings.revision,
            expectedContentHash: beforeSettings.contentHash,
            defaultProviderProfileId: null,
            formatPolicy: beforeSettings.formatPolicy,
            permission: beforeSettings.permission,
            budget: beforeSettings.budget,
            enabledSkills: beforeSettings.enabledSkills,
          },
        },
        userContext,
      );
      const before = tableCounts(stale.fixture.store);
      expect(() =>
        stale.host.respond(
          confirmationRequest(
            stale.proposal.value.confirmationId,
            stale.proposal.value.immutableInputHash,
            'approved',
            'stale',
          ),
          userContext,
        ),
      ).toThrow(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(tableCounts(stale.fixture.store)).toEqual(before);
    } finally {
      await closeJourneyFixture(stale.fixture);
    }

    const tampered = await pendingSkillProposalFixture();
    try {
      const database = getJourneyTestDatabase(tampered.fixture.store);
      const row = database
        .prepare('SELECT target_v1_json FROM run_confirmations WHERE id = ?')
        .get(tampered.proposal.value.confirmationId) as { target_v1_json: string };
      const target = JSON.parse(row.target_v1_json) as {
        skill: { name: string };
      };
      database
        .prepare('UPDATE run_confirmations SET target_v1_json = ? WHERE id = ?')
        .run(
          canonicalJson({ ...target, skill: { ...target.skill, name: 'Tampered Skill' } }),
          tampered.proposal.value.confirmationId,
        );
      const before = tableCounts(tampered.fixture.store);
      expect(() =>
        tampered.host.respond(
          confirmationRequest(
            tampered.proposal.value.confirmationId,
            tampered.proposal.value.immutableInputHash,
            'approved',
            'tampered',
          ),
          userContext,
        ),
      ).toThrow(expect.objectContaining({ code: 'CORRUPT_DATA' }));
      expect(tableCounts(tampered.fixture.store)).toEqual(before);
    } finally {
      await closeJourneyFixture(tampered.fixture);
    }
  }, 30_000);

  it('atomically approves a protected Delivery mutation and replays its exact Wire receipt', async () => {
    const state = await pendingDeliveryMutationFixture();
    try {
      const pending = state.boundary.value;
      if (pending.kind !== 'waiting_confirmation') throw new Error('Expected confirmation');
      const plannedIds = pending.target.plannedIds;
      if (plannedIds.tool !== DeliveryMutateDefinition.id) {
        throw new Error('Expected Delivery planned IDs');
      }
      const request = confirmationRequest(
        pending.confirmationId,
        pending.dispatch.key.inputHash,
        'approved',
        'delivery-approve',
      );
      const response = state.host.respond(request, userContext);
      expect(response.result).toMatchObject({
        confirmationId: pending.confirmationId,
        decision: 'approved',
        effect: {
          kind: 'delivery_mutated',
          dispatchOperationId: pending.dispatch.id,
        },
      });
      if (response.result.effect?.kind !== 'delivery_mutated') {
        throw new Error('Expected Delivery mutation receipt');
      }
      const plan = loadDeliveryPlanRecord(state.database, state.protectedPlan.id);
      expect(plan).toMatchObject({
        revision: state.protectedPlan.revision + 1,
        name: state.command.name,
      });
      expect(response.result.effect.plan).toEqual(deliveryRef(plan));
      const dispatch = loadOperationDispatch(state.database, pending.dispatch.id);
      expect(dispatch).toMatchObject({
        guardOutcome: 'allowed',
        confirmationId: pending.confirmationId,
        projectEventId: plannedIds.projectEventId,
        outcome: {
          status: 'succeeded',
          data: {
            plan: response.result.effect.plan,
            choice: response.result.effect.choice,
          },
        },
      });
      expect(
        state.database
          .prepare(
            `SELECT actor, authorization_kind, dispatch_operation_id, confirmation_id
             FROM user_choices WHERE id = ?`,
          )
          .get(plannedIds.userChoiceId),
      ).toEqual({
        actor: 'commander',
        authorization_kind: 'commander_dispatch',
        dispatch_operation_id: pending.dispatch.id,
        confirmation_id: pending.confirmationId,
      });
      expect(run(state.fixture.data, state.runId, 'delivery-approved').status).toBe('running');
      expect(
        loadRunEvents(state.database, state.runId)
          .slice(-7)
          .map((event) =>
            event.payloadState.state === 'available' ? event.payloadState.payload.type : null,
          ),
      ).toEqual([
        'confirmation_answered',
        'tool_result_ref',
        'tool_summary',
        'step_ended',
        'activation_changed',
        'inbox_state_changed',
        'run_state_changed',
      ]);
      const after = deliveryMutationCounts(state.database);
      expect(state.host.respond(request, userContext)).toEqual(response);
      expect(deliveryMutationCounts(state.database)).toEqual(after);
    } finally {
      await closeJourneyFixture(state.fixture);
    }
  }, 40_000);

  it('denies a protected Delivery mutation with zero Delivery domain writes', async () => {
    const state = await pendingDeliveryMutationFixture();
    try {
      const pending = state.boundary.value;
      if (pending.kind !== 'waiting_confirmation') throw new Error('Expected confirmation');
      const planBefore = loadDeliveryPlanRecord(state.database, state.protectedPlan.id);
      const before = deliveryMutationCounts(state.database);
      const response = state.host.respond(
        confirmationRequest(
          pending.confirmationId,
          pending.dispatch.key.inputHash,
          'denied',
          'delivery-deny',
        ),
        userContext,
      );
      expect(response.result).toMatchObject({ decision: 'denied', effect: null });
      expect(loadDeliveryPlanRecord(state.database, state.protectedPlan.id)).toEqual(planBefore);
      const after = deliveryMutationCounts(state.database);
      expect(after.choices).toBe(before.choices);
      expect(after.deliveryEvents).toBe(before.deliveryEvents);
      expect(after.messages).toBe(before.messages + 1);
      expect(after.inbox).toBe(before.inbox + 1);
      expect(after.runEvents).toBe(before.runEvents + 7);
      expect(loadOperationDispatch(state.database, pending.dispatch.id)).toMatchObject({
        guardOutcome: 'denied',
        projectEventId: null,
        outcome: { status: 'permission_denied', code: 'protected_denied' },
      });
      expect(run(state.fixture.data, state.runId, 'delivery-denied').status).toBe('running');
    } finally {
      await closeJourneyFixture(state.fixture);
    }
  }, 40_000);

  it.each(['approved', 'denied'] as const)(
    'settles a protected production update with an exact effect only when %s',
    async (decision) => {
      const state = await pendingProductionMutationFixture();
      try {
        const pending = state.boundary.value;
        if (pending.kind !== 'waiting_confirmation') throw new Error('Expected confirmation');
        const plannedIds = pending.target.plannedIds;
        if (
          plannedIds.tool !== ProductionMutateDefinition.id ||
          plannedIds.variant !== 'production_update'
        ) {
          throw new Error('Expected Production planned IDs');
        }
        if (state.command.action !== 'update')
          throw new Error('Expected a Production update command');
        expect(pending.target).toMatchObject({
          kind: 'protected_mutation',
          dispatch: { toolId: ProductionMutateDefinition.id },
          owner: { authority: 'production', id: state.protectedObject.id },
          fields: [state.field],
          activeChoiceIds: [expect.any(String)],
          plannedIds: {
            tool: ProductionMutateDefinition.id,
            variant: 'production_update',
            objectEventId: expect.any(String),
          },
        });
        const beforeObject = state.fixture.data.production.get(state.protectedObject.id).object;
        const before = productionMutationCounts(state.database);
        const response = state.host.respond(
          confirmationRequest(
            pending.confirmationId,
            pending.dispatch.key.inputHash,
            decision,
            `production-${decision}`,
          ),
          userContext,
        );
        const dispatch = loadOperationDispatch(state.database, pending.dispatch.id);
        const afterObject = state.fixture.data.production.get(state.protectedObject.id).object;
        const after = productionMutationCounts(state.database);
        if (decision === 'approved') {
          if (response.result.effect?.kind !== 'production_mutated') {
            throw new Error('Expected a Production mutation confirmation effect');
          }
          expect(response.result.effect).toMatchObject({
            dispatchOperationId: pending.dispatch.id,
            action: 'update',
            receipts: [
              {
                object: { id: state.protectedObject.id, revision: beforeObject.revision + 1 },
                previousRevision: beforeObject.revision,
                eventId: plannedIds.objectEventId,
                undoRef: null,
              },
            ],
            outcomeHash: expect.any(String),
          });
          expect(afterObject).toMatchObject({
            revision: beforeObject.revision + 1,
            content: state.command.value.content,
          });
          expect(dispatch).toMatchObject({
            guardOutcome: 'allowed',
            confirmationId: pending.confirmationId,
            projectEventId: plannedIds.objectEventId,
            outcome: { status: 'succeeded' },
          });
          expect(after).toMatchObject({
            objects: before.objects,
            relations: before.relations,
            factSources: before.factSources,
            projectEvents: before.projectEvents + 2,
            messages: before.messages + 1,
            inbox: before.inbox + 1,
            runEvents: before.runEvents + 7,
          });
        } else {
          expect(response.result).toMatchObject({ decision: 'denied', effect: null });
          expect(afterObject).toEqual(beforeObject);
          expect(dispatch).toMatchObject({
            guardOutcome: 'denied',
            projectEventId: null,
            outcome: { status: 'permission_denied', code: 'protected_denied' },
          });
          expect(after).toMatchObject({
            objects: before.objects,
            relations: before.relations,
            factSources: before.factSources,
            projectEvents: before.projectEvents + 1,
            messages: before.messages + 1,
            inbox: before.inbox + 1,
            runEvents: before.runEvents + 7,
          });
        }
      } finally {
        await closeJourneyFixture(state.fixture);
      }
    },
    40_000,
  );

  it('keeps a stale protected Delivery confirmation pending with a full transaction rollback', async () => {
    const state = await pendingDeliveryMutationFixture();
    try {
      const pending = state.boundary.value;
      if (pending.kind !== 'waiting_confirmation') throw new Error('Expected confirmation');
      const current = loadDeliveryPlanRecord(state.database, state.protectedPlan.id);
      state.fixture.data.delivery.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.host.delivery.stale.direct',
          method: 'delivery.apply',
          input: {
            action: 'updateSettings',
            plan: deliveryRef(current),
            name: 'New direct user title',
            formatIntent: current.formatIntent,
          },
        },
        userContext,
      );
      const before = deliveryMutationCounts(state.database);
      expect(() =>
        state.host.respond(
          confirmationRequest(
            pending.confirmationId,
            pending.dispatch.key.inputHash,
            'approved',
            'delivery-stale',
          ),
          userContext,
        ),
      ).toThrow(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(deliveryMutationCounts(state.database)).toEqual(before);
      expect(
        state.database
          .prepare('SELECT decision FROM run_confirmations WHERE id = ?')
          .get(pending.confirmationId),
      ).toEqual({ decision: null });
      expect(loadOperationDispatch(state.database, pending.dispatch.id)).toMatchObject({
        guardOutcome: 'confirmation_required',
        outcome: null,
      });
      expect(run(state.fixture.data, state.runId, 'delivery-stale').status).toBe(
        'waiting_confirmation',
      );
    } finally {
      await closeJourneyFixture(state.fixture);
    }
  }, 40_000);

  it('rolls back the approved Delivery domain commit when final Run journaling fails', async () => {
    const state = await pendingDeliveryMutationFixture();
    try {
      const pending = state.boundary.value;
      if (pending.kind !== 'waiting_confirmation') throw new Error('Expected confirmation');
      const planBefore = loadDeliveryPlanRecord(state.database, state.protectedPlan.id);
      const before = deliveryMutationCounts(state.database);
      state.database.exec(`
        CREATE TRIGGER abort_delivery_confirmation_run_event
        BEFORE INSERT ON run_events
        BEGIN
          SELECT RAISE(ABORT, 'delivery confirmation run event abort');
        END
      `);
      expect(() =>
        state.host.respond(
          confirmationRequest(
            pending.confirmationId,
            pending.dispatch.key.inputHash,
            'approved',
            'delivery-run-event-rollback',
          ),
          userContext,
        ),
      ).toThrow(/delivery confirmation run event abort/);
      expect(deliveryMutationCounts(state.database)).toEqual(before);
      expect(loadDeliveryPlanRecord(state.database, state.protectedPlan.id)).toEqual(planBefore);
      expect(
        state.database
          .prepare('SELECT decision FROM run_confirmations WHERE id = ?')
          .get(pending.confirmationId),
      ).toEqual({ decision: null });
      expect(loadOperationDispatch(state.database, pending.dispatch.id)).toMatchObject({
        guardOutcome: 'confirmation_required',
        projectEventId: null,
        outcome: null,
      });
    } finally {
      await closeJourneyFixture(state.fixture);
    }
  }, 40_000);

  it.each(['approved', 'denied'] as const)(
    'always routes decision.protect through exact confirmation and commits only when %s',
    async (decision) => {
      const state = await pendingDecisionProtectFixture();
      try {
        const pending = state.boundary.value;
        if (pending.kind !== 'waiting_confirmation') throw new Error('Expected confirmation');
        const plannedIds = pending.target.plannedIds;
        if (plannedIds.tool !== DecisionProtectDefinition.id) {
          throw new Error('Expected Decision protection planned IDs');
        }
        expect(pending.target).toMatchObject({ activeChoiceIds: [] });
        const beforePlan = loadDeliveryPlanRecord(state.database, state.plan.id);
        const before = deliveryMutationCounts(state.database);
        const response = state.host.respond(
          confirmationRequest(
            pending.confirmationId,
            pending.dispatch.key.inputHash,
            decision,
            `decision-protect-${decision}`,
          ),
          userContext,
        );
        expect(response.result.effect).toEqual(
          decision === 'approved'
            ? expect.objectContaining({
                kind: 'decision_protection_changed',
                dispatchOperationId: pending.dispatch.id,
                active: true,
              })
            : null,
        );
        const afterPlan = loadDeliveryPlanRecord(state.database, state.plan.id);
        const after = deliveryMutationCounts(state.database);
        expect(after.choices).toBe(before.choices + (decision === 'approved' ? 1 : 0));
        expect(after.deliveryEvents).toBe(before.deliveryEvents);
        expect(afterPlan).toMatchObject(
          decision === 'approved'
            ? {
                revision: beforePlan.revision + 1,
                protections: [expect.objectContaining({ field: state.field })],
              }
            : beforePlan,
        );
        expect(loadOperationDispatch(state.database, pending.dispatch.id)).toMatchObject({
          guardOutcome: decision === 'approved' ? 'allowed' : 'denied',
          projectEventId: decision === 'approved' ? plannedIds.projectEventId : null,
          outcome:
            decision === 'approved'
              ? { status: 'succeeded' }
              : { status: 'permission_denied', code: 'protected_denied' },
        });
      } finally {
        await closeJourneyFixture(state.fixture);
      }
    },
    40_000,
  );

  it.each(['approved', 'denied'] as const)(
    'replays a protected decision.record undo with nullable state and commits only when %s',
    async (decision) => {
      const state = await pendingDecisionRecordUndoFixture();
      try {
        const pending = state.boundary.value;
        if (pending.kind !== 'waiting_confirmation') throw new Error('Expected confirmation');
        expect(pending.target.activeChoiceIds).toContain(state.protection.id);
        const beforePlan = loadDeliveryPlanRecord(state.database, state.plan.id);
        const before = deliveryMutationCounts(state.database);
        const response = state.host.respond(
          confirmationRequest(
            pending.confirmationId,
            pending.dispatch.key.inputHash,
            decision,
            `decision-record-${decision}`,
          ),
          userContext,
        );
        expect(response.result.effect).toEqual(
          decision === 'approved'
            ? expect.objectContaining({
                kind: 'decision_recorded',
                dispatchOperationId: pending.dispatch.id,
                action: 'undo',
                currentState: null,
              })
            : null,
        );
        const afterPlan = loadDeliveryPlanRecord(state.database, state.plan.id);
        const after = deliveryMutationCounts(state.database);
        expect(after.choices).toBe(before.choices + (decision === 'approved' ? 1 : 0));
        expect(after.deliveryEvents).toBe(before.deliveryEvents);
        expect(afterPlan).toMatchObject(
          decision === 'approved'
            ? { revision: beforePlan.revision + 1, protections: [] }
            : beforePlan,
        );
      } finally {
        await closeJourneyFixture(state.fixture);
      }
    },
    40_000,
  );

  it('keeps a stale decision.protect confirmation pending with a full transaction rollback', async () => {
    const state = await pendingDecisionProtectFixture();
    try {
      const pending = state.boundary.value;
      if (pending.kind !== 'waiting_confirmation') throw new Error('Expected confirmation');
      state.fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.host.decision-protect.stale.direct',
          method: 'decision.protect',
          input: state.command,
        },
        userContext,
      );
      const before = deliveryMutationCounts(state.database);
      expect(() =>
        state.host.respond(
          confirmationRequest(
            pending.confirmationId,
            pending.dispatch.key.inputHash,
            'approved',
            'decision-protect-stale',
          ),
          userContext,
        ),
      ).toThrow(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(deliveryMutationCounts(state.database)).toEqual(before);
      expect(
        state.database
          .prepare('SELECT decision FROM run_confirmations WHERE id = ?')
          .get(pending.confirmationId),
      ).toEqual({ decision: null });
      expect(loadOperationDispatch(state.database, pending.dispatch.id)).toMatchObject({
        guardOutcome: 'confirmation_required',
        outcome: null,
      });
    } finally {
      await closeJourneyFixture(state.fixture);
    }
  }, 40_000);

  it('rolls back the Skill insertion when the later Settings update cannot commit', async () => {
    const state = await pendingSkillProposalFixture();
    try {
      const database = getJourneyTestDatabase(state.fixture.store);
      database.exec(`
        CREATE TRIGGER abort_host_skill_settings
        BEFORE UPDATE ON project_settings
        BEGIN
          SELECT RAISE(ABORT, 'host skill settings abort');
        END
      `);
      const before = tableCounts(state.fixture.store);
      expect(() =>
        state.host.respond(
          confirmationRequest(
            state.proposal.value.confirmationId,
            state.proposal.value.immutableInputHash,
            'approved',
            'rollback',
          ),
          userContext,
        ),
      ).toThrow(/host skill settings abort/);
      expect(tableCounts(state.fixture.store)).toEqual(before);
      expect(
        database
          .prepare('SELECT decision FROM run_confirmations WHERE id = ?')
          .get(state.proposal.value.confirmationId),
      ).toEqual({ decision: null });
    } finally {
      await closeJourneyFixture(state.fixture);
    }
  }, 30_000);
});
