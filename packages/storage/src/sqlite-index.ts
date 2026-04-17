import { createRequire } from 'node:module';
import fs from 'node:fs';
import type {
  AssetMeta,
  Canvas,
  Job,
  Character,
  Equipment,
  Location,
  ScriptDocument,
  ColorStyle,
  Series,
  ShotTemplate,
  WorkflowRun,
  WorkflowStageRun,
  WorkflowTaskRun,
  WorkflowArtifact,
  WorkflowTaskSummary,
} from '@lucid-fin/contracts';
import type BetterSqlite3 from 'better-sqlite3';

import {
  type AssetMetaInput,
  repairAssetSizes as _repairAssetSizes,
  type EmbeddingRecord,
  type SemanticSearchResult,
} from './sqlite-assets.js';
import {
  insertJob as _insertJob,
  updateJob as _updateJob,
  getJob as _getJob,
  listJobs as _listJobs,
} from './sqlite-jobs.js';
import {
  upsertCanvas as _upsertCanvas,
  getCanvas as _getCanvas,
  listCanvases as _listCanvases,
  listCanvasesFull as _listCanvasesFull,
  deleteCanvas as _deleteCanvas,
} from './sqlite-canvases.js';
import {
  upsertCharacter as _upsertCharacter,
  getCharacter as _getCharacter,
  listCharacters as _listCharacters,
  deleteCharacter as _deleteCharacter,
  upsertEquipment as _upsertEquipment,
  getEquipment as _getEquipment,
  listEquipment as _listEquipment,
  deleteEquipment as _deleteEquipment,
  upsertLocation as _upsertLocation,
  getLocation as _getLocation,
  listLocations as _listLocations,
  deleteLocation as _deleteLocation,
} from './sqlite-entities.js';
import {
  upsertScript as _upsertScript,
  getScript as _getScript,
  deleteScript as _deleteScript,
  upsertColorStyle as _upsertColorStyle,
  listColorStyles as _listColorStyles,
  deleteColorStyle as _deleteColorStyle,
  addDependency as _addDependency,
  getDependents as _getDependents,
  upsertSeries as _upsertSeries,
  getSeries as _getSeries,
  deleteSeries as _deleteSeries,
  upsertEpisode as _upsertEpisode,
  listEpisodes as _listEpisodes,
  deleteEpisode as _deleteEpisode,
  upsertPresetOverride as _upsertPresetOverride,
  listPresetOverrides as _listPresetOverrides,
  deletePresetOverride as _deletePresetOverride,
} from './sqlite-content.js';
import {
  insertSnapshot as _insertSnapshot,
  getSnapshot as _getSnapshot,
  listSnapshots as _listSnapshots,
  deleteSnapshot as _deleteSnapshot,
  pruneSnapshots as _pruneSnapshots,
  pruneSnapshotsTiered as _pruneSnapshotsTiered,
  captureSnapshot as _captureSnapshot,
  restoreSnapshot as _restoreSnapshot,
  type StoredSession,
  type StoredSnapshot,
} from './sqlite-snapshots.js';
import {
  insertWorkflowRun as _insertWorkflowRun,
  getWorkflowRun as _getWorkflowRun,
  listWorkflowRuns as _listWorkflowRuns,
  updateWorkflowRun as _updateWorkflowRun,
  insertWorkflowStageRun as _insertWorkflowStageRun,
  listWorkflowStageRuns as _listWorkflowStageRuns,
  getWorkflowStageRun as _getWorkflowStageRun,
  updateWorkflowStageRun as _updateWorkflowStageRun,
  insertWorkflowTaskRun as _insertWorkflowTaskRun,
  listWorkflowTaskRuns as _listWorkflowTaskRuns,
  listWorkflowTaskRunsByStage as _listWorkflowTaskRunsByStage,
  listReadyWorkflowTasks as _listReadyWorkflowTasks,
  listAwaitingProviderTasks as _listAwaitingProviderTasks,
  getWorkflowTaskRun as _getWorkflowTaskRun,
  updateWorkflowTaskRun as _updateWorkflowTaskRun,
  insertWorkflowTaskDependency as _insertWorkflowTaskDependency,
  listTaskDependencies as _listTaskDependencies,
  listTaskDependents as _listTaskDependents,
  insertWorkflowArtifact as _insertWorkflowArtifact,
  listWorkflowArtifacts as _listWorkflowArtifacts,
  listEntityArtifacts as _listEntityArtifacts,
  listWorkflowArtifactsByTaskRun as _listWorkflowArtifactsByTaskRun,
  listWorkflowTaskSummaries as _listWorkflowTaskSummaries,
  recomputeStageAggregate as _recomputeStageAggregate,
  recomputeWorkflowAggregate as _recomputeWorkflowAggregate,
} from './sqlite-workflows.js';
import type { IStorageLayer } from './storage-interfaces.js';
import { runMigrations, getCurrentVersion } from './migrations/runner.js';
import { migrations } from './migrations/index.js';
import { SessionRepository } from './repositories/session-repository.js';
import { JobRepository } from './repositories/job-repository.js';
import { AssetRepository } from './repositories/asset-repository.js';
import type { SessionId, JobId, AssetHash } from '@lucid-fin/contracts';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS assets (
  hash        TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  format      TEXT NOT NULL,
  tags        TEXT,
  prompt      TEXT,
  provider    TEXT,
  created_at  INTEGER NOT NULL,
  file_size   INTEGER,
  width       INTEGER,
  height      INTEGER,
  duration    REAL
);

