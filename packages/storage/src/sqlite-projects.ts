import type BetterSqlite3 from 'better-sqlite3';

export function upsertProject(
  db: BetterSqlite3.Database,
  project: {
    id: string;
    title: string;
    path: string;
    seriesId?: string;
    updatedAt: number;
    thumbnail?: string;
  },
): void {
  db.prepare(
    `
    INSERT OR REPLACE INTO projects (id, title, path, series_id, updated_at, thumbnail)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    project.id,
    project.title,
    project.path,
    project.seriesId ?? null,
    project.updatedAt,
    project.thumbnail ?? null,
  );
}

export function listProjects(
  db: BetterSqlite3.Database,
): Array<{
  id: string;
  title: string;
  path: string;
  updatedAt: number;
  thumbnail?: string;
}> {
  return db
    .prepare(
      'SELECT id, title, path, updated_at as updatedAt, thumbnail FROM projects ORDER BY updated_at DESC',
    )
    .all() as Array<{
    id: string;
    title: string;
    path: string;
    updatedAt: number;
    thumbnail?: string;
  }>;
}
