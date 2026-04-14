import {
  TaskRunStatus,
  type WorkflowRun,
  type WorkflowStageRun,
  type WorkflowTaskRun,
} from '@lucid-fin/contracts';
import type { IStorageLayer } from '@lucid-fin/storage';
import type { WorkflowTaskExecutionResult, WorkflowTaskHandler } from './task-handler.js';
import { WorkflowPlanner } from './workflow-planner.js';
import type { WorkflowRegistry } from './workflow-registry.js';

export interface WorkflowStartRequest {
  workflowType: string;
  entityType: string;
  entityId?: string;
  triggerSource?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface WorkflowEngineOptions {
  db: IStorageLayer;
  registry: WorkflowRegistry;
  handlers: WorkflowTaskHandler[];
  planner?: WorkflowPlanner;
  idFactory?: () => string;
  now?: () => number;
  maxConcurrentTasks?: number;
}

type WorkflowStateRecord = {
  workflowRun: WorkflowRun;
  stageRun: WorkflowStageRun;
  taskRun: WorkflowTaskRun;
};

const TASK_SUCCESS_STATUSES = new Set<WorkflowTaskRun['status']>([
  TaskRunStatus.Completed,
  TaskRunStatus.Skipped,
]);

const TASK_TERMINAL_STATUSES = new Set<WorkflowTaskRun['status']>([
  TaskRunStatus.Completed,
  TaskRunStatus.Skipped,
  TaskRunStatus.Failed,
  TaskRunStatus.RetryableFailed,
  TaskRunStatus.Cancelled,
]);

export class WorkflowEngine {
  private readonly planner: WorkflowPlanner;
  private readonly handlers = new Map<string, WorkflowTaskHandler>();
  private readonly now: () => number;
  private readonly idFactory?: () => string;
  private autoPump: Promise<number> | undefined;
  private tick = 0;
  private readonly maxConcurrentTasks: number;
  private activeTasks = 0;

  constructor(private readonly options: WorkflowEngineOptions) {
    this.planner = options.planner ?? new WorkflowPlanner();
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory;

    for (const handler of options.handlers) {
      this.handlers.set(handler.id, handler);
    }

    this.maxConcurrentTasks = options.maxConcurrentTasks ?? 5;
  }

  start(request: WorkflowStartRequest): string {
    const definition = this.options.registry.get(request.workflowType);
    if (!definition) {
      throw new Error(`Workflow "${request.workflowType}" is not registered`);
    }

    const planned = this.planner.plan({
      definition,
      entityType: request.entityType,
      entityId: request.entityId,
      triggerSource: request.triggerSource,
      input: request.input,
      metadata: request.metadata,
      now: this.nextTimestamp(),
      idFactory: this.idFactory,
    });

    this.options.db.insertWorkflowRun(planned.workflowRun);
    for (const stageRun of planned.stageRuns) {
      this.options.db.insertWorkflowStageRun(stageRun);
    }
    for (const taskRun of planned.taskRuns) {
      this.options.db.insertWorkflowTaskRun(taskRun);
    }

    // Auto-pump: begin executing the workflow immediately so callers don't need
    // to manually call pump() after start().
    this.autoPump = this.pump(planned.workflowRun.id);

    return planned.workflowRun.id;
  }

  list(filter?: {
    status?: string;
    workflowType?: string;
    entityType?: string;
  }): WorkflowRun[] {
    return this.options.db.listWorkflowRuns(filter);
  }

  get(id: string): WorkflowRun | undefined {
    return this.options.db.getWorkflowRun(id);
  }

  getStages(workflowRunId: string): WorkflowStageRun[] {
    return this.options.db.listWorkflowStageRuns(workflowRunId);
  }

  getTasks(workflowRunId: string): WorkflowTaskRun[] {
    return this.options.db.listWorkflowTaskRuns(workflowRunId);
  }

