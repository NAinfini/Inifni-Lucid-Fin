import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';

const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TERMINAL_LIST_STATUSES = new Set([
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'dead',
]);
const TERMINAL_TASK_STATUSES = new Set([
  'completed',
  'failed',
  'cancelled',
  'skipped',
  'retryable_failed',
]);

export type LegacyTaskHistoryPreflightBlocker = Readonly<{
  kind:
    | 'invalid_task_list_identity'
    | 'nonterminal_task_list'
    | 'invalid_task_identity'
    | 'task_owner_missing'
    | 'nonterminal_task'
    | 'invalid_task_dependency'
    | 'cyclic_task_dependency'
    | 'task_event_sequence_mismatch'
    | 'task_event_payload_invalid'
    | 'submitted_attempt_receipt_missing'
    | 'attempt_owner_missing'
    | 'unverified_task_media'
    | 'artifact_owner_missing'
    | 'plan_owner_missing'
    | 'prompt_assembly_owner_missing';
  taskListId: string | null;
  recordId: string | null;
}>;

export interface LegacyTaskHistoryPreflightReport {
  readonly schema: 'lucid-fin.legacy-task-history-preflight/v1';
  readonly counts: Readonly<{
    taskLists: number;
    tasks: number;
    dependencies: number;
    events: number;
    attempts: number;
    artifacts: number;
    plans: number;
    approvals: number;
    promptAssemblies: number;
  }>;
  readonly sourceFingerprint: string;
  readonly blockers: readonly LegacyTaskHistoryPreflightBlocker[];
  readonly fingerprint: string;
  readonly ok: boolean;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

function integer(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  return typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : null;
}

function rows(
  database: DatabaseSync,
  table: string,
  order: string,
): readonly Record<string, unknown>[] {
  const statement = database.prepare(`SELECT * FROM ${table} ORDER BY ${order}`);
  statement.setReadBigInts(true);
  return statement.all() as unknown as readonly Record<string, unknown>[];
}

function rowFingerprint(row: Readonly<Record<string, unknown>>): string {
  return hashCanonical(
    Object.keys(row)
      .sort(compareText)
      .map((key) => {
        const value = row[key];
        if (value instanceof Uint8Array) {
          return [
            key,
            {
              bytes: value.byteLength,
              sha256: createHash('sha256').update(value).digest('hex'),
            },
          ];
        }
        return [key, typeof value === 'bigint' ? value.toString() : value];
      }),
  );
}

function add(
  blockers: LegacyTaskHistoryPreflightBlocker[],
  kind: LegacyTaskHistoryPreflightBlocker['kind'],
  taskListId: string | null,
  recordId: string | null,
): void {
  blockers.push({ kind, taskListId, recordId });
}

function jsonObject(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/** Validates terminal Legacy Task evidence without creating schedulable TaskLists. */
export function preflightLegacyTaskHistory(
  database: DatabaseSync,
  verifiedMediaHashes: ReadonlySet<string>,
): LegacyTaskHistoryPreflightReport {
  const taskLists = rows(database, 'task_lists', 'id');
  const tasks = rows(database, 'tasks', 'task_list_id, id');
  const dependencies = rows(database, 'task_dependencies', 'task_id, depends_on_task_id');
  const events = rows(database, 'task_events', 'task_list_id, seq, event_id');
  const attempts = rows(database, 'task_attempts', 'task_list_id, task_id, id');
  const artifacts = rows(database, 'task_artifacts', 'task_list_id, task_id, id');
  const plans = rows(database, 'plan_documents', 'task_list_id, logical_key, revision, id');
  const approvals = rows(database, 'plan_approvals', 'task_list_id, gate_key, id');
  const promptAssemblies = rows(database, 'prompt_assemblies', 'task_list_id, task_id, id');
  const blockers: LegacyTaskHistoryPreflightBlocker[] = [];
  const listIds = new Set<string>();
  const taskOwners = new Map<string, string>();

  for (const list of taskLists) {
    const id = validId(list.id) ? list.id : null;
    if (id === null || listIds.has(id)) {
      add(blockers, 'invalid_task_list_identity', id, id);
      continue;
    }
    listIds.add(id);
    if (typeof list.status !== 'string' || !TERMINAL_LIST_STATUSES.has(list.status)) {
      add(blockers, 'nonterminal_task_list', id, id);
    }
  }
  for (const task of tasks) {
    const id = validId(task.id) ? task.id : null;
    const listId = validId(task.task_list_id) ? task.task_list_id : null;
    if (id === null || taskOwners.has(id)) {
      add(blockers, 'invalid_task_identity', listId, id);
      continue;
    }
    if (listId === null || !listIds.has(listId)) {
      add(blockers, 'task_owner_missing', listId, id);
      continue;
    }
    taskOwners.set(id, listId);
    if (typeof task.status !== 'string' || !TERMINAL_TASK_STATUSES.has(task.status)) {
      add(blockers, 'nonterminal_task', listId, id);
    }
  }

  const edges = new Map<string, Set<string>>();
  for (const dependency of dependencies) {
    const taskId = validId(dependency.task_id) ? dependency.task_id : null;
    const dependsOnId = validId(dependency.depends_on_task_id)
      ? dependency.depends_on_task_id
      : null;
    const listId = taskId ? (taskOwners.get(taskId) ?? null) : null;
    if (
      taskId === null ||
      dependsOnId === null ||
      !taskOwners.has(taskId) ||
      taskOwners.get(dependsOnId) !== listId ||
      taskId === dependsOnId
    ) {
      add(blockers, 'invalid_task_dependency', listId, taskId);
      continue;
    }
    const parents = edges.get(taskId) ?? new Set<string>();
    parents.add(dependsOnId);
    edges.set(taskId, parents);
  }
  for (const taskId of taskOwners.keys()) {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const parent of edges.get(id) ?? []) if (visit(parent)) return true;
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if (visit(taskId)) add(blockers, 'cyclic_task_dependency', taskOwners.get(taskId)!, taskId);
  }

  const eventsByList = new Map<string, Record<string, unknown>[]>();
  for (const event of events) {
    const listId = validId(event.task_list_id) ? event.task_list_id : 'invalid-list';
    const group = eventsByList.get(listId) ?? [];
    group.push(event);
    eventsByList.set(listId, group);
  }
  for (const [listId, group] of eventsByList) {
    if (
      !listIds.has(listId) ||
      group.some((event, index) => integer(event.seq) !== BigInt(index + 1))
    ) {
      add(blockers, 'task_event_sequence_mismatch', listId, null);
    }
    for (const event of group) {
      if (!jsonObject(event.payload_json)) {
        add(
          blockers,
          'task_event_payload_invalid',
          listId,
          validId(event.event_id) ? event.event_id : null,
        );
      }
    }
  }

  const attemptIds = new Set<string>();
  for (const attempt of attempts) {
    const id = validId(attempt.id) ? attempt.id : null;
    const listId = validId(attempt.task_list_id) ? attempt.task_list_id : null;
    const taskId = validId(attempt.task_id) ? attempt.task_id : null;
    if (
      id === null ||
      listId === null ||
      taskId === null ||
      taskOwners.get(taskId) !== listId ||
      attemptIds.has(id)
    ) {
      add(blockers, 'attempt_owner_missing', listId, id);
      continue;
    }
    attemptIds.add(id);
    if (
      attempt.submitted_at !== null &&
      (typeof attempt.provider_receipt !== 'string' ||
        attempt.provider_receipt.length === 0 ||
        typeof attempt.provider_job_id !== 'string' ||
        attempt.provider_job_id.length === 0)
    ) {
      add(blockers, 'submitted_attempt_receipt_missing', listId, id);
    }
    if (
      typeof attempt.asset_hash === 'string' &&
      SHA256_PATTERN.test(attempt.asset_hash) &&
      !verifiedMediaHashes.has(attempt.asset_hash)
    ) {
      add(blockers, 'unverified_task_media', listId, id);
    }
  }

  for (const artifact of artifacts) {
    const id = validId(artifact.id) ? artifact.id : null;
    const listId = validId(artifact.task_list_id) ? artifact.task_list_id : null;
    const taskId = validId(artifact.task_id) ? artifact.task_id : null;
    if (id === null || listId === null || taskId === null || taskOwners.get(taskId) !== listId) {
      add(blockers, 'artifact_owner_missing', listId, id);
    }
    if (
      typeof artifact.asset_hash === 'string' &&
      SHA256_PATTERN.test(artifact.asset_hash) &&
      !verifiedMediaHashes.has(artifact.asset_hash)
    ) {
      add(blockers, 'unverified_task_media', listId, id);
    }
  }

  for (const plan of [...plans, ...approvals]) {
    const listId = validId(plan.task_list_id) ? plan.task_list_id : null;
    if (listId === null || !listIds.has(listId)) {
      add(blockers, 'plan_owner_missing', listId, validId(plan.id) ? plan.id : null);
    }
  }
  for (const assembly of promptAssemblies) {
    const listId = validId(assembly.task_list_id) ? assembly.task_list_id : null;
    const taskId = validId(assembly.task_id) ? assembly.task_id : null;
    const sourceAttemptId = validId(assembly.source_attempt_id) ? assembly.source_attempt_id : null;
    const submitted = assembly.submitted_at !== null || assembly.status === 'submitted';
    if (
      listId === null ||
      taskId === null ||
      taskOwners.get(taskId) !== listId ||
      (submitted &&
        (sourceAttemptId === null ||
          !attemptIds.has(sourceAttemptId) ||
          !validId(assembly.node_id)))
    ) {
      add(
        blockers,
        'prompt_assembly_owner_missing',
        listId,
        validId(assembly.id) ? assembly.id : null,
      );
    }
  }

  blockers.sort(
    (left, right) =>
      compareText(left.taskListId ?? '', right.taskListId ?? '') ||
      compareText(left.kind, right.kind) ||
      compareText(left.recordId ?? '', right.recordId ?? ''),
  );
  const sourceFingerprint = hashCanonical({
    taskLists: taskLists.map(rowFingerprint),
    tasks: tasks.map(rowFingerprint),
    dependencies: dependencies.map(rowFingerprint),
    events: events.map(rowFingerprint),
    attempts: attempts.map(rowFingerprint),
    artifacts: artifacts.map(rowFingerprint),
    plans: plans.map(rowFingerprint),
    approvals: approvals.map(rowFingerprint),
    promptAssemblies: promptAssemblies.map(rowFingerprint),
  });
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-task-history-preflight/v1' as const,
    counts: {
      taskLists: taskLists.length,
      tasks: tasks.length,
      dependencies: dependencies.length,
      events: events.length,
      attempts: attempts.length,
      artifacts: artifacts.length,
      plans: plans.length,
      approvals: approvals.length,
      promptAssemblies: promptAssemblies.length,
    },
    sourceFingerprint,
    blockers,
  };
  return {
    ...withoutFingerprint,
    fingerprint: hashCanonical(withoutFingerprint),
    ok: blockers.length === 0,
  };
}
