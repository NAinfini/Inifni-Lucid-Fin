import type {
  WorkflowDefinition,
  WorkflowStageDefinition,
  WorkflowTaskDefinition,
} from '@lucid-fin/contracts';

export interface WorkflowProjectionFields {
  displayCategory: string;
  displayLabel: string;
  relatedEntityLabel?: string;
  provider?: string;
  modelKey?: string;
  promptTemplateId?: string;
  promptTemplateVersion?: string;
  summary?: string;
}

export interface RegisteredWorkflowTaskDefinition
  extends WorkflowTaskDefinition, WorkflowProjectionFields {
  handlerId: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export interface RegisteredWorkflowStageDefinition extends Omit<WorkflowStageDefinition, 'tasks'> {
  tasks: RegisteredWorkflowTaskDefinition[];
}

export interface RegisteredWorkflowDefinition
  extends Omit<WorkflowDefinition, 'stages'>, WorkflowProjectionFields {
  stages: RegisteredWorkflowStageDefinition[];
}

export class WorkflowRegistry {
  private definitions = new Map<string, RegisteredWorkflowDefinition>();

  register(definition: RegisteredWorkflowDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  has(workflowType: string): boolean {
    return this.definitions.has(workflowType);
  }

  get(workflowType: string): RegisteredWorkflowDefinition | undefined {
    return this.definitions.get(workflowType);
  }

  list(): RegisteredWorkflowDefinition[] {
    return Array.from(this.definitions.values());
  }
}
