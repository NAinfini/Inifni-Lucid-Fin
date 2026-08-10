/**
 * Inline SQL schema bootstrap used by `SqliteIndex`.
 *
 * This is the single schema source. Keep each `CREATE TABLE IF NOT EXISTS`
 * idempotent so the same statement can run during normal boot and repair.
 */
export const WORKFLOW_PERSISTENCE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS workflow_documents (
  id                  TEXT PRIMARY KEY,
  workflow_run_id     TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  logical_key         TEXT NOT NULL,
  document_type       TEXT NOT NULL,
  revision            INTEGER NOT NULL CHECK (revision > 0),
  schema_version      INTEGER NOT NULL CHECK (schema_version > 0),
  content_json        TEXT NOT NULL,
  content_hash        TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded', 'invalidated')),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (workflow_run_id, logical_key, revision)
);

CREATE INDEX IF NOT EXISTS idx_workflow_documents_latest
  ON workflow_documents(workflow_run_id, logical_key, revision DESC);

CREATE TRIGGER IF NOT EXISTS trg_workflow_documents_immutable
BEFORE UPDATE ON workflow_documents
BEGIN
  SELECT RAISE(ABORT, 'workflow documents are immutable');
END;

CREATE TABLE IF NOT EXISTS workflow_approvals (
  id                    TEXT PRIMARY KEY,
  workflow_run_id       TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  gate_key              TEXT NOT NULL CHECK (gate_key IN ('production_plan', 'visual_constitution', 'final_export')),
  subject_logical_key   TEXT NOT NULL,
  subject_revision      INTEGER NOT NULL CHECK (subject_revision > 0),
  subject_hash          TEXT NOT NULL,
  manifest_hash         TEXT NOT NULL,
  resume_token_hash     TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'invalidated')),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  decided_at            INTEGER,
  UNIQUE (workflow_run_id, gate_key, subject_revision)
);

CREATE INDEX IF NOT EXISTS idx_workflow_approvals_pending
  ON workflow_approvals(workflow_run_id, gate_key, status, subject_revision DESC);

