import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CapabilityCatalogSnapshotV1Schema,
  ContextManifestSchema,
  RunInboxMessageSchema,
  RunSchema,
  assertRunContextManifest,
  canonicalJson,
  parseCanonical,
  type CapabilityCatalogSnapshotV1,
  type Project,
  type ProjectMemoryIndex,
} from '@lucid-fin/target-contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { hashCanonical, hashContentObject, hashUtf8 } from '../internal/hashes.js';
import { createTargetDataAccess } from '../kernel/data-access.js';
import type { MediaCas, MediaImportCapabilityResolver } from '../kernel/media-cas.js';
import { createTargetStore, openTargetStore, type TargetStore } from '../kernel/store.js';
import {
  computeProjectMemorySourceSetHash,
  type ProjectMemoryReadModel,
} from '../read-models/memory.js';
import type { MessageSendAcceptanceSeed } from './conversations.js';

const NOW = '2026-08-15T12:00:00.000Z';
const directories: string[] = [];
const rootCatalog = parseCanonical(
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
  causation: { kind: 'direct_ui' as const, actionId: 'action.message.send' },
  correlationId: 'correlation.message.send',
};
const budget = {
  costUsd: { state: 'known' as const, value: '20', currency: 'USD' },
  maxGenerationCount: 12,
  maxInputTokens: 100_000,
  maxOutputTokens: 20_000,
};
const formatPolicy = { aspectRatio: '16:9' as const, customDimensions: null, frameRate: 24 };
const unusedMediaCas: MediaCas = {
  putVerified: async () => {
    throw new Error('Media CAS is not used by message.send tests');
  },
  stat: async () => null,
  verify: async () => {
    throw new Error('Media CAS is not used by message.send tests');
  },
};
const unusedMediaImportCapabilities: MediaImportCapabilityResolver = {
  resolve: async () => {
    throw new Error('Media capabilities are not used by message.send tests');
  },
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function deterministicIds() {
  const counts = new Map<string, number>();
  return (kind: string) => {
    const next = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, next);
    return `${kind}.${next}`;
  };
}

function dataAccess(store: TargetStore, createId: (kind: string) => string) {
  return createTargetDataAccess(store, {
    now: () => NOW,
    createId,
    mediaCas: unusedMediaCas,
    mediaImportCapabilities: unusedMediaImportCapabilities,
  });
}

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-message-send-'));
  directories.push(directory);
  const databasePath = join(directory, 'project.sqlite');
  const store = await createTargetStore(databasePath);
  const createId = deterministicIds();
  const data = dataAccess(store, createId);
  const created = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.project.create',
      method: 'project.create',
      input: { name: 'North Star', permissionMode: 'reversible', budget, formatPolicy },
    },
    context,
  ).result;
  const database = getTargetStoreDatabase(store);
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
      input: { projectId: created.project.id, title: 'Main thread' },
    },
    context,
  ).result;
  const seed: MessageSendAcceptanceSeed = {
    model: { providerId: 'provider.openai', model: 'gpt-5.6', reasoningStrength: 'high' },
    locale: 'en-US',
    timeZone: 'America/New_York',
    capabilityCatalog: rootCatalog,
    projectMediaSelections: [],
    citedMemoryEntryIds: [],
  };
  const request = {
    wireVersion: 1 as const,
    kind: 'request' as const,
    requestId: 'request.message.send',
    method: 'message.send' as const,
    input: {
      chatId: chat.id,
      blocks: [{ type: 'text' as const, text: 'Create a rain-soaked night sequence.' }],
      attachments: [],
      selectedContext: [
        {
          ref: {
            authority: 'project' as const,
            id: created.project.id,
            revision: created.project.revision,
            contentHash: created.project.contentHash,
          },
          role: 'target' as const,
        },
      ],
      exportDestinationGrant: null,
      supersedesMessageId: null,
    },
  };
  return {
    store,
    data,
    database,
    databasePath,
    createId,
    project: created.project,
    chat,
    seed,
    request,
  };
}

function projectEventWatermark(
  database: ReturnType<typeof getTargetStoreDatabase>,
  projectId: string,
) {
  return (
    database
      .prepare(
        'SELECT COALESCE(MAX(sequence), 0) AS watermark FROM project_events WHERE project_id = ?',
      )
      .get(projectId) as { watermark: number }
  ).watermark;
}

