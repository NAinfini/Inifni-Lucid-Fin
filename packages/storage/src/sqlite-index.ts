import { createRequire } from 'node:module';
import fs from 'node:fs';
import type BetterSqlite3 from 'better-sqlite3';

import type { IStorageLayer, RepoBundle } from './storage-interfaces.js';
import { SessionRepository } from './repositories/session-repository.js';
import { CommanderRunRepository } from './repositories/commander-run-repository.js';
import { AssetRepository } from './repositories/asset-repository.js';
import { CanvasRepository } from './repositories/canvas-repository.js';
import { CanvasNodeRepository } from './repositories/canvas-node-repository.js';
import { CanvasEdgeRepository } from './repositories/canvas-edge-repository.js';
import { EntityRepository } from './repositories/entity-repository.js';
import { FolderRepository } from './repositories/folder-repository.js';
import { PresetRepository } from './repositories/preset-repository.js';
import { ShotTemplateRepository } from './repositories/shot-template-repository.js';
import { SnapshotRepository } from './repositories/snapshot-repository.js';
import { TaskListRepository } from './repositories/task-list-repository.js';
import { ScriptRepository } from './repositories/script-repository.js';
import { ColorStyleRepository } from './repositories/color-style-repository.js';
import { DependencyRepository } from './repositories/dependency-repository.js';
import { ProjectSettingsRepository } from './repositories/project-settings-repository.js';
import { PromptAssemblyRepository } from './repositories/prompt-assembly-repository.js';
import { SCHEMA_SQL } from './schema-sql.js';
import { assertCanonicalSchema, getCanonicalSchemaDifferences } from './schema-validation.js';
import { CommanderEventsTable } from '@lucid-fin/contracts-parse';
import { purgeSoftDeleted, type GcResult } from './gc.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

function hasSchemaObjects(db: BetterSqlite3.Database): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get(),
  );
}

const PRIVATE_PAYLOAD_MISSING = `missing column on table "${CommanderEventsTable.tableName}" "${CommanderEventsTable.cols.privatePayload.sqlName}"`;
const PRIVATE_PAYLOAD_CHECK_MISSING = `CHECK clauses on table "${CommanderEventsTable.tableName}" differ`;
const OBSERVED_LEGACY_COMMANDER_DIFFERENCES = [
  PRIVATE_PAYLOAD_MISSING,
  PRIVATE_PAYLOAD_CHECK_MISSING,
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
] as const;

function hasExactDifferences(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function assertForeignKeysValid(db: BetterSqlite3.Database): void {
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`SQLite foreign key check failed: ${JSON.stringify(violations)}`);
  }
}

function canonicalSchemaStatement(prefix: string): string {
  const start = SCHEMA_SQL.indexOf(prefix);
  const end = SCHEMA_SQL.indexOf(';', start);
  if (start < 0 || end < 0) throw new Error(`Canonical SQLite statement not found: ${prefix}`);
  return SCHEMA_SQL.slice(start, end + 1);
}

function upgradeObservedLegacyCommanderSchema(db: BetterSqlite3.Database): void {
  const rebuiltTable = canonicalSchemaStatement('CREATE TABLE IF NOT EXISTS commander_runs (')
    .replace('CREATE TABLE IF NOT EXISTS commander_runs', 'CREATE TABLE commander_runs_rebuild')
    .replaceAll('REFERENCES commander_runs(id)', 'REFERENCES commander_runs_rebuild(id)');
  const rebuiltIndexes = [
    'CREATE INDEX IF NOT EXISTS idx_commander_runs_session_accepted',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_commander_runs_active_session',
    'CREATE INDEX IF NOT EXISTS idx_commander_runs_parent',
    'CREATE INDEX IF NOT EXISTS idx_commander_runs_retry',
  ]
    .map(canonicalSchemaStatement)
    .join('\n');
  const activeCanvasIndex = canonicalSchemaStatement(
    'CREATE INDEX IF NOT EXISTS idx_commander_run_canvases_active_canvas',
  );
  const foreignKeysEnabled = db.pragma('foreign_keys', { simple: true }) === 1;

  if (foreignKeysEnabled) db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(
        `ALTER TABLE commander_events ADD COLUMN private_payload BLOB CHECK (private_payload IS NULL OR length(private_payload) > 0);
         ${rebuiltTable}
         INSERT INTO commander_runs_rebuild
           (id, session_id, default_canvas_id, work_type, parent_run_id, retry_of_run_id,
            display_name, objective, intent, status, accepted_at, started_at, completed_at,
            last_seq, error_text)
         SELECT id, session_id, default_canvas_id, 'agent', NULL, NULL, NULL, NULL, intent,
                status, accepted_at, started_at, completed_at, last_seq, error_text
           FROM commander_runs;
         DROP TABLE commander_runs;
         ALTER TABLE commander_runs_rebuild RENAME TO commander_runs;
         ${rebuiltIndexes}
         DROP INDEX idx_commander_run_canvases_active_canvas;
         ${activeCanvasIndex}`,
      );
      assertCanonicalSchema(db);
      assertForeignKeysValid(db);
    })();
  } finally {
    if (foreignKeysEnabled) db.pragma('foreign_keys = ON');
  }
}

