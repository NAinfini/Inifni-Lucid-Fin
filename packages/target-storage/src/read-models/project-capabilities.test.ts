import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SkillDocument } from '@lucid-fin/target-contracts';
import { createHostCatalogProvisioning } from '../host/index.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { hashUtf8 } from '../internal/hashes.js';
import { createTargetStore } from '../kernel/store.js';
import { createProjectCapabilitiesReadModel } from './project-capabilities.js';

const NOW = '2026-08-24T12:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function skill(
  id: string,
  options: Partial<Pick<SkillDocument, 'trust' | 'version'>> = {},
): SkillDocument {
  const content = `Instructions for ${id} at ${options.version ?? '1.0.0'}.`;
  return {
    skillId: id,
    name: id,
    description: `Description for ${id}.`,
    version: options.version ?? '1.0.0',
    content,
    contentHash: hashUtf8(content),
    provenance: 'installed',
    trust: options.trust ?? 'reviewed',
    createdAt: NOW,
  };
}

function insertProject(database: ReturnType<typeof getTargetStoreDatabase>): void {
  database
    .prepare(
      `INSERT INTO projects (
         id, name, lifecycle, schema_revision, revision, content_hash, created_by_kind,
         created_by_id, created_at, updated_at, archived_at, deleted_at
       ) VALUES (?, ?, 'active', 1, 0, ?, 'direct_ui', ?, ?, ?, NULL, NULL)`,
    )
    .run('project.capabilities', 'Capabilities', HASH_A, 'action.capabilities', NOW, NOW);
}

describe('Project capabilities read model', () => {
  it('projects a stable safe Provider and effective Skill index', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-project-capabilities-'));
    directories.push(directory);
    const store = await createTargetStore(join(directory, 'project.sqlite'));
    try {
      const database = getTargetStoreDatabase(store);
      insertProject(database);
      const host = createHostCatalogProvisioning(store, { now: () => NOW });
      host.registerProviderProfile({
        id: 'provider.zulu',
        displayName: 'Zulu Provider',
        providerKind: 'image',
        model: 'model.z',
        status: 'unavailable',
      });
      host.registerProviderProfile({
        id: 'provider.alpha',
        displayName: 'Alpha Provider',
        providerKind: 'video',
        model: 'model.a',
        status: 'ready',
      });
      database
        .prepare(
          `UPDATE provider_profiles
           SET endpoint_origin = ?, credential_handle = ?, configuration_v1_json = ?, revision = ?
           WHERE id = ?`,
        )
        .run(
          'https://private.example',
          'keychain://private-credential',
          '{"apiKey":"private-secret"}',
          7,
          'provider.zulu',
        );

      host.registerSkill({
        document: skill('skill.zulu', { trust: 'unreviewed' }),
        projectId: null,
      });
      host.registerSkill({ document: skill('skill.alpha'), projectId: null });
      host.registerSkill({ document: skill('skill.alpha', { version: '2.0.0' }), projectId: null });

      const result = createProjectCapabilitiesReadModel(store).get('project.capabilities');
      expect(result.providers).toEqual([
        {
          id: 'provider.alpha',
          displayName: 'Alpha Provider',
          providerKind: 'video',
          model: 'model.a',
          status: 'ready',
          revision: 0,
        },
        {
          id: 'provider.zulu',
          displayName: 'Zulu Provider',
          providerKind: 'image',
          model: 'model.z',
          status: 'unavailable',
          revision: 7,
        },
      ]);
      expect(result.skills).toEqual([
        expect.objectContaining({
          id: 'skill.alpha',
          version: '2.0.0',
          trust: 'reviewed',
          eligibility: 'available',
          quarantineReason: null,
          pluginPackage: null,
        }),
        expect.objectContaining({
          id: 'skill.zulu',
          version: '1.0.0',
          trust: 'unreviewed',
          eligibility: 'quarantined',
          quarantineReason: 'Unreviewed Skill content is not runtime-eligible',
          pluginPackage: null,
        }),
      ]);
      expect(JSON.stringify(result)).not.toMatch(
        /private\.example|private-credential|private-secret|configuration_v1_json/,
      );
      expect(() => createProjectCapabilitiesReadModel(store).get('project.missing')).toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    } finally {
      store.close();
    }
  });
});
