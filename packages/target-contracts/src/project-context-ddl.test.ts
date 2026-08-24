import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const NOW = '2026-08-15T12:00:00.000Z';
const LATER = '2026-08-15T12:05:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const ddlUrl = new URL('../ddl/project-v1.sql', import.meta.url);

async function openDatabase(): Promise<DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  db.exec(await readFile(ddlUrl, 'utf8'));
  return db;
}

function insertProject(db: DatabaseSync, id: string): void {
  db.prepare(
    `INSERT INTO projects (
       id, name, lifecycle, schema_revision, revision, content_hash,
       created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
     ) VALUES (?, ?, 'active', 1, 0, ?, 'direct_ui', ?, ?, ?, NULL, NULL)`,
  ).run(id, `Project ${id}`, HASH_A, `create.${id}`, NOW, NOW);
}

function insertChat(db: DatabaseSync, projectId: string, chatId: string): void {
  db.prepare(
    `INSERT INTO chats (
       id, project_id, title, lifecycle, revision, content_hash, message_count,
       message_head_sequence, created_at, updated_at, archived_at, deleted_at
     ) VALUES (?, ?, ?, 'active', 0, ?, 0, NULL, ?, ?, NULL, NULL)`,
  ).run(chatId, projectId, `Chat ${chatId}`, HASH_A, NOW, NOW);
}

function insertUserMessage(
  db: DatabaseSync,
  projectId: string,
  chatId: string,
  messageId: string,
  sequence = 1,
): void {
  db.prepare(
    `INSERT INTO messages (
       id, project_id, chat_id, sequence, role, status, originating_run_id,
       content_hash, supersedes_message_id, created_at
     ) VALUES (?, ?, ?, ?, 'user', 'accepted', NULL, ?, NULL, ?)`,
  ).run(messageId, projectId, chatId, sequence, HASH_A, NOW);
}

