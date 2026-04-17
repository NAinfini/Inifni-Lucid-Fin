import { describe, it, expect } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { withTx } from './transactions.js';

describe('withTx', () => {
  function openTempDb(): BetterSqlite3.Database {
    const db = new BetterSqlite3(':memory:');
    db.exec(`CREATE TABLE t (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    return db;
  }

  it('commits on normal return', () => {
    const db = openTempDb();
    const result = withTx(db, (tx) => {
      tx.prepare('INSERT INTO t(k,v) VALUES (?,?)').run('k1', 'v1');
      return 'ok';
    });
    expect(result).toBe('ok');
    const row = db.prepare('SELECT v FROM t WHERE k=?').get('k1') as { v: string };
    expect(row.v).toBe('v1');
  });

  it('rolls back on throw', () => {
    const db = openTempDb();
    expect(() =>
      withTx(db, (tx) => {
        tx.prepare('INSERT INTO t(k,v) VALUES (?,?)').run('k2', 'v2');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    const row = db.prepare('SELECT v FROM t WHERE k=?').get('k2');
    expect(row).toBeUndefined();
  });

  it('passes the db handle through as the Tx argument', () => {
    const db = openTempDb();
    withTx(db, (tx) => {
      expect(tx).toBe(db);
    });
  });
});
