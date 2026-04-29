/**
 * JobRepository — Phase G1-2.3.
 *
 * Wraps `jobs`-table CRUD behind the `JobId` brand and fault-soft reads.
 * SQL references column names through `JobsTable` (G1-1) — schema drift
 * fails at compile time.
 *
 * Reads loop rows through `parseOrDegrade` with a `Job` context so a
 * corrupt row surfaces as degraded-read telemetry + skip, not a crash
 * in the job-queue UI.
 *
 * Phase G1-5 consumer migration will switch `job.handlers.ts` and the
 * `JobQueue` application service to call this repository directly.
 * Until then `SqliteIndex` delegates its legacy job methods here so no
 * consumer has to change in this PR.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { Job, JobId } from '@lucid-fin/contracts';
import { JobsTable, JobSchema, parseOrDegrade } from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

/** Partial update type — mirrors the legacy `sqlite-jobs.updateJob` shape. */
export type JobUpdates = Partial<
  Pick<
    Job,
    | 'status'
    | 'result'
    | 'cost'
    | 'attempts'
    | 'progress'
    | 'completedSteps'
    | 'totalSteps'
    | 'currentStep'
    | 'startedAt'
    | 'completedAt'
    | 'error'
  >
>;

/** Result shape for list reads that surface degraded-row counts. */
export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

type RawRow = Record<string, unknown>;

const TBL = JobsTable.tableName;
const C = JobsTable.cols;

const SELECT_COLS = [
  C.id.sqlName,
  C.segmentId.sqlName,
  C.type.sqlName,
  C.provider.sqlName,
  C.status.sqlName,
  C.priority.sqlName,
  C.prompt.sqlName,
  C.params.sqlName,
  C.result.sqlName,
  C.cost.sqlName,
  C.attempts.sqlName,
  C.maxRetries.sqlName,
  C.progress.sqlName,
  C.completedSteps.sqlName,
  C.totalSteps.sqlName,
  C.currentStep.sqlName,
  C.batchId.sqlName,
  C.batchIndex.sqlName,
  C.createdAt.sqlName,
  C.startedAt.sqlName,
  C.completedAt.sqlName,
  C.error.sqlName,
].join(', ');

