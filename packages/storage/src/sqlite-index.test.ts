import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from '../src/sqlite-index.ts';
import type {
  Job,
  WorkflowStageRun,
  WorkflowTaskRun,
  WorkflowArtifact,
} from '@lucid-fin/contracts';
import { JobStatus } from '@lucid-fin/contracts';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-db-'));
}

describe('SqliteIndex', () => {
  let db: SqliteIndex;
  let base: string;
  let dbPath: string;

  beforeEach(() => {
    base = tmpDir();
    dbPath = path.join(base, 'test.db');
    db = new SqliteIndex(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  describe('schema', () => {
    it('creates database with WAL mode', () => {
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it('creates all tables + FTS5', () => {
      // If schema failed, constructor would throw
      // Verify by inserting into each table
      db.repos.assets.insert({
        hash: 'abc',
        type: 'image',
        format: 'png',
        originalName: 'x.png',
        fileSize: 100,
        tags: [],
        createdAt: Date.now(),
      });
      db.repos.entities.upsertCharacter({ id: 'c1', name: 'Hero' });
      db.repos.dependencies.add('scene', 's1', 'asset', 'a1');
      // No throw = all tables exist
    });
  });

  describe('jobs CRUD', () => {
    const makeJob = (overrides?: Partial<Job>): Job => ({
      id: 'j1',
      type: 'image',
      provider: 'openai-dalle',
      status: JobStatus.Queued,
      priority: 0,
      prompt: 'a cat',
      attempts: 0,
      maxRetries: 3,
      createdAt: Date.now(),
      ...overrides,
    });

    it('inserts and retrieves a job', () => {
      const job = makeJob();
      db.repos.jobs.insert(job);
      const retrieved = db.repos.jobs.get('j1' as JobId);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('j1');
      expect(retrieved!.prompt).toBe('a cat');
      expect(retrieved!.status).toBe(JobStatus.Queued);
    });

    it('updates job status', () => {
      db.repos.jobs.insert(makeJob());
      db.repos.jobs.update('j1' as JobId, { status: JobStatus.Running, startedAt: Date.now() });
      const job = db.repos.jobs.get('j1' as JobId);
      expect(job!.status).toBe(JobStatus.Running);
      expect(job!.startedAt).toBeDefined();
    });

    it('lists jobs with filters', () => {
      db.repos.jobs.insert(makeJob({ id: 'j1', status: JobStatus.Queued }));
      db.repos.jobs.insert(makeJob({ id: 'j2', status: JobStatus.Running }));
      db.repos.jobs.insert(makeJob({ id: 'j3', status: JobStatus.Queued }));

      const queued = db.repos.jobs.list({ status: JobStatus.Queued }).rows;
      expect(queued.length).toBe(2);

      const all = db.repos.jobs.list().rows;
      expect(all.length).toBe(3);
    });

    it('query performance < 50ms for 100 jobs', () => {
      for (let i = 0; i < 100; i++) {
        db.repos.jobs.insert(makeJob({ id: `j${i}`, priority: i % 5 }));
      }
      const start = performance.now();
      const jobs = db.repos.jobs.list().rows;
      const elapsed = performance.now() - start;
      expect(jobs.length).toBe(100);
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe('workflow runs CRUD', () => {
    it('inserts, gets, lists, and updates a workflow run', () => {
      db.repos.workflows.insertRun({
        id: 'wf-1',
        workflowType: 'storyboard.generate',
        entityType: 'scene',
        entityId: 's1',
        triggerSource: 'user',
        status: 'queued',
        summary: 'queued',
        progress: 0,
        completedStages: 0,
        totalStages: 3,
        completedTasks: 0,
        totalTasks: 8,
        currentStageId: 'validate',
        currentTaskId: 'task-1',
        input: { sceneIds: ['s1'] },
        output: {},
        metadata: { source: 'test' },
        createdAt: 1,
        updatedAt: 1,
      });
      db.repos.workflows.insertRun({
        id: 'wf-2',
        workflowType: 'style.extract',
        entityType: 'asset',
        triggerSource: 'system',
        status: 'running',
        summary: 'running',
        progress: 50,
        completedStages: 1,
        totalStages: 2,
        completedTasks: 2,
        totalTasks: 4,
        input: {},
        output: {},
        metadata: {},
        createdAt: 2,
        updatedAt: 3,
      });

      const fetched = db.repos.workflows.getRun('wf-1');
      expect(fetched).toEqual({
        id: 'wf-1',
        workflowType: 'storyboard.generate',
        entityType: 'scene',
        entityId: 's1',
        triggerSource: 'user',
        status: 'queued',
        summary: 'queued',
        progress: 0,
        completedStages: 0,
        totalStages: 3,
        completedTasks: 0,
        totalTasks: 8,
        currentStageId: 'validate',
        currentTaskId: 'task-1',
        input: { sceneIds: ['s1'] },
        output: {},
        metadata: { source: 'test' },
        createdAt: 1,
        updatedAt: 1,
      });

      const listed = db.repos.workflows.listRuns({
        workflowType: 'style.extract',
        entityType: 'asset',
        status: 'running',
      }).rows;
      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe('wf-2');

      db.repos.workflows.updateRun('wf-1', {
        status: 'running',
        progress: 25,
        summary: 'running',
        currentTaskId: 'task-2',
        output: { started: true },
        updatedAt: 2,
      });

      const updated = db.repos.workflows.getRun('wf-1');
      expect(updated).toMatchObject({
        id: 'wf-1',
        status: 'running',
        progress: 25,
        summary: 'running',
        currentTaskId: 'task-2',
        output: { started: true },
        updatedAt: 2,
      });

      const nullables = db.repos.workflows.getRun('wf-2');
      expect(nullables?.entityId).toBeUndefined();
      expect(nullables?.currentStageId).toBeUndefined();
      expect(nullables?.currentTaskId).toBeUndefined();
      expect(nullables?.error).toBeUndefined();
      expect(nullables?.startedAt).toBeUndefined();
      expect(nullables?.completedAt).toBeUndefined();
    });
  });

  describe('workflow stage/task/dependency/artifact CRUD', () => {
    const makeStageRun = (overrides?: Partial<WorkflowStageRun>): WorkflowStageRun => ({
      id: 'stage-1',
      workflowRunId: 'wf-1',
      stageId: 'validate',
      name: 'Validate',
      status: 'pending',
      order: 1,
      progress: 0,
      completedTasks: 0,
      totalTasks: 2,
      metadata: {},
      updatedAt: 1,
      ...overrides,
    });

    const makeTaskRun = (overrides?: Partial<WorkflowTaskRun>): WorkflowTaskRun => ({
      id: 'task-1',
      workflowRunId: 'wf-1',
      stageRunId: 'stage-1',
      taskId: 'validate-input',
      name: 'Validate Input',
      kind: 'validation',
      status: 'pending',
      dependencyIds: [],
      attempts: 0,
      maxRetries: 2,
      input: {},
      output: {},
      progress: 0,
      updatedAt: 1,
      ...overrides,
    });

    const makeArtifact = (overrides?: Partial<WorkflowArtifact>): WorkflowArtifact => ({
      id: 'artifact-1',
      workflowRunId: 'wf-1',
      taskRunId: 'task-1',
      artifactType: 'preview',
      metadata: {},
      createdAt: 1,
      ...overrides,
    });

    it('inserts, lists, and updates stage runs', () => {
      db.repos.workflows.insertStageRun(makeStageRun());
      db.repos.workflows.insertStageRun(
        makeStageRun({
          id: 'stage-2',
          stageId: 'render',
          name: 'Render',
          order: 2,
          status: 'running',
          progress: 50,
          completedTasks: 1,
          totalTasks: 3,
          error: 'soft warning',
          metadata: { phase: 'render' },
          startedAt: 2,
          completedAt: 3,
          updatedAt: 4,
        }),
      );

      const listed = db.repos.workflows.listStageRuns('wf-1').rows;
      expect(listed).toEqual([
        {
          id: 'stage-1',
          workflowRunId: 'wf-1',
          stageId: 'validate',
          name: 'Validate',
          status: 'pending',
          order: 1,
          progress: 0,
          completedTasks: 0,
          totalTasks: 2,
          metadata: {},
          updatedAt: 1,
        },
        {
          id: 'stage-2',
          workflowRunId: 'wf-1',
          stageId: 'render',
          name: 'Render',
          status: 'running',
          order: 2,
          progress: 50,
          completedTasks: 1,
          totalTasks: 3,
          error: 'soft warning',
          metadata: { phase: 'render' },
          startedAt: 2,
          completedAt: 3,
          updatedAt: 4,
        },
      ]);

      db.repos.workflows.updateStageRun('stage-1', {
        status: 'completed',
        progress: 100,
        completedTasks: 2,
        metadata: { ok: true },
        completedAt: 5,
        updatedAt: 5,
      });

      expect(db.repos.workflows.listStageRuns('wf-1').rows[0]).toEqual({
        id: 'stage-1',
        workflowRunId: 'wf-1',
        stageId: 'validate',
        name: 'Validate',
        status: 'completed',
        order: 1,
        progress: 100,
        completedTasks: 2,
        totalTasks: 2,
        metadata: { ok: true },
        completedAt: 5,
        updatedAt: 5,
      });
    });

    it('hydrates task dependencyIds from dependency edges for get/list queries', () => {
      db.repos.workflows.insertTaskRun(makeTaskRun());
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-2',
          stageRunId: 'stage-2',
          taskId: 'render-frame',
          name: 'Render Frame',
          kind: 'adapter_generation',
          status: 'running',
          provider: 'openai',
          dependencyIds: ['task-1'],
          attempts: 1,
          maxRetries: 3,
          input: { prompt: 'hello' },
          output: { queued: true },
          providerTaskId: 'provider-1',
          assetId: 'asset-1',
          error: 'warning',
          progress: 25,
          currentStep: 'submit',
          startedAt: 10,
          completedAt: 11,
          updatedAt: 12,
        }),
      );

      db.repos.workflows.updateTaskRun('task-2', {
        dependencyIds: ['stale-task'],
        updatedAt: 13,
      });
      db.repos.workflows.insertTaskDependency('task-2', 'task-1');

      expect(db.repos.workflows.getTaskRun('task-2')).toEqual({
        id: 'task-2',
        workflowRunId: 'wf-1',
        stageRunId: 'stage-2',
        taskId: 'render-frame',
        name: 'Render Frame',
        kind: 'adapter_generation',
        status: 'running',
        provider: 'openai',
        dependencyIds: ['stale-task', 'task-1'],
        attempts: 1,
        maxRetries: 3,
        input: { prompt: 'hello' },
        output: { queued: true },
        providerTaskId: 'provider-1',
        assetId: 'asset-1',
        error: 'warning',
        progress: 25,
        currentStep: 'submit',
        startedAt: 10,
        completedAt: 11,
        updatedAt: 13,
      });

      expect(
        db.repos.workflows
          .listTaskRuns('wf-1')
          .rows.map((task) => ({ id: task.id, dependencyIds: task.dependencyIds })),
      ).toEqual([
        { id: 'task-2', dependencyIds: ['stale-task', 'task-1'] },
        { id: 'task-1', dependencyIds: [] },
      ]);
      expect(
        db.repos.workflows
          .listTaskRunsByStage('stage-1')
          .rows.map((task) => ({ id: task.id, dependencyIds: task.dependencyIds })),
      ).toEqual([{ id: 'task-1', dependencyIds: [] }]);
      expect(
        db.repos.workflows
          .listTaskRunsByStage('stage-2')
          .rows.map((task) => ({ id: task.id, dependencyIds: ['stale-task', 'task-1'] })),
      ).toEqual([{ id: 'task-2', dependencyIds: ['stale-task', 'task-1'] }]);
      expect(db.repos.workflows.listTaskDependencies('task-2')).toEqual(['stale-task', 'task-1']);
      expect(db.repos.workflows.listTaskDependents('task-1')).toEqual(['task-2']);
      expect(db.repos.workflows.listTaskDependents('stale-task')).toEqual(['task-2']);
    });

    it('keeps task dependency reads aligned after updateWorkflowTaskRun changes dependencyIds', () => {
      db.repos.workflows.insertTaskRun(makeTaskRun());
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-2',
          stageRunId: 'stage-2',
          taskId: 'render-frame',
          name: 'Render Frame',
          kind: 'adapter_generation',
          status: 'running',
          dependencyIds: ['task-1'],
          updatedAt: 12,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-0',
          stageRunId: 'stage-0',
          taskId: 'prepare-input',
          name: 'Prepare Input',
          kind: 'validation',
          status: 'completed',
          updatedAt: 2,
        }),
      );
      db.repos.workflows.insertTaskDependency('task-2', 'task-1');

      db.repos.workflows.updateTaskRun('task-2', {
        status: 'completed',
        dependencyIds: ['task-0'],
        output: { ok: true },
        completedAt: 20,
        updatedAt: 20,
      });

      expect(db.repos.workflows.getTaskRun('task-2')).toEqual({
        id: 'task-2',
        workflowRunId: 'wf-1',
        stageRunId: 'stage-2',
        taskId: 'render-frame',
        name: 'Render Frame',
        kind: 'adapter_generation',
        status: 'completed',
        dependencyIds: ['task-0'],
        attempts: 0,
        maxRetries: 2,
        input: {},
        output: { ok: true },
        progress: 0,
        completedAt: 20,
        updatedAt: 20,
      });
      expect(db.repos.workflows.listTaskDependencies('task-2')).toEqual(['task-0']);
      expect(db.repos.workflows.listTaskDependents('task-1')).toEqual([]);
      expect(db.repos.workflows.listTaskDependents('task-0')).toEqual(['task-2']);
    });

    it('stores task dependency edges in both directions', () => {
      db.repos.workflows.insertTaskDependency('task-2', 'task-1');
      db.repos.workflows.insertTaskDependency('task-3', 'task-1');

      expect(db.repos.workflows.listTaskDependencies('task-2')).toEqual(['task-1']);
      expect(db.repos.workflows.listTaskDependents('task-1')).toEqual(['task-2', 'task-3']);
    });

    it('inserts and lists workflow artifacts by workflow and entity', () => {
      db.repos.workflows.insertArtifact(
        makeArtifact({
          id: 'artifact-1',
          artifactType: 'preview',
          entityType: 'scene',
          entityId: 'scene-1',
          assetHash: 'hash-1',
          path: '/tmp/a.png',
          metadata: { width: 100 },
          createdAt: 1,
        }),
      );
      db.repos.workflows.insertArtifact(
        makeArtifact({
          id: 'artifact-2',
          taskRunId: 'task-2',
          artifactType: 'manifest',
          entityType: 'scene',
          entityId: 'scene-1',
          metadata: { pages: 2 },
          createdAt: 2,
        }),
      );
      db.repos.workflows.insertArtifact(
        makeArtifact({
          id: 'artifact-3',
          workflowRunId: 'wf-2',
          taskRunId: 'task-3',
          artifactType: 'preview',
          entityType: 'asset',
          entityId: 'asset-9',
          metadata: {},
          createdAt: 3,
        }),
      );

      expect(db.repos.workflows.listArtifacts('wf-1')).toEqual([
        {
          id: 'artifact-2',
          workflowRunId: 'wf-1',
          taskRunId: 'task-2',
          artifactType: 'manifest',
          entityType: 'scene',
          entityId: 'scene-1',
          metadata: { pages: 2 },
          createdAt: 2,
        },
        {
          id: 'artifact-1',
          workflowRunId: 'wf-1',
          taskRunId: 'task-1',
          artifactType: 'preview',
          entityType: 'scene',
          entityId: 'scene-1',
          assetHash: 'hash-1',
          path: '/tmp/a.png',
          metadata: { width: 100 },
          createdAt: 1,
        },
      ]);

      expect(db.repos.workflows.listEntityArtifacts('scene', 'scene-1')).toEqual([
        {
          id: 'artifact-2',
          workflowRunId: 'wf-1',
          taskRunId: 'task-2',
          artifactType: 'manifest',
          entityType: 'scene',
          entityId: 'scene-1',
          metadata: { pages: 2 },
          createdAt: 2,
        },
        {
          id: 'artifact-1',
          workflowRunId: 'wf-1',
          taskRunId: 'task-1',
          artifactType: 'preview',
          entityType: 'scene',
          entityId: 'scene-1',
          assetHash: 'hash-1',
          path: '/tmp/a.png',
          metadata: { width: 100 },
          createdAt: 1,
        },
      ]);
    });

    it('recomputes stage aggregates from task rows', () => {
      db.repos.workflows.insertRun({
        id: 'wf-agg-stage',
        workflowType: 'storyboard.generate',
        entityType: 'scene',
        triggerSource: 'user',
        status: 'queued',
        summary: 'queued',
        progress: 0,
        completedStages: 0,
        totalStages: 1,
        completedTasks: 0,
        totalTasks: 2,
        input: {},
        output: {},
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
      });
      db.repos.workflows.insertStageRun(
        makeStageRun({
          id: 'stage-agg',
          workflowRunId: 'wf-agg-stage',
          stageId: 'render',
          name: 'Render',
          totalTasks: 99,
          updatedAt: 1,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-agg-1',
          workflowRunId: 'wf-agg-stage',
          stageRunId: 'stage-agg',
          status: 'pending',
          updatedAt: 1,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-agg-2',
          workflowRunId: 'wf-agg-stage',
          stageRunId: 'stage-agg',
          taskId: 'render-frame',
          name: 'Render Frame',
          status: 'pending',
          updatedAt: 2,
        }),
      );

      db.repos.workflows.recomputeStageAggregate('stage-agg');
      expect(db.repos.workflows.listStageRuns('wf-agg-stage').rows[0]).toMatchObject({
        id: 'stage-agg',
        status: 'pending',
        totalTasks: 2,
        completedTasks: 0,
        progress: 0,
      });

      db.repos.workflows.updateTaskRun('task-agg-1', {
        status: 'running',
        progress: 25,
        updatedAt: 3,
      });
      db.repos.workflows.recomputeStageAggregate('stage-agg');
      expect(db.repos.workflows.listStageRuns('wf-agg-stage').rows[0]).toMatchObject({
        id: 'stage-agg',
        status: 'running',
        totalTasks: 2,
        completedTasks: 0,
        progress: 13,
      });

      db.repos.workflows.updateTaskRun('task-agg-2', {
        status: 'running',
        progress: 50,
        updatedAt: 4,
      });
      db.repos.workflows.recomputeStageAggregate('stage-agg');
      expect(db.repos.workflows.listStageRuns('wf-agg-stage').rows[0]).toMatchObject({
        id: 'stage-agg',
        status: 'running',
        totalTasks: 2,
        completedTasks: 0,
        progress: 38,
      });

      db.repos.workflows.updateTaskRun('task-agg-1', {
        status: 'completed',
        progress: 100,
        completedAt: 5,
        updatedAt: 5,
      });
      db.repos.workflows.recomputeStageAggregate('stage-agg');
      expect(db.repos.workflows.listStageRuns('wf-agg-stage').rows[0]).toMatchObject({
        id: 'stage-agg',
        status: 'running',
        totalTasks: 2,
        completedTasks: 1,
        progress: 75,
      });

      db.repos.workflows.updateTaskRun('task-agg-2', {
        status: 'completed',
        progress: 100,
        completedAt: 6,
        updatedAt: 6,
      });
      db.repos.workflows.recomputeStageAggregate('stage-agg');
      expect(db.repos.workflows.listStageRuns('wf-agg-stage').rows[0]).toMatchObject({
        id: 'stage-agg',
        status: 'completed',
        totalTasks: 2,
        completedTasks: 2,
        progress: 100,
      });
    });

    it('marks a stage completed_with_errors when tasks finish with mixed outcomes', () => {
      db.repos.workflows.insertRun({
        id: 'wf-agg-stage-errors',
        workflowType: 'storyboard.generate',
        entityType: 'scene',
        triggerSource: 'user',
        status: 'queued',
        summary: 'queued',
        progress: 0,
        completedStages: 0,
        totalStages: 1,
        completedTasks: 0,
        totalTasks: 2,
        input: {},
        output: {},
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
      });
      db.repos.workflows.insertStageRun(
        makeStageRun({
          id: 'stage-agg-errors',
          workflowRunId: 'wf-agg-stage-errors',
          stageId: 'render',
          name: 'Render',
          updatedAt: 1,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-agg-errors-1',
          workflowRunId: 'wf-agg-stage-errors',
          stageRunId: 'stage-agg-errors',
          status: 'completed',
          progress: 100,
          completedAt: 2,
          updatedAt: 2,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-agg-errors-2',
          workflowRunId: 'wf-agg-stage-errors',
          stageRunId: 'stage-agg-errors',
          taskId: 'render-frame',
          name: 'Render Frame',
          status: 'retryable_failed',
          progress: 100,
          error: 'provider timeout',
          completedAt: 3,
          updatedAt: 3,
        }),
      );

      db.repos.workflows.recomputeStageAggregate('stage-agg-errors');

      expect(db.repos.workflows.listStageRuns('wf-agg-stage-errors').rows[0]).toMatchObject({
        id: 'stage-agg-errors',
        status: 'completed_with_errors',
        totalTasks: 2,
        completedTasks: 1,
        progress: 100,
      });
    });

    it('marks a workflow completed_with_errors when stages finish with mixed outcomes', () => {
      db.repos.workflows.insertRun({
        id: 'wf-agg-workflow-errors',
        workflowType: 'storyboard.generate',
        entityType: 'scene',
        triggerSource: 'user',
        status: 'queued',
        summary: 'queued',
        progress: 0,
        completedStages: 0,
        totalStages: 0,
        completedTasks: 0,
        totalTasks: 0,
        input: {},
        output: {},
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
      });
      db.repos.workflows.insertStageRun(
        makeStageRun({
          id: 'stage-wf-errors-1',
          workflowRunId: 'wf-agg-workflow-errors',
          stageId: 'validate',
          name: 'Validate',
          order: 1,
          status: 'pending',
          totalTasks: 1,
          updatedAt: 1,
        }),
      );
      db.repos.workflows.insertStageRun(
        makeStageRun({
          id: 'stage-wf-errors-2',
          workflowRunId: 'wf-agg-workflow-errors',
          stageId: 'render',
          name: 'Render',
          order: 2,
          status: 'pending',
          totalTasks: 2,
          updatedAt: 1,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-wf-errors-1',
          workflowRunId: 'wf-agg-workflow-errors',
          stageRunId: 'stage-wf-errors-1',
          taskId: 'validate-input',
          name: 'Validate Input',
          status: 'completed',
          progress: 100,
          completedAt: 1,
          updatedAt: 1,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-wf-errors-2',
          workflowRunId: 'wf-agg-workflow-errors',
          stageRunId: 'stage-wf-errors-2',
          taskId: 'render-frame-1',
          name: 'Render Frame 1',
          status: 'completed',
          progress: 100,
          completedAt: 2,
          updatedAt: 2,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-wf-errors-3',
          workflowRunId: 'wf-agg-workflow-errors',
          stageRunId: 'stage-wf-errors-2',
          taskId: 'render-frame-2',
          name: 'Render Frame 2',
          status: 'retryable_failed',
          progress: 0,
          error: 'provider timeout',
          completedAt: 3,
          updatedAt: 3,
        }),
      );

      db.repos.workflows.recomputeStageAggregate('stage-wf-errors-1');
      db.repos.workflows.recomputeStageAggregate('stage-wf-errors-2');
      db.repos.workflows.recomputeWorkflowAggregate('wf-agg-workflow-errors');

      expect(db.repos.workflows.getRun('wf-agg-workflow-errors')).toMatchObject({
        id: 'wf-agg-workflow-errors',
        status: 'completed_with_errors',
        totalStages: 2,
        completedStages: 1,
        totalTasks: 3,
        completedTasks: 2,
        progress: 100,
        currentStageId: undefined,
        currentTaskId: undefined,
        summary: 'completed_with_errors 1/2 stages, 2/3 tasks',
      });
    });

    it('updates stage updatedAt when recomputeStageAggregate changes derived state', () => {
      db.repos.workflows.insertRun({
        id: 'wf-stage-updated-at',
        workflowType: 'storyboard.generate',
        entityType: 'scene',
        triggerSource: 'user',
        status: 'queued',
        summary: 'queued',
        progress: 0,
        completedStages: 0,
        totalStages: 1,
        completedTasks: 0,
        totalTasks: 1,
        input: {},
        output: {},
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
      });
      db.repos.workflows.insertStageRun(
        makeStageRun({
          id: 'stage-updated-at',
          workflowRunId: 'wf-stage-updated-at',
          stageId: 'render',
          name: 'Render',
          updatedAt: 10,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-stage-updated-at',
          workflowRunId: 'wf-stage-updated-at',
          stageRunId: 'stage-updated-at',
          status: 'running',
          progress: 25,
          updatedAt: 42,
        }),
      );

      db.repos.workflows.recomputeStageAggregate('stage-updated-at');

      expect(db.repos.workflows.listStageRuns('wf-stage-updated-at').rows[0]).toMatchObject({
        id: 'stage-updated-at',
        status: 'running',
        progress: 25,
        totalTasks: 1,
        completedTasks: 0,
        updatedAt: 42,
      });
    });

    it('updates workflow updatedAt and forces terminal progress to 100 when recomputeWorkflowAggregate changes derived state', () => {
      db.repos.workflows.insertRun({
        id: 'wf-workflow-updated-at',
        workflowType: 'storyboard.generate',
        entityType: 'scene',
        triggerSource: 'user',
        status: 'queued',
        summary: 'queued',
        progress: 0,
        completedStages: 0,
        totalStages: 0,
        completedTasks: 0,
        totalTasks: 0,
        input: {},
        output: {},
        metadata: {},
        createdAt: 1,
        updatedAt: 10,
      });
      db.repos.workflows.insertStageRun(
        makeStageRun({
          id: 'stage-workflow-updated-at-1',
          workflowRunId: 'wf-workflow-updated-at',
          stageId: 'validate',
          name: 'Validate',
          order: 1,
          status: 'completed',
          progress: 100,
          totalTasks: 1,
          completedTasks: 1,
          updatedAt: 40,
        }),
      );
      db.repos.workflows.insertStageRun(
        makeStageRun({
          id: 'stage-workflow-updated-at-2',
          workflowRunId: 'wf-workflow-updated-at',
          stageId: 'render',
          name: 'Render',
          order: 2,
          status: 'completed_with_errors',
          progress: 0,
          totalTasks: 2,
          completedTasks: 1,
          updatedAt: 50,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-workflow-updated-at-1',
          workflowRunId: 'wf-workflow-updated-at',
          stageRunId: 'stage-workflow-updated-at-1',
          taskId: 'validate-input',
          name: 'Validate Input',
          status: 'completed',
          progress: 100,
          completedAt: 40,
          updatedAt: 40,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-workflow-updated-at-2',
          workflowRunId: 'wf-workflow-updated-at',
          stageRunId: 'stage-workflow-updated-at-2',
          taskId: 'render-frame-1',
          name: 'Render Frame 1',
          status: 'completed',
          progress: 100,
          completedAt: 45,
          updatedAt: 45,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-workflow-updated-at-3',
          workflowRunId: 'wf-workflow-updated-at',
          stageRunId: 'stage-workflow-updated-at-2',
          taskId: 'render-frame-2',
          name: 'Render Frame 2',
          status: 'retryable_failed',
          progress: 0,
          completedAt: 50,
          error: 'provider timeout',
          updatedAt: 50,
        }),
      );

      db.repos.workflows.recomputeWorkflowAggregate('wf-workflow-updated-at');

      expect(db.repos.workflows.getRun('wf-workflow-updated-at')).toMatchObject({
        id: 'wf-workflow-updated-at',
        status: 'completed_with_errors',
        progress: 100,
        totalStages: 2,
        completedStages: 1,
        totalTasks: 3,
        completedTasks: 2,
        updatedAt: 50,
        currentStageId: undefined,
        currentTaskId: undefined,
        summary: 'completed_with_errors 1/2 stages, 2/3 tasks',
      });
    });

    it('recomputes workflow aggregates from stage and task rows', () => {
      db.repos.workflows.insertRun({
        id: 'wf-agg-workflow',
        workflowType: 'storyboard.generate',
        entityType: 'scene',
        triggerSource: 'user',
        status: 'queued',
        summary: 'queued',
        progress: 0,
        completedStages: 0,
        totalStages: 0,
        completedTasks: 0,
        totalTasks: 0,
        input: {},
        output: {},
        metadata: {},
        createdAt: 1,
        updatedAt: 1,
      });
      db.repos.workflows.insertStageRun(
        makeStageRun({
          id: 'stage-wf-1',
          workflowRunId: 'wf-agg-workflow',
          stageId: 'validate',
          name: 'Validate',
          order: 1,
          status: 'pending',
          totalTasks: 1,
          updatedAt: 1,
        }),
      );
      db.repos.workflows.insertStageRun(
        makeStageRun({
          id: 'stage-wf-2',
          workflowRunId: 'wf-agg-workflow',
          stageId: 'render',
          name: 'Render',
          order: 2,
          status: 'pending',
          totalTasks: 2,
          updatedAt: 1,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-wf-1',
          workflowRunId: 'wf-agg-workflow',
          stageRunId: 'stage-wf-1',
          taskId: 'validate-input',
          name: 'Validate Input',
          status: 'completed',
          progress: 100,
          completedAt: 1,
          updatedAt: 1,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-wf-2',
          workflowRunId: 'wf-agg-workflow',
          stageRunId: 'stage-wf-2',
          taskId: 'render-frame-1',
          name: 'Render Frame 1',
          status: 'running',
          progress: 50,
          updatedAt: 2,
        }),
      );
      db.repos.workflows.insertTaskRun(
        makeTaskRun({
          id: 'task-wf-3',
          workflowRunId: 'wf-agg-workflow',
          stageRunId: 'stage-wf-2',
          taskId: 'render-frame-2',
          name: 'Render Frame 2',
          status: 'pending',
          updatedAt: 3,
        }),
      );

      db.repos.workflows.recomputeStageAggregate('stage-wf-1');
      db.repos.workflows.recomputeStageAggregate('stage-wf-2');
      db.repos.workflows.recomputeWorkflowAggregate('wf-agg-workflow');

      expect(db.repos.workflows.getRun('wf-agg-workflow')).toMatchObject({
        id: 'wf-agg-workflow',
        status: 'running',
        totalStages: 2,
        completedStages: 1,
        totalTasks: 3,
        completedTasks: 1,
        progress: 63,
        currentStageId: 'stage-wf-2',
        currentTaskId: 'task-wf-2',
        summary: 'running 1/2 stages, 1/3 tasks',
      });

      db.repos.workflows.updateTaskRun('task-wf-3', {
        status: 'running',
        progress: 25,
        updatedAt: 4,
      });
      db.repos.workflows.recomputeStageAggregate('stage-wf-2');
      db.repos.workflows.recomputeWorkflowAggregate('wf-agg-workflow');

      expect(db.repos.workflows.getRun('wf-agg-workflow')).toMatchObject({
        id: 'wf-agg-workflow',
        status: 'running',
        totalStages: 2,
        completedStages: 1,
        totalTasks: 3,
        completedTasks: 1,
        progress: 69,
        currentStageId: 'stage-wf-2',
        currentTaskId: 'task-wf-3',
        summary: 'running 1/2 stages, 1/3 tasks',
      });

      db.repos.workflows.updateTaskRun('task-wf-2', {
        status: 'completed',
        progress: 100,
        completedAt: 5,
        updatedAt: 5,
      });
      db.repos.workflows.updateTaskRun('task-wf-3', {
        status: 'completed',
        progress: 100,
        completedAt: 6,
        updatedAt: 6,
      });
      db.repos.workflows.recomputeStageAggregate('stage-wf-2');
      db.repos.workflows.recomputeWorkflowAggregate('wf-agg-workflow');

      expect(db.repos.workflows.getRun('wf-agg-workflow')).toMatchObject({
        id: 'wf-agg-workflow',
        status: 'completed',
        totalStages: 2,
        completedStages: 2,
        totalTasks: 3,
        completedTasks: 3,
        progress: 100,
        currentStageId: undefined,
        currentTaskId: undefined,
        summary: 'completed 2/2 stages, 3/3 tasks',
      });
    });
  });

  describe('workflow scheduler queries', () => {
    const insertWorkflowRun = (id: string, createdAt: number, updatedAt: number) => {
      db.repos.workflows.insertRun({
        id,
        workflowType: 'storyboard.generate',
        entityType: 'scene',
        triggerSource: 'user',
        status: 'running',
        summary: 'running',
        progress: 0,
        completedStages: 0,
        totalStages: 1,
        completedTasks: 0,
        totalTasks: 1,
        input: {},
        output: {},
        metadata: {},
        createdAt,
        updatedAt,
      });
    };

    const insertStageRun = (
      id: string,
      workflowRunId: string,
      order: number,
      updatedAt: number,
    ) => {
      db.repos.workflows.insertStageRun({
        id,
        workflowRunId,
        stageId: `stage-${order}`,
        name: `Stage ${order}`,
        status: 'running',
        order,
        progress: 0,
        completedTasks: 0,
        totalTasks: 1,
        metadata: {},
        updatedAt,
      });
    };

    const insertTaskRun = (
      id: string,
      workflowRunId: string,
      stageRunId: string,
      status: WorkflowTaskRun['status'],
      updatedAt: number,
    ) => {
      db.repos.workflows.insertTaskRun({
        id,
        workflowRunId,
        stageRunId,
        taskId: id,
        name: id,
        kind: 'adapter_generation',
        status,
        dependencyIds: [],
        attempts: 0,
        maxRetries: 1,
        input: {},
        output: {},
        progress: 0,
        updatedAt,
      });
    };

    it('lists ready workflow tasks in deterministic updatedAt/id order', () => {
      insertWorkflowRun('wf-ready-1', 1, 10);
      insertWorkflowRun('wf-ready-2', 2, 20);
      insertStageRun('stage-ready-1', 'wf-ready-1', 1, 10);
      insertStageRun('stage-ready-2', 'wf-ready-2', 1, 20);
      insertTaskRun('task-ready-b', 'wf-ready-1', 'stage-ready-1', 'ready', 200);
      insertTaskRun('task-awaiting', 'wf-ready-1', 'stage-ready-1', 'awaiting_provider', 150);
      insertTaskRun('task-ready-a', 'wf-ready-2', 'stage-ready-2', 'ready', 100);
      insertTaskRun('task-ready-c', 'wf-ready-2', 'stage-ready-2', 'ready', 200);
      insertTaskRun('task-running', 'wf-ready-2', 'stage-ready-2', 'running', 50);

      expect(db.repos.workflows.listReadyTasks().rows.map((task) => task.id)).toEqual([
        'task-ready-a',
        'task-ready-b',
        'task-ready-c',
      ]);
    });

    it('lists awaiting provider tasks in deterministic updatedAt/id order', () => {
      insertWorkflowRun('wf-await-1', 1, 10);
      insertWorkflowRun('wf-await-2', 2, 20);
      insertStageRun('stage-await-1', 'wf-await-1', 1, 10);
      insertStageRun('stage-await-2', 'wf-await-2', 1, 20);
      insertTaskRun('task-await-b', 'wf-await-1', 'stage-await-1', 'awaiting_provider', 200);
      insertTaskRun('task-ready', 'wf-await-1', 'stage-await-1', 'ready', 150);
      insertTaskRun('task-await-a', 'wf-await-2', 'stage-await-2', 'awaiting_provider', 100);
      insertTaskRun('task-await-c', 'wf-await-2', 'stage-await-2', 'awaiting_provider', 200);
      insertTaskRun('task-completed', 'wf-await-2', 'stage-await-2', 'completed', 50);

      expect(db.repos.workflows.listAwaitingProviderTasks().rows.map((task) => task.id)).toEqual([
        'task-await-a',
        'task-await-b',
        'task-await-c',
      ]);
    });

    it('filters scheduler queries by workflowRunId when provided', () => {
      insertWorkflowRun('wf-filter-1', 1, 10);
      insertWorkflowRun('wf-filter-2', 2, 20);
      insertStageRun('stage-filter-1', 'wf-filter-1', 1, 10);
      insertStageRun('stage-filter-2', 'wf-filter-2', 1, 20);
      insertTaskRun('task-filter-ready-1', 'wf-filter-1', 'stage-filter-1', 'ready', 100);
      insertTaskRun('task-filter-ready-2', 'wf-filter-2', 'stage-filter-2', 'ready', 200);
      insertTaskRun(
        'task-filter-await-1',
        'wf-filter-1',
        'stage-filter-1',
        'awaiting_provider',
        300,
      );
      insertTaskRun(
        'task-filter-await-2',
        'wf-filter-2',
        'stage-filter-2',
        'awaiting_provider',
        400,
      );

      expect(db.repos.workflows.listReadyTasks('wf-filter-2').rows.map((task) => task.id)).toEqual([
        'task-filter-ready-2',
      ]);
      expect(
        db.repos.workflows.listAwaitingProviderTasks('wf-filter-1').rows.map((task) => task.id),
      ).toEqual(['task-filter-await-1']);
    });

    it('orders multiple ready tasks with the same updatedAt by id ASC', () => {
      insertWorkflowRun('wf-tie-1', 1, 10);
      insertStageRun('stage-tie-1', 'wf-tie-1', 1, 10);
      // All three share updatedAt=100; id ordering must be deterministic
      insertTaskRun('task-tie-c', 'wf-tie-1', 'stage-tie-1', 'ready', 100);
      insertTaskRun('task-tie-a', 'wf-tie-1', 'stage-tie-1', 'ready', 100);
      insertTaskRun('task-tie-b', 'wf-tie-1', 'stage-tie-1', 'ready', 100);

      expect(db.repos.workflows.listReadyTasks().rows.map((t) => t.id)).toEqual([
        'task-tie-a',
        'task-tie-b',
        'task-tie-c',
      ]);
      // Filtered by workflowRunId must produce the same deterministic order
      expect(db.repos.workflows.listReadyTasks('wf-tie-1').rows.map((t) => t.id)).toEqual([
        'task-tie-a',
        'task-tie-b',
        'task-tie-c',
      ]);
    });

    it('orders multiple awaiting_provider tasks with the same updatedAt by id ASC', () => {
      insertWorkflowRun('wf-tie-await-1', 1, 10);
      insertStageRun('stage-tie-await-1', 'wf-tie-await-1', 1, 10);
      insertTaskRun(
        'task-await-tie-c',
        'wf-tie-await-1',
        'stage-tie-await-1',
        'awaiting_provider',
        100,
      );
      insertTaskRun(
        'task-await-tie-a',
        'wf-tie-await-1',
        'stage-tie-await-1',
        'awaiting_provider',
        100,
      );
      insertTaskRun(
        'task-await-tie-b',
        'wf-tie-await-1',
        'stage-tie-await-1',
        'awaiting_provider',
        100,
      );

      expect(db.repos.workflows.listAwaitingProviderTasks().rows.map((t) => t.id)).toEqual([
        'task-await-tie-a',
        'task-await-tie-b',
        'task-await-tie-c',
      ]);
      expect(
        db.repos.workflows.listAwaitingProviderTasks('wf-tie-await-1').rows.map((t) => t.id),
      ).toEqual(['task-await-tie-a', 'task-await-tie-b', 'task-await-tie-c']);
    });

    it('returns empty array from listReadyWorkflowTasks when no ready tasks exist', () => {
      insertWorkflowRun('wf-empty-ready', 1, 10);
      insertStageRun('stage-empty-ready', 'wf-empty-ready', 1, 10);
      insertTaskRun('task-empty-running', 'wf-empty-ready', 'stage-empty-ready', 'running', 10);
      insertTaskRun('task-empty-completed', 'wf-empty-ready', 'stage-empty-ready', 'completed', 20);

      expect(db.repos.workflows.listReadyTasks().rows).toEqual([]);
      expect(db.repos.workflows.listReadyTasks('wf-empty-ready').rows).toEqual([]);
      // Non-existent workflow run also returns empty
      expect(db.repos.workflows.listReadyTasks('wf-does-not-exist').rows).toEqual([]);
    });

    it('returns empty array from listAwaitingProviderTasks when no awaiting tasks exist', () => {
      insertWorkflowRun('wf-empty-await', 1, 10);
      insertStageRun('stage-empty-await', 'wf-empty-await', 1, 10);
      insertTaskRun('task-empty-ready', 'wf-empty-await', 'stage-empty-await', 'ready', 10);
      insertTaskRun('task-empty-running', 'wf-empty-await', 'stage-empty-await', 'running', 20);

      expect(db.repos.workflows.listAwaitingProviderTasks().rows).toEqual([]);
      expect(db.repos.workflows.listAwaitingProviderTasks('wf-empty-await').rows).toEqual([]);
      expect(db.repos.workflows.listAwaitingProviderTasks('wf-does-not-exist').rows).toEqual([]);
    });
  });

  describe('assets + FTS5', () => {
    it('inserts and queries assets by type', () => {
      db.repos.assets.insert({
        hash: 'h1',
        type: 'image',
        format: 'png',
        originalName: 'a.png',
        fileSize: 100,
        tags: ['cat'],
        prompt: 'a fluffy cat',
        createdAt: Date.now(),
      });
      db.repos.assets.insert({
        hash: 'h2',
        type: 'video',
        format: 'mp4',
        originalName: 'b.mp4',
        fileSize: 200,
        tags: ['dog'],
        prompt: 'a running dog',
        createdAt: Date.now(),
      });

      const images = db.repos.assets.query({ type: 'image' }).rows;
      expect(images.length).toBe(1);
      expect(images[0].hash).toBe('h1');
    });

    it('searches assets via FTS5', () => {
      db.repos.assets.insert({
        hash: 'h1',
        type: 'image',
        format: 'png',
        originalName: 'a.png',
        fileSize: 100,
        tags: ['sunset'],
        prompt: 'golden sunset over ocean',
        createdAt: Date.now(),
      });
      db.repos.assets.insert({
        hash: 'h2',
        type: 'image',
        format: 'png',
        originalName: 'b.png',
        fileSize: 100,
        tags: ['forest'],
        prompt: 'dark forest at night',
        createdAt: Date.now(),
      });

      const results = db.repos.assets.search('sunset').rows;
      expect(results.length).toBe(1);
      expect(results[0].hash).toBe('h1');
    });
  });
});

describe('migration 004 — commander_sessions and snapshots tables exist', () => {
  let db: SqliteIndex;
  let base: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-m004-'));
    db = new SqliteIndex(path.join(base, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('commander_sessions table exists with correct columns', () => {
    const cols = (db as unknown as { db: import('better-sqlite3').Database }).db
      .prepare('PRAGMA table_info(commander_sessions)')
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('canvas_id');
    expect(names).toContain('title');
    expect(names).toContain('messages');
    expect(names).toContain('created_at');
    expect(names).toContain('updated_at');
  });

  it('snapshots table exists with correct columns', () => {
    const cols = (db as unknown as { db: import('better-sqlite3').Database }).db
      .prepare('PRAGMA table_info(snapshots)')
      .all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('session_id');
    expect(names).toContain('label');
    expect(names).toContain('trigger');
    expect(names).toContain('schema_version');
    expect(names).toContain('data');
    expect(names).toContain('created_at');
  });
});
