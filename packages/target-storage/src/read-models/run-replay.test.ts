import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CapabilityCatalogSnapshotV1Schema,
  RunInspectDefinition,
  canonicalJson,
  parseCanonical,
} from '@lucid-fin/target-contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { createTargetDataAccess } from '../kernel/data-access.js';
import type { MediaCas, MediaImportCapabilityResolver } from '../kernel/media-cas.js';
import { createTargetStore } from '../kernel/store.js';

const NOW = '2026-08-15T12:00:00.000Z';
const directories: string[] = [];
const catalog = parseCanonical(
  CapabilityCatalogSnapshotV1Schema,
  JSON.parse(
    readFileSync(
      new URL('../../../target-contracts/generated/tool-catalog.v1.json', import.meta.url),
      'utf8',
    ),
  ) as unknown,
);
const context = {
  actor: 'user' as const,
  causation: { kind: 'direct_ui' as const, actionId: 'action.run.inspect' },
  correlationId: 'correlation.run.inspect',
};
const unusedMediaCas: MediaCas = {
  putVerified: async () => {
    throw new Error('Media CAS is not used by Run inspect tests');
  },
  stat: async () => null,
  verify: async () => {
    throw new Error('Media CAS is not used by Run inspect tests');
  },
};
const unusedMediaImportCapabilities: MediaImportCapabilityResolver = {
  resolve: async () => {
    throw new Error('Media capabilities are not used by Run inspect tests');
  },
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-run-inspect-'));
  directories.push(directory);
  const store = await createTargetStore(join(directory, 'project.sqlite'));
  let nextId = 0;
  const data = createTargetDataAccess(store, {
    now: () => NOW,
    createId: (authority) => `${authority}.${++nextId}`,
    mediaCas: unusedMediaCas,
    mediaImportCapabilities: unusedMediaImportCapabilities,
  });
  const project = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.project.run-inspect',
      method: 'project.create',
      input: {
        name: 'Run Inspect Project',
        permissionMode: 'reversible',
        budget: {
          costUsd: { state: 'known', value: '20', currency: 'USD' },
          maxGenerationCount: 10,
          maxInputTokens: 100_000,
          maxOutputTokens: 20_000,
        },
        formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
      },
    },
    context,
  ).result.project;
  const database = getTargetStoreDatabase(store);
  database
    .prepare(
      `INSERT INTO provider_profiles (
         id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
         credential_handle, status, configuration_v1_json, revision, created_at, updated_at
       ) VALUES ('provider.inspect', 'Inspect', 'openai', 'model.inspect', NULL, NULL,
         NULL, 'ready', '{}', 0, ?, ?)`,
    )
    .run(NOW, NOW);
  const chat = data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.chat.run-inspect',
      method: 'chat.create',
      input: { projectId: project.id, title: 'Run inspection' },
    },
    context,
  ).result;
  const selectedContext = [
    {
      ref: {
        authority: 'project' as const,
        id: project.id,
        revision: project.revision,
        contentHash: project.contentHash,
      },
      role: 'target' as const,
    },
  ];
  const run = data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.message.run-inspect',
      method: 'message.send',
      input: {
        chatId: chat.id,
        blocks: [{ type: 'text', text: 'Inspect the accepted Run context.' }],
        attachments: [],
        selectedContext,
        supersedesMessageId: null,
      },
    },
    context,
    {
      model: { providerId: 'provider.inspect', model: 'model.inspect', reasoningStrength: null },
      locale: 'en-US',
      timeZone: 'America/New_York',
      capabilityCatalog: catalog,
      projectMediaSelections: [],
      citedMemoryEntryIds: [],
    },
  ).result.acceptedRun;

  database
    .prepare(
      `INSERT INTO dispatch_operations (
         id, run_id, tool_id, tool_version, guard_outcome, idempotency_key, input_hash,
         input_v1_json, created_at, updated_at
       ) VALUES (?, ?, 'history.query', '1.0.0', 'allowed', ?, ?, '{}', ?, ?)`,
    )
    .run('dispatch.inspect', run.id, '1'.repeat(64), '2'.repeat(64), NOW, NOW);
  const resourceEntries = [
    ['resource.input', 'input_tokens', { state: 'estimated', value: 12 }, '3'.repeat(64)],
    ['resource.output', 'output_tokens', { state: 'unknown' }, '4'.repeat(64)],
    ['resource.cost', 'cost', { state: 'known', value: '1.2', currency: 'USD' }, '5'.repeat(64)],
  ] as const;
  for (const [id, kind, amount, idempotencyKey] of resourceEntries) {
    database
      .prepare(
        `INSERT INTO run_resource_entries (
           id, run_id, dispatch_operation_id, model_attempt_id, phase, reservation_entry_id,
           kind, amount_v1_json, idempotency_key, recorded_at
         ) VALUES (?, ?, ?, NULL, 'consumed', NULL, ?, ?, ?, ?)`,
      )
      .run(id, run.id, 'dispatch.inspect', kind, canonicalJson(amount), idempotencyKey, NOW);
  }
  return { store, data, project, run, selectedContext };
}

describe('Run replay read model', () => {
  it('projects the current Run into all public run.inspect sections', async () => {
    const fixture = await harness();
    try {
      const result = fixture.data.runReplay.inspect(fixture.run.id, {
        include: [
          'manifest',
          'inputs',
          'selections',
          'attachments',
          'authority_refs',
          'catalogs',
          'permissions',
          'resources',
        ],
      });

      expect(RunInspectDefinition.parseSuccess(result)).toEqual(result);
      expect(result).toEqual({
        runState: 'accepted',
        sections: [
          {
            section: 'manifest',
            manifestId: fixture.run.contextManifestId,
            manifestHash: fixture.run.contextManifestHash,
            acceptedSource: fixture.run.acceptedSource,
          },
          {
            section: 'inputs',
            messageIds: [fixture.run.acceptedSource.messageId],
            messageHashes: [fixture.run.acceptedSource.contentHash],
          },
          { section: 'selections', refs: fixture.selectedContext },
          { section: 'attachments', acceptedAttachmentIds: [] },
          { section: 'authority_refs', refs: fixture.selectedContext.map(({ ref }) => ref) },
          {
            section: 'catalogs',
            capabilityCatalogHash: fixture.run.capabilityCatalogHash,
            skillCatalogDigest: catalog.skillCatalogDigest,
          },
          {
            section: 'permissions',
            mode: 'reversible',
            canGenerate: true,
            canWrite: true,
          },
          {
            section: 'resources',
            inputTokens: { state: 'estimated', value: 12 },
            outputTokens: { state: 'unknown' },
            cost: { state: 'known', value: '1.2', currency: 'USD' },
          },
        ],
      });
    } finally {
      fixture.store.close();
    }
  });
});
