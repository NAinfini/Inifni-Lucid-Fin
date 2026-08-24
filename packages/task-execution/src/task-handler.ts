import type { TaskKind, Task, TaskList } from '@lucid-fin/contracts';
import type { IStorageLayer } from '@lucid-fin/storage';

export interface TaskExecutionContext {
  taskList: TaskList;
  task: Task;
  db: IStorageLayer;
  signal?: AbortSignal;
}

export interface TaskExecutionResult {
  status: Task['status'];
  output?: Record<string, unknown>;
  error?: string;
  progress?: number;
  currentStep?: string;
  providerTaskId?: string;
  assetId?: string;
}

export interface TaskHandler {
  id: string;
  kind: TaskKind | TaskKind[];
  execute(context: TaskExecutionContext): Promise<TaskExecutionResult>;
  recover?(context: TaskExecutionContext): Promise<TaskExecutionResult | void>;
  cancel?(context: TaskExecutionContext): Promise<void>;
}