CREATE TABLE IF NOT EXISTS workflow_events (
  workflow_run_id   TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL CHECK (seq > 0),
  event_id          TEXT NOT NULL,
  actor             TEXT NOT NULL,
  correlation_id    TEXT,
  causation_id      TEXT,
  payload_json      TEXT NOT NULL,
  event_timestamp   INTEGER NOT NULL,
  UNIQUE (workflow_run_id, seq),
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_run_seq
  ON workflow_events(workflow_run_id, seq);

CREATE TABLE IF NOT EXISTS workflow_decisions (
  id                  TEXT PRIMARY KEY,
  workflow_run_id     TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  task_run_id         TEXT NOT NULL,
  canvas_id           TEXT NOT NULL,
  question_id         TEXT NOT NULL,
  decision_key        TEXT NOT NULL,
  subject_revision    INTEGER NOT NULL CHECK (subject_revision > 0),
  question            TEXT NOT NULL,
  options_json        TEXT NOT NULL,
  allow_free_text     INTEGER NOT NULL DEFAULT 0 CHECK (allow_free_text IN (0, 1)),
  status              TEXT NOT NULL CHECK (status IN ('pending', 'answered', 'recovery_required')),
  answer              TEXT,
  selected_option_id  TEXT,
  row_version         INTEGER NOT NULL DEFAULT 0 CHECK (row_version >= 0),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  answered_at         INTEGER,
  UNIQUE (workflow_run_id, decision_key, subject_revision)
);

CREATE INDEX IF NOT EXISTS idx_workflow_decisions_pending
  ON workflow_decisions(workflow_run_id, status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_workflow_decisions_canvas_question
  ON workflow_decisions(canvas_id, question_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_export_executions (
  id                  TEXT PRIMARY KEY,
  workflow_run_id     TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  manifest_revision   INTEGER NOT NULL CHECK (manifest_revision > 0),
  manifest_hash       TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL CHECK (status IN (
                        'queued', 'running', 'ready_to_publish', 'completed',
                        'failed', 'cancelled', 'recovery_required'
                      )),
  row_version         INTEGER NOT NULL DEFAULT 0 CHECK (row_version >= 0),
  staging_path        TEXT,
  destination_path    TEXT NOT NULL,
  output_asset_hash   TEXT,
  output_hash         TEXT,
  output_size         INTEGER CHECK (output_size IS NULL OR output_size >= 0),
  attempt             INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  error_text          TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  completed_at        INTEGER,
  UNIQUE (workflow_run_id, manifest_revision, manifest_hash)
);

CREATE INDEX IF NOT EXISTS idx_workflow_export_executions_recovery
  ON workflow_export_executions(status, updated_at ASC);

CREATE INDEX IF NOT EXISTS idx_workflow_export_executions_run
  ON workflow_export_executions(workflow_run_id, manifest_revision DESC);

CREATE TABLE IF NOT EXISTS workflow_media_attempts (
  id                        TEXT PRIMARY KEY,
  workflow_run_id           TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  canvas_id                 TEXT NOT NULL,
  node_id                   TEXT NOT NULL,
  attempt                   INTEGER NOT NULL CHECK (attempt > 0),
  idempotency_key           TEXT NOT NULL UNIQUE,
  spec_hash                 TEXT NOT NULL,
  generation_spec_json      TEXT NOT NULL,
  repair_delta_json         TEXT,
  media_type                TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  status                    TEXT NOT NULL CHECK (status IN (
                              'reserved', 'submitted', 'asset_ready', 'evaluating',
                              'accepted', 'repair_required', 'regenerate_required',
                              'human_review', 'failed', 'ambiguous', 'cancelled'
                            )),
  row_version               INTEGER NOT NULL DEFAULT 0 CHECK (row_version >= 0),
  provider_id               TEXT NOT NULL,
  model                     TEXT,
  prompt                    TEXT NOT NULL,
  prompt_hash               TEXT NOT NULL,
  negative_prompt           TEXT,
  seed                      INTEGER,
  estimated_cost_usd        REAL NOT NULL CHECK (estimated_cost_usd >= 0),
  reported_actual_cost_usd  REAL CHECK (
                              reported_actual_cost_usd IS NULL OR reported_actual_cost_usd >= 0
                            ),
  provider_job_id           TEXT,
  asset_hash                TEXT,
  error_text                TEXT,
  created_at                INTEGER NOT NULL,
  submitted_at              INTEGER,
  asset_ready_at            INTEGER,
  evaluated_at              INTEGER,
  completed_at              INTEGER,
  updated_at                INTEGER NOT NULL,
  UNIQUE (workflow_run_id, node_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_workflow_media_attempts_run
  ON workflow_media_attempts(workflow_run_id, node_id, attempt DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_media_attempts_recovery
  ON workflow_media_attempts(status, updated_at ASC);

CREATE TABLE IF NOT EXISTS workflow_media_evaluations (
  id                    TEXT PRIMARY KEY,
  attempt_id            TEXT NOT NULL UNIQUE REFERENCES workflow_media_attempts(id) ON DELETE CASCADE,
  workflow_run_id       TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  canvas_id             TEXT NOT NULL,
  node_id               TEXT NOT NULL,
  asset_hash            TEXT NOT NULL,
  media_type            TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  rubric_version        TEXT NOT NULL,
  evaluator_provider_id TEXT NOT NULL,
  evaluator_model       TEXT,
  scores_json           TEXT NOT NULL,
  total                 REAL NOT NULL CHECK (total >= 0 AND total <= 100),
  verdict               TEXT NOT NULL CHECK (verdict IN ('pass', 'repair', 'regenerate', 'human_review')),
  strengths_json        TEXT NOT NULL,
  risks_json            TEXT NOT NULL,
  evidence_json         TEXT NOT NULL,
  repair_delta_json     TEXT,
  metadata_json         TEXT NOT NULL,
  frame_evidence_json   TEXT NOT NULL,
  created_at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_media_evaluations_run
  ON workflow_media_evaluations(workflow_run_id, node_id, created_at DESC);
`;

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
  duration    REAL,
  generation_metadata TEXT
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
  face          TEXT,
  hair          TEXT,
  skin_tone     TEXT,
  body          TEXT,
  distinct_traits TEXT,
  vocal_traits  TEXT,
  reference_images TEXT DEFAULT '[]',
  loadouts      TEXT DEFAULT '[]',
  default_loadout_id TEXT DEFAULT '',
  folder_id     TEXT,
  deleted_at    TEXT,
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
  material      TEXT,
  color         TEXT,
  condition     TEXT,
  visual_details TEXT,
  tags          TEXT DEFAULT '[]',
  reference_images TEXT DEFAULT '[]',
  folder_id     TEXT,
  deleted_at    TEXT,
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
  deleted_at       TEXT,
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
  updated_at        INTEGER NOT NULL,
  row_version       INTEGER NOT NULL DEFAULT 0 CHECK (row_version >= 0),
  current_gate      TEXT CHECK (current_gate IS NULL OR current_gate IN ('production_plan', 'visual_constitution', 'final_export')),
  engine_version    TEXT NOT NULL DEFAULT 'legacy',
  definition_version INTEGER NOT NULL DEFAULT 1 CHECK (definition_version > 0)
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

${WORKFLOW_PERSISTENCE_TABLES_SQL}

CREATE TABLE IF NOT EXISTS project_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS canvases (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
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
  resolution_policy_json TEXT,
  visual_style_policy_json TEXT,
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

CREATE TABLE IF NOT EXISTS canvas_nodes (
  id         TEXT PRIMARY KEY,
  canvas_id  TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  width      REAL,
  height     REAL,
  data_json  TEXT NOT NULL DEFAULT '{}',
  z_index    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_canvas_nodes_canvas_id
  ON canvas_nodes(canvas_id);
CREATE INDEX IF NOT EXISTS idx_canvas_nodes_type
  ON canvas_nodes(type);
CREATE INDEX IF NOT EXISTS idx_canvas_nodes_canvas_type
  ON canvas_nodes(canvas_id, type);

CREATE TABLE IF NOT EXISTS canvas_edges (
  id            TEXT PRIMARY KEY,
  canvas_id     TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,
  target        TEXT NOT NULL,
  source_handle TEXT,
  target_handle TEXT,
  label         TEXT,
  status        TEXT NOT NULL DEFAULT 'idle',
  auto_label    INTEGER NOT NULL DEFAULT 0,
  z_index       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_canvas_edges_canvas_id
  ON canvas_edges(canvas_id);
CREATE INDEX IF NOT EXISTS idx_canvas_edges_source
  ON canvas_edges(source);
CREATE INDEX IF NOT EXISTS idx_canvas_edges_target
  ON canvas_edges(target);

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

-- Soft-delete GC indexes
CREATE INDEX IF NOT EXISTS idx_characters_deleted_at ON characters(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_deleted_at ON equipment(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locations_deleted_at ON locations(deleted_at) WHERE deleted_at IS NOT NULL;
`;
