import {
  EntityIdSchema,
  IsoTimestampSchema,
  RunSchema,
  RunTerminalStateSchema,
  TaskManageDefinition,
  assertTaskItemStateTransition,
  canonicalJson,
  parseCanonical,
  strictObject,
  type Run,
  type TaskItem,
  type TaskList,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetCommandContextSchema, type TargetCommandContext } from '../internal/command.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import { hashContentObject } from '../internal/hashes.js';
import {
  appendRunEventBatch,
  loadPublicRunEventForCommand,
  type AppendRunEventBatchInput,
} from '../internal/run-journal.js';
import { advanceRunJournalHead, loadRun } from '../internal/run-records.js';
import {
  canonicalTaskItems,
  finalizeTaskList,
  insertTaskList,
  loadTaskList,
  replaceTaskList,
} from '../internal/task-list-records.js';
import { TargetStorageError } from '../kernel/errors.js';
import type { TargetStore } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';

const TaskManageOptionsSchema = strictObject({
  commandId: EntityIdSchema,
  context: TargetCommandContextSchema,
});

export type TaskManageInput = ReturnType<typeof TaskManageDefinition.parseInput>;
export type TaskManageSuccess = ReturnType<typeof TaskManageDefinition.parseSuccess>;
export interface TaskManageOptions {
  readonly commandId: string;
  readonly context: TargetCommandContext;
}

function assertMutableRun(run: Run): void {
  if (RunTerminalStateSchema.safeParse(run.status).success) {
    throw new TargetStorageError('INVALID_REQUEST', `Terminal Run ${run.id} cannot be changed`);
  }
}

function requireActiveList(database: DatabaseSync, runId: string, expectedRevision: number) {
  const taskList = loadTaskList(database, runId);
  if (taskList === null) {
    throw new TargetStorageError('NOT_FOUND', `Run ${runId} has no TaskList`);
  }
  if (taskList.revision !== expectedRevision) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `TaskList ${taskList.id} revision does not match`,
    );
  }
  if (taskList.state !== 'active') {
    throw new TargetStorageError('INVALID_REQUEST', `TaskList ${taskList.id} is terminal`);
  }
  return taskList;
}

function assertParent(items: readonly TaskItem[], parentTaskId: string | null): void {
  if (parentTaskId !== null && !items.some(({ id }) => id === parentTaskId)) {
    throw new TargetStorageError('INVALID_REQUEST', `Task parent was not found: ${parentTaskId}`);
  }
}

function assertLinkedChild(database: DatabaseSync, owner: Run, childRunId: string): void {
  const child = loadRun(database, childRunId);
  if (
    child.projectId !== owner.projectId ||
    child.chatId !== owner.chatId ||
    child.rootRunId !== owner.rootRunId ||
    child.id === owner.id
  ) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      `Run ${childRunId} is not a descendant of ${owner.id}`,
    );
  }
  let cursor: Run = child;
  while (cursor.parentRunId !== null) {
    if (cursor.parentRunId === owner.id) return;
    cursor = loadRun(database, cursor.parentRunId);
  }
  throw new TargetStorageError(
    'INVALID_REQUEST',
    `Run ${childRunId} is not a descendant of ${owner.id}`,
  );
}

function sameTaskSemantics(left: TaskList, right: TaskList): boolean {
  return (
    canonicalJson({
      title: left.title,
      state: left.state,
      items: canonicalTaskItems(left.items),
      terminalizedAt: left.terminalizedAt,
    }) ===
    canonicalJson({
      title: right.title,
      state: right.state,
      items: canonicalTaskItems(right.items),
      terminalizedAt: right.terminalizedAt,
    })
  );
}

function taskListEvent(
  environment: TargetStorageEnvironment,
  taskList: TaskList,
  publicSummary: string,
  occurredAt: string,
  context: TargetCommandContext,
): AppendRunEventBatchInput['events'][number] {
  return {
    eventId: environment.createId('run_event'),
    visibility: 'public',
    occurredAt,
    actor: context.actor,
    causation: context.causation,
    correlationId: context.correlationId,
    payload: {
      type: 'task_list_changed',
      taskListId: taskList.id,
      revision: taskList.revision,
      publicSummary,
    },
  };
}

function appendTaskListEvent(
  database: DatabaseSync,
  run: Run,
  commandId: string,
  eventDraft: AppendRunEventBatchInput['events'][number],
): void {
  const [event] = appendRunEventBatch(database, {
    runId: run.id,
    commandId,
    events: [eventDraft],
  });
  if (event === undefined) {
    throw new TargetStorageError('CORRUPT_DATA', 'TaskList event was not appended');
  }
  advanceRunJournalHead(database, run, {
    eventId: event.eventId,
    sequence: event.sequence,
    eventHash: event.eventHash,
  });
}

