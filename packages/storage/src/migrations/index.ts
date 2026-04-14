/**
 * Migration registry — single baseline migration for dev mode.
 *
 * SCHEMA_SQL defines all tables in their final form, so this migration
 * is a no-op. It exists solely to record a version baseline.
 *
 * To add a new migration:
 * 1. Create a new file: `NNN-short-description.ts`
 * 2. Export a Migration object with the next sequential `version` number
 * 3. Import and add it to the `migrations` array below
 */
import type { Migration } from './runner.js';
import { migration001 } from './001-consolidated.js';

export const migrations: Migration[] = [
  migration001,
];
