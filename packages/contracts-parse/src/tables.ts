import type { TableDef, ColumnDef } from '@lucid-fin/contracts';

/**
 * Define a typed column reference. The generic `TSType` is phantom —
 * never present at runtime, but the query builder uses it to infer
 * the TS type of selected columns.
 */
export function col<TSType, SqlName extends string = string>(
  sqlName: SqlName,
): ColumnDef<TSType, SqlName> {
  return { sqlName, _type: undefined as never };
}

/**
 * Define a typed table with its columns. Produces a frozen object
 * so the constant can be imported across the storage package without
 * risk of mutation.
 */
export function defineTable<Name extends string, Cols extends Record<string, ColumnDef>>(
  tableName: Name,
  cols: Cols,
): TableDef<Name, Cols> {
  return Object.freeze({ tableName, cols: Object.freeze(cols) }) as TableDef<Name, Cols>;
}
