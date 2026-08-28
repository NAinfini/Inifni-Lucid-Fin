import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import type { Store } from '../kernel/store.js';

const databases = new WeakMap<Store, DatabaseSync>();

export function registerStoreDatabase(store: Store, database: DatabaseSync): void {
  if (databases.has(store)) {
    throw new StorageError('STORE_NOT_OPEN', 'Store is already registered');
  }
  databases.set(store, database);
}

export function unregisterStoreDatabase(store: Store): void {
  databases.delete(store);
}

export function getStoreDatabase(store: Store): DatabaseSync {
  const database = databases.get(store);
  if (database === undefined) {
    throw new StorageError('STORE_NOT_OPEN', 'Store is not open');
  }
  return database;
}
