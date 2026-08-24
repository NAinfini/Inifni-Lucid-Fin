import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, type SkillDocument } from '@lucid-fin/target-contracts';
import { describe, expect, it } from 'vitest';
import {
  registerTargetStoreDatabase,
  unregisterTargetStoreDatabase,
} from '../internal/database-access.js';
import { createTargetStore, openTargetStore, type TargetStore } from '../kernel/store.js';
import { createHostCatalogProvisioning, provisionCanonicalBuiltInSkills } from './index.js';

const NOW = '2026-08-17T00:00:00.000Z';
const HASH = 'a'.repeat(64);

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function fingerprint(entries: readonly unknown[]): string {
  return hash(canonicalJson(entries));
}

function skill(
  id: string,
  content = id,
  provenance: SkillDocument['provenance'] = 'built_in',
  trust: SkillDocument['trust'] = 'trusted',
) {
  return {
    skillId: id,
    name: id,
    description: `Description for ${id}`,
    version: `1.0.0+legacy.${hash(content)}`,
    contentHash: hash(content),
    provenance,
    trust,
    content,
    createdAt: NOW,
  } satisfies SkillDocument;
}

function memoryStore(): { store: TargetStore; database: DatabaseSync } {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(
    readFileSync(new URL('../../../target-contracts/ddl/project-v1.sql', import.meta.url), 'utf8'),
  );
  const store: TargetStore = {
    databasePath: ':memory:',
    schemaFingerprint: {} as TargetStore['schemaFingerprint'],
    security: { defensive: true, extensionLoading: false, foreignKeys: true },
    close() {
      unregisterTargetStoreDatabase(store);
      database.close();
    },
  };
  registerTargetStoreDatabase(store, database);
  return { store, database };
}

function insertProject(database: DatabaseSync, id: string): void {
  database
    .prepare(
      `INSERT INTO projects (
         id, name, lifecycle, schema_revision, revision, content_hash,
         created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
       ) VALUES (?, ?, 'active', 1, 0, ?, 'direct_ui', ?, ?, ?, NULL, NULL)`,
    )
    .run(id, id, HASH, `action.${id}`, NOW, NOW);
}

