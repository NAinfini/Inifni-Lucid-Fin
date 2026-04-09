import type { Canvas } from '@lucid-fin/contracts';
import type BetterSqlite3 from 'better-sqlite3';

export function upsertCanvas(db: BetterSqlite3.Database, canvas: Canvas): void {
  db.prepare(
    `
    INSERT INTO canvases (id, project_id, name, nodes, edges, viewport, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id=excluded.project_id, name=excluded.name,
      nodes=excluded.nodes, edges=excluded.edges, viewport=excluded.viewport,
      notes=excluded.notes, updated_at=excluded.updated_at
  `,
  ).run(
    canvas.id,
    canvas.projectId,
    canvas.name,
    JSON.stringify(canvas.nodes ?? []),
    JSON.stringify(canvas.edges ?? []),
    JSON.stringify(canvas.viewport ?? { x: 0, y: 0, zoom: 1 }),
    JSON.stringify(canvas.notes ?? []),
    canvas.createdAt,
    canvas.updatedAt,
  );
}

export function getCanvas(db: BetterSqlite3.Database, id: string): Canvas | undefined {
  const row = db.prepare('SELECT * FROM canvases WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return rowToCanvas(row);
}

export function listCanvases(
  db: BetterSqlite3.Database,
  projectId: string,
): Array<{ id: string; name: string; updatedAt: number }> {
  const rows = db
    .prepare('SELECT id, name, updated_at FROM canvases WHERE project_id = ? ORDER BY updated_at DESC')
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    updatedAt: r.updated_at as number,
  }));
}

export function listCanvasesFull(db: BetterSqlite3.Database, projectId: string): Canvas[] {
  const rows = db
    .prepare('SELECT * FROM canvases WHERE project_id = ? ORDER BY updated_at DESC')
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => rowToCanvas(r));
}

export function deleteCanvas(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM canvases WHERE id = ?').run(id);
}

function rowToCanvas(row: Record<string, unknown>): Canvas {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    name: row.name as string,
    nodes: JSON.parse((row.nodes as string) || '[]'),
    edges: JSON.parse((row.edges as string) || '[]'),
    viewport: JSON.parse((row.viewport as string) || '{"x":0,"y":0,"zoom":1}'),
    notes: JSON.parse((row.notes as string) || '[]'),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}
