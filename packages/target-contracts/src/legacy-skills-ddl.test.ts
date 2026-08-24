import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const NOW = '2026-08-17T00:00:00.000Z';
const HASH = 'a'.repeat(64);

async function database(): Promise<DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(await readFile(new URL('../ddl/project-v1.sql', import.meta.url), 'utf8'));
  return db;
}

function insertProject(db: DatabaseSync, id: string): void {
  db.prepare(
    `INSERT INTO projects (
       id, name, lifecycle, schema_revision, revision, content_hash,
       created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
     ) VALUES (?, ?, 'active', 1, 0, ?, 'direct_ui', ?, ?, ?, NULL, NULL)`,
  ).run(id, id, HASH, `action.${id}`, NOW, NOW);

  const chatId = `chat.${id}`;
  const messageId = `message.${id}`;
  const runId = `run.${id}`;
  const manifestId = `manifest.${id}`;
  const catalogId = `catalog.${id}`;
  const interactionId = `interaction.${id}`;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT INTO chats (
         id, project_id, revision, content_hash, title, lifecycle, message_count,
         message_head_sequence, created_at, updated_at, archived_at, deleted_at
       ) VALUES (?, ?, 0, ?, 'Skill registration', 'active', 1, 1, ?, ?, NULL, NULL)`,
    ).run(chatId, id, HASH, NOW, NOW);
    db.prepare(
      `INSERT INTO messages (
         id, project_id, chat_id, sequence, role, status, originating_run_id,
         content_hash, supersedes_message_id, created_at
       ) VALUES (?, ?, ?, 1, 'user', 'accepted', NULL, ?, NULL, ?)`,
    ).run(messageId, id, chatId, HASH, NOW);
    db.prepare(
      `INSERT INTO runs (
         id, revision, content_hash, root_run_id, parent_run_id, retry_of_run_id,
         retry_seed_hash, project_id, chat_id, objective_message_id,
         objective_parent_event_id, objective_hash, child_display_name,
         child_public_summary, status, provider_profile_id, model, reasoning_strength,
         permission_mode, budget_v1_json, context_manifest_id, context_manifest_hash,
         capability_catalog_snapshot_id, capability_catalog_hash, accepted_at,
         finished_at, terminal_summary
       ) VALUES (
         ?, 0, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL, ?, NULL, NULL,
         'waiting_confirmation', NULL, 'test-model', NULL, 'full', '{}', ?, ?, ?, ?, ?,
         NULL, NULL
       )`,
    ).run(runId, HASH, runId, id, chatId, messageId, HASH, manifestId, HASH, catalogId, HASH, NOW);
    db.prepare(
      `INSERT INTO context_manifests (
         id, run_id, project_id, chat_id, user_message_id, parent_event_id,
         manifest_hash, manifest_v1_json, created_at
       ) VALUES (?, ?, ?, ?, ?, NULL, ?, '{}', ?)`,
    ).run(manifestId, runId, id, chatId, messageId, HASH, NOW);
    db.prepare(
      `INSERT INTO capability_catalog_snapshots (
         id, run_id, catalog_hash, catalog_v1_json, created_at
       ) VALUES (?, ?, ?, '{}', ?)`,
    ).run(catalogId, runId, HASH, NOW);
    db.prepare(
      `INSERT INTO run_interactions (
         id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
         allow_free_text, state, answer_message_id, created_at, resolved_at
       ) VALUES (?, ?, 'confirmation', 'Register Skill?', '[]', '[]', 0, 'pending', NULL, ?, NULL)`,
    ).run(interactionId, runId, NOW);
    db.prepare(
      `INSERT INTO run_confirmations (
         id, run_id, interaction_id, target_v1_json, immutable_input_hash,
         decision, decided_by_message_id, requested_at, decided_at
       ) VALUES (?, ?, ?, '{}', ?, NULL, NULL, ?, NULL)`,
    ).run(`confirmation.${id}`, runId, interactionId, HASH, NOW);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function insertSkill(
  db: DatabaseSync,
  id: string,
  projectId: string | null,
  provenance: 'built_in' | 'installed' | 'project',
  trust: 'trusted' | 'reviewed' | 'unreviewed' = 'trusted',
): void {
  db.prepare(
    `INSERT INTO skills (
       id, version, name, description, content_text, content_hash, provenance, trust,
       project_id, created_by_confirmation_id, created_at
     ) VALUES (?, '1.0.0', ?, 'Description', 'Content', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    id,
    HASH,
    provenance,
    trust,
    projectId,
    provenance === 'project' && projectId !== null ? `confirmation.${projectId}` : null,
    NOW,
  );
  db.prepare(
    `INSERT INTO skill_effective_versions (skill_id, skill_version, changed_at)
     VALUES (?, '1.0.0', ?)
     ON CONFLICT(skill_id) DO UPDATE SET skill_version = excluded.skill_version`,
  ).run(id, NOW);
  if (provenance === 'built_in' && trust === 'unreviewed') {
    db.prepare(
      `INSERT INTO skill_quarantines (skill_id, skill_version, reason)
       VALUES (?, '1.0.0', 'Legacy system content')`,
    ).run(id);
  }
}

describe('legacy Skill ownership DDL', () => {
  it('requires exact project ownership for project provenance', async () => {
    const db = await database();
    try {
      insertProject(db, 'project.a');
      expect(() => insertSkill(db, 'skill.bad.global', null, 'project')).toThrow();
      expect(() => insertSkill(db, 'skill.bad.owned', 'project.a', 'installed')).toThrow();
      insertSkill(db, 'skill.project', 'project.a', 'project');
      insertSkill(db, 'skill.global', null, 'built_in');
    } finally {
      db.close();
    }
  });

  it('denies cross-project and unreviewed enablements and protects immutable rows', async () => {
    const db = await database();
    try {
      insertProject(db, 'project.a');
      insertProject(db, 'project.b');
      insertSkill(db, 'skill.project', 'project.a', 'project', 'reviewed');
      insertSkill(db, 'skill.quarantine', null, 'built_in', 'unreviewed');
      insertSkill(db, 'skill.user', null, 'installed', 'unreviewed');
      const enable = db.prepare(
        `INSERT INTO skill_enablements (
           project_id, skill_id, skill_version, enabled, enabled_at
         ) VALUES (?, ?, '1.0.0', 1, ?)`,
      );
      enable.run('project.a', 'skill.project', NOW);
      expect(() => enable.run('project.b', 'skill.project', NOW)).toThrow();
      expect(() => enable.run('project.a', 'skill.quarantine', NOW)).toThrow();
      expect(() => enable.run('project.a', 'skill.user', NOW)).toThrow();
      expect(() =>
        db.prepare("UPDATE skills SET name = 'Changed' WHERE id = 'skill.project'").run(),
      ).toThrow();
    } finally {
      db.close();
    }
  });
});
