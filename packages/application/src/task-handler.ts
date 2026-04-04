import type {
  TaskKind,
  WorkflowStageRun,
  WorkflowTaskRun,
  WorkflowRun,
} from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';

export interface WorkflowTaskExecutionContext {
  workflowRun: WorkflowRun;
  stageRun: WorkflowStageRun;
  taskRun: WorkflowTaskRun;
  db: SqliteIndex;
  signal?: AbortSignal;
}

export interface WorkflowTaskExecutionResult {
  status: WorkflowTaskRun['status'];
  output?: Record<string, unknown>;
  error?: string;
  progress?: number;
  currentStep?: string;
  providerTaskId?: string;
  assetId?: string;
}

export interface WorkflowTaskHandler {
  id: string;
  kind: TaskKind | TaskKind[];
  execute(context: WorkflowTaskExecutionContext): Promise<WorkflowTaskExecutionResult>;
  recover?(context: WorkflowTaskExecutionContext): Promise<WorkflowTaskExecutionResult | void>;
  cancel?(context: WorkflowTaskExecutionContext): Promise<void>;
}