function assertOrUpgradeCanonicalSchema(db: BetterSqlite3.Database): void {
  const differences = getCanonicalSchemaDifferences(db);
  const privatePayloadOnly = [PRIVATE_PAYLOAD_MISSING, PRIVATE_PAYLOAD_CHECK_MISSING];
  if (
    hasExactDifferences(differences, privatePayloadOnly) ||
    hasExactDifferences(differences, OBSERVED_LEGACY_COMMANDER_DIFFERENCES)
  ) {
    if (differences.length === privatePayloadOnly.length) {
      db.transaction(() => {
        db.exec(
          `ALTER TABLE ${CommanderEventsTable.tableName} ADD COLUMN ${CommanderEventsTable.cols.privatePayload.sqlName} BLOB CHECK (${CommanderEventsTable.cols.privatePayload.sqlName} IS NULL OR length(${CommanderEventsTable.cols.privatePayload.sqlName}) > 0)`,
        );
        assertCanonicalSchema(db);
        assertForeignKeysValid(db);
      })();
    } else {
      upgradeObservedLegacyCommanderSchema(db);
    }
    return;
  }
  assertCanonicalSchema(db);
}

export interface RepairResult {
  recoveredTables: string[];
  failedTables: Array<{ name: string; error: string }>;
  backupReadable: boolean;
}

export class SqliteIndex implements IStorageLayer {
  private db: BetterSqlite3.Database;
  private sessions!: SessionRepository;
  private commanderRuns!: CommanderRunRepository;
  private assets!: AssetRepository;
  private canvases!: CanvasRepository;
  private canvasNodes!: CanvasNodeRepository;
  private canvasEdges!: CanvasEdgeRepository;
  private entities!: EntityRepository;
  private folders!: FolderRepository;
  private presets!: PresetRepository;
  private shotTemplates!: ShotTemplateRepository;
  private snapshots!: SnapshotRepository;
  private taskLists!: TaskListRepository;
  private scripts!: ScriptRepository;
  private colorStyles!: ColorStyleRepository;
  private dependencies!: DependencyRepository;
  private projectSettings!: ProjectSettingsRepository;
  private promptAssemblies!: PromptAssemblyRepository;

  /**
   * Repository bundle — the sole persistence surface exposed to
   * consumers. Every domain lives on its own repository; SqliteIndex
   * itself only owns schema bootstrap + lifecycle (close / health /
   * repair / vacuum).
   */
  get repos(): RepoBundle {
    return {
      sessions: this.sessions,
      commanderRuns: this.commanderRuns,
      assets: this.assets,
      canvases: this.canvases,
      canvasNodes: this.canvasNodes,
      canvasEdges: this.canvasEdges,
      entities: this.entities,
      folders: this.folders,
      presets: this.presets,
      shotTemplates: this.shotTemplates,
      snapshots: this.snapshots,
      taskLists: this.taskLists,
      scripts: this.scripts,
      colorStyles: this.colorStyles,
      dependencies: this.dependencies,
      projectSettings: this.projectSettings,
      promptAssemblies: this.promptAssemblies,
    };
  }

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    try {
      this.db.pragma('foreign_keys = ON');
      const existingSchema = hasSchemaObjects(this.db);
      if (existingSchema) assertOrUpgradeCanonicalSchema(this.db);

      this.db.pragma('journal_mode = WAL');

      if (!existingSchema) {
        this.db.exec(SCHEMA_SQL);
        assertCanonicalSchema(this.db);
      }
    } catch (error) {
      this.db.close();
      throw error;
    }

