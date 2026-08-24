import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CanonicalSchemaError, getCanonicalSchemaDifferences } from './schema-validation.js';
import { SCHEMA_SQL } from './schema-sql.js';
import { SqliteIndex } from './sqlite-index.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

function makeTempDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-db-'));
}

const OBSERVED_LEGACY_COMMANDER_DIFFERENCES = [
  'missing column on table "commander_events" "private_payload"',
  'CHECK clauses on table "commander_events" differ',
  'missing column on table "commander_runs" "display_name"',
  'missing column on table "commander_runs" "objective"',
  'missing column on table "commander_runs" "parent_run_id"',
  'missing column on table "commander_runs" "retry_of_run_id"',
  'missing column on table "commander_runs" "work_type"',
  'foreign keys on table "commander_runs" differ',
  'CHECK clauses on table "commander_runs" differ',
  'missing index "idx_commander_runs_parent"',
  'missing index "idx_commander_runs_retry"',
  'index "idx_commander_run_canvases_active_canvas" differs',
  'index "idx_commander_runs_active_session" differs',
];

function observedLegacyCommanderSchema(): string {
  return SCHEMA_SQL.replace(
    '  private_payload BLOB CHECK (private_payload IS NULL OR length(private_payload) > 0),\n',
    '',
  )
    .replace(
      "  work_type    TEXT NOT NULL DEFAULT 'agent' CHECK (work_type IN ('agent', 'subagent', 'tool_program')),\n",
      '',
    )
    .replace('  parent_run_id TEXT REFERENCES commander_runs(id) ON DELETE CASCADE,\n', '')
    .replace('  retry_of_run_id TEXT REFERENCES commander_runs(id) ON DELETE SET NULL,\n', '')
    .replace('  display_name TEXT,\n', '')
    .replace('  objective    TEXT,\n', '')
    .replace(
      "  status       TEXT NOT NULL CHECK (status IN ('accepted', 'running', 'paused', 'completed', 'failed', 'cancelled', 'blocked', 'max_steps')),\n",
      "  status       TEXT NOT NULL CHECK (status IN ('accepted', 'running', 'completed', 'failed', 'cancelled', 'blocked', 'max_steps')),\n",
    )
    .replace(
      "  WHERE parent_run_id IS NULL AND status IN ('accepted', 'running', 'paused');",
      "  WHERE status IN ('accepted', 'running', 'paused');",
    )
    .replace(
      'CREATE INDEX IF NOT EXISTS idx_commander_runs_parent\n  ON commander_runs(parent_run_id, accepted_at, id);\n\n',
      '',
    )
    .replace(
      'CREATE INDEX IF NOT EXISTS idx_commander_runs_retry\n  ON commander_runs(retry_of_run_id);\n\n',
      '',
    )
    .replace(
      'CREATE INDEX IF NOT EXISTS idx_commander_run_canvases_active_canvas',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_commander_run_canvases_active_canvas',
    );
}