function insertRun(db: DatabaseSync, projectId: string, chatId: string, messageId: string): void {
  const runId = `run.${projectId}`;
  const manifestId = `manifest.${projectId}`;
  const catalogId = `catalog.${projectId}`;
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO runs (
         id, revision, content_hash, root_run_id, parent_run_id, project_id, chat_id,
         objective_message_id, objective_parent_event_id, objective_hash,
         child_display_name, child_public_summary, status, provider_profile_id, model,
         reasoning_strength, permission_mode, budget_v1_json, context_manifest_id,
         context_manifest_hash, capability_catalog_snapshot_id, capability_catalog_hash,
         accepted_at, finished_at, terminal_summary
       ) VALUES (
         ?, 0, ?, ?, NULL, ?, ?, ?, NULL, ?, NULL, NULL, 'accepted', NULL, 'test-model', NULL,
         'reversible', '{}', ?, ?, ?, ?, ?, NULL, NULL
       )`,
    ).run(
      runId,
      HASH_B,
      runId,
      projectId,
      chatId,
      messageId,
      HASH_A,
      manifestId,
      HASH_B,
      catalogId,
      HASH_C,
      NOW,
    );
    db.prepare(
      `INSERT INTO context_manifests (
         id, run_id, project_id, chat_id, user_message_id, parent_event_id, manifest_hash,
         manifest_v1_json, created_at
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, '{}', ?)`,
    ).run(manifestId, runId, projectId, chatId, messageId, HASH_B, NOW);
    db.prepare(
      `INSERT INTO capability_catalog_snapshots (
         id, run_id, catalog_hash, catalog_v1_json, created_at
       ) VALUES (?, ?, ?, '{}', ?)`,
    ).run(catalogId, runId, HASH_C, NOW);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

describe('Project context DDL invariants', () => {
  it('stores Project settings separately with revision and content-hash CAS fields', async () => {
    const db = await openDatabase();
    try {
      insertProject(db, 'project.settings');
      db.prepare(
        `INSERT INTO project_settings (
           project_id, revision, content_hash, default_provider_profile_id,
           format_policy_v1_json, permission_mode, budget_v1_json, updated_at
         ) VALUES (?, 0, ?, NULL, ?, 'reversible', ?, ?)`,
      ).run(
        'project.settings',
        HASH_B,
        JSON.stringify({ aspectRatio: '16:9', customDimensions: null, frameRate: 24 }),
        JSON.stringify({ maxGenerationCount: 10 }),
        NOW,
      );
      expect(db.prepare('SELECT revision, content_hash FROM project_settings').get()).toEqual({
        revision: 0,
        content_hash: HASH_B,
      });
      expect(() =>
        db
          .prepare(
            `INSERT INTO project_settings (
               project_id, revision, content_hash, default_provider_profile_id,
               format_policy_v1_json, permission_mode, budget_v1_json, updated_at
             ) VALUES ('project.missing', 0, ?, NULL, '{}', 'reversible', '{}', ?)`,
          )
          .run(HASH_A, NOW),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('stores exact root-message and child-parent-event Run sources', async () => {
    const db = await openDatabase();
    try {
      const projectId = 'project.run-source';
      const chatId = 'chat.run-source';
      const messageId = 'message.run-source';
      const rootRunId = `run.${projectId}`;
      insertProject(db, projectId);
      insertChat(db, projectId, chatId);
      insertUserMessage(db, projectId, chatId, messageId);
      insertRun(db, projectId, chatId, messageId);

      const parentEventId = 'event.delegate';
      db.prepare(
        `INSERT INTO run_events (
           id, run_id, sequence, event_version, surface, occurred_at, actor,
           causation_v1_json, correlation_id, idempotency_key, payload_hash,
           previous_event_hash, event_hash
         ) VALUES (?, ?, 1, 1, 'public', ?, 'commander', ?, NULL, NULL, ?, NULL, ?)`,
      ).run(
        parentEventId,
        rootRunId,
        NOW,
        JSON.stringify({ kind: 'run', runId: rootRunId }),
        HASH_A,
        HASH_B,
      );
      db.prepare(
        `INSERT INTO run_event_payloads (
           run_event_id, payload_v1_json, payload_hash, erased_at
         ) VALUES (?, ?, ?, NULL)`,
      ).run(
        parentEventId,
        JSON.stringify({ type: 'child_run_delegated', childRunId: 'run.child' }),
        HASH_A,
      );
      db.prepare(
        `UPDATE run_event_payloads SET payload_v1_json = NULL, erased_at = ?
         WHERE run_event_id = ?`,
      ).run(LATER, parentEventId);
      expect(
        db
          .prepare(
            `SELECT e.payload_hash, p.payload_v1_json, p.erased_at
             FROM run_events e
             JOIN run_event_payloads p ON p.run_event_id = e.id
             WHERE e.id = ?`,
          )
          .get(parentEventId),
      ).toEqual({ payload_hash: HASH_A, payload_v1_json: null, erased_at: LATER });

      const childRunId = 'run.child';
      const childManifestId = 'manifest.child';
      const childCatalogId = 'catalog.child';
      db.exec('BEGIN');
      db.prepare(
        `INSERT INTO runs (
           id, revision, content_hash, root_run_id, parent_run_id, project_id, chat_id,
           objective_message_id, objective_parent_event_id, objective_hash,
           child_display_name, child_public_summary, status, provider_profile_id, model,
           reasoning_strength, permission_mode, budget_v1_json, context_manifest_id,
           context_manifest_hash, capability_catalog_snapshot_id, capability_catalog_hash,
           accepted_at, finished_at, terminal_summary
         ) VALUES (
           ?, 0, ?, ?, ?, ?, ?, NULL, ?, ?, 'Continuity review',
           'Checking selected shots for continuity.', 'accepted', NULL, 'test-model', NULL,
           'reversible', '{}', ?, ?, ?, ?, ?, NULL, NULL
         )`,
      ).run(
        childRunId,
        HASH_A,
        rootRunId,
        rootRunId,
        projectId,
        chatId,
        parentEventId,
        HASH_B,
        childManifestId,
        HASH_A,
        childCatalogId,
        HASH_B,
        NOW,
      );
      db.prepare(
        `INSERT INTO context_manifests (
           id, run_id, project_id, chat_id, user_message_id, parent_event_id,
           manifest_hash, manifest_v1_json, created_at
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, '{}', ?)`,
      ).run(childManifestId, childRunId, projectId, chatId, parentEventId, HASH_A, NOW);
      db.prepare(
        `INSERT INTO capability_catalog_snapshots (
           id, run_id, catalog_hash, catalog_v1_json, created_at
         ) VALUES (?, ?, ?, '{}', ?)`,
      ).run(childCatalogId, childRunId, HASH_B, NOW);
      db.exec('COMMIT');

      expect(
        db
          .prepare(
            `SELECT objective_message_id, objective_parent_event_id,
               child_display_name, child_public_summary
             FROM runs WHERE id = ?`,
          )
          .get(childRunId),
      ).toEqual({
        objective_message_id: null,
        objective_parent_event_id: parentEventId,
        child_display_name: 'Continuity review',
        child_public_summary: 'Checking selected shots for continuity.',
      });

      expect(() =>
        db
          .prepare(
            `INSERT INTO runs (
               id, revision, content_hash, root_run_id, parent_run_id, project_id, chat_id,
               objective_message_id, objective_parent_event_id, objective_hash,
               child_display_name, child_public_summary, status, provider_profile_id, model,
               reasoning_strength, permission_mode, budget_v1_json, context_manifest_id,
               context_manifest_hash, capability_catalog_snapshot_id, capability_catalog_hash,
               accepted_at, finished_at, terminal_summary
             ) VALUES (
               'run.invalid-child', 0, ?, ?, ?, ?, ?, ?, NULL, ?, 'Invalid', 'Invalid source',
               'accepted', NULL, 'test-model', NULL, 'reversible', '{}', ?, ?, ?, ?, ?, NULL, NULL
             )`,
          )
          .run(
            HASH_A,
            rootRunId,
            rootRunId,
            projectId,
            chatId,
            messageId,
            HASH_B,
            `manifest.${projectId}`,
            HASH_B,
            `catalog.${projectId}`,
            HASH_C,
            NOW,
          ),
      ).toThrow();
    } finally {
      if (db.isTransaction) db.exec('ROLLBACK');
      db.close();
    }
  });

  it('binds TaskList terminal timestamps to terminal state', async () => {
    const db = await openDatabase();
    try {
      const projectId = 'project.task-state';
      const chatId = 'chat.task-state';
      const messageId = 'message.task-state';
      const runId = `run.${projectId}`;
      insertProject(db, projectId);
      insertChat(db, projectId, chatId);
      insertUserMessage(db, projectId, chatId, messageId);
      insertRun(db, projectId, chatId, messageId);

      expect(() =>
        db
          .prepare(
            `INSERT INTO task_lists (
               id, run_id, title, state, revision, content_hash,
               created_at, updated_at, terminalized_at
             ) VALUES ('tasks.invalid', ?, 'Invalid', 'completed', 0, ?, ?, ?, NULL)`,
          )
          .run(runId, HASH_B, NOW, NOW),
      ).toThrow();
      db.prepare(
        `INSERT INTO task_lists (
           id, run_id, title, state, revision, content_hash, created_at, updated_at, terminalized_at
         ) VALUES ('tasks.active', ?, 'Current work', 'active', 0, ?, ?, ?, NULL)`,
      ).run(runId, HASH_A, NOW, NOW);
    } finally {
      db.close();
    }
  });

  it('keeps one reversible Project Media relationship per Project and global asset', async () => {
    const db = await openDatabase();
    try {
      insertProject(db, 'project.media');
      db.prepare(
        `INSERT INTO media_blobs (
           hash, byte_length, mime_type, media_kind, technical_facts_v1_json, created_at
         ) VALUES (?, 4, 'image/png', 'image', '{}', ?)`,
      ).run(HASH_A, NOW);
      db.prepare(
        `INSERT INTO global_media_assets (
           id, revision, content_hash, blob_hash, media_kind, filename, display_name,
           source_v1_json, folder_id, tags_v1_json, created_at, updated_at
         ) VALUES ('asset.1', 0, ?, ?, 'image', 'reference.png', 'Reference', '{}', NULL, '[]', ?, ?)`,
      ).run(HASH_B, HASH_A, NOW, NOW);
      db.prepare(
        `INSERT INTO project_media_refs (
           id, project_id, global_asset_id, revision, content_hash, lifecycle, detached_at,
           label, collections_v1_json, roles_v1_json, notes, created_by_kind, created_by_id,
           created_at, updated_at
         ) VALUES (
           'media.1', 'project.media', 'asset.1', 0, ?, 'active', NULL,
           'Reference', '[]', '["reference"]', '', 'direct_ui', 'attach.1', ?, ?
         )`,
      ).run(HASH_C, NOW, NOW);
      expect(() =>
        db
          .prepare(
            `INSERT INTO project_media_refs (
               id, project_id, global_asset_id, revision, content_hash, lifecycle, detached_at,
               label, collections_v1_json, roles_v1_json, notes, created_by_kind, created_by_id,
               created_at, updated_at
             ) VALUES (
               'media.duplicate', 'project.media', 'asset.1', 0, ?, 'active', NULL,
               'Duplicate', '[]', '[]', '', 'direct_ui', 'attach.2', ?, ?
             )`,
          )
          .run(HASH_A, NOW, NOW),
      ).toThrow();
      expect(() =>
        db
          .prepare(
            `UPDATE project_media_refs
             SET lifecycle = 'detached', detached_at = NULL
             WHERE id = 'media.1'`,
          )
          .run(),
      ).toThrow();
      db.prepare(
        `UPDATE project_media_refs
         SET lifecycle = 'detached', detached_at = ?, revision = 1, content_hash = ?
         WHERE id = 'media.1'`,
      ).run(LATER, HASH_A);
      expect(
        db
          .prepare('SELECT lifecycle, detached_at FROM project_media_refs WHERE id = ?')
          .get('media.1'),
      ).toEqual({ lifecycle: 'detached', detached_at: LATER });
    } finally {
      db.close();
    }
  });

  it('binds Messages to the same Project and enforces the user/assistant Run matrix', async () => {
    const db = await openDatabase();
    try {
      insertProject(db, 'project.a');
      insertProject(db, 'project.b');
      insertChat(db, 'project.a', 'chat.a');
      insertChat(db, 'project.b', 'chat.b');
      insertUserMessage(db, 'project.a', 'chat.a', 'message.user');
      expect(() => insertUserMessage(db, 'project.a', 'chat.b', 'message.cross')).toThrow();
      insertRun(db, 'project.a', 'chat.a', 'message.user');
      db.prepare(
        `INSERT INTO messages (
           id, project_id, chat_id, sequence, role, status, originating_run_id,
           content_hash, supersedes_message_id, created_at
         ) VALUES (
           'message.assistant', 'project.a', 'chat.a', 2, 'assistant', 'completed',
           'run.project.a', ?, NULL, ?
         )`,
      ).run(HASH_B, NOW);
      expect(() =>
        db
          .prepare(
            `INSERT INTO messages (
               id, project_id, chat_id, sequence, role, status, originating_run_id,
               content_hash, supersedes_message_id, created_at
             ) VALUES (
               'message.invalid', 'project.a', 'chat.a', 3, 'assistant', 'accepted',
               NULL, ?, NULL, ?
             )`,
          )
          .run(HASH_A, NOW),
      ).toThrow();
      expect(() =>
        db
          .prepare(
            `INSERT INTO messages (
               id, project_id, chat_id, sequence, role, status, originating_run_id,
               content_hash, supersedes_message_id, created_at
             ) VALUES (
               'message.duplicate-run', 'project.a', 'chat.a', 3, 'assistant', 'interrupted',
               'run.project.a', ?, NULL, ?
             )`,
          )
          .run(HASH_A, NOW),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('retains ProjectEvent envelope meaning when its payload is redacted', async () => {
    const db = await openDatabase();
    try {
      insertProject(db, 'project.events');
      db.prepare(
        `INSERT INTO project_events (
           id, project_id, sequence, event_version, event_type, occurred_at, actor,
           subject_authority, subject_id, causation_kind, causation_id, correlation_id,
           idempotency_key, payload_hash, previous_event_hash, event_hash
         ) VALUES (
           'event.1', 'project.events', 1, 1, 'message_appended', ?, 'user',
           'message', 'message.1', 'direct_ui', 'action.1', 'correlation.1',
           'idempotency.1', ?, NULL, ?
         )`,
      ).run(NOW, HASH_A, HASH_B);
      db.prepare(
        `INSERT INTO project_event_payloads (project_event_id, payload_v1_json, erased_at)
         VALUES ('event.1', ?, NULL)`,
      ).run(JSON.stringify({ type: 'message_appended', messageId: 'message.1' }));
      db.prepare(
        `UPDATE project_event_payloads
         SET payload_v1_json = NULL, erased_at = ?
         WHERE project_event_id = 'event.1'`,
      ).run(LATER);
      expect(
        db
          .prepare(
            `SELECT event_type, payload_hash
           FROM project_events WHERE id = 'event.1'`,
          )
          .get(),
      ).toEqual({ event_type: 'message_appended', payload_hash: HASH_A });
      expect(
        db
          .prepare(
            `SELECT payload_v1_json, erased_at
           FROM project_event_payloads WHERE project_event_id = 'event.1'`,
          )
          .get(),
      ).toEqual({ payload_v1_json: null, erased_at: LATER });
    } finally {
      db.close();
    }
  });

  it('enforces exact ProjectEvent authorities and enabled skill versions', async () => {
    const db = await openDatabase();
    try {
      insertProject(db, 'project.constraints');
      const insertEvent = db.prepare(
        `INSERT INTO project_events (
           id, project_id, sequence, event_version, event_type, occurred_at, actor,
           subject_authority, subject_id, causation_kind, causation_id, correlation_id,
           idempotency_key, payload_hash, previous_event_hash, event_hash
         ) VALUES (?, 'project.constraints', ?, 1, 'object_revision_changed', ?, 'commander',
           ?, 'project.constraints', 'run', 'run.1', ?, ?, ?, NULL, ?)`,
      );
      insertEvent.run(
        'event.settings',
        1,
        NOW,
        'project_settings',
        'correlation.settings',
        'idempotency.settings',
        HASH_A,
        HASH_B,
      );
      expect(() =>
        insertEvent.run(
          'event.invalid-authority',
          2,
          NOW,
          'unknown_authority',
          'correlation.invalid-authority',
          'idempotency.invalid-authority',
          HASH_B,
          HASH_C,
        ),
      ).toThrow();

      const insertSkill = db.prepare(
        `INSERT INTO skills (
           id, version, name, description, content_text, content_hash, provenance, trust, created_at
         ) VALUES (?, ?, 'Skill', 'Description', 'Content', ?, 'built_in', 'trusted', ?)`,
      );
      const insertEnablement = db.prepare(
        `INSERT INTO skill_enablements (project_id, skill_id, skill_version, enabled, enabled_at)
         VALUES ('project.constraints', ?, ?, 1, ?)`,
      );
      insertSkill.run('skill.valid', '1.0.0', HASH_A, NOW);
      db.prepare(
        `INSERT INTO skill_effective_versions (skill_id, skill_version, changed_at)
         VALUES ('skill.valid', '1.0.0', ?)`,
      ).run(NOW);
      insertEnablement.run('skill.valid', '1.0.0', NOW);

      db.prepare(
        `INSERT INTO skills (
           id, version, name, description, content_text, content_hash, provenance, trust, created_at
         ) VALUES ('skill.installed', '1.0.0', 'Installed', 'Description', 'Content', ?,
           'installed', 'reviewed', ?)`,
      ).run(HASH_B, NOW);
      expect(() =>
        db
          .prepare(
            `INSERT INTO skills (
               id, version, name, description, content_text, content_hash,
               provenance, trust, created_at
             ) VALUES ('skill.invalid', '1.0.0', 'Invalid', 'Description', 'Content', ?,
               'user', 'untrusted', ?)`,
          )
          .run(HASH_C, NOW),
      ).toThrow();

      const emptyVersion = '';
      expect(() => insertSkill.run('skill.empty', emptyVersion, HASH_B, NOW)).toThrow();

      const overlongVersion = 'v'.repeat(81);
      expect(() => insertSkill.run('skill.overlong', overlongVersion, HASH_C, NOW)).toThrow();
    } finally {
      db.close();
    }
  });

  it('allows only complete Memory versions to become the Project head', async () => {
    const db = await openDatabase();
    try {
      insertProject(db, 'project.memory');
      const insertVersion = db.prepare(
        `INSERT INTO project_memory_versions (
           id, project_id, derivation_version, source_schema_version, history_watermark,
           source_set_hash, completeness, created_at
         ) VALUES (?, 'project.memory', 'memory-v1', 'source-v1', ?, ?, ?, ?)`,
      );
      insertVersion.run('memory.partial', 1, HASH_A, 'partial', NOW);
      expect(() =>
        db
          .prepare(
            `INSERT INTO project_memory_heads (
               project_id, memory_version_id, completeness, revision, updated_at
             ) VALUES ('project.memory', 'memory.partial', 'complete', 0, ?)`,
          )
          .run(NOW),
      ).toThrow();
      insertVersion.run('memory.complete', 2, HASH_B, 'complete', NOW);
      db.prepare(
        `INSERT INTO project_memory_heads (
           project_id, memory_version_id, completeness, revision, updated_at
         ) VALUES ('project.memory', 'memory.complete', 'complete', 0, ?)`,
      ).run(NOW);
      db.prepare(
        `INSERT INTO project_memory_items (
           id, memory_version_id, category, sources_v1_json, state, tentative, topics_v1_json,
           searchable_text, content_hash
         ) VALUES (
           'memory.item', 'memory.complete', 'visual_direction', ?, 'current', 0,
           '[]', 'Moonlight', ?
         )`,
      ).run(JSON.stringify([{ kind: 'message', messageId: 'message.1' }]), HASH_C);
      expect(
        db
          .prepare(
            `SELECT memory_version_id, completeness
           FROM project_memory_heads WHERE project_id = 'project.memory'`,
          )
          .get(),
      ).toEqual({ memory_version_id: 'memory.complete', completeness: 'complete' });
    } finally {
      db.close();
    }
  });

  it('stores exact Wire idempotency receipts and typed Search source revisions', async () => {
    const db = await openDatabase();
    try {
      insertProject(db, 'project.commands');
      db.prepare(
        `INSERT INTO wire_command_receipts (
           request_id, input_hash, project_id, response_v1_json, response_hash, committed_at
         ) VALUES ('request.1', ?, 'project.commands', ?, ?, ?)`,
      ).run(HASH_A, JSON.stringify({ wireVersion: 1, kind: 'success' }), HASH_B, NOW);
      expect(() =>
        db
          .prepare(
            `INSERT INTO wire_command_receipts (
               request_id, input_hash, project_id, response_v1_json, response_hash, committed_at
             ) VALUES ('request.1', ?, 'project.commands', '{}', ?, ?)`,
          )
          .run(HASH_C, HASH_C, NOW),
      ).toThrow();

      const insertSearch = db.prepare(
        `INSERT INTO project_search_documents (
           id, project_id, source_kind, source_id, source_revision, source_hash, source_state,
           source_v1_json, search_text, updated_at
         ) VALUES (?, 'project.commands', ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertSearch.run(
        'search.message',
        'message',
        'message.1',
        null,
        HASH_A,
        'current',
        JSON.stringify({ kind: 'message', messageId: 'message.1' }),
        'Original user request',
        NOW,
      );
      expect(() =>
        insertSearch.run(
          'search.message.invalid',
          'message',
          'message.2',
          0,
          HASH_A,
          'current',
          '{}',
          'Invalid message revision',
          NOW,
        ),
      ).toThrow();
      expect(() =>
        insertSearch.run(
          'search.production.invalid',
          'production',
          'shot.1',
          null,
          HASH_A,
          'current',
          '{}',
          'Missing production revision',
          NOW,
        ),
      ).toThrow();
      insertSearch.run(
        'search.production',
        'production',
        'shot.1',
        0,
        HASH_A,
        'current',
        JSON.stringify({ kind: 'production', ref: { id: 'shot.1', revision: 0 } }),
        'Opening shot',
        NOW,
      );
      expect(() =>
        insertSearch.run(
          'search.invalid-state',
          'production',
          'shot.2',
          0,
          HASH_A,
          'active',
          '{}',
          'Ambiguous lifecycle',
          NOW,
        ),
      ).toThrow();
      expect(
        db
          .prepare(
            `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name = 'project_memory_citations'`,
          )
          .get(),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
