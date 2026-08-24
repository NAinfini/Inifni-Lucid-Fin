import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EntityIdSchema, ProjectGetDefinition } from '@lucid-fin/target-contracts';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { createTargetDataAccess } from '../kernel/data-access.js';
import { createTargetStore, openTargetStore } from '../kernel/store.js';
import type { MediaCas, MediaImportCapabilityResolver } from '../kernel/media-cas.js';

const NOW = '2026-08-15T12:00:00.000Z';
const LATER = '2026-08-15T13:00:00.000Z';
const directories: string[] = [];
const context = {
  actor: 'user' as const,
  causation: { kind: 'direct_ui' as const, actionId: 'action.project.1' },
  correlationId: 'correlation.project.1',
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
    throw new Error('Media CAS is not used by Project tests');
  },
  stat: async () => null,
  verify: async () => {
    throw new Error('Media CAS is not used by Project tests');
  },
};
const unusedMediaImportCapabilities: MediaImportCapabilityResolver = {
  resolve: async () => {
    throw new Error('Media capabilities are not used by Project tests');
  },
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function deterministicIds() {
  const counts = new Map<string, number>();
  return (authority: string) => {
    const count = (counts.get(authority) ?? 0) + 1;
    counts.set(authority, count);
    return `${authority}.${count}`;
  };
}

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-project-authority-'));
  directories.push(directory);
  const databasePath = join(directory, 'project.sqlite');
  const store = await createTargetStore(databasePath);
  let now = NOW;
  const data = createTargetDataAccess(store, {
    now: () => now,
    createId: deterministicIds(),
    mediaCas: unusedMediaCas,
    mediaImportCapabilities: unusedMediaImportCapabilities,
  });
  return {
    store,
    data,
    database: getTargetStoreDatabase(store),
    databasePath,
    setNow: (value: string) => (now = value),
  };
}

function createRequest(requestId = 'request.project.create.1', name = 'North Star') {
  return {
    wireVersion: 1 as const,
    kind: 'request' as const,
    requestId,
    method: 'project.create' as const,
    input: { name, permissionMode: 'reversible' as const, budget, formatPolicy },
  };
}

