# Historical evidence — superseded by the 2026-08-28 development reset

> This file is retained only as historical evidence. Its migration/rehearsal instructions must **not** be executed for the 2026-08-28 development reset, which creates a fresh canonical profile and performs no data migration. Refer to [`2026-08-28-development-cutover.md`](../../plans/2026-08-28-development-cutover.md).

# SQLite Canonical Schema Change Guide

This guide defines how Lucid Fin changes its development database without accumulating a runtime
migration chain.

## Current architecture

[`packages/storage/src/schema-sql.ts`](../../packages/storage/src/schema-sql.ts) is the only storage
DDL source. [`SqliteIndex`](../../packages/storage/src/sqlite-index.ts) has two startup paths:

- an empty database receives `SCHEMA_SQL` and is validated immediately;
- a non-empty database is compared with `SCHEMA_SQL` before journal pragmas, bootstrap DDL, or
  repository initialization.

[`assertCanonicalSchema`](../../packages/storage/src/schema-validation.ts) compares tables, columns,
defaults, foreign keys, named and automatic indexes, partial-index predicates, triggers, views,
table options, and CHECK clauses. Missing, extra, or changed structure throws a
`CanonicalSchemaError`. Startup does not guess, add columns, swallow duplicate-column errors, or
repair structural drift silently.

The repository does not use `user_version`, migration metadata tables, a schema-version constant, or
runtime migration files. Fields such as document `schema_version`, Task List `definition_version`,
and concurrency `revision` are domain protocol or CAS data; they are not database bootstrap state.

## Key files

| File                                           | Responsibility                                             |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `packages/storage/src/schema-sql.ts`           | Complete canonical DDL                                     |
| `packages/storage/src/schema-validation.ts`    | Strict structural comparison and startup guard             |
| `packages/storage/src/sqlite-index.ts`         | Database lifecycle, fresh creation, health, repair, vacuum |
| `packages/contracts-parse/src/storage/tables/` | Typed table and column names                               |
| `packages/storage/src/repositories/`           | Domain-owned SQL and row mapping                           |
| `packages/storage/src/backup.ts`               | Verified backup and restore support                        |

## Changing the schema during development

Changing `SCHEMA_SQL` is only the source-code half of a structural change. Existing development
databases will intentionally fail closed until their data is cut over.

### Change the canonical model

Update all affected facts together:

1. Contract and parser types.
2. `SCHEMA_SQL` tables, constraints, indexes, and triggers.
3. Typed table constants in `contracts-parse`.
4. Repository reads and writes.
5. Repository bundle wiring when a new repository is introduced.
6. Focused behavior and schema-validation tests.

Do not add an `ALTER TABLE` loop to normal startup. Do not catch “duplicate column” and continue.
Those approaches create multiple possible schemas and hide partial cutovers.

### Define the one-time cutover

For every existing development database in scope, write a temporary, bounded cutover that states:

- exact accepted pre-cutover structure;
- data invariants required before dropping or transforming anything;
- tables and row counts that must be preserved;
- transactional DDL and data transformation;
- post-cutover structure and business invariants;
- backup, failure copy, and restore behavior.

The cutover must reject unknown structure. It must not contain compatibility aliases, best-effort
fallbacks, or a generic “upgrade any old database” branch.

### Rehearse before applying

The required order is:

1. Checkpoint WAL and require `busy = 0`.
2. Run `integrity_check` and `foreign_key_check`.
3. Capture relevant business-table counts and invariants.
4. Create and fsync a SQLite backup; verify that backup independently.
5. Copy the backup and execute the cutover only on the copy.
6. Require canonical schema differences to be empty.
7. Require all protected counts and invariants to match.
8. Confirm the source database fingerprint did not change during rehearsal.
9. Obtain explicit approval for the real destructive cutover.
10. Apply the same transaction to the real database and repeat every postflight check.

Keep the verified pre-cutover backup and manifest. Remove the temporary cutover script, intermediate
schema code, and cutover-only tests after the real database is proven canonical.

## Testing requirements

At minimum, a structural change must cover:

- fresh database creation from `SCHEMA_SQL`;
- reopening an existing canonical database;
- rejection of a partial database before bootstrap writes;
- rejection of extra tables or columns;
- rejection of missing or changed indexes;
- rejection of foreign-key and CHECK-clause drift;
- repository behavior affected by the new structure;
- real-database rehearsal and postflight integrity checks.

Useful commands:

```powershell
pnpm test -- packages/storage/src
pnpm --filter @lucid-fin/storage run build
pnpm --filter @lucid-fin/desktop-main run build
pnpm -r --workspace-concurrency=1 --if-present run build
```

Use [`schema-validation.test.ts`](../../packages/storage/src/schema-validation.test.ts) for structural
drift cases. Repository tests may use minimal in-memory schemas, but those fixtures must include every
column the repository selects.

## Repair is not schema evolution

`SqliteIndex.repair()` is a recovery tool for a damaged canonical database. It creates a fresh
canonical database and copies readable rows where the current columns match. It is not a substitute
for a planned data transformation, and startup must never invoke it automatically to bypass
`CanonicalSchemaError`.

## Release boundary

The flat-schema policy is appropriate while Lucid Fin is in development and every persistent
database can be explicitly inventoried, backed up, rehearsed, and cut over. Before distributing a
release that must open unknown customer databases, define and approve a release-grade upgrade policy
instead of weakening canonical validation.
