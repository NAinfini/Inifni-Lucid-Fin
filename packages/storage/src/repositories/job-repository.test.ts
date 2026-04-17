import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { Job, JobId } from '@lucid-fin/contracts';
import { JobStatus } from '@lucid-fin/contracts';
import {
  setDegradeReporter,
  type DegradeReporter,
} from '@lucid-fin/contracts-parse';
import { JobRepository } from './job-repository.js';

const SCHEMA = `
CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  segment_id    TEXT,
  type          TEXT NOT NULL,
  provider      TEXT NOT NULL,
  status        TEXT NOT NULL,
  priority      INTEGER DEFAULT 0,
  prompt        TEXT,
  params        TEXT,
  result        TEXT,
  cost          REAL,
  attempts      INTEGER DEFAULT 0,
  max_retries   INTEGER DEFAULT 3,
  progress      REAL,
  completed_steps INTEGER,
  total_steps   INTEGER,
  current_step  TEXT,
  batch_id      TEXT,
  batch_index   INTEGER,
  created_at    INTEGER NOT NULL,
  started_at    INTEGER,
  completed_at  INTEGER,
  error         TEXT
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  return db;
}

function mkJob(id: string, overrides: Partial<Job> = {}): Job {
  return {
    id,
    type: 'image',
    provider: 'openai',
    status: JobStatus.Queued,
    priority: 0,
    prompt: 'hello',
    attempts: 0,
    maxRetries: 3,
    createdAt: 1,
    ...overrides,
  };
}

describe('JobRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: JobRepository;
  const reports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    reports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    db = openDb();
    repo = new JobRepository(db);
    reports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    db.close();
  });

  it('insert round-trips a minimal job', () => {
    repo.insert(mkJob('j1', { prompt: 'a' }));
    const got = repo.get('j1' as JobId);
    expect(got).toBeDefined();
    expect(got!.prompt).toBe('a');
    expect(got!.status).toBe(JobStatus.Queued);
  });

  it('insert stores + retrieves a job with params/result JSON', () => {
    repo.insert(
      mkJob('j1', {
        params: { foo: 'bar', n: 42 },
        result: {
          assetHash: 'h',
          assetPath: '/tmp/x',
          provider: 'openai',
        },
      }),
    );
    const got = repo.get('j1' as JobId)!;
    expect(got.params).toEqual({ foo: 'bar', n: 42 });
    expect(got.result?.assetHash).toBe('h');
  });

  it('get returns undefined on missing id', () => {
    expect(repo.get('missing' as JobId)).toBeUndefined();
  });

  it('list orders by priority DESC then createdAt ASC', () => {
    repo.insert(mkJob('low-early',  { priority: 0, createdAt: 1 }));
    repo.insert(mkJob('high-later', { priority: 9, createdAt: 5 }));
    repo.insert(mkJob('high-early', { priority: 9, createdAt: 2 }));
    const { rows, degradedCount } = repo.list();
    expect(degradedCount).toBe(0);
    expect(rows.map((r) => r.id)).toEqual(['high-early', 'high-later', 'low-early']);
  });

  it('list filters by status when provided', () => {
    repo.insert(mkJob('q',  { status: JobStatus.Queued }));
    repo.insert(mkJob('r',  { status: JobStatus.Running }));
    repo.insert(mkJob('q2', { status: JobStatus.Queued }));
    const { rows } = repo.list({ status: JobStatus.Running });
    expect(rows.map((r) => r.id)).toEqual(['r']);
  });

  it('update writes only the provided fields', () => {
    repo.insert(mkJob('j1'));
    repo.update('j1' as JobId, {
      status: JobStatus.Running,
      progress: 0.5,
      attempts: 1,
    });
    const got = repo.get('j1' as JobId)!;
    expect(got.status).toBe(JobStatus.Running);
    expect(got.progress).toBe(0.5);
    expect(got.attempts).toBe(1);
    expect(got.prompt).toBe('hello');
  });

  it('update is a no-op when updates object has no fields', () => {
    repo.insert(mkJob('j1'));
    repo.update('j1' as JobId, {});
    const got = repo.get('j1' as JobId)!;
    expect(got.attempts).toBe(0);
  });

  it('update can set error and completedAt', () => {
    repo.insert(mkJob('j1'));
    repo.update('j1' as JobId, {
      status: JobStatus.Failed,
      error: 'boom',
      completedAt: 99,
    });
    const got = repo.get('j1' as JobId)!;
    expect(got.error).toBe('boom');
    expect(got.completedAt).toBe(99);
  });

  it('fault injection: list skips malformed row + reports degrade', () => {
    repo.insert(mkJob('good'));
    // Insert a row with a non-numeric created_at — zod rejects at parse.
    db.prepare(
      `INSERT INTO jobs (id, type, provider, status, priority, attempts, max_retries, created_at)
       VALUES (?, 'image', 'openai', 'queued', 0, 0, 3, ?)`,
    ).run('bad', 'not-a-number' as unknown as number);
    const { rows, degradedCount } = repo.list();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.length).toBe(1);
    expect(reports[0].schema).toBe('Job');
  });

  it('methods accept a Tx argument', () => {
    const tx = db.transaction(() => {
      repo.insert(mkJob('tx-job'), db);
      repo.update('tx-job' as JobId, { status: JobStatus.Running }, db);
    });
    tx();
    const got = repo.get('tx-job' as JobId, db)!;
    expect(got.status).toBe(JobStatus.Running);
  });
});
