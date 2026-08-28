import { DatabaseSync } from 'node:sqlite';
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openConfiguredDatabase } from './database.js';
import { createStore, openOrCreateStore, openStore } from './index.js';

const disposablePaths: string[] = [];

async function disposableDatabase(name = 'project.sqlite'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-store-'));
  disposablePaths.push(directory);
  return join(directory, name);
}

afterEach(async () => {
  await Promise.all(
    disposablePaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('store lifecycle', () => {
  it('opens or creates one canonical store without replacing an existing database', async () => {
    const databasePath = await disposableDatabase();
    const fresh = await openOrCreateStore(databasePath);
    expect(fresh.created).toBe(true);
    const fingerprint = fresh.store.schemaFingerprint;
    fresh.store.close();

    const existing = await openOrCreateStore(databasePath);
    expect(existing.created).toBe(false);
    expect(existing.store.schemaFingerprint).toEqual(fingerprint);
    existing.store.close();
  });

  it('creates a fully validated database by same-directory atomic rename and reopens it', async () => {
    const databasePath = await disposableDatabase();
    const created = await createStore(databasePath);
    const createdFingerprint = created.schemaFingerprint;
    created.close();

    await expect(access(databasePath)).resolves.toBeUndefined();
    expect(createdFingerprint.userVersion).toBe(1);
    const schemaBindings = JSON.parse(
      await readFile(
        new URL('../../../contracts/generated/schema-bindings.v1.json', import.meta.url),
        'utf8',
      ),
    ) as { bindings: unknown[] };
    expect(createdFingerprint.schemaBindings.count).toBe(schemaBindings.bindings.length);
    expect(createdFingerprint.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(createdFingerprint.sqliteSchema)).toContain('project_search_fts');
    expect(JSON.stringify(createdFingerprint.tableInventory)).toContain('fts5');
    expect(JSON.stringify(createdFingerprint.tableInventory)).toContain('"strict":true');
    expect(JSON.stringify(createdFingerprint.indexInventory)).toContain('sqlite_autoindex_');
    expect(JSON.stringify(createdFingerprint.indexInventory)).toContain(
      'idx_run_events_run_surface',
    );
    expect(createdFingerprint.foreignKeyInventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'dispatch_operations',
          from: 'run_id',
          referencedTable: 'runs',
          to: 'id',
        }),
        expect.objectContaining({
          table: 'run_resource_entries',
          from: 'dispatch_operation_id',
          referencedTable: 'dispatch_operations',
          to: 'id',
        }),
        expect.objectContaining({
          table: 'run_resource_entries',
          from: 'reservation_entry_id',
          referencedTable: 'run_resource_entries',
          to: 'id',
        }),
      ]),
    );

    const directoryEntries = await readdir(dirname(databasePath));
    expect(directoryEntries).toEqual(['project.sqlite']);

    const reopened = await openStore(databasePath);
    expect(reopened.schemaFingerprint).toEqual(createdFingerprint);
    expect(reopened.security).toEqual({
      defensive: true,
      extensionLoading: false,
      foreignKeys: true,
    });
    reopened.close();
  });

  it('strictly enables foreign keys and defensive mode while prohibiting extensions', () => {
    const database = openConfiguredDatabase(':memory:', false);
    try {
      expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
      database.exec('PRAGMA writable_schema = ON');
      expect(database.prepare('PRAGMA writable_schema').get()).toEqual({ writable_schema: 0 });
      expect(() => database.loadExtension('not-an-extension')).toThrow(/not allowed/i);
    } finally {
      database.close();
    }
  });

  it('rejects unknown sqlite_schema drift before returning a writable store', async () => {
    const databasePath = await disposableDatabase();
    const store = await createStore(databasePath);
    store.close();

    const db = new DatabaseSync(databasePath);
    db.exec('CREATE TABLE unauthorized_drift (id TEXT PRIMARY KEY) STRICT;');
    db.close();

    await expect(openStore(databasePath)).rejects.toMatchObject({ code: 'SCHEMA_DRIFT' });
  });

  it('rejects persisted foreign-key violations', async () => {
    const databasePath = await disposableDatabase();
    const store = await createStore(databasePath);
    store.close();

    const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: false });
    db.prepare(
      `INSERT INTO project_settings (
         project_id, revision, content_hash, default_provider_profile_id,
         format_policy_v1_json, permission_mode, budget_v1_json, updated_at
       ) VALUES (?, 0, ?, NULL, '{}', 'read_only', '{}', ?)`,
    ).run('missing-project', 'a'.repeat(64), '2026-08-15T00:00:00.000Z');
    db.close();

    await expect(openStore(databasePath)).rejects.toMatchObject({
      code: 'FOREIGN_KEY_CHECK_FAILED',
    });
  });

  it('rejects a database that fails integrity validation', async () => {
    const databasePath = await disposableDatabase();
    const store = await createStore(databasePath);
    store.close();

    const bytes = await readFile(databasePath);
    const damaged = Buffer.from(bytes);
    damaged.fill(0xff, 100, Math.min(512, damaged.length));
    await writeFile(databasePath, damaged);

    await expect(openStore(databasePath)).rejects.toMatchObject({
      code: 'INTEGRITY_CHECK_FAILED',
    });
  });
});