export interface TaskManageInTransactionResult {
  readonly result: TaskManageSuccess;
  readonly run: Run;
  readonly event: AppendRunEventBatchInput['events'][number] | null;
}

export function manageTaskListInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  runIdValue: string,
  inputValue: TaskManageInput,
  optionsValue: TaskManageOptions,
  occurredAtValue?: string,
  observedRunValue?: Run,
): TaskManageInTransactionResult {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  const input = TaskManageDefinition.parseInput(inputValue);
  const options = parseCanonical(TaskManageOptionsSchema, optionsValue);
  if (input.action === 'get') {
    const run = loadRun(database, runId);
    return {
      result: TaskManageDefinition.parseSuccess({
        taskList: loadTaskList(database, runId),
        changedTaskIds: [],
      }),
      run,
      event: null,
    };
  }
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'TaskList mutation requires an immediate transaction',
    );
  }

  const occurredAt = parseCanonical(IsoTimestampSchema, occurredAtValue ?? environment.now());
  const listId = input.action === 'create' ? environment.createId('task_list') : null;
  const itemIds =
    input.action === 'create'
      ? input.tasks.map(() => environment.createId('task_item'))
      : input.action === 'add'
        ? [environment.createId('task_item')]
        : [];

  const run = loadRun(database, runId);
  const observedRun =
    observedRunValue === undefined ? run : parseCanonical(RunSchema, observedRunValue);
  if (
    observedRun.id !== run.id ||
    (observedRun.revision !== run.revision && observedRun.revision + 1 !== run.revision) ||
    hashContentObject(observedRun) !== observedRun.contentHash ||
    canonicalJson({
      ...observedRun,
      revision: run.revision,
      contentHash: run.contentHash,
      publicEventHead: run.publicEventHead,
    }) !== canonicalJson(run)
  ) {
    throw new TargetStorageError('REVISION_CONFLICT', `Run ${run.id} observation does not match`);
  }
  assertMutableRun(run);
  if (loadPublicRunEventForCommand(database, run.id, options.commandId) !== undefined) {
    throw new TargetStorageError(
      'IDEMPOTENCY_CONFLICT',
      `TaskList command was already applied: ${options.commandId}`,
    );
  }

  if (input.action === 'create') {
    if (observedRun.revision !== input.expectedRunRevision) {
      throw new TargetStorageError('REVISION_CONFLICT', `Run ${run.id} revision does not match`);
    }
    if (loadTaskList(database, run.id) !== null) {
      throw new TargetStorageError('INVALID_REQUEST', `Run ${run.id} already has a TaskList`);
    }
    const draftIds = new Map(
      input.tasks.map((draft, index) => [draft.draftId, itemIds[index]!] as const),
    );
    const taskList = finalizeTaskList({
      authority: 'task_list',
      id: listId!,
      runId: run.id,
      title: input.title,
      state: 'active',
      revision: 1,
      items: input.tasks.map((draft, index) => ({
        id: itemIds[index]!,
        title: draft.title,
        state: 'pending',
        order: draft.order,
        parentItemId: draft.parentDraftId === null ? null : draftIds.get(draft.parentDraftId)!,
        childRunIds: [],
        publicNote: '',
      })),
      createdAt: occurredAt,
      updatedAt: occurredAt,
      terminalizedAt: null,
    });
    insertTaskList(database, taskList);
    return {
      result: TaskManageDefinition.parseSuccess({
        taskList,
        changedTaskIds: taskList.items.map(({ id }) => id),
      }),
      run,
      event: taskListEvent(environment, taskList, input.publicSummary, occurredAt, options.context),
    };
  }

  const before = requireActiveList(database, run.id, input.expectedRevision);
  let items = before.items.map((item) => ({ ...item, childRunIds: [...item.childRunIds] }));
  let title = before.title;
  let state = before.state;
  let terminalizedAt = before.terminalizedAt;
  let changedTaskIds: string[] = [];

  switch (input.action) {
    case 'rename':
      title = input.title;
      break;
    case 'add': {
      assertParent(items, input.parentTaskId);
      const siblings = items.filter(({ parentItemId }) => parentItemId === input.parentTaskId);
      if (input.order > siblings.length) {
        throw new TargetStorageError('INVALID_REQUEST', 'Task insertion order is out of range');
      }
      items = items.map((item) =>
        item.parentItemId === input.parentTaskId && item.order >= input.order
          ? { ...item, order: item.order + 1 }
          : item,
      );
      const id = itemIds[0]!;
      items.push({
        id,
        title: input.title,
        state: 'pending',
        order: input.order,
        parentItemId: input.parentTaskId,
        childRunIds: [],
        publicNote: '',
      });
      changedTaskIds = [id];
      break;
    }
    case 'update': {
      const index = items.findIndex(({ id }) => id === input.taskId);
      if (index < 0) {
        throw new TargetStorageError('NOT_FOUND', `Task item was not found: ${input.taskId}`);
      }
      const item = items[index]!;
      let childRunIds = item.childRunIds;
      if (input.childRunId !== null && !childRunIds.includes(input.childRunId)) {
        if (items.some(({ childRunIds: ids }) => ids.includes(input.childRunId!))) {
          throw new TargetStorageError(
            'INVALID_REQUEST',
            `Child Run ${input.childRunId} is already linked to another Task item`,
          );
        }
        assertLinkedChild(database, run, input.childRunId);
        childRunIds = [...childRunIds, input.childRunId];
      }
      let itemState = item.state;
      if (input.state !== null && input.state !== item.state) {
        try {
          assertTaskItemStateTransition(item.state, input.state);
        } catch (cause) {
          throw new TargetStorageError('INVALID_REQUEST', 'Task item state transition is invalid', {
            cause,
          });
        }
        itemState = input.state;
      }
      items[index] = {
        ...item,
        title: input.title ?? item.title,
        state: itemState,
        publicNote: input.resultSummary ?? item.publicNote,
        childRunIds,
      };
      changedTaskIds = [item.id];
      break;
    }
    case 'reorder': {
      assertParent(items, input.parentTaskId);
      const siblings = items
        .filter(({ parentItemId }) => parentItemId === input.parentTaskId)
        .sort((left, right) => left.order - right.order);
      const actual = new Set(siblings.map(({ id }) => id));
      if (
        actual.size !== input.orderedTaskIds.length ||
        input.orderedTaskIds.some((id) => !actual.has(id))
      ) {
        throw new TargetStorageError(
          'INVALID_REQUEST',
          'Task reorder must name every direct sibling exactly once',
        );
      }
      const orderById = new Map(input.orderedTaskIds.map((id, order) => [id, order]));
      changedTaskIds = input.orderedTaskIds.filter(
        (id) => siblings.find((item) => item.id === id)!.order !== orderById.get(id),
      );
      items = items.map((item) =>
        item.parentItemId === input.parentTaskId
          ? { ...item, order: orderById.get(item.id)! }
          : item,
      );
      break;
    }
    case 'remove': {
      const removed = items.find(({ id }) => id === input.taskId);
      if (removed === undefined) {
        throw new TargetStorageError('NOT_FOUND', `Task item was not found: ${input.taskId}`);
      }
      if (items.some(({ parentItemId }) => parentItemId === removed.id)) {
        throw new TargetStorageError('INVALID_REQUEST', 'Only a leaf Task item may be removed');
      }
      items = items
        .filter(({ id }) => id !== removed.id)
        .map((item) =>
          item.parentItemId === removed.parentItemId && item.order > removed.order
            ? { ...item, order: item.order - 1 }
            : item,
        );
      changedTaskIds = [removed.id];
      break;
    }
    case 'terminalize':
      state = input.state;
      terminalizedAt = occurredAt;
      break;
  }

  const candidate = finalizeTaskList({
    ...before,
    title,
    state,
    revision: before.revision + 1,
    items,
    updatedAt: occurredAt,
    terminalizedAt,
  });
  if (sameTaskSemantics(before, candidate)) {
    return {
      result: TaskManageDefinition.parseSuccess({ taskList: before, changedTaskIds: [] }),
      run,
      event: null,
    };
  }
  replaceTaskList(database, before, candidate);
  return {
    result: TaskManageDefinition.parseSuccess({ taskList: candidate, changedTaskIds }),
    run,
    event: taskListEvent(environment, candidate, input.publicSummary, occurredAt, options.context),
  };
}

