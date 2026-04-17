import { createRequire } from 'node:module';
import fs from 'node:fs';
import type BetterSqlite3 from 'better-sqlite3';

import type { IStorageLayer, RepoBundle } from './storage-interfaces.js';
import { runMigrations, getCurrentVersion } from './migrations/runner.js';
import { migrations } from './migrations/index.js';
import { SessionRepository } from './repositories/session-repository.js';
import { JobRepository } from './repositories/job-repository.js';
import { AssetRepository } from './repositories/asset-repository.js';
import { CanvasRepository } from './repositories/canvas-repository.js';
import { EntityRepository } from './repositories/entity-repository.js';
import { SeriesRepository } from './repositories/series-repository.js';
import { PresetRepository } from './repositories/preset-repository.js';
import { ShotTemplateRepository } from './repositories/shot-template-repository.js';
import { SnapshotRepository } from './repositories/snapshot-repository.js';
import { WorkflowRepository } from './repositories/workflow-repository.js';
import { ScriptRepository } from './repositories/script-repository.js';
import { ColorStyleRepository } from './repositories/color-style-repository.js';
import { DependencyRepository } from './repositories/dependency-repository.js';
import { SCHEMA_SQL } from './schema-sql.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;


export class SqliteIndex implements IStorageLayer {
  private db: BetterSqlite3.Database;
  private sessions!: SessionRepository;
  private jobs!: JobRepository;
  private assets!: AssetRepository;
  private canvases!: CanvasRepository;
  private entities!: EntityRepository;
  private seriesRepo!: SeriesRepository;
  private presets!: PresetRepository;
  private shotTemplates!: ShotTemplateRepository;
  private snapshots!: SnapshotRepository;
  private workflows!: WorkflowRepository;
  private scripts!: ScriptRepository;
  private colorStyles!: ColorStyleRepository;
  private dependencies!: DependencyRepository;

  /**
   * Repository bundle — the sole persistence surface exposed to
   * consumers. Every domain lives on its own repository; SqliteIndex
   * itself only owns schema bootstrap + lifecycle (close / health /
   * repair / vacuum).
   */
  get repos(): RepoBundle {
    return {
      sessions: this.sessions,
      jobs: this.jobs,
      assets: this.assets,
      canvases: this.canvases,
      entities: this.entities,
      series: this.seriesRepo,
      presets: this.presets,
      shotTemplates: this.shotTemplates,
      snapshots: this.snapshots,
      workflows: this.workflows,
      scripts: this.scripts,
      colorStyles: this.colorStyles,
      dependencies: this.dependencies,
    };
  }

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    // Determine the highest migration version we have
    const latestVersion = migrations.reduce((max, m) => Math.max(max, m.version), 0);
    const currentVersion = getCurrentVersion(this.db);

    if (currentVersion === 0) {
      // Fresh install — run schema creation + all migrations once
      this.db.exec(SCHEMA_SQL);
      runMigrations(this.db, migrations);
    } else if (currentVersion < latestVersion) {
      // Existing DB needs migration — schema tables already exist
      runMigrations(this.db, migrations);
    }
    // Else: DB is up-to-date — skip schema and migrations entirely

    this.sessions = new SessionRepository(this.db);
    this.jobs = new JobRepository(this.db);
    this.assets = new AssetRepository(this.db);
    this.canvases = new CanvasRepository(this.db);
    this.entities = new EntityRepository(this.db);
    this.seriesRepo = new SeriesRepository(this.db);
    this.presets = new PresetRepository(this.db);
    this.shotTemplates = new ShotTemplateRepository(this.db);
    this.snapshots = new SnapshotRepository(this.db);
    this.workflows = new WorkflowRepository(this.db);
    this.scripts = new ScriptRepository(this.db);
    this.colorStyles = new ColorStyleRepository(this.db);
    this.dependencies = new DependencyRepository(this.db);
  }

  close(): void {
    this.db.close();
  }

  /** Run integrity check -- throws if DB is corrupted */
  healthCheck(): void {
    const result = this.db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (!result.length || result[0].integrity_check !== 'ok') {
      throw new Error(`SQLite integrity check failed: ${JSON.stringify(result)}`);
    }
  }

  /** Attempt to repair by exporting to SQL and reimporting into a fresh DB */
  repair(): void {
    const dbPath = this.db.name;
    const backupPath = `${dbPath}.corrupt.${Date.now()}`;
    this.db.close();
    fs.renameSync(dbPath, backupPath);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
    runMigrations(this.db, migrations);
    try {
      const old = new Database(backupPath, { readonly: true });
      const tables = old
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'",
        )
        .all() as Array<{ name: string }>;
      for (const { name } of tables) {
        try {
          const rows = old.prepare(`SELECT * FROM ${name}`).all() as Array<Record<string, unknown>>;
          if (!rows.length) continue;
          const cols = Object.keys(rows[0]);
          const placeholders = cols.map(() => '?').join(', ');
          const insert = this.db.prepare(
            `INSERT OR IGNORE INTO ${name} (${cols.join(', ')}) VALUES (${placeholders})`,
          );
          const tx = this.db.transaction(() => {
            for (const row of rows) insert.run(...cols.map((c) => row[c]));
          });
          tx();
        } catch { /* insert failed for this table during migration seed — skip unrecoverable tables */
          /* skip unrecoverable tables */
        }
      }
      old.close();
    } catch { /* backup DB unreadable — fresh DB is still valid */
      /* backup unreadable -- fresh DB is still valid */
    }

    // Repo handles pin to the live db — rebuild after the swap above.
    this.sessions = new SessionRepository(this.db);
    this.jobs = new JobRepository(this.db);
    this.assets = new AssetRepository(this.db);
    this.canvases = new CanvasRepository(this.db);
    this.entities = new EntityRepository(this.db);
    this.seriesRepo = new SeriesRepository(this.db);
    this.presets = new PresetRepository(this.db);
    this.shotTemplates = new ShotTemplateRepository(this.db);
    this.snapshots = new SnapshotRepository(this.db);
    this.workflows = new WorkflowRepository(this.db);
    this.scripts = new ScriptRepository(this.db);
    this.colorStyles = new ColorStyleRepository(this.db);
    this.dependencies = new DependencyRepository(this.db);
  }

  vacuum(): void {
    this.db.exec('VACUUM');
  }

  clearEmbeddings(): void {
    this.db.exec('DELETE FROM asset_embeddings');
  }
}
