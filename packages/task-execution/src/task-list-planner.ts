import { TaskListStatus, TaskStatus, type Task, type TaskList } from '@lucid-fin/contracts';
import type { RegisteredTaskBlueprint, RegisteredTaskListBlueprint } from './task-list-registry.js';

export interface TaskListPlanRequest {
  definition: RegisteredTaskListBlueprint;
  entityType: string;
  entityId?: string;
  triggerSource?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  now?: number;
  idFactory?: () => string;
}

export interface PlannedTaskListRows {
  taskList: TaskList;
  tasks: Task[];
}

interface PlannedTask {
  definition: RegisteredTaskBlueprint;
  task: Task;
}

export class TaskListPlanner {
  plan(request: TaskListPlanRequest): PlannedTaskListRows {
    const now = request.now ?? Date.now();
    const nextId = request.idFactory ?? (() => crypto.randomUUID());
    const taskDefinitions = [...request.definition.tasks].sort(
      (left, right) => left.phaseOrder - right.phaseOrder,
    );
    const blueprintIds = new Set<string>();
    const phaseOrders = new Map<string, number>();

    for (const task of taskDefinitions) {
      if (blueprintIds.has(task.id)) {
        throw new Error(
          `Duplicate task blueprint "${task.id}" in task list ${request.definition.id}`,
        );
      }
      blueprintIds.add(task.id);
      const existingOrder = phaseOrders.get(task.phaseKey);
      if (existingOrder !== undefined && existingOrder !== task.phaseOrder) {
        throw new Error(
          `Phase "${task.phaseKey}" has conflicting orders in task list ${request.definition.id}`,
        );
      }
      phaseOrders.set(task.phaseKey, task.phaseOrder);
    }

    for (const task of taskDefinitions) {
      for (const dependencyId of task.dependsOnTaskIds ?? []) {
        if (!blueprintIds.has(dependencyId)) {
          throw new Error(
            `Unknown task dependency "${dependencyId}" in task list ${request.definition.id}`,
          );
        }
      }
    }
    this.detectCycles(
      taskDefinitions.map((task) => ({ id: task.id, dependsOn: task.dependsOnTaskIds ?? [] })),
    );

    const taskListId = nextId();
    const runtimeTaskIds = new Map<string, string>();
    const relatedEntityLabel =
      this.pickString(request.metadata, 'relatedEntityLabel') ??
      request.definition.relatedEntityLabel;
    const plannedTasks: PlannedTask[] = taskDefinitions.map((definition) => {
      const id = nextId();
      runtimeTaskIds.set(definition.id, id);
      const provider = definition.providerHint ?? request.definition.provider;
      return {
        definition,
        task: {
          id,
          taskListId,
          phaseKey: definition.phaseKey,
          phaseName: definition.phaseName,
          phaseOrder: definition.phaseOrder,
          taskKey: definition.id,
          name: definition.name,
          kind: definition.kind,
          status:
            (definition.dependsOnTaskIds?.length ?? 0) === 0
              ? TaskStatus.Ready
              : TaskStatus.Blocked,
          provider,
          dependencyIds: [],
          attempts: 0,
          maxRetries: definition.maxRetries,
          input: {
            ...(request.input ?? {}),
            ...(definition.inputBinding ?? {}),
            handlerId: definition.handlerId,
            taskListType: request.definition.id,
            phaseKey: definition.phaseKey,
            displayCategory: definition.displayCategory,
            displayLabel: definition.displayLabel,
            displayLabelKey: definition.displayLabelKey,
            relatedEntityType: definition.relatedEntityType ?? request.entityType,
            relatedEntityId: definition.relatedEntityId ?? request.entityId,
            relatedEntityLabel: definition.relatedEntityLabel ?? relatedEntityLabel,
            provider,
            modelKey: definition.modelKey ?? request.definition.modelKey,
            promptTemplateId: definition.promptTemplateId ?? request.definition.promptTemplateId,
            promptTemplateVersion:
              definition.promptTemplateVersion ?? request.definition.promptTemplateVersion,
            summary: definition.summary,
          },
          output: {},
          progress: 0,
          updatedAt: now,
        },
      };
    });

    for (const planned of plannedTasks) {
      planned.task.dependencyIds = (planned.definition.dependsOnTaskIds ?? []).map(
        (dependencyBlueprintId) => {
          const dependencyId = runtimeTaskIds.get(dependencyBlueprintId);
          if (!dependencyId) {
            throw new Error(
              `Missing planned dependency "${dependencyBlueprintId}" in task list ${request.definition.id}`,
            );
          }
          return dependencyId;
        },
      );
    }

    const tasks = plannedTasks.map(({ task }) => task);
    const firstReadyTask = tasks.find((task) => task.status === TaskStatus.Ready);
    const taskList: TaskList = {
      id: taskListId,
      taskListType: request.definition.id,
      entityType: request.entityType,
      entityId: request.entityId,
      triggerSource: request.triggerSource ?? 'user',
      status: firstReadyTask
        ? TaskListStatus.Ready
        : tasks.some((task) => task.status === TaskStatus.Blocked)
          ? TaskListStatus.Blocked
          : TaskListStatus.Pending,
      summary: request.definition.displayLabel,
      progress: 0,
      completedPhases: 0,
      totalPhases: phaseOrders.size,
      completedTasks: 0,
      totalTasks: tasks.length,
      currentPhaseKey: firstReadyTask?.phaseKey,
      currentTaskId: firstReadyTask?.id,
      input: request.input ?? {},
      output: {},
      metadata: {
        ...(request.metadata ?? {}),
        displayCategory: request.definition.displayCategory,
        displayLabel: request.definition.displayLabel,
        displayLabelKey: request.definition.displayLabelKey,
        relatedEntityLabel,
        provider: request.definition.provider,
        modelKey: request.definition.modelKey,
        promptTemplateId: request.definition.promptTemplateId,
        promptTemplateVersion: request.definition.promptTemplateVersion,
        summary: request.definition.summary,
      },
      createdAt: now,
      updatedAt: now,
    };

    return { taskList, tasks };
  }

  private detectCycles(nodes: Array<{ id: string; dependsOn: string[] }>): void {
    const state = new Map<string, 'visiting' | 'done'>();
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    const dependencies = new Map(nodes.map((node) => [node.id, node.dependsOn]));

    const visit = (id: string): void => {
      const currentState = state.get(id);
      if (currentState === 'visiting') {
        const cycleStart = pathIndex.get(id) ?? 0;
        throw new Error(
          `Circular task dependency: ${path.slice(cycleStart).concat(id).join(' → ')}`,
        );
      }
      if (currentState === 'done') return;

      state.set(id, 'visiting');
      pathIndex.set(id, path.length);
      path.push(id);
      for (const dependencyId of dependencies.get(id) ?? []) visit(dependencyId);
      path.pop();
      pathIndex.delete(id);
      state.set(id, 'done');
    };

    for (const node of nodes) visit(node.id);
  }

  private pickString(record: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = record?.[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
