import { rm } from 'node:fs/promises';
import { AgentSpawnDefinition, canonicalJson } from '@lucid-fin/target-contracts';
import {
  openTargetStore,
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
  budget,
  callCounts,
  createJourneyDataAccess,
  createJourneyFixture,
  formatPolicy,
  getJourneyTestDatabase,
  userContext,
} from './fixture.js';

const CREDENTIAL_SENTINEL = 'PRIVATE_CREDENTIAL_SENTINEL';
const CATALOG_SENTINEL = 'PRIVATE_TAMPERED_CATALOG_SENTINEL';
const OBJECTIVE_SENTINEL = 'PRIVATE_TAMPER_OBJECTIVE_SENTINEL';
const SNAPSHOT_TABLES = [
  'runs',
  'context_manifests',
  'capability_catalog_snapshots',
  'run_inbox_messages',
  'run_events',
  'run_event_payloads',
  'dispatch_operations',
  'run_resource_entries',
  'project_events',
  'project_event_payloads',
  'wire_command_receipts',
] as const;

function databaseSnapshot(database: ReturnType<typeof getJourneyTestDatabase>) {
  return Object.fromEntries(
    SNAPSHOT_TABLES.map((table) => [table, database.prepare(`SELECT * FROM ${table}`).all()]),
  );
}

function corruptMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toMatchObject({ code: 'CORRUPT_DATA' });
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected canonical corruption to fail closed');
}

function getRun(data: TargetDataAccess, runId: string, suffix: string) {
  return data.runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId: `request.i2h.tamper.run.${suffix}`,
    method: 'run.get',
    input: { runId },
  }).result;
}

