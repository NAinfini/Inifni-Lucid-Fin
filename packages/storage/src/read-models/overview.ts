import {
  WireSuccessV1Schema,
  parseCanonical,
  parseRequestV1,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { getProject } from '../authorities/projects.js';
import { getStoreDatabase } from '../internal/database-access.js';
import { loadRun } from '../internal/run-records.js';
import { loadTaskList } from '../internal/task-list-records.js';
import { StorageError } from '../kernel/errors.js';
import type { Store } from '../kernel/store.js';

type OverviewRequest = Extract<WireRequestV1, { readonly method: 'overview.get' }>;
type OverviewSuccess = Extract<WireSuccessV1, { readonly method: 'overview.get' }>;

interface IdRow {
  readonly id: string;
}

interface CountRow {
  readonly count: number;
}

function exactRequest(value: OverviewRequest): OverviewRequest {
  const request = parseRequestV1(value);
  if (request.method !== 'overview.get') {
    throw new StorageError('INVALID_REQUEST', 'Expected overview.get Wire request');
  }
  return request as OverviewRequest;
}

function count(database: DatabaseSync, sql: string, projectId: string): number {
  return Number((database.prepare(sql).get(projectId) as unknown as CountRow).count);
}

function overview(database: DatabaseSync, request: OverviewRequest): OverviewSuccess {
  const project = getProject(database, request.input.projectId);
  const runIds = database
    .prepare(
      `SELECT id
       FROM runs
       WHERE project_id = ?
         AND status IN ('accepted', 'running', 'waiting_question', 'waiting_confirmation', 'paused', 'recovering')
       ORDER BY accepted_at DESC, id ASC
       LIMIT 100`,
    )
    .all(project.id) as unknown as readonly IdRow[];
  const activeRuns = runIds.map(({ id }) => loadRun(database, id));
  const taskLists = runIds
    .map(({ id }) => loadTaskList(database, id))
    .filter((taskList) => taskList !== null);

  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result: {
      project,
      activeRuns,
      taskLists,
      counts: {
        chats: count(
          database,
          "SELECT COUNT(*) AS count FROM chats WHERE project_id = ? AND lifecycle = 'active'",
          project.id,
        ),
        deliveryPlans: count(
          database,
          "SELECT COUNT(*) AS count FROM delivery_plans WHERE project_id = ? AND lifecycle = 'active'",
          project.id,
        ),
        media: count(
          database,
          "SELECT COUNT(*) AS count FROM project_media_refs WHERE project_id = ? AND lifecycle = 'active'",
          project.id,
        ),
        productionObjects: count(
          database,
          "SELECT COUNT(*) AS count FROM production_objects WHERE project_id = ? AND lifecycle = 'active'",
          project.id,
        ),
      },
    },
  }) as OverviewSuccess;
}

export interface ProjectOverviewReadModel {
  get(request: OverviewRequest): OverviewSuccess;
}

export function createProjectOverviewReadModel(store: Store): ProjectOverviewReadModel {
  return Object.freeze({
    get(requestValue: OverviewRequest): OverviewSuccess {
      return overview(getStoreDatabase(store), exactRequest(requestValue));
    },
  });
}
