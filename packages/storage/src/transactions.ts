/**
 * Transaction coordinator (Phase G1-3).
 *
 * `withTx(db, fn)` opens a better-sqlite3 transaction around `fn` and
 * exposes a `Tx` handle. Repositories (introduced in subsequent G1
 * sub-tasks) accept an optional `Tx` parameter so application services
 * can batch multi-repository writes into a single atomic tx from the
 * outside, rather than every repository method opening its own.
 *
 * The `Tx` type is intentionally minimal — just the `Database.Statement`
 * operations repositories actually need. If a caller needs direct
 * access to the underlying handle (e.g. for a FTS virtual-table query
 * that isn't yet modeled), they can import `Database` directly.
 */
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Transaction handle passed into repository methods. Today this is
 * simply an alias for `BetterSqlite3.Database`, because better-sqlite3
 * reuses the same `Database` instance inside a transaction — there is
 * no separate connection object. The alias exists so repository
 * signatures read intentionally (`tx: Tx` ≠ `db: Database`) and so a
 * future move to a real `Tx` type (e.g. if we swap engines) has one
 * place to land.
 */
export type Tx = BetterSqlite3.Database;

/**
 * Run `fn` inside a better-sqlite3 transaction. The returned value is
 * `fn`'s return value. Any throw inside `fn` rolls back the
 * transaction; a successful return commits.
 *
 * better-sqlite3 transactions are synchronous by design —
 * `db.transaction(...)` throws `TypeError: Transaction function cannot
 * return a promise` if the callback returns one. The `T extends Promise`
 * guard below rejects async callbacks at compile time so that trap
 * surfaces as a TS error instead of a runtime crash.
 */
export function withTx<T>(
  db: BetterSqlite3.Database,
  fn: (tx: Tx) => T extends Promise<unknown> ? never : T,
): T {
  const transactional = db.transaction((arg: BetterSqlite3.Database) => fn(arg));
  return transactional(db) as T;
}
