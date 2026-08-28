import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  CapabilityCatalogSnapshotV1Schema,
  capabilityCatalogHashInput,
  canonicalJson,
  skillCatalogDigestInput,
  type SkillDocument,
} from '@lucid-fin/contracts';
import { describe, expect, it } from 'vitest';
import { registerStoreDatabase, unregisterStoreDatabase } from './database-access.js';
import { hashUtf8 } from './hashes.js';
import type { Store } from '../kernel/store.js';
import { createHostCatalogProvisioning } from '../host/index.js';

const NOW = '2026-08-17T12:00:00.000Z';
const ROOT_CATALOG = CapabilityCatalogSnapshotV1Schema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../contracts/generated/tool-catalog.v1.json', import.meta.url),
      'utf8',
    ),
  ),
);

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

function insertProject(database: DatabaseSync, id: string): void {
  database
    .prepare(
      `INSERT INTO projects (
         id, name, lifecycle, schema_revision, revision, content_hash, created_by_kind,
         created_by_id, created_at, updated_at, archived_at, deleted_at
       ) VALUES (?, ?, 'active', 1, 0, ?, 'direct_ui', ?, ?, ?, NULL, NULL)`,
    )
    .run(id, id, hashUtf8(id), `action.${id}`, NOW, NOW);
}

function skill(id: string, options: Partial<SkillDocument> = {}): SkillDocument {
  const content = options.content ?? `Instructions for ${id}.`;
  return {
    skillId: id,
    name: options.name ?? id,
    description: options.description ?? `Description for ${id}.`,
    version: options.version ?? '1.0.0',
    contentHash: hashUtf8(content),
    provenance: options.provenance ?? 'installed',
    trust: options.trust ?? 'reviewed',
    content,
    createdAt: options.createdAt ?? NOW,
  };
}

function enable(database: DatabaseSync, projectId: string, document: SkillDocument): void {
  database
    .prepare(
      `INSERT INTO skill_enablements (
         project_id, skill_id, skill_version, enabled, enabled_at
       ) VALUES (?, ?, ?, 1, ?)`,
    )
    .run(projectId, document.skillId, document.version, NOW);
}

describe('host root Capability Catalog composition', () => {
  it('builds one deterministic sorted snapshot from current eligible Project Skills', () => {
    const { store, database } = memoryStore();
    try {
      insertProject(database, 'project.catalog');
      const host = createHostCatalogProvisioning(store);
      const last = skill('skill.z-last');
      const first = skill('skill.a-first');
      const disabled = skill('skill.disabled');
      for (const document of [last, first, disabled]) {
        host.registerSkill({ document, projectId: null });
      }
      enable(database, 'project.catalog', last);
      enable(database, 'project.catalog', first);

      const catalog = host.buildRootCapabilityCatalog({
        projectId: 'project.catalog',
        baseCatalog: ROOT_CATALOG,
      });
      expect(catalog.skills).toEqual([first, last]);
      expect(catalog.tools).toEqual(ROOT_CATALOG.tools);
      expect(catalog.capabilityIndex).toEqual(ROOT_CATALOG.capabilityIndex);
      expect(catalog.skillCatalogDigest).toBe(hashUtf8(skillCatalogDigestInput([first, last])));
      const { catalogHash: _catalogHash, ...withoutHash } = catalog;
      expect(catalog.catalogHash).toBe(hashUtf8(capabilityCatalogHashInput(withoutHash)));
      expect(CapabilityCatalogSnapshotV1Schema.parse(catalog)).toEqual(catalog);
      expect(
        host.buildRootCapabilityCatalog({
          projectId: 'project.catalog',
          baseCatalog: ROOT_CATALOG,
        }),
      ).toEqual(catalog);
      expect(canonicalJson(ROOT_CATALOG.skills)).toBe('[]');
    } finally {
      store.close();
    }
  });

  it('fails closed for non-effective and quarantined enabled rows', () => {
    const { store, database } = memoryStore();
    try {
      insertProject(database, 'project.other');
      const host = createHostCatalogProvisioning(store);
      const oldVersion = skill('skill.versioned');
      const newVersion = skill('skill.versioned', { version: '2.0.0' });
      host.registerSkill({ document: oldVersion, projectId: null });
      enable(database, 'project.other', oldVersion);
      host.registerSkill({ document: newVersion, projectId: null });
      expect(() =>
        host.buildRootCapabilityCatalog({
          projectId: 'project.other',
          baseCatalog: ROOT_CATALOG,
        }),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));

      database.prepare('DELETE FROM skill_enablements').run();
      const quarantined = skill('skill.quarantined');
      host.registerSkill({ document: quarantined, projectId: null });
      enable(database, 'project.other', quarantined);
      database
        .prepare(
          `INSERT INTO skill_quarantines (skill_id, skill_version, reason)
           VALUES (?, ?, 'Blocked by test')`,
        )
        .run(quarantined.skillId, quarantined.version);
      expect(() =>
        host.buildRootCapabilityCatalog({
          projectId: 'project.other',
          baseCatalog: ROOT_CATALOG,
        }),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
    } finally {
      store.close();
    }
  });

  it('rejects a Project with more than 500 enabled Skills without truncation', () => {
    const { store, database } = memoryStore();
    try {
      insertProject(database, 'project.too-many');
      const insertSkill = database.prepare(
        `INSERT INTO skills (
           id, version, name, description, content_text, content_hash, provenance, trust,
           project_id, created_at
         ) VALUES (?, '1.0.0', ?, ?, ?, ?, 'installed', 'reviewed', NULL, ?)`,
      );
      const insertEffective = database.prepare(
        `INSERT INTO skill_effective_versions (skill_id, skill_version, changed_at)
         VALUES (?, '1.0.0', ?)`,
      );
      const insertEnablement = database.prepare(
        `INSERT INTO skill_enablements (
           project_id, skill_id, skill_version, enabled, enabled_at
         ) VALUES ('project.too-many', ?, '1.0.0', 1, ?)`,
      );
      database.exec('BEGIN IMMEDIATE');
      try {
        for (let index = 0; index < 501; index += 1) {
          const id = `skill.bulk.${index.toString().padStart(3, '0')}`;
          const content = `Instructions ${index}.`;
          insertSkill.run(id, id, id, content, hashUtf8(content), NOW);
          insertEffective.run(id, NOW);
          insertEnablement.run(id, NOW);
        }
        database.exec('COMMIT');
      } catch (cause) {
        database.exec('ROLLBACK');
        throw cause;
      }

      const host = createHostCatalogProvisioning(store);
      expect(() =>
        host.buildRootCapabilityCatalog({
          projectId: 'project.too-many',
          baseCatalog: ROOT_CATALOG,
        }),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
    } finally {
      store.close();
    }
  });
});
