import {
  StageRunStatus,
  TaskRunStatus,
  WorkflowRunStatus,
  type WorkflowStageRun,
  type WorkflowTaskRun,
  type WorkflowRun,
} from '@lucid-fin/contracts';
import type {
  RegisteredWorkflowDefinition,
  RegisteredWorkflowStageDefinition,
  RegisteredWorkflowTaskDefinition,
} from './workflow-registry.js';

export interface WorkflowTaskDependencyRow {
  taskRunId: string;
  dependsOnTaskRunId: string;
}

export interface WorkflowPlanRequest {
  definition: RegisteredWorkflowDefinition;
  entityType: string;
  entityId?: string;
  triggerSource?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  now?: number;
  idFactory?: () => string;
}

export interface PlannedWorkflowRows {
  workflowRun: WorkflowRun;
  stageRuns: WorkflowStageRun[];
  taskRuns: WorkflowTaskRun[];
  taskDependencies: WorkflowTaskDependencyRow[];
}

type PlannedStage = {
  definition: RegisteredWorkflowStageDefinition;
  run: WorkflowStageRun;
};

type PlannedTask = {
  definition: RegisteredWorkflowTaskDefinition;
  run: WorkflowTaskRun;
};

export class WorkflowPlanner {
  plan(request: WorkflowPlanRequest): PlannedWorkflowRows {
    const now = request.now ?? Date.now();
    const nextId = request.idFactory ?? (() => crypto.randomUUID());
    const sortedStages = [...request.definition.stages].sort(
      (left, right) => left.order - right.order,
    );
    const stageIds = new Set(sortedStages.map((stage) => stage.id));
    const taskDefinitions = sortedStages.flatMap((stage) => stage.tasks);
    const taskIds = new Set(taskDefinitions.map((task) => task.id));

    for (const stage of sortedStages) {
      for (const dependsOnStageId of stage.dependsOnStageIds ?? []) {
        if (!stageIds.has(dependsOnStageId)) {
          throw new Error(
            `Unknown stage dependency "${dependsOnStageId}" in workflow ${request.definition.id}`,
          );
        }
      }
    }

    for (const task of taskDefinitions) {
      for (const dependsOnTaskId of task.dependsOnTaskIds ?? []) {
        if (!taskIds.has(dependsOnTaskId)) {
          throw new Error(
            `Unknown task dependency "${dependsOnTaskId}" in workflow ${request.definition.id}`,
          );
        }
      }
    }

    // Detect circular dependencies in both stage and task graphs
    this.detectCycles(
      sortedStages.map((s) => ({ id: s.id, dependsOn: s.dependsOnStageIds ?? [] })),
      'stage',
    );
    this.detectCycles(
      taskDefinitions.map((t) => ({ id: t.id, dependsOn: t.dependsOnTaskIds ?? [] })),
      'task',
    );

    const workflowRunId = nextId();
    const plannedStages: PlannedStage[] = [];
    const plannedTasks: PlannedTask[] = [];
    const taskRunIds = new Map<string, string>();
    const workflowRelatedEntityLabel =
      this.pickString(request.metadata, 'relatedEntityLabel') ??
      request.definition.relatedEntityLabel;

    for (const stage of sortedStages) {
      const stageStatus =
        (stage.dependsOnStageIds?.length ?? 0) > 0 ? StageRunStatus.Blocked : StageRunStatus.Ready;
      const stageRunId = nextId();
      const stageRun: WorkflowStageRun = {
        id: stageRunId,
        workflowRunId,
        stageId: stage.id,
        name: stage.name,
        status: stageStatus,
        order: stage.order,
        progress: 0,
        completedTasks: 0,
        totalTasks: stage.tasks.length,
        metadata: {
          dependsOnStageIds: stage.dependsOnStageIds ?? [],
          allowPartialSuccess: stage.allowPartialSuccess ?? false,
          requiredForCompletion: stage.requiredForCompletion ?? true,
        },
        updatedAt: now,
      };

      plannedStages.push({ definition: stage, run: stageRun });

      for (const task of stage.tasks) {
        const provider = task.providerHint ?? request.definition.provider;
        const taskStatus =
          stageStatus === StageRunStatus.Ready && (task.dependsOnTaskIds?.length ?? 0) === 0
            ? TaskRunStatus.Ready
            : TaskRunStatus.Blocked;
        const taskRunId = nextId();
        const taskRun: WorkflowTaskRun = {
          id: taskRunId,
          workflowRunId,
          stageRunId,
          taskId: task.id,
          name: task.name,
          kind: task.kind,
          status: taskStatus,
          provider,
          dependencyIds: [],
          attempts: 0,
          maxRetries: task.maxRetries,
          input: {
            ...(request.input ?? {}),
            ...(task.inputBinding ?? {}),
            handlerId: task.handlerId,
            workflowType: request.definition.id,
            stageId: stage.id,
            displayCategory: task.displayCategory,
            displayLabel: task.displayLabel,
            relatedEntityType: task.relatedEntityType ?? request.entityType,
            relatedEntityId: task.relatedEntityId ?? request.entityId,
            relatedEntityLabel: task.relatedEntityLabel ?? workflowRelatedEntityLabel,
            provider,
            modelKey: task.modelKey ?? request.definition.modelKey,
            promptTemplateId: task.promptTemplateId ?? request.definition.promptTemplateId,
            promptTemplateVersion:
              task.promptTemplateVersion ?? request.definition.promptTemplateVersion,
            summary: task.summary,
          },
          output: {},
          progress: 0,
          updatedAt: now,
        };

        plannedTasks.push({ definition: task, run: taskRun });
        taskRunIds.set(task.id, taskRunId);
      }
    }

    const taskDependencies: WorkflowTaskDependencyRow[] = [];
    for (const plannedTask of plannedTasks) {
      const dependencyIds = (plannedTask.definition.dependsOnTaskIds ?? []).map(
        (dependsOnTaskId) => {
          const dependencyRunId = taskRunIds.get(dependsOnTaskId);
          if (!dependencyRunId) {
            throw new Error(
              `Missing planned dependency "${dependsOnTaskId}" in workflow ${request.definition.id}`,
            );
          }
          taskDependencies.push({
            taskRunId: plannedTask.run.id,
            dependsOnTaskRunId: dependencyRunId,
          });
          return dependencyRunId;
        },
      );

      plannedTask.run.dependencyIds = dependencyIds;
    }

    const stageRuns = plannedStages.map((stage) => stage.run);
    const taskRuns = plannedTasks.map((task) => task.run);
    const firstReadyStage = stageRuns.find((stage) => stage.status === StageRunStatus.Ready);
    const firstReadyTask = taskRuns.find((task) => task.status === TaskRunStatus.Ready);
    const workflowStatus = firstReadyTask
      ? WorkflowRunStatus.Ready
      : taskRuns.some((task) => task.status === TaskRunStatus.Blocked)
        ? WorkflowRunStatus.Blocked
        : WorkflowRunStatus.Pending;

    const workflowRun: WorkflowRun = {
      id: workflowRunId,
      workflowType: request.definition.id,
      entityType: request.entityType,
      entityId: request.entityId,
      triggerSource: request.triggerSource ?? 'user',
      status: workflowStatus,
      summary: request.definition.displayLabel,
      progress: 0,
      completedStages: 0,
      totalStages: stageRuns.length,
      completedTasks: 0,
      totalTasks: taskRuns.length,
      currentStageId: firstReadyStage?.id,
      currentTaskId: firstReadyTask?.id,
      input: request.input ?? {},
      output: {},
      metadata: {
        ...(request.metadata ?? {}),
        displayCategory: request.definition.displayCategory,
        displayLabel: request.definition.displayLabel,
        relatedEntityLabel: workflowRelatedEntityLabel,
        provider: request.definition.provider,
        modelKey: request.definition.modelKey,
        promptTemplateId: request.definition.promptTemplateId,
        promptTemplateVersion: request.definition.promptTemplateVersion,
        summary: request.definition.summary,
      },
      createdAt: now,
      updatedAt: now,
    };

    return {
      workflowRun,
      stageRuns,
      taskRuns,
      taskDependencies,
    };
  }

  /**
   * DFS-based cycle detection on a dependency graph.
   * Throws with the cycle path if a back edge is found.
   */
  private detectCycles(
    nodes: Array<{ id: string; dependsOn: string[] }>,
    label: string,
  ): void {
    const visited = new Set<string>();
    const stack = new Set<string>();
    const adjacency = new Map<string, string[]>();
    for (const node of nodes) {
      adjacency.set(node.id, node.dependsOn);
    }

    const dfs = (id: string, path: string[]): void => {
      if (stack.has(id)) {
        const cycleStart = path.indexOf(id);
        const cycle = path.slice(cycleStart).concat(id);
        throw new Error(
          `Circular ${label} dependency: ${cycle.join(' \u2192 ')}`,
        );
      }
      if (visited.has(id)) return;
      visited.add(id);
      stack.add(id);
      for (const dep of adjacency.get(id) ?? []) {
        dfs(dep, [...path, id]);
      }
      stack.delete(id);
    };

    for (const node of nodes) {
      if (!visited.has(node.id)) dfs(node.id, []);
    }
  }

  private pickString(record: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = record?.[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
