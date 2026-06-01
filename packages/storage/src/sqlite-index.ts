import { createRequire } from 'node:module';
import fs from 'node:fs';
import type BetterSqlite3 from 'better-sqlite3';

import type { IStorageLayer, RepoBundle } from './storage-interfaces.js';
import { SessionRepository } from './repositories/session-repository.js';
import { CommanderEventRepository } from './repositories/commander-event-repository.js';
import { JobRepository } from './repositories/job-repository.js';
import { AssetRepository } from './repositories/asset-repository.js';
import { CanvasRepository } from './repositories/canvas-repository.js';
import { CanvasNodeRepository } from './repositories/canvas-node-repository.js';
import { CanvasEdgeRepository } from './repositories/canvas-edge-repository.js';
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
import { runMigrations } from './migrations.js';
import { purgeSoftDeleted, type GcResult } from './gc.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

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
  private canvasNodes!: CanvasNodeRepository;
  private canvasEdges!: CanvasEdgeRepository;
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
      canvasNodes: this.canvasNodes,
      canvasEdges: this.canvasEdges,
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

    // SCHEMA_SQL is the single source of truth for storage tables.
    this.db.exec(SCHEMA_SQL);
    runMigrations(this.db);

    this.sessions = new SessionRepository(this.db);
    this.commanderEvents = new CommanderEventRepository(this.db);
    this.jobs = new JobRepository(this.db);
    this.assets = new AssetRepository(this.db);
    this.canvases = new CanvasRepository(this.db);
    this.canvasNodes = new CanvasNodeRepository(this.db);
    this.canvasEdges = new CanvasEdgeRepository(this.db);
    this.canvases.setGraphRepositories({ nodes: this.canvasNodes, edges: this.canvasEdges });
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
    this.commanderEvents = new CommanderEventRepository(this.db);
    this.jobs = new JobRepository(this.db);
    this.assets = new AssetRepository(this.db);
    this.canvases = new CanvasRepository(this.db);
    this.canvasNodes = new CanvasNodeRepository(this.db);
    this.canvasEdges = new CanvasEdgeRepository(this.db);
    this.canvases.setGraphRepositories({ nodes: this.canvasNodes, edges: this.canvasEdges });
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

  gc(retentionMs?: number): GcResult {
    return purgeSoftDeleted(this.db, retentionMs);
  }

  clearEmbeddings(): void {
    this.db.exec('DELETE FROM asset_embeddings');
  }
}
