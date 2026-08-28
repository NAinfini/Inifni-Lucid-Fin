import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AgentSpawnDefinition,
  CapabilityCatalogSnapshotV1Schema,
  CanonicalModelRequestV1Schema,
  ContextManifestSchema,
  PROVIDER_CONTINUATION_UNAVAILABLE,
  RunSchema,
  TaskManageDefinition,
  assertCapabilityCatalogLineage,
  assertRunContextManifest,
  canonicalJson,
  parseCanonical,
  type CanonicalModelRequestV1,
  type Run,
} from '@lucid-fin/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { getStoreDatabase } from '../internal/database-access.js';
import { hashCanonical, hashContentObject, hashUtf8 } from '../internal/hashes.js';
import { createAes256GcmPrivateRecoveryCodec } from '../kernel/private-recovery-codec.js';
import { createDataAccess } from '../kernel/data-access.js';
import type { MediaCas, MediaImportCapabilityResolver } from '../kernel/media-cas.js';
import { createStore, openStore, type Store } from '../kernel/store.js';
import type { MessageSendAcceptanceSeed } from './conversations.js';
import type { HarnessActivationSnapshot } from './harness-runtime.js';

const NOW = '2026-08-15T12:00:00.000Z';
const PRIVATE_RECOVERY_KEY = new Uint8Array(32).fill(0x41);
const paths: string[] = [];
const rootCatalog = CapabilityCatalogSnapshotV1Schema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../contracts/generated/tool-catalog.v1.json', import.meta.url),
      'utf8',
    ),
  ),
);
const context = {
  actor: 'user' as const,
  causation: { kind: 'direct_ui' as const, actionId: 'action.runs' },
  correlationId: 'correlation.runs',
};
const hostContext = {
  actor: 'system' as const,
  causation: { kind: 'run' as const, runId: 'run.1' },
  correlationId: 'correlation.host',
};
const budget = {
  costUsd: { state: 'known' as const, value: '20', currency: 'USD' },
  maxGenerationCount: 12,
  maxInputTokens: 100_000,
  maxOutputTokens: 20_000,
};
const formatPolicy = { aspectRatio: '16:9' as const, customDimensions: null, frameRate: 24 };
const modelQuote = {
  inputTokens: { state: 'known' as const, value: 120 },
  outputTokens: { state: 'known' as const, value: 24 },
  cost: { state: 'known' as const, value: '0.5', currency: 'USD' },
};
const followupSeed: MessageSendAcceptanceSeed = {
  model: { providerId: 'provider.openai', model: 'gpt-5.6', reasoningStrength: 'high' },
  locale: 'en-US',
  timeZone: 'America/New_York',
  capabilityCatalog: rootCatalog,
  projectMediaSelections: [],
  citedMemoryEntryIds: [],
};
const unusedMediaCas: MediaCas = {
  putVerified: async () => {
    throw new Error('Media CAS is not used by Run tests');
  },
  stat: async () => null,
  verify: async () => {
    throw new Error('Media CAS is not used by Run tests');
  },
};
const unusedMediaImportCapabilities: MediaImportCapabilityResolver = {
  resolve: async () => {
    throw new Error('Media capabilities are not used by Run tests');
  },
};

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function deterministicIds() {
  const counts = new Map<string, number>();
  return (kind: string) => {
    const next = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, next);
    return `${kind}.${next}`;
  };
}

function dataAccess(store: Store, createId: (kind: string) => string) {
  return createDataAccess(store, {
    now: () => NOW,
    createId,
    privateRecoveryCodec: createAes256GcmPrivateRecoveryCodec({
      encryptionKeyId: 'key.runs.private-recovery',
      encryptionKey: PRIVATE_RECOVERY_KEY,
    }),
    mediaCas: unusedMediaCas,
    mediaImportCapabilities: unusedMediaImportCapabilities,
  });
}

async function harness(withSelectedProjectContext = false) {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-runs-'));
  paths.push(directory);
  const databasePath = join(directory, 'project.sqlite');
  const store = await createStore(databasePath);
  const createId = deterministicIds();
  const data = dataAccess(store, createId);
  const project = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.project.create',
      method: 'project.create',
      input: { name: 'Film', permissionMode: 'reversible', budget, formatPolicy },
    },
    context,
  ).result.project;
  const database = getStoreDatabase(store);
  database
    .prepare(
      `INSERT INTO provider_profiles (
         id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
         credential_handle, status, configuration_v1_json, revision, created_at, updated_at
       ) VALUES ('provider.openai', 'OpenAI', 'openai', 'gpt-5.6', 'high', NULL,
         NULL, 'ready', '{}', 0, ?, ?)`,
    )
    .run(NOW, NOW);
  const chat = data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.chat.create',
      method: 'chat.create',
      input: { projectId: project.id, title: 'Main' },
    },
    context,
  ).result;
  const accepted = data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.message.send',
      method: 'message.send',
      input: {
        chatId: chat.id,
        blocks: [{ type: 'text', text: 'Create a rain-soaked night sequence.' }],
        attachments: [],
        selectedContext: withSelectedProjectContext
          ? [
              {
                ref: {
                  authority: 'project',
                  id: project.id,
                  revision: project.revision,
                  contentHash: project.contentHash,
                },
                role: 'target',
              },
            ]
          : [],
        exportDestinationGrant: null,
        supersedesMessageId: null,
      },
    },
    context,
    {
      model: { providerId: 'provider.openai', model: 'gpt-5.6', reasoningStrength: 'high' },
      locale: 'en-US',
      timeZone: 'America/New_York',
      capabilityCatalog: rootCatalog,
      projectMediaSelections: [],
      citedMemoryEntryIds: [],
    },
  ).result;
  return {
    store,
    data,
    database,
    databasePath,
    createId,
    project,
    chat,
    run: accepted.acceptedRun,
  };
}

function spawnChildInput(
  parent: Run,
  contextRefs: ReturnType<typeof AgentSpawnDefinition.parseInput>['contextRefs'],
  commandId = 'operation.spawn.continuity',
  overrides: Partial<ReturnType<typeof AgentSpawnDefinition.parseInput>> = {},
) {
  const spawnInput = AgentSpawnDefinition.parseInput({
    displayName: 'Continuity review',
    objective: 'PRIVATE OBJECTIVE: compare the cyan reflections between the selected shots.',
    publicSummary: 'Checking the selected material for visual continuity.',
    contextRefs,
    toolAllowlist: null,
    permissionCeiling: null,
    budgetCaps: null,
    expectedParentRevision: parent.revision,
    ...overrides,
  });
  return {
    parentRunId: parent.id,
    expectedParentRevision: parent.revision,
    commandId,
    spawnInput,
  };
}

function delegationCounts(database: ReturnType<typeof getStoreDatabase>) {
  return Object.fromEntries(
    [
      'runs',
      'context_manifests',
      'capability_catalog_snapshots',
      'run_inbox_messages',
      'run_events',
      'private_recovery_envelopes',
      'run_activations',
      'task_lists',
      'wire_command_receipts',
    ].map((table) => [
      table,
      (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
    ]),
  );
}

function serializedDatabaseRows(database: ReturnType<typeof getStoreDatabase>): string {
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as unknown as Array<{ name: string }>;
  return JSON.stringify(
    tables.map(({ name }) => ({ name, rows: database.prepare(`SELECT * FROM "${name}"`).all() })),
  );
}

function compactionState(fixture: RunsFixture, runId: string) {
  return {
    run: currentRun(fixture, runId, 'compaction-state'),
    events: fixture.database
      .prepare('SELECT COUNT(*) AS count FROM run_events WHERE run_id = ?')
      .get(runId),
    transactions: fixture.database
      .prepare('SELECT COUNT(*) AS count FROM compaction_transactions WHERE run_id = ?')
      .get(runId),
    views: fixture.database
      .prepare('SELECT COUNT(*) AS count FROM compaction_views WHERE run_id = ?')
      .get(runId),
  };
}

function followupAcceptanceCounts(fixture: RunsFixture) {
  return Object.fromEntries(
    [
      'messages',
      'runs',
      'context_manifests',
      'capability_catalog_snapshots',
      'run_inbox_messages',
      'run_events',
      'wire_command_receipts',
    ].map((table) => [
      table,
      (
        fixture.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
          count: number;
        }
      ).count,
    ]),
  );
}

function followupRequest(run: Run, requestId = 'request.run.followup') {
  return {
    wireVersion: 1 as const,
    kind: 'request' as const,
    requestId,
    method: 'run.sendFollowup' as const,
    input: {
      runId: run.id,
      expectedRevision: run.revision,
      text: 'Keep the reflections cyan and preserve the reference framing.',
      selectedContext: [],
      exportDestinationGrant: null,
    },
  };
}

type RunsFixture = Awaited<ReturnType<typeof harness>>;
type TaskManageInput = ReturnType<typeof TaskManageDefinition.parseInput>;

function currentRun(fixture: RunsFixture, runId = fixture.run.id, suffix = 'current'): Run {
  return fixture.data.runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId: `request.run.${suffix}`,
    method: 'run.get',
    input: { runId },
  }).result;
}

function setRunStatus(
  fixture: RunsFixture,
  run: Run,
  status: 'running' | 'recovering' | 'waiting_question' | 'waiting_confirmation' | 'paused',
): Run {
  const withoutHash = { ...run, contentHash: '', status };
  const after = parseCanonical(RunSchema, {
    ...withoutHash,
    contentHash: hashContentObject(withoutHash),
  });
  fixture.database
    .prepare(
      `UPDATE runs SET status = ?, content_hash = ?
       WHERE id = ? AND revision = ? AND content_hash = ?`,
    )
    .run(status, after.contentHash, run.id, run.revision, run.contentHash);
  return after;
}

function makeRunning(fixture: RunsFixture, run = currentRun(fixture)): Run {
  return setRunStatus(fixture, run, 'running');
}

function startRunningActivation(fixture: RunsFixture, commandPrefix: string): Run {
  makeRunning(fixture);
  const inbox = fixture.data.runs.listInbox(fixture.run.id)[0]!;
  fixture.data.runs.transitionInbox(
    {
      runId: fixture.run.id,
      expectedRevision: 0,
      inboxMessageId: inbox.id,
      sequence: inbox.sequence,
      action: 'deliver',
      commandId: `${commandPrefix}.deliver`,
    },
    hostContext,
  );
  fixture.data.runs.startActivation(
    {
      runId: fixture.run.id,
      expectedRevision: 1,
      commandId: `${commandPrefix}.activation`,
    },
    hostContext,
  );
  return currentRun(fixture, fixture.run.id, `${commandPrefix}.ready`);
}

function manageTasks(
  fixture: RunsFixture,
  runId: string,
  input: TaskManageInput,
  commandId: string,
) {
  return fixture.data.taskLists.manage(runId, input, { commandId, context: hostContext });
}

function modelRequestFor(
  snapshot: HarnessActivationSnapshot,
  modelAttemptId: string,
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
    materializedTools: [],
    locale: snapshot.manifest.locale,
    timeZone: snapshot.manifest.timeZone,
    limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
    reasoningStrength: snapshot.run.model.reasoningStrength,
    systemPromptVersion: 'commander-minimal-v1',
  });
}

