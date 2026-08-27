PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'archived', 'deleted')),
  schema_revision INTEGER NOT NULL CHECK (schema_revision >= 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('message', 'run', 'user_choice', 'import', 'direct_ui', 'run_inbox')),
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT,
  CHECK ((lifecycle = 'archived') = (archived_at IS NOT NULL)),
  CHECK ((lifecycle = 'deleted') = (deleted_at IS NOT NULL))
) STRICT;

CREATE TABLE provider_profiles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 240),
  provider_kind TEXT NOT NULL CHECK (length(provider_kind) BETWEEN 1 AND 80),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  reasoning_strength TEXT CHECK (reasoning_strength IS NULL OR length(reasoning_strength) BETWEEN 1 AND 80),
  endpoint_origin TEXT,
  credential_handle TEXT,
  status TEXT NOT NULL CHECK (status IN ('ready', 'unavailable', 'disabled')),
  configuration_v1_json TEXT NOT NULL CHECK (json_valid(configuration_v1_json) AND json_type(configuration_v1_json) = 'object'),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE project_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  default_provider_profile_id TEXT REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  format_policy_v1_json TEXT NOT NULL CHECK (json_valid(format_policy_v1_json) AND json_type(format_policy_v1_json) = 'object'),
  permission_mode TEXT NOT NULL CHECK (permission_mode IN ('read_only', 'reversible', 'full')),
  budget_v1_json TEXT NOT NULL CHECK (json_valid(budget_v1_json) AND json_type(budget_v1_json) = 'object'),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE skills (
  id TEXT NOT NULL,
  version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 4000),
  content_text TEXT NOT NULL CHECK (length(content_text) BETWEEN 1 AND 200000),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  provenance TEXT NOT NULL CHECK (provenance IN ('built_in', 'installed', 'project')),
  trust TEXT NOT NULL CHECK (trust IN ('trusted', 'reviewed', 'unreviewed')),
  project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  created_by_confirmation_id TEXT REFERENCES run_confirmations(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, version),
  CHECK (
    (
      provenance = 'project'
      AND project_id IS NOT NULL
      AND created_by_confirmation_id IS NOT NULL
    )
    OR
    (
      provenance IN ('built_in', 'installed')
      AND project_id IS NULL
      AND created_by_confirmation_id IS NULL
    )
  )
) STRICT;

CREATE TABLE skill_effective_versions (
  skill_id TEXT PRIMARY KEY,
  skill_version TEXT NOT NULL CHECK (length(skill_version) BETWEEN 1 AND 80),
  changed_at TEXT NOT NULL,
  FOREIGN KEY (skill_id, skill_version) REFERENCES skills(id, version) ON DELETE RESTRICT
) STRICT;

CREATE TABLE skill_quarantines (
  skill_id TEXT NOT NULL,
  skill_version TEXT NOT NULL CHECK (length(skill_version) BETWEEN 1 AND 80),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 4000),
  PRIMARY KEY (skill_id, skill_version),
  FOREIGN KEY (skill_id, skill_version) REFERENCES skills(id, version) ON DELETE RESTRICT
) STRICT;

CREATE TABLE skill_enablements (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  skill_id TEXT NOT NULL,
  skill_version TEXT NOT NULL CHECK (length(skill_version) BETWEEN 1 AND 80),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  enabled_at TEXT NOT NULL,
  PRIMARY KEY (project_id, skill_id),
  FOREIGN KEY (skill_id, skill_version) REFERENCES skills(id, version) ON DELETE RESTRICT
) STRICT;

CREATE TABLE plugin_packages (
  package_id TEXT NOT NULL,
  package_version TEXT NOT NULL CHECK (length(package_version) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 4000),
  manifest_v1_json TEXT NOT NULL CHECK (json_valid(manifest_v1_json) AND json_type(manifest_v1_json) = 'object'),
  manifest_hash TEXT NOT NULL CHECK (length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  registered_at TEXT NOT NULL,
  PRIMARY KEY (package_id, package_version),
  UNIQUE (package_id, package_version, manifest_hash)
) STRICT;

CREATE TABLE plugin_package_skills (
  package_id TEXT NOT NULL,
  package_version TEXT NOT NULL CHECK (length(package_version) BETWEEN 1 AND 80),
  skill_id TEXT NOT NULL,
  skill_version TEXT NOT NULL CHECK (length(skill_version) BETWEEN 1 AND 80),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (package_id, package_version, skill_id, skill_version),
  UNIQUE (package_id, package_version, ordinal),
  FOREIGN KEY (package_id, package_version) REFERENCES plugin_packages(package_id, package_version) ON DELETE RESTRICT,
  FOREIGN KEY (skill_id, skill_version) REFERENCES skills(id, version) ON DELETE RESTRICT
) STRICT;

CREATE TABLE plugin_installations (
  package_id TEXT PRIMARY KEY,
  package_version TEXT NOT NULL CHECK (length(package_version) BETWEEN 1 AND 80),
  manifest_hash TEXT NOT NULL CHECK (length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK (state IN ('installed', 'removed')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  installed_at TEXT NOT NULL,
  removed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (package_id, package_version, manifest_hash)
    REFERENCES plugin_packages(package_id, package_version, manifest_hash) ON DELETE RESTRICT,
  CHECK ((state = 'removed') = (removed_at IS NOT NULL))
) STRICT;

CREATE TABLE plugin_audit_events (
  sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
  id TEXT NOT NULL UNIQUE,
  package_id TEXT NOT NULL,
  package_version TEXT NOT NULL CHECK (length(package_version) BETWEEN 1 AND 80),
  manifest_hash TEXT NOT NULL CHECK (length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  action TEXT NOT NULL CHECK (action IN ('installed', 'removed')),
  installation_revision INTEGER NOT NULL CHECK (installation_revision >= 0),
  previous_event_hash TEXT CHECK (previous_event_hash IS NULL OR (length(previous_event_hash) = 64 AND previous_event_hash NOT GLOB '*[^0-9a-f]*')),
  event_hash TEXT NOT NULL UNIQUE CHECK (length(event_hash) = 64 AND event_hash NOT GLOB '*[^0-9a-f]*'),
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (package_id, package_version, manifest_hash)
    REFERENCES plugin_packages(package_id, package_version, manifest_hash) ON DELETE RESTRICT
) STRICT;

CREATE TABLE media_blobs (
  hash TEXT PRIMARY KEY CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 160),
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video', 'audio', 'document')),
  technical_facts_v1_json TEXT NOT NULL CHECK (json_valid(technical_facts_v1_json) AND json_type(technical_facts_v1_json) = 'object'),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE global_media_folders (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  parent_id TEXT REFERENCES global_media_folders(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN -9007199254740991 AND 9007199254740991),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (parent_id IS NULL OR parent_id <> id)
) STRICT;

CREATE TABLE global_media_assets (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  blob_hash TEXT NOT NULL REFERENCES media_blobs(hash) ON DELETE RESTRICT,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video', 'audio', 'document')),
  filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 512),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 240),
  source_v1_json TEXT NOT NULL CHECK (json_valid(source_v1_json) AND json_type(source_v1_json) = 'object'),
  folder_id TEXT REFERENCES global_media_folders(id) ON DELETE RESTRICT,
  tags_v1_json TEXT NOT NULL CHECK (json_valid(tags_v1_json) AND json_type(tags_v1_json) = 'array'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE project_media_refs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  global_asset_id TEXT NOT NULL REFERENCES global_media_assets(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'detached')),
  detached_at TEXT,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 240),
  collections_v1_json TEXT NOT NULL CHECK (json_valid(collections_v1_json) AND json_type(collections_v1_json) = 'array'),
  roles_v1_json TEXT NOT NULL CHECK (json_valid(roles_v1_json) AND json_type(roles_v1_json) = 'array'),
  notes TEXT NOT NULL,
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('message', 'run', 'user_choice', 'import', 'direct_ui', 'run_inbox')),
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, global_asset_id),
  CHECK ((lifecycle = 'detached') = (detached_at IS NOT NULL))
) STRICT;

CREATE TABLE media_derivations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  source_blob_hash TEXT NOT NULL REFERENCES media_blobs(hash) ON DELETE RESTRICT,
  transform_v1_json TEXT NOT NULL CHECK (json_valid(transform_v1_json) AND json_type(transform_v1_json) = 'object'),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) = 64 AND idempotency_key NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, idempotency_key)
) STRICT;

CREATE TABLE media_derivation_attempts (
  id TEXT PRIMARY KEY,
  derivation_id TEXT NOT NULL REFERENCES media_derivations(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK (state IN ('prepared', 'running', 'submitted', 'unknown', 'succeeded', 'failed', 'cancelled')),
  provider_profile_id TEXT REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  provider_v1_json TEXT CHECK (provider_v1_json IS NULL OR (json_valid(provider_v1_json) AND json_type(provider_v1_json) = 'object')),
  provider_operation_id TEXT,
  receipt_v1_json TEXT CHECK (receipt_v1_json IS NULL OR (json_valid(receipt_v1_json) AND json_type(receipt_v1_json) = 'object')),
  usage_v1_json TEXT CHECK (usage_v1_json IS NULL OR (json_valid(usage_v1_json) AND json_type(usage_v1_json) = 'object')),
  cancel_requested INTEGER NOT NULL CHECK (cancel_requested IN (0, 1)),
  progress_percent REAL CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
  public_error_code TEXT CHECK (public_error_code IS NULL OR public_error_code IN ('invalid_request', 'permission_denied', 'budget_exceeded', 'provider_failed', 'execution_failed', 'provider_state_unknown', 'cancelled')),
  created_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (derivation_id, attempt_number),
  UNIQUE (id, derivation_id),
  CHECK ((provider_profile_id IS NULL) = (provider_v1_json IS NULL)),
  CHECK ((provider_operation_id IS NULL) = (receipt_v1_json IS NULL)),
  CHECK (provider_v1_json IS NOT NULL OR receipt_v1_json IS NULL),
  CHECK ((state IN ('succeeded', 'failed', 'cancelled')) = (finished_at IS NOT NULL)),
  CHECK (state != 'submitted' OR receipt_v1_json IS NOT NULL),
  CHECK (state != 'unknown' OR (provider_v1_json IS NOT NULL AND public_error_code = 'provider_state_unknown')),
  CHECK (state = 'unknown' OR public_error_code IS NULL OR public_error_code != 'provider_state_unknown'),
  CHECK (state != 'cancelled' OR public_error_code = 'cancelled'),
  CHECK (state = 'cancelled' OR public_error_code IS NULL OR public_error_code != 'cancelled'),
  CHECK (state != 'failed' OR public_error_code IN ('invalid_request', 'permission_denied', 'budget_exceeded', 'provider_failed', 'execution_failed')),
  CHECK (state IN ('unknown', 'failed', 'cancelled') OR public_error_code IS NULL)
) STRICT;

CREATE TABLE media_derivation_outputs (
  id TEXT PRIMARY KEY,
  derivation_attempt_id TEXT NOT NULL REFERENCES media_derivation_attempts(id) ON DELETE RESTRICT,
  blob_hash TEXT NOT NULL REFERENCES media_blobs(hash) ON DELETE RESTRICT,
  global_asset_id TEXT NOT NULL REFERENCES global_media_assets(id) ON DELETE RESTRICT,
  project_media_ref_id TEXT REFERENCES project_media_refs(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  UNIQUE (derivation_attempt_id, ordinal)
) STRICT;

CREATE TABLE production_objects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  object_type TEXT NOT NULL CHECK (object_type IN ('direction', 'story', 'sequence', 'scene', 'beat', 'character', 'location', 'equipment', 'prop', 'wardrobe', 'world_fact', 'shot')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'archived', 'deleted')),
  content_v1_json TEXT NOT NULL CHECK (json_valid(content_v1_json) AND json_type(content_v1_json) = 'object'),
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('message', 'run', 'user_choice', 'import', 'direct_ui', 'run_inbox')),
  created_by_id TEXT NOT NULL,
  updated_by_kind TEXT NOT NULL CHECK (updated_by_kind IN ('message', 'run', 'user_choice', 'import', 'direct_ui', 'run_inbox')),
  updated_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, id)
) STRICT;

CREATE TABLE production_relations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_object_id TEXT NOT NULL REFERENCES production_objects(id) ON DELETE RESTRICT,
  target_object_id TEXT NOT NULL REFERENCES production_objects(id) ON DELETE RESTRICT,
  relation TEXT NOT NULL CHECK (relation IN ('contains', 'appears_in', 'uses', 'located_at', 'continues_from', 'references')),
  ordinal INTEGER CHECK (ordinal IS NULL OR ordinal >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (source_object_id, target_object_id, relation),
  UNIQUE (source_object_id, relation, ordinal),
  CHECK ((relation = 'contains') = (ordinal IS NOT NULL)),
  CHECK (source_object_id <> target_object_id)
) STRICT;

CREATE TABLE production_fact_sources (
  id TEXT PRIMARY KEY,
  production_object_id TEXT NOT NULL REFERENCES production_objects(id) ON DELETE RESTRICT,
  field_ref TEXT NOT NULL CHECK (length(field_ref) BETWEEN 1 AND 500),
  source_authority TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 0),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
  relation TEXT NOT NULL CHECK (relation IN ('supports', 'contradicts', 'supersedes')),
  created_at TEXT NOT NULL,
  UNIQUE (production_object_id, field_ref, source_authority, source_id, source_revision)
) STRICT;

