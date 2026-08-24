import type {
  TaskListSummary,
  TaskPhaseUpdatedEvent,
  TaskSummary,
  TaskUpdatedEvent,
  TaskListUpdatedEvent,
} from './dto/task-execution.js';

type Assert<T extends true> = T;

type Extends<A, B> = A extends B ? true : false;

type _TaskListSummaryShape = Assert<
  Extends<
    TaskListSummary,
    {
      id: string;
      commanderSessionId?: string;
      taskListType: string;
      entityType: string;
      entityId?: string;
      status: string;
      summary: string;
      progress: number;
      displayCategory: string;
      displayLabel: string;
      relatedEntityLabel?: string;
      provider?: string;
      modelKey?: string;
      updatedAt: number;
    }
  >
>;

type _TaskSummaryShape = Assert<
  Extends<
    TaskSummary,
    {
      id: string;
      taskListId: string;
      phaseKey: string;
      taskKey: string;
      kind: string;
      status: string;
      displayCategory: string;
      displayLabel: string;
      relatedEntityType?: string;
      relatedEntityId?: string;
      relatedEntityLabel?: string;
      provider?: string;
      modelKey?: string;
      promptTemplateId?: string;
      promptTemplateVersion?: string;
      summary?: string;
      updatedAt: number;
    }
  >
>;

type _TaskListUpdatedEventShape = Assert<
  Extends<TaskListUpdatedEvent, { taskList: TaskListSummary }>
>;

type _TaskUpdatedEventShape = Assert<Extends<TaskUpdatedEvent, { task: TaskSummary }>>;

type _TaskPhaseUpdatedEventShape = Assert<
  Extends<TaskPhaseUpdatedEvent, { taskListId: string; phaseKey: string }>
>;

export {};
