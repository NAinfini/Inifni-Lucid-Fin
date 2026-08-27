import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  pluginPackageManifestHashInput,
  type PluginPackageManifestV1,
} from '@lucid-fin/target-contracts';
import { describe, expect, it } from 'vitest';
import {
  registerTargetStoreDatabase,
  unregisterTargetStoreDatabase,
} from '../internal/database-access.js';
import { hashUtf8 } from '../internal/hashes.js';
import type { TargetStore } from '../kernel/store.js';
import { createProjectCapabilitiesReadModel } from '../read-models/project-capabilities.js';
import { createPluginPackagesAuthority, type TrustedPluginCatalogPort } from './plugins.js';

const NOW = '2026-08-24T12:00:00.000Z';

function memoryStore(): { store: TargetStore; database: DatabaseSync } {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(
    readFileSync(new URL('../../../target-contracts/ddl/project-v1.sql', import.meta.url), 'utf8'),
  );
  let open = true;
  const store: TargetStore = {
    databasePath: ':memory:',
    schemaFingerprint: {} as TargetStore['schemaFingerprint'],
    security: { defensive: true, extensionLoading: false, foreignKeys: true },
    close() {
      if (!open) return;
      open = false;
      unregisterTargetStoreDatabase(store);
      database.close();
    },
  };
  registerTargetStoreDatabase(store, database);
  return { store, database };
}

function manifest(): PluginPackageManifestV1 {
  const value = {
    packageId: 'plugin.storyboard',
    version: '1.0.0',
    name: 'Storyboard review',
    description: 'Trusted storyboard review Skills.',
    skills: [
      {
        skillId: 'skill.storyboard.review',
        name: 'Storyboard review',
        description: 'Review storyboard continuity.',
        version: '1.0.0',
        content: 'Review storyboard continuity.',
        contentHash: hashUtf8('Review storyboard continuity.'),
        provenance: 'installed' as const,
        trust: 'trusted' as const,
        createdAt: NOW,
      },
    ],
  };
  return {
    ...value,
    manifestHash: hashUtf8(pluginPackageManifestHashInput(value)),
  };
}

function catalog(value: PluginPackageManifestV1): TrustedPluginCatalogPort {
  return Object.freeze({ list: () => Object.freeze([value]) });
}