CREATE TABLE canvas_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  viewport_v1_json TEXT NOT NULL CHECK (json_valid(viewport_v1_json) AND json_type(viewport_v1_json) = 'object'),
  next_z_index INTEGER NOT NULL CHECK (next_z_index >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE canvas_groups (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvas_documents(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (canvas_id, id)
) STRICT;

CREATE TABLE canvas_placements (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvas_documents(id) ON DELETE RESTRICT,
  target_authority TEXT NOT NULL CHECK (target_authority IN ('production', 'project_media_ref', 'generated_result', 'delivery')),
  target_id TEXT NOT NULL,
  target_revision INTEGER NOT NULL CHECK (target_revision >= 0),
  target_hash TEXT NOT NULL CHECK (length(target_hash) = 64 AND target_hash NOT GLOB '*[^0-9a-f]*'),
  x REAL NOT NULL,
  y REAL NOT NULL,
  width REAL NOT NULL CHECK (width > 0),
  height REAL NOT NULL CHECK (height > 0),
  z_index INTEGER NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (canvas_id, id)
) STRICT;

CREATE TABLE canvas_group_members (
  group_id TEXT NOT NULL REFERENCES canvas_groups(id) ON DELETE RESTRICT,
  placement_id TEXT NOT NULL UNIQUE REFERENCES canvas_placements(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (group_id, placement_id),
  UNIQUE (group_id, ordinal)
) STRICT;

CREATE TABLE canvas_edges (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvas_documents(id) ON DELETE RESTRICT,
  source_placement_id TEXT NOT NULL REFERENCES canvas_placements(id) ON DELETE RESTRICT,
  target_placement_id TEXT NOT NULL REFERENCES canvas_placements(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (canvas_id, id),
  CHECK (source_placement_id <> target_placement_id)
) STRICT;

CREATE TABLE canvas_annotations (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvas_documents(id) ON DELETE RESTRICT,
  placement_id TEXT REFERENCES canvas_placements(id) ON DELETE RESTRICT,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 20000),
  geometry_v1_json TEXT CHECK (geometry_v1_json IS NULL OR (json_valid(geometry_v1_json) AND json_type(geometry_v1_json) = 'object')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE canvas_saved_views (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvas_documents(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  viewport_v1_json TEXT NOT NULL CHECK (json_valid(viewport_v1_json) AND json_type(viewport_v1_json) = 'object'),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (canvas_id, name)
) STRICT;

CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'archived', 'deleted')),
  message_count INTEGER NOT NULL CHECK (message_count >= 0),
  message_head_sequence INTEGER CHECK (message_head_sequence IS NULL OR message_head_sequence > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  deleted_at TEXT,
  UNIQUE (project_id, id)
) STRICT;

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  chat_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'completed', 'interrupted')),
  originating_run_id TEXT UNIQUE REFERENCES runs(id) ON DELETE RESTRICT,
  originating_imported_run_id TEXT UNIQUE REFERENCES imported_run_history(id) ON DELETE RESTRICT,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  supersedes_message_id TEXT REFERENCES messages(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (chat_id, sequence),
  UNIQUE (chat_id, id),
  FOREIGN KEY (project_id, chat_id) REFERENCES chats(project_id, id) ON DELETE RESTRICT,
  CHECK (
    (role = 'user' AND status = 'accepted' AND originating_run_id IS NULL AND originating_imported_run_id IS NULL)
    OR
    (
      role = 'assistant' AND status IN ('completed', 'interrupted')
      AND ((originating_run_id IS NOT NULL) <> (originating_imported_run_id IS NOT NULL))
    )
  )
) STRICT;

CREATE TABLE message_payloads (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE RESTRICT,
  blocks_v1_json TEXT CHECK (blocks_v1_json IS NULL OR (json_valid(blocks_v1_json) AND json_type(blocks_v1_json) = 'array')),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  erased_at TEXT,
  CHECK ((blocks_v1_json IS NULL) = (erased_at IS NOT NULL))
) STRICT;

CREATE TABLE message_attachments (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  project_media_ref_id TEXT NOT NULL REFERENCES project_media_refs(id) ON DELETE RESTRICT,
  global_asset_id TEXT NOT NULL REFERENCES global_media_assets(id) ON DELETE RESTRICT,
  blob_hash TEXT NOT NULL REFERENCES media_blobs(hash) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('reference', 'input', 'attachment')),
  PRIMARY KEY (message_id, ordinal)
) STRICT;

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  root_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  parent_run_id TEXT REFERENCES runs(id) ON DELETE RESTRICT,
  retry_of_run_id TEXT REFERENCES runs(id) ON DELETE RESTRICT,
  retry_seed_hash TEXT CHECK (retry_seed_hash IS NULL OR (length(retry_seed_hash) = 64 AND retry_seed_hash NOT GLOB '*[^0-9a-f]*')),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE RESTRICT,
  objective_message_id TEXT REFERENCES messages(id) ON DELETE RESTRICT,
  objective_parent_event_id TEXT REFERENCES run_events(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  objective_hash TEXT NOT NULL CHECK (length(objective_hash) = 64 AND objective_hash NOT GLOB '*[^0-9a-f]*'),
  child_display_name TEXT CHECK (child_display_name IS NULL OR length(child_display_name) BETWEEN 1 AND 240),
  child_public_summary TEXT CHECK (child_public_summary IS NULL OR length(child_public_summary) BETWEEN 1 AND 20000),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'running', 'waiting_question', 'waiting_confirmation', 'paused', 'recovering', 'completed', 'blocked', 'failed', 'cancelled')),
  provider_profile_id TEXT REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  reasoning_strength TEXT,
  permission_mode TEXT NOT NULL CHECK (permission_mode IN ('read_only', 'reversible', 'full')),
  budget_v1_json TEXT NOT NULL CHECK (json_valid(budget_v1_json) AND json_type(budget_v1_json) = 'object'),
  context_manifest_id TEXT NOT NULL,
  context_manifest_hash TEXT NOT NULL CHECK (length(context_manifest_hash) = 64 AND context_manifest_hash NOT GLOB '*[^0-9a-f]*'),
  capability_catalog_snapshot_id TEXT NOT NULL,
  capability_catalog_hash TEXT NOT NULL CHECK (length(capability_catalog_hash) = 64 AND capability_catalog_hash NOT GLOB '*[^0-9a-f]*'),
  accepted_at TEXT NOT NULL,
  finished_at TEXT,
  terminal_summary TEXT,
  FOREIGN KEY (context_manifest_id) REFERENCES context_manifests(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (capability_catalog_snapshot_id) REFERENCES capability_catalog_snapshots(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (retry_of_run_id),
  CHECK ((retry_of_run_id IS NULL) = (retry_seed_hash IS NULL)),
  CHECK (retry_of_run_id IS NULL OR retry_of_run_id <> id),
  CHECK (retry_of_run_id IS NULL OR (parent_run_id IS NULL AND root_run_id = id)),
  CHECK (
    (
      parent_run_id IS NULL AND root_run_id = id AND objective_message_id IS NOT NULL
      AND objective_parent_event_id IS NULL AND child_display_name IS NULL
      AND child_public_summary IS NULL
    )
    OR
    (
      parent_run_id IS NOT NULL AND root_run_id <> id AND parent_run_id <> id
      AND objective_message_id IS NULL AND objective_parent_event_id IS NOT NULL
      AND child_display_name IS NOT NULL AND child_public_summary IS NOT NULL
      AND retry_of_run_id IS NULL AND retry_seed_hash IS NULL
    )
  ),
  CHECK ((status IN ('completed', 'blocked', 'failed', 'cancelled')) = (finished_at IS NOT NULL AND terminal_summary IS NOT NULL))
) STRICT;

CREATE TABLE context_manifests (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE RESTRICT,
  user_message_id TEXT REFERENCES messages(id) ON DELETE RESTRICT,
  parent_event_id TEXT REFERENCES run_events(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  manifest_hash TEXT NOT NULL CHECK (length(manifest_hash) = 64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'),
  manifest_v1_json TEXT NOT NULL CHECK (json_valid(manifest_v1_json) AND json_type(manifest_v1_json) = 'object'),
  created_at TEXT NOT NULL,
  CHECK ((user_message_id IS NOT NULL) <> (parent_event_id IS NOT NULL))
) STRICT;

CREATE TABLE capability_catalog_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE RESTRICT,
  catalog_hash TEXT NOT NULL CHECK (length(catalog_hash) = 64 AND catalog_hash NOT GLOB '*[^0-9a-f]*'),
  catalog_v1_json TEXT NOT NULL CHECK (json_valid(catalog_v1_json) AND json_type(catalog_v1_json) = 'object'),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE task_lists (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  state TEXT NOT NULL CHECK (state IN ('active', 'completed', 'cancelled')),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  terminalized_at TEXT,
  CHECK ((state = 'active') = (terminalized_at IS NULL))
) STRICT;

CREATE TABLE task_items (
  id TEXT PRIMARY KEY,
  task_list_id TEXT NOT NULL REFERENCES task_lists(id) ON DELETE RESTRICT,
  parent_item_id TEXT REFERENCES task_items(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  state TEXT NOT NULL CHECK (state IN ('pending', 'in_progress', 'blocked', 'completed', 'cancelled')),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  child_run_ids_v1_json TEXT NOT NULL CHECK (json_valid(child_run_ids_v1_json) AND json_type(child_run_ids_v1_json) = 'array'),
  public_note TEXT NOT NULL,
  UNIQUE (task_list_id, id)
) STRICT;

CREATE TABLE run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  event_version INTEGER NOT NULL CHECK (event_version > 0),
  surface TEXT NOT NULL CHECK (surface IN ('model_surface', 'public')),
  occurred_at TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'commander', 'system', 'import')),
  causation_v1_json TEXT NOT NULL CHECK (json_valid(causation_v1_json) AND json_type(causation_v1_json) = 'object'),
  correlation_id TEXT,
  idempotency_key TEXT,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  previous_event_hash TEXT CHECK (previous_event_hash IS NULL OR (length(previous_event_hash) = 64 AND previous_event_hash NOT GLOB '*[^0-9a-f]*')),
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64 AND event_hash NOT GLOB '*[^0-9a-f]*'),
  UNIQUE (run_id, sequence),
  UNIQUE (run_id, event_hash),
  UNIQUE (run_id, idempotency_key)
) STRICT;

CREATE TABLE run_event_payloads (
  run_event_id TEXT PRIMARY KEY REFERENCES run_events(id) ON DELETE RESTRICT,
  payload_v1_json TEXT CHECK (payload_v1_json IS NULL OR (json_valid(payload_v1_json) AND json_type(payload_v1_json) = 'object')),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  erased_at TEXT,
  CHECK ((payload_v1_json IS NULL) = (erased_at IS NOT NULL))
) STRICT;

CREATE TABLE run_inbox_messages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  actor TEXT NOT NULL CHECK (actor IN ('user', 'commander')),
  source_v1_json TEXT NOT NULL CHECK (json_valid(source_v1_json) AND json_type(source_v1_json) = 'object'),
  selected_context_v1_json TEXT NOT NULL CHECK (json_valid(selected_context_v1_json) AND json_type(selected_context_v1_json) = 'array'),
  export_destination_grant_v1_json TEXT CHECK (export_destination_grant_v1_json IS NULL OR (json_valid(export_destination_grant_v1_json) AND json_type(export_destination_grant_v1_json) = 'object')),
  export_destination_grant_hash TEXT CHECK (export_destination_grant_hash IS NULL OR (length(export_destination_grant_hash) = 64 AND export_destination_grant_hash NOT GLOB '*[^0-9a-f]*')),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK (state IN ('queued', 'delivered', 'consumed', 'cancelled')),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, sequence),
  CHECK ((export_destination_grant_v1_json IS NULL) = (export_destination_grant_hash IS NULL))
) STRICT;

CREATE TABLE run_activations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  activation_number INTEGER NOT NULL CHECK (activation_number > 0),
  trigger_inbox_message_id TEXT NOT NULL REFERENCES run_inbox_messages(id) ON DELETE RESTRICT,
  trigger_inbox_sequence INTEGER NOT NULL CHECK (trigger_inbox_sequence > 0),
  state TEXT NOT NULL CHECK (state IN ('active', 'ended')),
  event_start_sequence INTEGER NOT NULL CHECK (event_start_sequence > 0),
  event_end_sequence INTEGER CHECK (event_end_sequence IS NULL OR event_end_sequence >= event_start_sequence),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('safe_boundary', 'waiting', 'paused', 'terminal', 'process_exit', 'failure')),
  UNIQUE (run_id, activation_number),
  CHECK ((state = 'ended') = (event_end_sequence IS NOT NULL AND ended_at IS NOT NULL AND end_reason IS NOT NULL))
) STRICT;

CREATE TABLE run_interactions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('question', 'confirmation')),
  prompt TEXT NOT NULL CHECK (length(prompt) BETWEEN 1 AND 20000),
  options_v1_json TEXT NOT NULL CHECK (json_valid(options_v1_json) AND json_type(options_v1_json) = 'array'),
  context_refs_v1_json TEXT NOT NULL CHECK (json_valid(context_refs_v1_json) AND json_type(context_refs_v1_json) = 'array'),
  allow_free_text INTEGER NOT NULL CHECK (allow_free_text IN (0, 1)),
  state TEXT NOT NULL CHECK (state IN ('pending', 'answered', 'cancelled')),
  answer_message_id TEXT REFERENCES messages(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
) STRICT;

