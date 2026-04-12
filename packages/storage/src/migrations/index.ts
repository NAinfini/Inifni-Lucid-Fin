/**
 * Migration registry — import all migration files and export them as a sorted array.
 *
 * To add a new migration:
 * 1. Create a new file: `NNN-short-description.ts` (e.g. `002-add-scenes-table.ts`)
 * 2. Export a Migration object with a unique sequential `version` number
 * 3. Import and add it to the `migrations` array below
 *
 * The runner will execute them in version order and skip already-applied ones.
 */
import type { Migration } from './runner.js';
import { migration001 } from './001-baseline-columns.js';

export const migrations: Migration[] = [
  migration001,
];