describe('host legacy Skill registration', () => {
  it('provisions the canonical built-in Skill pack atomically and idempotently', async () => {
    const { store, database } = memoryStore();
    try {
      const first = await provisionCanonicalBuiltInSkills(store);
      expect(first.results).toHaveLength(287);
      expect(first.results.every(({ status }) => status === 'inserted')).toBe(true);
      expect(
        database
          .prepare(
            'SELECT provenance, trust, COUNT(*) AS count FROM skills GROUP BY provenance, trust',
          )
          .all(),
      ).toEqual([
        { provenance: 'built_in', trust: 'trusted', count: 252 },
        { provenance: 'built_in', trust: 'unreviewed', count: 35 },
      ]);
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM skill_effective_versions').get(),
      ).toEqual({ count: 287 });
      expect(database.prepare('SELECT COUNT(*) AS count FROM skill_quarantines').get()).toEqual({
        count: 35,
      });
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM skills WHERE project_id IS NOT NULL').get(),
      ).toEqual({ count: 0 });

      const second = await provisionCanonicalBuiltInSkills(store);
      expect(second.sourceFingerprint).toBe(first.sourceFingerprint);
      expect(second.results.every(({ status }) => status === 'unchanged')).toBe(true);
    } finally {
      store.close();
    }
  });

  it('keeps the canonical built-in Skill pack idempotent across a cold reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-built-in-skills-'));
    const databasePath = join(directory, 'project.sqlite');
    let store: TargetStore | undefined;
    try {
      store = await createTargetStore(databasePath);
      await provisionCanonicalBuiltInSkills(store);
      store.close();

      store = await openTargetStore(databasePath);
      const result = await provisionCanonicalBuiltInSkills(store);
      expect(result.results).toHaveLength(287);
      expect(result.results.every(({ status }) => status === 'unchanged')).toBe(true);
    } finally {
      store?.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects direct Project registration and keeps provisioned Skills ownerless', () => {
    const { store, database } = memoryStore();
    try {
      insertProject(database, 'project.one');
      const host = createHostCatalogProvisioning(store);
      const projectDocument = skill('skill.project', 'project content', 'project');
      expect(() =>
        host.registerSkill({ document: projectDocument, projectId: 'project.one' }),
      ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() => host.registerSkill({ document: projectDocument, projectId: null })).toThrow(
        expect.objectContaining({ code: 'INVALID_REQUEST' }),
      );
      expect(
        database.prepare('SELECT 1 FROM skills WHERE id = ?').get(projectDocument.skillId),
      ).toBeUndefined();

      const document = skill('skill.installed', 'installed content', 'installed', 'unreviewed');
      expect(host.registerSkill({ document, projectId: null })).toEqual({
        status: 'inserted',
        document,
        projectId: null,
      });
      database
        .prepare('DELETE FROM skill_quarantines WHERE skill_id = ? AND skill_version = ?')
        .run(document.skillId, document.version);
      expect(host.registerSkill({ document, projectId: null })).toEqual({
        status: 'unchanged',
        document,
        projectId: null,
      });
      expect(
        database.prepare('SELECT project_id FROM skills WHERE id = ?').get(document.skillId),
      ).toEqual({ project_id: null });
      expect(
        database
          .prepare('SELECT reason FROM skill_quarantines WHERE skill_id = ? AND skill_version = ?')
          .get(document.skillId, document.version),
      ).toEqual({ reason: 'Unreviewed Skill content is not runtime-eligible' });
      expect(() => host.registerSkill({ document, projectId: 'project.one' })).toThrow(
        expect.objectContaining({ code: 'INVALID_REQUEST' }),
      );
    } finally {
      store.close();
    }
  });

  it('registers a fingerprinted batch atomically and rolls every row back on conflict', () => {
    const { store, database } = memoryStore();
    try {
      const host = createHostCatalogProvisioning(store);
      const conflict = skill('skill.conflict');
      host.registerSkill({ document: conflict, projectId: null });
      const first = skill('skill.first');
      const conflictingEntries = [
        { document: first, projectId: null },
        { document: { ...conflict, name: 'Changed' }, projectId: null },
      ];
      expect(() =>
        host.registerSkillBatch({
          sourceFingerprint: fingerprint(conflictingEntries),
          entries: conflictingEntries,
        }),
      ).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(
        database.prepare('SELECT 1 FROM skills WHERE id = ?').get(first.skillId),
      ).toBeUndefined();

      const entries = [{ document: first, projectId: null }];
      expect(() =>
        host.registerSkillBatch({
          sourceFingerprint: '0'.repeat(64),
          entries,
        }),
      ).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      const result = host.registerSkillBatch({
        sourceFingerprint: fingerprint(entries),
        entries,
      });
      expect(result.results).toEqual([{ status: 'inserted', document: first, projectId: null }]);
      expect(
        host.registerSkillBatch({
          sourceFingerprint: fingerprint(entries),
          entries,
        }).results,
      ).toEqual([{ status: 'unchanged', document: first, projectId: null }]);
    } finally {
      store.close();
    }
  });

  it('uses explicit effective versions while quarantining all unreviewed content', () => {
    const { store, database } = memoryStore();
    try {
      insertProject(database, 'project.one');
      const host = createHostCatalogProvisioning(store);
      const base = skill('skill.shared', 'trusted base');
      const override = skill('skill.shared', 'user override', 'installed', 'unreviewed');
      host.registerSkill({ document: base, projectId: null });
      host.registerSkill({ document: override, projectId: null });
      const enable = database.prepare(
        `INSERT INTO skill_enablements (
           project_id, skill_id, skill_version, enabled, enabled_at
         ) VALUES ('project.one', 'skill.shared', ?, 1, ?)`,
      );
      expect(() => enable.run(base.version, NOW)).toThrow();
      expect(() => enable.run(override.version, NOW)).toThrow();

      const reviewed = skill('skill.reviewed', 'reviewed install', 'installed', 'trusted');
      host.registerSkill({ document: reviewed, projectId: null });
      database
        .prepare(
          `INSERT INTO skill_enablements (
             project_id, skill_id, skill_version, enabled, enabled_at
           ) VALUES ('project.one', 'skill.reviewed', ?, 1, ?)`,
        )
        .run(reviewed.version, NOW);

      const quarantined = skill('skill.system', 'old routing', 'built_in', 'unreviewed');
      host.registerSkill({ document: quarantined, projectId: null });
      expect(() =>
        database
          .prepare(
            `INSERT INTO skill_enablements (
               project_id, skill_id, skill_version, enabled, enabled_at
             ) VALUES ('project.one', 'skill.system', ?, 1, ?)`,
          )
          .run(quarantined.version, NOW),
      ).toThrow();
    } finally {
      store.close();
    }
  });

  it('rolls one registration back when effective or quarantine persistence fails', () => {
    const { store, database } = memoryStore();
    try {
      database.exec(`
        CREATE TRIGGER fail_skill_quarantine
        BEFORE INSERT ON skill_quarantines
        BEGIN
          SELECT RAISE(ABORT, 'injected quarantine failure');
        END;
      `);
      const host = createHostCatalogProvisioning(store);
      const document = skill('skill.rollback', 'installed content', 'installed', 'unreviewed');
      expect(() => host.registerSkill({ document, projectId: null })).toThrow(
        'injected quarantine failure',
      );
      expect(
        database.prepare('SELECT 1 FROM skills WHERE id = ?').get(document.skillId),
      ).toBeUndefined();
      expect(
        database
          .prepare('SELECT 1 FROM skill_effective_versions WHERE skill_id = ?')
          .get(document.skillId),
      ).toBeUndefined();
    } finally {
      store.close();
    }
  });
});
