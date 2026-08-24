import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import type { TargetStore } from '../kernel/store.js';

const databases = new WeakMap<TargetStore, DatabaseSync>();

export function registerTargetStoreDatabase(store: TargetStore, database: DatabaseSync): void {
  if (databases.has(store)) {
    throw new TargetStorageError('STORE_NOT_OPEN', 'Target store is already registered');
  }
  databases.set(store, database);
}

export function unregisterTargetStoreDatabase(store: TargetStore): void {
  databases.delete(store);
}

export function getTargetStoreDatabase(store: TargetStore): DatabaseSync {
  const database = databases.get(store);
  if (database === undefined) {
    throw new TargetStorageError('STORE_NOT_OPEN', 'Target store is not open');
  }
  return database;
}