describe('Runs authority', () => {
  it('appends a follow-up Message and Inbox entry atomically, advances the Run once, and replays exactly', async () => {
    const fixture = await harness();
    try {
      expect(
        fixture.data.runs.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.get',
          method: 'run.get',
          input: { runId: fixture.run.id },
        }).result,
      ).toEqual(fixture.run);
      const baseRequest = followupRequest(fixture.run);
      const exportDestinationGrant = {
        destination: {
          kind: 'user_selected_file' as const,
          grantId: 'grant.followup-export.1',
          grantHash: 'e'.repeat(64),
          displayLabel: 'followup-review.mp4',
          projectId: fixture.project.id,
          deliveryPlan: {
            authority: 'delivery' as const,
            id: 'delivery.followup-export.1',
            revision: 0,
            contentHash: 'd'.repeat(64),
          },
          allowedExtensions: ['mp4' as const],
        },
        expiresAt: '2026-08-16T13:00:00.000Z',
      };
      const request = {
        ...baseRequest,
        input: { ...baseRequest.input, exportDestinationGrant },
      };
      const beforeReceipts = (
        fixture.database.prepare('SELECT COUNT(*) AS count FROM wire_command_receipts').get() as {
          count: number;
        }
      ).count;
      const first = fixture.data.runs.sendFollowup(request, context, followupSeed);
      expect(first.result).toMatchObject({
        runId: fixture.run.id,
        sequence: 2,
        actor: 'user',
        state: 'queued',
        selectedContext: [],
        exportDestinationGrant,
      });
      const after = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.run.get.after',
        method: 'run.get',
        input: { runId: fixture.run.id },
      }).result;
      expect(after).toMatchObject({
        revision: 1,
        status: 'accepted',
        publicEventHead: { sequence: 1 },
      });
      expect(hashContentObject(after)).toBe(after.contentHash);
      expect(
        fixture.data.runs.listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.events',
          method: 'run.events.list',
          input: { runId: fixture.run.id, afterSequence: null, page: { cursor: null, limit: 10 } },
        }).result.items,
      ).toEqual([
        expect.objectContaining({
          sequence: 1,
          visibility: 'public',
          payloadState: {
            state: 'available',
            payload: {
              type: 'inbox_state_changed',
              inboxMessageId: first.result.id,
              sequence: 2,
              state: 'queued',
            },
          },
        }),
      ]);
      expect(fixture.data.runs.sendFollowup(request, context, followupSeed)).toEqual(first);
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM wire_command_receipts').get(),
      ).toEqual({ count: beforeReceipts + 1 });
      expect(fixture.data.runs.listInbox(fixture.run.id)).toHaveLength(2);
      expect(() =>
        fixture.data.runs.sendFollowup(
          { ...request, input: { ...request.input, text: 'Changed semantics.' } },
          context,
          followupSeed,
        ),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(() =>
        fixture.data.runs.sendFollowup(
          { ...request, requestId: 'request.run.followup.stale' },
          context,
          followupSeed,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    } finally {
      fixture.store.close();
    }
  });

  it('rejects an invalid acceptance seed before an active follow-up writes anything', async () => {
    const fixture = await harness();
    try {
      const before = followupAcceptanceCounts(fixture);
      expect(() =>
        fixture.data.runs.sendFollowup(
          followupRequest(fixture.run, 'request.run.followup.invalid-seed'),
          context,
          { ...followupSeed, locale: '' },
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(followupAcceptanceCounts(fixture)).toEqual(before);
    } finally {
      fixture.store.close();
    }
  });

  it('rejects stale and cross-Project context, terminal Runs, and rolls back an injected journal failure', async () => {
    const fixture = await harness();
    try {
      const stale = followupRequest(fixture.run, 'request.run.followup.stale-context');
      expect(() =>
        fixture.data.runs.sendFollowup(
          {
            ...stale,
            input: {
              ...stale.input,
              selectedContext: [
                {
                  ref: {
                    authority: 'project',
                    id: fixture.project.id,
                    revision: fixture.project.revision + 1,
                    contentHash: fixture.project.contentHash,
                  },
                  role: 'reference',
                },
              ],
            },
          },
          context,
          followupSeed,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));

      fixture.database.exec(
        `CREATE TRIGGER fail_followup_journal
         BEFORE INSERT ON run_events
         BEGIN
           SELECT RAISE(ABORT, 'injected followup failure');
         END`,
      );
      const before = {
        messages: fixture.data.conversations.listMessages({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.messages.before',
          method: 'message.list',
          input: {
            chatId: fixture.chat.id,
            beforeSequence: null,
            page: { cursor: null, limit: 20 },
          },
        }).result.items.length,
        inbox: fixture.data.runs.listInbox(fixture.run.id).length,
      };
      expect(() =>
        fixture.data.runs.sendFollowup(
          followupRequest(fixture.run, 'request.run.followup.rollback'),
          context,
          followupSeed,
        ),
      ).toThrow('injected followup failure');
      expect(fixture.data.runs.listInbox(fixture.run.id)).toHaveLength(before.inbox);
      expect(
        fixture.data.conversations.listMessages({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.messages.after',
          method: 'message.list',
          input: {
            chatId: fixture.chat.id,
            beforeSequence: null,
            page: { cursor: null, limit: 20 },
          },
        }).result.items,
      ).toHaveLength(before.messages);
      fixture.database.exec('DROP TRIGGER fail_followup_journal');
    } finally {
      fixture.store.close();
    }
  });

  it('accepts terminal root follow-ups into one fresh root Run and linearizes later follow-ups there', async () => {
    const fixture = await harness();
    try {
      const terminal = fixture.data.runs.terminalize(
        {
          runId: fixture.run.id,
          expectedRevision: fixture.run.revision,
          status: 'cancelled',
          summary: 'Initial root cancelled before the next request.',
          resultIds: [],
          commandId: 'command.terminalize.rollover',
        },
        hostContext,
      );
      const firstBase = followupRequest(terminal, 'request.run.followup.rollover.first');
      const rolloverGrant = {
        destination: {
          kind: 'user_selected_file' as const,
          grantId: 'grant.rollover-export.1',
          grantHash: 'f'.repeat(64),
          displayLabel: 'rollover-review.mp4',
          projectId: fixture.project.id,
          deliveryPlan: {
            authority: 'delivery' as const,
            id: 'delivery.rollover-export.1',
            revision: 0,
            contentHash: 'd'.repeat(64),
          },
          allowedExtensions: ['mp4' as const],
        },
        expiresAt: '2026-08-16T13:00:00.000Z',
      };
      const first = fixture.data.runs.sendFollowup(
        {
          ...firstBase,
          input: { ...firstBase.input, exportDestinationGrant: rolloverGrant },
        },
        context,
        followupSeed,
      );
      const rollover = currentRun(fixture, first.result.runId, 'rollover-first');
      expect(first.result).toMatchObject({
        runId: rollover.id,
        sequence: 1,
        state: 'queued',
        exportDestinationGrant: rolloverGrant,
      });
      expect(rollover).toMatchObject({
        rootRunId: rollover.id,
        parentRunId: null,
        retryOfRunId: null,
        retrySeedHash: null,
        status: 'accepted',
        revision: 0,
        publicEventHead: null,
      });
      expect(
        fixture.data.runs.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.rollover.terminal',
          method: 'run.get',
          input: { runId: terminal.id },
        }).result,
      ).toEqual(terminal);

      const second = fixture.data.runs.sendFollowup(
        {
          ...followupRequest(terminal, 'request.run.followup.rollover.second'),
          input: {
            ...followupRequest(terminal, 'request.run.followup.rollover.second').input,
            expectedRevision: terminal.revision - 1,
          },
        },
        context,
        followupSeed,
      );
      expect(second.result).toMatchObject({ runId: rollover.id, sequence: 2, state: 'queued' });
      expect(fixture.data.runs.listInbox(rollover.id)).toHaveLength(2);
      expect(currentRun(fixture, terminal.id, 'rollover-terminal-after-second')).toEqual(terminal);
    } finally {
      fixture.store.close();
    }
  });

  it('rejects terminal follow-up future revisions and terminal children without writes', async () => {
    const fixture = await harness();
    try {
      const child = fixture.data.runs.spawnChild(
        spawnChildInput(fixture.run, [], 'operation.spawn.terminal-followup-child'),
        hostContext,
      ).child;
      const terminalChild = fixture.data.runs.terminalize(
        {
          runId: child.childRunId,
          expectedRevision: child.revision,
          status: 'cancelled',
          summary: 'Terminal child for follow-up rejection coverage.',
          resultIds: [],
          commandId: 'command.terminalize.followup-child',
        },
        hostContext,
      );
      const root = currentRun(fixture, fixture.run.id, 'followup-future-root');
      const terminal = fixture.data.runs.terminalize(
        {
          runId: root.id,
          expectedRevision: root.revision,
          status: 'cancelled',
          summary: 'Terminal root for rejection coverage.',
          resultIds: [],
          commandId: 'command.terminalize.followup-future',
        },
        hostContext,
      );
      const beforeFuture = followupAcceptanceCounts(fixture);
      expect(() =>
        fixture.data.runs.sendFollowup(
          {
            ...followupRequest(terminal, 'request.run.followup.future'),
            input: {
              ...followupRequest(terminal, 'request.run.followup.future').input,
              expectedRevision: terminal.revision + 1,
            },
          },
          context,
          followupSeed,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(followupAcceptanceCounts(fixture)).toEqual(beforeFuture);

      const beforeChild = followupAcceptanceCounts(fixture);
      expect(() =>
        fixture.data.runs.sendFollowup(
          followupRequest(terminalChild, 'request.run.followup.terminal-child'),
          context,
          followupSeed,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(followupAcceptanceCounts(fixture)).toEqual(beforeChild);
    } finally {
      fixture.store.close();
    }
  });

  it('rolls back terminal root acceptance and binds its seed to receipt replay', async () => {
    const fixture = await harness();
    try {
      const terminal = fixture.data.runs.terminalize(
        {
          runId: fixture.run.id,
          expectedRevision: fixture.run.revision,
          status: 'cancelled',
          summary: 'Terminal root for atomic root acceptance coverage.',
          resultIds: [],
          commandId: 'command.terminalize.followup-rollback',
        },
        hostContext,
      );
      fixture.database.exec(
        `CREATE TRIGGER fail_terminal_followup_catalog
         BEFORE INSERT ON capability_catalog_snapshots
         BEGIN
           SELECT RAISE(ABORT, 'injected terminal follow-up failure');
         END`,
      );
      const beforeRollback = followupAcceptanceCounts(fixture);
      expect(() =>
        fixture.data.runs.sendFollowup(
          followupRequest(terminal, 'request.run.followup.terminal-rollback'),
          context,
          followupSeed,
        ),
      ).toThrow('injected terminal follow-up failure');
      expect(followupAcceptanceCounts(fixture)).toEqual(beforeRollback);
      fixture.database.exec('DROP TRIGGER fail_terminal_followup_catalog');

      const request = followupRequest(terminal, 'request.run.followup.terminal-replay');
      const first = fixture.data.runs.sendFollowup(request, context, followupSeed);
      expect(fixture.data.runs.sendFollowup(request, context, followupSeed)).toEqual(first);
      expect(() =>
        fixture.data.runs.sendFollowup(request, context, { ...followupSeed, locale: 'fr-FR' }),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    } finally {
      fixture.store.close();
    }
  });

  it('starts delivered accepted root and child Runs with one state revision and an atomic event batch', async () => {
    const fixture = await harness();
    try {
      const child = fixture.data.runs.spawnChild(
        spawnChildInput(fixture.run, [], 'operation.spawn.activation-child'),
        hostContext,
      );
      const runIds = [fixture.run.id, child.child.childRunId];

      for (const [index, runId] of runIds.entries()) {
        const beforeDelivery = currentRun(fixture, runId, `activation-${index}-before-delivery`);
        const inbox = fixture.data.runs.listInbox(runId)[0]!;
        fixture.data.runs.transitionInbox(
          {
            runId,
            expectedRevision: beforeDelivery.revision,
            inboxMessageId: inbox.id,
            sequence: inbox.sequence,
            action: 'deliver',
            commandId: `command.activation-${index}.deliver`,
          },
          hostContext,
        );
        const before = currentRun(fixture, runId, `activation-${index}-before-start`);
        const beforeEvents = fixture.data.runs.listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: `request.activation-${index}.events-before`,
          method: 'run.events.list',
          input: { runId, afterSequence: null, page: { cursor: null, limit: 100 } },
        }).result.items;

        const activation = fixture.data.runs.startActivation(
          {
            runId,
            expectedRevision: before.revision,
            commandId: `command.activation-${index}.start`,
          },
          hostContext,
        );
        const after = currentRun(fixture, runId, `activation-${index}-after-start`);
        const events = fixture.data.runs.listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: `request.activation-${index}.events-after`,
          method: 'run.events.list',
          input: { runId, afterSequence: null, page: { cursor: null, limit: 100 } },
        }).result.items;
        const appended = events.slice(beforeEvents.length);

        expect(
          appended.map(({ sequence, payloadState }) => ({
            sequence,
            payload: payloadState.state === 'available' ? payloadState.payload : null,
          })),
        ).toEqual([
          {
            sequence: (before.publicEventHead?.sequence ?? 0) + 1,
            payload: {
              type: 'run_state_changed',
              previousState: 'accepted',
              state: 'running',
              runRevision: before.revision + 1,
            },
          },
          {
            sequence: (before.publicEventHead?.sequence ?? 0) + 2,
            payload: {
              type: 'activation_changed',
              activationNumber: 1,
              state: 'active',
              endReason: null,
            },
          },
        ]);
        expect(appended[0]?.previousEventHash).toBe(beforeEvents.at(-1)?.eventHash ?? null);
        expect(appended[1]?.previousEventHash).toBe(appended[0]?.eventHash);
        expect(activation.eventStartSequence).toBe(appended[1]?.sequence);
        expect(after).toMatchObject({
          revision: before.revision + 1,
          status: 'running',
          publicEventHead: {
            sequence: appended[1]?.sequence,
            hash: appended[1]?.eventHash,
          },
        });
        expect(hashContentObject(after)).toBe(after.contentHash);
      }

      const failedChild = fixture.data.runs.spawnChild(
        spawnChildInput(
          currentRun(fixture, fixture.run.id, 'activation-rollback-parent'),
          [],
          'operation.spawn.activation-rollback',
        ),
        hostContext,
      );
      const failedRunId = failedChild.child.childRunId;
      const failedInbox = fixture.data.runs.listInbox(failedRunId)[0]!;
      fixture.data.runs.transitionInbox(
        {
          runId: failedRunId,
          expectedRevision: failedChild.child.revision,
          inboxMessageId: failedInbox.id,
          sequence: failedInbox.sequence,
          action: 'deliver',
          commandId: 'command.activation-rollback.deliver',
        },
        hostContext,
      );
      const beforeFailure = currentRun(fixture, failedRunId, 'activation-rollback-before');
      const beforeFailureEvents = fixture.data.runs.listPublicEvents({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.activation-rollback.events-before',
        method: 'run.events.list',
        input: { runId: failedRunId, afterSequence: null, page: { cursor: null, limit: 100 } },
      }).result.items;
      fixture.database.exec(`
        CREATE TEMP TRIGGER fail_activation_run_advance
        BEFORE UPDATE OF status ON runs
        WHEN OLD.status = 'accepted' AND NEW.status = 'running'
        BEGIN
          SELECT RAISE(ABORT, 'injected activation advance failure');
        END;
      `);

      expect(() =>
        fixture.data.runs.startActivation(
          {
            runId: failedRunId,
            expectedRevision: beforeFailure.revision,
            commandId: 'command.activation-rollback.start',
          },
          hostContext,
        ),
      ).toThrow('injected activation advance failure');
      expect(currentRun(fixture, failedRunId, 'activation-rollback-after')).toEqual(beforeFailure);
      expect(fixture.data.runs.listActivations(failedRunId)).toEqual([]);
      expect(
        fixture.data.runs.listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.activation-rollback.events-after',
          method: 'run.events.list',
          input: { runId: failedRunId, afterSequence: null, page: { cursor: null, limit: 100 } },
        }).result.items,
      ).toEqual(beforeFailureEvents);
    } finally {
      fixture.store.close();
    }
  });

  it('keeps running and recovering Run state while appending only the Activation event', async () => {
    for (const status of ['running', 'recovering'] as const) {
      const fixture = await harness();
      try {
        const inbox = fixture.data.runs.listInbox(fixture.run.id)[0]!;
        fixture.data.runs.transitionInbox(
          {
            runId: fixture.run.id,
            expectedRevision: 0,
            inboxMessageId: inbox.id,
            sequence: inbox.sequence,
            action: 'deliver',
            commandId: `command.activation-${status}.deliver`,
          },
          hostContext,
        );
        const before = setRunStatus(
          fixture,
          currentRun(fixture, fixture.run.id, `activation-${status}-delivered`),
          status,
        );
        const activation = fixture.data.runs.startActivation(
          {
            runId: fixture.run.id,
            expectedRevision: before.revision,
            commandId: `command.activation-${status}.start`,
          },
          hostContext,
        );
        const after = currentRun(fixture, fixture.run.id, `activation-${status}-after`);
        const events = fixture.data.runs.listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: `request.activation-${status}.events`,
          method: 'run.events.list',
          input: {
            runId: fixture.run.id,
            afterSequence: before.publicEventHead!.sequence,
            page: { cursor: null, limit: 10 },
          },
        }).result.items;

        expect(events).toHaveLength(1);
        expect(events[0]?.payloadState).toEqual({
          state: 'available',
          payload: {
            type: 'activation_changed',
            activationNumber: 1,
            state: 'active',
            endReason: null,
          },
        });
        expect(activation.eventStartSequence).toBe(events[0]?.sequence);
        expect(after).toMatchObject({ revision: before.revision + 1, status });
        expect(hashContentObject(after)).toBe(after.contentHash);
      } finally {
        fixture.store.close();
      }
    }
  });

  it.each(['waiting_question', 'waiting_confirmation', 'paused'] as const)(
    'does not start an Activation while a delivered Run is %s',
    async (status) => {
      const fixture = await harness();
      try {
        const inbox = fixture.data.runs.listInbox(fixture.run.id)[0]!;
        fixture.data.runs.transitionInbox(
          {
            runId: fixture.run.id,
            expectedRevision: 0,
            inboxMessageId: inbox.id,
            sequence: inbox.sequence,
            action: 'deliver',
            commandId: `command.activation-${status}.deliver`,
          },
          hostContext,
        );
        const before = setRunStatus(
          fixture,
          currentRun(fixture, fixture.run.id, `activation-${status}-delivered`),
          status,
        );
        expect(() =>
          fixture.data.runs.startActivation(
            {
              runId: fixture.run.id,
              expectedRevision: before.revision,
              commandId: `command.activation-${status}.start`,
            },
            hostContext,
          ),
        ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
        expect(currentRun(fixture, fixture.run.id, `activation-${status}-after`)).toEqual(before);
        expect(fixture.data.runs.listActivations(fixture.run.id)).toEqual([]);
      } finally {
        fixture.store.close();
      }
    },
  );

  it('does not start an Activation for a terminal Run', async () => {
    const terminal = await harness();
    try {
      const before = terminal.data.runs.terminalize(
        {
          runId: terminal.run.id,
          expectedRevision: 0,
          status: 'cancelled',
          summary: 'Terminal Activation rejection.',
          resultIds: [],
          commandId: 'command.activation-terminal.cancel',
        },
        hostContext,
      );
      expect(() =>
        terminal.data.runs.startActivation(
          {
            runId: terminal.run.id,
            expectedRevision: before.revision,
            commandId: 'command.activation-terminal.start',
          },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(currentRun(terminal, terminal.run.id, 'activation-terminal-after')).toEqual(before);
      expect(terminal.data.runs.listActivations(terminal.run.id)).toEqual([]);
    } finally {
      terminal.store.close();
    }
  });

  it('enforces Inbox FIFO and Run CAS while maintaining contiguous Activation epochs and ranges', async () => {
    const fixture = await harness();
    try {
      const inbox1 = fixture.data.runs.listInbox(fixture.run.id)[0]!;
      const followup = fixture.data.runs.sendFollowup(
        followupRequest(fixture.run),
        context,
        followupSeed,
      ).result;
      expect(() =>
        fixture.data.runs.transitionInbox(
          {
            runId: fixture.run.id,
            expectedRevision: 1,
            inboxMessageId: followup.id,
            sequence: followup.sequence,
            action: 'deliver',
            commandId: 'command.deliver.out-of-order',
          },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      const delivered = fixture.data.runs.transitionInbox(
        {
          runId: fixture.run.id,
          expectedRevision: 1,
          inboxMessageId: inbox1.id,
          sequence: inbox1.sequence,
          action: 'deliver',
          commandId: 'command.deliver.1',
        },
        hostContext,
      );
      expect(delivered.state).toBe('delivered');
      expect(() =>
        fixture.data.runs.transitionInbox(
          {
            runId: fixture.run.id,
            expectedRevision: 1,
            inboxMessageId: inbox1.id,
            sequence: inbox1.sequence,
            action: 'consume',
            commandId: 'command.consume.stale',
          },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));

      const activation1 = fixture.data.runs.startActivation(
        { runId: fixture.run.id, expectedRevision: 2, commandId: 'command.activation.start.1' },
        hostContext,
      );
      expect(activation1).toMatchObject({
        activationNumber: 1,
        triggerInboxMessageId: inbox1.id,
        triggerInboxSequence: 1,
        state: 'active',
        eventStartSequence: 4,
      });
      expect(() =>
        fixture.data.runs.startActivation(
          { runId: fixture.run.id, expectedRevision: 3, commandId: 'command.activation.duplicate' },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      fixture.data.runs.transitionInbox(
        {
          runId: fixture.run.id,
          expectedRevision: 3,
          inboxMessageId: inbox1.id,
          sequence: inbox1.sequence,
          action: 'consume',
          commandId: 'command.consume.1',
        },
        hostContext,
      );
      const consumedEvidence = fixture.database
        .prepare(
          `SELECT event.surface, payload.payload_v1_json
           FROM run_events AS event
           JOIN run_event_payloads AS payload ON payload.run_event_id = event.id
           WHERE event.run_id = ? AND event.sequence > ?
           ORDER BY event.sequence`,
        )
        .all(fixture.run.id, activation1.eventStartSequence) as unknown as Array<{
        surface: 'public' | 'model_surface';
        payload_v1_json: string;
      }>;
      expect(
        consumedEvidence.map(({ surface, payload_v1_json }) => ({
          surface,
          payload: JSON.parse(payload_v1_json) as unknown,
        })),
      ).toEqual([
        {
          surface: 'public',
          payload: {
            inboxMessageId: inbox1.id,
            sequence: inbox1.sequence,
            state: 'consumed',
            type: 'inbox_state_changed',
          },
        },
        {
          surface: 'model_surface',
          payload: {
            contentHash: inbox1.contentHash,
            inboxMessageId: inbox1.id,
            sequence: inbox1.sequence,
            type: 'inbox_consumed',
          },
        },
        {
          surface: 'model_surface',
          payload: {
            messageHash: inbox1.contentHash,
            messageId: inbox1.source.kind === 'message' ? inbox1.source.messageId : null,
            role: 'user',
            type: 'message_ref',
          },
        },
      ]);
      expect(() =>
        fixture.data.runs.endActivation(
          {
            runId: fixture.run.id,
            expectedRevision: 3,
            activationNumber: 1,
            reason: 'safe_boundary',
            commandId: 'command.activation.end.stale',
          },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      const ended1 = fixture.data.runs.endActivation(
        {
          runId: fixture.run.id,
          expectedRevision: 4,
          activationNumber: 1,
          reason: 'safe_boundary',
          commandId: 'command.activation.end.1',
        },
        hostContext,
      );
      expect(ended1).toMatchObject({
        state: 'ended',
        eventEndSequence: 8,
        endReason: 'safe_boundary',
      });

      fixture.data.runs.transitionInbox(
        {
          runId: fixture.run.id,
          expectedRevision: 5,
          inboxMessageId: followup.id,
          sequence: followup.sequence,
          action: 'deliver',
          commandId: 'command.deliver.2',
        },
        hostContext,
      );
      const activation2 = fixture.data.runs.startActivation(
        { runId: fixture.run.id, expectedRevision: 6, commandId: 'command.activation.start.2' },
        hostContext,
      );
      expect(activation2).toMatchObject({
        activationNumber: 2,
        triggerInboxSequence: 2,
        eventStartSequence: 10,
      });
      expect(fixture.data.runs.listActivations(fixture.run.id)).toEqual([ended1, activation2]);
    } finally {
      fixture.store.close();
    }
  });

  it('reopens with deterministic Run, Inbox, Activation, and public Journal reads', async () => {
    const fixture = await harness();
    const inbox = fixture.data.runs.listInbox(fixture.run.id)[0]!;
    fixture.data.runs.transitionInbox(
      {
        runId: fixture.run.id,
        expectedRevision: 0,
        inboxMessageId: inbox.id,
        sequence: inbox.sequence,
        action: 'deliver',
        commandId: 'command.reopen.deliver',
      },
      hostContext,
    );
    const beforeRun = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.run.before-reopen',
      method: 'run.get',
      input: { runId: fixture.run.id },
    }).result;
    const beforeInbox = fixture.data.runs.listInbox(fixture.run.id);
    fixture.store.close();

    const reopened = await openStore(fixture.databasePath);
    try {
      const runs = dataAccess(reopened, deterministicIds()).runs;
      expect(
        runs.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.after-reopen',
          method: 'run.get',
          input: { runId: fixture.run.id },
        }).result,
      ).toEqual(beforeRun);
      expect(runs.listInbox(fixture.run.id)).toEqual(beforeInbox);
      expect(
        runs.listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.events.after-reopen',
          method: 'run.events.list',
          input: { runId: fixture.run.id, afterSequence: null, page: { cursor: null, limit: 10 } },
        }).result.items,
      ).toHaveLength(1);
    } finally {
      reopened.close();
    }
  });

  it('uses a Run- and filter-bound cursor over unified event sequences', async () => {
    const fixture = await harness();
    try {
      fixture.data.runs.sendFollowup(followupRequest(fixture.run), context, followupSeed);
      const firstInbox = fixture.data.runs.listInbox(fixture.run.id)[0]!;
      fixture.data.runs.transitionInbox(
        {
          runId: fixture.run.id,
          expectedRevision: 1,
          inboxMessageId: firstInbox.id,
          sequence: firstInbox.sequence,
          action: 'deliver',
          commandId: 'command.cursor.deliver',
        },
        hostContext,
      );
      const first = fixture.data.runs.listPublicEvents({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.events.cursor.first',
        method: 'run.events.list',
        input: {
          runId: fixture.run.id,
          afterSequence: null,
          page: { cursor: null, limit: 1 },
        },
      }).result;
      const second = fixture.data.runs.listPublicEvents({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.events.cursor.second',
        method: 'run.events.list',
        input: {
          runId: fixture.run.id,
          afterSequence: null,
          page: { cursor: first.nextCursor, limit: 1 },
        },
      }).result;
      expect(first.items.map(({ sequence }) => sequence)).toEqual([1]);
      expect(second.items.map(({ sequence }) => sequence)).toEqual([2]);
      expect(second.nextCursor).toBeNull();
      expect(() =>
        fixture.data.runs.listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.events.cursor.wrong-filter',
          method: 'run.events.list',
          input: {
            runId: fixture.run.id,
            afterSequence: 1,
            page: { cursor: first.nextCursor, limit: 1 },
          },
        }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      fixture.store.close();
    }
  });

  it('owns the optional TaskList lifecycle and every task.manage mutation without receipts', async () => {
    const fixture = await harness();
    try {
      const receiptCount = delegationCounts(fixture.database).wire_command_receipts;
      expect(fixture.data.taskLists.get(fixture.run.id)).toBeNull();
      expect(
        manageTasks(
          fixture,
          fixture.run.id,
          TaskManageDefinition.parseInput({ action: 'get' }),
          'command.tasks.get.empty',
        ),
      ).toEqual({ taskList: null, changedTaskIds: [] });

      const createSummary = '已创建镜头任务：夜雨 🌧️';
      const created = manageTasks(
        fixture,
        fixture.run.id,
        TaskManageDefinition.parseInput({
          action: 'create',
          expectedRunRevision: 0,
          title: 'Night sequence',
          tasks: [
            { draftId: 'draft.root', title: 'Build sequence', parentDraftId: null, order: 0 },
            {
              draftId: 'draft.shot',
              title: 'Compose rain shot',
              parentDraftId: 'draft.root',
              order: 0,
            },
          ],
          publicSummary: createSummary,
        }),
        'command.tasks.create',
      );
      expect(created.taskList).toMatchObject({
        runId: fixture.run.id,
        title: 'Night sequence',
        state: 'active',
        revision: 1,
        terminalizedAt: null,
      });
      expect(created.changedTaskIds).toEqual(created.taskList!.items.map(({ id }) => id));
      expect(hashContentObject(created.taskList!)).toBe(created.taskList!.contentHash);
      const rootTask = created.taskList!.items.find(({ parentItemId }) => parentItemId === null)!;
      const shotTask = created.taskList!.items.find(({ parentItemId }) => parentItemId !== null)!;
      expect(shotTask.parentItemId).toBe(rootTask.id);
      expect(currentRun(fixture, fixture.run.id, 'after-task-create').revision).toBe(1);

      const noOp = manageTasks(
        fixture,
        fixture.run.id,
        TaskManageDefinition.parseInput({
          action: 'rename',
          expectedRevision: 1,
          title: created.taskList!.title,
          publicSummary: 'No semantic change.',
        }),
        'command.tasks.rename.noop',
      );
      expect(noOp).toEqual({ taskList: created.taskList, changedTaskIds: [] });
      expect(currentRun(fixture, fixture.run.id, 'after-task-noop').revision).toBe(1);

      manageTasks(
        fixture,
        fixture.run.id,
        TaskManageDefinition.parseInput({
          action: 'rename',
          expectedRevision: 1,
          title: 'Rain-soaked sequence',
          publicSummary: 'Renamed the working list.',
        }),
        'command.tasks.rename',
      );
      const addedResult = manageTasks(
        fixture,
        fixture.run.id,
        TaskManageDefinition.parseInput({
          action: 'add',
          expectedRevision: 2,
          parentTaskId: rootTask.id,
          order: 0,
          title: 'Check continuity',
          publicSummary: 'Added continuity work.',
        }),
        'command.tasks.add',
      );
      const added = addedResult.taskList!.items.find(({ title }) => title === 'Check continuity')!;
      expect(addedResult.taskList!.items.find(({ id }) => id === shotTask.id)?.order).toBe(1);
      expect(addedResult.changedTaskIds).toEqual([added.id]);

      const parent = currentRun(fixture, fixture.run.id, 'before-task-child');
      const child = fixture.data.runs.spawnChild(
        spawnChildInput(parent, [], 'operation.spawn.task-child'),
        hostContext,
      );
      const updated = manageTasks(
        fixture,
        fixture.run.id,
        TaskManageDefinition.parseInput({
          action: 'update',
          expectedRevision: 3,
          taskId: added.id,
          title: 'Check cyan continuity',
          state: 'in_progress',
          resultSummary: 'Continuity review delegated.',
          childRunId: child.child.childRunId,
          publicSummary: 'Updated and delegated continuity work.',
        }),
        'command.tasks.update',
      );
      expect(updated.taskList!.items.find(({ id }) => id === added.id)).toMatchObject({
        title: 'Check cyan continuity',
        state: 'in_progress',
        publicNote: 'Continuity review delegated.',
        childRunIds: [child.child.childRunId],
      });

      const reordered = manageTasks(
        fixture,
        fixture.run.id,
        TaskManageDefinition.parseInput({
          action: 'reorder',
          expectedRevision: 4,
          parentTaskId: rootTask.id,
          orderedTaskIds: [shotTask.id, added.id],
          publicSummary: 'Reordered the direct child tasks.',
        }),
        'command.tasks.reorder',
      );
      expect(reordered.changedTaskIds).toEqual([shotTask.id, added.id]);
      expect(
        reordered.taskList!.items.filter(({ parentItemId }) => parentItemId === rootTask.id),
      ).toMatchObject([
        { id: shotTask.id, order: 0 },
        { id: added.id, order: 1 },
      ]);

      const removed = manageTasks(
        fixture,
        fixture.run.id,
        TaskManageDefinition.parseInput({
          action: 'remove',
          expectedRevision: 5,
          taskId: added.id,
          publicSummary: 'Removed the completed continuity branch.',
        }),
        'command.tasks.remove',
      );
      expect(removed.changedTaskIds).toEqual([added.id]);
      expect(removed.taskList!.items.some(({ id }) => id === added.id)).toBe(false);

      const terminal = manageTasks(
        fixture,
        fixture.run.id,
        TaskManageDefinition.parseInput({
          action: 'terminalize',
          expectedRevision: 6,
          state: 'completed',
          publicSummary: 'Task work complete.',
        }),
        'command.tasks.terminalize',
      ).taskList!;
      expect(terminal).toMatchObject({ state: 'completed', revision: 7, terminalizedAt: NOW });
      expect(() =>
        manageTasks(
          fixture,
          fixture.run.id,
          TaskManageDefinition.parseInput({
            action: 'rename',
            expectedRevision: 7,
            title: 'Forbidden terminal edit',
            publicSummary: 'Should fail.',
          }),
          'command.tasks.terminal-edit',
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      const taskEvents = fixture.data.runs
        .listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.task-events',
          method: 'run.events.list',
          input: { runId: fixture.run.id, afterSequence: null, page: { cursor: null, limit: 100 } },
        })
        .result.items.filter(
          ({ payloadState }) =>
            payloadState.state === 'available' && payloadState.payload.type === 'task_list_changed',
        );
      expect(taskEvents).toHaveLength(7);
      expect(taskEvents[0]?.payloadState).toMatchObject({
        state: 'available',
        payload: { publicSummary: createSummary },
      });
      expect(delegationCounts(fixture.database).wire_command_receipts).toBe(receiptCount);

      fixture.store.close();
      const reopened = await openStore(fixture.databasePath);
      try {
        expect(dataAccess(reopened, deterministicIds()).taskLists.get(fixture.run.id)).toEqual(
          terminal,
        );
      } finally {
        reopened.close();
      }
    } finally {
      fixture.store.close();
    }
  }, 10_000);

  it('keeps an active Activation durable across pause and resume, then cancels it atomically with its TaskList', async () => {
    const fixture = await harness();
    try {
      makeRunning(fixture, fixture.run);
      const inbox = fixture.data.runs.listInbox(fixture.run.id)[0]!;
      fixture.data.runs.transitionInbox(
        {
          runId: fixture.run.id,
          expectedRevision: 0,
          inboxMessageId: inbox.id,
          sequence: inbox.sequence,
          action: 'deliver',
          commandId: 'command.control.deliver',
        },
        hostContext,
      );
      fixture.data.runs.startActivation(
        { runId: fixture.run.id, expectedRevision: 1, commandId: 'command.control.activation' },
        hostContext,
      );
      manageTasks(
        fixture,
        fixture.run.id,
        TaskManageDefinition.parseInput({
          action: 'create',
          expectedRunRevision: 2,
          title: 'Control lifecycle',
          tasks: [],
          publicSummary: 'Created control work.',
        }),
        'command.control.tasks',
      );
      const beforeReceipts = delegationCounts(fixture.database).wire_command_receipts;
      const pauseRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.run.pause',
        method: 'run.control' as const,
        input: {
          runId: fixture.run.id,
          expectedRevision: 3,
          action: 'pause' as const,
          expectedStatus: 'running' as const,
        },
      };
      const paused = fixture.data.runs.control(pauseRequest, hostContext);
      expect(paused.result).toMatchObject({ revision: 4, status: 'paused' });
      expect(fixture.data.runs.control(pauseRequest, hostContext)).toEqual(paused);
      expect(fixture.data.runs.listActivations(fixture.run.id)[0]).toMatchObject({
        state: 'active',
        eventEndSequence: null,
        endReason: null,
      });
      expect(fixture.data.taskLists.get(fixture.run.id)).toMatchObject({
        state: 'active',
        revision: 1,
      });

      const resumed = fixture.data.runs.control(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.resume',
          method: 'run.control',
          input: {
            runId: fixture.run.id,
            expectedRevision: 4,
            action: 'resume',
            expectedStatus: 'paused',
          },
        },
        hostContext,
      );
      expect(resumed.result).toMatchObject({ revision: 5, status: 'running' });
      expect(fixture.data.runs.listActivations(fixture.run.id)).toEqual([
        expect.objectContaining({ state: 'active', activationNumber: 1 }),
      ]);

      const terminalSummary = '用户取消：保留已完成工作。';
      const cancelRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.run.cancel',
        method: 'run.control' as const,
        input: {
          runId: fixture.run.id,
          expectedRevision: 5,
          action: 'cancel' as const,
          expectedStatus: 'running' as const,
          terminalSummary,
        },
      };
      const cancelled = fixture.data.runs.control(cancelRequest, hostContext);
      expect(cancelled.result).toMatchObject({
        revision: 6,
        status: 'cancelled',
        terminalOutcome: { status: 'cancelled', summary: terminalSummary, finishedAt: NOW },
      });
      expect(fixture.data.runs.control(cancelRequest, hostContext)).toEqual(cancelled);
      expect(hashContentObject(cancelled.result)).toBe(cancelled.result.contentHash);
      expect(fixture.data.taskLists.get(fixture.run.id)).toMatchObject({
        state: 'cancelled',
        revision: 2,
        terminalizedAt: NOW,
      });
      const events = fixture.data.runs.listPublicEvents({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.control.events',
        method: 'run.events.list',
        input: { runId: fixture.run.id, afterSequence: null, page: { cursor: null, limit: 100 } },
      }).result.items;
      expect(
        events
          .slice(-3)
          .map(({ payloadState }) =>
            payloadState.state === 'available' ? payloadState.payload : null,
          ),
      ).toEqual([
        {
          type: 'task_list_changed',
          taskListId: fixture.data.taskLists.get(fixture.run.id)!.id,
          revision: 2,
          publicSummary: terminalSummary,
        },
        { type: 'run_state_changed', previousState: 'running', state: 'cancelled', runRevision: 6 },
        { type: 'terminal_summary', status: 'cancelled', summary: terminalSummary, resultIds: [] },
      ]);
      const last = events.at(-1)!;
      expect(cancelled.result.terminalOutcome?.terminalEventId).toBe(last.eventId);
      expect(delegationCounts(fixture.database).wire_command_receipts).toBe(beforeReceipts + 3);
    } finally {
      fixture.store.close();
    }

    const rollback = await harness();
    try {
      expect(() =>
        rollback.data.runs.control(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.run.pause.illegal',
            method: 'run.control',
            input: {
              runId: rollback.run.id,
              expectedRevision: 0,
              action: 'pause',
              expectedStatus: 'running',
            },
          },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      makeRunning(rollback, rollback.run);
      const before = delegationCounts(rollback.database);
      rollback.database.exec(`
        CREATE TEMP TRIGGER fail_run_control
        BEFORE UPDATE ON runs
        BEGIN
          SELECT RAISE(ABORT, 'injected run control failure');
        END;
      `);
      expect(() =>
        rollback.data.runs.control(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.run.pause.rollback',
            method: 'run.control',
            input: {
              runId: rollback.run.id,
              expectedRevision: 0,
              action: 'pause',
              expectedStatus: 'running',
            },
          },
          hostContext,
        ),
      ).toThrow('injected run control failure');
      expect(delegationCounts(rollback.database)).toEqual(before);
      expect(currentRun(rollback, rollback.run.id, 'after-control-rollback').status).toBe(
        'running',
      );
    } finally {
      rollback.store.close();
    }
  }, 15_000);

  it('settles an aborted running Model Attempt and releases its reservation before a paused Activation resumes', async () => {
    const fixture = await harness();
    try {
      const running = startRunningActivation(fixture, 'command.control.attempt');
      const delivered = fixture.data.runs.listInbox(running.id)[0];
      if (delivered === undefined) throw new Error('Expected a delivered Run Inbox message');
      fixture.data.runs.transitionInbox(
        {
          runId: running.id,
          expectedRevision: running.revision,
          inboxMessageId: delivered.id,
          sequence: delivered.sequence,
          action: 'consume',
          commandId: 'command.control.attempt.consume',
        },
        hostContext,
      );
      const initial = fixture.data.harness.loadActivation(running.id, 1);
      const prepared = fixture.data.harness.prepareModelBoundary(
        {
          request: modelRequestFor(initial, 'model-attempt.control.pause.1'),
          quote: modelQuote,
          commandId: 'command.control.attempt.prepare',
        },
        hostContext,
      );
      if (prepared.kind !== 'prepared') throw new Error('Expected a prepared Model Attempt');
      const attempt = prepared.commit.value;
      fixture.data.harness.markModelAttemptRunning(
        {
          attemptId: attempt.id,
          requestHash: attempt.requestHash,
          commandId: 'command.control.attempt.running',
        },
        hostContext,
      );
      const beforePause = currentRun(fixture, running.id, 'control-attempt-before-pause');

      const paused = fixture.data.runs.control(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.control.attempt.pause',
          method: 'run.control',
          input: {
            runId: running.id,
            expectedRevision: beforePause.revision,
            action: 'pause',
            expectedStatus: 'running',
          },
        },
        context,
      );
      expect(paused.result.status).toBe('paused');
      const pausedSnapshot = fixture.data.harness.loadActivation(running.id, 1);
      expect(pausedSnapshot.activation.state).toBe('active');
      expect(pausedSnapshot.recoveryRequired).toBe(false);
      expect(pausedSnapshot.modelAttempts).toEqual([
        expect.objectContaining({
          id: attempt.id,
          state: 'cancelled',
          usage: {
            inputTokens: { state: 'estimated', value: 120 },
            outputTokens: { state: 'estimated', value: 24 },
            cost: { state: 'estimated', value: '0.5', currency: 'USD' },
          },
          response: expect.objectContaining({
            events: expect.arrayContaining([
              expect.objectContaining({
                type: 'model_failed',
                typedCode: 'cancelled',
                providerState: 'unknown',
              }),
            ]),
          }),
        }),
      ]);
      expect(
        fixture.database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM run_resource_entries AS reservation
             WHERE reservation.model_attempt_id = ? AND reservation.phase = 'reserved'
               AND NOT EXISTS (
                 SELECT 1
                 FROM run_resource_entries AS released
                 WHERE released.phase = 'released' AND released.reservation_entry_id = reservation.id
               )`,
          )
          .get(attempt.id),
      ).toEqual({ count: 0 });

      const resumed = fixture.data.runs.control(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.control.attempt.resume',
          method: 'run.control',
          input: {
            runId: running.id,
            expectedRevision: paused.result.revision,
            action: 'resume',
            expectedStatus: 'paused',
          },
        },
        context,
      );
      const resumedSnapshot = fixture.data.harness.loadActivation(running.id, 1);
      expect(resumed.result.status).toBe('running');
      expect(resumedSnapshot.activation.state).toBe('active');
      expect(resumedSnapshot.recoveryRequired).toBe(false);
      expect(
        fixture.data.harness.prepareModelBoundary(
          {
            request: modelRequestFor(resumedSnapshot, 'model-attempt.control.pause.2'),
            quote: modelQuote,
            commandId: 'command.control.attempt.resume.prepare',
          },
          hostContext,
        ).kind,
      ).toBe('prepared');
    } finally {
      fixture.store.close();
    }
  }, 15_000);

  it('pauses active descendants, blocks accepted descendants, and cancels the selected Run subtree', async () => {
    const fixture = await harness();
    try {
      let parent = startRunningActivation(fixture, 'command.control.subtree.parent');
      const acceptedChildResult = fixture.data.runs.spawnChild(
        spawnChildInput(parent, [], 'command.control.subtree.accepted-child.spawn'),
        hostContext,
      );
      parent = currentRun(fixture, fixture.run.id, 'control-subtree-parent-after-accepted-child');
      const childResult = fixture.data.runs.spawnChild(
        spawnChildInput(parent, [], 'command.control.subtree.child.spawn'),
        hostContext,
      );
      const childContext = {
        actor: 'commander' as const,
        causation: { kind: 'run' as const, runId: childResult.child.childRunId },
        correlationId: 'correlation.control.subtree.child',
      };
      let child = currentRun(
        fixture,
        childResult.child.childRunId,
        'control-subtree-child-accepted',
      );
      const childInbox = fixture.data.runs.listInbox(child.id)[0];
      if (childInbox === undefined) throw new Error('Expected child Inbox');
      fixture.data.runs.transitionInbox(
        {
          runId: child.id,
          expectedRevision: child.revision,
          inboxMessageId: childInbox.id,
          sequence: childInbox.sequence,
          action: 'deliver',
          commandId: 'command.control.subtree.child.deliver',
        },
        childContext,
      );
      child = currentRun(fixture, child.id, 'control-subtree-child-delivered');
      fixture.data.runs.startActivation(
        {
          runId: child.id,
          expectedRevision: child.revision,
          commandId: 'command.control.subtree.child.activate',
        },
        childContext,
      );
      child = currentRun(fixture, child.id, 'control-subtree-child-running');
      parent = currentRun(fixture, fixture.run.id, 'control-subtree-parent-running');
      expect([parent.status, child.status]).toEqual(['running', 'running']);

      const paused = fixture.data.runs.control(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.control.subtree.pause',
          method: 'run.control',
          input: {
            runId: parent.id,
            expectedRevision: parent.revision,
            action: 'pause',
            expectedStatus: 'running',
          },
        },
        context,
      );
      expect(paused.result.status).toBe('paused');
      expect(currentRun(fixture, child.id, 'control-subtree-child-paused').status).toBe('paused');
      const acceptedChild = currentRun(
        fixture,
        acceptedChildResult.child.childRunId,
        'control-subtree-accepted-child-paused',
      );
      expect(acceptedChild.status).toBe('accepted');
      expect(fixture.data.runs.isSchedulingAllowed(acceptedChild.id)).toBe(false);
      expect(() =>
        fixture.data.runs.startActivation(
          {
            runId: acceptedChild.id,
            expectedRevision: acceptedChild.revision,
            commandId: 'command.control.subtree.accepted-child.blocked-start',
          },
          {
            actor: 'commander',
            causation: { kind: 'run', runId: acceptedChild.id },
            correlationId: 'correlation.control.subtree.accepted-child',
          },
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(fixture.data.runs.listActivations(parent.id)[0]).toMatchObject({ state: 'active' });
      expect(fixture.data.runs.listActivations(child.id)[0]).toMatchObject({ state: 'active' });

      const resumed = fixture.data.runs.control(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.control.subtree.resume',
          method: 'run.control',
          input: {
            runId: parent.id,
            expectedRevision: paused.result.revision,
            action: 'resume',
            expectedStatus: 'paused',
          },
        },
        context,
      );
      expect(resumed.result.status).toBe('running');
      expect(currentRun(fixture, child.id, 'control-subtree-child-resumed').status).toBe('running');
      expect(
        currentRun(fixture, acceptedChild.id, 'control-subtree-accepted-child-resumed').status,
      ).toBe('accepted');
      expect(fixture.data.runs.isSchedulingAllowed(acceptedChild.id)).toBe(true);

      const cancelled = fixture.data.runs.control(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.control.subtree.cancel',
          method: 'run.control',
          input: {
            runId: parent.id,
            expectedRevision: resumed.result.revision,
            action: 'cancel',
            expectedStatus: 'running',
            terminalSummary: 'Cancel the entire active delegation subtree.',
          },
        },
        context,
      );
      expect(cancelled.result.status).toBe('cancelled');
      expect(currentRun(fixture, child.id, 'control-subtree-child-cancelled').status).toBe(
        'cancelled',
      );
      expect(
        currentRun(fixture, acceptedChild.id, 'control-subtree-accepted-child-cancelled').status,
      ).toBe('cancelled');
      expect(fixture.data.runs.listActivations(child.id)[0]).toMatchObject({
        state: 'ended',
        endReason: 'terminal',
      });
    } finally {
      fixture.store.close();
    }
  }, 15_000);

  it('enforces TaskList CAS, tree shape, leaf removal, operation uniqueness, and child lineage', async () => {
    const fixture = await harness();
    try {
      expect(() =>
        TaskManageDefinition.parseInput({
          action: 'create',
          expectedRunRevision: 0,
          title: 'Cycle',
          tasks: [
            { draftId: 'draft.a', title: 'A', parentDraftId: 'draft.b', order: 0 },
            { draftId: 'draft.b', title: 'B', parentDraftId: 'draft.a', order: 0 },
          ],
          publicSummary: 'Invalid cycle.',
        }),
      ).toThrow();

      const childResult = fixture.data.runs.spawnChild(
        spawnChildInput(fixture.run, [], 'operation.spawn.task-owner'),
        hostContext,
      );
      const childRun = currentRun(fixture, childResult.child.childRunId, 'task-owner');
      const createInput = TaskManageDefinition.parseInput({
        action: 'create',
        expectedRunRevision: childRun.revision,
        title: 'Child work',
        tasks: [
          { draftId: 'draft.parent', title: 'Parent', parentDraftId: null, order: 0 },
          {
            draftId: 'draft.leaf',
            title: 'Leaf',
            parentDraftId: 'draft.parent',
            order: 0,
          },
        ],
        publicSummary: 'Created child work.',
      });
      const created = manageTasks(fixture, childRun.id, createInput, 'command.tasks.child.create');
      const afterCreateCounts = delegationCounts(fixture.database);
      expect(() =>
        manageTasks(fixture, childRun.id, createInput, 'command.tasks.child.create'),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(delegationCounts(fixture.database)).toEqual(afterCreateCounts);

      const parentTask = created.taskList!.items.find(({ parentItemId }) => parentItemId === null)!;
      const leafTask = created.taskList!.items.find(({ parentItemId }) => parentItemId !== null)!;
      expect(() =>
        manageTasks(
          fixture,
          childRun.id,
          TaskManageDefinition.parseInput({
            action: 'rename',
            expectedRevision: 0,
            title: 'Stale',
            publicSummary: 'Stale edit.',
          }),
          'command.tasks.stale',
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(() =>
        manageTasks(
          fixture,
          childRun.id,
          TaskManageDefinition.parseInput({
            action: 'remove',
            expectedRevision: 1,
            taskId: parentTask.id,
            publicSummary: 'Invalid parent removal.',
          }),
          'command.tasks.remove-parent',
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        manageTasks(
          fixture,
          childRun.id,
          TaskManageDefinition.parseInput({
            action: 'reorder',
            expectedRevision: 1,
            parentTaskId: parentTask.id,
            orderedTaskIds: ['task.missing'],
            publicSummary: 'Invalid sibling set.',
          }),
          'command.tasks.bad-reorder',
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        manageTasks(
          fixture,
          childRun.id,
          TaskManageDefinition.parseInput({
            action: 'add',
            expectedRevision: 1,
            parentTaskId: parentTask.id,
            order: 2,
            title: 'Out of range',
            publicSummary: 'Invalid insertion order.',
          }),
          'command.tasks.bad-order',
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        manageTasks(
          fixture,
          childRun.id,
          TaskManageDefinition.parseInput({
            action: 'update',
            expectedRevision: 1,
            taskId: leafTask.id,
            title: null,
            state: null,
            resultSummary: null,
            childRunId: fixture.run.id,
            publicSummary: 'Invalid ancestor link.',
          }),
          'command.tasks.bad-lineage',
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      const ownerAfterList = currentRun(fixture, childRun.id, 'before-grandchild');
      const grandchild = fixture.data.runs.spawnChild(
        spawnChildInput(ownerAfterList, [], 'operation.spawn.task-grandchild'),
        hostContext,
      );
      const linked = manageTasks(
        fixture,
        childRun.id,
        TaskManageDefinition.parseInput({
          action: 'update',
          expectedRevision: 1,
          taskId: leafTask.id,
          title: null,
          state: null,
          resultSummary: null,
          childRunId: grandchild.child.childRunId,
          publicSummary: 'Linked the descendant Run.',
        }),
        'command.tasks.link-descendant',
      );
      expect(linked.taskList!.items.find(({ id }) => id === leafTask.id)?.childRunIds).toEqual([
        grandchild.child.childRunId,
      ]);
      expect(() =>
        manageTasks(
          fixture,
          childRun.id,
          TaskManageDefinition.parseInput({
            action: 'update',
            expectedRevision: 2,
            taskId: parentTask.id,
            title: null,
            state: null,
            resultSummary: null,
            childRunId: grandchild.child.childRunId,
            publicSummary: 'Duplicate the child link.',
          }),
          'command.tasks.duplicate-child-link',
        ),
      ).toThrow();
    } finally {
      fixture.store.close();
    }
  }, 10_000);

  it('terminalizes atomically, maps an optional TaskList, rejects deep live descendants, and reopens', async () => {
    const present = await harness();
    try {
      makeRunning(present, present.run);
      manageTasks(
        present,
        present.run.id,
        TaskManageDefinition.parseInput({
          action: 'create',
          expectedRunRevision: 0,
          title: 'Finish production',
          tasks: [],
          publicSummary: 'Created finishing work.',
        }),
        'command.terminal.tasks',
      );
      const before = delegationCounts(present.database);
      present.database.exec(`
        CREATE TEMP TRIGGER fail_terminal_run
        BEFORE UPDATE ON runs
        BEGIN
          SELECT RAISE(ABORT, 'injected terminal failure');
        END;
      `);
      expect(() =>
        present.data.runs.terminalize(
          {
            runId: present.run.id,
            expectedRevision: 1,
            status: 'completed',
            summary: 'Production complete.',
            resultIds: ['result.final'],
            commandId: 'command.terminal.rollback',
          },
          hostContext,
        ),
      ).toThrow('injected terminal failure');
      expect(delegationCounts(present.database)).toEqual(before);
      expect(present.data.taskLists.get(present.run.id)).toMatchObject({
        state: 'active',
        revision: 1,
      });
      present.database.exec('DROP TRIGGER fail_terminal_run');

      const completed = present.data.runs.terminalize(
        {
          runId: present.run.id,
          expectedRevision: 1,
          status: 'completed',
          summary: 'Production complete.',
          resultIds: ['result.final'],
          commandId: 'command.terminal.complete',
        },
        hostContext,
      );
      expect(completed).toMatchObject({
        revision: 2,
        status: 'completed',
        terminalOutcome: { summary: 'Production complete.', finishedAt: NOW },
      });
      expect(present.data.taskLists.get(present.run.id)).toMatchObject({
        state: 'completed',
        revision: 2,
        terminalizedAt: NOW,
      });
      const completedEvents = present.data.runs.listPublicEvents({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.terminal.events',
        method: 'run.events.list',
        input: { runId: present.run.id, afterSequence: null, page: { cursor: null, limit: 20 } },
      }).result.items;
      expect(
        completedEvents
          .slice(-3)
          .map(({ payloadState }) =>
            payloadState.state === 'available' ? payloadState.payload.type : 'redacted',
          ),
      ).toEqual(['task_list_changed', 'run_state_changed', 'terminal_summary']);
      expect(completed.terminalOutcome?.terminalEventId).toBe(completedEvents.at(-1)?.eventId);
      expect(hashContentObject(completed)).toBe(completed.contentHash);

      present.store.close();
      const reopened = await openStore(present.databasePath);
      try {
        const reopenedData = dataAccess(reopened, deterministicIds());
        expect(
          reopenedData.runs.get({
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.terminal.reopen',
            method: 'run.get',
            input: { runId: present.run.id },
          }).result,
        ).toEqual(completed);
        expect(reopenedData.taskLists.get(present.run.id)).toMatchObject({ state: 'completed' });
      } finally {
        reopened.close();
      }
    } finally {
      present.store.close();
    }

    const absent = await harness();
    try {
      makeRunning(absent, absent.run);
      const failed = absent.data.runs.terminalize(
        {
          runId: absent.run.id,
          expectedRevision: 0,
          status: 'failed',
          summary: 'Provider failed irrecoverably.',
          resultIds: [],
          commandId: 'command.terminal.no-list',
        },
        hostContext,
      );
      expect(failed).toMatchObject({ status: 'failed', revision: 1 });
      expect(absent.data.taskLists.get(absent.run.id)).toBeNull();
      expect(
        absent.data.runs
          .listPublicEvents({
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.terminal.no-list.events',
            method: 'run.events.list',
            input: { runId: absent.run.id, afterSequence: null, page: { cursor: null, limit: 10 } },
          })
          .result.items.map(({ payloadState }) =>
            payloadState.state === 'available' ? payloadState.payload.type : 'redacted',
          ),
      ).toEqual(['run_state_changed', 'terminal_summary']);
    } finally {
      absent.store.close();
    }

    const lineage = await harness();
    try {
      const child = lineage.data.runs.spawnChild(
        spawnChildInput(lineage.run, [], 'operation.spawn.terminal-child'),
        hostContext,
      );
      const childRun = currentRun(lineage, child.child.childRunId, 'terminal-child');
      const grandchild = lineage.data.runs.spawnChild(
        spawnChildInput(childRun, [], 'operation.spawn.terminal-grandchild'),
        hostContext,
      );
      const before = delegationCounts(lineage.database);
      expect(() =>
        lineage.data.runs.terminalize(
          {
            runId: lineage.run.id,
            expectedRevision: 1,
            status: 'cancelled',
            summary: 'Cannot cancel while descendants are live.',
            resultIds: [],
            commandId: 'command.terminal.live-descendants',
          },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(delegationCounts(lineage.database)).toEqual(before);

      lineage.data.runs.terminalize(
        {
          runId: grandchild.child.childRunId,
          expectedRevision: grandchild.child.revision,
          status: 'cancelled',
          summary: 'Grandchild cancelled.',
          resultIds: [],
          commandId: 'command.terminal.grandchild',
        },
        hostContext,
      );
      lineage.data.runs.terminalize(
        {
          runId: child.child.childRunId,
          expectedRevision: currentRun(
            lineage,
            child.child.childRunId,
            'terminal-child-after-spawn',
          ).revision,
          status: 'cancelled',
          summary: 'Child cancelled.',
          resultIds: [],
          commandId: 'command.terminal.child',
        },
        hostContext,
      );
      expect(
        lineage.data.runs.terminalize(
          {
            runId: lineage.run.id,
            expectedRevision: 1,
            status: 'cancelled',
            summary: 'Root cancelled.',
            resultIds: [],
            commandId: 'command.terminal.root',
          },
          hostContext,
        ).status,
      ).toBe('cancelled');
    } finally {
      lineage.store.close();
    }
  }, 20_000);

  it('cancels queued Inbox work and pending interactions with the shared Run terminal service', async () => {
    const fixture = await harness();
    try {
      fixture.database
        .prepare(
          `INSERT INTO run_interactions (
             id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
             allow_free_text, state, answer_message_id, created_at, resolved_at
           ) VALUES (?, ?, 'question', ?, '[]', '[]', 1, 'pending', NULL, ?, NULL)`,
        )
        .run('interaction.cancel.question', fixture.run.id, 'What should change?', NOW);
      fixture.database
        .prepare(
          `INSERT INTO run_interactions (
             id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
             allow_free_text, state, answer_message_id, created_at, resolved_at
           ) VALUES (?, ?, 'confirmation', ?, '[]', '[]', 0, 'pending', NULL, ?, NULL)`,
        )
        .run('interaction.cancel.confirmation', fixture.run.id, 'Proceed?', NOW);
      const target = {
        authority: 'project' as const,
        id: fixture.project.id,
        revision: fixture.project.revision,
        contentHash: fixture.project.contentHash,
      };
      fixture.database
        .prepare(
          `INSERT INTO run_confirmations (
             id, run_id, interaction_id, target_v1_json, immutable_input_hash,
             decision, decided_by_message_id, requested_at, decided_at
           ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
        )
        .run(
          'confirmation.cancel.pending',
          fixture.run.id,
          'interaction.cancel.confirmation',
          canonicalJson(target),
          hashCanonical(target),
          NOW,
        );

      const cancelled = fixture.data.runs.control(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.cancel.pending-work',
          method: 'run.control',
          input: {
            runId: fixture.run.id,
            expectedRevision: fixture.run.revision,
            action: 'cancel',
            expectedStatus: 'accepted',
            terminalSummary: 'Cancelled before queued work began.',
          },
        },
        hostContext,
      );
      expect(cancelled.result.status).toBe('cancelled');
      expect(fixture.data.runs.listInbox(fixture.run.id)).toEqual([
        expect.objectContaining({ sequence: 1, state: 'cancelled' }),
      ]);
      expect(
        fixture.database
          .prepare(
            `SELECT id, state, resolved_at FROM run_interactions
             WHERE run_id = ? ORDER BY id`,
          )
          .all(fixture.run.id),
      ).toEqual([
        {
          id: 'interaction.cancel.confirmation',
          state: 'cancelled',
          resolved_at: NOW,
        },
        { id: 'interaction.cancel.question', state: 'cancelled', resolved_at: NOW },
      ]);
      expect(
        fixture.database
          .prepare(
            `SELECT decision, decided_by_message_id, decided_at
             FROM run_confirmations WHERE id = ?`,
          )
          .get('confirmation.cancel.pending'),
      ).toEqual({ decision: null, decided_by_message_id: null, decided_at: null });
      const payloadTypes = fixture.data.runs
        .listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.cancel.pending-work.events',
          method: 'run.events.list',
          input: { runId: fixture.run.id, afterSequence: null, page: { cursor: null, limit: 100 } },
        })
        .result.items.map(({ payloadState }) =>
          payloadState.state === 'available' ? payloadState.payload.type : 'redacted',
        );
      expect(payloadTypes.slice(-3)).toEqual([
        'inbox_state_changed',
        'run_state_changed',
        'terminal_summary',
      ]);
    } finally {
      fixture.store.close();
    }
  });

  it('keeps active TaskLists out of Chat lifecycle and frozen capability decisions', async () => {
    const fixture = await harness();
    try {
      manageTasks(
        fixture,
        fixture.run.id,
        TaskManageDefinition.parseInput({
          action: 'create',
          expectedRunRevision: 0,
          title: 'Independent tracker',
          tasks: [],
          publicSummary: 'Created an independent task tracker.',
        }),
        'command.tasks.independent',
      );
      const parent = currentRun(fixture, fixture.run.id, 'independent-parent');
      const child = fixture.data.runs.spawnChild(
        spawnChildInput(parent, [], 'operation.spawn.with-active-tasks', {
          toolAllowlist: ['project.get'],
        }),
        hostContext,
      );
      const childCatalog = CapabilityCatalogSnapshotV1Schema.parse(
        JSON.parse(
          (
            fixture.database
              .prepare('SELECT catalog_v1_json FROM capability_catalog_snapshots WHERE run_id = ?')
              .get(child.child.childRunId) as { catalog_v1_json: string }
          ).catalog_v1_json,
        ),
      );
      expect(childCatalog).toMatchObject({
        parentCatalogHash: rootCatalog.catalogHash,
        tools: [{ id: 'project.get' }],
      });
      expect(
        fixture.data.conversations.archiveChat(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.chat.archive.with-active-tasks',
            method: 'chat.archive',
            input: {
              chatId: fixture.chat.id,
              expectedRevision: fixture.data.conversations.getChat(fixture.chat.id).revision,
            },
          },
          context,
        ).result.lifecycle,
      ).toBe('archived');
      expect(fixture.data.taskLists.get(fixture.run.id)?.state).toBe('active');
    } finally {
      fixture.store.close();
    }
  }, 10_000);

  it('persists each Compaction stage atomically, computes the view hash, and replays exactly', async () => {
    const fixture = await harness();
    try {
      const ready = startRunningActivation(fixture, 'command.compaction');
      const startInput = {
        runId: ready.id,
        expectedRevision: ready.revision,
        expectedRunHash: ready.contentHash,
        transactionId: 'compaction.tx.1',
        activationNumber: 1,
        sourceEventFrom: 1,
        sourceEventTo: 2,
        originalTokenCount: 12_000,
        model: ready.model.model,
      };
      const started = fixture.data.compactions.start(startInput, hostContext);
      expect(started.event).toMatchObject({
        visibility: 'model_surface',
        runId: ready.id,
        sequence: 3,
        payloadState: {
          state: 'available',
          payload: { type: 'compaction_started', transactionId: startInput.transactionId },
        },
      });
      expect(started).toMatchObject({
        transaction: { id: startInput.transactionId, state: 'started' },
        view: null,
      });
      expect(fixture.data.compactions.start(startInput, hostContext)).toEqual(started);
      expect(() =>
        fixture.data.compactions.start({ ...startInput, model: 'different-model' }, hostContext),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(() =>
        fixture.data.compactions.start(
          { ...startInput, expectedRevision: startInput.expectedRevision + 1 },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(() =>
        fixture.data.compactions.start(
          { ...startInput, expectedRunHash: 'f'.repeat(64) },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(() =>
        fixture.data.compactions.start(startInput, {
          ...hostContext,
          correlationId: 'correlation.compaction.changed',
        }),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));

      const afterStart = currentRun(fixture, ready.id, 'after-compaction-start');
      const deriveInput = {
        runId: ready.id,
        expectedRevision: afterStart.revision,
        expectedRunHash: afterStart.contentHash,
        transactionId: startInput.transactionId,
        viewId: 'compaction.view.1',
        sourceEventFrom: 1,
        sourceEventTo: 2,
        summary: 'Keep the current task and the active production context.',
        citedEventSequences: [1, 2],
        compactedTokenCount: 320,
      };
      const derived = fixture.data.compactions.deriveView(deriveInput, hostContext);
      const expectedViewHash = hashCanonical({
        runId: ready.id,
        transactionId: startInput.transactionId,
        sourceEventFrom: 1,
        sourceEventTo: 2,
        summary: deriveInput.summary,
        citedEventSequences: deriveInput.citedEventSequences,
        compactedTokenCount: deriveInput.compactedTokenCount,
      });
      expect(derived.event).toMatchObject({
        visibility: 'model_surface',
        sequence: 4,
        payloadState: {
          state: 'available',
          payload: {
            type: 'compaction_view_derived',
            viewId: deriveInput.viewId,
            derivedViewHash: expectedViewHash,
          },
        },
      });
      expect(derived).toMatchObject({
        transaction: { id: startInput.transactionId, state: 'view_derived' },
        view: { id: deriveInput.viewId, derivedViewHash: expectedViewHash },
      });
      expect(fixture.data.compactions.deriveView(deriveInput, hostContext)).toEqual(derived);

      const afterDerived = currentRun(fixture, ready.id, 'after-compaction-view');
      const completeInput = {
        runId: ready.id,
        expectedRevision: afterDerived.revision,
        expectedRunHash: afterDerived.contentHash,
        transactionId: startInput.transactionId,
        viewId: deriveInput.viewId,
        derivedViewHash: expectedViewHash,
      };
      const beforeInvalidCompletion = compactionState(fixture, ready.id);
      expect(() =>
        fixture.data.compactions.complete(
          { ...completeInput, viewId: 'compaction.view.wrong' },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.data.compactions.complete(
          { ...completeInput, derivedViewHash: 'f'.repeat(64) },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(compactionState(fixture, ready.id)).toEqual(beforeInvalidCompletion);
      const completed = fixture.data.compactions.complete(completeInput, hostContext);
      expect(completed.event).toMatchObject({
        visibility: 'model_surface',
        sequence: 5,
        payloadState: {
          state: 'available',
          payload: { type: 'compaction_completed', derivedViewHash: expectedViewHash },
        },
      });
      expect(completed).toMatchObject({ transaction: { state: 'completed' } });
      expect(fixture.data.compactions.complete(completeInput, hostContext)).toEqual(completed);
      const replayedStart = fixture.data.compactions.start(startInput, hostContext);
      expect(replayedStart.event).toEqual(started.event);
      expect(replayedStart.transaction.state).toBe('completed');

      manageTasks(
        fixture,
        ready.id,
        TaskManageDefinition.parseInput({
          action: 'create',
          expectedRunRevision: 5,
          title: 'Replay-visible work',
          tasks: [],
          publicSummary: 'Created replay-visible work.',
        }),
        'command.compaction.tasks',
      );
      const replay = fixture.data.runReplay.get(ready.id);
      expect(replay).toMatchObject({
        run: { id: ready.id, revision: 6 },
        manifest: { id: ready.contextManifestId },
        catalog: { catalogHash: ready.capabilityCatalogHash },
        inbox: [{ runId: ready.id }],
        activations: [{ activationNumber: 1, state: 'active' }],
        taskList: { title: 'Replay-visible work' },
        compactionTransactions: [{ id: startInput.transactionId, state: 'completed' }],
        compactionViews: [{ id: deriveInput.viewId, derivedViewHash: expectedViewHash }],
        providerContinuation: PROVIDER_CONTINUATION_UNAVAILABLE,
      });
      expect(replay.journal.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(canonicalJson(replay)).not.toContain('fake-token');

      fixture.store.close();
      const reopened = await openStore(fixture.databasePath);
      try {
        expect(dataAccess(reopened, deterministicIds()).runReplay.get(ready.id)).toEqual(replay);
      } finally {
        reopened.close();
      }
    } finally {
      fixture.store.close();
    }
  }, 15_000);

  it('rejects invalid Compaction ranges and citations and rolls every failed stage back', async () => {
    const fixture = await harness();
    try {
      expect(() =>
        fixture.data.compactions.start(
          {
            runId: fixture.run.id,
            expectedRevision: 0,
            expectedRunHash: fixture.run.contentHash,
            transactionId: 'compaction.tx.accepted',
            activationNumber: 1,
            sourceEventFrom: 1,
            sourceEventTo: 1,
            originalTokenCount: 10,
            model: fixture.run.model.model,
          },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      const ready = startRunningActivation(fixture, 'command.compaction.invalid');
      const startInput = {
        runId: ready.id,
        expectedRevision: ready.revision,
        expectedRunHash: ready.contentHash,
        transactionId: 'compaction.tx.invalid',
        activationNumber: 1,
        sourceEventFrom: 1,
        sourceEventTo: 2,
        originalTokenCount: 2_000,
        model: ready.model.model,
      };
      expect(() =>
        fixture.data.compactions.start(
          { ...startInput, activationNumber: 2, transactionId: 'compaction.tx.bad-activation' },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(() =>
        fixture.data.compactions.start(
          { ...startInput, sourceEventTo: 20, transactionId: 'compaction.tx.bad-range' },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      fixture.data.compactions.start(startInput, hostContext);

      const afterStart = currentRun(fixture, ready.id, 'after-invalid-compaction-start');
      const deriveInput = {
        runId: ready.id,
        expectedRevision: afterStart.revision,
        expectedRunHash: afterStart.contentHash,
        transactionId: startInput.transactionId,
        viewId: 'compaction.view.invalid',
        sourceEventFrom: 1,
        sourceEventTo: 2,
        summary: 'A valid compacted view.',
        citedEventSequences: [1, 2],
        compactedTokenCount: 100,
      };
      const beforeInvalidStages = compactionState(fixture, ready.id);
      expect(() =>
        fixture.data.compactions.deriveView({ ...deriveInput, sourceEventFrom: 2 }, hostContext),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.data.compactions.deriveView(
          { ...deriveInput, citedEventSequences: [2, 1] },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.data.compactions.deriveView(
          { ...deriveInput, citedEventSequences: [1, 1] },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.data.compactions.deriveView(
          { ...deriveInput, citedEventSequences: [1, 3] },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.data.compactions.complete(
          {
            runId: ready.id,
            expectedRevision: afterStart.revision,
            expectedRunHash: afterStart.contentHash,
            transactionId: startInput.transactionId,
            viewId: deriveInput.viewId,
            derivedViewHash: 'a'.repeat(64),
          },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(compactionState(fixture, ready.id)).toEqual(beforeInvalidStages);

      const before = {
        run: currentRun(fixture, ready.id, 'before-compaction-fault'),
        events: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM run_events WHERE run_id = ?')
          .get(ready.id),
      };
      fixture.database.exec(`
        CREATE TEMP TRIGGER fail_compaction_run
        BEFORE UPDATE ON runs
        BEGIN
          SELECT RAISE(ABORT, 'injected compaction failure');
        END;
      `);
      expect(() => fixture.data.compactions.deriveView(deriveInput, hostContext)).toThrow(
        'injected compaction failure',
      );
      fixture.database.exec('DROP TRIGGER fail_compaction_run');
      expect(currentRun(fixture, ready.id, 'after-compaction-fault')).toEqual(before.run);
      expect(
        fixture.database
          .prepare('SELECT COUNT(*) AS count FROM run_events WHERE run_id = ?')
          .get(ready.id),
      ).toEqual(before.events);
      expect(
        fixture.database
          .prepare('SELECT COUNT(*) AS count FROM compaction_views WHERE run_id = ?')
          .get(ready.id),
      ).toEqual({ count: 0 });

      const interrupted = fixture.data.compactions.interruptAfterRestart(
        {
          runId: ready.id,
          expectedRevision: afterStart.revision,
          expectedRunHash: afterStart.contentHash,
          transactionId: startInput.transactionId,
        },
        hostContext,
      );
      expect(interrupted).toMatchObject({
        event: {
          payloadState: {
            state: 'available',
            payload: { type: 'compaction_interrupted', reason: 'process_restarted' },
          },
        },
        transaction: { state: 'interrupted', interruptionReason: 'process_restarted' },
      });
      expect(
        fixture.data.compactions.interruptAfterRestart(
          {
            runId: ready.id,
            expectedRevision: afterStart.revision,
            expectedRunHash: afterStart.contentHash,
            transactionId: startInput.transactionId,
          },
          hostContext,
        ),
      ).toEqual(interrupted);
      const afterInterrupt = currentRun(fixture, ready.id, 'after-compaction-interrupt');
      expect(() =>
        fixture.data.compactions.deriveView(
          {
            ...deriveInput,
            expectedRevision: afterInterrupt.revision,
            expectedRunHash: afterInterrupt.contentHash,
          },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      fixture.store.close();
    }
  }, 15_000);

  it('interrupts a derived Compaction view without discarding its immutable projection', async () => {
    const fixture = await harness();
    try {
      const ready = startRunningActivation(fixture, 'command.compaction.derived-interrupt');
      const transactionId = 'compaction.tx.derived-interrupt';
      fixture.data.compactions.start(
        {
          runId: ready.id,
          expectedRevision: ready.revision,
          expectedRunHash: ready.contentHash,
          transactionId,
          activationNumber: 1,
          sourceEventFrom: 1,
          sourceEventTo: 2,
          originalTokenCount: 2_000,
          model: ready.model.model,
        },
        hostContext,
      );
      const afterStart = currentRun(fixture, ready.id, 'derived-interrupt-started');
      const derived = fixture.data.compactions.deriveView(
        {
          runId: ready.id,
          expectedRevision: afterStart.revision,
          expectedRunHash: afterStart.contentHash,
          transactionId,
          viewId: 'compaction.view.derived-interrupt',
          sourceEventFrom: 1,
          sourceEventTo: 2,
          summary: 'A retained interrupted view.',
          citedEventSequences: [1, 2],
          compactedTokenCount: 80,
        },
        hostContext,
      );
      const afterView = currentRun(fixture, ready.id, 'derived-interrupt-view');
      const interrupted = fixture.data.compactions.interruptAfterRestart(
        {
          runId: ready.id,
          expectedRevision: afterView.revision,
          expectedRunHash: afterView.contentHash,
          transactionId,
        },
        hostContext,
      );
      expect(interrupted).toMatchObject({
        transaction: {
          state: 'interrupted',
          compactedTokenCount: 80,
          finishedAt: interrupted.event.occurredAt,
        },
        view: derived.view,
      });
      expect(fixture.data.runReplay.get(ready.id).compactionViews).toEqual([derived.view]);
    } finally {
      fixture.store.close();
    }
  }, 10_000);

  it('rejects corrupted Compaction row ownership, fields, and Journal timestamps', async () => {
    const fixture = await harness();
    try {
      const ready = startRunningActivation(fixture, 'command.compaction.corruption');
      const transactionId = 'compaction.tx.corruption';
      const started = fixture.data.compactions.start(
        {
          runId: ready.id,
          expectedRevision: ready.revision,
          expectedRunHash: ready.contentHash,
          transactionId,
          activationNumber: 1,
          sourceEventFrom: 1,
          sourceEventTo: 2,
          originalTokenCount: 2_000,
          model: ready.model.model,
        },
        hostContext,
      );
      const expectCorruptReplay = () =>
        expect(() => fixture.data.runReplay.get(ready.id)).toThrowError(
          expect.objectContaining({ code: 'CORRUPT_DATA' }),
        );

      fixture.database
        .prepare('UPDATE compaction_transactions SET compacted_token_count = 1 WHERE id = ?')
        .run(transactionId);
      expectCorruptReplay();
      fixture.database
        .prepare('UPDATE compaction_transactions SET compacted_token_count = NULL WHERE id = ?')
        .run(transactionId);
      fixture.database
        .prepare('UPDATE compaction_transactions SET started_at = ? WHERE id = ?')
        .run('2026-08-15T12:00:01.000Z', transactionId);
      expectCorruptReplay();
      fixture.database
        .prepare('UPDATE compaction_transactions SET started_at = ? WHERE id = ?')
        .run(started.event.occurredAt, transactionId);

      const afterStart = currentRun(fixture, ready.id, 'corruption-started');
      const derived = fixture.data.compactions.deriveView(
        {
          runId: ready.id,
          expectedRevision: afterStart.revision,
          expectedRunHash: afterStart.contentHash,
          transactionId,
          viewId: 'compaction.view.corruption',
          sourceEventFrom: 1,
          sourceEventTo: 2,
          summary: 'Canonical compacted view.',
          citedEventSequences: [1, 2],
          compactedTokenCount: 90,
        },
        hostContext,
      );
      fixture.database
        .prepare('UPDATE compaction_views SET created_at = ? WHERE id = ?')
        .run('2026-08-15T12:00:01.000Z', derived.view!.id);
      expectCorruptReplay();
      fixture.database
        .prepare('UPDATE compaction_views SET created_at = ? WHERE id = ?')
        .run(derived.event.occurredAt, derived.view!.id);
      fixture.database
        .prepare('UPDATE compaction_views SET summary = ? WHERE id = ?')
        .run('Tampered summary.', derived.view!.id);
      expectCorruptReplay();
      fixture.database
        .prepare('UPDATE compaction_views SET summary = ? WHERE id = ?')
        .run(derived.view!.summary, derived.view!.id);

      const afterView = currentRun(fixture, ready.id, 'corruption-view');
      const completed = fixture.data.compactions.complete(
        {
          runId: ready.id,
          expectedRevision: afterView.revision,
          expectedRunHash: afterView.contentHash,
          transactionId,
          viewId: derived.view!.id,
          derivedViewHash: derived.view!.derivedViewHash,
        },
        hostContext,
      );
      fixture.database
        .prepare('UPDATE compaction_transactions SET finished_at = ? WHERE id = ?')
        .run('2026-08-15T12:00:01.000Z', transactionId);
      expectCorruptReplay();
      fixture.database
        .prepare('UPDATE compaction_transactions SET finished_at = ? WHERE id = ?')
        .run(completed.event.occurredAt, transactionId);

      const child = fixture.data.runs.spawnChild(
        spawnChildInput(
          currentRun(fixture, ready.id, 'corruption-parent'),
          [],
          'operation.spawn.compaction-corruption',
        ),
        hostContext,
      );
      fixture.database
        .prepare('UPDATE compaction_views SET run_id = ? WHERE id = ?')
        .run(child.child.childRunId, derived.view!.id);
      expectCorruptReplay();
      fixture.database
        .prepare('UPDATE compaction_views SET run_id = ? WHERE id = ?')
        .run(ready.id, derived.view!.id);

      const activationId = (
        fixture.database
          .prepare('SELECT activation_id FROM compaction_transactions WHERE id = ?')
          .get(transactionId) as { activation_id: string }
      ).activation_id;
      fixture.database
        .prepare('UPDATE run_activations SET run_id = ? WHERE id = ?')
        .run(child.child.childRunId, activationId);
      expectCorruptReplay();
      fixture.database
        .prepare('UPDATE run_activations SET run_id = ? WHERE id = ?')
        .run(ready.id, activationId);
      expect(fixture.data.runReplay.get(ready.id).compactionTransactions).toHaveLength(1);
    } finally {
      fixture.store.close();
    }
  }, 15_000);

  it('orders only running or recovering replay candidates parent before child', async () => {
    const fixture = await harness();
    try {
      makeRunning(fixture);
      const first = fixture.data.runs.spawnChild(
        spawnChildInput(currentRun(fixture), [], 'operation.spawn.replay-first'),
        hostContext,
      );
      const firstRun = currentRun(fixture, first.child.childRunId, 'replay-first');
      makeRunning(fixture, firstRun);
      const grandchild = fixture.data.runs.spawnChild(
        spawnChildInput(
          currentRun(fixture, firstRun.id, 'replay-first-current'),
          [],
          'operation.spawn.replay-grandchild',
        ),
        hostContext,
      );
      setRunStatus(
        fixture,
        currentRun(fixture, grandchild.child.childRunId, 'replay-grandchild'),
        'recovering',
      );
      const accepted = fixture.data.runs.spawnChild(
        spawnChildInput(
          currentRun(fixture, fixture.run.id, 'replay-root-current'),
          [],
          'operation.spawn.replay-accepted',
        ),
        hostContext,
      );
      const paused = fixture.data.runs.spawnChild(
        spawnChildInput(
          currentRun(fixture, fixture.run.id, 'replay-root-paused'),
          [],
          'operation.spawn.replay-paused',
        ),
        hostContext,
      );
      setRunStatus(
        fixture,
        currentRun(fixture, paused.child.childRunId, 'replay-paused'),
        'paused',
      );
      const waiting = fixture.data.runs.spawnChild(
        spawnChildInput(
          currentRun(fixture, fixture.run.id, 'replay-root-waiting'),
          [],
          'operation.spawn.replay-waiting',
        ),
        hostContext,
      );
      setRunStatus(
        fixture,
        currentRun(fixture, waiting.child.childRunId, 'replay-waiting'),
        'waiting_question',
      );
      const terminal = fixture.data.runs.spawnChild(
        spawnChildInput(
          currentRun(fixture, fixture.run.id, 'replay-root-terminal'),
          [],
          'operation.spawn.replay-terminal',
        ),
        hostContext,
      );
      fixture.data.runs.terminalize(
        {
          runId: terminal.child.childRunId,
          expectedRevision: terminal.child.revision,
          status: 'cancelled',
          summary: 'Terminal recovery candidate exclusion.',
          resultIds: [],
          commandId: 'command.replay-terminal',
        },
        hostContext,
      );

      const candidates = fixture.data.runReplay.listRecoveryCandidates(fixture.project.id);
      expect(candidates.map(({ id }) => id)).toEqual([
        fixture.run.id,
        firstRun.id,
        grandchild.child.childRunId,
      ]);
      expect(candidates.some(({ id }) => id === accepted.child.childRunId)).toBe(false);
      expect(
        candidates.some(({ id }) =>
          [paused.child.childRunId, waiting.child.childRunId, terminal.child.childRunId].includes(
            id,
          ),
        ),
      ).toBe(false);
      expect(
        candidates.every(({ status }) => status === 'running' || status === 'recovering'),
      ).toBe(true);
    } finally {
      fixture.store.close();
    }
  }, 15_000);

  it('delegates one child atomically after the public parent event and freezes exact lineage', async () => {
    const fixture = await harness(true);
    try {
      fixture.database.exec(`
        CREATE TEMP TRIGGER require_parent_event_before_child
        BEFORE INSERT ON runs
        WHEN NEW.parent_run_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM run_events WHERE id = NEW.objective_parent_event_id
          )
        BEGIN
          SELECT RAISE(ABORT, 'parent delegation event must exist first');
        END;
      `);
      const parentManifest = ContextManifestSchema.parse(
        JSON.parse(
          (
            fixture.database
              .prepare('SELECT manifest_v1_json FROM context_manifests WHERE run_id = ?')
              .get(fixture.run.id) as { manifest_v1_json: string }
          ).manifest_v1_json,
        ),
      );
      const input = spawnChildInput(fixture.run, parentManifest.selectedContext);
      const before = delegationCounts(fixture.database);
      const result = fixture.data.runs.spawnChild(input, hostContext);
      const parent = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.parent.after-spawn',
        method: 'run.get',
        input: { runId: fixture.run.id },
      }).result;
      const child = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.child.after-spawn',
        method: 'run.get',
        input: { runId: result.child.childRunId },
      }).result;
      const [event] = fixture.data.runs.listPublicEvents({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.parent.events.after-spawn',
        method: 'run.events.list',
        input: { runId: parent.id, afterSequence: null, page: { cursor: null, limit: 10 } },
      }).result.items;
      const manifest = ContextManifestSchema.parse(
        JSON.parse(
          (
            fixture.database
              .prepare('SELECT manifest_v1_json FROM context_manifests WHERE run_id = ?')
              .get(child.id) as { manifest_v1_json: string }
          ).manifest_v1_json,
        ),
      );
      const catalog = CapabilityCatalogSnapshotV1Schema.parse(
        JSON.parse(
          (
            fixture.database
              .prepare('SELECT catalog_v1_json FROM capability_catalog_snapshots WHERE run_id = ?')
              .get(child.id) as { catalog_v1_json: string }
          ).catalog_v1_json,
        ),
      );
      const inbox = fixture.data.runs.listInbox(child.id);
      const directionHash = hashUtf8(input.spawnInput.objective);
      const recoveryEnvelope = fixture.database
        .prepare('SELECT * FROM private_recovery_envelopes WHERE run_id = ?')
        .get(child.id) as {
        ciphertext: Uint8Array;
        nonce: Uint8Array;
        authentication_tag: Uint8Array;
        ciphertext_hash: string;
        aad_hash: string;
        envelope_hash: string;
        byte_length: number;
      };

      expect(() => AgentSpawnDefinition.parseSuccess(result)).not.toThrow();
      expect(parent).toMatchObject({
        revision: 1,
        parentRunId: null,
        retryOfRunId: null,
        retrySeedHash: null,
      });
      expect(child).toMatchObject({
        revision: 1,
        rootRunId: fixture.run.id,
        parentRunId: fixture.run.id,
        retryOfRunId: null,
        retrySeedHash: null,
        projectId: fixture.project.id,
        chatId: fixture.chat.id,
        acceptedSource: {
          kind: 'parent_direction',
          parentRunId: fixture.run.id,
          parentEventId: event?.eventId,
          directionHash,
        },
        displayName: input.spawnInput.displayName,
        publicSummary: input.spawnInput.publicSummary,
        publicEventHead: null,
        privateRecoveryHead: { sequence: 1, hash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      });
      expect(event?.payloadState).toMatchObject({
        state: 'available',
        payload: {
          type: 'child_run_delegated',
          childRunId: child.id,
          displayName: input.spawnInput.displayName,
          publicSummary: input.spawnInput.publicSummary,
          directionHash,
          operationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
      expect(manifest.projectSettings).toEqual(parentManifest.projectSettings);
      expect(manifest).toMatchObject({
        retryOfRunId: null,
        retrySeedHash: null,
        acceptedSource: child.acceptedSource,
        locale: parentManifest.locale,
        timeZone: parentManifest.timeZone,
        selectedContext: input.spawnInput.contextRefs,
        projectMedia: parentManifest.projectMedia,
        attachments: parentManifest.attachments,
        historyWatermark: parentManifest.historyWatermark,
        memory: parentManifest.memory,
        model: parentManifest.model,
      });
      expect(() => assertRunContextManifest(child, manifest, catalog)).not.toThrow();
      expect(() => assertCapabilityCatalogLineage(rootCatalog, catalog)).not.toThrow();
      expect(inbox).toEqual([
        expect.objectContaining({
          runId: child.id,
          sequence: 1,
          actor: 'commander',
          source: child.acceptedSource,
          selectedContext: input.spawnInput.contextRefs,
          contentHash: directionHash,
          state: 'queued',
        }),
      ]);
      expect(result).toMatchObject({
        child: {
          childRunId: child.id,
          revision: 1,
          contentHash: child.contentHash,
          state: 'accepted',
          objectiveHash: directionHash,
        },
        manifestHash: child.contextManifestHash,
        capabilityCatalogHash: child.capabilityCatalogHash,
      });
      expect(recoveryEnvelope).toMatchObject({
        ciphertext_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        aad_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        envelope_hash: child.privateRecoveryHead?.hash,
        byte_length: recoveryEnvelope.ciphertext.byteLength,
      });
      expect(recoveryEnvelope.nonce).toHaveLength(12);
      expect(recoveryEnvelope.authentication_tag).toHaveLength(16);
      expect(
        Buffer.from(recoveryEnvelope.ciphertext).includes(Buffer.from(input.spawnInput.objective)),
      ).toBe(false);
      expect(
        fixture.database
          .prepare('SELECT COUNT(*) AS count FROM run_events WHERE run_id = ?')
          .get(child.id),
      ).toEqual({ count: 0 });
      expect(
        fixture.database
          .prepare('SELECT COUNT(*) AS count FROM run_activations WHERE run_id = ?')
          .get(child.id),
      ).toEqual({ count: 0 });
      expect(
        fixture.database
          .prepare('SELECT COUNT(*) AS count FROM task_lists WHERE run_id = ?')
          .get(child.id),
      ).toEqual({ count: 0 });
      expect(delegationCounts(fixture.database)).toEqual({
        ...before,
        runs: before.runs + 1,
        context_manifests: before.context_manifests + 1,
        capability_catalog_snapshots: before.capability_catalog_snapshots + 1,
        run_inbox_messages: before.run_inbox_messages + 1,
        run_events: before.run_events + 1,
        private_recovery_envelopes: before.private_recovery_envelopes + 1,
      });

      const persisted = [
        fixture.database.prepare('SELECT * FROM runs WHERE id = ?').get(child.id),
        fixture.database.prepare('SELECT * FROM context_manifests WHERE run_id = ?').get(child.id),
        fixture.database
          .prepare('SELECT * FROM capability_catalog_snapshots WHERE run_id = ?')
          .get(child.id),
        fixture.database.prepare('SELECT * FROM run_inbox_messages WHERE run_id = ?').get(child.id),
        fixture.database
          .prepare('SELECT * FROM private_recovery_envelopes WHERE run_id = ?')
          .get(child.id),
        fixture.database
          .prepare(
            `SELECT event.*, payload.payload_v1_json
             FROM run_events AS event
             JOIN run_event_payloads AS payload ON payload.run_event_id = event.id
             WHERE event.run_id = ?`,
          )
          .get(parent.id),
      ];
      expect(JSON.stringify(result)).not.toContain(input.spawnInput.objective);
      expect(JSON.stringify(persisted)).not.toContain(input.spawnInput.objective);
      expect(serializedDatabaseRows(fixture.database)).not.toContain(input.spawnInput.objective);
    } finally {
      fixture.store.close();
    }
  });

  it('replays by operation fingerprint before stale CAS and rejects semantic or persisted mismatch', async () => {
    const fixture = await harness(true);
    try {
      const manifest = ContextManifestSchema.parse(
        JSON.parse(
          (
            fixture.database
              .prepare('SELECT manifest_v1_json FROM context_manifests WHERE run_id = ?')
              .get(fixture.run.id) as { manifest_v1_json: string }
          ).manifest_v1_json,
        ),
      );
      const input = spawnChildInput(fixture.run, manifest.selectedContext);
      const stale = {
        ...spawnChildInput(fixture.run, manifest.selectedContext, 'operation.spawn.stale', {
          expectedParentRevision: fixture.run.revision + 1,
        }),
        expectedParentRevision: fixture.run.revision + 1,
      };
      const baseline = delegationCounts(fixture.database);
      expect(() => fixture.data.runs.spawnChild(stale, hostContext)).toThrowError(
        expect.objectContaining({ code: 'REVISION_CONFLICT' }),
      );
      expect(delegationCounts(fixture.database)).toEqual(baseline);

      const first = fixture.data.runs.spawnChild(input, hostContext);
      const afterFirst = delegationCounts(fixture.database);
      expect(fixture.data.runs.spawnChild(input, hostContext)).toEqual(first);
      expect(delegationCounts(fixture.database)).toEqual(afterFirst);
      const changedRevision = input.expectedParentRevision + 1;
      expect(() =>
        fixture.data.runs.spawnChild(
          {
            ...input,
            expectedParentRevision: changedRevision,
            spawnInput: {
              ...input.spawnInput,
              expectedParentRevision: changedRevision,
            },
          },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(delegationCounts(fixture.database)).toEqual(afterFirst);
      expect(() =>
        fixture.data.runs.spawnChild(
          {
            ...input,
            spawnInput: {
              ...input.spawnInput,
              publicSummary: 'A different public delegation summary.',
            },
          },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(delegationCounts(fixture.database)).toEqual(afterFirst);
      expect(() =>
        fixture.data.runs.spawnChild(input, {
          ...hostContext,
          correlationId: 'correlation.changed',
        }),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(delegationCounts(fixture.database)).toEqual(afterFirst);

      fixture.database
        .prepare(
          `UPDATE run_inbox_messages
           SET selected_context_v1_json = '[]'
           WHERE run_id = ?`,
        )
        .run(first.child.childRunId);
      expect(() => fixture.data.runs.spawnChild(input, hostContext)).toThrowError(
        expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
      );
      expect(() =>
        fixture.data.runs.spawnChild(
          {
            ...spawnChildInput(fixture.run, manifest.selectedContext, 'operation.spawn.split-cas'),
            expectedParentRevision: 1,
          },
          hostContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      fixture.store.close();
    }
  }, 10_000);

  it('materializes the encrypted objective with the matching key and fails closed for key or envelope corruption', async () => {
    const fixture = await harness(true);
    try {
      const manifest = ContextManifestSchema.parse(
        JSON.parse(
          (
            fixture.database
              .prepare('SELECT manifest_v1_json FROM context_manifests WHERE run_id = ?')
              .get(fixture.run.id) as { manifest_v1_json: string }
          ).manifest_v1_json,
        ),
      );
      const input = spawnChildInput(
        fixture.run,
        manifest.selectedContext,
        'operation.spawn.private-recovery',
      );
      const spawned = fixture.data.runs.spawnChild(input, hostContext);
      const childRunId = spawned.child.childRunId;
      expect(fixture.data.harness.materializePrivateModelContext(childRunId)).toEqual({
        parentDirections: [
          expect.objectContaining({
            inboxMessageId: fixture.data.runs.listInbox(childRunId)[0]!.id,
            parentRunId: fixture.run.id,
            directionHash: hashUtf8(input.spawnInput.objective),
            objective: input.spawnInput.objective,
          }),
        ],
        spawnObjectives: [],
      });

      const beforeFailedReads = serializedDatabaseRows(fixture.database);
      const missingKeyData = createDataAccess(fixture.store, {
        now: () => NOW,
        createId: deterministicIds(),
        privateRecoveryCodec: createAes256GcmPrivateRecoveryCodec({
          encryptionKeyId: 'key.runs.unavailable',
          encryptionKey: new Uint8Array(32).fill(0x42),
        }),
        mediaCas: unusedMediaCas,
        mediaImportCapabilities: unusedMediaImportCapabilities,
      });
      expect(() => missingKeyData.harness.materializePrivateModelContext(childRunId)).toThrowError(
        expect.objectContaining({ code: 'SECURITY_CONFIGURATION_FAILED' }),
      );
      const wrongKeyData = createDataAccess(fixture.store, {
        now: () => NOW,
        createId: deterministicIds(),
        privateRecoveryCodec: createAes256GcmPrivateRecoveryCodec({
          encryptionKeyId: 'key.runs.private-recovery',
          encryptionKey: new Uint8Array(32).fill(0x43),
        }),
        mediaCas: unusedMediaCas,
        mediaImportCapabilities: unusedMediaImportCapabilities,
      });
      expect(() => wrongKeyData.harness.materializePrivateModelContext(childRunId)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
      expect(serializedDatabaseRows(fixture.database)).toBe(beforeFailedReads);

      const row = fixture.database
        .prepare('SELECT ciphertext FROM private_recovery_envelopes WHERE run_id = ?')
        .get(childRunId) as { ciphertext: Uint8Array };
      fixture.database
        .prepare('UPDATE private_recovery_envelopes SET ciphertext = ? WHERE run_id = ?')
        .run(Buffer.alloc(row.ciphertext.byteLength, 0x7f), childRunId);
      const afterTamper = serializedDatabaseRows(fixture.database);
      let errorMessage = '';
      try {
        fixture.data.harness.materializePrivateModelContext(childRunId);
      } catch (error) {
        expect(error).toMatchObject({ code: 'CORRUPT_DATA' });
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      expect(errorMessage).not.toContain(input.spawnInput.objective);
      expect(serializedDatabaseRows(fixture.database)).toBe(afterTamper);
    } finally {
      fixture.store.close();
    }
  });

  it('enforces exact parent context and equal-or-narrower policy, budget, and frozen tools', async () => {
    const fixture = await harness(true);
    try {
      const parentManifest = ContextManifestSchema.parse(
        JSON.parse(
          (
            fixture.database
              .prepare('SELECT manifest_v1_json FROM context_manifests WHERE run_id = ?')
              .get(fixture.run.id) as { manifest_v1_json: string }
          ).manifest_v1_json,
        ),
      );
      const selected = parentManifest.selectedContext[0]!;
      const otherProject = fixture.data.projects.create(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.project.other',
          method: 'project.create',
          input: { name: 'Other', permissionMode: 'reversible', budget, formatPolicy },
        },
        context,
      ).result.project;
      const invalidContexts = [
        [{ ...selected, role: 'reference' as const }],
        [{ ...selected, ref: { ...selected.ref, revision: selected.ref.revision + 1 } }],
        [
          {
            ref: {
              authority: 'project' as const,
              id: otherProject.id,
              revision: otherProject.revision,
              contentHash: otherProject.contentHash,
            },
            role: 'target' as const,
          },
        ],
      ];
      const baseline = delegationCounts(fixture.database);
      for (const [index, contextRefs] of invalidContexts.entries()) {
        expect(() =>
          fixture.data.runs.spawnChild(
            spawnChildInput(fixture.run, contextRefs, `operation.spawn.invalid-context.${index}`),
            hostContext,
          ),
        ).toThrow();
        expect(delegationCounts(fixture.database)).toEqual(baseline);
      }

      const narrowedBudget = {
        costUsd: { state: 'known' as const, value: '10', currency: 'USD' },
        maxGenerationCount: 6,
        maxInputTokens: 50_000,
        maxOutputTokens: 10_000,
      };
      const legal = fixture.data.runs.spawnChild(
        spawnChildInput(fixture.run, parentManifest.selectedContext, 'operation.spawn.narrowed', {
          toolAllowlist: ['project.get'],
          permissionCeiling: 'read_only',
          budgetCaps: narrowedBudget,
        }),
        hostContext,
      );
      const child = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.narrowed-child.get',
        method: 'run.get',
        input: { runId: legal.child.childRunId },
      }).result;
      const childManifest = ContextManifestSchema.parse(
        JSON.parse(
          (
            fixture.database
              .prepare('SELECT manifest_v1_json FROM context_manifests WHERE run_id = ?')
              .get(child.id) as { manifest_v1_json: string }
          ).manifest_v1_json,
        ),
      );
      const childCatalog = CapabilityCatalogSnapshotV1Schema.parse(
        JSON.parse(
          (
            fixture.database
              .prepare('SELECT catalog_v1_json FROM capability_catalog_snapshots WHERE run_id = ?')
              .get(child.id) as { catalog_v1_json: string }
          ).catalog_v1_json,
        ),
      );
      expect(child).toMatchObject({ permissionMode: 'read_only', budget: narrowedBudget });
      expect(childManifest.projectSettings).toEqual(parentManifest.projectSettings);
      expect(childCatalog).toMatchObject({
        parentCatalogHash: rootCatalog.catalogHash,
        tools: [{ id: 'project.get' }],
        skills: rootCatalog.skills,
      });

      const afterLegal = delegationCounts(fixture.database);
      const budgetExpansions = [
        { ...narrowedBudget, maxGenerationCount: narrowedBudget.maxGenerationCount + 1 },
        { ...narrowedBudget, maxInputTokens: narrowedBudget.maxInputTokens + 1 },
        { ...narrowedBudget, maxOutputTokens: narrowedBudget.maxOutputTokens + 1 },
        {
          ...narrowedBudget,
          costUsd: { state: 'known' as const, value: '10.1', currency: 'USD' },
        },
        { ...narrowedBudget, costUsd: { state: 'unknown' as const, currency: 'USD' } },
        {
          ...narrowedBudget,
          costUsd: { state: 'known' as const, value: '9', currency: 'EUR' },
        },
      ];
      for (const [index, budgetCaps] of budgetExpansions.entries()) {
        expect(() =>
          fixture.data.runs.spawnChild(
            spawnChildInput(
              child,
              childManifest.selectedContext,
              `operation.spawn.budget.${index}`,
              {
                toolAllowlist: ['project.get'],
                permissionCeiling: 'read_only',
                budgetCaps,
              },
            ),
            hostContext,
          ),
        ).toThrow();
      }
      expect(() =>
        fixture.data.runs.spawnChild(
          spawnChildInput(child, childManifest.selectedContext, 'operation.spawn.permission', {
            toolAllowlist: ['project.get'],
            permissionCeiling: 'reversible',
            budgetCaps: narrowedBudget,
          }),
          hostContext,
        ),
      ).toThrow();
      expect(() =>
        fixture.data.runs.spawnChild(
          spawnChildInput(child, childManifest.selectedContext, 'operation.spawn.tools', {
            toolAllowlist: ['project.get', 'run.inspect'],
            permissionCeiling: 'read_only',
            budgetCaps: narrowedBudget,
          }),
          hostContext,
        ),
      ).toThrow();
      expect(() =>
        fixture.data.runs.spawnChild(
          spawnChildInput(child, childManifest.selectedContext, 'operation.spawn.unsorted-tools', {
            toolAllowlist: ['run.inspect', 'project.get'],
            permissionCeiling: 'read_only',
            budgetCaps: narrowedBudget,
          }),
          hostContext,
        ),
      ).toThrow();
      expect(delegationCounts(fixture.database)).toEqual(afterLegal);
    } finally {
      fixture.store.close();
    }
  });

  it('rolls back after the parent event and reopens with deterministic exact replay', async () => {
    const fixture = await harness(true);
    const parentManifest = ContextManifestSchema.parse(
      JSON.parse(
        (
          fixture.database
            .prepare('SELECT manifest_v1_json FROM context_manifests WHERE run_id = ?')
            .get(fixture.run.id) as { manifest_v1_json: string }
        ).manifest_v1_json,
      ),
    );
    const input = spawnChildInput(
      fixture.run,
      parentManifest.selectedContext,
      'operation.spawn.rollback-reopen',
    );
    const baseline = delegationCounts(fixture.database);
    fixture.database.exec(`
      CREATE TEMP TRIGGER fail_child_manifest
      BEFORE INSERT ON context_manifests
      WHEN NEW.parent_event_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'injected child manifest failure');
      END;
    `);
    expect(() => fixture.data.runs.spawnChild(input, hostContext)).toThrow(
      'injected child manifest failure',
    );
    expect(delegationCounts(fixture.database)).toEqual(baseline);
    expect(
      fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.parent.after-rollback',
        method: 'run.get',
        input: { runId: fixture.run.id },
      }).result,
    ).toEqual(fixture.run);
    fixture.database.exec('DROP TRIGGER fail_child_manifest');

    fixture.database.exec(`
      CREATE TEMP TRIGGER fail_child_recovery_envelope
      BEFORE INSERT ON private_recovery_envelopes
      BEGIN
        SELECT RAISE(ABORT, 'injected child recovery envelope failure');
      END;
    `);
    expect(() => fixture.data.runs.spawnChild(input, hostContext)).toThrow(
      'injected child recovery envelope failure',
    );
    expect(delegationCounts(fixture.database)).toEqual(baseline);
    expect(currentRun(fixture)).toEqual(fixture.run);
    fixture.database.exec('DROP TRIGGER fail_child_recovery_envelope');

    fixture.database.exec(`
      CREATE TEMP TRIGGER fail_child_private_head_cas
      BEFORE UPDATE OF revision ON runs
      WHEN OLD.parent_run_id IS NOT NULL AND OLD.revision = 0 AND NEW.revision = 1
      BEGIN
        SELECT RAISE(ABORT, 'injected child private head CAS failure');
      END;
    `);
    expect(() => fixture.data.runs.spawnChild(input, hostContext)).toThrow(
      'injected child private head CAS failure',
    );
    expect(delegationCounts(fixture.database)).toEqual(baseline);
    expect(currentRun(fixture)).toEqual(fixture.run);
    fixture.database.exec('DROP TRIGGER fail_child_private_head_cas');

    const first = fixture.data.runs.spawnChild(input, hostContext);
    const beforeReopen = delegationCounts(fixture.database);
    fixture.store.close();

    const reopened = await openStore(fixture.databasePath);
    try {
      const data = createDataAccess(reopened, {
        now: () => {
          throw new Error('exact replay must not request a new time');
        },
        createId: () => {
          throw new Error('exact replay must not request a new ID');
        },
        privateRecoveryCodec: createAes256GcmPrivateRecoveryCodec({
          encryptionKeyId: 'key.runs.private-recovery',
          encryptionKey: PRIVATE_RECOVERY_KEY,
        }),
        mediaCas: unusedMediaCas,
        mediaImportCapabilities: unusedMediaImportCapabilities,
      });
      expect(data.runs.spawnChild(input, hostContext)).toEqual(first);
      expect(delegationCounts(getStoreDatabase(reopened))).toEqual(beforeReopen);
      expect(
        data.runs.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.child.after-reopen',
          method: 'run.get',
          input: { runId: first.child.childRunId },
        }).result,
      ).toMatchObject({
        id: first.child.childRunId,
        revision: 1,
        status: 'accepted',
        privateRecoveryHead: { sequence: 1 },
      });
      expect(data.runs.listInbox(first.child.childRunId)).toHaveLength(1);
    } finally {
      reopened.close();
    }
  }, 15_000);
});
