import type { Job } from '@lucid-fin/contracts';
import type BetterSqlite3 from 'better-sqlite3';

export function insertJob(db: BetterSqlite3.Database, job: Job): void {
  db.prepare(
    `
    INSERT INTO jobs (id, project_id, segment_id, type, provider, status, priority, prompt, params, result, cost, attempts, max_retries, progress, completed_steps, total_steps, current_step, batch_id, batch_index, created_at, started_at, completed_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    job.id,
    job.projectId,
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

export function updateJob(
  db: BetterSqlite3.Database,
  jobId: string,
  updates: Partial<
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
  >,
): void {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push('status = ?');
    params.push(updates.status);
  }
  if (updates.result !== undefined) {
    sets.push('result = ?');
    params.push(JSON.stringify(updates.result));
  }
  if (updates.cost !== undefined) {
    sets.push('cost = ?');
    params.push(updates.cost);
  }
  if (updates.attempts !== undefined) {
    sets.push('attempts = ?');
    params.push(updates.attempts);
  }
  if (updates.progress !== undefined) {
    sets.push('progress = ?');
    params.push(updates.progress);
  }
  if (updates.completedSteps !== undefined) {
    sets.push('completed_steps = ?');
    params.push(updates.completedSteps);
  }
  if (updates.totalSteps !== undefined) {
    sets.push('total_steps = ?');
    params.push(updates.totalSteps);
  }
  if (updates.currentStep !== undefined) {
    sets.push('current_step = ?');
    params.push(updates.currentStep);
  }
  if (updates.startedAt !== undefined) {
    sets.push('started_at = ?');
    params.push(updates.startedAt);
  }
  if (updates.completedAt !== undefined) {
    sets.push('completed_at = ?');
    params.push(updates.completedAt);
  }
  if (updates.error !== undefined) {
    sets.push('error = ?');
    params.push(updates.error);
  }

  if (sets.length === 0) return;
  params.push(jobId);
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function getJob(db: BetterSqlite3.Database, jobId: string): Job | undefined {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return rowToJob(row);
}

export function listJobs(
  db: BetterSqlite3.Database,
  filter?: { projectId?: string; status?: string },
): Job[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.projectId) {
    conditions.push('project_id = ?');
    params.push(filter.projectId);
  }
  if (filter?.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM jobs ${where} ORDER BY priority DESC, created_at ASC`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((r) => rowToJob(r));
}

export function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    segmentId: row.segment_id as string | undefined,
    type: row.type as Job['type'],
    provider: row.provider as string,
    status: row.status as Job['status'],
    priority: row.priority as number,
    prompt: row.prompt as string,
    params: row.params ? JSON.parse(row.params as string) : undefined,
    result: row.result ? JSON.parse(row.result as string) : undefined,
    cost: row.cost as number | undefined,
    attempts: row.attempts as number,
    maxRetries: row.max_retries as number,
    progress: row.progress == null ? undefined : Number(row.progress),
    completedSteps: row.completed_steps == null ? undefined : Number(row.completed_steps),
    totalSteps: row.total_steps == null ? undefined : Number(row.total_steps),
    currentStep: row.current_step as string | undefined,
    batchId: row.batch_id as string | undefined,
    batchIndex: row.batch_index == null ? undefined : Number(row.batch_index),
    createdAt: row.created_at as number,
    startedAt: row.started_at as number | undefined,
    completedAt: row.completed_at as number | undefined,
    error: row.error as string | undefined,
  };
}