describe('Project authority', () => {
  it('creates Project, Settings, and its Canvas with three ordered events in one receipt transaction', async () => {
    const { store, data, database } = await harness();
    try {
      const request = createRequest();
      const success = data.projects.create(request, context);
      expect(success).toMatchObject({
        kind: 'success',
        requestId: request.requestId,
        method: 'project.create',
        result: {
          project: {
            authority: 'project',
            id: 'project.1',
            name: 'North Star',
            lifecycle: 'active',
            schemaRevision: 1,
            revision: 0,
            createdBy: context.causation,
            createdAt: NOW,
            updatedAt: NOW,
            archivedAt: null,
            deletedAt: null,
          },
          settings: {
            authority: 'project_settings',
            projectId: 'project.1',
            revision: 0,
            defaultProviderProfileId: null,
            formatPolicy,
            permission: 'reversible',
            budget,
            enabledSkills: [],
            updatedAt: NOW,
          },
        },
      });
      expect(database.prepare('SELECT count(*) AS count FROM projects').get()).toEqual({
        count: 1,
      });
      expect(database.prepare('SELECT count(*) AS count FROM project_settings').get()).toEqual({
        count: 1,
      });
      expect(database.prepare('SELECT * FROM canvas_documents').get()).toMatchObject({
        id: 'canvas.1',
        project_id: 'project.1',
        revision: 0,
        viewport_v1_json: '{"center":{"x":0,"y":0},"zoom":1}',
        next_z_index: 0,
        created_at: NOW,
        updated_at: NOW,
      });
      const events = database
        .prepare(
          `SELECT sequence, subject_authority, idempotency_key
           FROM project_events ORDER BY sequence`,
        )
        .all() as Array<{
        sequence: number;
        subject_authority: string;
        idempotency_key: string;
      }>;
      expect(
        events.map(({ sequence, subject_authority }) => ({ sequence, subject_authority })),
      ).toEqual([
        { sequence: 1, subject_authority: 'project' },
        { sequence: 2, subject_authority: 'project_settings' },
        { sequence: 3, subject_authority: 'canvas' },
      ]);
      expect(events.map(({ idempotency_key }) => idempotency_key)).toEqual([
        expect.stringMatching(/^project\.create\.0\.[a-f0-9]{64}$/),
        expect.stringMatching(/^project\.create\.1\.[a-f0-9]{64}$/),
        expect.stringMatching(/^project\.create\.2\.[a-f0-9]{64}$/),
      ]);
      expect(data.projects.create(request, context)).toEqual(success);
      expect(database.prepare('SELECT count(*) AS count FROM project_events').get()).toEqual({
        count: 3,
      });
    } finally {
      store.close();
    }
  });

  it('derives valid distinct event keys for a maximum-length request ID and replays exactly', async () => {
    const { store, data, database } = await harness();
    try {
      const request = createRequest('r'.repeat(160));
      const created = data.projects.create(request, context);
      const eventKeys = (
        database
          .prepare('SELECT idempotency_key FROM project_events ORDER BY sequence')
          .all() as Array<{ idempotency_key: string }>
      ).map(({ idempotency_key }) => idempotency_key);

      expect(eventKeys).toHaveLength(3);
      expect(new Set(eventKeys).size).toBe(3);
      expect(eventKeys.every((key) => EntityIdSchema.safeParse(key).success)).toBe(true);
      expect(data.projects.create(request, context)).toEqual(created);
      expect(database.prepare('SELECT count(*) AS count FROM project_events').get()).toEqual({
        count: 3,
      });
    } finally {
      store.close();
    }
  });

  it('uses revision CAS, permits explicit lifecycle targets, and receipts semantic no-ops', async () => {
    const { store, data, database, setNow } = await harness();
    try {
      const created = data.projects.create(createRequest(), context);
      const projectId = created.result.project.id;
      setNow(LATER);
      const archived = data.projects.update(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.project.update.1',
          method: 'project.update',
          input: { projectId, expectedRevision: 0, name: null, lifecycle: 'archived' },
        },
        context,
      );
      expect(archived.result).toMatchObject({
        revision: 1,
        lifecycle: 'archived',
        archivedAt: LATER,
        deletedAt: null,
        updatedAt: LATER,
      });
      expect(() =>
        data.projects.update(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.project.update.stale',
            method: 'project.update',
            input: { projectId, expectedRevision: 0, name: 'Stale', lifecycle: null },
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));

      const eventCount = database.prepare('SELECT count(*) AS count FROM project_events').get();
      const noop = data.projects.update(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.project.update.noop',
          method: 'project.update',
          input: { projectId, expectedRevision: 1, name: null, lifecycle: null },
        },
        context,
      );
      expect(noop.result).toEqual(archived.result);
      expect(database.prepare('SELECT count(*) AS count FROM project_events').get()).toEqual(
        eventCount,
      );
      expect(
        database
          .prepare('SELECT count(*) AS count FROM wire_command_receipts WHERE request_id = ?')
          .get('request.project.update.noop'),
      ).toEqual({ count: 1 });

      const restored = data.projects.update(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.project.update.restore',
          method: 'project.update',
          input: { projectId, expectedRevision: 1, name: null, lifecycle: 'active' },
        },
        context,
      );
      expect(restored.result).toMatchObject({
        lifecycle: 'active',
        archivedAt: null,
        deletedAt: null,
      });
    } finally {
      store.close();
    }
  });

  it('updates Settings with dual CAS and exact provider/skill foreign keys', async () => {
    const { store, data, database } = await harness();
    try {
      const created = data.projects.create(createRequest(), context);
      const { project, settings } = created.result;
      database
        .prepare(
          `INSERT INTO provider_profiles (
             id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
             credential_handle, status, configuration_v1_json, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'ready', '{}', 0, ?, ?)`,
        )
        .run('provider.openai', 'OpenAI', 'openai', 'gpt-5.6', NOW, NOW);
      database
        .prepare(
          `INSERT INTO skills (
             id, version, name, description, content_text, content_hash, provenance, trust, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'built_in', 'trusted', ?)`,
        )
        .run(
          'skill.continuity',
          '1.0.0',
          'Continuity',
          'Continuity review',
          'Review continuity.',
          'a'.repeat(64),
          NOW,
        );
      database
        .prepare(
          `INSERT INTO skill_effective_versions (skill_id, skill_version, changed_at)
           VALUES ('skill.continuity', '1.0.0', ?)`,
        )
        .run(NOW);
      const update = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.project.settings.1',
        method: 'project.settings.update' as const,
        input: {
          projectId: project.id,
          expectedRevision: settings.revision,
          expectedContentHash: settings.contentHash,
          defaultProviderProfileId: 'provider.openai',
          formatPolicy: { ...formatPolicy, frameRate: 30 },
          permission: 'full' as const,
          budget,
          enabledSkills: [{ id: 'skill.continuity', version: '1.0.0' }],
        },
      };
      const success = data.projects.updateSettings(update, context);
      expect(success.result).toMatchObject({
        authority: 'project_settings',
        projectId: project.id,
        revision: 1,
        defaultProviderProfileId: 'provider.openai',
        enabledSkills: [{ id: 'skill.continuity', version: '1.0.0' }],
      });
      expect(
        database
          .prepare('SELECT subject_authority FROM project_events ORDER BY sequence DESC LIMIT 1')
          .get(),
      ).toEqual({ subject_authority: 'project_settings' });

      expect(() =>
        data.projects.updateSettings(
          {
            ...update,
            requestId: 'request.project.settings.missing',
            input: {
              ...update.input,
              expectedRevision: 1,
              expectedContentHash: success.result.contentHash,
              enabledSkills: [{ id: 'skill.continuity', version: '2.0.0' }],
            },
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
      expect(
        database
          .prepare('SELECT count(*) AS count FROM wire_command_receipts WHERE request_id = ?')
          .get('request.project.settings.missing'),
      ).toEqual({ count: 0 });
      expect(
        data.projects.getSettings({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.project.settings.get.1',
          method: 'project.settings.get',
          input: { projectId: project.id },
        }).result,
      ).toEqual(success.result);
    } finally {
      store.close();
    }
  });

  it('returns typed Project reads and stable cursor pages', async () => {
    const { store, data } = await harness();
    try {
      const first = data.projects.create(
        createRequest('request.project.create.a', 'Alpha'),
        context,
      );
      const second = data.projects.create(createRequest('request.project.create.b', 'Beta'), {
        ...context,
        correlationId: 'correlation.project.2',
      });
      expect(
        data.projects.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.project.get.1',
          method: 'project.get',
          input: { projectId: first.result.project.id },
        }).result,
      ).toEqual(first.result.project);
      expect(
        data.projects.getTool(
          first.result.project.id,
          ProjectGetDefinition.parseInput(ProjectGetDefinition.examples.input),
        ),
      ).toEqual(
        ProjectGetDefinition.parseSuccess({
          sections: [
            {
              section: 'metadata',
              revision: first.result.project.revision,
              contentHash: first.result.project.contentHash,
              name: first.result.project.name,
              lifecycle: first.result.project.lifecycle,
            },
            {
              section: 'format_policy',
              revision: first.result.settings.revision,
              contentHash: first.result.settings.contentHash,
              formatPolicy: first.result.settings.formatPolicy,
            },
            {
              section: 'capabilities',
              revision: first.result.settings.revision,
              contentHash: first.result.settings.contentHash,
              defaultProviderProfileId: first.result.settings.defaultProviderProfileId,
              enabledSkills: first.result.settings.enabledSkills,
            },
            {
              section: 'permissions',
              revision: first.result.settings.revision,
              contentHash: first.result.settings.contentHash,
              mode: first.result.settings.permission,
            },
            {
              section: 'budget',
              revision: first.result.settings.revision,
              contentHash: first.result.settings.contentHash,
              ceiling: first.result.settings.budget,
            },
          ],
        }),
      );
      const page = data.projects.list({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.project.list.1',
        method: 'project.list',
        input: { cursor: null, limit: 1 },
      });
      const next = data.projects.list({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.project.list.2',
        method: 'project.list',
        input: { cursor: page.result.nextCursor, limit: 1 },
      });
      expect([...page.result.items, ...next.result.items].map(({ id }) => id)).toEqual([
        first.result.project.id,
        second.result.project.id,
      ]);
      expect(next.result.nextCursor).toBeNull();
    } finally {
      store.close();
    }
  });

  it('reopens persisted Project authority and replays the original receipt', async () => {
    const { store, data, databasePath } = await harness();
    const request = createRequest();
    const created = data.projects.create(request, context);
    store.close();

    const reopened = await openTargetStore(databasePath);
    try {
      const reopenedData = createTargetDataAccess(reopened, {
        now: () => LATER,
        createId: deterministicIds(),
        mediaCas: unusedMediaCas,
        mediaImportCapabilities: unusedMediaImportCapabilities,
      });
      expect(
        reopenedData.projects.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.project.get.reopened',
          method: 'project.get',
          input: { projectId: created.result.project.id },
        }).result,
      ).toEqual(created.result.project);
      expect(reopenedData.projects.create(request, context)).toEqual(created);
    } finally {
      reopened.close();
    }
  });
});
