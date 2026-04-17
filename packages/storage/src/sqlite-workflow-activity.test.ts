import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkflowTaskSummary } from '@lucid-fin/contracts';
import { StageRunStatus, TaskKind, TaskRunStatus, WorkflowRunStatus } from '@lucid-fin/contracts';
import { SqliteIndex } from './sqlite-index.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-activity-'));
}

describe('workflow activity projections', () => {
  let db: SqliteIndex;
  let base: string;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('builds renderer-facing task summaries with workflow context, filters, and produced artifacts', () => {
    db.repos.workflows.insertRun({
      id: 'wf-1',
      workflowType: 'storyboard.generate',
      entityType: 'scene',
      entityId: 'scene-1',
      triggerSource: 'user',
      status: WorkflowRunStatus.Running,
      summary: 'running',
      progress: 50,
      completedStages: 0,
      totalStages: 1,
      completedTasks: 0,
      totalTasks: 2,
      currentStageId: 'stage-1',
      currentTaskId: 'task-newer',
      input: {},
      output: {},
      metadata: {
        displayCategory: 'Storyboard',
        displayLabel: 'Generate storyboard',
        relatedEntityLabel: 'Opening Scene',
        modelKey: 'workflow-model',
        promptTemplateId: 'workflow-template',
        promptTemplateVersion: '1.0.0',
      },
      createdAt: 1,
      updatedAt: 1,
    });
    db.repos.workflows.insertRun({
      id: 'wf-2',
      workflowType: 'style.extract',
      entityType: 'asset',
      entityId: 'asset-1',
      triggerSource: 'system',
      status: WorkflowRunStatus.Completed,
      summary: 'completed',
      progress: 100,
      completedStages: 1,
      totalStages: 1,
      completedTasks: 1,
      totalTasks: 1,
      input: {},
      output: {},
      metadata: {
        displayCategory: 'Style',
        displayLabel: 'Extract style',
        relatedEntityLabel: 'Reference Image',
      },
      createdAt: 2,
      updatedAt: 2,
    });

    db.repos.workflows.insertStageRun({
      id: 'stage-1',
      workflowRunId: 'wf-1',
      stageId: 'render',
      name: 'Render',
      status: StageRunStatus.Running,
      order: 0,
      progress: 50,
      completedTasks: 0,
      totalTasks: 2,
      metadata: {},
      updatedAt: 10,
    });
    db.repos.workflows.insertStageRun({
      id: 'stage-2',
      workflowRunId: 'wf-2',
      stageId: 'extract',
      name: 'Extract',
      status: StageRunStatus.Completed,
      order: 0,
      progress: 100,
      completedTasks: 1,
      totalTasks: 1,
      metadata: {},
      updatedAt: 20,
    });

    db.repos.workflows.insertTaskRun({
      id: 'task-older',
      workflowRunId: 'wf-1',
      stageRunId: 'stage-1',
      taskId: 'draft-frames',
      name: 'Draft frames',
      kind: TaskKind.AdapterGeneration,
      status: TaskRunStatus.Ready,
      provider: 'fal',
      dependencyIds: [],
      attempts: 0,
      maxRetries: 2,
      input: {
        displayCategory: 'Storyboard',
        displayLabel: 'Draft frames',
        relatedEntityLabel: 'Opening Scene',
        modelKey: 'flux-dev',
        promptTemplateId: 'storyboard-frames',
        promptTemplateVersion: '2.1.0',
        summary: 'Draft widescreen storyboard frames',
      },
      output: {},
      progress: 0,
      updatedAt: 100,
    });
    db.repos.workflows.insertTaskRun({
      id: 'task-newer',
      workflowRunId: 'wf-1',
      stageRunId: 'stage-1',
      taskId: 'render-final',
      name: 'Render final frames',
      kind: TaskKind.Export,
      status: TaskRunStatus.Running,
      provider: 'runway',
      dependencyIds: ['task-older'],
      attempts: 1,
      maxRetries: 2,
      input: {
        displayCategory: 'Render',
        displayLabel: 'Render final frames',
        relatedEntityLabel: 'Opening Scene',
        modelKey: 'gen4',
        promptTemplateId: 'storyboard-render',
        promptTemplateVersion: '3.0.0',
        summary: 'Render production frames',
      },
      output: {},
      progress: 40,
      currentStep: 'rendering',
      updatedAt: 200,
    });
    db.repos.workflows.insertTaskRun({
      id: 'task-other-project',
      workflowRunId: 'wf-2',
      stageRunId: 'stage-2',
      taskId: 'extract-style',
      name: 'Extract style',
      kind: TaskKind.MetadataExtract,
      status: TaskRunStatus.Completed,
      dependencyIds: [],
      attempts: 1,
      maxRetries: 1,
      input: {
        displayCategory: 'Style',
        displayLabel: 'Extract style',
      },
      output: {},
      progress: 100,
      updatedAt: 150,
    });

    db.repos.workflows.insertArtifact({
      id: 'artifact-1',
      workflowRunId: 'wf-1',
      taskRunId: 'task-newer',
      artifactType: 'image',
      entityType: 'scene',
      entityId: 'scene-1',
      assetHash: 'asset-1',
      path: 'artifacts/render-final.png',
      metadata: { role: 'preview' },
      createdAt: 300,
    });

    expect(db.repos.workflows.listTaskSummaries({ workflowRunId: 'wf-1' })).toEqual([
      {
        id: 'task-newer',
        workflowRunId: 'wf-1',
        stageRunId: 'stage-1',
        taskId: 'render-final',
        stageId: 'render',
        name: 'Render final frames',
        kind: TaskKind.Export,
        status: TaskRunStatus.Running,
        progress: 40,
        currentStep: 'rendering',
        displayCategory: 'Render',
        displayLabel: 'Render final frames',
        relatedEntityType: 'scene',
        relatedEntityId: 'scene-1',
        relatedEntityLabel: 'Opening Scene',
        provider: 'runway',
        modelKey: 'gen4',
        promptTemplateId: 'storyboard-render',
        promptTemplateVersion: '3.0.0',
        summary: 'Render production frames',
        attempts: 1,
        maxRetries: 2,
        updatedAt: 200,
        producedArtifacts: [
          {
            id: 'artifact-1',
            artifactType: 'image',
            entityType: 'scene',
            entityId: 'scene-1',
            assetHash: 'asset-1',
            path: 'artifacts/render-final.png',
            createdAt: 300,
          },
        ],
      },
      {
        id: 'task-older',
        workflowRunId: 'wf-1',
        stageRunId: 'stage-1',
        taskId: 'draft-frames',
        stageId: 'render',
        name: 'Draft frames',
        kind: TaskKind.AdapterGeneration,
        status: TaskRunStatus.Ready,
        progress: 0,
        displayCategory: 'Storyboard',
        displayLabel: 'Draft frames',
        relatedEntityType: 'scene',
        relatedEntityId: 'scene-1',
        relatedEntityLabel: 'Opening Scene',
        provider: 'fal',
        modelKey: 'flux-dev',
        promptTemplateId: 'storyboard-frames',
        promptTemplateVersion: '2.1.0',
        summary: 'Draft widescreen storyboard frames',
        attempts: 0,
        maxRetries: 2,
        updatedAt: 100,
        producedArtifacts: [],
      },
    ]);

    expect(
      db.repos.workflows.listTaskSummaries({
        workflowRunId: 'wf-1',
        status: TaskRunStatus.Running,
        limit: 1,
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'task-newer',
        status: TaskRunStatus.Running,
      }),
    ]);
  });
});
