import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { preflightLegacyTaskHistory } from './task-history-preflight.js';

const mediaHash = createHash('sha256').update('task-media').digest('hex');

function fixture(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE task_lists (id TEXT, status TEXT);
    CREATE TABLE tasks (id TEXT, task_list_id TEXT, status TEXT);
    CREATE TABLE task_dependencies (task_id TEXT, depends_on_task_id TEXT);
    CREATE TABLE task_events (task_list_id TEXT, seq INTEGER, event_id TEXT, payload_json TEXT);
    CREATE TABLE task_attempts (
      id TEXT, task_list_id TEXT, task_id TEXT, submitted_at INTEGER,
      provider_receipt TEXT, provider_job_id TEXT, asset_hash TEXT
    );
    CREATE TABLE task_artifacts (
      id TEXT, task_list_id TEXT, task_id TEXT, asset_hash TEXT
    );
    CREATE TABLE plan_documents (id TEXT, task_list_id TEXT, logical_key TEXT, revision INTEGER);
    CREATE TABLE plan_approvals (id TEXT, task_list_id TEXT, gate_key TEXT);
    CREATE TABLE prompt_assemblies (
      id TEXT, task_list_id TEXT, task_id TEXT, source_attempt_id TEXT,
      node_id TEXT, submitted_at INTEGER, status TEXT
    );
  `);
  database.prepare('INSERT INTO task_lists VALUES (?, ?)').run('list.1', 'completed');
  database.prepare('INSERT INTO tasks VALUES (?, ?, ?)').run('task.1', 'list.1', 'completed');
  database.prepare('INSERT INTO tasks VALUES (?, ?, ?)').run('task.2', 'list.1', 'completed');
  database.prepare('INSERT INTO task_dependencies VALUES (?, ?)').run('task.2', 'task.1');
  database.prepare('INSERT INTO task_events VALUES (?, ?, ?, ?)').run('list.1', 1, 'event.1', '{}');
  database
    .prepare('INSERT INTO task_attempts VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('attempt.1', 'list.1', 'task.2', 1200, 'receipt.1', 'job.1', mediaHash);
  database
    .prepare('INSERT INTO task_artifacts VALUES (?, ?, ?, ?)')
    .run('artifact.1', 'list.1', 'task.2', mediaHash);
  database
    .prepare('INSERT INTO plan_documents VALUES (?, ?, ?, ?)')
    .run('plan.1', 'list.1', 'production', 1);
  database
    .prepare('INSERT INTO plan_approvals VALUES (?, ?, ?)')
    .run('approval.1', 'list.1', 'production_plan');
  database
    .prepare('INSERT INTO prompt_assemblies VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('assembly.1', 'list.1', 'task.2', 'attempt.1', 'node.1', 1300, 'submitted');
  return database;
}

describe('Legacy task history preflight', () => {
  it('accepts a terminal, owned, media-complete imported Task ledger', () => {
    const database = fixture();
    const report = preflightLegacyTaskHistory(database, new Set([mediaHash]));
    expect(report).toMatchObject({
      counts: {
        taskLists: 1,
        tasks: 2,
        dependencies: 1,
        events: 1,
        attempts: 1,
        artifacts: 1,
        plans: 1,
        approvals: 1,
        promptAssemblies: 1,
      },
      blockers: [],
      ok: true,
    });
    database.close();
  });

  it('blocks ambiguous provider submission and task cycles', () => {
    const database = fixture();
    database.prepare('UPDATE task_attempts SET provider_receipt = NULL').run();
    database.prepare('INSERT INTO task_dependencies VALUES (?, ?)').run('task.1', 'task.2');
    const report = preflightLegacyTaskHistory(database, new Set([mediaHash]));
    const kinds = new Set(report.blockers.map(({ kind }) => kind));
    expect(kinds.has('submitted_attempt_receipt_missing')).toBe(true);
    expect(kinds.has('cyclic_task_dependency')).toBe(true);
    expect(report.ok).toBe(false);
    database.close();
  });

  it('requires the Legacy DDL sequence to be contiguous from one', () => {
    const database = fixture();
    database.prepare('UPDATE task_events SET seq = 0').run();
    const report = preflightLegacyTaskHistory(database, new Set([mediaHash]));
    expect(report.blockers).toContainEqual({
      kind: 'task_event_sequence_mismatch',
      taskListId: 'list.1',
      recordId: null,
    });
    expect(report.ok).toBe(false);
    database.close();
  });
});
