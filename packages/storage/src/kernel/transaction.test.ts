import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withImmediateTransaction } from './transaction.js';

const disposablePaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    disposablePaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

function countRows(db: DatabaseSync): number {
  return (db.prepare('SELECT count(*) AS count FROM values_under_test').get() as { count: number })
    .count;
}

describe('BEGIN IMMEDIATE transaction boundary', () => {
  it('rolls back on exceptions', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE values_under_test (value TEXT NOT NULL) STRICT;');

    expect(() =>
      withImmediateTransaction(db, () => {
        db.prepare('INSERT INTO values_under_test (value) VALUES (?)').run('rolled-back');
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(countRows(db)).toBe(0);
    db.close();
  });

  it('retains both the primary and rollback failures', () => {
    const primary = new Error('primary failure');
    const rollback = new Error('rollback failure');
    const database = {
      exec: vi.fn((statement: string) => {
        if (statement === 'ROLLBACK') throw rollback;
      }),
    } as unknown as DatabaseSync;
    let thrown: unknown;

    try {
      withImmediateTransaction(database, () => {
        throw primary;
      });
    } catch (cause) {
      thrown = cause;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toEqual([primary, rollback]);
    expect((thrown as AggregateError).cause).toBe(rollback);
  });

  it('rejects nested helper transactions and rolls back the outer write', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE values_under_test (value TEXT NOT NULL) STRICT;');

    expect(() =>
      withImmediateTransaction(db, () => {
        db.prepare('INSERT INTO values_under_test (value) VALUES (?)').run('outer');
        withImmediateTransaction(db, () => undefined);
      }),
    ).toThrow('Nested storage transactions are not allowed');
    expect(countRows(db)).toBe(0);
    db.close();
  });

  it('rejects Promise results and rolls back the synchronous write', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE values_under_test (value TEXT NOT NULL) STRICT;');

    expect(() =>
      withImmediateTransaction(db, () => {
        db.prepare('INSERT INTO values_under_test (value) VALUES (?)').run('async');
        return Promise.resolve('not-supported');
      }),
    ).toThrow('Storage transactions must be synchronous');
    expect(countRows(db)).toBe(0);
    db.close();
  });

  it('rejects async functions before invoking them', () => {
    const db = new DatabaseSync(':memory:');
    let invoked = false;

    expect(() =>
      withImmediateTransaction(db, async () => {
        invoked = true;
      }),
    ).toThrow('Storage transactions must be synchronous');
    expect(invoked).toBe(false);
    db.close();
  });

  it('takes the writer reservation before invoking the callback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-immediate-'));
    disposablePaths.push(directory);
    const databasePath = join(directory, 'transaction.sqlite');
    const first = new DatabaseSync(databasePath, { timeout: 0 });
    const second = new DatabaseSync(databasePath, { timeout: 0 });
    first.exec('CREATE TABLE values_under_test (value TEXT NOT NULL) STRICT;');

    withImmediateTransaction(first, () => {
      expect(() =>
        second.prepare('INSERT INTO values_under_test (value) VALUES (?)').run('blocked'),
      ).toThrow(/locked/i);
      first.prepare('INSERT INTO values_under_test (value) VALUES (?)').run('committed');
    });

    expect(countRows(first)).toBe(1);
    first.close();
    second.close();
  });
});
