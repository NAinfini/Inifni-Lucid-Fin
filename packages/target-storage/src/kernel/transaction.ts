import type { DatabaseSync } from 'node:sqlite';
import { types } from 'node:util';

const activeTransactions = new WeakSet<DatabaseSync>();

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export function withImmediateTransaction<T>(database: DatabaseSync, callback: () => T): T {
  if (activeTransactions.has(database)) {
    throw new Error('Nested target-storage transactions are not allowed');
  }
  if (types.isAsyncFunction(callback)) {
    throw new TypeError('Target-storage transactions must be synchronous');
  }

  database.exec('BEGIN IMMEDIATE');
  activeTransactions.add(database);
  try {
    const result = callback();
    if (isPromiseLike(result)) {
      throw new TypeError('Target-storage transactions must be synchronous');
    }
    database.exec('COMMIT');
    return result;
  } catch (cause) {
    try {
      database.exec('ROLLBACK');
    } catch (rollbackCause) {
      throw new AggregateError(
        [cause, rollbackCause],
        'Target-storage transaction failed and could not be rolled back',
      );
    }
    throw cause;
  } finally {
    activeTransactions.delete(database);
  }
}