CREATE TABLE run_confirmations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  interaction_id TEXT NOT NULL UNIQUE REFERENCES run_interactions(id) ON DELETE RESTRICT,
  target_v1_json TEXT NOT NULL CHECK (json_valid(target_v1_json) AND json_type(target_v1_json) = 'object'),
  immutable_input_hash TEXT NOT NULL CHECK (length(immutable_input_hash) = 64 AND immutable_input_hash NOT GLOB '*[^0-9a-f]*'),
  decision TEXT CHECK (decision IS NULL OR decision IN ('approved', 'denied')),
  decided_by_message_id TEXT REFERENCES messages(id) ON DELETE RESTRICT,
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK ((decision IS NULL) = (decided_at IS NULL AND decided_by_message_id IS NULL))
) STRICT;

CREATE TABLE dispatch_operations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  tool_id TEXT NOT NULL CHECK (length(tool_id) BETWEEN 1 AND 160),
  tool_version TEXT NOT NULL CHECK (length(tool_version) BETWEEN 1 AND 80),
  guard_outcome TEXT NOT NULL CHECK (guard_outcome IN ('allowed', 'confirmation_required', 'denied')),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) = 64 AND idempotency_key NOT GLOB '*[^0-9a-f]*'),
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
  input_v1_json TEXT NOT NULL CHECK (json_valid(input_v1_json) AND json_type(input_v1_json) = 'object'),
  authority_watermark_hash TEXT CHECK (authority_watermark_hash IS NULL OR (length(authority_watermark_hash) = 64 AND authority_watermark_hash NOT GLOB '*[^0-9a-f]*')),
  origin_model_attempt_id TEXT REFERENCES model_attempts(id) ON DELETE RESTRICT,
  origin_provider_call_id TEXT CHECK (origin_provider_call_id IS NULL OR length(origin_provider_call_id) BETWEEN 1 AND 500),
  parent_dispatch_operation_id TEXT REFERENCES dispatch_operations(id) ON DELETE RESTRICT,
  program_step_id TEXT CHECK (program_step_id IS NULL OR length(program_step_id) BETWEEN 1 AND 160),
  program_call_index INTEGER CHECK (program_call_index IS NULL OR program_call_index >= 0),
  confirmation_id TEXT REFERENCES run_confirmations(id) ON DELETE RESTRICT,
  operation_kind TEXT CHECK (operation_kind IS NULL OR operation_kind IN ('generation_attempt', 'media_derivation', 'result_assessment', 'review_cut_attempt', 'delivery_export')),
  owner_authority TEXT CHECK (owner_authority IS NULL OR owner_authority IN ('generation_attempt', 'media_derivation_attempt', 'result_assessment_attempt', 'review_cut_attempt', 'delivery_export')),
  owner_id TEXT,
  project_event_id TEXT REFERENCES project_events(id) ON DELETE RESTRICT,
  outcome_v1_json TEXT CHECK (outcome_v1_json IS NULL OR (json_valid(outcome_v1_json) AND json_type(outcome_v1_json) = 'object')),
  outcome_hash TEXT CHECK (outcome_hash IS NULL OR (length(outcome_hash) = 64 AND outcome_hash NOT GLOB '*[^0-9a-f]*')),
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, idempotency_key),
  UNIQUE (origin_model_attempt_id, origin_provider_call_id),
  UNIQUE (parent_dispatch_operation_id, program_step_id, program_call_index),
  CHECK (
    (origin_model_attempt_id IS NULL AND origin_provider_call_id IS NULL
      AND parent_dispatch_operation_id IS NULL AND program_step_id IS NULL AND program_call_index IS NULL)
    OR (origin_model_attempt_id IS NOT NULL AND origin_provider_call_id IS NOT NULL
      AND parent_dispatch_operation_id IS NULL AND program_step_id IS NULL AND program_call_index IS NULL)
    OR (origin_model_attempt_id IS NULL AND origin_provider_call_id IS NULL
      AND parent_dispatch_operation_id IS NOT NULL AND program_step_id IS NOT NULL AND program_call_index IS NOT NULL)
  ),
  CHECK (parent_dispatch_operation_id IS NULL OR parent_dispatch_operation_id <> id),
  CHECK (
    (outcome_v1_json IS NULL AND outcome_hash IS NULL AND completed_at IS NULL)
    OR (outcome_v1_json IS NOT NULL AND outcome_hash IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CHECK (
    (operation_kind IS NULL AND owner_authority IS NULL AND owner_id IS NULL)
    OR (operation_kind = 'generation_attempt' AND owner_authority = 'generation_attempt' AND owner_id IS NOT NULL)
    OR (operation_kind = 'media_derivation' AND owner_authority = 'media_derivation_attempt' AND owner_id IS NOT NULL)
    OR (operation_kind = 'result_assessment' AND owner_authority = 'result_assessment_attempt' AND owner_id IS NOT NULL)
    OR (operation_kind = 'review_cut_attempt' AND owner_authority = 'review_cut_attempt' AND owner_id IS NOT NULL)
    OR (operation_kind = 'delivery_export' AND owner_authority = 'delivery_export' AND owner_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE run_resource_entries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  dispatch_operation_id TEXT REFERENCES dispatch_operations(id) ON DELETE RESTRICT,
  model_attempt_id TEXT REFERENCES model_attempts(id) ON DELETE RESTRICT,
  phase TEXT NOT NULL CHECK (phase IN ('reserved', 'consumed', 'released')),
  reservation_entry_id TEXT REFERENCES run_resource_entries(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('cost', 'input_tokens', 'output_tokens', 'generation_count', 'duration_ms')),
  amount_v1_json TEXT NOT NULL CHECK (json_valid(amount_v1_json) AND json_type(amount_v1_json) = 'object'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) = 64 AND idempotency_key NOT GLOB '*[^0-9a-f]*'),
  recorded_at TEXT NOT NULL,
  UNIQUE (run_id, idempotency_key),
  CHECK ((dispatch_operation_id IS NULL) != (model_attempt_id IS NULL)),
  CHECK ((phase = 'reserved' AND reservation_entry_id IS NULL) OR phase = 'consumed' OR (phase = 'released' AND reservation_entry_id IS NOT NULL)),
  CHECK (reservation_entry_id IS NULL OR phase IN ('consumed', 'released')),
  CHECK (json_extract(amount_v1_json, '$.value') IS NULL OR CAST(json_extract(amount_v1_json, '$.value') AS REAL) >= 0)
) STRICT;

CREATE TABLE model_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  activation_id TEXT NOT NULL REFERENCES run_activations(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  provider_v1_json TEXT NOT NULL CHECK (json_valid(provider_v1_json) AND json_type(provider_v1_json) = 'object'),
  state TEXT NOT NULL CHECK (state IN ('prepared', 'running', 'submitted', 'unknown', 'succeeded', 'failed', 'cancelled')),
  request_v1_json TEXT NOT NULL CHECK (json_valid(request_v1_json) AND json_type(request_v1_json) = 'object'),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  response_v1_json TEXT CHECK (response_v1_json IS NULL OR (json_valid(response_v1_json) AND json_type(response_v1_json) = 'object')),
  response_hash TEXT CHECK (response_hash IS NULL OR (length(response_hash) = 64 AND response_hash NOT GLOB '*[^0-9a-f]*')),
  usage_v1_json TEXT CHECK (usage_v1_json IS NULL OR (json_valid(usage_v1_json) AND json_type(usage_v1_json) = 'object')),
  created_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (activation_id, attempt_number),
  CHECK ((response_v1_json IS NULL) = (response_hash IS NULL)),
  CHECK ((response_v1_json IS NULL) = (usage_v1_json IS NULL)),
  CHECK ((state IN ('succeeded', 'failed', 'cancelled')) = (finished_at IS NOT NULL)),
  CHECK (state NOT IN ('succeeded', 'failed', 'cancelled') OR response_v1_json IS NOT NULL),
  CHECK (state NOT IN ('prepared', 'running', 'submitted') OR response_v1_json IS NULL)
) STRICT;

CREATE TABLE private_recovery_envelopes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  activation_number INTEGER NOT NULL CHECK (activation_number > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  algorithm TEXT NOT NULL CHECK (algorithm = 'aes-256-gcm'),
  encryption_key_id TEXT NOT NULL CHECK (length(encryption_key_id) BETWEEN 1 AND 160),
  ciphertext BLOB NOT NULL CHECK (length(ciphertext) > 0),
  nonce BLOB NOT NULL CHECK (length(nonce) = 12),
  authentication_tag BLOB NOT NULL CHECK (length(authentication_tag) = 16),
  ciphertext_hash TEXT NOT NULL CHECK (length(ciphertext_hash) = 64 AND ciphertext_hash NOT GLOB '*[^0-9a-f]*'),
  aad_hash TEXT NOT NULL CHECK (length(aad_hash) = 64 AND aad_hash NOT GLOB '*[^0-9a-f]*'),
  previous_envelope_hash TEXT CHECK (previous_envelope_hash IS NULL OR (length(previous_envelope_hash) = 64 AND previous_envelope_hash NOT GLOB '*[^0-9a-f]*')),
  envelope_hash TEXT NOT NULL CHECK (length(envelope_hash) = 64 AND envelope_hash NOT GLOB '*[^0-9a-f]*'),
  byte_length INTEGER NOT NULL CHECK (byte_length = length(ciphertext)),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, sequence),
  UNIQUE (run_id, envelope_hash)
) STRICT;

CREATE TABLE compaction_transactions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  activation_id TEXT NOT NULL REFERENCES run_activations(id) ON DELETE RESTRICT,
  source_event_from INTEGER NOT NULL CHECK (source_event_from > 0),
  source_event_to INTEGER NOT NULL CHECK (source_event_to >= source_event_from),
  state TEXT NOT NULL CHECK (state IN ('started', 'view_derived', 'completed', 'interrupted')),
  original_token_count INTEGER NOT NULL CHECK (original_token_count >= 0),
  compacted_token_count INTEGER CHECK (compacted_token_count IS NULL OR compacted_token_count >= 0),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  interruption_reason TEXT CHECK (interruption_reason IS NULL OR interruption_reason IN ('process_restarted', 'cancelled', 'model_failed', 'validation_failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT
) STRICT;

CREATE TABLE compaction_views (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES compaction_transactions(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  derived_view_hash TEXT NOT NULL CHECK (length(derived_view_hash) = 64 AND derived_view_hash NOT GLOB '*[^0-9a-f]*'),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 200000),
  cited_event_sequences_v1_json TEXT NOT NULL CHECK (json_valid(cited_event_sequences_v1_json) AND json_type(cited_event_sequences_v1_json) = 'array'),
  compacted_token_count INTEGER NOT NULL CHECK (compacted_token_count >= 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE generation_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  target_authority TEXT NOT NULL CHECK (target_authority = 'production'),
  target_id TEXT NOT NULL,
  target_revision INTEGER NOT NULL CHECK (target_revision >= 0),
  target_hash TEXT NOT NULL CHECK (length(target_hash) = 64 AND target_hash NOT GLOB '*[^0-9a-f]*'),
  spec_v1_json TEXT NOT NULL CHECK (json_valid(spec_v1_json) AND json_type(spec_v1_json) = 'object'),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) = 64 AND idempotency_key NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, idempotency_key)
) STRICT;

CREATE TABLE generation_attempts (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES generation_requests(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK (state IN ('prepared', 'running', 'submitted', 'unknown', 'succeeded', 'failed', 'cancelled')),
  provider_profile_id TEXT NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  provider_v1_json TEXT NOT NULL CHECK (json_valid(provider_v1_json) AND json_type(provider_v1_json) = 'object'),
  quote_v1_json TEXT CHECK (quote_v1_json IS NULL OR (json_valid(quote_v1_json) AND json_type(quote_v1_json) = 'object')),
  provider_operation_id TEXT,
  receipt_v1_json TEXT CHECK (receipt_v1_json IS NULL OR (json_valid(receipt_v1_json) AND json_type(receipt_v1_json) = 'object')),
  usage_v1_json TEXT CHECK (usage_v1_json IS NULL OR (json_valid(usage_v1_json) AND json_type(usage_v1_json) = 'object')),
  prompt_provenance_v1_json TEXT NOT NULL CHECK (json_valid(prompt_provenance_v1_json) AND json_type(prompt_provenance_v1_json) = 'object'),
  cancel_requested INTEGER NOT NULL CHECK (cancel_requested IN (0, 1)),
  progress_percent REAL CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
  public_error_code TEXT CHECK (public_error_code IS NULL OR public_error_code IN ('invalid_request', 'permission_denied', 'budget_exceeded', 'provider_failed', 'execution_failed', 'provider_state_unknown', 'cancelled')),
  created_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (request_id, attempt_number),
  UNIQUE (id, request_id),
  CHECK ((provider_operation_id IS NULL) = (receipt_v1_json IS NULL)),
  CHECK (state != 'submitted' OR receipt_v1_json IS NOT NULL),
  CHECK ((state IN ('succeeded', 'failed', 'cancelled')) = (finished_at IS NOT NULL)),
  CHECK (state != 'unknown' OR public_error_code = 'provider_state_unknown'),
  CHECK (state = 'unknown' OR public_error_code IS NULL OR public_error_code != 'provider_state_unknown'),
  CHECK (state != 'cancelled' OR public_error_code = 'cancelled'),
  CHECK (state = 'cancelled' OR public_error_code IS NULL OR public_error_code != 'cancelled'),
  CHECK (state != 'failed' OR public_error_code IN ('invalid_request', 'permission_denied', 'budget_exceeded', 'provider_failed', 'execution_failed')),
  CHECK (state IN ('unknown', 'failed', 'cancelled') OR public_error_code IS NULL)
) STRICT;

CREATE TABLE generated_results (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL REFERENCES generation_requests(id) ON DELETE RESTRICT,
  attempt_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision = 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  blob_hash TEXT NOT NULL REFERENCES media_blobs(hash) ON DELETE RESTRICT,
  global_asset_id TEXT NOT NULL REFERENCES global_media_assets(id) ON DELETE RESTRICT,
  project_media_ref_id TEXT NOT NULL REFERENCES project_media_refs(id) ON DELETE RESTRICT,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video', 'audio')),
  variant_index INTEGER NOT NULL CHECK (variant_index >= 0),
  submitted_prompt TEXT NOT NULL CHECK (length(submitted_prompt) BETWEEN 1 AND 100000),
  submitted_negative_prompt TEXT CHECK (submitted_negative_prompt IS NULL OR length(submitted_negative_prompt) <= 100000),
  prompt_provenance_v1_json TEXT NOT NULL CHECK (json_valid(prompt_provenance_v1_json) AND json_type(prompt_provenance_v1_json) = 'object'),
  reference_bindings_v1_json TEXT NOT NULL CHECK (json_valid(reference_bindings_v1_json) AND json_type(reference_bindings_v1_json) = 'array'),
  provider_v1_json TEXT NOT NULL CHECK (json_valid(provider_v1_json) AND json_type(provider_v1_json) = 'object'),
  seed INTEGER CHECK (seed IS NULL OR seed >= 0),
  receipt_v1_json TEXT NOT NULL CHECK (json_valid(receipt_v1_json) AND json_type(receipt_v1_json) = 'object'),
  usage_v1_json TEXT NOT NULL CHECK (json_valid(usage_v1_json) AND json_type(usage_v1_json) = 'object'),
  technical_validation_v1_json TEXT NOT NULL CHECK (json_valid(technical_validation_v1_json) AND json_type(technical_validation_v1_json) = 'object'),
  created_at TEXT NOT NULL,
  FOREIGN KEY (attempt_id, request_id) REFERENCES generation_attempts(id, request_id) ON DELETE RESTRICT,
  UNIQUE (attempt_id, variant_index),
  UNIQUE (id, revision, content_hash)
) STRICT;

CREATE TABLE result_assessment_attempts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  assessment_kind TEXT NOT NULL CHECK (assessment_kind IN ('technical_integrity', 'reference_similarity', 'continuity', 'coverage', 'delivery_readiness')),
  request_v1_json TEXT NOT NULL CHECK (json_valid(request_v1_json) AND json_type(request_v1_json) = 'object'),
  state TEXT NOT NULL CHECK (state IN ('prepared', 'running', 'submitted', 'unknown', 'succeeded', 'failed', 'cancelled')),
  provider_profile_id TEXT REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  provider_v1_json TEXT CHECK (provider_v1_json IS NULL OR (json_valid(provider_v1_json) AND json_type(provider_v1_json) = 'object')),
  provider_operation_id TEXT,
  receipt_v1_json TEXT CHECK (receipt_v1_json IS NULL OR (json_valid(receipt_v1_json) AND json_type(receipt_v1_json) = 'object')),
  usage_v1_json TEXT CHECK (usage_v1_json IS NULL OR (json_valid(usage_v1_json) AND json_type(usage_v1_json) = 'object')),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) = 64 AND idempotency_key NOT GLOB '*[^0-9a-f]*'),
  cancel_requested INTEGER NOT NULL CHECK (cancel_requested IN (0, 1)),
  progress_percent REAL CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
  public_error_code TEXT CHECK (public_error_code IS NULL OR public_error_code IN ('invalid_request', 'permission_denied', 'budget_exceeded', 'provider_failed', 'execution_failed', 'provider_state_unknown', 'cancelled')),
  created_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (run_id, idempotency_key),
  CHECK ((provider_profile_id IS NULL) = (provider_v1_json IS NULL)),
  CHECK ((provider_operation_id IS NULL) = (receipt_v1_json IS NULL)),
  CHECK (provider_v1_json IS NOT NULL OR receipt_v1_json IS NULL),
  CHECK (
    (assessment_kind IN ('technical_integrity', 'delivery_readiness') AND provider_v1_json IS NULL AND state NOT IN ('submitted', 'unknown'))
    OR
    (assessment_kind IN ('reference_similarity', 'continuity', 'coverage') AND provider_v1_json IS NOT NULL)
  ),
  CHECK (state != 'submitted' OR receipt_v1_json IS NOT NULL),
  CHECK ((state IN ('succeeded', 'failed', 'cancelled')) = (finished_at IS NOT NULL)),
  CHECK (state != 'unknown' OR (provider_v1_json IS NOT NULL AND public_error_code = 'provider_state_unknown')),
  CHECK (state = 'unknown' OR public_error_code IS NULL OR public_error_code != 'provider_state_unknown'),
  CHECK (state != 'cancelled' OR public_error_code = 'cancelled'),
  CHECK (state = 'cancelled' OR public_error_code IS NULL OR public_error_code != 'cancelled'),
  CHECK (state != 'failed' OR public_error_code IN ('invalid_request', 'permission_denied', 'budget_exceeded', 'provider_failed', 'execution_failed')),
  CHECK (state IN ('unknown', 'failed', 'cancelled') OR public_error_code IS NULL)
) STRICT;

