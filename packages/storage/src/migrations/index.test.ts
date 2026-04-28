import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { CURRENT_SCHEMA_VERSION, runSqliteMigrations, type SqliteMigration } from './index.js';

describe('sqlite migrations', () => {
  let base: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-migrations-'));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('creates the latest schema and records the current version for fresh databases', () => {
    const dbPath = path.join(base, 'fresh.db');
    const db = new Database(dbPath);

    runSqliteMigrations(db, dbPath);

    const version = db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as {
      version: number;
    };
    const assetsTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assets'")
      .get();

    expect(version.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(assetsTable).toBeTruthy();
    db.close();
  });

  it('upgrades legacy versioned databases and records the current version', () => {
    const dbPath = path.join(base, 'legacy.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO schema_version (id, version, updated_at) VALUES (1, 1, 100);
      CREATE TABLE canvases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        nodes TEXT NOT NULL DEFAULT '[]',
        edges TEXT NOT NULL DEFAULT '[]',
        viewport TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
        notes TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE characters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT,
        description TEXT,
        appearance TEXT,
        personality TEXT,
        costumes TEXT,
        tags TEXT,
        age INTEGER,
        gender TEXT,
        voice TEXT,
        reference_images TEXT DEFAULT '[]',
        loadouts TEXT DEFAULT '[]',
        default_loadout_id TEXT DEFAULT '',
        folder_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE equipment (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT,
        subtype TEXT,
        description TEXT DEFAULT '',
        function_desc TEXT,
        tags TEXT DEFAULT '[]',
        reference_images TEXT DEFAULT '[]',
        folder_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE assets (
        hash TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        format TEXT NOT NULL,
        tags TEXT,
        prompt TEXT,
        provider TEXT,
        folder_id TEXT,
        created_at INTEGER NOT NULL,
        file_size INTEGER,
        width INTEGER,
        height INTEGER,
        duration REAL
      );
    `);

    runSqliteMigrations(db, dbPath);

    const version = db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as {
      version: number;
    };

    expect(version.version).toBe(CURRENT_SCHEMA_VERSION);
    expect(fs.existsSync(`${dbPath}.bak.2`)).toBe(true);
    expect(fs.existsSync(`${dbPath}.bak.3`)).toBe(true);

    const charCols = (db.pragma('table_info(characters)') as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(charCols).toContain('face');
    expect(charCols).toContain('vocal_traits');
    db.close();
  });

  it('restores the migration backup and fails when a migration throws', () => {
    const dbPath = path.join(base, 'broken.db');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO schema_version (id, version, updated_at) VALUES (1, 1, 100);
      CREATE TABLE stable_marker (id TEXT PRIMARY KEY);
      INSERT INTO stable_marker (id) VALUES ('kept');
    `);
    const brokenMigrations: SqliteMigration[] = [
      {
        version: 2,
        name: 'broken migration',
        up(database) {
          database.exec('CREATE TABLE should_not_survive (id TEXT PRIMARY KEY)');
          throw new Error('migration exploded');
        },
      },
    ];

    expect(() => runSqliteMigrations(db, dbPath, brokenMigrations)).toThrow(
      'SQLite migration 2 failed',
    );

    const restored = new Database(dbPath, { readonly: true });
    expect(restored.prepare("SELECT id FROM stable_marker WHERE id = 'kept'").get()).toBeTruthy();
    expect(
      restored
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_not_survive'",
        )
        .get(),
    ).toBeUndefined();
    const version = restored.prepare('SELECT version FROM schema_version WHERE id = 1').get() as {
      version: number;
    };
    expect(version.version).toBe(1);
    restored.close();
  });
});
