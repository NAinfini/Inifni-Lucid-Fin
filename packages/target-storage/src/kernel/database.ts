import { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from './errors.js';

interface ForeignKeySettingRow {
  foreign_keys: number;
}

export function openConfiguredDatabase(path: string, readOnly: boolean): DatabaseSync {
  const database = new DatabaseSync(path, {
    allowExtension: false,
    defensive: true,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    readOnly,
  });
  try {
    database.enableDefensive(true);
    database.enableLoadExtension(false);
    const foreignKeys = database.prepare('PRAGMA foreign_keys').get() as unknown as
      ForeignKeySettingRow | undefined;
    if (foreignKeys?.foreign_keys !== 1) {
      throw new Error('PRAGMA foreign_keys is not enabled');
    }
  } catch (cause) {
    database.close();
    throw new TargetStorageError(
      'SECURITY_CONFIGURATION_FAILED',
      'SQLite security configuration could not be enforced',
      { cause },
    );
  }
  return database;
}