  async pause(workflowRunId: string): Promise<void> {
    this.options.db.updateWorkflowRun(workflowRunId, {
      status: 'paused',
      updatedAt: this.nextTimestamp(),
    });
  }

  async resume(workflowRunId: string): Promise<void> {
    this.options.db.updateWorkflowRun(workflowRunId, {
      status: 'ready',
      updatedAt: this.nextTimestamp(),
    });
    await this.refreshAvailability(workflowRunId);
  }

  async cancel(workflowRunId: string): Promise<void> {
    const tasks = this.options.db.listWorkflowTaskRuns(workflowRunId);
    const stages = this.options.db.listWorkflowStageRuns(workflowRunId);

    for (const task of tasks) {
      if (TASK_TERMINAL_STATUSES.has(task.status)) {
        continue;
      }

      this.options.db.updateWorkflowTaskRun(task.id, {
        status: TaskRunStatus.Cancelled,
        completedAt: this.nextTimestamp(),
        updatedAt: this.nextTimestamp(),
      });
    }

    for (const stage of stages) {
      this.options.db.recomputeStageAggregate(stage.id);
    }
    this.options.db.recomputeWorkflowAggregate(workflowRunId);
  }

  async retryTask(taskRunId: string): Promise<void> {
    const record = this.getRecord(taskRunId);
    if (!TASK_TERMINAL_STATUSES.has(record.taskRun.status)) {
      return;
    }

    this.options.db.updateWorkflowTaskRun(taskRunId, {
      status: TaskRunStatus.Blocked,
      updatedAt: this.nextTimestamp(),
    });
    await this.refreshAvailability(record.workflowRun.id);
  }

  async retryStage(stageRunId: string): Promise<void> {
    const stageRun = this.options.db.getWorkflowStageRun(stageRunId);
    if (!stageRun) {
      throw new Error(`Workflow stage "${stageRunId}" not found`);
    }

    for (const task of this.options.db.listWorkflowTaskRunsByStage(stageRunId)) {
      if (!TASK_TERMINAL_STATUSES.has(task.status)) {
        continue;
      }

      this.options.db.updateWorkflowTaskRun(task.id, {
        status: TaskRunStatus.Blocked,
        updatedAt: this.nextTimestamp(),
      });
    }

    await this.refreshAvailability(stageRun.workflowRunId);
  }

  async retryWorkflow(workflowRunId: string): Promise<void> {
    for (const task of this.options.db.listWorkflowTaskRuns(workflowRunId)) {
      if (!TASK_TERMINAL_STATUSES.has(task.status)) {
        continue;
      }

      this.options.db.updateWorkflowTaskRun(task.id, {
        status: TaskRunStatus.Blocked,
        updatedAt: this.nextTimestamp(),
      });
    }

    await this.refreshAvailability(workflowRunId);
  }

  async pump(workflowRunId?: string): Promise<number> {
    let executed = 0;
    await this.refreshAvailability(workflowRunId);

    for (;;) {
      if (this.activeTasks >= this.maxConcurrentTasks) return executed;
      const readyTasks = this.options.db.listReadyWorkflowTasks(workflowRunId);
      const task = readyTasks[0];
      if (!task) {
        return executed;
      }

      this.activeTasks++;
      try {
        await this.executeTask(task.id);
      } finally {
        this.activeTasks--;
      }
      executed += 1;
    }
  }

  /** Await the auto-pump started by the most recent `start()` call. */
  async waitForAutoPump(): Promise<void> {
    if (this.autoPump) {
      const pending = this.autoPump;
      this.autoPump = undefined;
      await pending;
    }
  }

  async recover(workflowRunId?: string): Promise<number> {
    const candidates = this.getRecoverableTasks(workflowRunId);
    let recovered = 0;

    for (const task of candidates) {
      await this.recoverTask(task.id);
      recovered += 1;
    }

    return recovered;
  }

