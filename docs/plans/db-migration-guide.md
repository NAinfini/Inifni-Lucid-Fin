# SQLite Schema Migration Developer Guide

> How to evolve the Lucid Fin database schema safely.

---

## Table of Contents

1. [Current Architecture](#current-architecture)
2. [Adding a New Table](#adding-a-new-table)
3. [Adding a Column to an Existing Table](#adding-a-column-to-an-existing-table)
4. [Testing Schema Changes](#testing-schema-changes)
5. [Recovery and Repair](#recovery-and-repair)
6. [Common Pitfalls](#common-pitfalls)

---

## Current Architecture

### Overview

Lucid Fin uses **better-sqlite3** (synchronous, in-process SQLite) with an **inline idempotent schema** approach. There are no versioned migration files. The entire schema lives in a single source-of-truth file:

```
packages/storage/src/schema-sql.ts   -- SCHEMA_SQL constant (all CREATE TABLE / INDEX statements)
```

On every application start, `SqliteIndex` executes `SCHEMA_SQL` against the database:

```typescript
// packages/storage/src/sqlite-index.ts, constructor
constructor(dbPath: string) {
  this.db = new Database(dbPath);
  this.db.pragma('journal_mode = WAL');
  this.db.pragma('foreign_keys = ON');

  // SCHEMA_SQL is the single source of truth for storage tables.
  this.db.exec(SCHEMA_SQL);

  // ... initialize all repositories
}
```

Every statement uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, so the schema bootstrap is safe to re-run on an existing database. New tables and indexes appear automatically; existing ones are left untouched.

### Key Files

| File                                               | Role                                                       |
| -------------------------------------------------- | ---------------------------------------------------------- |
| `packages/storage/src/schema-sql.ts`               | Single source of truth for all DDL                         |
| `packages/storage/src/sqlite-index.ts`             | DB lifecycle: open, schema exec, close, repair, vacuum     |
| `packages/storage/src/storage-interfaces.ts`       | `IStorageLayer` and `RepoBundle` interfaces                |
| `packages/storage/src/transactions.ts`             | `withTx()` helper and `Tx` type alias                      |
| `packages/storage/src/repositories/*.ts`           | One repository per domain table (or table group)           |
| `packages/contracts-parse/src/storage/tables/*.ts` | Compile-time table/column constants (`defineTable`, `col`) |
| `packages/contracts-parse/src/tables.ts`           | `defineTable()` and `col()` factory functions              |
| `packages/storage/src/backup.ts`                   | Periodic backup / restore utilities                        |
| `packages/storage/src/migrations/`                 | **Empty** -- reserved for future versioned migrations      |

### Repository Layer

Each domain has its own repository class that receives a `BetterSqlite3.Database` in its constructor and owns all SQL for that domain. There are currently **18 repositories**:

| Repository                  | Table(s)                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `SessionRepository`         | `commander_sessions`                                                                                             |
| `CommanderEventRepository`  | `commander_events`                                                                                               |
| `JobRepository`             | `jobs`                                                                                                           |
| `AssetRepository`           | `assets`, `assets_fts`, `asset_embeddings`                                                                       |
| `CanvasRepository`          | `canvases`                                                                                                       |
| `CanvasNodeRepository`      | `canvas_nodes`                                                                                                   |
| `CanvasEdgeRepository`      | `canvas_edges`                                                                                                   |
| `EntityRepository`          | `characters`, `equipment`, `locations`                                                                           |
| `FolderRepository`          | `character_folders`, `equipment_folders`, `location_folders`, `asset_folders`                                    |
| `SeriesRepository`          | `series`, `episodes`                                                                                             |
| `PresetRepository`          | `preset_overrides`                                                                                               |
| `ShotTemplateRepository`    | `custom_shot_templates`                                                                                          |
| `SnapshotRepository`        | `snapshots`                                                                                                      |
| `WorkflowRepository`        | `workflow_runs`, `workflow_stage_runs`, `workflow_task_runs`, `workflow_task_dependencies`, `workflow_artifacts` |
| `ScriptRepository`          | `scripts`                                                                                                        |
| `ColorStyleRepository`      | `color_styles`                                                                                                   |
| `DependencyRepository`      | `dependencies`                                                                                                   |
| `ProjectSettingsRepository` | `project_settings`                                                                                               |

### Compile-Time Schema Safety

Column names are not hardcoded as strings in repository SQL. Instead, each table has a constant defined via `defineTable()` and `col()` in `packages/contracts-parse/src/storage/tables/`:

```typescript
// packages/contracts-parse/src/storage/tables/project-settings.ts
import { defineTable, col } from '../../tables.js';

export const ProjectSettingsTable = defineTable('project_settings', {
  key: col<string>('key'),
  value: col<string>('value'),
  updatedAt: col<number>('updated_at'),
});
```

Repositories reference these constants:

```typescript
// packages/storage/src/repositories/project-settings-repository.ts
const TBL = ProjectSettingsTable.tableName; // 'project_settings'
const C = ProjectSettingsTable.cols;

// Usage in queries:
d.prepare(`SELECT ${C.value.sqlName} FROM ${TBL} WHERE ${C.key.sqlName} = ?`);
```

If a column is renamed in the schema but not in the table constant, TypeScript catches it at compile time.

---

## Adding a New Table

Follow these steps to add a new table to the schema.

### Step 1: Add the DDL to `schema-sql.ts`

Append the `CREATE TABLE IF NOT EXISTS` statement at the end of `SCHEMA_SQL` (before the closing backtick). Add any indexes immediately after.

```typescript
// packages/storage/src/schema-sql.ts  (append inside SCHEMA_SQL template literal)

CREATE TABLE IF NOT EXISTS my_new_table (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  data_json   TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_my_new_table_updated
  ON my_new_table(updated_at DESC);
```

Conventions observed in the existing schema:

- **Primary key** is `TEXT` (UUIDs stored as strings), never `INTEGER AUTOINCREMENT`.
- **Timestamps** are `INTEGER NOT NULL` (Unix epoch milliseconds), except `canvas_nodes` / `canvas_edges` which use `TEXT` with `datetime('now')` defaults.
- **JSON blobs** are stored as `TEXT` with a `_json` suffix (e.g., `data_json`, `metadata_json`) and a `DEFAULT '{}'` or `DEFAULT '[]'`.
- **Boolean flags** use `INTEGER` (0/1), e.g., `is_user INTEGER NOT NULL DEFAULT 0`.
- **Foreign keys** use `REFERENCES` with `ON DELETE CASCADE` where appropriate.
- **Index naming**: `idx_{table}_{column(s)}`.

### Step 2: Define the table constant in `contracts-parse`

Create a new file in `packages/contracts-parse/src/storage/tables/`:

```typescript
// packages/contracts-parse/src/storage/tables/my-new-table.ts
import { defineTable, col } from '../../tables.js';

export const MyNewTableTable = defineTable('my_new_table', {
  id: col<string>('id'),
  name: col<string>('name'),
  dataJson: col<string>('data_json'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});
```

Then re-export from the barrel:

```typescript
// packages/contracts-parse/src/storage/tables/index.ts
export * from './my-new-table.js';
```

### Step 3: Define the domain type in `contracts`

If the table represents a new domain entity, add its TypeScript type in `packages/contracts/`:

```typescript
// packages/contracts/src/my-domain.ts  (new file or extend existing)
export interface MyEntity {
  id: string;
  name: string;
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}
```

### Step 4: Create the repository

Create `packages/storage/src/repositories/my-new-table-repository.ts`:

```typescript
import type BetterSqlite3 from 'better-sqlite3';
import type { MyEntity } from '@lucid-fin/contracts';
import { MyNewTableTable } from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

const TBL = MyNewTableTable.tableName;
const C = MyNewTableTable.cols;

function rowToEntity(row: Record<string, unknown>): MyEntity {
  return {
    id: row.id as string,
    name: row.name as string,
    data: JSON.parse((row.data_json as string) || '{}'),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export class MyNewTableRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  upsert(entity: MyEntity, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `INSERT INTO ${TBL}
         (${C.id.sqlName}, ${C.name.sqlName}, ${C.dataJson.sqlName},
          ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
         ${C.name.sqlName}=excluded.${C.name.sqlName},
         ${C.dataJson.sqlName}=excluded.${C.dataJson.sqlName},
         ${C.updatedAt.sqlName}=excluded.${C.updatedAt.sqlName}`,
    ).run(entity.id, entity.name, JSON.stringify(entity.data), entity.createdAt, entity.updatedAt);
  }

  get(id: string, tx?: Tx): MyEntity | null {
    const d = tx ?? this.db;
    const row = d.prepare(`SELECT * FROM ${TBL} WHERE ${C.id.sqlName} = ?`).get(id) as
      Record<string, unknown> | undefined;
    return row ? rowToEntity(row) : null;
  }

  list(tx?: Tx): MyEntity[] {
    const d = tx ?? this.db;
    const rows = d
      .prepare(`SELECT * FROM ${TBL} ORDER BY ${C.updatedAt.sqlName} DESC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map(rowToEntity);
  }

  delete(id: string, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${TBL} WHERE ${C.id.sqlName} = ?`).run(id);
  }
}
```

Key patterns from the codebase:

- Accept optional `tx?: Tx` parameter so callers can compose multi-repo writes in a single transaction via `withTx()`.
- Use `const d = tx ?? this.db;` at the top of each method.
- Reference columns via the table constant (`C.xxx.sqlName`), never hardcoded strings.
- Use `INSERT ... ON CONFLICT DO UPDATE` (upsert) pattern -- most repos do this.

### Step 5: Wire into `SqliteIndex`

Register the new repository in three places within `packages/storage/src/sqlite-index.ts`:

1. **Private field** declaration:

```typescript
private myNewTable!: MyNewTableRepository;
```

2. **Constructor** -- instantiate after `this.db.exec(SCHEMA_SQL)`:

```typescript
this.myNewTable = new MyNewTableRepository(this.db);
```

3. **`repos` getter** -- add to the `RepoBundle` return:

```typescript
get repos(): RepoBundle {
  return {
    // ... existing repos ...
    myNewTable: this.myNewTable,
  };
}
```

4. **`rebuildRepos()`** -- duplicate the constructor line so repair re-creates it:

```typescript
this.myNewTable = new MyNewTableRepository(this.db);
```

### Step 6: Update interfaces

Add the new repository to `RepoBundle` in `packages/storage/src/storage-interfaces.ts`:

```typescript
export interface RepoBundle {
  // ... existing entries ...
  myNewTable: MyNewTableRepository;
}
```

And add the export to `packages/storage/src/index.ts`:

```typescript
export { MyNewTableRepository } from './repositories/my-new-table-repository.js';
```

### Step 7: Write tests

See the [Testing Schema Changes](#testing-schema-changes) section below.

---

## Adding a Column to an Existing Table

SQLite has significant limitations for schema alterations. You cannot `DROP COLUMN` (in older SQLite versions) or `ALTER COLUMN`. What you **can** do is `ALTER TABLE ... ADD COLUMN`.

### Safe: Adding a Nullable Column with a Default

SQLite supports `ALTER TABLE t ADD COLUMN c TYPE DEFAULT val`. This is the safest approach.

#### Step 1: Add the column to the DDL in `schema-sql.ts`

Add the column to the existing `CREATE TABLE IF NOT EXISTS` statement:

```sql
-- Before (in schema-sql.ts):
CREATE TABLE IF NOT EXISTS characters (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- ... existing columns ...
  updated_at    INTEGER
);

-- After:
CREATE TABLE IF NOT EXISTS characters (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- ... existing columns ...
  nationality   TEXT DEFAULT '',     -- NEW
  updated_at    INTEGER
);
```

**Important**: `CREATE TABLE IF NOT EXISTS` only runs when the table does not exist at all. For existing databases, the table already exists so this statement is a no-op -- the new column will **not** appear.

#### Step 2: Add a migration `ALTER TABLE` statement

Since the schema bootstrap is idempotent-only (it skips existing tables), you need an explicit `ALTER TABLE` for existing databases. Add it at the **end** of `SCHEMA_SQL`, wrapped in an error-safe pattern:

```sql
-- At the end of SCHEMA_SQL, after all CREATE statements:

-- Migration: add nationality column to characters (2026-05-09)
-- ALTER TABLE ... ADD COLUMN is idempotent-safe: SQLite returns
-- "duplicate column name" if it already exists, which we swallow.
```

However, SQLite's `ALTER TABLE ADD COLUMN` is **not** natively idempotent -- it throws "duplicate column name" if the column already exists. The current codebase does not have a migration runner to handle this.

**Recommended approach** -- use a try/catch at the application level:

In `sqlite-index.ts`, add a post-bootstrap migration block after `this.db.exec(SCHEMA_SQL)`:

```typescript
// Idempotent column additions for existing databases.
// Each ALTER TABLE ADD COLUMN throws "duplicate column name" if
// the column already exists; we catch and ignore that specific error.
const addColumnMigrations = [`ALTER TABLE characters ADD COLUMN nationality TEXT DEFAULT ''`];

for (const sql of addColumnMigrations) {
  try {
    this.db.exec(sql);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (!msg.includes('duplicate column name')) throw err;
    // Column already exists -- skip.
  }
}
```

#### Step 3: Update the table constant

Add the new column to the table's `defineTable()` call in `contracts-parse`:

```typescript
// packages/contracts-parse/src/storage/tables/entities.ts
export const CharactersTable = defineTable('characters', {
  // ... existing cols ...
  nationality: col<string>('nationality'), // NEW
});
```

#### Step 4: Update the domain type, repository, and tests

- Add the field to the TypeScript interface in `@lucid-fin/contracts`.
- Update the repository's row-to-entity mapper and upsert SQL.
- Update tests.

### Unsafe: Renaming or Removing a Column

SQLite does not support `ALTER TABLE ... RENAME COLUMN` in all versions, and `DROP COLUMN` was only added in SQLite 3.35.0 (2021). The current approach for destructive column changes is:

1. Create a new table with the desired schema.
2. Copy data from the old table.
3. Drop the old table.
4. Rename the new table.

This is essentially what `SqliteIndex.repair()` does (see [Recovery and Repair](#recovery-and-repair)). For a schema migration that renames/removes columns, implement it as a repair-style migration within `sqlite-index.ts`:

```typescript
// In constructor, after this.db.exec(SCHEMA_SQL):
this.migrateV2();

private migrateV2(): void {
  const hasOldCol = this.db
    .prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('my_table') WHERE name = 'old_col'")
    .get() as { cnt: number };
  if (hasOldCol.cnt === 0) return; // Already migrated

  this.db.exec(`
    CREATE TABLE my_table_v2 ( /* new schema */ );
    INSERT INTO my_table_v2 (col_a, col_b)
      SELECT col_a, old_col FROM my_table;
    DROP TABLE my_table;
    ALTER TABLE my_table_v2 RENAME TO my_table;
  `);
}
```

---

## Testing Schema Changes

### Repository Test Pattern

Every repository test creates an **in-memory database** with a minimal schema, instantiates the repository, and exercises its methods. The schema string in the test is a subset of `SCHEMA_SQL` containing only the tables that repository needs.

```typescript
// packages/storage/src/repositories/my-new-table-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { MyNewTableRepository } from './my-new-table-repository.js';

const SCHEMA = `
CREATE TABLE my_new_table (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  data_json   TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  return db;
}

describe('MyNewTableRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: MyNewTableRepository;

  beforeEach(() => {
    db = openDb();
    repo = new MyNewTableRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('upsert + get round-trips', () => {
    const now = Date.now();
    repo.upsert({
      id: 'e1',
      name: 'Test',
      data: { foo: 'bar' },
      createdAt: now,
      updatedAt: now,
    });
    const got = repo.get('e1');
    expect(got).toBeDefined();
    expect(got!.name).toBe('Test');
    expect(got!.data).toEqual({ foo: 'bar' });
  });

  it('list returns rows ordered by updatedAt DESC', () => {
    repo.upsert({ id: 'a', name: 'A', data: {}, createdAt: 1, updatedAt: 1 });
    repo.upsert({ id: 'b', name: 'B', data: {}, createdAt: 2, updatedAt: 2 });
    const list = repo.list();
    expect(list[0].id).toBe('b');
    expect(list[1].id).toBe('a');
  });

  it('delete removes the row', () => {
    repo.upsert({ id: 'd1', name: 'D', data: {}, createdAt: 1, updatedAt: 1 });
    repo.delete('d1');
    expect(repo.get('d1')).toBeNull();
  });
});
```

### Running Tests

```bash
# Run all storage tests
cd packages/storage && pnpm exec vitest run

# Run a specific test file
cd packages/storage && pnpm exec vitest run src/repositories/my-new-table-repository.test.ts

# Typecheck (catches column-constant drift)
pnpm exec tsc --noEmit
```

### Schema Drift Detection

The compile-time table constants (`defineTable` / `col`) act as a drift detector. If you add a column to `schema-sql.ts` but forget to update the table constant in `contracts-parse`, any repository code that references the new column via `C.newCol.sqlName` will fail to compile. Conversely, if you remove a column from the DDL but leave it in the table constant, the repository will compile but fail at runtime with "no such column" -- so always keep both in sync.

The project also has `packages/contracts-parse/src/drift.test.ts` which validates that Zod schemas stay aligned with their TypeScript type counterparts. This same pattern could be extended to validate table constants against the actual DDL in the future.

---

## Recovery and Repair

### How Repair Works

`SqliteIndex.repair()` in `sqlite-index.ts` performs a full database recovery:

1. **Flush WAL** -- `PRAGMA wal_checkpoint(TRUNCATE)` to ensure all data is in the main file.
2. **Close and rename** -- The corrupt database is renamed to `{path}.corrupt.{timestamp}` as a backup.
3. **Create fresh database** -- A new database is created at a temporary path with `SCHEMA_SQL` applied (this gives it the latest schema).
4. **Copy data** -- Opens the corrupt backup as read-only, iterates all non-system, non-FTS tables via `sqlite_master`, and copies rows with `INSERT OR IGNORE`.
5. **Atomic swap** -- The new database is renamed into the original path.
6. **Rebuild repositories** -- All repository instances are re-created against the new database handle.

The repair result reports which tables were recovered successfully and which failed:

```typescript
interface RepairResult {
  recoveredTables: string[];
  failedTables: Array<{ name: string; error: string }>;
  backupReadable: boolean;
}
```

### Why This Matters for Migrations

Because the repair process creates a **fresh database** from `SCHEMA_SQL` and copies data row-by-row, any schema change in `SCHEMA_SQL` is automatically picked up during repair. This means:

- New tables added to `SCHEMA_SQL` will exist in the repaired database (empty, since no data exists in the old DB for them).
- New columns added to `CREATE TABLE` statements will appear in the repaired database (populated with their defaults for rows copied from the old DB, since `INSERT OR IGNORE` skips unknown-to-new columns gracefully).
- The repair path is a natural migration path for destructive schema changes.

### Backup System

The `backup.ts` module provides periodic full-snapshot backups:

- `createBackup(db, projectDir)` -- copies the DB file with SHA-256 verification.
- `restoreBackup(db, projectDir, filename)` -- restores from a named backup after integrity check.
- `listBackups(projectDir)` -- returns manifest entries.
- `purgeAllBackups(projectDir)` -- removes all backups.

Always ensure backups are current before running destructive migrations.

---

## Common Pitfalls

### 1. Forgetting that `CREATE TABLE IF NOT EXISTS` does not add columns

The `IF NOT EXISTS` clause means SQLite skips the entire statement if the table already exists. Adding a new column inside an existing `CREATE TABLE IF NOT EXISTS` block has **no effect** on existing databases. You must pair it with an `ALTER TABLE ADD COLUMN` migration (see [Adding a Column](#adding-a-column-to-an-existing-table)).

### 2. Adding a `NOT NULL` column without a default

`ALTER TABLE t ADD COLUMN c TEXT NOT NULL` will fail if the table already has rows, because existing rows would have `NULL` for the new column. Always provide a `DEFAULT`:

```sql
ALTER TABLE t ADD COLUMN c TEXT NOT NULL DEFAULT ''
```

### 3. Forgetting to update all sync points

When adding a table or column, you must update **all** of these:

| Sync Point             | Location                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------ |
| DDL                    | `packages/storage/src/schema-sql.ts`                                                 |
| Table constant         | `packages/contracts-parse/src/storage/tables/*.ts`                                   |
| Table barrel           | `packages/contracts-parse/src/storage/tables/index.ts`                               |
| Domain type            | `packages/contracts/src/...`                                                         |
| Repository             | `packages/storage/src/repositories/*.ts`                                             |
| `SqliteIndex` fields   | `packages/storage/src/sqlite-index.ts` (field, constructor, `repos`, `rebuildRepos`) |
| `RepoBundle` interface | `packages/storage/src/storage-interfaces.ts`                                         |
| Storage barrel export  | `packages/storage/src/index.ts`                                                      |
| Tests                  | `packages/storage/src/repositories/*.test.ts`                                        |

Missing any of these will cause either a compile error (good -- caught early) or a runtime error (bad -- caught in production).

### 4. JSON column encoding/decoding mismatch

The codebase stores complex objects as JSON-serialized `TEXT` columns. Always:

- `JSON.stringify()` on write.
- `JSON.parse()` on read with a fallback: `JSON.parse((row.col as string) || '{}')`.
- Keep the TypeScript type and JSON shape in sync.

### 5. Test schema diverging from production schema

Repository tests define their own `SCHEMA` constant (a subset of `SCHEMA_SQL`). If you change `schema-sql.ts`, remember to update the test schemas too. A mismatch can cause tests to pass while production fails, or vice versa.

### 6. Forgetting `rebuildRepos()` in `SqliteIndex`

`rebuildRepos()` is called by `repair()` to re-create all repository instances against the new database handle. If you add a new repository to the constructor but forget to add it to `rebuildRepos()`, the repair path will silently use a stale repository instance pointing at the closed old database.

### 7. FTS virtual tables require special handling

The `assets_fts` table uses `fts5` and has associated triggers (`assets_ai`, `assets_ad`, `assets_au`). FTS tables cannot be created with `CREATE TABLE IF NOT EXISTS` -- they use `CREATE VIRTUAL TABLE IF NOT EXISTS`. If you need full-text search on a new table, follow the `assets_fts` pattern exactly, including the insert/update/delete triggers.

### 8. Transaction scope

`better-sqlite3` transactions are synchronous. The `withTx()` helper rejects async callbacks at compile time. If your migration or repository method needs to do async work (e.g., file I/O), do it outside the transaction and pass the results in.

---

## Future: Versioned Migrations

The `packages/storage/src/migrations/` directory exists but is currently empty. If the project grows to need versioned migrations (e.g., for complex multi-step data transformations), a migration runner could:

1. Store the current schema version in `project_settings` (key: `schema_version`).
2. On boot, compare the stored version against the code version.
3. Run migration scripts sequentially (e.g., `001-add-nationality.ts`, `002-rename-column.ts`).
4. Update the stored version after each successful migration.

The `ProjectSettingsRepository` already provides the key-value store needed for tracking schema versions:

```typescript
const version = storage.repos.projectSettings.get('schema_version');
if (!version || parseInt(version) < CURRENT_SCHEMA_VERSION) {
  // run pending migrations
  storage.repos.projectSettings.set('schema_version', String(CURRENT_SCHEMA_VERSION));
}
```

Until then, the inline idempotent schema + per-column `ALTER TABLE ADD COLUMN` approach works for additive changes, and the repair path handles destructive changes as a last resort.
