import { describe, expect, it } from 'vitest';
import { StageRunStatus, TaskKind, TaskRunStatus, WorkflowRunStatus } from '@lucid-fin/contracts';
import { WorkflowPlanner } from './workflow-planner.js';
import type { RegisteredWorkflowDefinition } from './workflow-registry.js';

function makeIdFactory(ids: string[]) {
  return () => {
    const next = ids.shift();
    if (!next) {
      throw new Error('id factory exhausted');
    }
    return next;
  };
}

describe('WorkflowPlanner', () => {
  it('expands a registered workflow into workflow, stage, task, and dependency rows with content linkage', () => {
    const planner = new WorkflowPlanner();
    const definition: RegisteredWorkflowDefinition = {
      id: 'storyboard.generate',
      name: 'Generate storyboard',
      version: 1,
      kind: 'storyboard.generate',
      description: 'Generate a storyboard for a scene',
      displayCategory: 'Storyboard',
      displayLabel: 'Generate storyboard',
      relatedEntityLabel: 'Opening Scene',
      modelKey: 'workflow-model',
      promptTemplateId: 'workflow-template',
      promptTemplateVersion: '1.0.0',
      stages: [
        {
          id: 'prepare',
          name: 'Prepare',
          order: 0,
          tasks: [
            {
              id: 'draft-frames',
              name: 'Draft frames',
              kind: TaskKind.AdapterGeneration,
              handlerId: 'storyboard.draft',
              maxRetries: 2,
              providerHint: 'fal',
              displayCategory: 'Storyboard',
              displayLabel: 'Draft frames',
              modelKey: 'flux-dev',
              promptTemplateId: 'storyboard-draft',
              promptTemplateVersion: '2.0.0',
              summary: 'Generate draft storyboard frames',
            },
            {
              id: 'refine-frames',
              name: 'Refine frames',
              kind: TaskKind.Transform,
              handlerId: 'storyboard.refine',
              maxRetries: 2,
              dependsOnTaskIds: ['draft-frames'],
              providerHint: 'fal',
              displayCategory: 'Storyboard',
              displayLabel: 'Refine frames',
              modelKey: 'flux-pro',
              promptTemplateId: 'storyboard-refine',
              promptTemplateVersion: '2.1.0',
              summary: 'Refine selected storyboard frames',
            },
          ],
        },
        {
          id: 'render',
          name: 'Render',
          order: 1,
          dependsOnStageIds: ['prepare'],
          tasks: [
            {
              id: 'render-frames',
              name: 'Render frames',
              kind: TaskKind.Export,
              handlerId: 'storyboard.render',
              maxRetries: 1,
              displayCategory: 'Render',
              displayLabel: 'Render final frames',
              summary: 'Render production storyboard frames',
            },
          ],
        },
      ],
    };

    const planned = planner.plan({
      definition,
      entityType: 'scene',
      entityId: 'scene-1',
      triggerSource: 'user',
      input: { aspectRatio: '16:9' },
      metadata: { relatedEntityLabel: 'Opening Scene Override' },
      now: 1000,
      idFactory: makeIdFactory(['wf-1', 'stage-1', 'task-1', 'task-2', 'stage-2', 'task-3']),
    });

    expect(planned.workflowRun).toMatchObject({
      id: 'wf-1',
      workflowType: 'storyboard.generate',
      entityType: 'scene',
      entityId: 'scene-1',
      triggerSource: 'user',
      status: WorkflowRunStatus.Ready,
      currentStageId: 'stage-1',
      currentTaskId: 'task-1',
      summary: 'Generate storyboard',
      progress: 0,
      completedStages: 0,
      totalStages: 2,
      completedTasks: 0,
      totalTasks: 3,
      metadata: expect.objectContaining({
        displayCategory: 'Storyboard',
        displayLabel: 'Generate storyboard',
        relatedEntityLabel: 'Opening Scene Override',
        modelKey: 'workflow-model',
        promptTemplateId: 'workflow-template',
        promptTemplateVersion: '1.0.0',
      }),
      createdAt: 1000,
      updatedAt: 1000,
    });

    expect(planned.stageRuns).toEqual([
      {
        id: 'stage-1',
        workflowRunId: 'wf-1',
        stageId: 'prepare',
        name: 'Prepare',
        status: StageRunStatus.Ready,
        order: 0,
        progress: 0,
        completedTasks: 0,
        totalTasks: 2,
        metadata: {
          dependsOnStageIds: [],
          allowPartialSuccess: false,
          requiredForCompletion: true,
        },
        updatedAt: 1000,
      },
      {
        id: 'stage-2',
        workflowRunId: 'wf-1',
        stageId: 'render',
        name: 'Render',
        status: StageRunStatus.Blocked,
        order: 1,
        progress: 0,
        completedTasks: 0,
        totalTasks: 1,
        metadata: {
          dependsOnStageIds: ['prepare'],
          allowPartialSuccess: false,
          requiredForCompletion: true,
        },
        updatedAt: 1000,
      },
    ]);

    expect(planned.taskRuns).toEqual([
      expect.objectContaining({
        id: 'task-1',
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
        input: expect.objectContaining({
          aspectRatio: '16:9',
          handlerId: 'storyboard.draft',
          displayCategory: 'Storyboard',
          displayLabel: 'Draft frames',
          relatedEntityType: 'scene',
          relatedEntityId: 'scene-1',
          relatedEntityLabel: 'Opening Scene Override',
          provider: 'fal',
          modelKey: 'flux-dev',
          promptTemplateId: 'storyboard-draft',
          promptTemplateVersion: '2.0.0',
          summary: 'Generate draft storyboard frames',
        }),
        progress: 0,
        updatedAt: 1000,
      }),
      expect.objectContaining({
        id: 'task-2',
        workflowRunId: 'wf-1',
        stageRunId: 'stage-1',
        taskId: 'refine-frames',
        status: TaskRunStatus.Blocked,
        provider: 'fal',
        dependencyIds: ['task-1'],
      }),
      expect.objectContaining({
        id: 'task-3',
        workflowRunId: 'wf-1',
        stageRunId: 'stage-2',
        taskId: 'render-frames',
        status: TaskRunStatus.Blocked,
        dependencyIds: [],
        input: expect.objectContaining({
          displayCategory: 'Render',
          displayLabel: 'Render final frames',
          relatedEntityType: 'scene',
          relatedEntityId: 'scene-1',
          relatedEntityLabel: 'Opening Scene Override',
          modelKey: 'workflow-model',
          promptTemplateId: 'workflow-template',
          promptTemplateVersion: '1.0.0',
        }),
      }),
    ]);

    expect(planned.taskDependencies).toEqual([
      { taskRunId: 'task-2', dependsOnTaskRunId: 'task-1' },
    ]);
  });

  describe('cycle detection', () => {
    it('throws on a simple stage cycle (A → B → A)', () => {
      const planner = new WorkflowPlanner();
      const definition: RegisteredWorkflowDefinition = {
        id: 'cycle-test',
        name: 'Cycle test',
        version: 1,
        kind: 'test',
        description: 'test',
        displayCategory: 'Test',
        displayLabel: 'Cycle test',
        stages: [
          {
            id: 'stage-a',
            name: 'A',
            order: 0,
            dependsOnStageIds: ['stage-b'],
            tasks: [],
          },
          {
            id: 'stage-b',
            name: 'B',
            order: 1,
            dependsOnStageIds: ['stage-a'],
            tasks: [],
          },
        ],
      };

      expect(() =>
        planner.plan({
          definition,
          entityType: 'scene',
          now: 1000,
          idFactory: makeIdFactory(['wf-1', 's-1', 's-2']),
        }),
      ).toThrow(/Circular stage dependency.*stage-a.*stage-b.*stage-a/);
    });

    it('throws on a longer stage cycle (A → B → C → A)', () => {
      const planner = new WorkflowPlanner();
      const definition: RegisteredWorkflowDefinition = {
        id: 'cycle-test-3',
        name: 'Cycle test 3',
        version: 1,
        kind: 'test',
        description: 'test',
        displayCategory: 'Test',
        displayLabel: 'Cycle test 3',
        stages: [
          {
            id: 'stage-a',
            name: 'A',
            order: 0,
            dependsOnStageIds: ['stage-c'],
            tasks: [],
          },
          {
            id: 'stage-b',
            name: 'B',
            order: 1,
            dependsOnStageIds: ['stage-a'],
            tasks: [],
          },
          {
            id: 'stage-c',
            name: 'C',
            order: 2,
            dependsOnStageIds: ['stage-b'],
            tasks: [],
          },
        ],
      };

      expect(() =>
        planner.plan({
          definition,
          entityType: 'scene',
          now: 1000,
          idFactory: makeIdFactory(['wf-1', 's-1', 's-2', 's-3']),
        }),
      ).toThrow(/Circular stage dependency/);
    });

    it('throws on a task cycle (A → B → A)', () => {
      const planner = new WorkflowPlanner();
      const definition: RegisteredWorkflowDefinition = {
        id: 'task-cycle',
        name: 'Task cycle',
        version: 1,
        kind: 'test',
        description: 'test',
        displayCategory: 'Test',
        displayLabel: 'Task cycle',
        stages: [
          {
            id: 'stage-1',
            name: 'Stage 1',
            order: 0,
            tasks: [
              {
                id: 'task-a',
                name: 'A',
                kind: TaskKind.Transform,
                handlerId: 'test',
                maxRetries: 0,
                dependsOnTaskIds: ['task-b'],
                displayCategory: 'Test',
                displayLabel: 'A',
              },
              {
                id: 'task-b',
                name: 'B',
                kind: TaskKind.Transform,
                handlerId: 'test',
                maxRetries: 0,
                dependsOnTaskIds: ['task-a'],
                displayCategory: 'Test',
                displayLabel: 'B',
              },
            ],
          },
        ],
      };

      expect(() =>
        planner.plan({
          definition,
          entityType: 'scene',
          now: 1000,
          idFactory: makeIdFactory(['wf-1', 's-1', 't-1', 't-2']),
        }),
      ).toThrow(/Circular task dependency.*task-a.*task-b.*task-a/);
    });

    it('accepts valid DAG workflows without throwing', () => {
      const planner = new WorkflowPlanner();
      const definition: RegisteredWorkflowDefinition = {
        id: 'valid-dag',
        name: 'Valid DAG',
        version: 1,
        kind: 'test',
        description: 'test',
        displayCategory: 'Test',
        displayLabel: 'Valid DAG',
        stages: [
          {
            id: 'stage-1',
            name: 'Stage 1',
            order: 0,
            tasks: [
              {
                id: 'task-a',
                name: 'A',
                kind: TaskKind.Transform,
                handlerId: 'test',
                maxRetries: 0,
                displayCategory: 'Test',
                displayLabel: 'A',
              },
              {
                id: 'task-b',
                name: 'B',
                kind: TaskKind.Transform,
                handlerId: 'test',
                maxRetries: 0,
                dependsOnTaskIds: ['task-a'],
                displayCategory: 'Test',
                displayLabel: 'B',
              },
              {
                id: 'task-c',
                name: 'C',
                kind: TaskKind.Transform,
                handlerId: 'test',
                maxRetries: 0,
                dependsOnTaskIds: ['task-a'],
                displayCategory: 'Test',
                displayLabel: 'C',
              },
            ],
          },
          {
            id: 'stage-2',
            name: 'Stage 2',
            order: 1,
            dependsOnStageIds: ['stage-1'],
            tasks: [
              {
                id: 'task-d',
                name: 'D',
                kind: TaskKind.Transform,
                handlerId: 'test',
                maxRetries: 0,
                displayCategory: 'Test',
                displayLabel: 'D',
              },
            ],
          },
        ],
      };

      expect(() =>
        planner.plan({
          definition,
          entityType: 'scene',
          now: 1000,
          idFactory: makeIdFactory(['wf-1', 's-1', 't-1', 't-2', 't-3', 's-2', 't-4']),
        }),
      ).not.toThrow();
    });
  });
});