function memoryIndex(project: Project, historyWatermark: number): ProjectMemoryIndex {
  const withoutHash = {
    id: 'memory.item.visual-direction',
    category: 'visual_direction' as const,
    sources: [
      {
        kind: 'domain_object' as const,
        ref: {
          authority: 'project' as const,
          id: project.id,
          revision: project.revision,
          contentHash: project.contentHash,
        },
      },
    ],
    state: 'current' as const,
    tentative: false,
    topics: ['rain', 'night'],
    searchableText: 'Cold rain, cyan reflections, and restrained contrast.',
    contentHash: '',
  };
  const entry = { ...withoutHash, contentHash: hashContentObject(withoutHash) };
  return {
    authority: 'project_memory',
    id: `memory.version.${historyWatermark}`,
    projectId: project.id,
    derivationVersion: 'memory-v1',
    sourceSchemaVersion: 'source-v1',
    historyWatermark,
    sourceSetHash: computeProjectMemorySourceSetHash([entry]),
    completeness: 'complete',
    entries: [entry],
    createdAt: NOW,
  };
}

function publishMemory(memory: ProjectMemoryReadModel, project: Project, historyWatermark: number) {
  const index = memory.recordVersion(memoryIndex(project, historyWatermark));
  memory.publishHead({
    projectId: project.id,
    memoryVersionId: index.id,
    expectedHeadRevision: null,
    updatedAt: NOW,
  });
  return index;
}

