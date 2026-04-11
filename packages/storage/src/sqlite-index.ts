import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AssetMeta,
  Canvas,
  Job,
  ProjectManifest,
  Character,
  Equipment,
  Location,
  Scene,
  ScriptDocument,
  ColorStyle,
  Series,
  WorkflowRun,
  WorkflowStageRun,
  WorkflowTaskRun,
  WorkflowArtifact,
  WorkflowTaskSummary,
} from '@lucid-fin/contracts';
import type BetterSqlite3 from 'better-sqlite3';

import {
  type AssetMetaInput,
  insertAsset as _insertAsset,
  deleteAsset as _deleteAsset,
  queryAssets as _queryAssets,
  searchAssets as _searchAssets,
  insertEmbedding as _insertEmbedding,
  queryEmbeddingByHash as _queryEmbeddingByHash,
  searchByTokens as _searchByTokens,
  getAllEmbeddedHashes as _getAllEmbeddedHashes,
  type EmbeddingRecord,
  type SemanticSearchResult,
} from './sqlite-assets.js';
import {
  upsertProject as _upsertProject,
  listProjects as _listProjects,
} from './sqlite-projects.js';
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
  upsertScene as _upsertScene,
  getScene as _getScene,
  listScenes as _listScenes,
  deleteScene as _deleteScene,
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
  deletePresetOverridesByProject as _deletePresetOverridesByProject,
} from './sqlite-content.js';
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
  project_id  TEXT,
  width       INTEGER,
  height      INTEGER,
  duration    REAL
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  path        TEXT NOT NULL,
  series_id   TEXT,
  updated_at  INTEGER NOT NULL,
  thumbnail   TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS characters (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  project_id    TEXT,
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
  project_id    TEXT NOT NULL,
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
  project_id       TEXT NOT NULL,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'interior',
  sub_location     TEXT,
  description      TEXT DEFAULT '',
  time_of_day      TEXT,
  mood             TEXT,
  weather          TEXT,
  lighting         TEXT,
  tags             TEXT DEFAULT '[]',
  reference_images TEXT DEFAULT '[]',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scenes (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  idx           INTEGER NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  location      TEXT DEFAULT '',
  time_of_day   TEXT DEFAULT '',
  characters    TEXT DEFAULT '[]',
  keyframes     TEXT DEFAULT '[]',
  segments      TEXT DEFAULT '[]',
  style_override TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scripts (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
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
  project_id        TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_workflow_runs_project_created
  ON workflow_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status_updated
  ON workflow_runs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_type_project
  ON workflow_runs(workflow_type, project_id);

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
  project_id    TEXT NOT NULL,
  name          TEXT NOT NULL,
  nodes         TEXT NOT NULL DEFAULT '[]',
  edges         TEXT NOT NULL DEFAULT '[]',
  viewport      TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
  notes         TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canvases_project
  ON canvases(project_id, updated_at DESC);

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
  project_id    TEXT,
  status        TEXT DEFAULT 'draft',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_series
  ON episodes(series_id, episode_order ASC);

CREATE TABLE IF NOT EXISTS preset_overrides (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  preset_id     TEXT NOT NULL,
  category      TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  prompt        TEXT DEFAULT '',
  params        TEXT DEFAULT '[]',
  defaults      TEXT DEFAULT '{}',
  is_user       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(project_id, preset_id)
);

CREATE INDEX IF NOT EXISTS idx_preset_overrides_project
  ON preset_overrides(project_id, category);

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

export class SqliteIndex {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
    this.migrateCharacters();
    this.migrateJobs();
    this.migrateCanvases();
    this.migrateAssets();
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
    this.migrateCharacters();
    this.migrateJobs();
    this.migrateCanvases();
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
        } catch {
          /* skip unrecoverable tables */
        }
      }
      old.close();
    } catch {
      /* backup unreadable -- fresh DB is still valid */
    }
  }

  // --- Migrations ---

  private migrateCharacters(): void {
    const cols = this.db.prepare('PRAGMA table_info(characters)').all() as Array<{ name: string }>;
    const existing = new Set(cols.map((c) => c.name));
    const additions: Array<[string, string]> = [
      ['description', "TEXT DEFAULT ''"],
      ['appearance', "TEXT DEFAULT ''"],
      ['personality', "TEXT DEFAULT ''"],
      ['costumes', "TEXT DEFAULT '[]'"],
      ['created_at', 'INTEGER'],
      ['updated_at', 'INTEGER'],
      ['age', 'INTEGER'],
      ['gender', 'TEXT'],
      ['voice', 'TEXT'],
      ['reference_images', "TEXT DEFAULT '[]'"],
      ['loadouts', "TEXT DEFAULT '[]'"],
      ['default_loadout_id', "TEXT DEFAULT ''"],
    ];
    for (const [col, def] of additions) {
      if (!existing.has(col)) {
        this.db.exec(`ALTER TABLE characters ADD COLUMN ${col} ${def}`);
      }
    }
  }

  private migrateJobs(): void {
    const cols = this.db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>;
    const existing = new Set(cols.map((c) => c.name));
    const additions: Array<[string, string]> = [
      ['progress', 'REAL'],
      ['completed_steps', 'INTEGER'],
      ['total_steps', 'INTEGER'],
      ['current_step', 'TEXT'],
      ['batch_id', 'TEXT'],
      ['batch_index', 'INTEGER'],
    ];
    for (const [col, def] of additions) {
      if (!existing.has(col)) {
        this.db.exec(`ALTER TABLE jobs ADD COLUMN ${col} ${def}`);
      }
    }
  }

  private migrateCanvases(): void {
    const cols = this.db.prepare('PRAGMA table_info(canvases)').all() as Array<{ name: string }>;
    const existing = new Set(cols.map((c) => c.name));
    const additions: Array<[string, string]> = [
      ['notes', "TEXT NOT NULL DEFAULT '[]'"],
    ];
    for (const [col, def] of additions) {
      if (!existing.has(col)) {
        this.db.exec(`ALTER TABLE canvases ADD COLUMN ${col} ${def}`);
      }
    }
  }

  private migrateAssets(): void {
    const cols = this.db.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>;
    const existing = new Set(cols.map((c) => c.name));
    const additions: Array<[string, string]> = [
      ['width', 'INTEGER'],
      ['height', 'INTEGER'],
      ['duration', 'REAL'],
    ];
    for (const [col, def] of additions) {
      if (!existing.has(col)) {
        this.db.exec(`ALTER TABLE assets ADD COLUMN ${col} ${def}`);
      }
    }
  }

  // --- Assets ---
  insertAsset(meta: AssetMetaInput): void { _insertAsset(this.db, meta); }
  deleteAsset(hash: string): void { _deleteAsset(this.db, hash); }
  queryAssets(filter: { type?: string; projectId?: string; limit?: number; offset?: number }): AssetMeta[] { return _queryAssets(this.db, filter); }
  searchAssets(query: string, limit = 50, projectId?: string): AssetMeta[] { return _searchAssets(this.db, query, limit, projectId); }

  // --- Asset Embeddings ---
  insertEmbedding(hash: string, description: string, tokens: string[], model: string): void { _insertEmbedding(this.db, hash, description, tokens, model); }
  queryEmbeddingByHash(hash: string): EmbeddingRecord | undefined { return _queryEmbeddingByHash(this.db, hash); }
  searchByTokens(queryTokens: string[], limit: number): SemanticSearchResult[] { return _searchByTokens(this.db, queryTokens, limit); }
  getAllEmbeddedHashes(): string[] { return _getAllEmbeddedHashes(this.db); }

  // --- Projects ---
  upsertProject(project: { id: string; title: string; path: string; seriesId?: string; updatedAt: number; thumbnail?: string }): void { _upsertProject(this.db, project); }
  listProjects(): Array<{ id: string; title: string; path: string; updatedAt: number; thumbnail?: string }> { return _listProjects(this.db); }

  // --- Jobs ---
  insertJob(job: Job): void { _insertJob(this.db, job); }
  updateJob(jobId: string, updates: Parameters<typeof _updateJob>[2]): void { _updateJob(this.db, jobId, updates); }
  getJob(jobId: string): Job | undefined { return _getJob(this.db, jobId); }
  listJobs(filter?: { projectId?: string; status?: string }): Job[] { return _listJobs(this.db, filter); }

  // --- Canvases ---
  upsertCanvas(canvas: Canvas): void { _upsertCanvas(this.db, canvas); }
  getCanvas(id: string): Canvas | undefined { return _getCanvas(this.db, id); }
  listCanvases(projectId: string): Array<{ id: string; name: string; updatedAt: number }> { return _listCanvases(this.db, projectId); }
  listCanvasesFull(projectId: string): Canvas[] { return _listCanvasesFull(this.db, projectId); }
  deleteCanvas(id: string): void { _deleteCanvas(this.db, id); }

  // --- Characters ---
  upsertCharacter(char: Parameters<typeof _upsertCharacter>[1]): void { _upsertCharacter(this.db, char); }
  getCharacter(id: string): Character | undefined { return _getCharacter(this.db, id); }
  listCharacters(projectId?: string): Character[] { return _listCharacters(this.db, projectId); }
  deleteCharacter(id: string): void { _deleteCharacter(this.db, id); }

  // --- Equipment ---
  upsertEquipment(equip: Parameters<typeof _upsertEquipment>[1]): void { _upsertEquipment(this.db, equip); }
  getEquipment(id: string): Equipment | undefined { return _getEquipment(this.db, id); }
  listEquipment(projectId: string, type?: string): Equipment[] { return _listEquipment(this.db, projectId, type); }
  deleteEquipment(id: string): void { _deleteEquipment(this.db, id); }

  // --- Locations ---
  upsertLocation(loc: Parameters<typeof _upsertLocation>[1]): void { _upsertLocation(this.db, loc); }
  getLocation(id: string): Location | undefined { return _getLocation(this.db, id); }
  listLocations(projectId: string, type?: string): Location[] { return _listLocations(this.db, projectId, type); }
  deleteLocation(id: string): void { _deleteLocation(this.db, id); }

  // --- Scenes ---
  upsertScene(scene: Scene): void { _upsertScene(this.db, scene); }
  getScene(id: string): Scene | undefined { return _getScene(this.db, id); }
  listScenes(projectId: string): Scene[] { return _listScenes(this.db, projectId); }
  deleteScene(id: string): void { _deleteScene(this.db, id); }

  // --- Scripts ---
  upsertScript(doc: ScriptDocument): void { _upsertScript(this.db, doc); }
  getScript(projectId: string): ScriptDocument | null { return _getScript(this.db, projectId); }
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
  listPresetOverrides(projectId: string): ReturnType<typeof _listPresetOverrides> { return _listPresetOverrides(this.db, projectId); }
  deletePresetOverride(id: string): void { _deletePresetOverride(this.db, id); }
  deletePresetOverridesByProject(projectId: string): void { _deletePresetOverridesByProject(this.db, projectId); }

  // --- Workflow Runs ---
  insertWorkflowRun(run: WorkflowRun): void { _insertWorkflowRun(this.db, run); }
  getWorkflowRun(id: string): WorkflowRun | undefined { return _getWorkflowRun(this.db, id); }
  listWorkflowRuns(filter?: { projectId?: string; status?: string; workflowType?: string; entityType?: string }): WorkflowRun[] { return _listWorkflowRuns(this.db, filter); }
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

  // --- Sync (import JSON -> SQLite on project open for backward compat) ---

  syncFromJson(projectPath: string): void {
    let projectId: string | undefined;
    const projectFile = path.join(projectPath, 'project.json');
    if (fs.existsSync(projectFile)) {
      const manifest = JSON.parse(fs.readFileSync(projectFile, 'utf-8')) as ProjectManifest;
      projectId = manifest.id;
      this.upsertProject({
        id: manifest.id,
        title: manifest.title,
        path: projectPath,
        updatedAt: manifest.updatedAt,
      });
    }

    const charsFile = path.join(projectPath, 'characters.json');
    if (fs.existsSync(charsFile)) {
      const data = JSON.parse(fs.readFileSync(charsFile, 'utf-8')) as { characters: Character[] };
      for (const char of data.characters) {
        this.upsertCharacter({
          id: char.id,
          name: char.name,
          projectId: char.projectId ?? projectId,
          role: char.role,
          description: char.description,
          appearance: char.appearance,
          personality: char.personality,
          refImage: char.referenceImage,
          costumes: char.costumes,
          tags: char.tags,
          createdAt: char.createdAt,
          updatedAt: char.updatedAt,
        });
      }
    }

    const scenesDir = path.join(projectPath, 'scenes');
    if (fs.existsSync(scenesDir)) {
      for (const file of fs.readdirSync(scenesDir)) {
        if (!file.endsWith('.json')) continue;
        const scene = JSON.parse(fs.readFileSync(path.join(scenesDir, file), 'utf-8')) as Scene;
        if (scene.id && scene.projectId) this.upsertScene(scene);
      }
    }

    const scriptFile = path.join(projectPath, 'script.json');
    if (fs.existsSync(scriptFile)) {
      const raw = JSON.parse(fs.readFileSync(scriptFile, 'utf-8')) as Record<string, unknown>;
      if (typeof raw.content === 'string' && typeof raw.format === 'string' && projectId) {
        this.upsertScript(raw as unknown as ScriptDocument);
      }
    }

    const equipFile = path.join(projectPath, 'equipment.json');
    if (fs.existsSync(equipFile)) {
      const data = JSON.parse(fs.readFileSync(equipFile, 'utf-8')) as { equipment: Equipment[] };
      for (const equip of data.equipment ?? []) {
        this.upsertEquipment({
          id: equip.id,
          projectId: equip.projectId ?? projectId ?? '',
          name: equip.name,
          type: equip.type,
          subtype: equip.subtype,
          description: equip.description,
          functionDesc: equip.function,
          tags: equip.tags,
          referenceImages: equip.referenceImages,
          createdAt: equip.createdAt,
          updatedAt: equip.updatedAt,
        });
      }
    }

    const locationsFile = path.join(projectPath, 'locations.json');
    if (fs.existsSync(locationsFile)) {
      const data = JSON.parse(fs.readFileSync(locationsFile, 'utf-8')) as { locations: Location[] };
      for (const loc of data.locations ?? []) {
        this.upsertLocation({
          id: loc.id,
          projectId: loc.projectId ?? projectId ?? '',
          name: loc.name,
          type: loc.type,
          subLocation: loc.subLocation,
          description: loc.description,
          timeOfDay: loc.timeOfDay,
          mood: loc.mood,
          weather: loc.weather,
          lighting: loc.lighting,
          tags: loc.tags,
          referenceImages: loc.referenceImages,
          createdAt: loc.createdAt,
          updatedAt: loc.updatedAt,
        });
      }
    }

    const assetsDir = path.join(projectPath, 'assets');
    if (fs.existsSync(assetsDir)) {
      for (const typeDir of fs.readdirSync(assetsDir)) {
        const typePath = path.join(assetsDir, typeDir);
        if (!fs.statSync(typePath).isDirectory()) continue;
        for (const prefixDir of fs.readdirSync(typePath)) {
          const prefixPath = path.join(typePath, prefixDir);
          if (!fs.statSync(prefixPath).isDirectory()) continue;
          for (const file of fs.readdirSync(prefixPath)) {
            if (!file.endsWith('.meta.json')) continue;
            const meta = JSON.parse(
              fs.readFileSync(path.join(prefixPath, file), 'utf-8'),
            ) as AssetMetaInput;
            this.insertAsset({ ...meta, projectId });
          }
        }
      }
    }
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
