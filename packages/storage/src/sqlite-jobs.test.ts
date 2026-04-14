import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import type { Job } from '@lucid-fin/contracts';
import { JobStatus } from '@lucid-fin/contracts';
import { insertJob, updateJob, getJob, listJobs, rowToJob } from './sqlite-jobs.js';

const JOBS_SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
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

const tempFiles: string[] = [];

function createTempDb(): BetterSqlite3.Database {
  const dbPath = path.join(
    os.tmpdir(),
    `lucid-jobs-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
  );
  tempFiles.push(dbPath, `${dbPath}-wal`, `${dbPath}-shm`);
  const db = new Database(dbPath);
  db.exec(JOBS_SCHEMA);
  return db;
}

function makeJob(overrides?: Partial<Job>): Job {
  return {
    id: 'j1',
    type: 'image',
    provider: 'openai-dalle',
    status: JobStatus.Queued,
    priority: 0,
    prompt: 'a red fox in a forest',
    attempts: 0,
    maxRetries: 3,
    createdAt: 1_000_000,
    ...overrides,
  };
}

describe('sqlite-jobs', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = createTempDb();
  });

  afterEach(() => {
    db.close();
    for (const file of tempFiles.splice(0)) {
      if (fs.existsSync(file)) {
        try {
          fs.rmSync(file, { force: true });
        } catch {
          // Ignore transient Windows file-lock issues on WAL artifacts.
        }
      }
    }
  });

  // ---------------------------------------------------------------------------
  // insertJob / getJob
  // ---------------------------------------------------------------------------

  describe('insertJob / getJob', () => {
    it('inserts a minimal job and retrieves it by id', () => {
      const job = makeJob();
      insertJob(db, job);
      const fetched = getJob(db, 'j1');
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe('j1');
      expect(fetched!.type).toBe('image');
      expect(fetched!.provider).toBe('openai-dalle');
      expect(fetched!.status).toBe(JobStatus.Queued);
      expect(fetched!.priority).toBe(0);
      expect(fetched!.prompt).toBe('a red fox in a forest');
      expect(fetched!.attempts).toBe(0);
      expect(fetched!.maxRetries).toBe(3);
      expect(fetched!.createdAt).toBe(1_000_000);
    });

    it('returns undefined for a non-existent id', () => {
      expect(getJob(db, 'does-not-exist')).toBeUndefined();
    });

    it('preserves all optional fields when set', () => {
      const result = {
        assetHash: 'abc123',
        assetPath: '/assets/abc123.png',
        provider: 'openai-dalle',
        cost: 0.05,
        metadata: { seed: 42 },
      };
      const job = makeJob({
        id: 'j-full',
        segmentId: 'seg-1',
        params: { width: 512, height: 512 },
        result,
        cost: 0.05,
        progress: 0.75,
        completedSteps: 3,
        totalSteps: 4,
        currentStep: 'upscale',
        batchId: 'batch-1',
        batchIndex: 2,
        startedAt: 1_000_100,
        completedAt: 1_000_200,
        error: undefined,
      });
      insertJob(db, job);
      const fetched = getJob(db, 'j-full');
      expect(fetched).toBeDefined();
      expect(fetched!.segmentId).toBe('seg-1');
      expect(fetched!.params).toEqual({ width: 512, height: 512 });
      expect(fetched!.result).toEqual(result);
      expect(fetched!.cost).toBe(0.05);
      expect(fetched!.progress).toBe(0.75);
      expect(fetched!.completedSteps).toBe(3);
      expect(fetched!.totalSteps).toBe(4);
      expect(fetched!.currentStep).toBe('upscale');
      expect(fetched!.batchId).toBe('batch-1');
      expect(fetched!.batchIndex).toBe(2);
      expect(fetched!.startedAt).toBe(1_000_100);
      expect(fetched!.completedAt).toBe(1_000_200);
    });

    it('stores null for all optional fields when omitted', () => {
      insertJob(db, makeJob({ id: 'j-sparse' }));
      const fetched = getJob(db, 'j-sparse');
      expect(fetched!.segmentId).toBeNull();
      expect(fetched!.params).toBeUndefined();
      expect(fetched!.result).toBeUndefined();
      expect(fetched!.cost).toBeNull();
      expect(fetched!.progress).toBeUndefined();
      expect(fetched!.completedSteps).toBeUndefined();
      expect(fetched!.totalSteps).toBeUndefined();
      expect(fetched!.currentStep).toBeNull();
      expect(fetched!.batchId).toBeNull();
      expect(fetched!.batchIndex).toBeUndefined();
      expect(fetched!.startedAt).toBeNull();
      expect(fetched!.completedAt).toBeNull();
      expect(fetched!.error).toBeNull();
    });

    it('throws on duplicate id', () => {
      insertJob(db, makeJob({ id: 'j-dup' }));
      expect(() => insertJob(db, makeJob({ id: 'j-dup' }))).toThrow();
    });

    it('inserts jobs with all GenerationType values', () => {
      const types = ['text', 'image', 'video', 'voice', 'music', 'sfx'] as const;
      for (const type of types) {
        insertJob(db, makeJob({ id: `j-${type}`, type }));
        const fetched = getJob(db, `j-${type}`);
        expect(fetched!.type).toBe(type);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // updateJob
  // ---------------------------------------------------------------------------

  describe('updateJob', () => {
    beforeEach(() => {
      insertJob(db, makeJob({ id: 'j-update' }));
    });

    it('updates status and startedAt', () => {
      updateJob(db, 'j-update', { status: JobStatus.Running, startedAt: 2_000_000 });
      const fetched = getJob(db, 'j-update');
      expect(fetched!.status).toBe(JobStatus.Running);
      expect(fetched!.startedAt).toBe(2_000_000);
    });

    it('updates status to completed with completedAt and cost', () => {
      updateJob(db, 'j-update', {
        status: JobStatus.Completed,
        completedAt: 3_000_000,
        cost: 0.12,
        result: {
          assetHash: 'hash-xyz',
          assetPath: '/assets/hash-xyz.png',
          provider: 'openai-dalle',
        },
      });
      const fetched = getJob(db, 'j-update');
      expect(fetched!.status).toBe(JobStatus.Completed);
      expect(fetched!.completedAt).toBe(3_000_000);
      expect(fetched!.cost).toBe(0.12);
      expect(fetched!.result).toEqual({
        assetHash: 'hash-xyz',
        assetPath: '/assets/hash-xyz.png',
        provider: 'openai-dalle',
      });
    });

    it('updates status to failed with error message', () => {
      updateJob(db, 'j-update', {
        status: JobStatus.Failed,
        error: 'rate limit exceeded',
        attempts: 1,
      });
      const fetched = getJob(db, 'j-update');
      expect(fetched!.status).toBe(JobStatus.Failed);
      expect(fetched!.error).toBe('rate limit exceeded');
      expect(fetched!.attempts).toBe(1);
    });

    it('updates progress fields independently', () => {
      updateJob(db, 'j-update', {
        progress: 0.5,
        completedSteps: 2,
        totalSteps: 4,
        currentStep: 'denoise',
      });
      const fetched = getJob(db, 'j-update');
      expect(fetched!.progress).toBe(0.5);
      expect(fetched!.completedSteps).toBe(2);
      expect(fetched!.totalSteps).toBe(4);
      expect(fetched!.currentStep).toBe('denoise');
    });

    it('is a no-op when updates object is empty', () => {
      updateJob(db, 'j-update', {});
      const fetched = getJob(db, 'j-update');
      // original values unchanged
      expect(fetched!.status).toBe(JobStatus.Queued);
      expect(fetched!.attempts).toBe(0);
    });

    it('silently does nothing for a non-existent id', () => {
      // Should not throw
      expect(() => updateJob(db, 'ghost-id', { status: JobStatus.Running })).not.toThrow();
    });

    it('serialises result as JSON and round-trips correctly', () => {
      const result = {
        assetHash: 'h1',
        assetPath: '/a/h1.png',
        provider: 'test-provider',
        cost: 0.01,
        metadata: { seed: 99, cfg: 7.5 },
      };
      updateJob(db, 'j-update', { result });
      const fetched = getJob(db, 'j-update');
      expect(fetched!.result).toEqual(result);
    });

    it('can transition through all status values', () => {
      const statuses = [
        JobStatus.Running,
        JobStatus.Paused,
        JobStatus.Running,
        JobStatus.Failed,
        JobStatus.Dead,
        JobStatus.Queued,
        JobStatus.Cancelled,
      ];
      for (const status of statuses) {
        updateJob(db, 'j-update', { status });
        expect(getJob(db, 'j-update')!.status).toBe(status);
      }
    });

    it('overwrites previous update values on repeated calls', () => {
      updateJob(db, 'j-update', { attempts: 1 });
      updateJob(db, 'j-update', { attempts: 2 });
      updateJob(db, 'j-update', { attempts: 3 });
      expect(getJob(db, 'j-update')!.attempts).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // listJobs
  // ---------------------------------------------------------------------------

  describe('listJobs', () => {
    beforeEach(() => {
      insertJob(db, makeJob({ id: 'j-a', status: JobStatus.Queued, priority: 5 }));
      insertJob(db, makeJob({ id: 'j-b', status: JobStatus.Running, priority: 3 }));
      insertJob(db, makeJob({ id: 'j-c', status: JobStatus.Queued, priority: 1 }));
      insertJob(db, makeJob({ id: 'j-d', status: JobStatus.Completed, priority: 0 }));
    });

    it('returns all jobs when no filter is provided', () => {
      const all = listJobs(db);
      expect(all).toHaveLength(4);
    });

    it('filters by status', () => {
      const queued = listJobs(db, { status: JobStatus.Queued });
      expect(queued).toHaveLength(2);
      expect(queued.every((j) => j.status === JobStatus.Queued)).toBe(true);
    });

    it('returns empty array when status matches nothing', () => {
      const jobs = listJobs(db, { status: JobStatus.Cancelled });
      expect(jobs).toHaveLength(0);
    });

    it('orders by priority DESC then createdAt ASC', () => {
      const jobs = listJobs(db);
      // j-a priority 5, j-b priority 3, j-c priority 1, j-d priority 0
      expect(jobs[0]!.id).toBe('j-a'); // priority 5
      expect(jobs[1]!.id).toBe('j-b'); // priority 3
    });

    it('orders by createdAt ASC when priority is equal', () => {
      // Insert two more jobs with same priority but different createdAt
      insertJob(db, makeJob({ id: 'j-early', priority: 2, createdAt: 100 }));
      insertJob(db, makeJob({ id: 'j-late', priority: 2, createdAt: 200 }));
      const jobs = listJobs(db, { status: JobStatus.Queued });
      // Both j-early and j-late are Queued with priority 2
      const earlyIdx = jobs.findIndex((j) => j.id === 'j-early');
      const lateIdx = jobs.findIndex((j) => j.id === 'j-late');
      expect(earlyIdx).toBeLessThan(lateIdx);
    });

    it('returns correct job shapes (full round-trip via list)', () => {
      const jobs = listJobs(db, { status: JobStatus.Queued });
      for (const job of jobs) {
        expect(job).toMatchObject({
          id: expect.any(String),
          type: 'image',
          provider: 'openai-dalle',
          prompt: 'a red fox in a forest',
          attempts: 0,
          maxRetries: 3,
          createdAt: 1_000_000,
        });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // rowToJob
  // ---------------------------------------------------------------------------

  describe('rowToJob', () => {
    it('maps all snake_case columns to camelCase Job fields', () => {
      const row: Record<string, unknown> = {
        id: 'j-row',
        segment_id: 'seg-row',
        type: 'video',
        provider: 'runway',
        status: JobStatus.Running,
        priority: 7,
        prompt: 'a dolphin',
        params: JSON.stringify({ fps: 24 }),
        result: JSON.stringify({ assetHash: 'h2', assetPath: '/a/h2.mp4', provider: 'runway' }),
        cost: 1.5,
        attempts: 2,
        max_retries: 5,
        progress: 0.4,
        completed_steps: 2,
        total_steps: 5,
        current_step: 'encode',
        batch_id: 'b-1',
        batch_index: 3,
        created_at: 100,
        started_at: 200,
        completed_at: null,
        error: null,
      };
      const job = rowToJob(row);
      expect(job.id).toBe('j-row');
      expect(job.segmentId).toBe('seg-row');
      expect(job.type).toBe('video');
      expect(job.provider).toBe('runway');
      expect(job.status).toBe(JobStatus.Running);
      expect(job.priority).toBe(7);
      expect(job.prompt).toBe('a dolphin');
      expect(job.params).toEqual({ fps: 24 });
      expect(job.result).toEqual({ assetHash: 'h2', assetPath: '/a/h2.mp4', provider: 'runway' });
      expect(job.cost).toBe(1.5);
      expect(job.attempts).toBe(2);
      expect(job.maxRetries).toBe(5);
      expect(job.progress).toBe(0.4);
      expect(job.completedSteps).toBe(2);
      expect(job.totalSteps).toBe(5);
      expect(job.currentStep).toBe('encode');
      expect(job.batchId).toBe('b-1');
      expect(job.batchIndex).toBe(3);
      expect(job.createdAt).toBe(100);
      expect(job.startedAt).toBe(200);
      expect(job.completedAt).toBeNull();
      expect(job.error).toBeNull();
    });

    it('returns undefined for null optional numeric fields (progress, completedSteps, totalSteps, batchIndex)', () => {
      const row: Record<string, unknown> = {
        id: 'j-nulls',
        segment_id: null,
        type: 'text',
        provider: 'gpt4',
        status: JobStatus.Queued,
        priority: 0,
        prompt: 'hello',
        params: null,
        result: null,
        cost: null,
        attempts: 0,
        max_retries: 3,
        progress: null,
        completed_steps: null,
        total_steps: null,
        current_step: null,
        batch_id: null,
        batch_index: null,
        created_at: 1,
        started_at: null,
        completed_at: null,
        error: null,
      };
      const job = rowToJob(row);
      expect(job.segmentId).toBeNull();
      expect(job.params).toBeUndefined();
      expect(job.result).toBeUndefined();
      expect(job.cost).toBeNull();
      expect(job.progress).toBeUndefined();
      expect(job.completedSteps).toBeUndefined();
      expect(job.totalSteps).toBeUndefined();
      expect(job.currentStep).toBeNull();
      expect(job.batchId).toBeNull();
      expect(job.batchIndex).toBeUndefined();
      expect(job.startedAt).toBeNull();
      expect(job.completedAt).toBeNull();
      expect(job.error).toBeNull();
    });

    it('converts numeric strings to numbers for progress fields', () => {
      // SQLite may return INTEGER values; ensure Number() coercion works
      const row: Record<string, unknown> = {
        id: 'j-nums',
        segment_id: null,
        type: 'image',
        provider: 'p',
        status: JobStatus.Queued,
        priority: 0,
        prompt: '',
        params: null,
        result: null,
        cost: null,
        attempts: 0,
        max_retries: 3,
        progress: '0.9',
        completed_steps: '9',
        total_steps: '10',
        current_step: null,
        batch_id: null,
        batch_index: '4',
        created_at: 1,
        started_at: null,
        completed_at: null,
        error: null,
      };
      const job = rowToJob(row);
      expect(job.progress).toBe(0.9);
      expect(job.completedSteps).toBe(9);
      expect(job.totalSteps).toBe(10);
      expect(job.batchIndex).toBe(4);
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: full lifecycle
  // ---------------------------------------------------------------------------

  describe('job lifecycle integration', () => {
    it('queued → running → completed lifecycle persists correctly', () => {
      const job = makeJob({ id: 'j-lifecycle', createdAt: 1_000 });
      insertJob(db, job);

      // queue → running
      updateJob(db, 'j-lifecycle', { status: JobStatus.Running, startedAt: 2_000 });
      let current = getJob(db, 'j-lifecycle');
      expect(current!.status).toBe(JobStatus.Running);
      expect(current!.startedAt).toBe(2_000);

      // running → completed
      updateJob(db, 'j-lifecycle', {
        status: JobStatus.Completed,
        progress: 1.0,
        completedSteps: 4,
        totalSteps: 4,
        completedAt: 3_000,
        cost: 0.08,
        result: {
          assetHash: 'final-hash',
          assetPath: '/assets/final-hash.png',
          provider: 'openai-dalle',
        },
      });
      current = getJob(db, 'j-lifecycle');
      expect(current!.status).toBe(JobStatus.Completed);
      expect(current!.completedAt).toBe(3_000);
      expect(current!.progress).toBe(1.0);
      expect(current!.result!.assetHash).toBe('final-hash');
      expect(current!.cost).toBe(0.08);
    });

    it('queued → running → failed lifecycle persists error and attempts', () => {
      insertJob(db, makeJob({ id: 'j-fail', createdAt: 1_000 }));
      updateJob(db, 'j-fail', { status: JobStatus.Running, startedAt: 1_100 });
      updateJob(db, 'j-fail', {
        status: JobStatus.Failed,
        error: 'provider returned 503',
        attempts: 1,
      });
      const current = getJob(db, 'j-fail');
      expect(current!.status).toBe(JobStatus.Failed);
      expect(current!.error).toBe('provider returned 503');
      expect(current!.attempts).toBe(1);
      expect(current!.startedAt).toBe(1_100);
    });

    it('batch jobs are inserted and listed correctly', () => {
      for (let i = 0; i < 5; i++) {
        insertJob(
          db,
          makeJob({
            id: `batch-j${i}`,
            batchId: 'batch-abc',
            batchIndex: i,
          }),
        );
      }
      const jobs = listJobs(db);
      // 5 batch jobs total
      const batchJobs = jobs.filter((j) => j.batchId === 'batch-abc');
      expect(batchJobs).toHaveLength(5);
      const indices = batchJobs.map((j) => j.batchIndex).sort();
      expect(indices).toEqual([0, 1, 2, 3, 4]);
    });
  });
});