CREATE TABLE result_assessment_subjects (
  attempt_id TEXT NOT NULL REFERENCES result_assessment_attempts(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('subject', 'reference')),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  authority TEXT NOT NULL CHECK (authority IN ('project', 'project_media_ref', 'media_derivation_attempt', 'production', 'canvas', 'generation_attempt', 'generated_result', 'result_assessment_attempt', 'delivery', 'delivery_manifest', 'review_cut_attempt', 'delivery_export')),
  object_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (attempt_id, role, ordinal),
  UNIQUE (attempt_id, role, authority, object_id)
) STRICT;

CREATE TABLE result_assessments (
  attempt_id TEXT PRIMARY KEY REFERENCES result_assessment_attempts(id) ON DELETE RESTRICT,
  assessment_v1_json TEXT NOT NULL CHECK (json_valid(assessment_v1_json) AND json_type(assessment_v1_json) = 'object'),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE user_choices (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'commander', 'import')),
  authorization_kind TEXT NOT NULL CHECK (authorization_kind IN ('direct_user', 'commander_dispatch', 'import')),
  authorization_source_id TEXT NOT NULL,
  authorization_input_hash TEXT NOT NULL CHECK (length(authorization_input_hash) = 64 AND authorization_input_hash NOT GLOB '*[^0-9a-f]*'),
  dispatch_operation_id TEXT REFERENCES dispatch_operations(id) ON DELETE RESTRICT,
  confirmation_id TEXT REFERENCES run_confirmations(id) ON DELETE RESTRICT,
  subject_v1_json TEXT NOT NULL CHECK (json_valid(subject_v1_json) AND json_type(subject_v1_json) = 'object'),
  choice_v1_json TEXT NOT NULL CHECK (json_valid(choice_v1_json) AND json_type(choice_v1_json) = 'object'),
  before_effect_v1_json TEXT NOT NULL CHECK (json_valid(before_effect_v1_json) AND json_type(before_effect_v1_json) = 'object'),
  after_effect_v1_json TEXT NOT NULL CHECK (json_valid(after_effect_v1_json) AND json_type(after_effect_v1_json) = 'object'),
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('production', 'delivery')),
  production_owner_id TEXT REFERENCES production_objects(id) ON DELETE RESTRICT,
  delivery_owner_id TEXT REFERENCES delivery_plans(id) ON DELETE RESTRICT,
  owner_before_revision INTEGER CHECK (owner_before_revision IS NULL OR owner_before_revision >= 0),
  owner_before_hash TEXT CHECK (owner_before_hash IS NULL OR (length(owner_before_hash) = 64 AND owner_before_hash NOT GLOB '*[^0-9a-f]*')),
  owner_after_revision INTEGER NOT NULL CHECK (owner_after_revision >= 0),
  owner_after_hash TEXT NOT NULL CHECK (length(owner_after_hash) = 64 AND owner_after_hash NOT GLOB '*[^0-9a-f]*'),
  causation_v1_json TEXT NOT NULL CHECK (json_valid(causation_v1_json) AND json_type(causation_v1_json) = 'object'),
  choice_hash TEXT NOT NULL CHECK (length(choice_hash) = 64 AND choice_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  UNIQUE (id, choice_hash),
  CHECK ((owner_before_revision IS NULL) = (owner_before_hash IS NULL)),
  CHECK (
    (owner_kind = 'production' AND production_owner_id IS NOT NULL AND delivery_owner_id IS NULL)
    OR
    (owner_kind = 'delivery' AND production_owner_id IS NULL AND delivery_owner_id IS NOT NULL)
  ),
  CHECK (
    (actor = 'user' AND authorization_kind = 'direct_user' AND dispatch_operation_id IS NULL AND confirmation_id IS NULL)
    OR
    (actor = 'commander' AND authorization_kind = 'commander_dispatch' AND dispatch_operation_id IS NOT NULL)
    OR
    (actor = 'import' AND authorization_kind = 'import' AND dispatch_operation_id IS NULL AND confirmation_id IS NULL)
  )
) STRICT;

CREATE TABLE user_choice_supersessions (
  choice_id TEXT NOT NULL REFERENCES user_choices(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 31),
  superseded_choice_id TEXT NOT NULL REFERENCES user_choices(id) ON DELETE RESTRICT,
  PRIMARY KEY (choice_id, ordinal),
  UNIQUE (choice_id, superseded_choice_id),
  CHECK (choice_id <> superseded_choice_id)
) STRICT;

CREATE TABLE production_result_decisions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  shot_id TEXT NOT NULL REFERENCES production_objects(id) ON DELETE RESTRICT,
  generated_result_id TEXT NOT NULL,
  generated_result_revision INTEGER NOT NULL CHECK (generated_result_revision = 0),
  generated_result_hash TEXT NOT NULL CHECK (length(generated_result_hash) = 64 AND generated_result_hash NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK (state IN ('selected', 'rejected', 'refine', 'reference')),
  feedback TEXT,
  instruction TEXT,
  current_choice_id TEXT NOT NULL REFERENCES user_choices(id) ON DELETE RESTRICT,
  PRIMARY KEY (shot_id, generated_result_id),
  FOREIGN KEY (project_id, shot_id) REFERENCES production_objects(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (generated_result_id, generated_result_revision, generated_result_hash) REFERENCES generated_results(id, revision, content_hash) ON DELETE RESTRICT,
  CHECK (
    (state IN ('selected', 'reference') AND feedback IS NOT NULL AND instruction IS NULL)
    OR
    (state = 'rejected' AND feedback IS NOT NULL AND length(trim(feedback)) > 0 AND instruction IS NULL)
    OR
    (state = 'refine' AND feedback IS NULL AND instruction IS NOT NULL AND length(trim(instruction)) > 0)
  )
) STRICT;

CREATE TABLE production_protections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  production_object_id TEXT NOT NULL,
  field_ref TEXT NOT NULL CHECK (length(field_ref) BETWEEN 1 AND 500),
  choice_id TEXT NOT NULL REFERENCES user_choices(id) ON DELETE RESTRICT,
  protected_at TEXT NOT NULL,
  released_by_choice_id TEXT REFERENCES user_choices(id) ON DELETE RESTRICT,
  UNIQUE (production_object_id, field_ref, choice_id),
  FOREIGN KEY (project_id, production_object_id) REFERENCES production_objects(project_id, id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE project_media_links (
  id TEXT PRIMARY KEY,
  project_media_ref_id TEXT NOT NULL REFERENCES project_media_refs(id) ON DELETE RESTRICT,
  production_object_id TEXT NOT NULL REFERENCES production_objects(id) ON DELETE RESTRICT,
  relation TEXT NOT NULL CHECK (relation IN ('depicts', 'references', 'generated_for', 'selected_for')),
  created_at TEXT NOT NULL,
  UNIQUE (project_media_ref_id, production_object_id, relation)
) STRICT;

CREATE TABLE delivery_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'archived')),
  format_intent_v1_json TEXT NOT NULL CHECK (json_valid(format_intent_v1_json) AND json_type(format_intent_v1_json) = 'object'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, id),
  UNIQUE (id, revision, content_hash)
) STRICT;

