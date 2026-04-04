import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AssetMeta,
  Canvas,
  Job,
  JobStatus,
  ProjectManifest,
  Character,
  Equipment,
  Location,
  Scene,
  ScriptDocument,
  ParsedScene,
  ColorStyle,
  Series,
  WorkflowRun,
  WorkflowStageRun,
  WorkflowTaskRun,
  WorkflowArtifact,
  WorkflowArtifactSummary,
  WorkflowTaskSummary,
} from '@lucid-fin/contracts';
import type BetterSqlite3 from 'better-sqlite3';

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
  project_id  TEXT
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

// Migrate old characters table (P0 schema) to P1 schema with new columns
const MIGRATIONS_SQL = `
-- Add new columns to characters if they don't exist (safe for fresh DBs too)
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we catch errors in code
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
  }

  close(): void {
    this.db.close();
  }

  /** Run integrity check — throws if DB is corrupted */
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
    // Re-open creates a fresh DB, constructor re-runs schema
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
    this.migrateCharacters();
    this.migrateJobs();
    this.migrateCanvases();
    // Try to recover data from the corrupt backup
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
      /* backup unreadable — fresh DB is still valid */
    }
  }

  /** Migrate P0 characters table to P1+ schema (add missing columns) */
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

  // --- Assets ---

  insertAsset(meta: AssetMeta & { projectId?: string }): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO assets (hash, type, format, tags, prompt, provider, created_at, file_size, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        meta.hash,
        meta.type,
        meta.format,
        JSON.stringify(meta.tags),
        meta.prompt ?? null,
        meta.provider ?? null,
        meta.createdAt,
        meta.fileSize,
        meta.projectId ?? null,
      );
  }

  queryAssets(filter: {
    type?: string;
    projectId?: string;
    limit?: number;
    offset?: number;
  }): AssetMeta[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }
    if (filter.projectId) {
      conditions.push('project_id = ?');
      params.push(filter.projectId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const rows = this.db
      .prepare(`SELECT * FROM assets ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      hash: r.hash as string,
      type: r.type as AssetMeta['type'],
      format: r.format as string,
      originalName: '',
      fileSize: r.file_size as number,
      tags: JSON.parse((r.tags as string) || '[]'),
      prompt: r.prompt as string | undefined,
      provider: r.provider as string | undefined,
      createdAt: r.created_at as number,
    }));
  }

  searchAssets(query: string, limit = 50, projectId?: string): AssetMeta[] {
    const projectFilter = projectId ? 'AND a.project_id = ?' : '';
    const params: unknown[] = projectId ? [query, projectId, limit] : [query, limit];
    const rows = this.db
      .prepare(
        `
      SELECT a.* FROM assets a
      JOIN assets_fts f ON a.rowid = f.rowid
      WHERE assets_fts MATCH ?
      ${projectFilter}
      LIMIT ?
    `,
      )
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      hash: r.hash as string,
      type: r.type as AssetMeta['type'],
      format: r.format as string,
      originalName: '',
      fileSize: r.file_size as number,
      tags: JSON.parse((r.tags as string) || '[]'),
      prompt: r.prompt as string | undefined,
      provider: r.provider as string | undefined,
      createdAt: r.created_at as number,
    }));
  }

  // --- Projects ---

  upsertProject(project: {
    id: string;
    title: string;
    path: string;
    seriesId?: string;
    updatedAt: number;
    thumbnail?: string;
  }): void {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO projects (id, title, path, series_id, updated_at, thumbnail)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        project.id,
        project.title,
        project.path,
        project.seriesId ?? null,
        project.updatedAt,
        project.thumbnail ?? null,
      );
  }

  listProjects(): Array<{
    id: string;
    title: string;
    path: string;
    updatedAt: number;
    thumbnail?: string;
  }> {
    return this.db
      .prepare(
        'SELECT id, title, path, updated_at as updatedAt, thumbnail FROM projects ORDER BY updated_at DESC',
      )
      .all() as Array<{
      id: string;
      title: string;
      path: string;
      updatedAt: number;
      thumbnail?: string;
    }>;
  }

  // --- Workflow Runs ---

  insertWorkflowRun(run: WorkflowRun): void {
    this.db
      .prepare(
        `
      INSERT INTO workflow_runs (
        id, workflow_type, project_id, entity_type, entity_id, trigger_source,
        status, summary, progress, completed_stages, total_stages,
        completed_tasks, total_tasks, current_stage_id, current_task_id,
        input_json, output_json, error_text, metadata_json,
        created_at, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        run.id,
        run.workflowType,
        run.projectId,
        run.entityType,
        run.entityId ?? null,
        run.triggerSource,
        run.status,
        run.summary,
        run.progress,
        run.completedStages,
        run.totalStages,
        run.completedTasks,
        run.totalTasks,
        run.currentStageId ?? null,
        run.currentTaskId ?? null,
        JSON.stringify(run.input),
        JSON.stringify(run.output),
        run.error ?? null,
        JSON.stringify(run.metadata),
        run.createdAt,
        run.startedAt ?? null,
        run.completedAt ?? null,
        run.updatedAt,
      );
  }

  getWorkflowRun(id: string): WorkflowRun | undefined {
    const row = this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return this.rowToWorkflowRun(row);
  }

  listWorkflowRuns(filter?: {
    projectId?: string;
    status?: string;
    workflowType?: string;
    entityType?: string;
  }): WorkflowRun[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.projectId) {
      conditions.push('project_id = ?');
      params.push(filter.projectId);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.workflowType) {
      conditions.push('workflow_type = ?');
      params.push(filter.workflowType);
    }
    if (filter?.entityType) {
      conditions.push('entity_type = ?');
      params.push(filter.entityType);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM workflow_runs ${where} ORDER BY updated_at DESC, created_at DESC`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToWorkflowRun(row));
  }

  updateWorkflowRun(
    id: string,
    updates: Partial<
      Pick<
        WorkflowRun,
        | 'status'
        | 'summary'
        | 'progress'
        | 'completedStages'
        | 'totalStages'
        | 'completedTasks'
        | 'totalTasks'
        | 'currentStageId'
        | 'currentTaskId'
        | 'input'
        | 'output'
        | 'error'
        | 'metadata'
        | 'startedAt'
        | 'completedAt'
        | 'updatedAt'
      >
    >,
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.status !== undefined) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.summary !== undefined) {
      sets.push('summary = ?');
      params.push(updates.summary);
    }
    if (updates.progress !== undefined) {
      sets.push('progress = ?');
      params.push(updates.progress);
    }
    if (updates.completedStages !== undefined) {
      sets.push('completed_stages = ?');
      params.push(updates.completedStages);
    }
    if (updates.totalStages !== undefined) {
      sets.push('total_stages = ?');
      params.push(updates.totalStages);
    }
    if (updates.completedTasks !== undefined) {
      sets.push('completed_tasks = ?');
      params.push(updates.completedTasks);
    }
    if (updates.totalTasks !== undefined) {
      sets.push('total_tasks = ?');
      params.push(updates.totalTasks);
    }
    if (updates.currentStageId !== undefined) {
      sets.push('current_stage_id = ?');
      params.push(updates.currentStageId ?? null);
    } else if (
      updates.status === 'completed' ||
      updates.status === 'completed_with_errors' ||
      updates.status === 'cancelled'
    ) {
      sets.push('current_stage_id = NULL');
    }
    if (updates.currentTaskId !== undefined) {
      sets.push('current_task_id = ?');
      params.push(updates.currentTaskId ?? null);
    } else if (
      updates.status === 'completed' ||
      updates.status === 'completed_with_errors' ||
      updates.status === 'cancelled'
    ) {
      sets.push('current_task_id = NULL');
    }
    if (updates.input !== undefined) {
      sets.push('input_json = ?');
      params.push(JSON.stringify(updates.input));
    }
    if (updates.output !== undefined) {
      sets.push('output_json = ?');
      params.push(JSON.stringify(updates.output));
    }
    if (updates.error !== undefined) {
      sets.push('error_text = ?');
      params.push(updates.error);
    }
    if (updates.metadata !== undefined) {
      sets.push('metadata_json = ?');
      params.push(JSON.stringify(updates.metadata));
    }
    if (updates.startedAt !== undefined) {
      sets.push('started_at = ?');
      params.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      sets.push('completed_at = ?');
      params.push(updates.completedAt);
    }
    if (updates.updatedAt !== undefined) {
      sets.push('updated_at = ?');
      params.push(updates.updatedAt);
    }

    if (sets.length === 0) return;
    params.push(id);
    this.db.prepare(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  insertWorkflowStageRun(stageRun: WorkflowStageRun): void {
    this.db
      .prepare(
        `
      INSERT INTO workflow_stage_runs (
        id, workflow_run_id, stage_id, name, status, stage_order,
        progress, completed_tasks, total_tasks, error_text, metadata_json,
        started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        stageRun.id,
        stageRun.workflowRunId,
        stageRun.stageId,
        stageRun.name,
        stageRun.status,
        stageRun.order,
        stageRun.progress,
        stageRun.completedTasks,
        stageRun.totalTasks,
        stageRun.error ?? null,
        JSON.stringify(stageRun.metadata),
        stageRun.startedAt ?? null,
        stageRun.completedAt ?? null,
        stageRun.updatedAt,
      );
  }

  listWorkflowStageRuns(workflowRunId: string): WorkflowStageRun[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM workflow_stage_runs WHERE workflow_run_id = ? ORDER BY stage_order ASC',
      )
      .all(workflowRunId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToWorkflowStageRun(row));
  }

  getWorkflowStageRun(id: string): WorkflowStageRun | undefined {
    const row = this.db.prepare('SELECT * FROM workflow_stage_runs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return this.rowToWorkflowStageRun(row);
  }

  updateWorkflowStageRun(
    id: string,
    updates: Partial<
      Pick<
        WorkflowStageRun,
        | 'status'
        | 'progress'
        | 'completedTasks'
        | 'totalTasks'
        | 'error'
        | 'metadata'
        | 'startedAt'
        | 'completedAt'
        | 'updatedAt'
      >
    >,
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.status !== undefined) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.progress !== undefined) {
      sets.push('progress = ?');
      params.push(updates.progress);
    }
    if (updates.completedTasks !== undefined) {
      sets.push('completed_tasks = ?');
      params.push(updates.completedTasks);
    }
    if (updates.totalTasks !== undefined) {
      sets.push('total_tasks = ?');
      params.push(updates.totalTasks);
    }
    if (updates.error !== undefined) {
      sets.push('error_text = ?');
      params.push(updates.error);
    }
    if (updates.metadata !== undefined) {
      sets.push('metadata_json = ?');
      params.push(JSON.stringify(updates.metadata));
    }
    if (updates.startedAt !== undefined) {
      sets.push('started_at = ?');
      params.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      sets.push('completed_at = ?');
      params.push(updates.completedAt);
    }
    if (updates.updatedAt !== undefined) {
      sets.push('updated_at = ?');
      params.push(updates.updatedAt);
    }

    if (sets.length === 0) return;
    params.push(id);
    this.db
      .prepare(`UPDATE workflow_stage_runs SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params);
  }

  insertWorkflowTaskRun(taskRun: WorkflowTaskRun): void {
    this.db
      .prepare(
        `
      INSERT INTO workflow_task_runs (
        id, workflow_run_id, stage_run_id, task_id, name, kind, status,
        provider, dependency_ids_json, attempts, max_retries,
        input_json, output_json, provider_task_id, asset_id, error_text,
        progress, current_step, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        taskRun.id,
        taskRun.workflowRunId,
        taskRun.stageRunId,
        taskRun.taskId,
        taskRun.name,
        taskRun.kind,
        taskRun.status,
        taskRun.provider ?? null,
        JSON.stringify(taskRun.dependencyIds),
        taskRun.attempts,
        taskRun.maxRetries,
        JSON.stringify(taskRun.input),
        JSON.stringify(taskRun.output),
        taskRun.providerTaskId ?? null,
        taskRun.assetId ?? null,
        taskRun.error ?? null,
        taskRun.progress,
        taskRun.currentStep ?? null,
        taskRun.startedAt ?? null,
        taskRun.completedAt ?? null,
        taskRun.updatedAt,
      );

    this.replaceWorkflowTaskDependencies(taskRun.id, taskRun.dependencyIds);
  }

  listWorkflowTaskRuns(workflowRunId: string): WorkflowTaskRun[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM workflow_task_runs WHERE workflow_run_id = ? ORDER BY updated_at DESC, id ASC',
      )
      .all(workflowRunId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToWorkflowTaskRun(row));
  }

  listWorkflowTaskRunsByStage(stageRunId: string): WorkflowTaskRun[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM workflow_task_runs WHERE stage_run_id = ? ORDER BY updated_at DESC, id ASC',
      )
      .all(stageRunId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToWorkflowTaskRun(row));
  }

  listReadyWorkflowTasks(workflowRunId?: string): WorkflowTaskRun[] {
    const params: unknown[] = ['ready'];
    let where = 'status = ?';

    if (workflowRunId !== undefined) {
      where += ' AND workflow_run_id = ?';
      params.push(workflowRunId);
    }

    const rows = this.db
      .prepare(`SELECT * FROM workflow_task_runs WHERE ${where} ORDER BY updated_at ASC, id ASC`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToWorkflowTaskRun(row));
  }

  listAwaitingProviderTasks(workflowRunId?: string): WorkflowTaskRun[] {
    const params: unknown[] = ['awaiting_provider'];
    let where = 'status = ?';

    if (workflowRunId !== undefined) {
      where += ' AND workflow_run_id = ?';
      params.push(workflowRunId);
    }

    const rows = this.db
      .prepare(`SELECT * FROM workflow_task_runs WHERE ${where} ORDER BY updated_at ASC, id ASC`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToWorkflowTaskRun(row));
  }

  getWorkflowTaskRun(id: string): WorkflowTaskRun | undefined {
    const row = this.db.prepare('SELECT * FROM workflow_task_runs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return this.rowToWorkflowTaskRun(row);
  }

  updateWorkflowTaskRun(
    id: string,
    updates: Partial<
      Pick<
        WorkflowTaskRun,
        | 'status'
        | 'provider'
        | 'dependencyIds'
        | 'attempts'
        | 'maxRetries'
        | 'input'
        | 'output'
        | 'providerTaskId'
        | 'assetId'
        | 'error'
        | 'progress'
        | 'currentStep'
        | 'startedAt'
        | 'completedAt'
        | 'updatedAt'
      >
    >,
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.status !== undefined) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.provider !== undefined) {
      sets.push('provider = ?');
      params.push(updates.provider);
    }
    if (updates.dependencyIds !== undefined) {
      sets.push('dependency_ids_json = ?');
      params.push(JSON.stringify(updates.dependencyIds));
    }
    if (updates.attempts !== undefined) {
      sets.push('attempts = ?');
      params.push(updates.attempts);
    }
    if (updates.maxRetries !== undefined) {
      sets.push('max_retries = ?');
      params.push(updates.maxRetries);
    }
    if (updates.input !== undefined) {
      sets.push('input_json = ?');
      params.push(JSON.stringify(updates.input));
    }
    if (updates.output !== undefined) {
      sets.push('output_json = ?');
      params.push(JSON.stringify(updates.output));
    }
    if (updates.providerTaskId !== undefined) {
      sets.push('provider_task_id = ?');
      params.push(updates.providerTaskId);
    }
    if (updates.assetId !== undefined) {
      sets.push('asset_id = ?');
      params.push(updates.assetId);
    }
    if (updates.error !== undefined) {
      sets.push('error_text = ?');
      params.push(updates.error);
    }
    if (updates.progress !== undefined) {
      sets.push('progress = ?');
      params.push(updates.progress);
    }
    if (updates.currentStep !== undefined) {
      sets.push('current_step = ?');
      params.push(updates.currentStep);
    }
    if (updates.startedAt !== undefined) {
      sets.push('started_at = ?');
      params.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      sets.push('completed_at = ?');
      params.push(updates.completedAt);
    }
    if (updates.updatedAt !== undefined) {
      sets.push('updated_at = ?');
      params.push(updates.updatedAt);
    }

    if (sets.length === 0) return;
    params.push(id);
    this.db.prepare(`UPDATE workflow_task_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    if (updates.dependencyIds !== undefined) {
      this.replaceWorkflowTaskDependencies(id, updates.dependencyIds);
    }
  }

  private replaceWorkflowTaskDependencies(taskRunId: string, dependencyIds: string[]): void {
    const replaceDependencies = this.db.transaction((nextDependencyIds: string[]) => {
      this.db
        .prepare('DELETE FROM workflow_task_dependencies WHERE task_run_id = ?')
        .run(taskRunId);
      const insertDependency = this.db.prepare(`
        INSERT OR IGNORE INTO workflow_task_dependencies (task_run_id, depends_on_task_run_id)
        VALUES (?, ?)
      `);
      for (const dependencyId of nextDependencyIds) {
        insertDependency.run(taskRunId, dependencyId);
      }
    });

    replaceDependencies(dependencyIds);
  }

  insertWorkflowTaskDependency(taskRunId: string, dependsOnTaskRunId: string): void {
    this.db
      .prepare(
        `
      INSERT OR IGNORE INTO workflow_task_dependencies (task_run_id, depends_on_task_run_id)
      VALUES (?, ?)
    `,
      )
      .run(taskRunId, dependsOnTaskRunId);

    const dependencyIds = this.listTaskDependencies(taskRunId);
    this.db
      .prepare(
        `
      UPDATE workflow_task_runs
      SET dependency_ids_json = ?
      WHERE id = ?
    `,
      )
      .run(JSON.stringify(dependencyIds), taskRunId);
  }

  listTaskDependencies(taskRunId: string): string[] {
    const rows = this.db
      .prepare(
        'SELECT depends_on_task_run_id FROM workflow_task_dependencies WHERE task_run_id = ? ORDER BY depends_on_task_run_id ASC',
      )
      .all(taskRunId) as Array<{ depends_on_task_run_id: string }>;
    return rows.map((row) => row.depends_on_task_run_id);
  }

  listTaskDependents(dependsOnTaskRunId: string): string[] {
    const rows = this.db
      .prepare(
        'SELECT task_run_id FROM workflow_task_dependencies WHERE depends_on_task_run_id = ? ORDER BY task_run_id ASC',
      )
      .all(dependsOnTaskRunId) as Array<{ task_run_id: string }>;
    return rows.map((row) => row.task_run_id);
  }

  insertWorkflowArtifact(artifact: WorkflowArtifact): void {
    this.db
      .prepare(
        `
      INSERT INTO workflow_artifacts (
        id, workflow_run_id, task_run_id, artifact_type, entity_type,
        entity_id, asset_hash, path, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        artifact.id,
        artifact.workflowRunId,
        artifact.taskRunId,
        artifact.artifactType,
        artifact.entityType ?? null,
        artifact.entityId ?? null,
        artifact.assetHash ?? null,
        artifact.path ?? null,
        JSON.stringify(artifact.metadata),
        artifact.createdAt,
      );
  }

  listWorkflowArtifacts(workflowRunId: string): WorkflowArtifact[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM workflow_artifacts WHERE workflow_run_id = ? ORDER BY created_at DESC, id ASC',
      )
      .all(workflowRunId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToWorkflowArtifact(row));
  }

  listEntityArtifacts(entityType: string, entityId: string): WorkflowArtifact[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM workflow_artifacts WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC, id ASC',
      )
      .all(entityType, entityId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToWorkflowArtifact(row));
  }

  listWorkflowArtifactsByTaskRun(taskRunId: string): WorkflowArtifact[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM workflow_artifacts WHERE task_run_id = ? ORDER BY created_at DESC, id ASC',
      )
      .all(taskRunId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToWorkflowArtifact(row));
  }

  listWorkflowTaskSummaries(filter?: {
    projectId?: string;
    workflowRunId?: string;
    stageRunId?: string;
    status?: WorkflowTaskRun['status'];
    kind?: WorkflowTaskRun['kind'];
    limit?: number;
    offset?: number;
  }): WorkflowTaskSummary[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.projectId) {
      conditions.push('w.project_id = ?');
      params.push(filter.projectId);
    }
    if (filter?.workflowRunId) {
      conditions.push('t.workflow_run_id = ?');
      params.push(filter.workflowRunId);
    }
    if (filter?.stageRunId) {
      conditions.push('t.stage_run_id = ?');
      params.push(filter.stageRunId);
    }
    if (filter?.status) {
      conditions.push('t.status = ?');
      params.push(filter.status);
    }
    if (filter?.kind) {
      conditions.push('t.kind = ?');
      params.push(filter.kind);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit ?? 100;
    const offset = filter?.offset ?? 0;
    const rows = this.db
      .prepare(
        `
      SELECT
        t.*,
        s.stage_id AS stage_id_value,
        w.entity_type AS workflow_entity_type,
        w.entity_id AS workflow_entity_id,
        w.metadata_json AS workflow_metadata_json
      FROM workflow_task_runs t
      JOIN workflow_stage_runs s ON s.id = t.stage_run_id
      JOIN workflow_runs w ON w.id = t.workflow_run_id
      ${where}
      ORDER BY t.updated_at DESC, t.id ASC
      LIMIT ? OFFSET ?
    `,
      )
      .all(...params, limit, offset) as Array<Record<string, unknown>>;

    return rows.map((row) => this.rowToWorkflowTaskSummary(row));
  }

  recomputeStageAggregate(stageRunId: string): void {
    const stageRow = this.db
      .prepare('SELECT workflow_run_id, updated_at FROM workflow_stage_runs WHERE id = ?')
      .get(stageRunId) as { workflow_run_id: string; updated_at: number } | undefined;
    if (!stageRow) {
      return;
    }

    const taskRows = this.db
      .prepare(
        'SELECT id, status, progress, updated_at FROM workflow_task_runs WHERE stage_run_id = ? ORDER BY updated_at DESC, id ASC',
      )
      .all(stageRunId) as Array<{
      id: string;
      status: WorkflowTaskRun['status'];
      progress: number | null;
      updated_at: number;
    }>;

    const totalTasks = taskRows.length;
    const completedTasks = taskRows.filter((task) => task.status === 'completed').length;
    const hasRunning = taskRows.some(
      (task) => task.status === 'running' || task.status === 'awaiting_provider',
    );
    const hasFailed = taskRows.some(
      (task) => task.status === 'failed' || task.status === 'retryable_failed',
    );
    const hasCancelled = taskRows.some((task) => task.status === 'cancelled');
    const hasBlocked = taskRows.some((task) => task.status === 'blocked');
    const hasReady = taskRows.some((task) => task.status === 'ready');
    const allTerminal =
      totalTasks > 0 &&
      taskRows.every(
        (task) =>
          task.status === 'completed' ||
          task.status === 'skipped' ||
          task.status === 'failed' ||
          task.status === 'retryable_failed' ||
          task.status === 'cancelled',
      );
    const allCompleteLike =
      totalTasks > 0 &&
      taskRows.every((task) => task.status === 'completed' || task.status === 'skipped');
    const hasCompletedWithErrors = allTerminal && hasFailed && completedTasks > 0;

    let status: WorkflowStageRun['status'] = 'pending';
    if (hasRunning) {
      status = 'running';
    } else if (hasCompletedWithErrors) {
      status = 'completed_with_errors';
    } else if (hasFailed) {
      status = 'failed';
    } else if (hasCancelled) {
      status = 'cancelled';
    } else if (allCompleteLike) {
      status = 'completed';
    } else if (hasBlocked) {
      status = 'blocked';
    } else if (hasReady) {
      status = 'ready';
    }

    const progress =
      allCompleteLike || hasCompletedWithErrors
        ? 100
        : totalTasks === 0
          ? 0
          : Math.round(
              taskRows.reduce((sum, task) => sum + Number(task.progress ?? 0), 0) / totalTasks,
            );
    const updatedAt = Math.max(stageRow.updated_at, ...taskRows.map((task) => task.updated_at));

    this.updateWorkflowStageRun(stageRunId, {
      status,
      totalTasks,
      completedTasks,
      progress,
      updatedAt,
    });
  }

  recomputeWorkflowAggregate(workflowRunId: string): void {
    const workflow = this.getWorkflowRun(workflowRunId);
    if (!workflow) {
      return;
    }

    const stages = this.listWorkflowStageRuns(workflowRunId);
    const tasks = this.listWorkflowTaskRuns(workflowRunId);
    const totalStages = stages.length;
    const completedStages = stages.filter((stage) => stage.status === 'completed').length;
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((task) => task.status === 'completed').length;

    const hasRunningTask = tasks.some(
      (task) => task.status === 'running' || task.status === 'awaiting_provider',
    );
    const hasFailedStage = stages.some((stage) => stage.status === 'failed');
    const hasFailedTask = tasks.some(
      (task) => task.status === 'failed' || task.status === 'retryable_failed',
    );
    const hasCancelled =
      stages.some((stage) => stage.status === 'cancelled') ||
      tasks.some((task) => task.status === 'cancelled');
    const hasBlocked =
      stages.some((stage) => stage.status === 'blocked') ||
      tasks.some((task) => task.status === 'blocked');
    const hasReady =
      stages.some((stage) => stage.status === 'ready') ||
      tasks.some((task) => task.status === 'ready');
    const allStagesCompleted =
      totalStages > 0 && stages.every((stage) => stage.status === 'completed');
    const allStagesTerminal =
      totalStages > 0 &&
      stages.every(
        (stage) =>
          stage.status === 'completed' ||
          stage.status === 'completed_with_errors' ||
          stage.status === 'failed' ||
          stage.status === 'cancelled' ||
          stage.status === 'skipped',
      );
    const hasCompletedWithErrors =
      allStagesTerminal &&
      stages.some((stage) => stage.status === 'completed_with_errors') &&
      completedTasks > 0;

    let status: WorkflowRun['status'];
    if (hasRunningTask) {
      status = 'running';
    } else if (hasCompletedWithErrors) {
      status = 'completed_with_errors';
    } else if (hasFailedStage || hasFailedTask) {
      status = 'failed';
    } else if (hasCancelled) {
      status = 'cancelled';
    } else if (allStagesCompleted) {
      status = 'completed';
    } else if (hasBlocked) {
      status = 'blocked';
    } else if (hasReady) {
      status = 'ready';
    } else {
      status = 'pending';
    }

    const progress =
      status === 'completed' || status === 'completed_with_errors' || status === 'cancelled'
        ? 100
        : totalStages === 0
          ? 0
          : Math.round(stages.reduce((sum, stage) => sum + stage.progress, 0) / totalStages);

    const currentStage =
      status === 'completed' || status === 'completed_with_errors' || status === 'cancelled'
        ? undefined
        : (stages.find((stage) => stage.status === 'running') ??
          stages.find(
            (stage) =>
              stage.status !== 'completed' &&
              stage.status !== 'completed_with_errors' &&
              stage.status !== 'skipped' &&
              stage.status !== 'cancelled',
          ));
    const currentTask =
      status === 'completed' || status === 'completed_with_errors' || status === 'cancelled'
        ? undefined
        : (tasks.find((task) => task.status === 'running' || task.status === 'awaiting_provider') ??
          tasks.find(
            (task) =>
              task.status !== 'completed' &&
              task.status !== 'skipped' &&
              task.status !== 'cancelled',
          ));

    const summary = `${status} ${completedStages}/${totalStages} stages, ${completedTasks}/${totalTasks} tasks`;
    const updatedAt = Math.max(
      workflow.updatedAt,
      ...stages.map((stage) => stage.updatedAt),
      ...tasks.map((task) => task.updatedAt),
    );

    this.updateWorkflowRun(workflowRunId, {
      status,
      progress,
      completedStages,
      totalStages,
      completedTasks,
      totalTasks,
      currentStageId: currentStage?.id,
      currentTaskId: currentTask?.id,
      summary,
      updatedAt,
    });
  }

  private rowToWorkflowRun(row: Record<string, unknown>): WorkflowRun {
    return {
      id: row.id as string,
      workflowType: row.workflow_type as string,
      projectId: row.project_id as string,
      entityType: row.entity_type as string,
      entityId: row.entity_id == null ? undefined : String(row.entity_id),
      triggerSource: row.trigger_source as string,
      status: row.status as WorkflowRun['status'],
      summary: (row.summary as string) ?? '',
      progress: Number(row.progress ?? 0),
      completedStages: Number(row.completed_stages ?? 0),
      totalStages: Number(row.total_stages ?? 0),
      completedTasks: Number(row.completed_tasks ?? 0),
      totalTasks: Number(row.total_tasks ?? 0),
      currentStageId: row.current_stage_id == null ? undefined : String(row.current_stage_id),
      currentTaskId: row.current_task_id == null ? undefined : String(row.current_task_id),
      input: JSON.parse((row.input_json as string) || '{}'),
      output: JSON.parse((row.output_json as string) || '{}'),
      error: row.error_text == null ? undefined : String(row.error_text),
      metadata: JSON.parse((row.metadata_json as string) || '{}'),
      createdAt: row.created_at as number,
      startedAt: row.started_at == null ? undefined : Number(row.started_at),
      completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
      updatedAt: row.updated_at as number,
    };
  }

  private rowToWorkflowStageRun(row: Record<string, unknown>): WorkflowStageRun {
    return {
      id: row.id as string,
      workflowRunId: row.workflow_run_id as string,
      stageId: row.stage_id as string,
      name: row.name as string,
      status: row.status as WorkflowStageRun['status'],
      order: Number(row.stage_order ?? 0),
      progress: Number(row.progress ?? 0),
      completedTasks: Number(row.completed_tasks ?? 0),
      totalTasks: Number(row.total_tasks ?? 0),
      error: row.error_text == null ? undefined : String(row.error_text),
      metadata: JSON.parse((row.metadata_json as string) || '{}'),
      startedAt: row.started_at == null ? undefined : Number(row.started_at),
      completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
      updatedAt: row.updated_at as number,
    };
  }

  private rowToWorkflowTaskRun(row: Record<string, unknown>): WorkflowTaskRun {
    return {
      id: row.id as string,
      workflowRunId: row.workflow_run_id as string,
      stageRunId: row.stage_run_id as string,
      taskId: row.task_id as string,
      name: row.name as string,
      kind: row.kind as WorkflowTaskRun['kind'],
      status: row.status as WorkflowTaskRun['status'],
      provider: row.provider == null ? undefined : String(row.provider),
      dependencyIds: this.listTaskDependencies(row.id as string),
      attempts: Number(row.attempts ?? 0),
      maxRetries: Number(row.max_retries ?? 0),
      input: JSON.parse((row.input_json as string) || '{}'),
      output: JSON.parse((row.output_json as string) || '{}'),
      providerTaskId: row.provider_task_id == null ? undefined : String(row.provider_task_id),
      assetId: row.asset_id == null ? undefined : String(row.asset_id),
      error: row.error_text == null ? undefined : String(row.error_text),
      progress: Number(row.progress ?? 0),
      currentStep: row.current_step == null ? undefined : String(row.current_step),
      startedAt: row.started_at == null ? undefined : Number(row.started_at),
      completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
      updatedAt: row.updated_at as number,
    };
  }

  private rowToWorkflowArtifact(row: Record<string, unknown>): WorkflowArtifact {
    return {
      id: row.id as string,
      workflowRunId: row.workflow_run_id as string,
      taskRunId: row.task_run_id as string,
      artifactType: row.artifact_type as string,
      entityType: row.entity_type == null ? undefined : String(row.entity_type),
      entityId: row.entity_id == null ? undefined : String(row.entity_id),
      assetHash: row.asset_hash == null ? undefined : String(row.asset_hash),
      path: row.path == null ? undefined : String(row.path),
      metadata: JSON.parse((row.metadata_json as string) || '{}'),
      createdAt: row.created_at as number,
    };
  }

  private rowToWorkflowTaskSummary(row: Record<string, unknown>): WorkflowTaskSummary {
    const taskInput = this.parseJsonRecord(row.input_json);
    const taskOutput = this.parseJsonRecord(row.output_json);
    const workflowMetadata = this.parseJsonRecord(row.workflow_metadata_json);
    const taskMetadata = this.getProjectionSources(taskInput, taskOutput);
    const workflowSources = this.getProjectionSources(workflowMetadata);
    const producedArtifacts = this.listWorkflowArtifactsByTaskRun(row.id as string).map(
      (artifact) => this.toWorkflowArtifactSummary(artifact),
    );

    return {
      id: row.id as string,
      workflowRunId: row.workflow_run_id as string,
      stageRunId: row.stage_run_id as string,
      taskId: row.task_id as string,
      stageId: row.stage_id_value == null ? undefined : String(row.stage_id_value),
      name: row.name == null ? undefined : String(row.name),
      kind: row.kind as WorkflowTaskRun['kind'],
      status: row.status as WorkflowTaskRun['status'],
      progress: Number(row.progress ?? 0),
      currentStep: row.current_step == null ? undefined : String(row.current_step),
      displayCategory:
        this.pickProjectionString(taskMetadata, ['displayCategory', 'category']) ??
        this.pickProjectionString(workflowSources, ['displayCategory', 'category']) ??
        String(row.kind),
      displayLabel:
        this.pickProjectionString(taskMetadata, ['displayLabel', 'label', 'name']) ??
        (row.name as string),
      relatedEntityType:
        this.pickProjectionString(taskMetadata, ['relatedEntityType']) ??
        (row.workflow_entity_type == null ? undefined : String(row.workflow_entity_type)),
      relatedEntityId:
        this.pickProjectionString(taskMetadata, ['relatedEntityId']) ??
        (row.workflow_entity_id == null ? undefined : String(row.workflow_entity_id)),
      relatedEntityLabel:
        this.pickProjectionString(taskMetadata, ['relatedEntityLabel']) ??
        this.pickProjectionString(workflowSources, ['relatedEntityLabel']),
      provider:
        row.provider == null
          ? (this.pickProjectionString(taskMetadata, ['provider']) ??
            this.pickProjectionString(workflowSources, ['provider']))
          : String(row.provider),
      modelKey:
        this.pickProjectionString(taskMetadata, ['modelKey']) ??
        this.pickProjectionString(workflowSources, ['modelKey']),
      promptTemplateId:
        this.pickProjectionString(taskMetadata, ['promptTemplateId']) ??
        this.pickProjectionString(workflowSources, ['promptTemplateId']),
      promptTemplateVersion:
        this.pickProjectionString(taskMetadata, ['promptTemplateVersion']) ??
        this.pickProjectionString(workflowSources, ['promptTemplateVersion']),
      summary:
        this.pickProjectionString(taskMetadata, ['summary', 'description']) ??
        this.pickProjectionString(workflowSources, ['summary']),
      error: row.error_text == null ? undefined : String(row.error_text),
      attempts: Number(row.attempts ?? 0),
      maxRetries: Number(row.max_retries ?? 0),
      assetId: row.asset_id == null ? undefined : String(row.asset_id),
      startedAt: row.started_at == null ? undefined : Number(row.started_at),
      completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
      updatedAt: row.updated_at as number,
      producedArtifacts,
    };
  }

  private toWorkflowArtifactSummary(artifact: WorkflowArtifact): WorkflowArtifactSummary {
    return {
      id: artifact.id,
      artifactType: artifact.artifactType,
      entityType: artifact.entityType,
      entityId: artifact.entityId,
      assetHash: artifact.assetHash,
      path: artifact.path,
      createdAt: artifact.createdAt,
    };
  }

  private parseJsonRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string' || value.length === 0) {
      return {};
    }

    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private getProjectionSources(
    ...records: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> {
    const sources: Array<Record<string, unknown>> = [];

    for (const record of records) {
      if (!record || typeof record !== 'object') {
        continue;
      }

      sources.push(record);

      for (const nestedKey of ['display', 'ui', 'metadata']) {
        const nested = record[nestedKey];
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
          sources.push(nested as Record<string, unknown>);
        }
      }
    }

    return sources;
  }

  private pickProjectionString(
    sources: Array<Record<string, unknown>>,
    keys: string[],
  ): string | undefined {
    for (const source of sources) {
      for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.length > 0) {
          return value;
        }
      }
    }

    return undefined;
  }

  // --- Jobs (sole source of truth) ---

  insertJob(job: Job): void {
    this.db
      .prepare(
        `
      INSERT INTO jobs (id, project_id, segment_id, type, provider, status, priority, prompt, params, result, cost, attempts, max_retries, progress, completed_steps, total_steps, current_step, batch_id, batch_index, created_at, started_at, completed_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        job.id,
        job.projectId,
        job.segmentId ?? null,
        job.type,
        job.provider,
        job.status,
        job.priority,
        job.prompt,
        job.params ? JSON.stringify(job.params) : null,
        job.result ? JSON.stringify(job.result) : null,
        job.cost ?? null,
        job.attempts,
        job.maxRetries,
        job.progress ?? null,
        job.completedSteps ?? null,
        job.totalSteps ?? null,
        job.currentStep ?? null,
        job.batchId ?? null,
        job.batchIndex ?? null,
        job.createdAt,
        job.startedAt ?? null,
        job.completedAt ?? null,
        job.error ?? null,
      );
  }

  updateJob(
    jobId: string,
    updates: Partial<
      Pick<
        Job,
        | 'status'
        | 'result'
        | 'cost'
        | 'attempts'
        | 'progress'
        | 'completedSteps'
        | 'totalSteps'
        | 'currentStep'
        | 'startedAt'
        | 'completedAt'
        | 'error'
      >
    >,
  ): void {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.status !== undefined) {
      sets.push('status = ?');
      params.push(updates.status);
    }
    if (updates.result !== undefined) {
      sets.push('result = ?');
      params.push(JSON.stringify(updates.result));
    }
    if (updates.cost !== undefined) {
      sets.push('cost = ?');
      params.push(updates.cost);
    }
    if (updates.attempts !== undefined) {
      sets.push('attempts = ?');
      params.push(updates.attempts);
    }
    if (updates.progress !== undefined) {
      sets.push('progress = ?');
      params.push(updates.progress);
    }
    if (updates.completedSteps !== undefined) {
      sets.push('completed_steps = ?');
      params.push(updates.completedSteps);
    }
    if (updates.totalSteps !== undefined) {
      sets.push('total_steps = ?');
      params.push(updates.totalSteps);
    }
    if (updates.currentStep !== undefined) {
      sets.push('current_step = ?');
      params.push(updates.currentStep);
    }
    if (updates.startedAt !== undefined) {
      sets.push('started_at = ?');
      params.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      sets.push('completed_at = ?');
      params.push(updates.completedAt);
    }
    if (updates.error !== undefined) {
      sets.push('error = ?');
      params.push(updates.error);
    }

    if (sets.length === 0) return;
    params.push(jobId);
    this.db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  getJob(jobId: string): Job | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return this.rowToJob(row);
  }

  listJobs(filter?: { projectId?: string; status?: string }): Job[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.projectId) {
      conditions.push('project_id = ?');
      params.push(filter.projectId);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM jobs ${where} ORDER BY priority DESC, created_at ASC`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToJob(r));
  }

  // --- Characters (source of truth) ---

  upsertCharacter(char: {
    id: string;
    name: string;
    projectId?: string;
    role?: string;
    description?: string;
    appearance?: string;
    personality?: string;
    refImage?: string;
    costumes?: unknown[];
    tags?: string[];
    age?: number;
    gender?: string;
    voice?: string;
    referenceImages?: unknown[];
    loadouts?: unknown[];
    defaultLoadoutId?: string;
    createdAt?: number;
    updatedAt?: number;
  }): void {
    const now = Date.now();
    this.db
      .prepare(
        `
      INSERT INTO characters (id, name, project_id, role, description, appearance, personality, ref_image, costumes, tags, age, gender, voice, reference_images, loadouts, default_loadout_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, project_id=excluded.project_id, role=excluded.role,
        description=excluded.description, appearance=excluded.appearance, personality=excluded.personality,
        ref_image=excluded.ref_image, costumes=excluded.costumes, tags=excluded.tags,
        age=excluded.age, gender=excluded.gender, voice=excluded.voice,
        reference_images=excluded.reference_images, loadouts=excluded.loadouts,
        default_loadout_id=excluded.default_loadout_id, updated_at=excluded.updated_at
    `,
      )
      .run(
        char.id,
        char.name,
        char.projectId ?? null,
        char.role ?? 'supporting',
        char.description ?? '',
        char.appearance ?? '',
        char.personality ?? '',
        char.refImage ?? null,
        JSON.stringify(char.costumes ?? []),
        JSON.stringify(char.tags ?? []),
        char.age ?? null,
        char.gender ?? null,
        char.voice ?? null,
        JSON.stringify(char.referenceImages ?? []),
        JSON.stringify(char.loadouts ?? []),
        char.defaultLoadoutId ?? '',
        char.createdAt ?? now,
        char.updatedAt ?? now,
      );
  }

  getCharacter(id: string): Character | undefined {
    const row = this.db.prepare('SELECT * FROM characters WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return this.rowToCharacter(row);
  }

  listCharacters(projectId?: string): Character[] {
    const rows = projectId
      ? (this.db
          .prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY name')
          .all(projectId) as Array<Record<string, unknown>>)
      : (this.db.prepare('SELECT * FROM characters ORDER BY name').all() as Array<
          Record<string, unknown>
        >);
    return rows.map((r) => this.rowToCharacter(r));
  }

  deleteCharacter(id: string): void {
    this.db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  }

  private rowToCharacter(row: Record<string, unknown>): Character {
    return {
      id: row.id as string,
      name: row.name as string,
      projectId: row.project_id as string | undefined,
      role: (row.role as Character['role']) ?? 'supporting',
      description: (row.description as string) ?? '',
      appearance: (row.appearance as string) ?? '',
      personality: (row.personality as string) ?? '',
      referenceImage: row.ref_image as string | undefined,
      costumes: JSON.parse((row.costumes as string) || '[]'),
      tags: JSON.parse((row.tags as string) || '[]'),
      age: (row.age as number | null) ?? undefined,
      gender: (row.gender as Character['gender']) ?? undefined,
      voice: (row.voice as string | null) ?? undefined,
      referenceImages: JSON.parse((row.reference_images as string) || '[]'),
      loadouts: JSON.parse((row.loadouts as string) || '[]'),
      defaultLoadoutId: (row.default_loadout_id as string) ?? '',
      createdAt: (row.created_at as number) ?? Date.now(),
      updatedAt: (row.updated_at as number) ?? Date.now(),
    };
  }

  // --- Equipment (source of truth) ---

  upsertEquipment(equip: {
    id: string;
    projectId: string;
    name: string;
    type?: string;
    subtype?: string;
    description?: string;
    functionDesc?: string;
    tags?: string[];
    referenceImages?: unknown[];
    createdAt?: number;
    updatedAt?: number;
  }): void {
    const now = Date.now();
    this.db
      .prepare(
        `
      INSERT INTO equipment (id, project_id, name, type, subtype, description, function_desc, tags, reference_images, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id=excluded.project_id, name=excluded.name, type=excluded.type,
        subtype=excluded.subtype, description=excluded.description, function_desc=excluded.function_desc,
        tags=excluded.tags, reference_images=excluded.reference_images, updated_at=excluded.updated_at
    `,
      )
      .run(
        equip.id,
        equip.projectId,
        equip.name,
        equip.type ?? 'other',
        equip.subtype ?? null,
        equip.description ?? '',
        equip.functionDesc ?? null,
        JSON.stringify(equip.tags ?? []),
        JSON.stringify(equip.referenceImages ?? []),
        equip.createdAt ?? now,
        equip.updatedAt ?? now,
      );
  }

  getEquipment(id: string): Equipment | undefined {
    const row = this.db.prepare('SELECT * FROM equipment WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return this.rowToEquipment(row);
  }

  listEquipment(projectId: string, type?: string): Equipment[] {
    const rows = type
      ? (this.db
          .prepare('SELECT * FROM equipment WHERE project_id = ? AND type = ? ORDER BY name')
          .all(projectId, type) as Array<Record<string, unknown>>)
      : (this.db
          .prepare('SELECT * FROM equipment WHERE project_id = ? ORDER BY name')
          .all(projectId) as Array<Record<string, unknown>>);
    return rows.map((r) => this.rowToEquipment(r));
  }

  deleteEquipment(id: string): void {
    this.db.prepare('DELETE FROM equipment WHERE id = ?').run(id);
  }

  private rowToEquipment(row: Record<string, unknown>): Equipment {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      name: row.name as string,
      type: (row.type as Equipment['type']) ?? 'other',
      subtype: (row.subtype as string | null) ?? undefined,
      description: (row.description as string) ?? '',
      function: (row.function_desc as string | null) ?? undefined,
      tags: JSON.parse((row.tags as string) || '[]'),
      referenceImages: JSON.parse((row.reference_images as string) || '[]'),
      createdAt: (row.created_at as number) ?? Date.now(),
      updatedAt: (row.updated_at as number) ?? Date.now(),
    };
  }

  // --- Locations (source of truth) ---

  upsertLocation(loc: {
    id: string;
    projectId: string;
    name: string;
    type?: string;
    subLocation?: string;
    description?: string;
    timeOfDay?: string;
    mood?: string;
    weather?: string;
    lighting?: string;
    tags?: string[];
    referenceImages?: unknown[];
    createdAt?: number;
    updatedAt?: number;
  }): void {
    const now = Date.now();
    this.db
      .prepare(
        `
      INSERT INTO locations (id, project_id, name, type, sub_location, description, time_of_day, mood, weather, lighting, tags, reference_images, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id=excluded.project_id, name=excluded.name, type=excluded.type,
        sub_location=excluded.sub_location, description=excluded.description,
        time_of_day=excluded.time_of_day, mood=excluded.mood, weather=excluded.weather,
        lighting=excluded.lighting, tags=excluded.tags, reference_images=excluded.reference_images,
        updated_at=excluded.updated_at
    `,
      )
      .run(
        loc.id,
        loc.projectId,
        loc.name,
        loc.type ?? 'interior',
        loc.subLocation ?? null,
        loc.description ?? '',
        loc.timeOfDay ?? null,
        loc.mood ?? null,
        loc.weather ?? null,
        loc.lighting ?? null,
        JSON.stringify(loc.tags ?? []),
        JSON.stringify(loc.referenceImages ?? []),
        loc.createdAt ?? now,
        loc.updatedAt ?? now,
      );
  }

  getLocation(id: string): Location | undefined {
    const row = this.db.prepare('SELECT * FROM locations WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return this.rowToLocation(row);
  }

  listLocations(projectId: string, type?: string): Location[] {
    const rows = type
      ? (this.db
          .prepare('SELECT * FROM locations WHERE project_id = ? AND type = ? ORDER BY name')
          .all(projectId, type) as Array<Record<string, unknown>>)
      : (this.db
          .prepare('SELECT * FROM locations WHERE project_id = ? ORDER BY name')
          .all(projectId) as Array<Record<string, unknown>>);
    return rows.map((r) => this.rowToLocation(r));
  }

  deleteLocation(id: string): void {
    this.db.prepare('DELETE FROM locations WHERE id = ?').run(id);
  }

  private rowToLocation(row: Record<string, unknown>): Location {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      name: row.name as string,
      type: (row.type as Location['type']) ?? 'interior',
      subLocation: (row.sub_location as string | null) ?? undefined,
      description: (row.description as string) ?? '',
      timeOfDay: (row.time_of_day as string | null) ?? undefined,
      mood: (row.mood as string | null) ?? undefined,
      weather: (row.weather as string | null) ?? undefined,
      lighting: (row.lighting as string | null) ?? undefined,
      tags: JSON.parse((row.tags as string) || '[]'),
      referenceImages: JSON.parse((row.reference_images as string) || '[]'),
      createdAt: (row.created_at as number) ?? Date.now(),
      updatedAt: (row.updated_at as number) ?? Date.now(),
    };
  }

  // --- Scenes (source of truth) ---

  upsertScene(scene: Scene): void {
    this.db
      .prepare(
        `
      INSERT INTO scenes (id, project_id, idx, title, description, location, time_of_day, characters, keyframes, segments, style_override, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id=excluded.project_id, idx=excluded.idx, title=excluded.title,
        description=excluded.description, location=excluded.location, time_of_day=excluded.time_of_day,
        characters=excluded.characters, keyframes=excluded.keyframes, segments=excluded.segments,
        style_override=excluded.style_override, updated_at=excluded.updated_at
    `,
      )
      .run(
        scene.id,
        scene.projectId,
        scene.index,
        scene.title,
        scene.description ?? '',
        scene.location ?? '',
        scene.timeOfDay ?? '',
        JSON.stringify(scene.characters ?? []),
        JSON.stringify(scene.keyframes ?? []),
        JSON.stringify(scene.segments ?? []),
        scene.styleOverride ? JSON.stringify(scene.styleOverride) : null,
        scene.createdAt,
        scene.updatedAt,
      );
  }

  getScene(id: string): Scene | undefined {
    const row = this.db.prepare('SELECT * FROM scenes WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return this.rowToScene(row);
  }

  listScenes(projectId: string): Scene[] {
    const rows = this.db
      .prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY idx ASC')
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToScene(r));
  }

  deleteScene(id: string): void {
    this.db.prepare('DELETE FROM scenes WHERE id = ?').run(id);
  }

  private rowToScene(row: Record<string, unknown>): Scene {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      index: row.idx as number,
      title: row.title as string,
      description: (row.description as string) ?? '',
      location: (row.location as string) ?? '',
      timeOfDay: (row.time_of_day as string) ?? '',
      characters: JSON.parse((row.characters as string) || '[]'),
      keyframes: JSON.parse((row.keyframes as string) || '[]'),
      segments: JSON.parse((row.segments as string) || '[]'),
      styleOverride: row.style_override ? JSON.parse(row.style_override as string) : undefined,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  // --- Scripts (source of truth) ---

  upsertScript(doc: ScriptDocument): void {
    this.db
      .prepare(
        `
      INSERT INTO scripts (id, project_id, content, format, parsed_scenes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id=excluded.project_id, content=excluded.content, format=excluded.format,
        parsed_scenes=excluded.parsed_scenes, updated_at=excluded.updated_at
    `,
      )
      .run(
        doc.id,
        doc.projectId,
        doc.content,
        doc.format,
        JSON.stringify(doc.parsedScenes ?? []),
        doc.createdAt,
        doc.updatedAt,
      );
  }

  getScript(projectId: string): ScriptDocument | null {
    const row = this.db
      .prepare('SELECT * FROM scripts WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(projectId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToScript(row);
  }

  deleteScript(id: string): void {
    this.db.prepare('DELETE FROM scripts WHERE id = ?').run(id);
  }

  private rowToScript(row: Record<string, unknown>): ScriptDocument {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      content: row.content as string,
      format: row.format as ScriptDocument['format'],
      parsedScenes: JSON.parse((row.parsed_scenes as string) || '[]'),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  // --- Color Styles ---

  upsertColorStyle(cs: ColorStyle): void {
    this.db
      .prepare(
        `
      INSERT INTO color_styles (id, name, source_type, source_asset, palette, gradients, exposure, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, source_type=excluded.source_type, source_asset=excluded.source_asset,
        palette=excluded.palette, gradients=excluded.gradients, exposure=excluded.exposure,
        tags=excluded.tags, updated_at=excluded.updated_at
    `,
      )
      .run(
        cs.id,
        cs.name,
        cs.sourceType,
        cs.sourceAsset ?? null,
        JSON.stringify(cs.palette),
        JSON.stringify(cs.gradients),
        JSON.stringify(cs.exposure),
        JSON.stringify(cs.tags),
        cs.createdAt,
        cs.updatedAt,
      );
  }

  listColorStyles(): ColorStyle[] {
    const rows = this.db
      .prepare('SELECT * FROM color_styles ORDER BY updated_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToColorStyle(r));
  }

  deleteColorStyle(id: string): void {
    this.db.prepare('DELETE FROM color_styles WHERE id = ?').run(id);
  }

  private rowToColorStyle(row: Record<string, unknown>): ColorStyle {
    return {
      id: row.id as string,
      name: row.name as string,
      sourceType: row.source_type as ColorStyle['sourceType'],
      sourceAsset: row.source_asset as string | undefined,
      palette: JSON.parse((row.palette as string) || '[]'),
      gradients: JSON.parse((row.gradients as string) || '[]'),
      exposure: JSON.parse((row.exposure as string) || '{}'),
      tags: JSON.parse((row.tags as string) || '[]'),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  // --- Dependencies ---

  addDependency(sourceType: string, sourceId: string, targetType: string, targetId: string): void {
    this.db
      .prepare(
        `
      INSERT OR IGNORE INTO dependencies (source_type, source_id, target_type, target_id)
      VALUES (?, ?, ?, ?)
    `,
      )
      .run(sourceType, sourceId, targetType, targetId);
  }

  getDependents(
    sourceType: string,
    sourceId: string,
  ): Array<{ targetType: string; targetId: string }> {
    return this.db
      .prepare(
        'SELECT target_type as targetType, target_id as targetId FROM dependencies WHERE source_type = ? AND source_id = ?',
      )
      .all(sourceType, sourceId) as Array<{ targetType: string; targetId: string }>;
  }

  // --- Canvases ---

  upsertCanvas(canvas: Canvas): void {
    this.db
      .prepare(
        `
      INSERT INTO canvases (id, project_id, name, nodes, edges, viewport, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id=excluded.project_id, name=excluded.name,
        nodes=excluded.nodes, edges=excluded.edges, viewport=excluded.viewport,
        notes=excluded.notes, updated_at=excluded.updated_at
    `,
      )
      .run(
        canvas.id,
        canvas.projectId,
        canvas.name,
        JSON.stringify(canvas.nodes ?? []),
        JSON.stringify(canvas.edges ?? []),
        JSON.stringify(canvas.viewport ?? { x: 0, y: 0, zoom: 1 }),
        JSON.stringify(canvas.notes ?? []),
        canvas.createdAt,
        canvas.updatedAt,
      );
  }

  getCanvas(id: string): Canvas | undefined {
    const row = this.db.prepare('SELECT * FROM canvases WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return this.rowToCanvas(row);
  }

  listCanvases(projectId: string): Array<{ id: string; name: string; updatedAt: number }> {
    const rows = this.db
      .prepare('SELECT id, name, updated_at FROM canvases WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      updatedAt: r.updated_at as number,
    }));
  }

  listCanvasesFull(projectId: string): Canvas[] {
    const rows = this.db
      .prepare('SELECT * FROM canvases WHERE project_id = ? ORDER BY updated_at DESC')
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToCanvas(r));
  }

  deleteCanvas(id: string): void {
    this.db.prepare('DELETE FROM canvases WHERE id = ?').run(id);
  }

  private rowToCanvas(row: Record<string, unknown>): Canvas {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      name: row.name as string,
      nodes: JSON.parse((row.nodes as string) || '[]'),
      edges: JSON.parse((row.edges as string) || '[]'),
      viewport: JSON.parse((row.viewport as string) || '{"x":0,"y":0,"zoom":1}'),
      notes: JSON.parse((row.notes as string) || '[]'),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  // --- Series & Episodes ---

  upsertSeries(series: Series): void {
    this.db
      .prepare(
        `
      INSERT INTO series (id, title, description, style_guide, episode_ids, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, description=excluded.description,
        style_guide=excluded.style_guide, episode_ids=excluded.episode_ids,
        updated_at=excluded.updated_at
    `,
      )
      .run(
        series.id,
        series.title,
        series.description ?? '',
        JSON.stringify(series.styleGuide ?? {}),
        JSON.stringify(series.episodeIds ?? []),
        series.createdAt,
        series.updatedAt,
      );
  }

  getSeries(id: string): Series | undefined {
    const row = this.db.prepare('SELECT * FROM series WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id as string,
      title: row.title as string,
      description: (row.description as string) ?? '',
      styleGuide: JSON.parse((row.style_guide as string) || '{}'),
      episodeIds: JSON.parse((row.episode_ids as string) || '[]'),
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  deleteSeries(id: string): void {
    this.db.prepare('DELETE FROM series WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM episodes WHERE series_id = ?').run(id);
  }

  upsertEpisode(episode: {
    id: string;
    seriesId: string;
    title: string;
    order: number;
    projectId?: string;
    status?: string;
    createdAt: number;
    updatedAt: number;
  }): void {
    this.db
      .prepare(
        `
      INSERT INTO episodes (id, series_id, title, episode_order, project_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        series_id=excluded.series_id, title=excluded.title, episode_order=excluded.episode_order,
        project_id=excluded.project_id, status=excluded.status, updated_at=excluded.updated_at
    `,
      )
      .run(
        episode.id,
        episode.seriesId,
        episode.title,
        episode.order,
        episode.projectId ?? null,
        episode.status ?? 'draft',
        episode.createdAt,
        episode.updatedAt,
      );
  }

  listEpisodes(seriesId: string): Array<{
    id: string;
    seriesId: string;
    title: string;
    order: number;
    projectId: string | null;
    status: string;
    createdAt: number;
    updatedAt: number;
  }> {
    const rows = this.db
      .prepare('SELECT * FROM episodes WHERE series_id = ? ORDER BY episode_order ASC')
      .all(seriesId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      seriesId: r.series_id as string,
      title: r.title as string,
      order: r.episode_order as number,
      projectId: (r.project_id as string) ?? null,
      status: (r.status as string) ?? 'draft',
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    }));
  }

  deleteEpisode(id: string): void {
    this.db.prepare('DELETE FROM episodes WHERE id = ?').run(id);
  }

  // --- Preset Overrides ---

  upsertPresetOverride(override: {
    id: string;
    projectId: string;
    presetId: string;
    category: string;
    name: string;
    description?: string;
    prompt?: string;
    params?: unknown[];
    defaults?: Record<string, unknown>;
    isUser: boolean;
    createdAt: number;
    updatedAt: number;
  }): void {
    this.db
      .prepare(
        `
      INSERT INTO preset_overrides (id, project_id, preset_id, category, name, description, prompt, params, defaults, is_user, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id=excluded.project_id, preset_id=excluded.preset_id, category=excluded.category,
        name=excluded.name, description=excluded.description, prompt=excluded.prompt,
        params=excluded.params, defaults=excluded.defaults, is_user=excluded.is_user,
        updated_at=excluded.updated_at
    `,
      )
      .run(
        override.id,
        override.projectId,
        override.presetId,
        override.category,
        override.name,
        override.description ?? '',
        override.prompt ?? '',
        JSON.stringify(override.params ?? []),
        JSON.stringify(override.defaults ?? {}),
        override.isUser ? 1 : 0,
        override.createdAt,
        override.updatedAt,
      );
  }

  listPresetOverrides(projectId: string): Array<{
    id: string;
    projectId: string;
    presetId: string;
    category: string;
    name: string;
    description: string;
    prompt: string;
    params: unknown[];
    defaults: Record<string, unknown>;
    isUser: boolean;
    createdAt: number;
    updatedAt: number;
  }> {
    const rows = this.db
      .prepare('SELECT * FROM preset_overrides WHERE project_id = ? ORDER BY category, name')
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      projectId: r.project_id as string,
      presetId: r.preset_id as string,
      category: r.category as string,
      name: r.name as string,
      description: (r.description as string) ?? '',
      prompt: (r.prompt as string) ?? '',
      params: JSON.parse((r.params as string) || '[]'),
      defaults: JSON.parse((r.defaults as string) || '{}'),
      isUser: (r.is_user as number) === 1,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    }));
  }

  deletePresetOverride(id: string): void {
    this.db.prepare('DELETE FROM preset_overrides WHERE id = ?').run(id);
  }

  deletePresetOverridesByProject(projectId: string): void {
    this.db.prepare('DELETE FROM preset_overrides WHERE project_id = ?').run(projectId);
  }

  // --- Sync (import JSON → SQLite on project open for backward compat) ---

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

    // Characters: JSON → SQLite (full fields)
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

    // Scenes: JSON files → SQLite
    const scenesDir = path.join(projectPath, 'scenes');
    if (fs.existsSync(scenesDir)) {
      for (const file of fs.readdirSync(scenesDir)) {
        if (!file.endsWith('.json')) continue;
        const scene = JSON.parse(fs.readFileSync(path.join(scenesDir, file), 'utf-8')) as Scene;
        if (scene.id && scene.projectId) this.upsertScene(scene);
      }
    }

    // Script: JSON → SQLite
    const scriptFile = path.join(projectPath, 'script.json');
    if (fs.existsSync(scriptFile)) {
      const raw = JSON.parse(fs.readFileSync(scriptFile, 'utf-8')) as Record<string, unknown>;
      // Only sync if it's a full ScriptDocument (has content field)
      if (typeof raw.content === 'string' && typeof raw.format === 'string' && projectId) {
        this.upsertScript(raw as unknown as ScriptDocument);
      }
    }

    // Assets
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
            ) as AssetMeta;
            this.insertAsset({ ...meta, projectId });
          }
        }
      }
    }
  }

  private rowToJob(row: Record<string, unknown>): Job {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      segmentId: row.segment_id as string | undefined,
      type: row.type as Job['type'],
      provider: row.provider as string,
      status: row.status as Job['status'],
      priority: row.priority as number,
      prompt: row.prompt as string,
      params: row.params ? JSON.parse(row.params as string) : undefined,
      result: row.result ? JSON.parse(row.result as string) : undefined,
      cost: row.cost as number | undefined,
      attempts: row.attempts as number,
      maxRetries: row.max_retries as number,
      progress: row.progress == null ? undefined : Number(row.progress),
      completedSteps: row.completed_steps == null ? undefined : Number(row.completed_steps),
      totalSteps: row.total_steps == null ? undefined : Number(row.total_steps),
      currentStep: row.current_step as string | undefined,
      batchId: row.batch_id as string | undefined,
      batchIndex: row.batch_index == null ? undefined : Number(row.batch_index),
      createdAt: row.created_at as number,
      startedAt: row.started_at as number | undefined,
      completedAt: row.completed_at as number | undefined,
      error: row.error as string | undefined,
    };
  }
}
