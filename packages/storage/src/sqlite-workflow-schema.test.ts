import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteIndex } from './sqlite-index.js';

const tempFiles: string[] = [];

function createTempDbPath(): string {
  const dbPath = path.join(
    os.tmpdir(),
    `lucid-fin-workflow-schema-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  );
  tempFiles.push(dbPath, `${dbPath}-wal`, `${dbPath}-shm`);
  return dbPath;
}

afterEach(() => {
  for (const file of tempFiles.splice(0)) {
    if (fs.existsSync(file)) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // Ignore transient Windows file lock cleanup issues in temp DB artifacts.
      }
    }
  }
});

describe('workflow sqlite schema', () => {
  it('creates workflow tables and indexes', () => {
    const dbPath = createTempDbPath();
    const index = new SqliteIndex(dbPath);
    index.close();

    const db = new Database(dbPath, { readonly: true });
    const tableNames = [
      'workflow_runs',
      'workflow_stage_runs',
      'workflow_task_runs',
      'workflow_task_dependencies',
      'workflow_artifacts',
    ];
    const indexNames = [
      'idx_workflow_runs_status_updated',
      'idx_workflow_stage_runs_workflow_order',
      'idx_workflow_stage_runs_workflow_status',
      'idx_workflow_task_runs_workflow_status_updated',
      'idx_workflow_task_runs_stage_status',
      'idx_workflow_task_runs_provider_task',
      'idx_workflow_task_runs_workflow_task',
      'idx_workflow_task_dependencies_depends_on',
      'idx_workflow_artifacts_workflow_type',
      'idx_workflow_artifacts_entity',
      'idx_workflow_artifacts_asset_hash',
    ];

    for (const tableName of tableNames) {
      const exists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get(tableName);
      expect(exists).toBeTruthy();
    }

    for (const indexName of indexNames) {
      const exists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
        .get(indexName);
      expect(exists).toBeTruthy();
    }

    db.close();
  });
});