CREATE TABLE delivery_items (
  id TEXT PRIMARY KEY,
  delivery_plan_id TEXT NOT NULL REFERENCES delivery_plans(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'removed')),
  removed_at TEXT,
  shot_id TEXT NOT NULL REFERENCES production_objects(id) ON DELETE RESTRICT,
  shot_revision INTEGER NOT NULL CHECK (shot_revision >= 0),
  shot_content_hash TEXT NOT NULL CHECK (length(shot_content_hash) = 64 AND shot_content_hash NOT GLOB '*[^0-9a-f]*'),
  generated_result_id TEXT NOT NULL,
  generated_result_revision INTEGER NOT NULL CHECK (generated_result_revision = 0),
  generated_result_content_hash TEXT NOT NULL CHECK (length(generated_result_content_hash) = 64 AND generated_result_content_hash NOT GLOB '*[^0-9a-f]*'),
  project_media_ref_id TEXT NOT NULL REFERENCES project_media_refs(id) ON DELETE RESTRICT,
  project_media_revision INTEGER NOT NULL CHECK (project_media_revision >= 0),
  project_media_content_hash TEXT NOT NULL CHECK (length(project_media_content_hash) = 64 AND project_media_content_hash NOT GLOB '*[^0-9a-f]*'),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  trim_start_ms INTEGER NOT NULL CHECK (trim_start_ms >= 0),
  trim_end_ms INTEGER NOT NULL CHECK (trim_end_ms > trim_start_ms),
  audio_policy TEXT NOT NULL CHECK (audio_policy IN ('use', 'mute', 'replace')),
  transition_kind TEXT NOT NULL CHECK (transition_kind IN ('cut', 'crossfade', 'dip_to_black')),
  transition_duration_ms INTEGER NOT NULL CHECK (transition_duration_ms >= 0),
  review_state TEXT NOT NULL CHECK (review_state IN ('unreviewed', 'approved', 'changes_requested')),
  UNIQUE (delivery_plan_id, id),
  UNIQUE (delivery_plan_id, id, revision, content_hash),
  FOREIGN KEY (generated_result_id, generated_result_revision, generated_result_content_hash) REFERENCES generated_results(id, revision, content_hash) ON DELETE RESTRICT,
  CHECK ((lifecycle = 'removed') = (removed_at IS NOT NULL))
) STRICT;

CREATE TABLE delivery_field_choices (
  delivery_plan_id TEXT NOT NULL REFERENCES delivery_plans(id) ON DELETE RESTRICT,
  delivery_item_id TEXT,
  field_ref TEXT NOT NULL CHECK (length(field_ref) BETWEEN 1 AND 500),
  choice_id TEXT NOT NULL REFERENCES user_choices(id) ON DELETE RESTRICT,
  FOREIGN KEY (delivery_plan_id, delivery_item_id) REFERENCES delivery_items(delivery_plan_id, id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE delivery_protections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  delivery_plan_id TEXT NOT NULL REFERENCES delivery_plans(id) ON DELETE RESTRICT,
  delivery_item_id TEXT,
  field_ref TEXT NOT NULL CHECK (length(field_ref) BETWEEN 1 AND 500),
  choice_id TEXT NOT NULL REFERENCES user_choices(id) ON DELETE RESTRICT,
  protected_at TEXT NOT NULL,
  released_by_choice_id TEXT REFERENCES user_choices(id) ON DELETE RESTRICT,
  FOREIGN KEY (delivery_plan_id, delivery_item_id) REFERENCES delivery_items(delivery_plan_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, delivery_plan_id) REFERENCES delivery_plans(project_id, id) ON DELETE RESTRICT,
  UNIQUE (delivery_plan_id, delivery_item_id, field_ref, choice_id)
) STRICT;

CREATE TABLE review_cut_attempts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  delivery_manifest_id TEXT NOT NULL,
  delivery_manifest_revision INTEGER NOT NULL CHECK (delivery_manifest_revision = 0),
  delivery_manifest_hash TEXT NOT NULL CHECK (length(delivery_manifest_hash) = 64 AND delivery_manifest_hash NOT GLOB '*[^0-9a-f]*'),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL CHECK (state IN ('prepared', 'running', 'submitted', 'unknown', 'succeeded', 'failed', 'cancelled')),
  request_v1_json TEXT NOT NULL CHECK (json_valid(request_v1_json) AND json_type(request_v1_json) = 'object'),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) = 64 AND idempotency_key NOT GLOB '*[^0-9a-f]*'),
  cancel_requested INTEGER NOT NULL CHECK (cancel_requested IN (0, 1)),
  progress_percent REAL CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
  public_error_code TEXT CHECK (public_error_code IS NULL OR public_error_code IN ('invalid_request', 'permission_denied', 'budget_exceeded', 'execution_failed', 'cancelled')),
  output_blob_hash TEXT REFERENCES media_blobs(hash) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (run_id, idempotency_key),
  FOREIGN KEY (delivery_manifest_id, delivery_manifest_revision, delivery_manifest_hash) REFERENCES delivery_manifests(id, revision, content_hash) ON DELETE RESTRICT,
  CHECK (state NOT IN ('submitted', 'unknown')),
  CHECK ((state = 'succeeded') = (output_blob_hash IS NOT NULL)),
  CHECK ((state IN ('succeeded', 'failed', 'cancelled')) = (finished_at IS NOT NULL)),
  CHECK (state != 'cancelled' OR public_error_code = 'cancelled'),
  CHECK (state = 'cancelled' OR public_error_code IS NULL OR public_error_code != 'cancelled'),
  CHECK (state != 'failed' OR public_error_code IN ('invalid_request', 'permission_denied', 'budget_exceeded', 'execution_failed')),
  CHECK (state IN ('failed', 'cancelled') OR public_error_code IS NULL)
) STRICT;

CREATE TABLE delivery_manifests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  delivery_plan_id TEXT NOT NULL REFERENCES delivery_plans(id) ON DELETE RESTRICT,
  delivery_revision INTEGER NOT NULL CHECK (delivery_revision >= 0),
  delivery_content_hash TEXT NOT NULL CHECK (length(delivery_content_hash) = 64 AND delivery_content_hash NOT GLOB '*[^0-9a-f]*'),
  revision INTEGER NOT NULL CHECK (revision = 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  format_intent_v1_json TEXT NOT NULL CHECK (json_valid(format_intent_v1_json) AND json_type(format_intent_v1_json) = 'object'),
  created_by_v1_json TEXT NOT NULL CHECK (json_valid(created_by_v1_json) AND json_type(created_by_v1_json) = 'object'),
  frozen_at TEXT NOT NULL,
  UNIQUE (id, revision, content_hash),
  UNIQUE (delivery_plan_id, delivery_revision, delivery_content_hash)
) STRICT;

CREATE TABLE delivery_manifest_items (
  id TEXT PRIMARY KEY,
  delivery_manifest_id TEXT NOT NULL REFERENCES delivery_manifests(id) ON DELETE RESTRICT,
  delivery_item_id TEXT NOT NULL,
  delivery_item_revision INTEGER NOT NULL CHECK (delivery_item_revision >= 0),
  delivery_item_content_hash TEXT NOT NULL CHECK (length(delivery_item_content_hash) = 64 AND delivery_item_content_hash NOT GLOB '*[^0-9a-f]*'),
  shot_id TEXT NOT NULL,
  shot_revision INTEGER NOT NULL CHECK (shot_revision >= 0),
  shot_content_hash TEXT NOT NULL CHECK (length(shot_content_hash) = 64 AND shot_content_hash NOT GLOB '*[^0-9a-f]*'),
  generated_result_id TEXT NOT NULL,
  generated_result_revision INTEGER NOT NULL CHECK (generated_result_revision = 0),
  generated_result_content_hash TEXT NOT NULL CHECK (length(generated_result_content_hash) = 64 AND generated_result_content_hash NOT GLOB '*[^0-9a-f]*'),
  project_media_ref_id TEXT NOT NULL,
  project_media_revision INTEGER NOT NULL CHECK (project_media_revision >= 0),
  project_media_content_hash TEXT NOT NULL CHECK (length(project_media_content_hash) = 64 AND project_media_content_hash NOT GLOB '*[^0-9a-f]*'),
  global_asset_id TEXT NOT NULL,
  global_asset_revision INTEGER NOT NULL CHECK (global_asset_revision >= 0),
  global_asset_content_hash TEXT NOT NULL CHECK (length(global_asset_content_hash) = 64 AND global_asset_content_hash NOT GLOB '*[^0-9a-f]*'),
  blob_hash TEXT NOT NULL REFERENCES media_blobs(hash) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  trim_start_ms INTEGER NOT NULL CHECK (trim_start_ms >= 0),
  trim_end_ms INTEGER NOT NULL CHECK (trim_end_ms > trim_start_ms),
  audio_policy TEXT NOT NULL CHECK (audio_policy IN ('use', 'mute', 'replace')),
  transition_kind TEXT NOT NULL CHECK (transition_kind IN ('cut', 'crossfade', 'dip_to_black')),
  transition_duration_ms INTEGER NOT NULL CHECK (transition_duration_ms >= 0),
  review_state TEXT NOT NULL CHECK (review_state IN ('unreviewed', 'approved', 'changes_requested')),
  UNIQUE (delivery_manifest_id, ordinal),
  UNIQUE (delivery_manifest_id, delivery_item_id),
  FOREIGN KEY (generated_result_id, generated_result_revision, generated_result_content_hash) REFERENCES generated_results(id, revision, content_hash) ON DELETE RESTRICT
) STRICT;

CREATE TABLE delivery_manifest_choices (
  delivery_manifest_id TEXT NOT NULL REFERENCES delivery_manifests(id) ON DELETE RESTRICT,
  delivery_item_id TEXT,
  field_ref TEXT NOT NULL CHECK (length(field_ref) BETWEEN 1 AND 500),
  choice_id TEXT NOT NULL,
  choice_hash TEXT NOT NULL CHECK (length(choice_hash) = 64 AND choice_hash NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (choice_id, choice_hash) REFERENCES user_choices(id, choice_hash) ON DELETE RESTRICT
) STRICT;

CREATE TABLE delivery_manifest_protections (
  delivery_manifest_id TEXT NOT NULL REFERENCES delivery_manifests(id) ON DELETE RESTRICT,
  delivery_item_id TEXT,
  field_ref TEXT NOT NULL CHECK (length(field_ref) BETWEEN 1 AND 500),
  choice_id TEXT NOT NULL,
  choice_hash TEXT NOT NULL CHECK (length(choice_hash) = 64 AND choice_hash NOT GLOB '*[^0-9a-f]*'),
  FOREIGN KEY (choice_id, choice_hash) REFERENCES user_choices(id, choice_hash) ON DELETE RESTRICT
) STRICT;

CREATE TABLE delivery_exports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE RESTRICT,
  delivery_manifest_id TEXT NOT NULL,
  delivery_manifest_revision INTEGER NOT NULL CHECK (delivery_manifest_revision = 0),
  delivery_manifest_hash TEXT NOT NULL CHECK (length(delivery_manifest_hash) = 64 AND delivery_manifest_hash NOT GLOB '*[^0-9a-f]*'),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  destination_kind TEXT NOT NULL CHECK (destination_kind IN ('user_selected_file', 'user_selected_folder')),
  destination_grant_id TEXT NOT NULL CHECK (length(destination_grant_id) BETWEEN 1 AND 160),
  destination_grant_hash TEXT NOT NULL CHECK (length(destination_grant_hash) = 64 AND destination_grant_hash NOT GLOB '*[^0-9a-f]*'),
  destination_display_label TEXT NOT NULL CHECK (length(destination_display_label) BETWEEN 1 AND 512 AND instr(destination_display_label, '/') = 0 AND instr(destination_display_label, char(92)) = 0),
  destination_v1_json TEXT NOT NULL CHECK (json_valid(destination_v1_json) AND json_type(destination_v1_json) = 'object'),
  overwrite_existing INTEGER NOT NULL CHECK (overwrite_existing IN (0, 1)),
  state TEXT NOT NULL CHECK (state IN ('prepared', 'running', 'submitted', 'unknown', 'succeeded', 'failed', 'cancelled')),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) = 64 AND idempotency_key NOT GLOB '*[^0-9a-f]*'),
  cancel_requested INTEGER NOT NULL CHECK (cancel_requested IN (0, 1)),
  progress_percent REAL CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100),
  public_error_code TEXT CHECK (public_error_code IS NULL OR public_error_code IN ('invalid_request', 'permission_denied', 'budget_exceeded', 'execution_failed', 'cancelled')),
  output_blob_hash TEXT REFERENCES media_blobs(hash) ON DELETE RESTRICT,
  output_content_hash TEXT CHECK (output_content_hash IS NULL OR (length(output_content_hash) = 64 AND output_content_hash NOT GLOB '*[^0-9a-f]*')),
  created_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (run_id, idempotency_key),
  FOREIGN KEY (delivery_manifest_id, delivery_manifest_revision, delivery_manifest_hash) REFERENCES delivery_manifests(id, revision, content_hash) ON DELETE RESTRICT,
  CHECK (state NOT IN ('submitted', 'unknown')),
  CHECK ((output_blob_hash IS NULL) = (output_content_hash IS NULL)),
  CHECK ((state = 'succeeded') = (output_blob_hash IS NOT NULL)),
  CHECK ((state IN ('succeeded', 'failed', 'cancelled')) = (finished_at IS NOT NULL)),
  CHECK (state != 'cancelled' OR public_error_code = 'cancelled'),
  CHECK (state = 'cancelled' OR public_error_code IS NULL OR public_error_code != 'cancelled'),
  CHECK (state != 'failed' OR public_error_code IN ('invalid_request', 'permission_denied', 'budget_exceeded', 'execution_failed')),
  CHECK (state IN ('failed', 'cancelled') OR public_error_code IS NULL)
) STRICT;