CREATE INDEX IF NOT EXISTS idx_assets_type_created
  ON assets(type, created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  segment_id    TEXT,
  type          TEXT NOT NULL,
  provider      TEXT NOT NULL,
  status        TEXT NOT NULL,
  priority      INTEGER DEFAULT 0,
  prompt        TEXT,
  params        TEXT,
  result        TEXT,
  cost          REAL,
  attempts      INTEGER DEFAULT 0,
  max_retries   INTEGER DEFAULT 3,
  progress      REAL,
  completed_steps INTEGER,
  total_steps   INTEGER,
  current_step  TEXT,
  batch_id      TEXT,
  batch_index   INTEGER,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  completed_at  INTEGER,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created
  ON jobs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS characters (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT DEFAULT 'supporting',
  description   TEXT DEFAULT '',
  appearance    TEXT DEFAULT '',
  personality   TEXT DEFAULT '',
  ref_image     TEXT,
  costumes      TEXT DEFAULT '[]',
  tags          TEXT DEFAULT '[]',
  age           INTEGER,
  gender        TEXT,
  voice         TEXT,
  reference_images TEXT DEFAULT '[]',
  loadouts      TEXT DEFAULT '[]',
  default_loadout_id TEXT DEFAULT '',
  created_at    INTEGER,
  updated_at    INTEGER
);

CREATE TABLE IF NOT EXISTS equipment (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'other',
  subtype       TEXT,
  description   TEXT DEFAULT '',
  function_desc TEXT,
  tags          TEXT DEFAULT '[]',
  reference_images TEXT DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'interior',
  sub_location     TEXT,
  description      TEXT DEFAULT '',
  time_of_day      TEXT,
  mood             TEXT,
  weather          TEXT,
  lighting         TEXT,
  architecture_style TEXT,
  dominant_colors  TEXT,
  key_features     TEXT,
  atmosphere_keywords TEXT,
  tags             TEXT DEFAULT '[]',
  reference_images TEXT DEFAULT '[]',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scripts (
  id            TEXT PRIMARY KEY,
  content       TEXT NOT NULL DEFAULT '',
  format        TEXT NOT NULL DEFAULT 'fountain',
  parsed_scenes TEXT DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dependencies (
  source_type TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  PRIMARY KEY (source_type, source_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS color_styles (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  source_type   TEXT NOT NULL DEFAULT 'manual',
  source_asset  TEXT,
  palette       TEXT NOT NULL DEFAULT '[]',
  gradients     TEXT NOT NULL DEFAULT '[]',
  exposure      TEXT NOT NULL DEFAULT '{}',
  tags          TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id                TEXT PRIMARY KEY,
  workflow_type     TEXT NOT NULL,
  entity_type       TEXT NOT NULL,
  entity_id         TEXT,
  trigger_source    TEXT NOT NULL,
  status            TEXT NOT NULL,
  summary           TEXT NOT NULL DEFAULT '',
  progress          REAL NOT NULL DEFAULT 0,
  completed_stages  INTEGER NOT NULL DEFAULT 0,
  total_stages      INTEGER NOT NULL DEFAULT 0,
  completed_tasks   INTEGER NOT NULL DEFAULT 0,
  total_tasks       INTEGER NOT NULL DEFAULT 0,
  current_stage_id  TEXT,
  current_task_id   TEXT,
  input_json        TEXT NOT NULL DEFAULT '{}',
  output_json       TEXT NOT NULL DEFAULT '{}',
  error_text        TEXT,
  metadata_json     TEXT NOT NULL DEFAULT '{}',
  created_at        INTEGER NOT NULL,
  started_at        INTEGER,
  completed_at      INTEGER,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_updated
  ON workflow_runs(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_stage_runs (
  id                TEXT PRIMARY KEY,
  workflow_run_id   TEXT NOT NULL,
  stage_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL,
  stage_order       INTEGER NOT NULL,
  progress          REAL NOT NULL DEFAULT 0,
  completed_tasks   INTEGER NOT NULL DEFAULT 0,
  total_tasks       INTEGER NOT NULL DEFAULT 0,
  error_text        TEXT,
  metadata_json     TEXT NOT NULL DEFAULT '{}',
  started_at        INTEGER,
  completed_at      INTEGER,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_stage_runs_workflow_order
  ON workflow_stage_runs(workflow_run_id, stage_order);
CREATE INDEX IF NOT EXISTS idx_workflow_stage_runs_workflow_status
  ON workflow_stage_runs(workflow_run_id, status);

CREATE TABLE IF NOT EXISTS workflow_task_runs (
  id                  TEXT PRIMARY KEY,
  workflow_run_id     TEXT NOT NULL,
  stage_run_id        TEXT NOT NULL,
  task_id             TEXT NOT NULL,
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL,
  status              TEXT NOT NULL,
  provider            TEXT,
  dependency_ids_json TEXT NOT NULL DEFAULT '[]',
  attempts            INTEGER NOT NULL DEFAULT 0,
  max_retries         INTEGER NOT NULL DEFAULT 0,
  input_json          TEXT NOT NULL DEFAULT '{}',
  output_json         TEXT NOT NULL DEFAULT '{}',
  provider_task_id    TEXT,
  asset_id            TEXT,
  error_text          TEXT,
  progress            REAL NOT NULL DEFAULT 0,
  current_step        TEXT,
  started_at          INTEGER,
  completed_at        INTEGER,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_task_runs_workflow_status_updated
  ON workflow_task_runs(workflow_run_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_task_runs_workflow_status_updated_asc
  ON workflow_task_runs(workflow_run_id, status, updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_workflow_task_runs_status_updated_id
  ON workflow_task_runs(status, updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_workflow_task_runs_stage_status
  ON workflow_task_runs(stage_run_id, status);
CREATE INDEX IF NOT EXISTS idx_workflow_task_runs_provider_task
  ON workflow_task_runs(provider_task_id);
CREATE INDEX IF NOT EXISTS idx_workflow_task_runs_workflow_task
  ON workflow_task_runs(workflow_run_id, task_id);

CREATE TABLE IF NOT EXISTS workflow_task_dependencies (
  task_run_id            TEXT NOT NULL,
  depends_on_task_run_id TEXT NOT NULL,
  PRIMARY KEY (task_run_id, depends_on_task_run_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_task_dependencies_depends_on
  ON workflow_task_dependencies(depends_on_task_run_id);

CREATE TABLE IF NOT EXISTS workflow_artifacts (
  id              TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  task_run_id     TEXT NOT NULL,
  artifact_type   TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  asset_hash      TEXT,
  path            TEXT,
  metadata_json   TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_workflow_type
  ON workflow_artifacts(workflow_run_id, artifact_type);
CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_entity
  ON workflow_artifacts(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_asset_hash
  ON workflow_artifacts(asset_hash);

CREATE TABLE IF NOT EXISTS canvases (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  nodes         TEXT NOT NULL DEFAULT '[]',
  edges         TEXT NOT NULL DEFAULT '[]',
  viewport      TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
  notes         TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canvases_updated
  ON canvases(updated_at DESC);

CREATE TABLE IF NOT EXISTS custom_shot_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tracks_json TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS series (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  style_guide   TEXT DEFAULT '{}',
  episode_ids   TEXT DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  id            TEXT PRIMARY KEY,
  series_id     TEXT NOT NULL,
  title         TEXT NOT NULL,
  episode_order INTEGER NOT NULL DEFAULT 0,
  status        TEXT DEFAULT 'draft',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_series
  ON episodes(series_id, episode_order ASC);

CREATE TABLE IF NOT EXISTS preset_overrides (
  id            TEXT PRIMARY KEY,
  preset_id     TEXT NOT NULL UNIQUE,
  category      TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  prompt        TEXT DEFAULT '',
  params        TEXT DEFAULT '[]',
  defaults      TEXT DEFAULT '{}',
  is_user       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_preset_overrides_category
  ON preset_overrides(category);

CREATE TABLE IF NOT EXISTS commander_sessions (
  id          TEXT PRIMARY KEY,
  canvas_id   TEXT,
  title       TEXT NOT NULL DEFAULT '',
  messages    TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commander_sessions_updated
  ON commander_sessions(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_commander_sessions_canvas
  ON commander_sessions(canvas_id);

CREATE TABLE IF NOT EXISTS snapshots (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',
  trigger         TEXT NOT NULL DEFAULT 'auto',
  schema_version  INTEGER NOT NULL DEFAULT 1,
  data            TEXT NOT NULL DEFAULT '{}',
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES commander_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_session
  ON snapshots(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS asset_embeddings (
  hash        TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  tokens      TEXT NOT NULL,
  model       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
  tags, prompt, content=assets, content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS assets_ai AFTER INSERT ON assets BEGIN
  INSERT INTO assets_fts(rowid, tags, prompt) VALUES (new.rowid, new.tags, new.prompt);
END;

CREATE TRIGGER IF NOT EXISTS assets_ad AFTER DELETE ON assets BEGIN
  INSERT INTO assets_fts(assets_fts, rowid, tags, prompt) VALUES('delete', old.rowid, old.tags, old.prompt);
END;

CREATE TRIGGER IF NOT EXISTS assets_au AFTER UPDATE ON assets BEGIN
  INSERT INTO assets_fts(assets_fts, rowid, tags, prompt) VALUES('delete', old.rowid, old.tags, old.prompt);
  INSERT INTO assets_fts(rowid, tags, prompt) VALUES (new.rowid, new.tags, new.prompt);
END;
`;

export class SqliteIndex implements IStorageLayer {
  private db: BetterSqlite3.Database;
  private sessions!: SessionRepository;
  private jobs!: JobRepository;
  private assets!: AssetRepository;

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
  }

  // --- Assets ---
  insertAsset(meta: AssetMetaInput): void { this.assets.insert(meta); }
  deleteAsset(hash: string): void { this.assets.delete(hash as AssetHash); }
  queryAssets(filter: { type?: string; limit?: number; offset?: number }): AssetMeta[] {
    return this.assets.query(filter).rows;
  }
  searchAssets(query: string, limit = 50): AssetMeta[] {
    return this.assets.search(query, limit).rows;
  }
  repairAssetSizes(resolveAssetPath: (hash: string, type: string, format: string) => string): number { return _repairAssetSizes(this.db, resolveAssetPath); }

  // --- Asset Embeddings ---
  insertEmbedding(hash: string, description: string, tokens: string[], model: string): void {
    this.assets.insertEmbedding(hash as AssetHash, description, tokens, model);
  }
  queryEmbeddingByHash(hash: string): EmbeddingRecord | undefined {
    return this.assets.queryEmbeddingByHash(hash as AssetHash);
  }
  searchByTokens(queryTokens: string[], limit: number): SemanticSearchResult[] {
    return this.assets.searchByTokens(queryTokens, limit);
  }
  getAllEmbeddedHashes(): string[] { return this.assets.getAllEmbeddedHashes(); }

  // --- Jobs ---
  insertJob(job: Job): void { this.jobs.insert(job); }
  updateJob(jobId: string, updates: Parameters<typeof _updateJob>[2]): void {
    this.jobs.update(jobId as JobId, updates);
  }
  getJob(jobId: string): Job | undefined { return this.jobs.get(jobId as JobId); }
  listJobs(filter?: { status?: string }): Job[] { return this.jobs.list(filter).rows; }

  // --- Canvases ---
  upsertCanvas(canvas: Canvas): void { _upsertCanvas(this.db, canvas); }
  getCanvas(id: string): Canvas | undefined { return _getCanvas(this.db, id); }
  listCanvases(): Array<{ id: string; name: string; updatedAt: number }> { return _listCanvases(this.db); }
  listCanvasesFull(): Canvas[] { return _listCanvasesFull(this.db); }
  deleteCanvas(id: string): void { _deleteCanvas(this.db, id); }

  // --- Characters ---
  upsertCharacter(char: Parameters<typeof _upsertCharacter>[1]): void { _upsertCharacter(this.db, char); }
  getCharacter(id: string): Character | undefined { return _getCharacter(this.db, id); }
  listCharacters(): Character[] { return _listCharacters(this.db); }
  deleteCharacter(id: string): void { _deleteCharacter(this.db, id); }

  // --- Equipment ---
  upsertEquipment(equip: Parameters<typeof _upsertEquipment>[1]): void { _upsertEquipment(this.db, equip); }
  getEquipment(id: string): Equipment | undefined { return _getEquipment(this.db, id); }
  listEquipment(type?: string): Equipment[] { return _listEquipment(this.db, type); }
  deleteEquipment(id: string): void { _deleteEquipment(this.db, id); }

  // --- Locations ---
  upsertLocation(loc: Parameters<typeof _upsertLocation>[1]): void { _upsertLocation(this.db, loc); }
  getLocation(id: string): Location | undefined { return _getLocation(this.db, id); }
  listLocations(type?: string): Location[] { return _listLocations(this.db, type); }
  deleteLocation(id: string): void { _deleteLocation(this.db, id); }

  // --- Scripts ---
  upsertScript(doc: ScriptDocument): void { _upsertScript(this.db, doc); }
  getScript(): ScriptDocument | null { return _getScript(this.db); }
  deleteScript(id: string): void { _deleteScript(this.db, id); }

  // --- Color Styles ---
  upsertColorStyle(cs: ColorStyle): void { _upsertColorStyle(this.db, cs); }
  listColorStyles(): ColorStyle[] { return _listColorStyles(this.db); }
  deleteColorStyle(id: string): void { _deleteColorStyle(this.db, id); }

  // --- Dependencies ---
  addDependency(sourceType: string, sourceId: string, targetType: string, targetId: string): void { _addDependency(this.db, sourceType, sourceId, targetType, targetId); }
  getDependents(sourceType: string, sourceId: string): Array<{ targetType: string; targetId: string }> { return _getDependents(this.db, sourceType, sourceId); }

  // --- Series & Episodes ---
  upsertSeries(series: Series): void { _upsertSeries(this.db, series); }
  getSeries(id: string): Series | undefined { return _getSeries(this.db, id); }
  deleteSeries(id: string): void { _deleteSeries(this.db, id); }
  upsertEpisode(episode: Parameters<typeof _upsertEpisode>[1]): void { _upsertEpisode(this.db, episode); }
  listEpisodes(seriesId: string): ReturnType<typeof _listEpisodes> { return _listEpisodes(this.db, seriesId); }
  deleteEpisode(id: string): void { _deleteEpisode(this.db, id); }

  // --- Preset Overrides ---
  upsertPresetOverride(override: Parameters<typeof _upsertPresetOverride>[1]): void { _upsertPresetOverride(this.db, override); }
  listPresetOverrides(): ReturnType<typeof _listPresetOverrides> { return _listPresetOverrides(this.db); }
  deletePresetOverride(id: string): void { _deletePresetOverride(this.db, id); }

  // --- Sessions ---
  // Delegated to `SessionRepository` (Phase G1-2.1). Legacy `string` IDs are
  // re-branded at this boundary; Phase G1-5 consumer migration will lift
  // branding into the handlers themselves, removing these casts.
  upsertSession(s: StoredSession): void {
    this.sessions.upsert({ ...s, id: s.id as SessionId });
  }
  getSession(id: string): StoredSession | undefined {
    return this.sessions.get(id as SessionId);
  }
  listSessions(limit?: number): StoredSession[] {
    return this.sessions.list(limit).rows;
  }
  deleteSession(id: string): void {
    this.sessions.delete(id as SessionId);
  }

  // --- Snapshots ---
  insertSnapshot(s: StoredSnapshot): void { _insertSnapshot(this.db, s); }
  getSnapshot(id: string): StoredSnapshot | undefined { return _getSnapshot(this.db, id); }
  listSnapshots(sessionId: string): StoredSnapshot[] { return _listSnapshots(this.db, sessionId); }
  deleteSnapshot(id: string): void { _deleteSnapshot(this.db, id); }
  pruneSnapshots(sessionId: string, maxKeep: number): void { _pruneSnapshots(this.db, sessionId, maxKeep); }
  pruneSnapshotsTiered(): void { _pruneSnapshotsTiered(this.db); }
  captureSnapshot(sessionId: string, label: string, trigger: 'auto' | 'manual'): StoredSnapshot {
    return _captureSnapshot(this.db, sessionId, label, trigger);
  }
  restoreSnapshot(snapshotId: string): void { _restoreSnapshot(this.db, snapshotId); }

  // --- Workflow Runs ---
  insertWorkflowRun(run: WorkflowRun): void { _insertWorkflowRun(this.db, run); }
  getWorkflowRun(id: string): WorkflowRun | undefined { return _getWorkflowRun(this.db, id); }
  listWorkflowRuns(filter?: { status?: string; workflowType?: string; entityType?: string }): WorkflowRun[] { return _listWorkflowRuns(this.db, filter); }
  updateWorkflowRun(id: string, updates: Parameters<typeof _updateWorkflowRun>[2]): void { _updateWorkflowRun(this.db, id, updates); }

  // --- Workflow Stage Runs ---
  insertWorkflowStageRun(stageRun: WorkflowStageRun): void { _insertWorkflowStageRun(this.db, stageRun); }
  listWorkflowStageRuns(workflowRunId: string): WorkflowStageRun[] { return _listWorkflowStageRuns(this.db, workflowRunId); }
  getWorkflowStageRun(id: string): WorkflowStageRun | undefined { return _getWorkflowStageRun(this.db, id); }
  updateWorkflowStageRun(id: string, updates: Parameters<typeof _updateWorkflowStageRun>[2]): void { _updateWorkflowStageRun(this.db, id, updates); }

  // --- Workflow Task Runs ---
  insertWorkflowTaskRun(taskRun: WorkflowTaskRun): void { _insertWorkflowTaskRun(this.db, taskRun); }
  listWorkflowTaskRuns(workflowRunId: string): WorkflowTaskRun[] { return _listWorkflowTaskRuns(this.db, workflowRunId); }
  listWorkflowTaskRunsByStage(stageRunId: string): WorkflowTaskRun[] { return _listWorkflowTaskRunsByStage(this.db, stageRunId); }
  listReadyWorkflowTasks(workflowRunId?: string): WorkflowTaskRun[] { return _listReadyWorkflowTasks(this.db, workflowRunId); }
  listAwaitingProviderTasks(workflowRunId?: string): WorkflowTaskRun[] { return _listAwaitingProviderTasks(this.db, workflowRunId); }
  getWorkflowTaskRun(id: string): WorkflowTaskRun | undefined { return _getWorkflowTaskRun(this.db, id); }
  updateWorkflowTaskRun(id: string, updates: Parameters<typeof _updateWorkflowTaskRun>[2]): void { _updateWorkflowTaskRun(this.db, id, updates); }

  // --- Task Dependencies ---
  insertWorkflowTaskDependency(taskRunId: string, dependsOnTaskRunId: string): void { _insertWorkflowTaskDependency(this.db, taskRunId, dependsOnTaskRunId); }
  listTaskDependencies(taskRunId: string): string[] { return _listTaskDependencies(this.db, taskRunId); }
  listTaskDependents(dependsOnTaskRunId: string): string[] { return _listTaskDependents(this.db, dependsOnTaskRunId); }

  // --- Workflow Artifacts ---
  insertWorkflowArtifact(artifact: WorkflowArtifact): void { _insertWorkflowArtifact(this.db, artifact); }
  listWorkflowArtifacts(workflowRunId: string): WorkflowArtifact[] { return _listWorkflowArtifacts(this.db, workflowRunId); }
  listEntityArtifacts(entityType: string, entityId: string): WorkflowArtifact[] { return _listEntityArtifacts(this.db, entityType, entityId); }
  listWorkflowArtifactsByTaskRun(taskRunId: string): WorkflowArtifact[] { return _listWorkflowArtifactsByTaskRun(this.db, taskRunId); }

  // --- Task Summaries & Aggregation ---
  listWorkflowTaskSummaries(filter?: Parameters<typeof _listWorkflowTaskSummaries>[1]): WorkflowTaskSummary[] { return _listWorkflowTaskSummaries(this.db, filter); }
  recomputeStageAggregate(stageRunId: string): void { _recomputeStageAggregate(this.db, stageRunId); }
  recomputeWorkflowAggregate(workflowRunId: string): void { _recomputeWorkflowAggregate(this.db, workflowRunId); }


  // ---------------------------------------------------------------------------
  // Custom shot templates
  // ---------------------------------------------------------------------------

  listCustomShotTemplates(): ShotTemplate[] {
    const rows = this.db.prepare(
      'SELECT id, name, description, tracks_json, created_at FROM custom_shot_templates'
    ).all() as Array<{ id: string; name: string; description: string; tracks_json: string; created_at: number }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      builtIn: false,
      tracks: JSON.parse(row.tracks_json),
      createdAt: row.created_at,
    }));
  }

  upsertCustomShotTemplate(template: ShotTemplate): void {
    this.db.prepare(`
      INSERT INTO custom_shot_templates (id, name, description, tracks_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
        tracks_json = excluded.tracks_json, updated_at = excluded.updated_at
    `).run(template.id, template.name, template.description, JSON.stringify(template.tracks), template.createdAt ?? Date.now(), Date.now());
  }

  deleteCustomShotTemplate(templateId: string): void {
    this.db.prepare('DELETE FROM custom_shot_templates WHERE id = ?').run(templateId);
  }

  // ---------------------------------------------------------------------------
  // Storage management
  // ---------------------------------------------------------------------------

  vacuum(): void {
    this.db.exec('VACUUM');
  }

  clearEmbeddings(): void {
    this.db.exec('DELETE FROM asset_embeddings');
  }
}
