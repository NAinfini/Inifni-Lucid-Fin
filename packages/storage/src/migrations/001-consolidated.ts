/**
 * Migration 001 — Consolidated dev migration (v7).
 *
 * No-op: SCHEMA_SQL already creates all tables in their final form.
 * This migration exists solely so the runner records version 7 in
 * schema_migrations, preventing future migrations from re-running.
 *
 * If you add a real migration later, increment the version number
 * and add it as 002-xxx.ts.
 */
import type { Migration } from './runner.js';

export const migration001: Migration = {
  version: 1,
  name: 'consolidated-dev-baseline',
  up() {
    // Intentionally empty — schema is fully defined in SCHEMA_SQL.
  },
};