CREATE TABLE project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  event_version INTEGER NOT NULL CHECK (event_version > 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('object_created', 'object_revision_changed', 'message_appended', 'choice_recorded', 'media_attached', 'media_detached', 'generated_result_recorded', 'delivery_changed', 'payload_redacted')),
  occurred_at TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'commander', 'system', 'import')),
  subject_authority TEXT NOT NULL CHECK (subject_authority IN (
    'project', 'project_settings', 'media_blob', 'global_media_asset', 'project_media_ref',
    'media_derivation', 'media_derivation_attempt', 'production', 'canvas', 'chat', 'message',
    'run', 'context_manifest', 'task_list', 'generation_attempt', 'generated_result',
    'result_assessment_attempt', 'user_choice', 'delivery', 'delivery_manifest', 'review_cut_attempt', 'delivery_export',
    'project_event', 'project_memory', 'skill'
  )),
  subject_id TEXT NOT NULL,
  causation_kind TEXT NOT NULL CHECK (causation_kind IN ('message', 'run', 'user_choice', 'import', 'direct_ui', 'run_inbox')),
  causation_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  previous_event_hash TEXT CHECK (previous_event_hash IS NULL OR (length(previous_event_hash) = 64 AND previous_event_hash NOT GLOB '*[^0-9a-f]*')),
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64 AND event_hash NOT GLOB '*[^0-9a-f]*'),
  UNIQUE (project_id, sequence),
  UNIQUE (project_id, idempotency_key),
  UNIQUE (project_id, event_hash)
) STRICT;

CREATE TABLE project_event_payloads (
  project_event_id TEXT PRIMARY KEY REFERENCES project_events(id) ON DELETE RESTRICT,
  payload_v1_json TEXT CHECK (payload_v1_json IS NULL OR (json_valid(payload_v1_json) AND json_type(payload_v1_json) = 'object')),
  erased_at TEXT,
  CHECK ((payload_v1_json IS NULL) = (erased_at IS NOT NULL))
) STRICT;

CREATE TABLE wire_command_receipts (
  request_id TEXT PRIMARY KEY,
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*'),
  project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  response_v1_json TEXT NOT NULL CHECK (json_valid(response_v1_json) AND json_type(response_v1_json) = 'object'),
  response_hash TEXT NOT NULL CHECK (length(response_hash) = 64 AND response_hash NOT GLOB '*[^0-9a-f]*'),
  committed_at TEXT NOT NULL
) STRICT;

CREATE TABLE project_memory_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  derivation_version TEXT NOT NULL CHECK (length(derivation_version) BETWEEN 1 AND 80),
  source_schema_version TEXT NOT NULL CHECK (length(source_schema_version) BETWEEN 1 AND 80),
  history_watermark INTEGER NOT NULL CHECK (history_watermark >= 0),
  source_set_hash TEXT NOT NULL CHECK (length(source_set_hash) = 64 AND source_set_hash NOT GLOB '*[^0-9a-f]*'),
  completeness TEXT NOT NULL CHECK (completeness IN ('complete', 'partial', 'failed')),
  created_at TEXT NOT NULL,
  UNIQUE (project_id, derivation_version, history_watermark, source_set_hash),
  UNIQUE (project_id, id, completeness)
) STRICT;

CREATE TABLE project_memory_heads (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE RESTRICT,
  memory_version_id TEXT NOT NULL,
  completeness TEXT NOT NULL CHECK (completeness = 'complete'),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id, memory_version_id, completeness)
    REFERENCES project_memory_versions(project_id, id, completeness) ON DELETE RESTRICT
) STRICT;

CREATE TABLE project_memory_items (
  id TEXT PRIMARY KEY,
  memory_version_id TEXT NOT NULL REFERENCES project_memory_versions(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK (category IN ('identity', 'visual_direction', 'story', 'production', 'media', 'decision', 'delivery')),
  sources_v1_json TEXT NOT NULL CHECK (json_valid(sources_v1_json) AND json_type(sources_v1_json) = 'array'),
  state TEXT NOT NULL CHECK (state IN ('current', 'superseded', 'conflicted')),
  tentative INTEGER NOT NULL CHECK (tentative IN (0, 1)),
  topics_v1_json TEXT NOT NULL CHECK (json_valid(topics_v1_json) AND json_type(topics_v1_json) = 'array'),
  searchable_text TEXT NOT NULL CHECK (length(searchable_text) BETWEEN 1 AND 100000),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  UNIQUE (memory_version_id, id)
) STRICT;

CREATE TABLE project_search_documents (
  search_document_id INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('production', 'project_media_ref', 'delivery', 'generated_result', 'result_assessment', 'review_cut', 'delivery_export', 'message')),
  source_id TEXT NOT NULL,
  source_revision INTEGER CHECK (source_revision IS NULL OR source_revision >= 0),
  source_hash TEXT NOT NULL CHECK (length(source_hash) = 64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
  source_state TEXT NOT NULL CHECK (source_state IN ('current', 'historical')),
  source_v1_json TEXT NOT NULL CHECK (json_valid(source_v1_json) AND json_type(source_v1_json) = 'object'),
  search_text TEXT NOT NULL CHECK (length(search_text) BETWEEN 1 AND 200000),
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, source_kind, source_id),
  CHECK (
    (source_kind = 'message' AND source_revision IS NULL)
    OR
    (source_kind != 'message' AND source_revision IS NOT NULL)
  )
) STRICT;

