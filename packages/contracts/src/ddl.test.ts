import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const ddlUrl = new URL('../ddl/project-v1.sql', import.meta.url);

describe('canonical Project DDL', () => {
  it('creates a fresh schema without imported-history tables or columns', async () => {
    const ddl = await readFile(ddlUrl, 'utf8');
    const database = new DatabaseSync(':memory:');
    database.exec(ddl);
    const tables = database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as Array<{ name: string }>;

    expect(tables.map(({ name }) => name)).not.toContain('imported_history_batches');
    expect(ddl).not.toContain('originating_imported_run_id');
    expect(ddl).not.toContain('production_collections');
    database.close();
  });
});
