import type { TaskBlueprint, TaskListBlueprint } from '@lucid-fin/contracts';

export interface TaskProjectionFields {
  displayCategory: string;
  displayLabel: string;
  /** Optional locale key for host-authored labels. AI-authored labels omit this. */
  displayLabelKey?: string;
  relatedEntityLabel?: string;
  provider?: string;
  modelKey?: string;
  promptTemplateId?: string;
  promptTemplateVersion?: string;
  summary?: string;
}

export interface RegisteredTaskBlueprint extends TaskBlueprint, TaskProjectionFields {
  handlerId: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export interface RegisteredTaskListBlueprint
  extends Omit<TaskListBlueprint, 'tasks'>, TaskProjectionFields {
  tasks: RegisteredTaskBlueprint[];
}

export class TaskListRegistry {
  private readonly definitions = new Map<string, RegisteredTaskListBlueprint>();

  register(definition: RegisteredTaskListBlueprint): void {
    this.definitions.set(definition.id, definition);
  }

  has(taskListType: string): boolean {
    return this.definitions.has(taskListType);
  }

  get(taskListType: string): RegisteredTaskListBlueprint | undefined {
    return this.definitions.get(taskListType);
  }

  list(): RegisteredTaskListBlueprint[] {
    return Array.from(this.definitions.values());
  }
}
