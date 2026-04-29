import { createRequire } from 'node:module';
import fs from 'node:fs';
import type BetterSqlite3 from 'better-sqlite3';

import type { IStorageLayer, RepoBundle } from './storage-interfaces.js';
import { SessionRepository } from './repositories/session-repository.js';
import { CommanderEventRepository } from './repositories/commander-event-repository.js';
import { JobRepository } from './repositories/job-repository.js';
import { AssetRepository } from './repositories/asset-repository.js';
import { CanvasRepository } from './repositories/canvas-repository.js';
import { EntityRepository } from './repositories/entity-repository.js';
import { FolderRepository } from './repositories/folder-repository.js';
import { SeriesRepository } from './repositories/series-repository.js';
import { PresetRepository } from './repositories/preset-repository.js';
import { ShotTemplateRepository } from './repositories/shot-template-repository.js';
import { SnapshotRepository } from './repositories/snapshot-repository.js';
import { WorkflowRepository } from './repositories/workflow-repository.js';
import { ScriptRepository } from './repositories/script-repository.js';
import { ColorStyleRepository } from './repositories/color-style-repository.js';
import { DependencyRepository } from './repositories/dependency-repository.js';
import { ProjectSettingsRepository } from './repositories/project-settings-repository.js';
import { SCHEMA_SQL } from './schema-sql.js';
import { runSqliteMigrations } from './migrations/index.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

/**
 * Idempotent column-add for the canvases table.
 *
 * SCHEMA_SQL's `CREATE TABLE IF NOT EXISTS canvases (...)` is a no-op on
 * an existing table, so new columns added to the schema definition don't
 * materialize on older databases. Rather than introduce a versioned
 * migration runner for a single table, probe `PRAGMA table_info` once at
 * boot and `ALTER TABLE ADD COLUMN` whichever columns are missing.
 *
 * Each entry here must match the column definition in SCHEMA_SQL exactly.
 * Per-canvas settings added 2026-04-19 for style plate / aspect ratio /
 * provider overrides. Dev mode: schema changes (renames/drops) are
 * handled by deleting the DB file; this list only covers additive drift.
 */
const CANVAS_SETTINGS_COLUMNS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'style_plate', ddl: 'ALTER TABLE canvases ADD COLUMN style_plate TEXT' },
  { name: 'negative_prompt', ddl: 'ALTER TABLE canvases ADD COLUMN negative_prompt TEXT' },
  { name: 'default_width', ddl: 'ALTER TABLE canvases ADD COLUMN default_width INTEGER' },
  { name: 'default_height', ddl: 'ALTER TABLE canvases ADD COLUMN default_height INTEGER' },
  { name: 'publish_width', ddl: 'ALTER TABLE canvases ADD COLUMN publish_width INTEGER' },
  { name: 'publish_height', ddl: 'ALTER TABLE canvases ADD COLUMN publish_height INTEGER' },
  {
    name: 'publish_video_width',
    ddl: 'ALTER TABLE canvases ADD COLUMN publish_video_width INTEGER',
  },
  {
    name: 'publish_video_height',
    ddl: 'ALTER TABLE canvases ADD COLUMN publish_video_height INTEGER',
  },
  { name: 'aspect_ratio', ddl: 'ALTER TABLE canvases ADD COLUMN aspect_ratio TEXT' },
  { name: 'llm_provider_id', ddl: 'ALTER TABLE canvases ADD COLUMN llm_provider_id TEXT' },
  { name: 'image_provider_id', ddl: 'ALTER TABLE canvases ADD COLUMN image_provider_id TEXT' },
  { name: 'video_provider_id', ddl: 'ALTER TABLE canvases ADD COLUMN video_provider_id TEXT' },
  { name: 'audio_provider_id', ddl: 'ALTER TABLE canvases ADD COLUMN audio_provider_id TEXT' },
];

function addMissingCanvasColumns(db: BetterSqlite3.Database): void {
  const existing = db.prepare("PRAGMA table_info('canvases')").all() as Array<{ name: string }>;
  const present = new Set(existing.map((row) => row.name));
  for (const { name, ddl } of CANVAS_SETTINGS_COLUMNS) {
    if (!present.has(name)) {
      db.exec(ddl);
    }
  }
}

