/**
 * Inline SQL schema bootstrap used by `SqliteIndex` for fresh-install DBs.
 *
 * `SqliteIndex` runs this only when `getCurrentVersion(db) === 0`. Existing
 * databases apply incremental migrations instead (see `./migrations/`).
 * Keep each `CREATE TABLE IF NOT EXISTS` idempotent — the same statement
 * also runs from `repair()` against a freshly-recreated file.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS assets (
  hash        TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  format      TEXT NOT NULL,
  tags        TEXT,
  prompt      TEXT,
  provider    TEXT,
  folder_id   TEXT,
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
  folder_id     TEXT,
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
  folder_id     TEXT,
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
  folder_id        TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_folders (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES character_folders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_character_folders_parent ON character_folders(parent_id);

CREATE TABLE IF NOT EXISTS equipment_folders (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES equipment_folders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_equipment_folders_parent ON equipment_folders(parent_id);

CREATE TABLE IF NOT EXISTS location_folders (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES location_folders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_location_folders_parent ON location_folders(parent_id);

CREATE TABLE IF NOT EXISTS asset_folders (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES asset_folders(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_asset_folders_parent ON asset_folders(parent_id);

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
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  nodes                TEXT NOT NULL DEFAULT '[]',
  edges                TEXT NOT NULL DEFAULT '[]',
  viewport             TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
  notes                TEXT NOT NULL DEFAULT '[]',
  style_plate          TEXT,
  negative_prompt      TEXT,
  default_width        INTEGER,
  default_height       INTEGER,
  publish_width        INTEGER,
  publish_height       INTEGER,
  publish_video_width  INTEGER,
  publish_video_height INTEGER,
  aspect_ratio         TEXT,
  llm_provider_id      TEXT,
  image_provider_id    TEXT,
  video_provider_id    TEXT,
  audio_provider_id    TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
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
  context_graph_json TEXT,
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

-- Phase E: commander timeline events. Additive — legacy
-- 'commander_sessions.messages' JSON column stays as the v1 snapshot;
-- v2 consumers hydrate from per-event rows here. 'payload' is a JSON
-- blob of the full event minus the columns we factor out.
CREATE TABLE IF NOT EXISTS commander_events (
  session_id   TEXT    NOT NULL,
  run_id       TEXT    NOT NULL,
  seq          INTEGER NOT NULL,
  kind         TEXT    NOT NULL,
  step         INTEGER NOT NULL,
  emitted_at   INTEGER NOT NULL,
  payload      TEXT    NOT NULL,
  PRIMARY KEY (session_id, run_id, seq),
  FOREIGN KEY (session_id) REFERENCES commander_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_commander_events_run
  ON commander_events(session_id, run_id, seq);

CREATE INDEX IF NOT EXISTS idx_commander_events_kind
  ON commander_events(session_id, kind);

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