  private async executeTask(taskRunId: string): Promise<void> {
    const record = this.getRecord(taskRunId);
    const handler = this.resolveHandler(record.taskRun);
    const attempts = record.taskRun.attempts + 1;

    this.options.db.updateWorkflowTaskRun(taskRunId, {
      status: TaskRunStatus.Running,
      attempts,
      startedAt: record.taskRun.startedAt ?? this.nextTimestamp(),
      updatedAt: this.nextTimestamp(),
    });

    try {
      const runningRecord = this.getRecord(taskRunId);
      const result = await handler.execute({
        workflowRun: runningRecord.workflowRun,
        stageRun: runningRecord.stageRun,
        taskRun: runningRecord.taskRun,
        db: this.options.db,
      });

      this.applyTaskResult(runningRecord.taskRun, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.applyTaskResult(this.getRecord(taskRunId).taskRun, {
        status:
          attempts < record.taskRun.maxRetries
            ? TaskRunStatus.RetryableFailed
            : TaskRunStatus.Failed,
        error: message,
        progress: record.taskRun.progress,
      });
    }

    await this.refreshAvailability(record.workflowRun.id);
  }

  private async recoverTask(taskRunId: string): Promise<void> {
    const record = this.getRecord(taskRunId);
    const handler = this.resolveHandler(record.taskRun);

    if (!handler.recover) {
      if (record.taskRun.status === TaskRunStatus.Running) {
        this.options.db.updateWorkflowTaskRun(taskRunId, {
          status: TaskRunStatus.Ready,
          updatedAt: this.nextTimestamp(),
        });
        this.options.db.recomputeStageAggregate(record.stageRun.id);
        this.options.db.recomputeWorkflowAggregate(record.workflowRun.id);
        await this.refreshAvailability(record.workflowRun.id);
      }
      return;
    }

    const result = await handler.recover({
      workflowRun: record.workflowRun,
      stageRun: record.stageRun,
      taskRun: record.taskRun,
      db: this.options.db,
    });

    if (!result) {
      if (record.taskRun.status === TaskRunStatus.Running) {
        this.options.db.updateWorkflowTaskRun(taskRunId, {
          status: TaskRunStatus.Ready,
          updatedAt: this.nextTimestamp(),
        });
        this.options.db.recomputeStageAggregate(record.stageRun.id);
        this.options.db.recomputeWorkflowAggregate(record.workflowRun.id);
        await this.refreshAvailability(record.workflowRun.id);
      }
      return;
    }

    this.applyTaskResult(record.taskRun, result);
    await this.refreshAvailability(record.workflowRun.id);
  }

  private applyTaskResult(taskRun: WorkflowTaskRun, result: WorkflowTaskExecutionResult): void {
    const status = result.status;
    const isTerminal = TASK_TERMINAL_STATUSES.has(status);

    this.options.db.updateWorkflowTaskRun(taskRun.id, {
      status,
      output: result.output ?? taskRun.output,
      error: result.error,
      progress: result.progress ?? (status === TaskRunStatus.Completed ? 100 : taskRun.progress),
      currentStep: result.currentStep,
      providerTaskId: result.providerTaskId ?? taskRun.providerTaskId,
      assetId: result.assetId ?? taskRun.assetId,
      completedAt: isTerminal ? this.nextTimestamp() : taskRun.completedAt,
      updatedAt: this.nextTimestamp(),
    });

    this.options.db.recomputeStageAggregate(taskRun.stageRunId);
    this.options.db.recomputeWorkflowAggregate(taskRun.workflowRunId);
  }

  private async refreshAvailability(workflowRunId?: string): Promise<void> {
    const workflowIds = workflowRunId
      ? [workflowRunId]
      : this.options.db.listWorkflowRuns().map((workflow) => workflow.id);

    for (const id of workflowIds) {
      const stages = this.options.db.listWorkflowStageRuns(id);
      const tasks = this.options.db.listWorkflowTaskRuns(id);
      const stageByRunId = new Map(stages.map((stage) => [stage.id, stage]));
      const stageByStageId = new Map(stages.map((stage) => [stage.stageId, stage]));
      const taskByRunId = new Map(tasks.map((task) => [task.id, task]));
      let changed = false;

      for (const task of [...tasks].sort(
        (left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id),
      )) {
        if (task.status !== TaskRunStatus.Blocked && task.status !== TaskRunStatus.Pending) {
          continue;
        }

        const stage = stageByRunId.get(task.stageRunId);
        if (!stage) {
          continue;
        }

        if (!this.areStageDependenciesSatisfied(stage, stageByStageId)) {
          continue;
        }

        if (!this.areTaskDependenciesSatisfied(task, taskByRunId)) {
          continue;
        }

        this.options.db.updateWorkflowTaskRun(task.id, {
          status: TaskRunStatus.Ready,
          updatedAt: this.nextTimestamp(),
        });
        task.status = TaskRunStatus.Ready;
        changed = true;
      }

      if (changed) {
        for (const stage of stages) {
          this.options.db.recomputeStageAggregate(stage.id);
        }
        this.options.db.recomputeWorkflowAggregate(id);
      }
    }
  }

  private areStageDependenciesSatisfied(
    stageRun: WorkflowStageRun,
    stageByStageId: Map<string, WorkflowStageRun>,
  ): boolean {
    const dependsOnStageIds = this.readStringArray(stageRun.metadata?.dependsOnStageIds);
    return dependsOnStageIds.every((dependsOnStageId) => {
      const dependency = stageByStageId.get(dependsOnStageId);
      return (
        dependency !== undefined &&
        (dependency.status === 'completed' ||
          dependency.status === 'completed_with_errors' ||
          dependency.status === 'skipped')
      );
    });
  }

  private areTaskDependenciesSatisfied(
    taskRun: WorkflowTaskRun,
    taskByRunId: Map<string, WorkflowTaskRun>,
  ): boolean {
    return taskRun.dependencyIds.every((dependencyId) => {
      const dependency = taskByRunId.get(dependencyId);
      return dependency !== undefined && TASK_SUCCESS_STATUSES.has(dependency.status);
    });
  }

  private getRecord(taskRunId: string): WorkflowStateRecord {
    const taskRun = this.options.db.getWorkflowTaskRun(taskRunId);
    if (!taskRun) {
      throw new Error(`Workflow task "${taskRunId}" not found`);
    }

    const stageRun = this.options.db.getWorkflowStageRun(taskRun.stageRunId);
    if (!stageRun) {
      throw new Error(`Workflow stage "${taskRun.stageRunId}" not found`);
    }

    const workflowRun = this.options.db.getWorkflowRun(taskRun.workflowRunId);
    if (!workflowRun) {
      throw new Error(`Workflow run "${taskRun.workflowRunId}" not found`);
    }

    return { workflowRun, stageRun, taskRun };
  }

  private resolveHandler(taskRun: WorkflowTaskRun): WorkflowTaskHandler {
    const handlerId =
      typeof taskRun.input.handlerId === 'string' ? taskRun.input.handlerId : undefined;
    if (!handlerId) {
      throw new Error(`Workflow task "${taskRun.id}" is missing a handlerId`);
    }

    const handler = this.handlers.get(handlerId);
    if (!handler) {
      throw new Error(`Workflow handler "${handlerId}" is not registered`);
    }

    return handler;
  }

  private getRecoverableTasks(workflowRunId?: string): WorkflowTaskRun[] {
    const tasks = workflowRunId
      ? this.options.db.listWorkflowTaskRuns(workflowRunId)
      : this.options.db
          .listWorkflowRuns()
          .flatMap((workflow) => this.options.db.listWorkflowTaskRuns(workflow.id));

    return tasks
      .filter(
        (task) =>
          task.status === TaskRunStatus.Running || task.status === TaskRunStatus.AwaitingProvider,
      )
      .sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id));
  }

  private readStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }

  private nextTimestamp(): number {
    return this.now() + this.tick++;
  }
}