function insertProjectMedia(
  database: ReturnType<typeof getTargetStoreDatabase>,
  projectId: string,
  suffix: string,
) {
  const blobHash = suffix === 'one' ? '1'.repeat(64) : '2'.repeat(64);
  const globalAssetId = `global-media.${suffix}`;
  const projectMediaRefId = `project-media.${suffix}`;
  const assetWithoutHash = {
    authority: 'global_media_asset' as const,
    id: globalAssetId,
    revision: 0,
    contentHash: '',
    blobHash,
    kind: 'image' as const,
    filename: `${suffix}.png`,
    displayName: `${suffix} image`,
    source: {
      kind: 'imported' as const,
      originalFileName: `${suffix}.png`,
      importId: `import.${suffix}`,
    },
    folderId: null,
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const asset = { ...assetWithoutHash, contentHash: hashContentObject(assetWithoutHash) };
  database
    .prepare(
      `INSERT INTO media_blobs (
         hash, byte_length, mime_type, media_kind, technical_facts_v1_json, created_at
       ) VALUES (?, 3, 'image/png', 'image', ?, ?)`,
    )
    .run(blobHash, canonicalJson({ kind: 'image', width: 16, height: 9 }), NOW);
  database
    .prepare(
      `INSERT INTO global_media_assets (
         id, revision, content_hash, blob_hash, media_kind, filename, display_name,
         source_v1_json, folder_id, tags_v1_json, created_at, updated_at
       ) VALUES (?, 0, ?, ?, 'image', ?, ?, ?, NULL, '[]', ?, ?)`,
    )
    .run(
      asset.id,
      asset.contentHash,
      asset.blobHash,
      asset.filename,
      asset.displayName,
      canonicalJson(asset.source),
      NOW,
      NOW,
    );
  database
    .prepare(
      `INSERT INTO project_media_refs (
         id, project_id, global_asset_id, revision, content_hash, lifecycle, detached_at,
         label, collections_v1_json, roles_v1_json, notes, created_by_kind, created_by_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, 0, ?, 'active', NULL, ?, '[]', '["reference"]', '',
         'import', ?, ?, ?)`,
    )
    .run(
      projectMediaRefId,
      projectId,
      globalAssetId,
      hashCanonical({ projectMediaRefId }),
      suffix,
      `import.${suffix}`,
      NOW,
      NOW,
    );
  return {
    projectMediaRefId,
    globalAssetId,
    blobHash,
    role: 'reference' as const,
  };
}

function acceptanceCounts(database: ReturnType<typeof getTargetStoreDatabase>) {
  return Object.fromEntries(
    [
      'messages',
      'runs',
      'context_manifests',
      'capability_catalog_snapshots',
      'run_inbox_messages',
      'run_events',
      'run_activations',
      'task_lists',
      'wire_command_receipts',
    ].map((table) => [
      table,
      (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
    ]),
  );
}

describe('message.send root Run acceptance', () => {
  it('atomically appends the Message and freezes one root Run acceptance snapshot', async () => {
    const fixture = await harness();
    try {
      const media = insertProjectMedia(fixture.database, fixture.project.id, 'one');
      const baselineWatermark = projectEventWatermark(fixture.database, fixture.project.id);
      const seed = {
        ...fixture.seed,
        projectMediaSelections: [
          { projectMediaRefId: media.projectMediaRefId, role: 'reference' as const },
        ],
      };
      const request = {
        ...fixture.request,
        input: { ...fixture.request.input, attachments: [media] },
      };

      const response = fixture.data.conversations.sendMessage(request, context, seed);
      const run = parseCanonical(RunSchema, response.result.acceptedRun);
      const message = response.result.message;
      const chat = response.result.chat;
      expect(chat).toEqual(fixture.data.conversations.getChat(fixture.chat.id));
      expect(chat).toMatchObject({
        id: fixture.chat.id,
        revision: fixture.chat.revision + 1,
        messageCount: fixture.chat.messageCount + 1,
        messageHeadSequence: message.sequence,
      });
      expect(run).toMatchObject({
        authority: 'run',
        revision: 0,
        rootRunId: run.id,
        parentRunId: null,
        retryOfRunId: null,
        retrySeedHash: null,
        projectId: fixture.project.id,
        chatId: fixture.chat.id,
        acceptedSource: {
          kind: 'message',
          messageId: message.id,
          contentHash: message.contentHash,
        },
        status: 'accepted',
        model: seed.model,
        permissionMode: 'reversible',
        acceptedAt: NOW,
      });
      expect(fixture.data.conversations.getMessage(message.id)).toEqual(message);

      const manifestRow = fixture.database
        .prepare('SELECT manifest_hash, manifest_v1_json FROM context_manifests WHERE run_id = ?')
        .get(run.id) as { manifest_hash: string; manifest_v1_json: string };
      const manifest = parseCanonical(
        ContextManifestSchema,
        JSON.parse(manifestRow.manifest_v1_json),
      );
      expect(hashCanonical(manifest)).toBe(manifestRow.manifest_hash);
      expect(manifest).toMatchObject({
        id: run.contextManifestId,
        runId: run.id,
        retryOfRunId: null,
        retrySeedHash: null,
        projectId: fixture.project.id,
        projectRevision: fixture.project.revision,
        chatId: fixture.chat.id,
        acceptedSource: run.acceptedSource,
        locale: 'en-US',
        timeZone: 'America/New_York',
        selectedContext: request.input.selectedContext,
        projectMedia: [{ ...media, role: 'reference' }],
        attachments: [media],
        historyWatermark: baselineWatermark,
        memory: { state: 'unavailable', reason: 'not_built' },
        capabilityCatalogSnapshotId: run.capabilityCatalogSnapshotId,
        capabilityCatalogHash: rootCatalog.catalogHash,
      });
      expect(manifest.projectSettings).toEqual(
        fixture.data.projects.getSettings({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.settings.get',
          method: 'project.settings.get',
          input: { projectId: fixture.project.id },
        }).result,
      );
      expect(() => assertRunContextManifest(run, manifest, rootCatalog)).not.toThrow();

      const catalogRow = fixture.database
        .prepare(
          'SELECT catalog_hash, catalog_v1_json FROM capability_catalog_snapshots WHERE run_id = ?',
        )
        .get(run.id) as { catalog_hash: string; catalog_v1_json: string };
      expect(catalogRow).toEqual({
        catalog_hash: rootCatalog.catalogHash,
        catalog_v1_json: canonicalJson(rootCatalog),
      });
      const inboxRow = fixture.database
        .prepare('SELECT * FROM run_inbox_messages WHERE run_id = ?')
        .get(run.id) as Record<string, unknown>;
      const inbox = parseCanonical(RunInboxMessageSchema, {
        id: inboxRow.id,
        runId: inboxRow.run_id,
        sequence: inboxRow.sequence,
        actor: inboxRow.actor,
        source: JSON.parse(inboxRow.source_v1_json as string),
        selectedContext: JSON.parse(inboxRow.selected_context_v1_json as string),
        exportDestinationGrant: null,
        contentHash: inboxRow.content_hash,
        state: inboxRow.state,
        createdAt: inboxRow.created_at,
      });
      expect(inbox).toMatchObject({
        runId: run.id,
        sequence: 1,
        actor: 'user',
        source: run.acceptedSource,
        selectedContext: request.input.selectedContext,
        exportDestinationGrant: null,
        contentHash: message.contentHash,
        state: 'queued',
        createdAt: NOW,
      });
      expect(projectEventWatermark(fixture.database, fixture.project.id)).toBe(
        baselineWatermark + 1,
      );
      expect(acceptanceCounts(fixture.database)).toMatchObject({
        messages: 1,
        runs: 1,
        context_manifests: 1,
        capability_catalog_snapshots: 1,
        run_inbox_messages: 1,
        run_events: 0,
        run_activations: 0,
        task_lists: 0,
      });
    } finally {
      fixture.store.close();
    }
  });

  it('captures ready Memory at the pre-Message watermark and validates cited entry IDs', async () => {
    const fixture = await harness();
    try {
      const baselineWatermark = projectEventWatermark(fixture.database, fixture.project.id);
      const index = publishMemory(fixture.data.memory, fixture.project, baselineWatermark);
      const seed = { ...fixture.seed, citedMemoryEntryIds: [index.entries[0]!.id] };
      const response = fixture.data.conversations.sendMessage(fixture.request, context, seed);
      const manifest = JSON.parse(
        (
          fixture.database
            .prepare('SELECT manifest_v1_json FROM context_manifests WHERE run_id = ?')
            .get(response.result.acceptedRun.id) as { manifest_v1_json: string }
        ).manifest_v1_json,
      );
      expect(ContextManifestSchema.parse(manifest).memory).toEqual({
        state: 'ready',
        derivationVersion: index.derivationVersion,
        watermark: baselineWatermark,
        citedEntryIds: [index.entries[0]!.id],
        sourceSetHash: index.sourceSetHash,
      });
      expect(projectEventWatermark(fixture.database, fixture.project.id)).toBe(
        baselineWatermark + 1,
      );
    } finally {
      fixture.store.close();
    }
  });

  it('freezes stale Memory without accepting citations from the stale head', async () => {
    const fixture = await harness();
    try {
      const memoryWatermark = projectEventWatermark(fixture.database, fixture.project.id);
      const index = publishMemory(fixture.data.memory, fixture.project, memoryWatermark);
      const secondChat = fixture.data.conversations.createChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.chat.create.second',
          method: 'chat.create',
          input: { projectId: fixture.project.id, title: 'Second thread' },
        },
        context,
      ).result;
      const activeWatermark = projectEventWatermark(fixture.database, fixture.project.id);
      const response = fixture.data.conversations.sendMessage(
        fixture.request,
        context,
        fixture.seed,
      );
      const manifest = ContextManifestSchema.parse(
        JSON.parse(
          (
            fixture.database
              .prepare('SELECT manifest_v1_json FROM context_manifests WHERE run_id = ?')
              .get(response.result.acceptedRun.id) as { manifest_v1_json: string }
          ).manifest_v1_json,
        ),
      );
      expect(manifest.memory).toEqual({
        state: 'stale',
        derivationVersion: index.derivationVersion,
        watermark: memoryWatermark,
        activeHistoryWatermark: activeWatermark,
        sourceSetHash: index.sourceSetHash,
      });
      expect(() =>
        fixture.data.conversations.sendMessage(
          {
            ...fixture.request,
            requestId: 'request.message.send.stale-citation',
            input: { ...fixture.request.input, chatId: secondChat.id },
          },
          context,
          { ...fixture.seed, citedMemoryEntryIds: [index.entries[0]!.id] },
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      fixture.store.close();
    }
  });

  it('rejects stale and cross-Project selected refs and attachments without partial writes', async () => {
    const fixture = await harness();
    try {
      const other = fixture.data.projects.create(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.project.create.other',
          method: 'project.create',
          input: { name: 'Other', permissionMode: 'reversible', budget, formatPolicy },
        },
        context,
      ).result.project;
      const crossProjectMedia = insertProjectMedia(fixture.database, other.id, 'two');
      const before = acceptanceCounts(fixture.database);

      expect(() =>
        fixture.data.conversations.sendMessage(
          {
            ...fixture.request,
            requestId: 'request.message.send.stale-ref',
            input: {
              ...fixture.request.input,
              selectedContext: [
                {
                  ref: {
                    authority: 'project',
                    id: fixture.project.id,
                    revision: fixture.project.revision + 1,
                    contentHash: fixture.project.contentHash,
                  },
                  role: 'target',
                },
              ],
            },
          },
          context,
          fixture.seed,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(() =>
        fixture.data.conversations.sendMessage(
          {
            ...fixture.request,
            requestId: 'request.message.send.cross-ref',
            input: {
              ...fixture.request.input,
              selectedContext: [
                {
                  ref: {
                    authority: 'project',
                    id: other.id,
                    revision: other.revision,
                    contentHash: other.contentHash,
                  },
                  role: 'reference',
                },
              ],
            },
          },
          context,
          fixture.seed,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.data.conversations.sendMessage(
          {
            ...fixture.request,
            requestId: 'request.message.send.cross-attachment',
            input: { ...fixture.request.input, attachments: [crossProjectMedia] },
          },
          context,
          fixture.seed,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(acceptanceCounts(fixture.database)).toEqual(before);
    } finally {
      fixture.store.close();
    }
  });

  it('gives the receipt precedence over active-root checks and rejects changed semantics', async () => {
    const fixture = await harness();
    try {
      const first = fixture.data.conversations.sendMessage(fixture.request, context, fixture.seed);
      const afterFirst = acceptanceCounts(fixture.database);
      fixture.database
        .prepare("UPDATE provider_profiles SET status = 'disabled' WHERE id = 'provider.openai'")
        .run();
      expect(
        fixture.data.conversations.sendMessage(fixture.request, context, fixture.seed),
      ).toEqual(first);
      expect(acceptanceCounts(fixture.database)).toEqual(afterFirst);
      expect(() =>
        fixture.data.conversations.sendMessage(fixture.request, context, {
          ...fixture.seed,
          locale: 'zh-CN',
        }),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(() =>
        fixture.data.conversations.sendMessage(
          {
            ...fixture.request,
            input: {
              ...fixture.request.input,
              blocks: [{ type: 'text', text: 'Changed idempotent semantics.' }],
            },
          },
          context,
          fixture.seed,
        ),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      fixture.database
        .prepare("UPDATE provider_profiles SET status = 'ready' WHERE id = 'provider.openai'")
        .run();
      expect(() =>
        fixture.data.conversations.sendMessage(
          { ...fixture.request, requestId: 'request.message.send.second-root' },
          context,
          fixture.seed,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(acceptanceCounts(fixture.database)).toEqual(afterFirst);
    } finally {
      fixture.store.close();
    }
  });

  it('rejects stale provider and invalid base digests, then freezes current Skills per new root Run', async () => {
    const fixture = await harness();
    try {
      const baseline = acceptanceCounts(fixture.database);
      expect(() =>
        fixture.data.conversations.sendMessage(
          { ...fixture.request, requestId: 'request.message.send.provider-mismatch' },
          context,
          {
            ...fixture.seed,
            model: { ...fixture.seed.model, reasoningStrength: 'medium' },
          },
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));

      const invalidCatalog: CapabilityCatalogSnapshotV1 = {
        ...rootCatalog,
        tools: rootCatalog.tools.map((tool, index) =>
          index === 0
            ? {
                ...tool,
                inputSchema: { ...tool.inputSchema, sha256: 'f'.repeat(64) },
              }
            : tool,
        ),
      };
      expect(() =>
        fixture.data.conversations.sendMessage(
          { ...fixture.request, requestId: 'request.message.send.catalog-digest' },
          context,
          { ...fixture.seed, capabilityCatalog: invalidCatalog },
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(acceptanceCounts(fixture.database)).toEqual(baseline);

      fixture.database
        .prepare(
          `INSERT INTO skills (
             id, version, name, description, content_text, content_hash,
             provenance, trust, created_at
           ) VALUES ('skill.continuity', '1.0.0', 'Continuity', 'Continuity review',
             'Review continuity.', ?, 'built_in', 'trusted', ?)`,
        )
        .run(hashUtf8('Review continuity.'), NOW);
      fixture.database
        .prepare(
          `INSERT INTO skill_effective_versions (skill_id, skill_version, changed_at)
           VALUES ('skill.continuity', '1.0.0', ?)`,
        )
        .run(NOW);
      const settings = fixture.data.projects.getSettings({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.settings.before-skill',
        method: 'project.settings.get',
        input: { projectId: fixture.project.id },
      }).result;
      const oneSkillSettings = fixture.data.projects.updateSettings(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.settings.enable-skill',
          method: 'project.settings.update',
          input: {
            projectId: fixture.project.id,
            expectedRevision: settings.revision,
            expectedContentHash: settings.contentHash,
            defaultProviderProfileId: settings.defaultProviderProfileId,
            formatPolicy: settings.formatPolicy,
            permission: settings.permission,
            budget: settings.budget,
            enabledSkills: [{ id: 'skill.continuity', version: '1.0.0' }],
          },
        },
        context,
      ).result;
      const firstRun = fixture.data.conversations.sendMessage(
        { ...fixture.request, requestId: 'request.message.send.first-skill-catalog' },
        context,
        fixture.seed,
      ).result.acceptedRun;
      const firstCatalog = fixture.data.runReplay.get(firstRun.id).catalog;
      expect(firstCatalog.skills.map(({ skillId }) => skillId)).toEqual(['skill.continuity']);

      fixture.database
        .prepare(
          `INSERT INTO skills (
             id, version, name, description, content_text, content_hash,
             provenance, trust, created_at
           ) VALUES ('skill.storyboard', '1.0.0', 'Storyboard', 'Storyboard review',
             'Review storyboard.', ?, 'installed', 'reviewed', ?)`,
        )
        .run(hashUtf8('Review storyboard.'), NOW);
      fixture.database
        .prepare(
          `INSERT INTO skill_effective_versions (skill_id, skill_version, changed_at)
           VALUES ('skill.storyboard', '1.0.0', ?)`,
        )
        .run(NOW);
      fixture.data.projects.updateSettings(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.settings.enable-second-skill',
          method: 'project.settings.update',
          input: {
            projectId: fixture.project.id,
            expectedRevision: oneSkillSettings.revision,
            expectedContentHash: oneSkillSettings.contentHash,
            defaultProviderProfileId: oneSkillSettings.defaultProviderProfileId,
            formatPolicy: oneSkillSettings.formatPolicy,
            permission: oneSkillSettings.permission,
            budget: oneSkillSettings.budget,
            enabledSkills: [
              { id: 'skill.continuity', version: '1.0.0' },
              { id: 'skill.storyboard', version: '1.0.0' },
            ],
          },
        },
        context,
      );
      expect(fixture.data.runReplay.get(firstRun.id).catalog).toEqual(firstCatalog);

      const secondChat = fixture.data.conversations.createChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.chat.second-skill-catalog',
          method: 'chat.create',
          input: { projectId: fixture.project.id, title: 'Second skill catalog' },
        },
        context,
      ).result;
      const secondRun = fixture.data.conversations.sendMessage(
        {
          ...fixture.request,
          requestId: 'request.message.send.second-skill-catalog',
          input: { ...fixture.request.input, chatId: secondChat.id },
        },
        context,
        fixture.seed,
      ).result.acceptedRun;
      expect(
        fixture.data.runReplay.get(secondRun.id).catalog.skills.map(({ skillId }) => skillId),
      ).toEqual(['skill.continuity', 'skill.storyboard']);
    } finally {
      fixture.store.close();
    }
  });

  it('rolls back the Message, event, search, Run, snapshots, Inbox, and receipt on a mid-transaction failure', async () => {
    const fixture = await harness();
    try {
      const baselineCounts = acceptanceCounts(fixture.database);
      const baselineWatermark = projectEventWatermark(fixture.database, fixture.project.id);
      fixture.database.exec(
        `CREATE TRIGGER inject_context_manifest_failure
         BEFORE INSERT ON context_manifests
         BEGIN
           SELECT RAISE(ABORT, 'injected context manifest failure');
         END`,
      );
      expect(() =>
        fixture.data.conversations.sendMessage(fixture.request, context, fixture.seed),
      ).toThrow('injected context manifest failure');
      expect(acceptanceCounts(fixture.database)).toEqual(baselineCounts);
      expect(projectEventWatermark(fixture.database, fixture.project.id)).toBe(baselineWatermark);
      expect(fixture.data.conversations.getChat(fixture.chat.id)).toMatchObject({
        revision: fixture.chat.revision,
        messageCount: 0,
        messageHeadSequence: null,
      });
      expect(
        fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_search_documents WHERE source_kind = 'message'",
          )
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      fixture.store.close();
    }
  });

  it('reopens and returns the identical receipt without duplicating any acceptance row', async () => {
    const fixture = await harness();
    const first = fixture.data.conversations.sendMessage(fixture.request, context, fixture.seed);
    const before = acceptanceCounts(fixture.database);
    fixture.store.close();

    const reopened = await openTargetStore(fixture.databasePath);
    try {
      const replay = dataAccess(reopened, deterministicIds()).conversations.sendMessage(
        fixture.request,
        context,
        fixture.seed,
      );
      expect(replay).toEqual(first);
      expect(acceptanceCounts(getTargetStoreDatabase(reopened))).toEqual(before);
    } finally {
      reopened.close();
    }
  });
});