function manageTaskList(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  runIdValue: string,
  inputValue: TaskManageInput,
  optionsValue: TaskManageOptions,
): TaskManageSuccess {
  const input = TaskManageDefinition.parseInput(inputValue);
  const options = parseCanonical(TaskManageOptionsSchema, optionsValue);
  const execute = () =>
    manageTaskListInTransaction(database, environment, runIdValue, input, options);
  if (input.action === 'get') return execute().result;
  return withImmediateTransaction(database, () => {
    const managed = execute();
    if (managed.event !== null) {
      appendTaskListEvent(database, managed.run, options.commandId, managed.event);
    }
    return managed.result;
  });
}

export interface TaskListsAuthority {
  readonly get: (runId: string) => TaskList | null;
  readonly manage: (
    runId: string,
    input: TaskManageInput,
    options: TaskManageOptions,
  ) => TaskManageSuccess;
}

export function createTaskListsAuthority(
  store: TargetStore,
  environment: TargetStorageEnvironment,
): TaskListsAuthority {
  const authority: TaskListsAuthority = {
    get(runId) {
      const database = getTargetStoreDatabase(store);
      loadRun(database, runId);
      return loadTaskList(database, runId);
    },
    manage(runId, input, options) {
      return manageTaskList(getTargetStoreDatabase(store), environment, runId, input, options);
    },
  };
  return Object.freeze(authority);
}
