import { describe, expect, it } from 'vitest';
import { SqliteIndex } from './sqlite-index.js';

describe('task execution SQLite schema', () => {
  it('creates the canonical ledgers without a persisted phase table', () => {
    const index = new SqliteIndex(':memory:');
    const db = index.rawDb;
    const tableNames = [
      'task_lists',
      'tasks',
      'task_dependencies',
      'task_artifacts',
      'plan_documents',
      'plan_approvals',
      'task_events',
      'task_decisions',
      'task_attempts',
      'task_evaluations',
    ];
    const indexNames = [
      'idx_task_lists_status_updated',
      'idx_tasks_list_status_updated',
      'idx_tasks_phase_status',
      'idx_task_dependencies_depends_on',
      'idx_task_artifacts_list_type',
      'idx_plan_documents_latest',
      'idx_plan_approvals_pending',
      'idx_task_events_list_seq',
      'idx_task_decisions_pending',
      'idx_task_attempts_kind_recovery',
      'idx_task_evaluations_list',
    ];

    for (const tableName of tableNames) {
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(tableName),
      ).toEqual({ name: tableName });
    }
    for (const indexName of indexNames) {
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get(indexName),
      ).toEqual({ name: indexName });
    }

    const taskColumns = db.pragma('table_info(tasks)') as Array<{ name: string }>;
    expect(taskColumns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'task_list_id',
        'phase_key',
        'phase_name',
        'phase_order',
        'task_key',
      ]),
    );
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%phase%'")
        .all(),
    ).toEqual([]);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        )
        .get(),
    ).toBeUndefined();
    expect(index.repos.taskLists).toBeDefined();
    index.close();
  });
});
