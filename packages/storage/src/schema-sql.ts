/**
 * Inline SQL schema bootstrap used by `SqliteIndex`.
 *
 * This is the single schema source. Keep each `CREATE TABLE IF NOT EXISTS`
 * idempotent so the same statement can run during normal boot and repair.
 */
export const TASK_EXECUTION_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS task_lists (
  id                 TEXT PRIMARY KEY,
  task_list_type     TEXT NOT NULL,
  entity_type        TEXT NOT NULL,
  entity_id          TEXT,
  trigger_source     TEXT NOT NULL,
  status             TEXT NOT NULL,
  summary            TEXT NOT NULL DEFAULT '',
  progress           REAL NOT NULL DEFAULT 0,
  completed_phases   INTEGER NOT NULL DEFAULT 0,
  total_phases       INTEGER NOT NULL DEFAULT 0,
  completed_tasks    INTEGER NOT NULL DEFAULT 0,
  total_tasks        INTEGER NOT NULL DEFAULT 0,
  current_phase_key  TEXT,
  current_task_id    TEXT,
  input_json         TEXT NOT NULL DEFAULT '{}',
  output_json        TEXT NOT NULL DEFAULT '{}',
  error_text         TEXT,
  metadata_json      TEXT NOT NULL DEFAULT '{}',
  created_at         INTEGER NOT NULL,
  started_at         INTEGER,
  completed_at       INTEGER,
  updated_at         INTEGER NOT NULL,
  row_version        INTEGER NOT NULL DEFAULT 0 CHECK (row_version >= 0),
  current_gate       TEXT CHECK (current_gate IS NULL OR current_gate IN ('production_plan', 'visual_constitution', 'delivery')),
  engine_version     TEXT NOT NULL DEFAULT 'legacy',
  definition_version INTEGER NOT NULL DEFAULT 1 CHECK (definition_version > 0),
  lease_owner        TEXT,
  lease_token        INTEGER NOT NULL DEFAULT 0 CHECK (lease_token >= 0),
  lease_expires_at   INTEGER,
  heartbeat_at       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_task_lists_status_updated
  ON task_lists(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id                  TEXT PRIMARY KEY,
  task_list_id        TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  phase_key           TEXT NOT NULL,
  phase_name          TEXT NOT NULL,
  phase_order         INTEGER NOT NULL CHECK (phase_order >= 0),
  task_key            TEXT NOT NULL,
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
  updated_at          INTEGER NOT NULL,
  UNIQUE (task_list_id, task_key)
);

CREATE INDEX IF NOT EXISTS idx_tasks_list_status_updated
  ON tasks(task_list_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_list_status_updated_asc
  ON tasks(task_list_id, status, updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_status_updated_id
  ON tasks(status, updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_phase_status
  ON tasks(task_list_id, phase_key, status);
CREATE INDEX IF NOT EXISTS idx_tasks_provider_task
  ON tasks(provider_task_id);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id            TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on
  ON task_dependencies(depends_on_task_id);

CREATE TABLE IF NOT EXISTS task_artifacts (
  id            TEXT PRIMARY KEY,
  task_list_id  TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt_id    TEXT REFERENCES task_attempts(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  asset_hash    TEXT,
  path          TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  CHECK (artifact_type NOT IN ('media_submission', 'media_output') OR attempt_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_task_artifacts_list_type
  ON task_artifacts(task_list_id, artifact_type);
CREATE INDEX IF NOT EXISTS idx_task_artifacts_entity
  ON task_artifacts(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_task_artifacts_asset_hash
  ON task_artifacts(asset_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_artifacts_attempt_type
  ON task_artifacts(attempt_id, artifact_type)
  WHERE attempt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS plan_documents (
  id                  TEXT PRIMARY KEY,
  task_list_id        TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  logical_key         TEXT NOT NULL,
  document_type       TEXT NOT NULL,
  revision            INTEGER NOT NULL CHECK (revision > 0),
  schema_version      INTEGER NOT NULL CHECK (schema_version > 0),
  content_json        TEXT NOT NULL,
  content_hash        TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded', 'invalidated')),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (task_list_id, logical_key, revision)
);

CREATE INDEX IF NOT EXISTS idx_plan_documents_latest
  ON plan_documents(task_list_id, logical_key, revision DESC);

CREATE TRIGGER IF NOT EXISTS trg_plan_documents_immutable
BEFORE UPDATE ON plan_documents
BEGIN
  SELECT RAISE(ABORT, 'plan documents are immutable');
END;

CREATE TABLE IF NOT EXISTS plan_approvals (
  id                    TEXT PRIMARY KEY,
  task_list_id          TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  gate_key              TEXT NOT NULL CHECK (gate_key IN ('production_plan', 'visual_constitution', 'delivery')),
  subject_logical_key   TEXT NOT NULL,
  subject_revision      INTEGER NOT NULL CHECK (subject_revision > 0),
  subject_hash          TEXT NOT NULL,
  manifest_hash         TEXT NOT NULL,
  resume_token_hash     TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'invalidated')),
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  decided_at            INTEGER,
  UNIQUE (task_list_id, gate_key, subject_revision)
);

CREATE INDEX IF NOT EXISTS idx_plan_approvals_pending
  ON plan_approvals(task_list_id, gate_key, status, subject_revision DESC);

CREATE TABLE IF NOT EXISTS task_events (
  task_list_id      TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL CHECK (seq > 0),
  event_id          TEXT NOT NULL,
  actor             TEXT NOT NULL,
  correlation_id    TEXT,
  causation_id      TEXT,
  payload_json      TEXT NOT NULL,
  event_timestamp   INTEGER NOT NULL,
  UNIQUE (task_list_id, seq),
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_task_events_list_seq
  ON task_events(task_list_id, seq);

CREATE TABLE IF NOT EXISTS task_decisions (
  id                  TEXT PRIMARY KEY,
  task_list_id        TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
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
  UNIQUE (task_list_id, decision_key, subject_revision)
);

CREATE INDEX IF NOT EXISTS idx_task_decisions_pending
  ON task_decisions(task_list_id, status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_task_decisions_canvas_question
  ON task_decisions(canvas_id, question_id, created_at DESC);

CREATE TABLE IF NOT EXISTS task_attempts (
  id                  TEXT PRIMARY KEY,
  task_list_id        TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  task_id             TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('task', 'production_media', 'batch_export')),
  manifest_revision   INTEGER CHECK (manifest_revision IS NULL OR manifest_revision > 0),
  manifest_hash       TEXT,
  idempotency_key     TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL,
  row_version         INTEGER NOT NULL DEFAULT 0 CHECK (row_version >= 0),
  staging_path        TEXT,
  destination_path    TEXT,
  package_hash        TEXT,
  package_bytes       INTEGER CHECK (package_bytes IS NULL OR package_bytes >= 0),
  file_count          INTEGER CHECK (file_count IS NULL OR file_count > 0),
  attempt             INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  canvas_id                 TEXT,
  node_id                   TEXT,
  scope                     TEXT CHECK (scope IS NULL OR scope IN ('canvas', 'style_audition', 'production')),
  parent_attempt_id         TEXT REFERENCES task_attempts(id) ON DELETE SET NULL,
  submission_purpose        TEXT CHECK (submission_purpose IS NULL OR submission_purpose IN ('initial', 'user_refine', 'evaluation_repair', 'regenerate')),
  spec_hash                 TEXT,
  generation_spec_json      TEXT,
  repair_delta_json         TEXT,
  media_type                TEXT CHECK (media_type IS NULL OR media_type IN ('image', 'video')),
  provider_id               TEXT,
  model                     TEXT,
  prompt                    TEXT,
  prompt_hash               TEXT,
  negative_prompt           TEXT,
  seed                      INTEGER,
  estimated_cost_usd        REAL CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  reported_actual_cost_usd  REAL CHECK (
                              reported_actual_cost_usd IS NULL OR reported_actual_cost_usd >= 0
                            ),
  provider_job_id           TEXT,
  provider_receipt          TEXT,
  asset_hash                TEXT,
  input_json                TEXT NOT NULL DEFAULT '{}',
  output_json               TEXT NOT NULL DEFAULT '{}',
  metadata_json             TEXT NOT NULL DEFAULT '{}',
  error_text                TEXT,
  created_at                INTEGER NOT NULL,
  submitted_at              INTEGER,
  submission_started_at     INTEGER,
  cancel_requested_at       INTEGER,
  asset_ready_at            INTEGER,
  evaluated_at              INTEGER,
  completed_at              INTEGER,
  updated_at                INTEGER NOT NULL,
  CHECK (
    (kind = 'batch_export' AND manifest_revision IS NOT NULL AND manifest_hash IS NOT NULL AND destination_path IS NOT NULL)
    OR (kind = 'production_media' AND canvas_id IS NOT NULL AND node_id IS NOT NULL AND scope IS NOT NULL AND submission_purpose IS NOT NULL AND spec_hash IS NOT NULL AND generation_spec_json IS NOT NULL AND media_type IS NOT NULL AND provider_id IS NOT NULL AND model IS NOT NULL AND prompt IS NOT NULL AND prompt_hash IS NOT NULL AND estimated_cost_usd IS NOT NULL)
    OR (kind = 'task' AND task_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_attempts_media_identity
  ON task_attempts(task_list_id, node_id, attempt)
  WHERE kind = 'production_media';

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_attempts_batch_export_identity
  ON task_attempts(task_list_id, manifest_revision, manifest_hash)
  WHERE kind = 'batch_export';

CREATE INDEX IF NOT EXISTS idx_task_attempts_kind_recovery
  ON task_attempts(kind, status, updated_at ASC);

CREATE INDEX IF NOT EXISTS idx_task_attempts_list_kind
  ON task_attempts(task_list_id, kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS task_evaluations (
  id                    TEXT PRIMARY KEY,
  attempt_id            TEXT NOT NULL UNIQUE REFERENCES task_attempts(id) ON DELETE CASCADE,
  task_list_id          TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
  task_id               TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('production_media')),
  canvas_id             TEXT NOT NULL,
  node_id               TEXT NOT NULL,
  artifact_id           TEXT NOT NULL REFERENCES task_artifacts(id) ON DELETE RESTRICT,
  asset_hash            TEXT NOT NULL,
  media_type            TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  profile               TEXT NOT NULL CHECK (profile IN ('canvas_media.v1', 'style_audition.v1', 'production_media.v1')),
  source_prompt_hash    TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_task_evaluations_list
  ON task_evaluations(task_list_id, node_id, created_at DESC);
`;

/** Durable input/output ledger for Commander-owned final prompt assembly. */
export const PROMPT_ASSEMBLY_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS prompt_assemblies (
  id                        TEXT PRIMARY KEY,
  canvas_id                 TEXT NOT NULL,
  node_id                   TEXT NOT NULL,
  node_updated_at           INTEGER NOT NULL,
  media_type                TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  mode                      TEXT NOT NULL CHECK (mode IN (
                              'text-to-image', 'image-to-image',
                              'text-to-video', 'image-to-video'
                            )),
  purpose                   TEXT NOT NULL CHECK (purpose IN (
                              'initial', 'user_refine', 'evaluation_repair', 'regenerate'
                            )),
  authority_json            TEXT NOT NULL,
  sources_json              TEXT NOT NULL,
  conditioning_manifest_json TEXT NOT NULL,
  provider_profile_json     TEXT NOT NULL,
  host_constraints_json     TEXT NOT NULL,
  input_json                TEXT NOT NULL,
  input_hash                TEXT NOT NULL,
  output_json               TEXT,
  status                    TEXT NOT NULL CHECK (status IN (
                              'prepared', 'assembled', 'submitted', 'failed', 'cancelled'
                            )),
  row_version               INTEGER NOT NULL DEFAULT 0 CHECK (row_version >= 0),
  llm_provider_id           TEXT,
  llm_model                 TEXT,
  task_list_id              TEXT REFERENCES task_lists(id) ON DELETE SET NULL,
  task_id                   TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  parent_assembly_id        TEXT REFERENCES prompt_assemblies(id) ON DELETE SET NULL,
  source_attempt_id         TEXT,
  source_asset_hash         TEXT,
  source_evaluation_id      TEXT REFERENCES task_evaluations(id) ON DELETE SET NULL,
  error_text                TEXT,
  created_at                INTEGER NOT NULL,
  assembled_at              INTEGER,
  submitted_at              INTEGER,
  terminal_at               INTEGER,
  updated_at                INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prompt_assemblies_canvas_node_created
  ON prompt_assemblies(canvas_id, node_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_assemblies_parent
  ON prompt_assemblies(parent_assembly_id, created_at DESC);
`;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS asset_contents (
  hash        TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  format      TEXT NOT NULL,
  prompt      TEXT,
  provider    TEXT,
  created_at  INTEGER NOT NULL,
  file_size   INTEGER,
  width       INTEGER,
  height      INTEGER,
  duration    REAL,
  has_audio   INTEGER CHECK (has_audio IS NULL OR has_audio IN (0, 1)),
  generation_metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_asset_contents_type_created
  ON asset_contents(type, created_at DESC);

CREATE TABLE IF NOT EXISTS asset_entries (
  id           TEXT PRIMARY KEY,
  asset_hash   TEXT NOT NULL REFERENCES asset_contents(hash) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK (trim(display_name) <> ''),
  tags         TEXT NOT NULL DEFAULT '[]',
  folder_id    TEXT REFERENCES asset_folders(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_asset_entries_hash
  ON asset_entries(asset_hash);
CREATE INDEX IF NOT EXISTS idx_asset_entries_folder_created
  ON asset_entries(folder_id, created_at DESC);

${PROMPT_ASSEMBLY_TABLE_SQL}

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

CREATE INDEX IF NOT EXISTS idx_characters_folder_id ON characters(folder_id);
CREATE INDEX IF NOT EXISTS idx_characters_name ON characters(name);
CREATE INDEX IF NOT EXISTS idx_characters_active
  ON characters(id)
  WHERE deleted_at IS NULL;

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

CREATE INDEX IF NOT EXISTS idx_equipment_folder_id ON equipment(folder_id);
CREATE INDEX IF NOT EXISTS idx_equipment_name ON equipment(name);
CREATE INDEX IF NOT EXISTS idx_equipment_active
  ON equipment(id)
  WHERE deleted_at IS NULL;

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

CREATE INDEX IF NOT EXISTS idx_locations_folder_id ON locations(folder_id);
CREATE INDEX IF NOT EXISTS idx_locations_name ON locations(name);
CREATE INDEX IF NOT EXISTS idx_locations_active
  ON locations(id)
  WHERE deleted_at IS NULL;

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

${TASK_EXECUTION_TABLES_SQL}

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
  delivery_sequence_json     TEXT,
  delivery_sequence_revision INTEGER NOT NULL DEFAULT 0 CHECK (delivery_sequence_revision >= 0),
  archived_at          INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canvases_updated
  ON canvases(updated_at DESC);

CREATE TABLE IF NOT EXISTS delivery_asset_refs (
  canvas_id  TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  asset_hash TEXT NOT NULL REFERENCES asset_contents(hash) ON DELETE RESTRICT,
  PRIMARY KEY (canvas_id, asset_hash)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_delivery_asset_refs_hash
  ON delivery_asset_refs(asset_hash);

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
  id                TEXT PRIMARY KEY,
  default_canvas_id TEXT,
  title       TEXT NOT NULL DEFAULT '',
  messages    TEXT NOT NULL DEFAULT '[]',
  context_graph_json TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commander_sessions_updated
  ON commander_sessions(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_commander_sessions_default_canvas
  ON commander_sessions(default_canvas_id);

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
  private_payload BLOB CHECK (private_payload IS NULL OR length(private_payload) > 0),
  payload      TEXT    NOT NULL,
  PRIMARY KEY (session_id, run_id, seq),
  FOREIGN KEY (session_id) REFERENCES commander_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS commander_runs (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES commander_sessions(id) ON DELETE CASCADE,
  default_canvas_id TEXT,
  work_type    TEXT NOT NULL DEFAULT 'agent' CHECK (work_type IN ('agent', 'subagent', 'tool_program')),
  parent_run_id TEXT REFERENCES commander_runs(id) ON DELETE CASCADE,
  retry_of_run_id TEXT REFERENCES commander_runs(id) ON DELETE SET NULL,
  display_name TEXT,
  objective    TEXT,
  intent       TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('accepted', 'running', 'paused', 'completed', 'failed', 'cancelled', 'blocked', 'max_steps')),
  accepted_at  INTEGER NOT NULL,
  started_at   INTEGER,
  completed_at INTEGER,
  last_seq     INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  error_text   TEXT
);

CREATE INDEX IF NOT EXISTS idx_commander_runs_session_accepted
  ON commander_runs(session_id, accepted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commander_runs_active_session
  ON commander_runs(session_id)
  WHERE parent_run_id IS NULL AND status IN ('accepted', 'running', 'paused');

CREATE INDEX IF NOT EXISTS idx_commander_runs_parent
  ON commander_runs(parent_run_id, accepted_at, id);

CREATE INDEX IF NOT EXISTS idx_commander_runs_retry
  ON commander_runs(retry_of_run_id);

CREATE TABLE IF NOT EXISTS commander_run_canvases (
  run_id      TEXT NOT NULL REFERENCES commander_runs(id) ON DELETE CASCADE,
  canvas_id   TEXT NOT NULL,
  ordinal     INTEGER NOT NULL CHECK (ordinal >= 0),
  released_at INTEGER,
  PRIMARY KEY (run_id, canvas_id)
);

CREATE INDEX IF NOT EXISTS idx_commander_run_canvases_active_canvas
  ON commander_run_canvases(canvas_id)
  WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS commander_run_attachments (
  run_id       TEXT NOT NULL REFERENCES commander_runs(id) ON DELETE CASCADE,
  ordinal      INTEGER NOT NULL CHECK (ordinal >= 0),
  content_hash TEXT NOT NULL REFERENCES asset_contents(hash) ON DELETE RESTRICT,
  role         TEXT NOT NULL CHECK (role = 'reference'),
  original_name TEXT NOT NULL CHECK (trim(original_name) <> ''),
  mime_type    TEXT NOT NULL CHECK (trim(mime_type) <> ''),
  PRIMARY KEY (run_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_commander_run_attachments_content
  ON commander_run_attachments(content_hash);

CREATE INDEX IF NOT EXISTS idx_commander_events_run
  ON commander_events(session_id, run_id, seq);

CREATE INDEX IF NOT EXISTS idx_commander_events_kind
  ON commander_events(session_id, kind);

CREATE VIRTUAL TABLE IF NOT EXISTS asset_entries_fts USING fts5(
  entry_id UNINDEXED, display_name, tags, prompt
);

CREATE TRIGGER IF NOT EXISTS asset_entries_ai AFTER INSERT ON asset_entries BEGIN
  INSERT INTO asset_entries_fts(entry_id, display_name, tags, prompt)
  SELECT new.id, new.display_name, new.tags, prompt
    FROM asset_contents WHERE hash = new.asset_hash;
END;

CREATE TRIGGER IF NOT EXISTS asset_entries_ad AFTER DELETE ON asset_entries BEGIN
  DELETE FROM asset_entries_fts WHERE entry_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS asset_entries_au AFTER UPDATE ON asset_entries BEGIN
  UPDATE asset_entries_fts
     SET display_name = new.display_name,
         tags = new.tags,
         prompt = (SELECT prompt FROM asset_contents WHERE hash = new.asset_hash)
   WHERE entry_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS asset_contents_prompt_au
AFTER UPDATE OF prompt ON asset_contents BEGIN
  UPDATE asset_entries_fts
     SET prompt = new.prompt
   WHERE entry_id IN (SELECT id FROM asset_entries WHERE asset_hash = new.hash);
END;

-- Soft-delete GC indexes
CREATE INDEX IF NOT EXISTS idx_characters_deleted_at ON characters(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_deleted_at ON equipment(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locations_deleted_at ON locations(deleted_at) WHERE deleted_at IS NOT NULL;
`;
