import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from './sqlite-index.js';

const WorkflowRunStatus = {
  Queued: 'queued',
  Running: 'running',
} as const;

type WorkflowRun = {
  id: string;
  workflowType: string;
  projectId: string;
  entityType: string;
  entityId?: string;
  triggerSource: string;
  status: string;
  summary: string;
  progress: number;
  completedStages: number;
  totalStages: number;
  completedTasks: number;
  totalTasks: number;
  currentStageId?: string;
  currentTaskId?: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-runs-'));
}

describe('workflow run storage api', () => {
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

  it('inserts, gets, lists, and updates workflow runs', () => {
    const run: WorkflowRun = {
      id: 'wf-1',
      workflowType: 'storyboard.generate',
      projectId: 'project-1',
      entityType: 'scene',
      entityId: 'scene-1',
      triggerSource: 'user',
      status: WorkflowRunStatus.Queued,
      summary: 'queued',
      progress: 0,
      completedStages: 0,
      totalStages: 3,
      completedTasks: 0,
      totalTasks: 8,
      currentStageId: 'validate',
      currentTaskId: 'task-1',
      input: { sceneIds: ['scene-1'] },
      output: {},
      metadata: { source: 'test' },
      createdAt: 1,
      updatedAt: 1,
    };

    db.insertWorkflowRun(run);

    const fetched = db.getWorkflowRun(run.id);
    expect(fetched).toEqual(run);

    const listed = db.listWorkflowRuns({ projectId: 'project-1' });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(run);

    db.updateWorkflowRun(run.id, {
      status: WorkflowRunStatus.Running,
      progress: 25,
      summary: 'running',
      currentTaskId: 'task-2',
      output: { started: true },
      updatedAt: 2,
    });

    const updated = db.getWorkflowRun(run.id);
    expect(updated).toMatchObject({
      id: 'wf-1',
      status: WorkflowRunStatus.Running,
      progress: 25,
      summary: 'running',
      currentTaskId: 'task-2',
      output: { started: true },
      updatedAt: 2,
    });
  });
});
