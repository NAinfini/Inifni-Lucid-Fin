import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from '../src/sqlite-index.ts';
import type { Job } from '@lucid-fin/contracts';
import { JobStatus } from '@lucid-fin/contracts';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-db-'));
}

describe('SqliteIndex performance', () => {
  let db: SqliteIndex;
  let base: string;
  let dbPath: string;

  beforeEach(() => {
    base = tmpDir();
    dbPath = path.join(base, 'test.db');
    db = new SqliteIndex(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  const makeJob = (overrides?: Partial<Job>): Job => ({
    id: 'j1',
    type: 'image',
    provider: 'openai-dalle',
    status: JobStatus.Queued,
    priority: 0,
    prompt: 'a cat',
    attempts: 0,
    maxRetries: 3,
    createdAt: Date.now(),
    ...overrides,
  });

  it('query performance < 50ms for 100 jobs', () => {
    for (let i = 0; i < 100; i++) {
      db.repos.jobs.insert(makeJob({ id: `j${i}`, priority: i % 5 }));
    }
    const start = performance.now();
    const jobs = db.repos.jobs.list().rows;
    const elapsed = performance.now() - start;
    expect(jobs.length).toBe(100);
    expect(elapsed).toBeLessThan(50);
  });
});