export class JobRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  insert(job: Job, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `INSERT INTO ${TBL} (
         ${C.id.sqlName}, ${C.segmentId.sqlName}, ${C.type.sqlName}, ${C.provider.sqlName},
         ${C.status.sqlName}, ${C.priority.sqlName}, ${C.prompt.sqlName}, ${C.params.sqlName},
         ${C.result.sqlName}, ${C.cost.sqlName}, ${C.attempts.sqlName}, ${C.maxRetries.sqlName},
         ${C.progress.sqlName}, ${C.completedSteps.sqlName}, ${C.totalSteps.sqlName},
         ${C.currentStep.sqlName}, ${C.batchId.sqlName}, ${C.batchIndex.sqlName},
         ${C.createdAt.sqlName}, ${C.startedAt.sqlName}, ${C.completedAt.sqlName}, ${C.error.sqlName}
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      job.id,
      job.segmentId ?? null,
      job.type,
      job.provider,
      job.status,
      job.priority,
      job.prompt,
      job.params ? JSON.stringify(job.params) : null,
      job.result ? JSON.stringify(job.result) : null,
      job.cost ?? null,
      job.attempts,
      job.maxRetries,
      job.progress ?? null,
      job.completedSteps ?? null,
      job.totalSteps ?? null,
      job.currentStep ?? null,
      job.batchId ?? null,
      job.batchIndex ?? null,
      job.createdAt,
      job.startedAt ?? null,
      job.completedAt ?? null,
      job.error ?? null,
    );
  }

  update(id: JobId, updates: JobUpdates, tx?: Tx): void {
    const d = tx ?? this.db;
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.status !== undefined) {
      sets.push(`${C.status.sqlName} = ?`);
      params.push(updates.status);
    }
    if (updates.result !== undefined) {
      sets.push(`${C.result.sqlName} = ?`);
      params.push(JSON.stringify(updates.result));
    }
    if (updates.cost !== undefined) {
      sets.push(`${C.cost.sqlName} = ?`);
      params.push(updates.cost);
    }
    if (updates.attempts !== undefined) {
      sets.push(`${C.attempts.sqlName} = ?`);
      params.push(updates.attempts);
    }
    if (updates.progress !== undefined) {
      sets.push(`${C.progress.sqlName} = ?`);
      params.push(updates.progress);
    }
    if (updates.completedSteps !== undefined) {
      sets.push(`${C.completedSteps.sqlName} = ?`);
      params.push(updates.completedSteps);
    }
    if (updates.totalSteps !== undefined) {
      sets.push(`${C.totalSteps.sqlName} = ?`);
      params.push(updates.totalSteps);
    }
    if (updates.currentStep !== undefined) {
      sets.push(`${C.currentStep.sqlName} = ?`);
      params.push(updates.currentStep);
    }
    if (updates.startedAt !== undefined) {
      sets.push(`${C.startedAt.sqlName} = ?`);
      params.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      sets.push(`${C.completedAt.sqlName} = ?`);
      params.push(updates.completedAt);
    }
    if (updates.error !== undefined) {
      sets.push(`${C.error.sqlName} = ?`);
      params.push(updates.error);
    }

    if (sets.length === 0) return;
    params.push(id);
    d.prepare(`UPDATE ${TBL} SET ${sets.join(', ')} WHERE ${C.id.sqlName} = ?`).run(...params);
  }

  get(id: JobId, tx?: Tx): Job | undefined {
    const d = tx ?? this.db;
    const row = d.prepare(`SELECT ${SELECT_COLS} FROM ${TBL} WHERE ${C.id.sqlName} = ?`).get(id) as
      | RawRow
      | undefined;
    if (!row) return undefined;
    const { rows } = parseRows([row]);
    return rows[0];
  }

  list(filter?: { status?: string }, tx?: Tx): ListResult<Job> {
    const d = tx ?? this.db;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.status) {
      conditions.push(`${C.status.sqlName} = ?`);
      params.push(filter.status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = d
      .prepare(
        `SELECT ${SELECT_COLS}
         FROM ${TBL}
         ${where}
         ORDER BY ${C.priority.sqlName} DESC, ${C.createdAt.sqlName} ASC`,
      )
      .all(...params) as RawRow[];
    return parseRows(rows);
  }
}

function rowToJob(row: RawRow): Job {
  return {
    id: row.id as string,
    segmentId: (row.segment_id as string | null) ?? undefined,
    type: row.type as Job['type'],
    provider: row.provider as string,
    status: row.status as Job['status'],
    priority: row.priority as number,
    prompt: row.prompt as string,
    params: row.params ? (JSON.parse(row.params as string) as unknown as Job['params']) : undefined,
    result: row.result ? (JSON.parse(row.result as string) as unknown as Job['result']) : undefined,
    cost: (row.cost as number | null) ?? undefined,
    attempts: row.attempts as number,
    maxRetries: row.max_retries as number,
    progress: row.progress == null ? undefined : Number(row.progress),
    completedSteps: row.completed_steps == null ? undefined : Number(row.completed_steps),
    totalSteps: row.total_steps == null ? undefined : Number(row.total_steps),
    currentStep: (row.current_step as string | null) ?? undefined,
    batchId: (row.batch_id as string | null) ?? undefined,
    batchIndex: row.batch_index == null ? undefined : Number(row.batch_index),
    createdAt: row.created_at as number,
    startedAt: (row.started_at as number | null) ?? undefined,
    completedAt: (row.completed_at as number | null) ?? undefined,
    error: (row.error as string | null) ?? undefined,
  };
}

function parseRows(rows: RawRow[]): ListResult<Job> {
  const out: Job[] = [];
  let degradedCount = 0;
  const SENTINEL = Symbol('degraded');
  for (const row of rows) {
    const candidate = rowToJob(row);
    const parsed = parseOrDegrade(JobSchema, candidate, SENTINEL as unknown as Job, {
      ctx: { name: 'Job' },
    });
    if ((parsed as unknown) === SENTINEL) {
      degradedCount += 1;
      continue;
    }
    out.push(parsed as Job);
  }
  return { rows: out, degradedCount };
}
