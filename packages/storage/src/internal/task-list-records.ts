import {
  EntityIdSchema,
  IsoTimestampSchema,
  RevisionSchema,
  Sha256Schema,
  TaskItemSchema,
  TaskListSchema,
  TaskListStateSchema,
  canonicalJson,
  parseCanonical,
  z,
  type TaskItem,
  type TaskList,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import { hashContentObject } from './hashes.js';

interface TaskListRow {
  id: string;
  run_id: string;
  title: string;
  state: TaskList['state'];
  revision: number;
  content_hash: string;
  created_at: string;
  updated_at: string;
  terminalized_at: string | null;
}

interface TaskItemRow {
  id: string;
  parent_item_id: string | null;
  title: string;
  state: TaskItem['state'];
  ordinal: number;
  child_run_ids_v1_json: string;
  public_note: string;
}

const ChildRunIdsSchema = z.array(EntityIdSchema).max(100);

function corrupt(message: string, cause?: unknown): StorageError {
  return new StorageError('CORRUPT_DATA', message, cause === undefined ? undefined : { cause });
}

function decodeChildRunIds(row: TaskItemRow): string[] {
  try {
    const ids = parseCanonical(ChildRunIdsSchema, JSON.parse(row.child_run_ids_v1_json) as unknown);
    if (canonicalJson(ids) !== row.child_run_ids_v1_json) {
      throw new Error('child Run IDs are not canonical JSON');
    }
    return ids;
  } catch (cause) {
    throw corrupt(`Task item ${row.id} child Run IDs are invalid`, cause);
  }
}

function itemFromRow(row: TaskItemRow): TaskItem {
  try {
    return parseCanonical(TaskItemSchema, {
      id: row.id,
      title: row.title,
      state: row.state,
      order: row.ordinal,
      parentItemId: row.parent_item_id,
      childRunIds: decodeChildRunIds(row),
      publicNote: row.public_note,
    });
  } catch (cause) {
    throw corrupt(`Task item ${row.id} is invalid`, cause);
  }
}

export function canonicalTaskItems(items: readonly TaskItem[]): TaskItem[] {
  const normalized = items.map((item) =>
    parseCanonical(TaskItemSchema, {
      ...item,
      childRunIds: [...item.childRunIds].sort((left, right) => left.localeCompare(right)),
    }),
  );
  const children = new Map<string | null, TaskItem[]>();
  for (const item of normalized) {
    const siblings = children.get(item.parentItemId) ?? [];
    siblings.push(item);
    children.set(item.parentItemId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  }
  const ordered: TaskItem[] = [];
  const visit = (parentId: string | null) => {
    for (const item of children.get(parentId) ?? []) {
      ordered.push(item);
      visit(item.id);
    }
  };
  visit(null);
  if (ordered.length !== normalized.length) {
    throw new StorageError('INVALID_REQUEST', 'Task item tree is disconnected or cyclic');
  }
  return ordered;
}

export function finalizeTaskList(value: Omit<TaskList, 'contentHash'>): TaskList {
  const withoutHash = {
    ...value,
    items: canonicalTaskItems(value.items),
    contentHash: '',
  };
  return parseCanonical(TaskListSchema, {
    ...withoutHash,
    contentHash: hashContentObject(withoutHash),
  });
}

export function loadTaskList(database: DatabaseSync, runIdValue: string): TaskList | null {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  const row = database
    .prepare('SELECT * FROM task_lists WHERE run_id = ?')
    .get(runId) as unknown as TaskListRow | undefined;
  if (row === undefined) return null;
  let taskList: TaskList;
  try {
    const items = (
      database
        .prepare('SELECT * FROM task_items WHERE task_list_id = ?')
        .all(row.id) as unknown as TaskItemRow[]
    ).map(itemFromRow);
    const parsed = parseCanonical(TaskListSchema, {
      authority: 'task_list',
      id: parseCanonical(EntityIdSchema, row.id),
      runId: parseCanonical(EntityIdSchema, row.run_id),
      title: row.title,
      state: parseCanonical(TaskListStateSchema, row.state),
      revision: parseCanonical(RevisionSchema, row.revision),
      contentHash: parseCanonical(Sha256Schema, row.content_hash),
      items,
      createdAt: parseCanonical(IsoTimestampSchema, row.created_at),
      updatedAt: parseCanonical(IsoTimestampSchema, row.updated_at),
      terminalizedAt:
        row.terminalized_at === null
          ? null
          : parseCanonical(IsoTimestampSchema, row.terminalized_at),
    });
    taskList = parseCanonical(TaskListSchema, {
      ...parsed,
      items: canonicalTaskItems(parsed.items),
    });
  } catch (cause) {
    throw corrupt(`TaskList ${row.id} is invalid`, cause);
  }
  if (hashContentObject(taskList) !== taskList.contentHash) {
    throw corrupt(`TaskList ${taskList.id} content hash does not match its stored value`);
  }
  return taskList;
}

function insertItem(database: DatabaseSync, taskListId: string, item: TaskItem): void {
  database
    .prepare(
      `INSERT INTO task_items (
         id, task_list_id, parent_item_id, title, state, ordinal,
         child_run_ids_v1_json, public_note
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      item.id,
      taskListId,
      item.parentItemId,
      item.title,
      item.state,
      item.order,
      canonicalJson(item.childRunIds),
      item.publicNote,
    );
}

export function insertTaskList(database: DatabaseSync, taskList: TaskList): void {
  if (!database.isTransaction) {
    throw new StorageError('INVALID_REQUEST', 'TaskList insert requires a transaction');
  }
  const value = parseCanonical(TaskListSchema, taskList);
  if (hashContentObject(value) !== value.contentHash) {
    throw new StorageError('INVALID_REQUEST', `TaskList ${value.id} hash is invalid`);
  }
  database
    .prepare(
      `INSERT INTO task_lists (
         id, run_id, title, state, revision, content_hash, created_at, updated_at, terminalized_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      value.id,
      value.runId,
      value.title,
      value.state,
      value.revision,
      value.contentHash,
      value.createdAt,
      value.updatedAt,
      value.terminalizedAt,
    );
  for (const item of canonicalTaskItems(value.items)) insertItem(database, value.id, item);
}

export function replaceTaskList(database: DatabaseSync, before: TaskList, after: TaskList): void {
  if (!database.isTransaction) {
    throw new StorageError('INVALID_REQUEST', 'TaskList update requires a transaction');
  }
  const value = parseCanonical(TaskListSchema, after);
  if (
    before.id !== value.id ||
    before.runId !== value.runId ||
    value.revision !== before.revision + 1 ||
    hashContentObject(value) !== value.contentHash
  ) {
    throw new StorageError('INVALID_REQUEST', 'TaskList replacement identity is invalid');
  }
  const update = database
    .prepare(
      `UPDATE task_lists
       SET title = ?, state = ?, revision = ?, content_hash = ?, updated_at = ?, terminalized_at = ?
       WHERE id = ? AND run_id = ? AND revision = ? AND content_hash = ? AND state = ?`,
    )
    .run(
      value.title,
      value.state,
      value.revision,
      value.contentHash,
      value.updatedAt,
      value.terminalizedAt,
      before.id,
      before.runId,
      before.revision,
      before.contentHash,
      before.state,
    );
  if (Number(update.changes) !== 1) {
    throw new StorageError('REVISION_CONFLICT', `TaskList ${before.id} changed concurrently`);
  }

  const beforeById = new Map(before.items.map((item) => [item.id, item]));
  const afterById = new Map(value.items.map((item) => [item.id, item]));
  for (const item of [...before.items].reverse()) {
    if (!afterById.has(item.id)) {
      database
        .prepare('DELETE FROM task_items WHERE id = ? AND task_list_id = ?')
        .run(item.id, value.id);
    }
  }
  for (const item of canonicalTaskItems(value.items)) {
    if (!beforeById.has(item.id)) {
      insertItem(database, value.id, item);
      continue;
    }
    database
      .prepare(
        `UPDATE task_items
         SET parent_item_id = ?, title = ?, state = ?, ordinal = ?,
             child_run_ids_v1_json = ?, public_note = ?
         WHERE id = ? AND task_list_id = ?`,
      )
      .run(
        item.parentItemId,
        item.title,
        item.state,
        item.order,
        canonicalJson(item.childRunIds),
        item.publicNote,
        item.id,
        value.id,
      );
  }
}
