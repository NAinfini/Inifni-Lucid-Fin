import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectInventory } from '../../../../scripts/i0-baseline.ts';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';
import {
  preflightLegacySources,
  type LegacySourceExpectedSchema,
  type LegacySourceExpectedSchemas,
} from './source-preflight.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function sourceColumnDefinition(table: string, column: string): string {
  const quoted = quoteIdentifier(column);
  if (table === 'asset_contents' && column === 'hash') return `${quoted} TEXT PRIMARY KEY`;
  if (table === 'asset_entries' && column === 'id') return `${quoted} TEXT PRIMARY KEY`;
  if (table === 'asset_entries' && column === 'asset_hash') {
    return `${quoted} TEXT NOT NULL REFERENCES asset_contents(hash) ON DELETE RESTRICT`;
  }
  return `${quoted} TEXT`;
}

type SourceDatabaseName = keyof LegacySourceExpectedSchemas;

interface SourcePaths {
  readonly main: string;
  readonly prompts: string;
}

interface SourceSchemaOptions {
  readonly omitColumn?: {
    readonly database: SourceDatabaseName;
    readonly table: string;
    readonly column: string;
  };
  readonly omitTable?: { readonly database: SourceDatabaseName; readonly table: string };
  readonly regularTable?: { readonly database: SourceDatabaseName; readonly table: string };
}

function createSourceSchema(
  database: DatabaseSync,
  expected: LegacySourceExpectedSchema,
  databaseName: SourceDatabaseName,
  options: SourceSchemaOptions = {},
): void {
  for (const table of expected.tables) {
    if (options.omitTable?.database === databaseName && options.omitTable.table === table.name) {
      continue;
    }
    const columns = table.columns.filter(
      (column) =>
        options.omitColumn?.database !== databaseName ||
        options.omitColumn.table !== table.name ||
        options.omitColumn.column !== column,
    );
    if (
      table.kind === 'virtual' &&
      (options.regularTable?.database !== databaseName || options.regularTable.table !== table.name)
    ) {
      database.exec(
        `CREATE VIRTUAL TABLE ${quoteIdentifier(table.name)} USING fts5(${columns
          .map((column) => quoteIdentifier(column))
          .join(', ')});`,
      );
      continue;
    }
    database.exec(
      `CREATE TABLE ${quoteIdentifier(table.name)} (${columns
        .map((column) => sourceColumnDefinition(table.name, column))
        .join(', ')});`,
    );
  }
}

function insertDeterministicRows(
  database: DatabaseSync,
  expected: LegacySourceExpectedSchema,
): void {
  for (const table of expected.tables) {
    const columns = table.columns;
    const placeholders = columns.map(() => '?').join(', ');
    database
      .prepare(
        `INSERT INTO ${quoteIdentifier(table.name)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders})`,
      )
      .run(
        ...columns.map((column) =>
          table.name === 'asset_entries' && column === 'asset_hash'
            ? 'asset_contents.hash'
            : `${table.name}.${column}`,
        ),
      );
  }
}

function withSourceDatabases(
  paths: SourcePaths,
  operation: (databases: Readonly<Record<SourceDatabaseName, DatabaseSync>>) => void,
): void {
  const databases = {
    main: new DatabaseSync(paths.main),
    prompts: new DatabaseSync(paths.prompts),
  };
  try {
    operation(databases);
  } finally {
    databases.main.close();
    databases.prompts.close();
  }
}

function createSourceDatabases(paths: SourcePaths, options: SourceSchemaOptions = {}): void {
  withSourceDatabases(paths, (databases) => {
    for (const databaseName of ['main', 'prompts'] as const) {
      createSourceSchema(
        databases[databaseName],
        I0_LEGACY_SOURCE_SCHEMAS[databaseName],
        databaseName,
        options,
      );
    }
  });
}

function insertSourceRows(paths: SourcePaths): void {
  withSourceDatabases(paths, (databases) => {
    for (const databaseName of ['main', 'prompts'] as const) {
      insertDeterministicRows(databases[databaseName], I0_LEGACY_SOURCE_SCHEMAS[databaseName]);
    }
  });
}

async function sourcePaths(): Promise<SourcePaths> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-i2-m0-'));
  temporaryDirectories.push(directory);
  return {
    main: join(directory, 'legacy.sqlite'),
    prompts: join(directory, 'prompts.sqlite'),
  };
}

