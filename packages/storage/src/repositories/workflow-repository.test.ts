import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  WorkflowRun,
  WorkflowRunId,
  WorkflowStageId,
  WorkflowTaskId,
  WorkflowStageRun,
  WorkflowTaskRun,
} from '@lucid-fin/contracts';
import { setDegradeReporter, type DegradeReporter } from '@lucid-fin/contracts-parse';
import { SqliteIndex } from '../sqlite-index.js';
import { WorkflowRepository } from './workflow-repository.js';

function tmpDb() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-repo-'));
  const index = new SqliteIndex(path.join(base, 'test.db'));
  // index.db isn't public; use a dedicated test getter by reaching through
  // the facade instead — we'll construct WorkflowRepository on the same path.
  const repo = new WorkflowRepository(
    (index as unknown as { db: import('better-sqlite3').Database }).db,
  );
  return {
    index,
    repo,
    cleanup: () => {
      index.close();
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

function mkRun(id: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id,
    workflowType: 'character-build',
    entityType: 'character',
    entityId: 'char-1',
    triggerSource: 'manual',
    status: 'queued',
    summary: '',
    progress: 0,
    completedStages: 0,
    totalStages: 2,
    completedTasks: 0,
    totalTasks: 3,
    input: {},
    output: {},
    metadata: {},
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function mkStageRun(
  id: string,
  runId: string,
  overrides: Partial<WorkflowStageRun> = {},
): WorkflowStageRun {
  return {
    id,
    workflowRunId: runId,
    stageId: 'stage-1',
    name: 'Stage 1',
    status: 'pending',
    order: 1,
    progress: 0,
    completedTasks: 0,
    totalTasks: 2,
    metadata: {},
    updatedAt: 100,
    ...overrides,
  };
}

function mkTaskRun(
  id: string,
  runId: string,
  stageRunId: string,
  overrides: Partial<WorkflowTaskRun> = {},
): WorkflowTaskRun {
  return {
    id,
    workflowRunId: runId,
    stageRunId,
    taskId: 'task-1',
    name: 'Task 1',
    kind: 'adapter_generation',
    status: 'pending',
    dependencyIds: [],
    attempts: 0,
    maxRetries: 3,
    input: {},
    output: {},
    progress: 0,
    updatedAt: 100,
    ...overrides,
  };
}

describe('WorkflowRepository', () => {
  let ctx: ReturnType<typeof tmpDb>;
  const reports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    reports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    ctx = tmpDb();
    reports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    ctx.cleanup();
  });

  it('insertRun + getRun round-trips scalar + JSON fields', () => {
    ctx.repo.insertRun(
      mkRun('r1', {
        input: { a: 1 },
        output: { b: 2 },
        metadata: { traceId: 't' },
      }),
    );
    const got = ctx.repo.getRun('r1' as WorkflowRunId)!;
    expect(got.workflowType).toBe('character-build');
    expect(got.input).toEqual({ a: 1 });
    expect(got.output).toEqual({ b: 2 });
    expect(got.metadata).toEqual({ traceId: 't' });
  });

  it('listRuns filters by status and returns degradedCount', () => {
    ctx.repo.insertRun(mkRun('r1', { status: 'queued' }));
    ctx.repo.insertRun(mkRun('r2', { status: 'running' }));
    const { rows, degradedCount } = ctx.repo.listRuns({ status: 'running' });
    expect(degradedCount).toBe(0);
    expect(rows.map((r) => r.id)).toEqual(['r2']);
  });

  it('updateRun applies status + summary changes', () => {
    ctx.repo.insertRun(mkRun('r1'));
    ctx.repo.updateRun('r1' as WorkflowRunId, { status: 'running', summary: 'go' });
    expect(ctx.repo.getRun('r1' as WorkflowRunId)?.status).toBe('running');
    expect(ctx.repo.getRun('r1' as WorkflowRunId)?.summary).toBe('go');
  });

  it('stage runs: insert + list + get + update', () => {
    ctx.repo.insertRun(mkRun('r1'));
    ctx.repo.insertStageRun(mkStageRun('s1', 'r1', { name: 'Initial' }));
    ctx.repo.insertStageRun(mkStageRun('s2', 'r1', { name: 'Final', order: 2 }));
    const list = ctx.repo.listStageRuns('r1' as WorkflowRunId);
    expect(list.rows.map((r) => r.id).sort()).toEqual(['s1', 's2']);
    ctx.repo.updateStageRun('s1' as WorkflowStageId, { status: 'running' });
    expect(ctx.repo.getStageRun('s1' as WorkflowStageId)?.status).toBe('running');
  });

  it('task runs: insert + list by run + list by stage + dependencies', () => {
    ctx.repo.insertRun(mkRun('r1'));
    ctx.repo.insertStageRun(mkStageRun('s1', 'r1'));
    ctx.repo.insertTaskRun(mkTaskRun('t1', 'r1', 's1'));
    ctx.repo.insertTaskRun(mkTaskRun('t2', 'r1', 's1'));
    ctx.repo.insertTaskDependency('t2' as WorkflowTaskId, 't1' as WorkflowTaskId);

    expect(
      ctx.repo
        .listTaskRuns('r1' as WorkflowRunId)
        .rows.map((r) => r.id)
        .sort(),
    ).toEqual(['t1', 't2']);
    expect(
      ctx.repo
        .listTaskRunsByStage('s1' as WorkflowStageId)
        .rows.map((r) => r.id)
        .sort(),
    ).toEqual(['t1', 't2']);
    expect(ctx.repo.listTaskDependencies('t2' as WorkflowTaskId)).toEqual(['t1']);
    expect(ctx.repo.listTaskDependents('t1' as WorkflowTaskId)).toEqual(['t2']);
  });

  it('getRun returns undefined for missing id', () => {
    expect(ctx.repo.getRun('missing' as WorkflowRunId)).toBeUndefined();
  });

  it('fault injection: listRuns degrades on empty id (zod min(1))', () => {
    ctx.repo.insertRun(mkRun('good'));
    // Inject a row with empty-string id — SQLite allows it (no CHECK),
    // but the zod schema's `id: z.string().min(1)` rejects it so the row
    // degrades via parseOrDegrade and fires the reporter.
    const db = (ctx.index as unknown as { db: import('better-sqlite3').Database }).db;
    db.prepare(
      `INSERT INTO workflow_runs (id, workflow_type, entity_type, entity_id, trigger_source,
         status, summary, progress, completed_stages, total_stages, completed_tasks, total_tasks,
         current_stage_id, current_task_id, input_json, output_json, error_text, metadata_json,
         created_at, started_at, completed_at, updated_at)
       VALUES ('', 'type', 'entity', NULL, 'manual', 'queued', '', 0, 0, 0, 0, 0, NULL, NULL, '{}', '{}', NULL, '{}', 1, NULL, NULL, 1)`,
    ).run();
    const { rows, degradedCount } = ctx.repo.listRuns();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.some((r) => r.schema === 'WorkflowRun')).toBe(true);
  });

  it('fault injection: listRuns degrades on invalid status enum value', () => {
    ctx.repo.insertRun(mkRun('good'));
    // Inject a row with a typo status — SQLite has no CHECK constraint,
    // but the zod schema's `status: WorkflowRunStatusEnum` rejects it so
    // impossible states degrade instead of leaking to the UI.
    const db = (ctx.index as unknown as { db: import('better-sqlite3').Database }).db;
    db.prepare(
      `INSERT INTO workflow_runs (id, workflow_type, entity_type, entity_id, trigger_source,
         status, summary, progress, completed_stages, total_stages, completed_tasks, total_tasks,
         current_stage_id, current_task_id, input_json, output_json, error_text, metadata_json,
         created_at, started_at, completed_at, updated_at)
       VALUES ('bogus', 'type', 'entity', NULL, 'manual', 'runing', '', 0, 0, 0, 0, 0, NULL, NULL, '{}', '{}', NULL, '{}', 1, NULL, NULL, 1)`,
    ).run();
    const { rows, degradedCount } = ctx.repo.listRuns();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.some((r) => r.schema === 'WorkflowRun')).toBe(true);
  });

  it('artifact insert + list by run + by task + by entity', () => {
    ctx.repo.insertRun(mkRun('r1'));
    ctx.repo.insertStageRun(mkStageRun('s1', 'r1'));
    ctx.repo.insertTaskRun(mkTaskRun('t1', 'r1', 's1'));
    ctx.repo.insertArtifact({
      id: 'a1',
      workflowRunId: 'r1',
      taskRunId: 't1',
      artifactType: 'image',
      entityType: 'character',
      entityId: 'char-1',
      metadata: {},
      createdAt: 1,
    });
    expect(ctx.repo.listArtifacts('r1' as WorkflowRunId).map((a) => a.id)).toEqual(['a1']);
    expect(ctx.repo.listArtifactsByTaskRun('t1' as WorkflowTaskId).map((a) => a.id)).toEqual([
      'a1',
    ]);
    expect(ctx.repo.listEntityArtifacts('character', 'char-1').map((a) => a.id)).toEqual(['a1']);
  });
});