export interface RepairResult {
  recoveredTables: string[];
  failedTables: Array<{ name: string; error: string }>;
  backupReadable: boolean;
}

export class SqliteIndex implements IStorageLayer {
  private db: BetterSqlite3.Database;
  private sessions!: SessionRepository;
  private commanderEvents!: CommanderEventRepository;
  private jobs!: JobRepository;
  private assets!: AssetRepository;
  private canvases!: CanvasRepository;
  private entities!: EntityRepository;
  private folders!: FolderRepository;
  private seriesRepo!: SeriesRepository;
  private presets!: PresetRepository;
  private shotTemplates!: ShotTemplateRepository;
  private snapshots!: SnapshotRepository;
  private workflows!: WorkflowRepository;
  private scripts!: ScriptRepository;
  private colorStyles!: ColorStyleRepository;
  private dependencies!: DependencyRepository;
  private projectSettings!: ProjectSettingsRepository;

  /**
   * Repository bundle — the sole persistence surface exposed to
   * consumers. Every domain lives on its own repository; SqliteIndex
   * itself only owns schema bootstrap + lifecycle (close / health /
   * repair / vacuum).
   */
  get repos(): RepoBundle {
    return {
      sessions: this.sessions,
      commanderEvents: this.commanderEvents,
      jobs: this.jobs,
      assets: this.assets,
      canvases: this.canvases,
      entities: this.entities,
      folders: this.folders,
      series: this.seriesRepo,
      presets: this.presets,
      shotTemplates: this.shotTemplates,
      snapshots: this.snapshots,
      workflows: this.workflows,
      scripts: this.scripts,
      colorStyles: this.colorStyles,
      dependencies: this.dependencies,
      projectSettings: this.projectSettings,
    };
  }

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Dev-mode single source of truth: SCHEMA_SQL defines every table with
    // CREATE TABLE IF NOT EXISTS, so running it unconditionally on every boot
    // is idempotent — it fills in anything missing from a legacy DB and is a
    // no-op for an already-complete one. No migration runner, no version
    // bookkeeping.
    this.db.exec(SCHEMA_SQL);
    addMissingCanvasColumns(this.db);

    this.sessions = new SessionRepository(this.db);
    this.commanderEvents = new CommanderEventRepository(this.db);
    this.jobs = new JobRepository(this.db);
    this.assets = new AssetRepository(this.db);
    this.canvases = new CanvasRepository(this.db);
    this.entities = new EntityRepository(this.db);
    this.folders = new FolderRepository(this.db);
    this.seriesRepo = new SeriesRepository(this.db);
    this.presets = new PresetRepository(this.db);
    this.shotTemplates = new ShotTemplateRepository(this.db);
    this.snapshots = new SnapshotRepository(this.db);
    this.workflows = new WorkflowRepository(this.db);
    this.scripts = new ScriptRepository(this.db);
    this.colorStyles = new ColorStyleRepository(this.db);
    this.dependencies = new DependencyRepository(this.db);
    this.projectSettings = new ProjectSettingsRepository(this.db);
  }

  close(): void {
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* best-effort */
    }
    this.db.close();
  }

  /** Run pending versioned schema migrations (ALTER TABLE, new columns, etc.) */
  migrate(): void {
    runSqliteMigrations(this.db, this.db.name);
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
    this.commanderEvents = new CommanderEventRepository(this.db);
    this.jobs = new JobRepository(this.db);
    this.assets = new AssetRepository(this.db);
    this.canvases = new CanvasRepository(this.db);
    this.entities = new EntityRepository(this.db);
    this.folders = new FolderRepository(this.db);
    this.seriesRepo = new SeriesRepository(this.db);
    this.presets = new PresetRepository(this.db);
    this.shotTemplates = new ShotTemplateRepository(this.db);
    this.snapshots = new SnapshotRepository(this.db);
    this.workflows = new WorkflowRepository(this.db);
    this.scripts = new ScriptRepository(this.db);
    this.colorStyles = new ColorStyleRepository(this.db);
    this.dependencies = new DependencyRepository(this.db);
    this.projectSettings = new ProjectSettingsRepository(this.db);
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

    this.rebuildRepos();
    return result;
  }

  vacuum(): void {
    this.db.exec('VACUUM');
  }

  clearEmbeddings(): void {
    this.db.exec('DELETE FROM asset_embeddings');
  }
}