async function fileFingerprint(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function sourceFingerprints(paths: SourcePaths): Promise<Record<SourceDatabaseName, string>> {
  return {
    main: await fileFingerprint(paths.main),
    prompts: await fileFingerprint(paths.prompts),
  };
}

function readOnlyReport(paths: SourcePaths) {
  const databases = {
    main: new DatabaseSync(paths.main, { readOnly: true }),
    prompts: new DatabaseSync(paths.prompts, { readOnly: true }),
  };
  try {
    return preflightLegacySources(databases, I0_LEGACY_SOURCE_SCHEMAS);
  } finally {
    databases.main.close();
    databases.prompts.close();
  }
}

function flattenSourceCatalog(schemas: LegacySourceExpectedSchemas) {
  return Object.values(schemas)
    .flatMap((schema) => schema.tables)
    .map(({ name, kind, columns }) => ({ name, kind, columns }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

describe('Legacy source preflight', () => {
  it('matches all 39 I0 table and virtual-table declarations with their database owner', async () => {
    const inventorySchema = (await collectInventory(process.cwd())).schema
      .filter((item) => item.kind === 'table' || item.kind === 'virtual_table')
      .map(({ name, kind, columns }) => ({
        name,
        kind: kind === 'virtual_table' ? 'virtual' : 'table',
        columns,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    expect(flattenSourceCatalog(I0_LEGACY_SOURCE_SCHEMAS)).toHaveLength(39);
    expect(flattenSourceCatalog(I0_LEGACY_SOURCE_SCHEMAS)).toEqual(inventorySchema);
    expect(I0_LEGACY_SOURCE_SCHEMAS.main.tables).toHaveLength(37);
    expect(I0_LEGACY_SOURCE_SCHEMAS.prompts.tables.map((table) => table.name)).toEqual([
      'process_prompts',
      't_prompt_overrides',
    ]);
  });

  it('reports the complete I0 source schema from read-only main and prompts files without mutation', async () => {
    const paths = await sourcePaths();
    createSourceDatabases(paths);
    insertSourceRows(paths);
    const before = await sourceFingerprints(paths);

    const report = readOnlyReport(paths);

    expect(report).toMatchObject({
      databases: [
        {
          database: 'main',
          report: {
            integrity: { ok: true, messages: ['ok'] },
            foreignKeys: { ok: true, violations: [] },
            ok: true,
          },
        },
        {
          database: 'prompts',
          report: {
            integrity: { ok: true, messages: ['ok'] },
            foreignKeys: { ok: true, violations: [] },
            ok: true,
          },
        },
      ],
      blockers: [],
      ok: true,
    });
    expect(report.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(report.contentFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      report.databases.map(({ database, report: databaseReport }) => ({
        database,
        tableCount: databaseReport.tables.length,
      })),
    ).toEqual([
      { database: 'main', tableCount: 37 },
      { database: 'prompts', tableCount: 2 },
    ]);
    expect(await sourceFingerprints(paths)).toEqual(before);
  });

  it('blocks deterministic Legacy foreign-key violations alongside schema drift without mutation', async () => {
    const paths = await sourcePaths();
    createSourceDatabases(paths);
    insertSourceRows(paths);
    withSourceDatabases(paths, ({ main }) => {
      main.exec('PRAGMA foreign_keys = OFF;');
      main.exec("UPDATE asset_entries SET asset_hash = 'missing-content';");
      main.exec('CREATE TABLE unexpected_drift (id TEXT);');
    });
    const before = await sourceFingerprints(paths);

    const first = readOnlyReport(paths);
    const second = readOnlyReport(paths);

    expect(first.databases[0]).toMatchObject({
      database: 'main',
      report: {
        integrity: { ok: true, messages: ['ok'] },
        foreignKeys: {
          ok: false,
          violations: [
            {
              table: 'asset_entries',
              rowId: '1',
              parentTable: 'asset_contents',
              foreignKeyId: 0,
            },
          ],
        },
        ok: false,
      },
    });
    expect(first.blockers).toEqual([
      {
        database: 'main',
        blocker: {
          kind: 'foreign_key_violation',
          table: 'asset_entries',
          rowId: '1',
          parentTable: 'asset_contents',
          foreignKeyId: 0,
        },
      },
      {
        database: 'main',
        blocker: { kind: 'unknown_table', table: 'unexpected_drift' },
      },
    ]);
    expect(first).toEqual(second);
    expect(await sourceFingerprints(paths)).toEqual(before);
  });

  it('blocks a missing expected main-database column', async () => {
    const paths = await sourcePaths();
    createSourceDatabases(paths, {
      omitColumn: { database: 'main', table: 'canvases', column: 'updated_at' },
    });

    expect(readOnlyReport(paths).blockers).toEqual([
      {
        database: 'main',
        blocker: { kind: 'missing_column', table: 'canvases', column: 'updated_at' },
      },
    ]);
  });

  it('blocks a missing expected prompts-database table', async () => {
    const paths = await sourcePaths();
    createSourceDatabases(paths, {
      omitTable: { database: 'prompts', table: 'process_prompts' },
    });

    expect(readOnlyReport(paths).blockers).toEqual([
      {
        database: 'prompts',
        blocker: { kind: 'missing_table', table: 'process_prompts' },
      },
    ]);
  });

  it('blocks replacing the expected main-database FTS virtual table with a regular table', async () => {
    const paths = await sourcePaths();
    createSourceDatabases(paths, {
      regularTable: { database: 'main', table: 'asset_entries_fts' },
    });
    const before = await sourceFingerprints(paths);

    const report = readOnlyReport(paths);

    expect(report.ok).toBe(false);
    expect(report.blockers).toEqual([
      {
        database: 'main',
        blocker: {
          kind: 'unexpected_table_kind',
          table: 'asset_entries_fts',
          expected: 'virtual',
          actual: 'table',
        },
      },
    ]);
    expect(await sourceFingerprints(paths)).toEqual(before);
  });

  it('blocks unknown main-database table and column drift while ignoring FTS shadow tables', async () => {
    const paths = await sourcePaths();
    createSourceDatabases(paths);
    withSourceDatabases(paths, ({ main }) => {
      main.exec('ALTER TABLE canvases ADD COLUMN untracked TEXT;');
      main.exec('CREATE TABLE unexpected_drift (id TEXT);');
    });

    expect(readOnlyReport(paths).blockers).toEqual([
      {
        database: 'main',
        blocker: { kind: 'unknown_table', table: 'unexpected_drift' },
      },
      {
        database: 'main',
        blocker: { kind: 'unknown_column', table: 'canvases', column: 'untracked' },
      },
    ]);
  });

  it('is deterministic across separate read-only main and prompts handles', async () => {
    const paths = await sourcePaths();
    createSourceDatabases(paths);
    insertSourceRows(paths);

    expect(readOnlyReport(paths)).toEqual(readOnlyReport(paths));
  });
});
