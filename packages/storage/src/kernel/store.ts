import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { registerStoreDatabase, unregisterStoreDatabase } from '../internal/database-access.js';
import { loadCanonicalSchemaArtifacts } from './artifacts.js';
import { openConfiguredDatabase } from './database.js';
import { StorageError } from './errors.js';
import {
  assertCanonicalFingerprint,
  assertDatabaseHealthy,
  buildCanonicalSchemaFingerprint,
  computeSchemaFingerprint,
  type SchemaFingerprint,
} from './fingerprint.js';

export interface StoreSecurity {
  readonly defensive: true;
  readonly extensionLoading: false;
  readonly foreignKeys: true;
}

export interface Store {
  readonly databasePath: string;
  readonly schemaFingerprint: SchemaFingerprint;
  readonly security: StoreSecurity;
  close(): void;
}

export interface OpenOrCreateStoreResult {
  readonly created: boolean;
  readonly store: Store;
}

const enforcedSecurity = Object.freeze({
  defensive: true,
  extensionLoading: false,
  foreignKeys: true,
} as const);

class StoreHandle implements Store {
  readonly databasePath: string;
  readonly schemaFingerprint: SchemaFingerprint;
  readonly security = enforcedSecurity;
  #database: DatabaseSync | undefined;

  constructor(databasePath: string, database: DatabaseSync, schemaFingerprint: SchemaFingerprint) {
    this.databasePath = databasePath;
    this.#database = database;
    this.schemaFingerprint = schemaFingerprint;
    registerStoreDatabase(this, database);
  }

  close(): void {
    if (this.#database === undefined) return;
    unregisterStoreDatabase(this);
    this.#database.close();
    this.#database = undefined;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw cause;
  }
}

function validateOpenDatabase(
  database: DatabaseSync,
  canonical: SchemaFingerprint,
  artifacts: Awaited<ReturnType<typeof loadCanonicalSchemaArtifacts>>,
): SchemaFingerprint {
  assertDatabaseHealthy(database);
  const fingerprint = computeSchemaFingerprint(database, artifacts);
  assertCanonicalFingerprint(fingerprint, canonical);
  return fingerprint;
}

export async function openStore(databasePath: string): Promise<Store> {
  const absolutePath = resolve(databasePath);
  const artifacts = await loadCanonicalSchemaArtifacts();
  const canonical = buildCanonicalSchemaFingerprint(artifacts);

  let readOnly: DatabaseSync | undefined;
  try {
    readOnly = openConfiguredDatabase(absolutePath, true);
    validateOpenDatabase(readOnly, canonical, artifacts);
  } catch (cause) {
    if (cause instanceof StorageError) throw cause;
    throw new StorageError(
      'INTEGRITY_CHECK_FAILED',
      'SQLite database could not be opened for read-only validation',
      { cause },
    );
  } finally {
    readOnly?.close();
  }

  const writable = openConfiguredDatabase(absolutePath, false);
  try {
    const fingerprint = validateOpenDatabase(writable, canonical, artifacts);
    return new StoreHandle(absolutePath, writable, fingerprint);
  } catch (cause) {
    writable.close();
    throw cause;
  }
}

export async function createStore(databasePath: string): Promise<Store> {
  const absolutePath = resolve(databasePath);
  const directory = dirname(absolutePath);
  await mkdir(directory, { recursive: true });
  if (await pathExists(absolutePath)) {
    throw new StorageError('DATABASE_ALREADY_EXISTS', `Database already exists: ${absolutePath}`);
  }

  const artifacts = await loadCanonicalSchemaArtifacts();
  const canonical = buildCanonicalSchemaFingerprint(artifacts);
  const temporaryPath = join(directory, `.${basename(absolutePath)}.${randomUUID()}.tmp`);
  let temporary: DatabaseSync | undefined;
  try {
    temporary = openConfiguredDatabase(temporaryPath, false);
    temporary.exec(artifacts.ddl);
    validateOpenDatabase(temporary, canonical, artifacts);
    temporary.close();
    temporary = undefined;
    await rename(temporaryPath, absolutePath);
  } catch (cause) {
    temporary?.close();
    await unlink(temporaryPath).catch((unlinkCause: NodeJS.ErrnoException) => {
      if (unlinkCause.code !== 'ENOENT') throw unlinkCause;
    });
    throw cause;
  }

  const writable = openConfiguredDatabase(absolutePath, false);
  return new StoreHandle(absolutePath, writable, canonical);
}

export async function openOrCreateStore(databasePath: string): Promise<OpenOrCreateStoreResult> {
  const absolutePath = resolve(databasePath);
  if (await pathExists(absolutePath)) {
    return Object.freeze({ created: false, store: await openStore(absolutePath) });
  }
  try {
    return Object.freeze({ created: true, store: await createStore(absolutePath) });
  } catch (cause) {
    if (cause instanceof StorageError && cause.code === 'DATABASE_ALREADY_EXISTS') {
      return Object.freeze({ created: false, store: await openStore(absolutePath) });
    }
    throw cause;
  }
}