CREATE TABLE imported_history_batches (
  id TEXT PRIMARY KEY,
  source_schema_id TEXT NOT NULL CHECK (length(source_schema_id) BETWEEN 1 AND 160),
  source_snapshot_hash TEXT NOT NULL CHECK (length(source_snapshot_hash) = 64 AND source_snapshot_hash NOT GLOB '*[^0-9a-f]*'),
  classification_hash TEXT NOT NULL CHECK (length(classification_hash) = 64 AND classification_hash NOT GLOB '*[^0-9a-f]*'),
  plan_hash TEXT NOT NULL CHECK (length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'),
  offline_evidence_manifest_hash TEXT CHECK (offline_evidence_manifest_hash IS NULL OR (length(offline_evidence_manifest_hash) = 64 AND offline_evidence_manifest_hash NOT GLOB '*[^0-9a-f]*')),
  reconciliation_hash TEXT NOT NULL CHECK (length(reconciliation_hash) = 64 AND reconciliation_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  UNIQUE (source_schema_id, source_snapshot_hash, classification_hash, plan_hash)
) STRICT;

CREATE TABLE imported_run_history (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES imported_history_batches(id) ON DELETE RESTRICT,
  legacy_run_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  chat_id TEXT,
  legacy_session_id TEXT,
  root_run_id TEXT NOT NULL,
  parent_run_id TEXT,
  retry_of_run_id TEXT,
  work_type TEXT NOT NULL CHECK (work_type IN ('agent', 'subagent', 'tool_program')),
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 240),
  intent TEXT NOT NULL CHECK (length(intent) BETWEEN 1 AND 20000),
  objective TEXT CHECK (objective IS NULL OR length(objective) BETWEEN 1 AND 100000),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'running', 'paused', 'completed', 'failed', 'cancelled', 'blocked', 'max_steps')),
  accepted_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  last_sequence INTEGER CHECK (last_sequence IS NULL OR last_sequence >= 0),
  source_payload_v1_json TEXT NOT NULL CHECK (json_valid(source_payload_v1_json)),
  source_payload_hash TEXT NOT NULL CHECK (length(source_payload_hash) = 64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  UNIQUE (batch_id, legacy_run_id),
  UNIQUE (batch_id, id),
  UNIQUE (project_id, id),
  UNIQUE (batch_id, project_id, id),
  FOREIGN KEY (project_id, chat_id) REFERENCES chats(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id, project_id, root_run_id)
    REFERENCES imported_run_history(batch_id, project_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (batch_id, project_id, parent_run_id)
    REFERENCES imported_run_history(batch_id, project_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (batch_id, project_id, retry_of_run_id)
    REFERENCES imported_run_history(batch_id, project_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (parent_run_id IS NULL OR parent_run_id <> id),
  CHECK (retry_of_run_id IS NULL OR retry_of_run_id <> id)
) STRICT;

CREATE TABLE imported_run_event_history (
  id TEXT NOT NULL UNIQUE,
  batch_id TEXT NOT NULL REFERENCES imported_history_batches(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  event_kind TEXT NOT NULL CHECK (length(event_kind) BETWEEN 1 AND 4000),
  step INTEGER NOT NULL CHECK (step >= 0),
  occurred_at TEXT NOT NULL,
  public_payload_v1_json TEXT NOT NULL CHECK (json_valid(public_payload_v1_json)),
  public_payload_hash TEXT NOT NULL CHECK (length(public_payload_hash) = 64 AND public_payload_hash NOT GLOB '*[^0-9a-f]*'),
  private_payload_present INTEGER NOT NULL CHECK (private_payload_present IN (0, 1)),
  private_payload_hash TEXT CHECK (private_payload_hash IS NULL OR (length(private_payload_hash) = 64 AND private_payload_hash NOT GLOB '*[^0-9a-f]*')),
  offline_evidence_id TEXT,
  previous_event_hash TEXT CHECK (previous_event_hash IS NULL OR (length(previous_event_hash) = 64 AND previous_event_hash NOT GLOB '*[^0-9a-f]*')),
  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64 AND event_hash NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (run_id, sequence),
  UNIQUE (run_id, event_hash),
  FOREIGN KEY (batch_id, run_id)
    REFERENCES imported_run_history(batch_id, id) ON DELETE RESTRICT,
  CHECK (
    (private_payload_present = 0 AND private_payload_hash IS NULL AND offline_evidence_id IS NULL)
    OR
    (private_payload_present = 1 AND private_payload_hash IS NOT NULL AND offline_evidence_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE imported_run_scope_history (
  batch_id TEXT NOT NULL REFERENCES imported_history_batches(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  scope_kind TEXT NOT NULL CHECK (length(scope_kind) BETWEEN 1 AND 4000),
  payload_v1_json TEXT NOT NULL CHECK (json_valid(payload_v1_json)),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, ordinal),
  FOREIGN KEY (batch_id, run_id)
    REFERENCES imported_run_history(batch_id, id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE imported_run_attachment_history (
  batch_id TEXT NOT NULL REFERENCES imported_history_batches(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  project_media_ref_id TEXT NOT NULL REFERENCES project_media_refs(id) ON DELETE RESTRICT,
  global_asset_id TEXT NOT NULL REFERENCES global_media_assets(id) ON DELETE RESTRICT,
  blob_hash TEXT NOT NULL REFERENCES media_blobs(hash) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('reference', 'input', 'attachment', 'output')),
  source_payload_hash TEXT NOT NULL CHECK (length(source_payload_hash) = 64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, ordinal),
  FOREIGN KEY (batch_id, run_id)
    REFERENCES imported_run_history(batch_id, id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE imported_task_list_history (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES imported_history_batches(id) ON DELETE RESTRICT,
  legacy_task_list_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  chat_id TEXT,
  imported_run_id TEXT,
  task_list_type TEXT NOT NULL CHECK (length(task_list_type) BETWEEN 1 AND 4000),
  trigger_source TEXT NOT NULL CHECK (length(trigger_source) BETWEEN 1 AND 4000),
  status TEXT NOT NULL CHECK (length(status) BETWEEN 1 AND 4000),
  summary TEXT NOT NULL CHECK (length(summary) <= 20000),
  source_payload_v1_json TEXT NOT NULL CHECK (json_valid(source_payload_v1_json)),
  source_payload_hash TEXT NOT NULL CHECK (length(source_payload_hash) = 64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (batch_id, legacy_task_list_id),
  UNIQUE (batch_id, project_id, id),
  UNIQUE (project_id, id),
  FOREIGN KEY (project_id, chat_id) REFERENCES chats(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id, project_id, imported_run_id)
    REFERENCES imported_run_history(batch_id, project_id, id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE imported_task_item_history (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES imported_history_batches(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  task_list_id TEXT NOT NULL,
  legacy_task_id TEXT NOT NULL,
  parent_item_id TEXT,
  phase_key TEXT NOT NULL CHECK (length(phase_key) BETWEEN 1 AND 4000),
  phase_name TEXT NOT NULL CHECK (length(phase_name) BETWEEN 1 AND 4000),
  phase_order INTEGER NOT NULL CHECK (phase_order >= 0),
  task_key TEXT NOT NULL CHECK (length(task_key) BETWEEN 1 AND 4000),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 4000),
  task_kind TEXT NOT NULL CHECK (length(task_kind) BETWEEN 1 AND 4000),
  status TEXT NOT NULL CHECK (length(status) BETWEEN 1 AND 4000),
  source_payload_v1_json TEXT NOT NULL CHECK (json_valid(source_payload_v1_json)),
  source_payload_hash TEXT NOT NULL CHECK (length(source_payload_hash) = 64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (task_list_id, legacy_task_id),
  UNIQUE (task_list_id, id),
  UNIQUE (batch_id, project_id, id),
  UNIQUE (project_id, id),
  FOREIGN KEY (batch_id, project_id, task_list_id)
    REFERENCES imported_task_list_history(batch_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (task_list_id, parent_item_id)
    REFERENCES imported_task_item_history(task_list_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (parent_item_id IS NULL OR parent_item_id <> id)
) STRICT;

CREATE TABLE imported_history_records (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES imported_history_batches(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  schema_id TEXT NOT NULL CHECK (schema_id IN (
    'legacy.task_dependency.v1', 'legacy.task_artifact.v1', 'legacy.task_attempt.v1',
    'legacy.task_event.v1', 'legacy.task_decision.v1', 'legacy.task_evaluation.v1',
    'legacy.plan_document.v1', 'legacy.plan_approval.v1', 'legacy.prompt_assembly.v1',
    'legacy.delivery_intent.v1', 'legacy.generation_metadata.v1', 'legacy.unmigrated_payload.v1'
  )),
  source_record_id TEXT NOT NULL,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN (
    'project', 'chat', 'imported_run', 'imported_task_list', 'imported_task_item',
    'production', 'project_media_ref'
  )),
  owner_project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  owner_chat_id TEXT,
  owner_imported_run_id TEXT,
  owner_imported_task_list_id TEXT,
  owner_imported_task_item_id TEXT,
  owner_production_object_id TEXT,
  owner_project_media_ref_id TEXT REFERENCES project_media_refs(id) ON DELETE RESTRICT,
  parent_record_id TEXT,
  sequence INTEGER CHECK (sequence IS NULL OR sequence >= 0),
  occurred_at TEXT,
  public_payload_v1_json TEXT NOT NULL CHECK (json_valid(public_payload_v1_json)),
  public_payload_hash TEXT NOT NULL CHECK (length(public_payload_hash) = 64 AND public_payload_hash NOT GLOB '*[^0-9a-f]*'),
  private_payload_present INTEGER NOT NULL CHECK (private_payload_present IN (0, 1)),
  private_payload_hash TEXT CHECK (private_payload_hash IS NULL OR (length(private_payload_hash) = 64 AND private_payload_hash NOT GLOB '*[^0-9a-f]*')),
  offline_evidence_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (batch_id, schema_id, source_record_id),
  UNIQUE (batch_id, project_id, id),
  FOREIGN KEY (project_id, owner_chat_id) REFERENCES chats(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id, project_id, owner_imported_run_id)
    REFERENCES imported_run_history(batch_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id, project_id, owner_imported_task_list_id)
    REFERENCES imported_task_list_history(batch_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id, project_id, owner_imported_task_item_id)
    REFERENCES imported_task_item_history(batch_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, owner_production_object_id) REFERENCES production_objects(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id, project_id, parent_record_id)
    REFERENCES imported_history_records(batch_id, project_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (parent_record_id IS NULL OR parent_record_id <> id),
  CHECK (
    (owner_kind = 'project' AND owner_project_id = project_id AND owner_chat_id IS NULL AND owner_imported_run_id IS NULL AND owner_imported_task_list_id IS NULL AND owner_imported_task_item_id IS NULL AND owner_production_object_id IS NULL AND owner_project_media_ref_id IS NULL)
    OR
    (owner_kind = 'chat' AND owner_project_id IS NULL AND owner_chat_id IS NOT NULL AND owner_imported_run_id IS NULL AND owner_imported_task_list_id IS NULL AND owner_imported_task_item_id IS NULL AND owner_production_object_id IS NULL AND owner_project_media_ref_id IS NULL)
    OR
    (owner_kind = 'imported_run' AND owner_project_id IS NULL AND owner_chat_id IS NULL AND owner_imported_run_id IS NOT NULL AND owner_imported_task_list_id IS NULL AND owner_imported_task_item_id IS NULL AND owner_production_object_id IS NULL AND owner_project_media_ref_id IS NULL)
    OR
    (owner_kind = 'imported_task_list' AND owner_project_id IS NULL AND owner_chat_id IS NULL AND owner_imported_run_id IS NULL AND owner_imported_task_list_id IS NOT NULL AND owner_imported_task_item_id IS NULL AND owner_production_object_id IS NULL AND owner_project_media_ref_id IS NULL)
    OR
    (owner_kind = 'imported_task_item' AND owner_project_id IS NULL AND owner_chat_id IS NULL AND owner_imported_run_id IS NULL AND owner_imported_task_list_id IS NULL AND owner_imported_task_item_id IS NOT NULL AND owner_production_object_id IS NULL AND owner_project_media_ref_id IS NULL)
    OR
    (owner_kind = 'production' AND owner_project_id IS NULL AND owner_chat_id IS NULL AND owner_imported_run_id IS NULL AND owner_imported_task_list_id IS NULL AND owner_imported_task_item_id IS NULL AND owner_production_object_id IS NOT NULL AND owner_project_media_ref_id IS NULL)
    OR
    (owner_kind = 'project_media_ref' AND owner_project_id IS NULL AND owner_chat_id IS NULL AND owner_imported_run_id IS NULL AND owner_imported_task_list_id IS NULL AND owner_imported_task_item_id IS NULL AND owner_production_object_id IS NULL AND owner_project_media_ref_id IS NOT NULL)
  ),
  CHECK (
    (private_payload_present = 0 AND private_payload_hash IS NULL AND offline_evidence_id IS NULL)
    OR
    (private_payload_present = 1 AND private_payload_hash IS NOT NULL AND offline_evidence_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE production_collections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  parent_collection_id TEXT,
  clone_of_collection_id TEXT REFERENCES production_collections(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  source_collection_id TEXT NOT NULL CHECK (length(source_collection_id) BETWEEN 1 AND 240),
  import_batch_id TEXT NOT NULL REFERENCES imported_history_batches(id) ON DELETE RESTRICT,
  source_payload_hash TEXT NOT NULL CHECK (length(source_payload_hash) = 64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
  sort_order INTEGER NOT NULL CHECK (sort_order BETWEEN -9007199254740991 AND 9007199254740991),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, id),
  UNIQUE (id, import_batch_id),
  UNIQUE (project_id, source_collection_id),
  FOREIGN KEY (project_id, parent_collection_id) REFERENCES production_collections(project_id, id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (parent_collection_id IS NULL OR parent_collection_id <> id),
  CHECK (clone_of_collection_id IS NULL OR clone_of_collection_id <> id)
) STRICT;

CREATE TABLE production_collection_members (
  collection_id TEXT NOT NULL,
  production_object_id TEXT NOT NULL REFERENCES production_objects(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  import_batch_id TEXT NOT NULL REFERENCES imported_history_batches(id) ON DELETE RESTRICT,
  source_payload_hash TEXT NOT NULL CHECK (length(source_payload_hash) = 64 AND source_payload_hash NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, production_object_id),
  UNIQUE (collection_id, ordinal),
  FOREIGN KEY (collection_id, import_batch_id)
    REFERENCES production_collections(id, import_batch_id) ON DELETE RESTRICT
) STRICT;

CREATE VIRTUAL TABLE project_search_fts USING fts5(
  search_text,
  content = 'project_search_documents',
  content_rowid = 'search_document_id',
  tokenize = 'unicode61'
);

CREATE INDEX idx_provider_profiles_status ON provider_profiles(status);
CREATE INDEX idx_skills_project ON skills(project_id, id, version) WHERE project_id IS NOT NULL;
CREATE INDEX idx_skill_enablements_project ON skill_enablements(project_id, enabled);
CREATE INDEX idx_plugin_package_skills_skill ON plugin_package_skills(skill_id, skill_version);
CREATE INDEX idx_plugin_installations_state ON plugin_installations(state, package_id);
CREATE INDEX idx_plugin_audit_events_package ON plugin_audit_events(package_id, package_version, sequence);
CREATE INDEX idx_global_media_assets_blob ON global_media_assets(blob_hash);
CREATE INDEX idx_global_media_folders_parent_order_name ON global_media_folders(parent_id, sort_order, name, id);
CREATE INDEX idx_project_media_refs_project ON project_media_refs(project_id, updated_at);
CREATE INDEX idx_project_media_links_object ON project_media_links(production_object_id, relation);
CREATE INDEX idx_media_derivations_run ON media_derivations(run_id, created_at);
CREATE INDEX idx_media_derivation_attempts_state ON media_derivation_attempts(state, created_at);
CREATE UNIQUE INDEX uniq_media_derivation_attempts_provider_operation ON media_derivation_attempts(provider_profile_id, provider_operation_id) WHERE provider_operation_id IS NOT NULL;
CREATE INDEX idx_production_objects_project_type ON production_objects(project_id, object_type, lifecycle);
CREATE INDEX idx_production_relations_target ON production_relations(target_object_id, relation);
CREATE UNIQUE INDEX uniq_production_contains_child ON production_relations(target_object_id) WHERE relation = 'contains';
CREATE INDEX idx_production_fact_sources_object ON production_fact_sources(production_object_id, field_ref);
CREATE INDEX idx_production_protections_object ON production_protections(production_object_id, field_ref);
CREATE UNIQUE INDEX uniq_shot_selected_result ON production_result_decisions(shot_id) WHERE state = 'selected';
CREATE UNIQUE INDEX uniq_active_production_protection ON production_protections(production_object_id, field_ref) WHERE released_by_choice_id IS NULL;
CREATE INDEX idx_canvas_placements_canvas_z ON canvas_placements(canvas_id, z_index);
CREATE INDEX idx_canvas_edges_canvas ON canvas_edges(canvas_id);
CREATE INDEX idx_canvas_annotations_canvas ON canvas_annotations(canvas_id, placement_id);
CREATE INDEX idx_chats_project_updated ON chats(project_id, updated_at);
CREATE INDEX idx_messages_project_created ON messages(project_id, created_at);
CREATE INDEX idx_message_attachments_media ON message_attachments(project_media_ref_id);
CREATE INDEX idx_runs_project_status ON runs(project_id, status);
CREATE INDEX idx_runs_parent ON runs(parent_run_id, status);
CREATE INDEX idx_task_items_list_order ON task_items(task_list_id, ordinal);
CREATE INDEX idx_run_events_run_surface ON run_events(run_id, surface, sequence);
CREATE INDEX idx_run_inbox_state ON run_inbox_messages(run_id, state, sequence);
CREATE INDEX idx_run_activations_state ON run_activations(run_id, state);
CREATE INDEX idx_run_interactions_state ON run_interactions(run_id, state, created_at);
CREATE INDEX idx_dispatch_operations_guard ON dispatch_operations(run_id, guard_outcome, updated_at);
CREATE INDEX idx_dispatch_operations_kind ON dispatch_operations(run_id, operation_kind, updated_at);
CREATE UNIQUE INDEX uniq_dispatch_operations_confirmation ON dispatch_operations(confirmation_id) WHERE confirmation_id IS NOT NULL;
CREATE UNIQUE INDEX uniq_dispatch_operations_owner ON dispatch_operations(owner_authority, owner_id) WHERE owner_authority IS NOT NULL;
CREATE INDEX idx_run_resource_entries_run ON run_resource_entries(run_id, recorded_at);
CREATE INDEX idx_run_resource_entries_operation_phase_kind ON run_resource_entries(dispatch_operation_id, phase, kind);
CREATE INDEX idx_run_resource_entries_model_phase_kind ON run_resource_entries(model_attempt_id, phase, kind);
CREATE UNIQUE INDEX uniq_run_resource_entries_reservation_phase ON run_resource_entries(reservation_entry_id, phase) WHERE reservation_entry_id IS NOT NULL;
CREATE INDEX idx_model_attempts_run ON model_attempts(run_id, created_at);
CREATE INDEX idx_private_recovery_run ON private_recovery_envelopes(run_id, sequence);
CREATE INDEX idx_compaction_transactions_run ON compaction_transactions(run_id, source_event_to);
CREATE INDEX idx_generation_requests_run ON generation_requests(run_id, created_at);
CREATE INDEX idx_generation_attempts_state ON generation_attempts(state, created_at);
CREATE UNIQUE INDEX uniq_generation_attempts_provider_operation ON generation_attempts(provider_profile_id, provider_operation_id) WHERE provider_operation_id IS NOT NULL;
CREATE INDEX idx_generated_results_project ON generated_results(project_id, created_at);
CREATE INDEX idx_result_assessment_attempts_run ON result_assessment_attempts(run_id, assessment_kind, created_at);
CREATE UNIQUE INDEX uniq_result_assessment_attempts_provider_operation ON result_assessment_attempts(provider_profile_id, provider_operation_id) WHERE provider_operation_id IS NOT NULL;
CREATE INDEX idx_result_assessment_subjects_lookup ON result_assessment_subjects(authority, object_id);
CREATE INDEX idx_user_choices_project ON user_choices(project_id, created_at);
CREATE INDEX idx_delivery_plans_project ON delivery_plans(project_id, updated_at);
CREATE UNIQUE INDEX uniq_active_delivery_item_order ON delivery_items(delivery_plan_id, ordinal) WHERE lifecycle = 'active';
CREATE UNIQUE INDEX uniq_delivery_plan_field_choice ON delivery_field_choices(delivery_plan_id, field_ref) WHERE delivery_item_id IS NULL;
CREATE UNIQUE INDEX uniq_delivery_item_field_choice ON delivery_field_choices(delivery_plan_id, delivery_item_id, field_ref) WHERE delivery_item_id IS NOT NULL;
CREATE UNIQUE INDEX uniq_active_delivery_plan_protection ON delivery_protections(delivery_plan_id, field_ref) WHERE delivery_item_id IS NULL AND released_by_choice_id IS NULL;
CREATE UNIQUE INDEX uniq_active_delivery_item_protection ON delivery_protections(delivery_plan_id, delivery_item_id, field_ref) WHERE delivery_item_id IS NOT NULL AND released_by_choice_id IS NULL;
CREATE UNIQUE INDEX uniq_delivery_manifest_plan_choice ON delivery_manifest_choices(delivery_manifest_id, field_ref) WHERE delivery_item_id IS NULL;
CREATE UNIQUE INDEX uniq_delivery_manifest_item_choice ON delivery_manifest_choices(delivery_manifest_id, delivery_item_id, field_ref) WHERE delivery_item_id IS NOT NULL;
CREATE UNIQUE INDEX uniq_delivery_manifest_plan_protection ON delivery_manifest_protections(delivery_manifest_id, field_ref) WHERE delivery_item_id IS NULL;
CREATE UNIQUE INDEX uniq_delivery_manifest_item_protection ON delivery_manifest_protections(delivery_manifest_id, delivery_item_id, field_ref) WHERE delivery_item_id IS NOT NULL;
CREATE INDEX idx_review_cut_attempts_manifest ON review_cut_attempts(delivery_manifest_id, created_at);
CREATE INDEX idx_delivery_exports_manifest ON delivery_exports(delivery_manifest_id, state);
CREATE INDEX idx_project_events_subject ON project_events(project_id, subject_authority, subject_id, sequence);
CREATE INDEX idx_project_memory_versions_project ON project_memory_versions(project_id, history_watermark);
CREATE INDEX idx_project_memory_items_version ON project_memory_items(memory_version_id, state);
CREATE INDEX idx_project_search_documents_project ON project_search_documents(project_id, source_kind);
CREATE INDEX idx_imported_history_batches_source ON imported_history_batches(source_schema_id, source_snapshot_hash);
CREATE INDEX idx_imported_runs_project_accepted ON imported_run_history(project_id, accepted_at, id);
CREATE INDEX idx_imported_run_events_run_sequence ON imported_run_event_history(run_id, sequence);
CREATE INDEX idx_imported_task_lists_project_updated ON imported_task_list_history(project_id, updated_at, id);
CREATE INDEX idx_imported_task_items_list_order ON imported_task_item_history(task_list_id, phase_order, id);
CREATE INDEX idx_imported_history_records_project_occurred ON imported_history_records(project_id, occurred_at, id);
CREATE INDEX idx_production_collections_parent_order ON production_collections(project_id, parent_collection_id, sort_order, id);
CREATE INDEX idx_production_collection_members_object ON production_collection_members(production_object_id, collection_id);

CREATE TRIGGER validate_imported_run_attachment_insert
BEFORE INSERT ON imported_run_attachment_history
WHEN NOT EXISTS (
  SELECT 1
  FROM imported_run_history AS run
  JOIN project_media_refs AS project_media
    ON project_media.id = NEW.project_media_ref_id
   AND project_media.project_id = run.project_id
  JOIN global_media_assets AS asset
    ON asset.id = NEW.global_asset_id
   AND asset.blob_hash = NEW.blob_hash
  WHERE run.id = NEW.run_id
    AND project_media.global_asset_id = asset.id
)
BEGIN
  SELECT RAISE(ABORT, 'Imported Run attachment media references do not belong to the Run Project');
END;

CREATE TRIGGER validate_imported_run_attachment_update
BEFORE UPDATE OF run_id, project_media_ref_id, global_asset_id, blob_hash
ON imported_run_attachment_history
WHEN NOT EXISTS (
  SELECT 1
  FROM imported_run_history AS run
  JOIN project_media_refs AS project_media
    ON project_media.id = NEW.project_media_ref_id
   AND project_media.project_id = run.project_id
  JOIN global_media_assets AS asset
    ON asset.id = NEW.global_asset_id
   AND asset.blob_hash = NEW.blob_hash
  WHERE run.id = NEW.run_id
    AND project_media.global_asset_id = asset.id
)
BEGIN
  SELECT RAISE(ABORT, 'Imported Run attachment media references do not belong to the Run Project');
END;

CREATE TRIGGER validate_imported_history_record_project_media_insert
BEFORE INSERT ON imported_history_records
WHEN NEW.owner_kind = 'project_media_ref' AND NOT EXISTS (
  SELECT 1
  FROM project_media_refs
  WHERE id = NEW.owner_project_media_ref_id
    AND project_id = NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'Imported History Record Project Media owner belongs to another Project');
END;

CREATE TRIGGER validate_imported_history_record_project_media_update
BEFORE UPDATE OF owner_kind, owner_project_media_ref_id, project_id
ON imported_history_records
WHEN NEW.owner_kind = 'project_media_ref' AND NOT EXISTS (
  SELECT 1
  FROM project_media_refs
  WHERE id = NEW.owner_project_media_ref_id
    AND project_id = NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'Imported History Record Project Media owner belongs to another Project');
END;

CREATE TRIGGER validate_production_collection_member_insert
BEFORE INSERT ON production_collection_members
WHEN NOT EXISTS (
  SELECT 1
  FROM production_collections AS collection
  JOIN production_objects AS object
    ON object.id = NEW.production_object_id
   AND object.project_id = collection.project_id
  WHERE collection.id = NEW.collection_id
)
BEGIN
  SELECT RAISE(ABORT, 'Production Collection member belongs to another Project');
END;

CREATE TRIGGER validate_production_collection_member_update
BEFORE UPDATE OF collection_id, production_object_id
ON production_collection_members
WHEN NOT EXISTS (
  SELECT 1
  FROM production_collections AS collection
  JOIN production_objects AS object
    ON object.id = NEW.production_object_id
   AND object.project_id = collection.project_id
  WHERE collection.id = NEW.collection_id
)
BEGIN
  SELECT RAISE(ABORT, 'Production Collection member belongs to another Project');
END;

CREATE TRIGGER prevent_imported_run_parent_cycle_insert
BEFORE INSERT ON imported_run_history
WHEN NEW.parent_run_id IS NOT NULL
BEGIN
  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.parent_run_id
    UNION ALL
    SELECT run.parent_run_id
    FROM imported_run_history AS run
    JOIN ancestors ON run.id = ancestors.id
    WHERE run.parent_run_id IS NOT NULL
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
    THEN RAISE(ABORT, 'Imported Run parent lineage cannot cycle') END;
END;

CREATE TRIGGER prevent_imported_run_parent_cycle_update
BEFORE UPDATE OF parent_run_id ON imported_run_history
WHEN NEW.parent_run_id IS NOT NULL
BEGIN
  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.parent_run_id
    UNION ALL
    SELECT run.parent_run_id
    FROM imported_run_history AS run
    JOIN ancestors ON run.id = ancestors.id
    WHERE run.parent_run_id IS NOT NULL
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
    THEN RAISE(ABORT, 'Imported Run parent lineage cannot cycle') END;
END;

CREATE TRIGGER prevent_imported_run_retry_cycle_insert
BEFORE INSERT ON imported_run_history
WHEN NEW.retry_of_run_id IS NOT NULL
BEGIN
  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.retry_of_run_id
    UNION ALL
    SELECT run.retry_of_run_id
    FROM imported_run_history AS run
    JOIN ancestors ON run.id = ancestors.id
    WHERE run.retry_of_run_id IS NOT NULL
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
    THEN RAISE(ABORT, 'Imported Run retry lineage cannot cycle') END;
END;

CREATE TRIGGER prevent_imported_run_retry_cycle_update
BEFORE UPDATE OF retry_of_run_id ON imported_run_history
WHEN NEW.retry_of_run_id IS NOT NULL
BEGIN
  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.retry_of_run_id
    UNION ALL
    SELECT run.retry_of_run_id
    FROM imported_run_history AS run
    JOIN ancestors ON run.id = ancestors.id
    WHERE run.retry_of_run_id IS NOT NULL
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
    THEN RAISE(ABORT, 'Imported Run retry lineage cannot cycle') END;
END;

CREATE TRIGGER prevent_imported_task_item_parent_cycle_insert
BEFORE INSERT ON imported_task_item_history
WHEN NEW.parent_item_id IS NOT NULL
BEGIN
  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.parent_item_id
    UNION ALL
    SELECT item.parent_item_id
    FROM imported_task_item_history AS item
    JOIN ancestors ON item.id = ancestors.id
    WHERE item.parent_item_id IS NOT NULL
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
    THEN RAISE(ABORT, 'Imported Task item lineage cannot cycle') END;
END;

CREATE TRIGGER prevent_imported_task_item_parent_cycle_update
BEFORE UPDATE OF parent_item_id ON imported_task_item_history
WHEN NEW.parent_item_id IS NOT NULL
BEGIN
  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.parent_item_id
    UNION ALL
    SELECT item.parent_item_id
    FROM imported_task_item_history AS item
    JOIN ancestors ON item.id = ancestors.id
    WHERE item.parent_item_id IS NOT NULL
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
    THEN RAISE(ABORT, 'Imported Task item lineage cannot cycle') END;
END;

CREATE TRIGGER prevent_imported_history_record_parent_cycle_insert
BEFORE INSERT ON imported_history_records
WHEN NEW.parent_record_id IS NOT NULL
BEGIN
  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.parent_record_id
    UNION ALL
    SELECT record.parent_record_id
    FROM imported_history_records AS record
    JOIN ancestors ON record.id = ancestors.id
    WHERE record.parent_record_id IS NOT NULL
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
    THEN RAISE(ABORT, 'Imported History Record lineage cannot cycle') END;
END;

CREATE TRIGGER prevent_imported_history_record_parent_cycle_update
BEFORE UPDATE OF parent_record_id ON imported_history_records
WHEN NEW.parent_record_id IS NOT NULL
BEGIN
  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.parent_record_id
    UNION ALL
    SELECT record.parent_record_id
    FROM imported_history_records AS record
    JOIN ancestors ON record.id = ancestors.id
    WHERE record.parent_record_id IS NOT NULL
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
    THEN RAISE(ABORT, 'Imported History Record lineage cannot cycle') END;
END;

CREATE TRIGGER prevent_production_collection_parent_cycle_insert
BEFORE INSERT ON production_collections
WHEN NEW.parent_collection_id IS NOT NULL
BEGIN
  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.parent_collection_id
    UNION ALL
    SELECT collection.parent_collection_id
    FROM production_collections AS collection
    JOIN ancestors ON collection.id = ancestors.id
    WHERE collection.parent_collection_id IS NOT NULL
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
    THEN RAISE(ABORT, 'Production Collection hierarchy cannot cycle') END;
END;

CREATE TRIGGER prevent_production_collection_parent_cycle_update
BEFORE UPDATE OF parent_collection_id ON production_collections
WHEN NEW.parent_collection_id IS NOT NULL
BEGIN
  WITH RECURSIVE ancestors(id) AS (
    SELECT NEW.parent_collection_id
    UNION ALL
    SELECT collection.parent_collection_id
    FROM production_collections AS collection
    JOIN ancestors ON collection.id = ancestors.id
    WHERE collection.parent_collection_id IS NOT NULL
  )
  SELECT CASE WHEN EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
    THEN RAISE(ABORT, 'Production Collection hierarchy cannot cycle') END;
END;

CREATE TRIGGER prevent_skill_update
BEFORE UPDATE ON skills
BEGIN
  SELECT RAISE(ABORT, 'Skill rows are immutable');
END;

CREATE TRIGGER validate_skill_enablement_insert
BEFORE INSERT ON skill_enablements
WHEN NEW.enabled = 1 AND NOT EXISTS (
  SELECT 1
  FROM skills AS selected
  JOIN skill_effective_versions AS effective
    ON effective.skill_id = selected.id AND effective.skill_version = selected.version
  WHERE selected.id = NEW.skill_id
    AND selected.version = NEW.skill_version
    AND (selected.project_id IS NULL OR selected.project_id = NEW.project_id)
    AND selected.trust <> 'unreviewed'
    AND NOT EXISTS (
      SELECT 1 FROM skill_quarantines AS quarantine
      WHERE quarantine.skill_id = selected.id AND quarantine.skill_version = selected.version
    )
    AND (
      NOT EXISTS (
        SELECT 1
        FROM plugin_package_skills AS plugin_skill
        WHERE plugin_skill.skill_id = selected.id
          AND plugin_skill.skill_version = selected.version
      )
      OR EXISTS (
        SELECT 1
        FROM plugin_package_skills AS plugin_skill
        JOIN plugin_installations AS installation
          ON installation.package_id = plugin_skill.package_id
         AND installation.package_version = plugin_skill.package_version
         AND installation.state = 'installed'
        WHERE plugin_skill.skill_id = selected.id
          AND plugin_skill.skill_version = selected.version
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Skill is not eligible for this Project');
END;

CREATE TRIGGER validate_skill_enablement_update
BEFORE UPDATE ON skill_enablements
WHEN NEW.enabled = 1 AND NOT EXISTS (
  SELECT 1
  FROM skills AS selected
  JOIN skill_effective_versions AS effective
    ON effective.skill_id = selected.id AND effective.skill_version = selected.version
  WHERE selected.id = NEW.skill_id
    AND selected.version = NEW.skill_version
    AND (selected.project_id IS NULL OR selected.project_id = NEW.project_id)
    AND selected.trust <> 'unreviewed'
    AND NOT EXISTS (
      SELECT 1 FROM skill_quarantines AS quarantine
      WHERE quarantine.skill_id = selected.id AND quarantine.skill_version = selected.version
    )
    AND (
      NOT EXISTS (
        SELECT 1
        FROM plugin_package_skills AS plugin_skill
        WHERE plugin_skill.skill_id = selected.id
          AND plugin_skill.skill_version = selected.version
      )
      OR EXISTS (
        SELECT 1
        FROM plugin_package_skills AS plugin_skill
        JOIN plugin_installations AS installation
          ON installation.package_id = plugin_skill.package_id
         AND installation.package_version = plugin_skill.package_version
         AND installation.state = 'installed'
        WHERE plugin_skill.skill_id = selected.id
          AND plugin_skill.skill_version = selected.version
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Skill is not eligible for this Project');
END;

PRAGMA user_version = 1;