describe('SqliteIndex', () => {
  let index: SqliteIndex;
  let directory: string;
  let dbPath: string;

  beforeEach(() => {
    directory = makeTempDirectory();
    dbPath = path.join(directory, 'test.db');
    index = new SqliteIndex(dbPath);
  });

  afterEach(() => {
    index.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('boots the database in WAL mode and exposes the canonical repository bundle', () => {
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(index.rawDb.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(index.repos).toMatchObject({
      assets: expect.anything(),
      canvases: expect.anything(),
      taskLists: expect.anything(),
      promptAssemblies: expect.anything(),
    });
  });

  it('creates a fresh canonical database without migration metadata', () => {
    expect(
      index.rawDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        )
        .get(),
    ).toBeUndefined();
  });

  it('opens an existing canonical database', () => {
    index.close();
    index = new SqliteIndex(dbPath);

    expect(index.repos.taskLists).toBeDefined();
  });

  it('upgrades only the canonical schema missing commander event private payload', () => {
    index.close();
    fs.rmSync(dbPath, { force: true });
    const legacySchema = SCHEMA_SQL.replace(
      '  private_payload BLOB CHECK (private_payload IS NULL OR length(private_payload) > 0),\n',
      '',
    );
    expect(legacySchema).not.toBe(SCHEMA_SQL);
    const payload = '{"kind":"run_start","content":"unchanged"}';
    const payloadHash = createHash('sha256').update(payload).digest('hex');
    const legacy = new Database(dbPath);
    legacy.exec(legacySchema);
    legacy
      .prepare(
        `INSERT INTO commander_sessions (id, title, messages, created_at, updated_at)
         VALUES ('legacy-session', '', '[]', 1, 1)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO commander_events
           (session_id, run_id, seq, kind, step, emitted_at, payload)
         VALUES ('legacy-session', 'legacy-run', 0, 'run_start', 0, 1, ?)`,
      )
      .run(payload);
    legacy.close();

    index = new SqliteIndex(dbPath);
    const rows = index.rawDb
      .prepare('SELECT payload, private_payload FROM commander_events')
      .all() as Array<{ payload: string; private_payload: Buffer | null }>;
    expect(rows).toEqual([{ payload, private_payload: null }]);
    expect(createHash('sha256').update(rows[0].payload).digest('hex')).toBe(payloadHash);
    expect(
      (index.rawDb.pragma('table_info(commander_events)') as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    ).toContain('private_payload');

    index.close();
    index = new SqliteIndex(dbPath);
    expect(index.rawDb.prepare('SELECT COUNT(*) AS count FROM commander_events').get()).toEqual({
      count: 1,
    });
  });

  it('transactionally upgrades the observed legacy Commander schema without changing stored data', () => {
    index.close();
    fs.rmSync(dbPath, { force: true });
    const legacy = new Database(dbPath);
    legacy.exec(observedLegacyCommanderSchema());
    expect(getCanonicalSchemaDifferences(legacy)).toEqual(OBSERVED_LEGACY_COMMANDER_DIFFERENCES);

    const payload = '{"kind":"tool_result","content":"逐字保留 🐟"}';
    const payloadHex = Buffer.from(payload, 'utf8').toString('hex').toUpperCase();
    legacy
      .prepare(
        `INSERT INTO commander_sessions (id, default_canvas_id, title, messages, created_at, updated_at)
         VALUES ('legacy-session', 'canvas-1', 'Legacy', '[]', 1, 2)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO commander_runs
           (id, session_id, default_canvas_id, intent, status, accepted_at, started_at,
            completed_at, last_seq, error_text)
         VALUES ('legacy-run', 'legacy-session', 'canvas-1', 'Keep every byte', 'running',
                 3, 4, NULL, 7, NULL)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO commander_run_canvases (run_id, canvas_id, ordinal, released_at)
         VALUES ('legacy-run', 'canvas-1', 0, NULL)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO asset_contents
           (hash, type, format, prompt, provider, created_at, file_size)
         VALUES ('asset-hash', 'image', 'png', '逐字附件', 'legacy-provider', 6, 123)`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO commander_run_attachments
           (run_id, ordinal, content_hash, role, original_name, mime_type)
         VALUES ('legacy-run', 0, 'asset-hash', 'reference', '参考图.png', 'image/png')`,
      )
      .run();
    legacy
      .prepare(
        `INSERT INTO commander_events
           (session_id, run_id, seq, kind, step, emitted_at, payload)
         VALUES ('legacy-session', 'legacy-run', 7, 'tool_result', 3, 5, ?)`,
      )
      .run(payload);
    legacy.close();

    index = new SqliteIndex(dbPath);
    expect(
      index.rawDb.prepare('SELECT hex(payload) AS payload_hex FROM commander_events').get(),
    ).toEqual({ payload_hex: payloadHex });
    expect(
      index.rawDb
        .prepare(
          `SELECT id, session_id, default_canvas_id, intent, status, accepted_at, started_at,
                  completed_at, last_seq, error_text, work_type, parent_run_id, retry_of_run_id,
                  display_name, objective
             FROM commander_runs`,
        )
        .get(),
    ).toEqual({
      id: 'legacy-run',
      session_id: 'legacy-session',
      default_canvas_id: 'canvas-1',
      intent: 'Keep every byte',
      status: 'running',
      accepted_at: 3,
      started_at: 4,
      completed_at: null,
      last_seq: 7,
      error_text: null,
      work_type: 'agent',
      parent_run_id: null,
      retry_of_run_id: null,
      display_name: null,
      objective: null,
    });
    expect(index.rawDb.prepare('SELECT * FROM commander_run_canvases').get()).toEqual({
      run_id: 'legacy-run',
      canvas_id: 'canvas-1',
      ordinal: 0,
      released_at: null,
    });
    expect(index.rawDb.prepare('SELECT * FROM commander_run_attachments').get()).toEqual({
      run_id: 'legacy-run',
      ordinal: 0,
      content_hash: 'asset-hash',
      role: 'reference',
      original_name: '参考图.png',
      mime_type: 'image/png',
    });
    expect(index.rawDb.prepare('SELECT * FROM commander_events').get()).toEqual({
      session_id: 'legacy-session',
      run_id: 'legacy-run',
      seq: 7,
      kind: 'tool_result',
      step: 3,
      emitted_at: 5,
      private_payload: null,
      payload,
    });
    expect(index.rawDb.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(index.rawDb.pragma('foreign_key_check')).toEqual([]);
    expect(getCanonicalSchemaDifferences(index.rawDb)).toEqual([]);

    index.rawDb
      .prepare("UPDATE commander_runs SET status = 'paused' WHERE id = 'legacy-run'")
      .run();

    index.close();
    index = new SqliteIndex(dbPath);
    expect(
      index.rawDb.prepare('SELECT COUNT(*) AS count, status FROM commander_runs').get(),
    ).toEqual({ count: 1, status: 'paused' });
    expect(
      index.rawDb.prepare('SELECT hex(payload) AS payload_hex FROM commander_events').get(),
    ).toEqual({ payload_hex: payloadHex });
  });

  it('does not upgrade a database with any additional schema drift', () => {
    index.close();
    fs.rmSync(dbPath, { force: true });
    const drifted = new Database(dbPath);
    drifted.exec(observedLegacyCommanderSchema());
    drifted.exec('CREATE TABLE legacy_probe (id TEXT PRIMARY KEY)');
    drifted.close();

    expect(() => new SqliteIndex(dbPath)).toThrow(CanonicalSchemaError);

    const verify = new Database(dbPath);
    expect(
      (verify.pragma('table_info(commander_events)') as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    ).not.toContain('private_payload');
    expect(
      (verify.pragma('table_info(commander_runs)') as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    ).not.toContain('work_type');
    verify.exec('DROP TABLE legacy_probe');
    verify.close();
    index = new SqliteIndex(dbPath);
  });

  it('rolls back the legacy Commander upgrade when stored foreign keys are invalid', () => {
    index.close();
    fs.rmSync(dbPath, { force: true });
    const legacy = new Database(dbPath);
    legacy.exec(observedLegacyCommanderSchema());
    legacy.pragma('foreign_keys = OFF');
    legacy
      .prepare(
        `INSERT INTO commander_run_canvases (run_id, canvas_id, ordinal, released_at)
         VALUES ('missing-run', 'canvas-1', 0, NULL)`,
      )
      .run();
    legacy.close();

    expect(() => new SqliteIndex(dbPath)).toThrow('SQLite foreign key check failed');

    const verify = new Database(dbPath);
    expect(
      (verify.pragma('table_info(commander_events)') as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    ).not.toContain('private_payload');
    expect(
      (verify.pragma('table_info(commander_runs)') as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    ).not.toContain('work_type');
    expect(
      verify
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_commander_run_canvases_active_canvas'",
        )
        .get(),
    ).toMatchObject({ sql: expect.stringContaining('CREATE UNIQUE INDEX') });
    verify.exec("DELETE FROM commander_run_canvases WHERE run_id = 'missing-run'");
    verify.close();

    index = new SqliteIndex(dbPath);
    expect(getCanonicalSchemaDifferences(index.rawDb)).toEqual([]);
  });

  it('rejects a partial schema before bootstrap DDL can mutate it', () => {
    index.close();
    fs.rmSync(dbPath, { force: true });
    const partial = new Database(dbPath);
    partial.exec('CREATE TABLE legacy_probe (id TEXT PRIMARY KEY)');
    partial.close();

    expect(() => new SqliteIndex(dbPath)).toThrow(CanonicalSchemaError);

    const verify = new Database(dbPath, { readonly: true });
    expect(
      verify
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'asset_contents'")
        .get(),
    ).toBeUndefined();
    verify.close();

    const cleanup = new Database(dbPath);
    cleanup.exec('DROP TABLE legacy_probe');
    cleanup.close();
    index = new SqliteIndex(dbPath);
  });

  it('rejects an extra table without changing the existing canonical schema', () => {
    index.close();
    const extra = new Database(dbPath);
    extra.exec('CREATE TABLE legacy_probe (id TEXT PRIMARY KEY)');
    extra.close();

    expect(() => new SqliteIndex(dbPath)).toThrow(CanonicalSchemaError);

    const verify = new Database(dbPath, { readonly: true });
    expect(
      verify
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_probe'")
        .get(),
    ).toEqual({ name: 'legacy_probe' });
    expect(
      verify
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'asset_contents'")
        .get(),
    ).toEqual({ name: 'asset_contents' });
    verify.close();

    const cleanup = new Database(dbPath);
    cleanup.exec('DROP TABLE legacy_probe');
    cleanup.close();
    index = new SqliteIndex(dbPath);
  });

  it('indexes asset tags and prompts in FTS5', () => {
    index.repos.assets.insert({
      hash: 'asset-sunset',
      type: 'image',
      format: 'png',
      originalName: 'sunset.png',
      fileSize: 100,
      tags: ['sunset'],
      prompt: 'golden sunset over ocean',
      createdAt: 1,
    });
    index.repos.assets.insert({
      hash: 'asset-forest',
      type: 'image',
      format: 'png',
      originalName: 'forest.png',
      fileSize: 100,
      tags: ['forest'],
      prompt: 'dark forest at night',
      createdAt: 2,
    });

    expect(index.repos.assets.search('sunset').rows.map(({ hash }) => hash)).toEqual([
      'asset-sunset',
    ]);
  });

  it('creates Commander session and snapshot ledgers with their durable columns', () => {
    const tableColumns = (table: string) =>
      (index.rawDb.pragma(`table_info(${table})`) as Array<{ name: string }>).map(
        ({ name }) => name,
      );
    expect(tableColumns('commander_sessions')).toEqual(
      expect.arrayContaining([
        'id',
        'default_canvas_id',
        'title',
        'messages',
        'created_at',
        'updated_at',
      ]),
    );
    expect(tableColumns('commander_runs')).toEqual(
      expect.arrayContaining([
        'id',
        'session_id',
        'default_canvas_id',
        'work_type',
        'parent_run_id',
        'retry_of_run_id',
        'display_name',
        'objective',
        'status',
        'last_seq',
      ]),
    );
    expect(tableColumns('commander_events')).toContain('private_payload');
    expect(tableColumns('commander_run_canvases')).toEqual([
      'run_id',
      'canvas_id',
      'ordinal',
      'released_at',
    ]);
    expect(tableColumns('canvases')).toContain('archived_at');
    expect(tableColumns('snapshots')).toEqual(
      expect.arrayContaining([
        'id',
        'session_id',
        'label',
        'trigger',
        'schema_version',
        'data',
        'created_at',
      ]),
    );
  });
});