    this.sessions = new SessionRepository(this.db);
    this.commanderRuns = new CommanderRunRepository(this.db);
    this.assets = new AssetRepository(this.db);
    this.canvases = new CanvasRepository(this.db);
    this.canvasNodes = new CanvasNodeRepository(this.db);
    this.canvasEdges = new CanvasEdgeRepository(this.db);
    this.canvases.setGraphRepositories({ nodes: this.canvasNodes, edges: this.canvasEdges });
    this.entities = new EntityRepository(this.db);
    this.folders = new FolderRepository(this.db);
    this.presets = new PresetRepository(this.db);
    this.shotTemplates = new ShotTemplateRepository(this.db);
    this.snapshots = new SnapshotRepository(this.db);
    this.taskLists = new TaskListRepository(this.db);
    this.scripts = new ScriptRepository(this.db);
    this.colorStyles = new ColorStyleRepository(this.db);
    this.dependencies = new DependencyRepository(this.db);
    this.projectSettings = new ProjectSettingsRepository(this.db);
    this.promptAssemblies = new PromptAssemblyRepository(this.db);
  }

  /** Expose the raw better-sqlite3 instance for advanced operations. */
  get rawDb(): BetterSqlite3.Database {
    return this.db;
  }

  /** Absolute path of the database file. */
  get dbPath(): string {
    return this.db.name;
  }

  close(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* best-effort */
    }
    this.db.close();
  }

  /** Run integrity check -- throws if DB is corrupted */
  healthCheck(): void {
    const result = this.db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (!result.length || result[0].integrity_check !== 'ok') {
      throw new Error(`SQLite integrity check failed: ${JSON.stringify(result)}`);
    }
  }

  private rebuildRepos(): void {
    this.sessions = new SessionRepository(this.db);
    this.commanderRuns = new CommanderRunRepository(this.db);
    this.assets = new AssetRepository(this.db);
    this.canvases = new CanvasRepository(this.db);
    this.canvasNodes = new CanvasNodeRepository(this.db);
    this.canvasEdges = new CanvasEdgeRepository(this.db);
    this.canvases.setGraphRepositories({ nodes: this.canvasNodes, edges: this.canvasEdges });
    this.entities = new EntityRepository(this.db);
    this.folders = new FolderRepository(this.db);
    this.presets = new PresetRepository(this.db);
    this.shotTemplates = new ShotTemplateRepository(this.db);
    this.snapshots = new SnapshotRepository(this.db);
    this.taskLists = new TaskListRepository(this.db);
    this.scripts = new ScriptRepository(this.db);
    this.colorStyles = new ColorStyleRepository(this.db);
    this.dependencies = new DependencyRepository(this.db);
    this.projectSettings = new ProjectSettingsRepository(this.db);
    this.promptAssemblies = new PromptAssemblyRepository(this.db);
  }

  /** Attempt to repair by exporting to SQL and reimporting into a fresh DB */
  repair(): RepairResult {
    const result: RepairResult = { recoveredTables: [], failedTables: [], backupReadable: true };
    const dbPath = this.db.name;
    const backupPath = `${dbPath}.corrupt.${Date.now()}`;

    // Flush WAL to main file before closing to avoid data loss.
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* best-effort */
    }
    this.db.close();
    fs.renameSync(dbPath, backupPath);

    // Create the new DB in a temp path; only move it into place on success.
    const tempPath = `${dbPath}.repair.${Date.now()}`;
    let newDb: BetterSqlite3.Database;
    try {
      newDb = new Database(tempPath);
      newDb.pragma('journal_mode = WAL');
      newDb.pragma('foreign_keys = ON');
      newDb.exec(SCHEMA_SQL);
      assertCanonicalSchema(newDb);
    } catch (err) {
      // New DB creation failed — restore the backup and re-open it.
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* may not exist */
      }
      fs.renameSync(backupPath, dbPath);
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.rebuildRepos();
      throw err;
    }

    try {
      const old = new Database(backupPath, { readonly: true });
      const tables = old
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'",
        )
        .all() as Array<{ name: string }>;
      for (const { name } of tables) {
        try {
          const safeName = `"${name.replace(/"/g, '""')}"`;
          const rows = old.prepare(`SELECT * FROM ${safeName}`).all() as Array<
            Record<string, unknown>
          >;
          if (!rows.length) {
            result.recoveredTables.push(name);
            continue;
          }
          const cols = Object.keys(rows[0]);
          const safeCols = cols.map((c) => `"${c.replace(/"/g, '""')}"`);
          const placeholders = cols.map(() => '?').join(', ');
          const insert = newDb.prepare(
            `INSERT OR IGNORE INTO ${safeName} (${safeCols.join(', ')}) VALUES (${placeholders})`,
          );
          const tx = newDb.transaction(() => {
            for (const row of rows) insert.run(...cols.map((c) => row[c]));
          });
          tx();
          result.recoveredTables.push(name);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.failedTables.push({ name, error: msg });
          console.warn(`[repair] Failed to recover table "${name}": ${msg}`);
        }
      }
      old.close();
    } catch (err) {
      result.backupReadable = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[repair] Backup database unreadable: ${msg}`);
    }

    // Checkpoint the new DB's WAL before moving into final position.
    try {
      newDb.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* best-effort */
    }
    newDb.close();

    // Atomic rename: temp → final path.
    fs.renameSync(tempPath, dbPath);
    // Clean up any WAL/SHM left from the temp path.
    try {
      fs.unlinkSync(`${tempPath}-wal`);
    } catch {
      /* may not exist */
    }
    try {
      fs.unlinkSync(`${tempPath}-shm`);
    } catch {
      /* may not exist */
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    assertCanonicalSchema(this.db);

    this.rebuildRepos();
    return result;
  }

  vacuum(): void {
    this.db.exec('VACUUM');
  }

  gc(retentionMs?: number): GcResult {
    return purgeSoftDeleted(this.db, retentionMs);
  }
}
