/**
 * Pure type shapes for typed SQL table + column definitions.
 *
 * The runtime `defineTable` + `col` factories live in
 * `@lucid-fin/contracts-parse/storage`. This file is type-only so any
 * package (including the renderer, if it ever needs table metadata for
 * display) can reference the shapes without pulling zod.
 */

export interface ColumnDef<TSType = unknown, SqlName extends string = string> {
  readonly sqlName: SqlName;
  /** Phantom type — never present at runtime; used by the query builder. */
  readonly _type: TSType;
}

export interface TableDef<
  Name extends string = string,
  Cols extends Record<string, ColumnDef> = Record<string, ColumnDef>,
> {
  readonly tableName: Name;
  readonly cols: Cols;
}
