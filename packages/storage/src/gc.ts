/**
 * Soft-delete garbage collection.
 * Purges entity rows where deleted_at is older than a configurable retention period.
 */
import type Database from 'better-sqlite3';

/** Default retention: 30 days in milliseconds. */
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface GcResult {
  characters: number;
  equipment: number;
  locations: number;
  total: number;
}

/**
 * Purge soft-deleted rows older than `retentionMs` from all entity tables.
 * Returns count of purged rows per table.
 */
export function purgeSoftDeleted(
  db: Database.Database,
  retentionMs: number = DEFAULT_RETENTION_MS,
): GcResult {
  const cutoff = Date.now() - retentionMs;
  const cutoffIso = new Date(cutoff).toISOString();

  const characters = db
    .prepare('DELETE FROM characters WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .run(cutoffIso).changes;
  const equipment = db
    .prepare('DELETE FROM equipment WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .run(cutoffIso).changes;
  const locations = db
    .prepare('DELETE FROM locations WHERE deleted_at IS NOT NULL AND deleted_at < ?')
    .run(cutoffIso).changes;

  return {
    characters,
    equipment,
    locations,
    total: characters + equipment + locations,
  };
}