describe('I2-H3 tamper, privacy, and reopen boundary', () => {
  it('fails closed before writes and keeps logical corruption rejected after reopen', async () => {
    const fixture = await createJourneyFixture();
    let activeStore: TargetStore = fixture.store;
    try {
      let data = fixture.data;
      let database = getJourneyTestDatabase(activeStore);
      const providerSeed = {
        id: PROVIDER_ID,
        displayName: 'I2-H Privacy Provider',
        providerKind: fixture.dependencies.generation.providerKind,
        model: PROVIDER_MODEL,
        status: 'ready' as const,
      };
      let host = createHostCatalogProvisioning(activeStore, { now: () => NOW });
      host.registerProviderProfile(providerSeed);
      const created = data.projects.create(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i2h.tamper.project',
          method: 'project.create',
          input: {
            name: 'Tamper Boundary Film',
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
          requestId: 'request.i2h.tamper.settings',
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
          requestId: 'request.i2h.tamper.chat',
          method: 'chat.create',
          input: { projectId: created.project.id, title: 'Tamper boundary' },
        },
        userContext,
      ).result;
      const accepted = data.conversations.sendMessage(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i2h.tamper.message',
          method: 'message.send',
          input: {
            chatId: chat.id,
            blocks: [{ type: 'text', text: 'Preserve canonical evidence through a restart.' }],
            attachments: [],
            selectedContext: [],
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
      const inbox = data.runs.listInbox(accepted.id)[0]!;
      data.runs.transitionInbox(
        {
          runId: accepted.id,
          expectedRevision: accepted.revision,
          inboxMessageId: inbox.id,
          sequence: inbox.sequence,
          action: 'deliver',
          commandId: 'command.i2h.tamper.deliver',
        },
        {
          actor: 'system',
          causation: { kind: 'run', runId: accepted.id },
          correlationId: 'correlation.i2h.tamper',
        },
      );
      const delivered = getRun(data, accepted.id, 'delivered');
      const spawnInput = AgentSpawnDefinition.parseInput({
        displayName: 'Tamper probe',
        objective: OBJECTIVE_SENTINEL,
        publicSummary: 'Checking canonical recovery boundaries.',
        contextRefs: [],
        toolAllowlist: null,
        permissionCeiling: null,
        budgetCaps: null,
        expectedParentRevision: delivered.revision,
      });
      const spawnRequest = {
        parentRunId: delivered.id,
        expectedParentRevision: delivered.revision,
        commandId: 'command.i2h.tamper.spawn',
        spawnInput,
      };
      const spawnContext = {
        actor: 'system' as const,
        causation: { kind: 'run' as const, runId: delivered.id },
        correlationId: 'correlation.i2h.tamper',
      };

      database
        .prepare('UPDATE provider_profiles SET credential_handle = ? WHERE id = ?')
        .run(CREDENTIAL_SENTINEL, PROVIDER_ID);
      const credentialError = corruptMessage(() => host.registerProviderProfile(providerSeed));
      const safePublicState = canonicalJson({
        project: data.projects.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i2h.tamper.project.read',
          method: 'project.get',
          input: { projectId: created.project.id },
        }).result,
        run: getRun(data, delivered.id, 'credential'),
        replay: data.runReplay.get(delivered.id),
        history: data.history.query(created.project.id, {
          sources: [],
          eventTypes: [],
          subjects: [],
          actors: [],
          time: { from: null, to: null },
          page: { cursor: null, limit: 100 },
        }),
      });
      expect(credentialError).not.toContain(CREDENTIAL_SENTINEL);
      expect(safePublicState).not.toContain(CREDENTIAL_SENTINEL);
      database
        .prepare('UPDATE provider_profiles SET credential_handle = NULL WHERE id = ?')
        .run(PROVIDER_ID);
      expect(host.registerProviderProfile(providerSeed)).toEqual(providerSeed);

      const catalogRow = database
        .prepare('SELECT catalog_v1_json FROM capability_catalog_snapshots WHERE run_id = ?')
        .get(delivered.id) as { catalog_v1_json: string };
      const catalog = JSON.parse(catalogRow.catalog_v1_json) as {
        capabilityIndex: Array<{ purpose: string }>;
      };
      catalog.capabilityIndex[0]!.purpose = CATALOG_SENTINEL;
      database
        .prepare('UPDATE capability_catalog_snapshots SET catalog_v1_json = ? WHERE run_id = ?')
        .run(canonicalJson(catalog), delivered.id);
      const catalogSnapshot = databaseSnapshot(database);
      const catalogCalls = callCounts(fixture.dependencies);
      const replayError = corruptMessage(() => data.runReplay.get(delivered.id));
      const spawnCatalogError = corruptMessage(() =>
        data.runs.spawnChild(spawnRequest, spawnContext),
      );
      expect(canonicalJson(databaseSnapshot(database))).toBe(canonicalJson(catalogSnapshot));
      expect(callCounts(fixture.dependencies)).toEqual(catalogCalls);
      expect(replayError + spawnCatalogError).not.toContain(CATALOG_SENTINEL);
      expect(replayError + spawnCatalogError).not.toContain(OBJECTIVE_SENTINEL);
      database
        .prepare('UPDATE capability_catalog_snapshots SET catalog_v1_json = ? WHERE run_id = ?')
        .run(catalogRow.catalog_v1_json, delivered.id);
      expect(data.runReplay.get(delivered.id).catalog.catalogHash).toBe(
        delivered.capabilityCatalogHash,
      );

      database
        .prepare('UPDATE run_events SET event_hash = ? WHERE run_id = ? AND sequence = 1')
        .run('f'.repeat(64), delivered.id);
      const journalSnapshot = databaseSnapshot(database);
      const journalCalls = callCounts(fixture.dependencies);
      const corruptActions = () => [
        () => getRun(data, delivered.id, 'journal'),
        () =>
          data.runs.listPublicEvents({
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.i2h.tamper.events',
            method: 'run.events.list',
            input: {
              runId: delivered.id,
              afterSequence: null,
              page: { cursor: null, limit: 100 },
            },
          }),
        () => data.runReplay.get(delivered.id),
        () => data.runs.spawnChild(spawnRequest, spawnContext),
      ];
      for (const action of corruptActions()) {
        expect(corruptMessage(action)).not.toContain(OBJECTIVE_SENTINEL);
      }
      expect(canonicalJson(databaseSnapshot(database))).toBe(canonicalJson(journalSnapshot));
      expect(callCounts(fixture.dependencies)).toEqual(journalCalls);

      activeStore.close();
      activeStore = await openTargetStore(fixture.databasePath);
      data = createJourneyDataAccess(activeStore, fixture.dependencies, fixture.createId);
      database = getJourneyTestDatabase(activeStore);
      host = createHostCatalogProvisioning(activeStore, { now: () => NOW });
      expect(host.registerProviderProfile(providerSeed)).toEqual(providerSeed);
      for (const action of corruptActions()) {
        expect(corruptMessage(action)).not.toContain(OBJECTIVE_SENTINEL);
      }
      expect(canonicalJson(databaseSnapshot(database))).toBe(canonicalJson(journalSnapshot));
      expect(callCounts(fixture.dependencies)).toEqual(journalCalls);
    } finally {
      activeStore.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);
});