function context() {
  return {
    actor: 'user' as const,
    causation: { kind: 'direct_ui' as const, actionId: 'action.plugin.settings' },
    correlationId: 'correlation.plugin.settings',
  };
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

describe('trusted Plugin package authority', () => {
  it('fails closed when the host catalog lies about a manifest hash', () => {
    const { store, database } = memoryStore();
    try {
      const packageManifest = { ...manifest(), manifestHash: 'f'.repeat(64) };
      const plugins = createPluginPackagesAuthority(
        store,
        { now: () => NOW },
        catalog(packageManifest),
      );
      expect(() =>
        plugins.query({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.plugin.query.invalid-catalog',
          method: 'plugin.query',
          input: {},
        }),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
      expect(database.prepare('SELECT COUNT(*) AS count FROM plugin_packages').get()).toEqual({
        count: 0,
      });
    } finally {
      store.close();
    }
  });

  it('installs only host-injected declarative manifests without auto-enabling members', () => {
    const { store, database } = memoryStore();
    try {
      const packageManifest = manifest();
      const plugins = createPluginPackagesAuthority(
        store,
        { now: () => NOW },
        catalog(packageManifest),
      );

      expect(
        plugins.query({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.plugin.query.1',
          method: 'plugin.query',
          input: {},
        }).result,
      ).toEqual({
        packages: [{ manifest: packageManifest, installation: null, auditEvents: [] }],
      });
      for (const table of [
        'skills',
        'plugin_packages',
        'plugin_package_skills',
        'plugin_installations',
        'plugin_audit_events',
      ]) {
        expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({
          count: 0,
        });
      }

      const installed = plugins.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.plugin.install.1',
          method: 'plugin.apply',
          input: {
            action: 'install',
            packageId: packageManifest.packageId,
            version: packageManifest.version,
            manifestHash: packageManifest.manifestHash,
            expectedInstallationRevision: null,
          },
        },
        context(),
      );
      expect(installed.result).toMatchObject({
        installation: {
          packageId: packageManifest.packageId,
          version: packageManifest.version,
          manifestHash: packageManifest.manifestHash,
          state: 'installed',
          revision: 0,
          installedAt: NOW,
          removedAt: null,
        },
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM skills').get()).toEqual({ count: 1 });
      expect(database.prepare('SELECT COUNT(*) AS count FROM plugin_packages').get()).toEqual({
        count: 1,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM plugin_package_skills').get()).toEqual(
        {
          count: 1,
        },
      );
      expect(database.prepare('SELECT COUNT(*) AS count FROM skill_enablements').get()).toEqual({
        count: 0,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM plugin_audit_events').get()).toEqual({
        count: 1,
      });
      insertProject(database, 'project.plugin.index');
      expect(
        createProjectCapabilitiesReadModel(store)
          .get('project.plugin.index')
          .skills.find((skill) => skill.id === packageManifest.skills[0]!.skillId)?.pluginPackage,
      ).toEqual({
        packageId: packageManifest.packageId,
        version: packageManifest.version,
        manifestHash: packageManifest.manifestHash,
      });

      expect(() =>
        plugins.apply(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.plugin.install.unauthorized',
            method: 'plugin.apply',
            input: {
              action: 'install',
              packageId: packageManifest.packageId,
              version: packageManifest.version,
              manifestHash: packageManifest.manifestHash,
              expectedInstallationRevision: 0,
            },
          },
          { ...context(), actor: 'commander' },
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      store.close();
    }
  });

  it('rolls the package, member Skills, installation, and audit record back as one transaction', () => {
    const { store, database } = memoryStore();
    try {
      const packageManifest = manifest();
      const plugins = createPluginPackagesAuthority(
        store,
        { now: () => NOW },
        catalog(packageManifest),
      );
      database.exec(`
        CREATE TRIGGER fail_plugin_audit_insert
        BEFORE INSERT ON plugin_audit_events
        BEGIN
          SELECT RAISE(ABORT, 'injected plugin audit failure');
        END;
      `);
      expect(() =>
        plugins.apply(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.plugin.install.rollback',
            method: 'plugin.apply',
            input: {
              action: 'install',
              packageId: packageManifest.packageId,
              version: packageManifest.version,
              manifestHash: packageManifest.manifestHash,
              expectedInstallationRevision: null,
            },
          },
          context(),
        ),
      ).toThrow('injected plugin audit failure');
      for (const table of [
        'skills',
        'plugin_packages',
        'plugin_package_skills',
        'plugin_installations',
        'plugin_audit_events',
      ]) {
        expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({
          count: 0,
        });
      }
    } finally {
      store.close();
    }
  });

  it('uses installation CAS, blocks removal while a member is enabled, and retains an audit chain', () => {
    const { store, database } = memoryStore();
    try {
      const packageManifest = manifest();
      const plugins = createPluginPackagesAuthority(
        store,
        { now: () => NOW },
        catalog(packageManifest),
      );
      plugins.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.plugin.install.1',
          method: 'plugin.apply',
          input: {
            action: 'install',
            packageId: packageManifest.packageId,
            version: packageManifest.version,
            manifestHash: packageManifest.manifestHash,
            expectedInstallationRevision: null,
          },
        },
        context(),
      );
      insertProject(database, 'project.plugin');
      database
        .prepare(
          `INSERT INTO skill_enablements (
             project_id, skill_id, skill_version, enabled, enabled_at
           ) VALUES (?, ?, ?, 1, ?)`,
        )
        .run(
          'project.plugin',
          packageManifest.skills[0]!.skillId,
          packageManifest.skills[0]!.version,
          NOW,
        );

      expect(() =>
        plugins.apply(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.plugin.remove.blocked',
            method: 'plugin.apply',
            input: {
              action: 'remove',
              packageId: packageManifest.packageId,
              version: packageManifest.version,
              manifestHash: packageManifest.manifestHash,
              expectedInstallationRevision: 0,
            },
          },
          context(),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        plugins.apply(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.plugin.remove.stale',
            method: 'plugin.apply',
            input: {
              action: 'remove',
              packageId: packageManifest.packageId,
              version: packageManifest.version,
              manifestHash: packageManifest.manifestHash,
              expectedInstallationRevision: 1,
            },
          },
          context(),
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(database.prepare('SELECT COUNT(*) AS count FROM plugin_audit_events').get()).toEqual({
        count: 1,
      });

      database.prepare('UPDATE skill_enablements SET enabled = 0').run();
      const removed = plugins.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.plugin.remove.1',
          method: 'plugin.apply',
          input: {
            action: 'remove',
            packageId: packageManifest.packageId,
            version: packageManifest.version,
            manifestHash: packageManifest.manifestHash,
            expectedInstallationRevision: 0,
          },
        },
        context(),
      );
      expect(removed.result.installation).toMatchObject({
        state: 'removed',
        revision: 1,
        removedAt: NOW,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM skills').get()).toEqual({ count: 1 });
      expect(database.prepare('SELECT COUNT(*) AS count FROM plugin_package_skills').get()).toEqual(
        {
          count: 1,
        },
      );
      expect(
        createProjectCapabilitiesReadModel(store)
          .get('project.plugin')
          .skills.some((skill) => skill.id === packageManifest.skills[0]!.skillId),
      ).toBe(false);
      const events = database
        .prepare(
          `SELECT sequence, action, previous_event_hash, event_hash
           FROM plugin_audit_events ORDER BY sequence`,
        )
        .all() as Array<{
        sequence: number;
        action: string;
        previous_event_hash: string | null;
        event_hash: string;
      }>;
      expect(events).toEqual([
        expect.objectContaining({ sequence: 1, action: 'installed', previous_event_hash: null }),
        expect.objectContaining({
          sequence: 2,
          action: 'removed',
          previous_event_hash: events[0]!.event_hash,
        }),
      ]);
      expect(() => database.prepare('UPDATE skill_enablements SET enabled = 1').run()).toThrow(
        'Skill is not eligible for this Project',
      );
      expect(
        plugins.query({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.plugin.query.removed',
          method: 'plugin.query',
          input: {},
        }).result.packages[0]!.auditEvents,
      ).toHaveLength(2);
      database
        .prepare('UPDATE plugin_audit_events SET event_hash = ? WHERE sequence = 2')
        .run('f'.repeat(64));
      expect(() =>
        plugins.query({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.plugin.query.tampered',
          method: 'plugin.query',
          input: {},
        }),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
    } finally {
      store.close();
    }
  });
});
