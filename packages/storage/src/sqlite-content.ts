import type {
  Scene,
  ScriptDocument,
  ColorStyle,
  Series,
} from '@lucid-fin/contracts';
import type BetterSqlite3 from 'better-sqlite3';

// --- Scenes ---

export function upsertScene(db: BetterSqlite3.Database, scene: Scene): void {
  db.prepare(
    `
    INSERT INTO scenes (id, project_id, idx, title, description, location, time_of_day, characters, keyframes, segments, style_override, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id=excluded.project_id, idx=excluded.idx, title=excluded.title,
      description=excluded.description, location=excluded.location, time_of_day=excluded.time_of_day,
      characters=excluded.characters, keyframes=excluded.keyframes, segments=excluded.segments,
      style_override=excluded.style_override, updated_at=excluded.updated_at
  `,
  ).run(
    scene.id,
    scene.projectId,
    scene.index,
    scene.title,
    scene.description ?? '',
    scene.location ?? '',
    scene.timeOfDay ?? '',
    JSON.stringify(scene.characters ?? []),
    JSON.stringify(scene.keyframes ?? []),
    JSON.stringify(scene.segments ?? []),
    scene.styleOverride ? JSON.stringify(scene.styleOverride) : null,
    scene.createdAt,
    scene.updatedAt,
  );
}

export function getScene(db: BetterSqlite3.Database, id: string): Scene | undefined {
  const row = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return rowToScene(row);
}

export function listScenes(db: BetterSqlite3.Database, projectId: string): Scene[] {
  const rows = db
    .prepare('SELECT * FROM scenes WHERE project_id = ? ORDER BY idx ASC')
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => rowToScene(r));
}

export function deleteScene(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM scenes WHERE id = ?').run(id);
}

function rowToScene(row: Record<string, unknown>): Scene {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    index: row.idx as number,
    title: row.title as string,
    description: (row.description as string) ?? '',
    location: (row.location as string) ?? '',
    timeOfDay: (row.time_of_day as string) ?? '',
    characters: JSON.parse((row.characters as string) || '[]'),
    keyframes: JSON.parse((row.keyframes as string) || '[]'),
    segments: JSON.parse((row.segments as string) || '[]'),
    styleOverride: row.style_override ? JSON.parse(row.style_override as string) : undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

// --- Scripts ---

export function upsertScript(db: BetterSqlite3.Database, doc: ScriptDocument): void {
  db.prepare(
    `
    INSERT INTO scripts (id, project_id, content, format, parsed_scenes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id=excluded.project_id, content=excluded.content, format=excluded.format,
      parsed_scenes=excluded.parsed_scenes, updated_at=excluded.updated_at
  `,
  ).run(
    doc.id,
    doc.projectId,
    doc.content,
    doc.format,
    JSON.stringify(doc.parsedScenes ?? []),
    doc.createdAt,
    doc.updatedAt,
  );
}

export function getScript(
  db: BetterSqlite3.Database,
  projectId: string,
): ScriptDocument | null {
  const row = db
    .prepare('SELECT * FROM scripts WHERE project_id = ? ORDER BY updated_at DESC LIMIT 1')
    .get(projectId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToScript(row);
}

export function deleteScript(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM scripts WHERE id = ?').run(id);
}

function rowToScript(row: Record<string, unknown>): ScriptDocument {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    content: row.content as string,
    format: row.format as ScriptDocument['format'],
    parsedScenes: JSON.parse((row.parsed_scenes as string) || '[]'),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

// --- Color Styles ---

export function upsertColorStyle(db: BetterSqlite3.Database, cs: ColorStyle): void {
  db.prepare(
    `
    INSERT INTO color_styles (id, name, source_type, source_asset, palette, gradients, exposure, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, source_type=excluded.source_type, source_asset=excluded.source_asset,
      palette=excluded.palette, gradients=excluded.gradients, exposure=excluded.exposure,
      tags=excluded.tags, updated_at=excluded.updated_at
  `,
  ).run(
    cs.id,
    cs.name,
    cs.sourceType,
    cs.sourceAsset ?? null,
    JSON.stringify(cs.palette),
    JSON.stringify(cs.gradients),
    JSON.stringify(cs.exposure),
    JSON.stringify(cs.tags),
    cs.createdAt,
    cs.updatedAt,
  );
}

export function listColorStyles(db: BetterSqlite3.Database): ColorStyle[] {
  const rows = db
    .prepare('SELECT * FROM color_styles ORDER BY updated_at DESC')
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => rowToColorStyle(r));
}

export function deleteColorStyle(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM color_styles WHERE id = ?').run(id);
}

function rowToColorStyle(row: Record<string, unknown>): ColorStyle {
  return {
    id: row.id as string,
    name: row.name as string,
    sourceType: row.source_type as ColorStyle['sourceType'],
    sourceAsset: row.source_asset as string | undefined,
    palette: JSON.parse((row.palette as string) || '[]'),
    gradients: JSON.parse((row.gradients as string) || '[]'),
    exposure: JSON.parse((row.exposure as string) || '{}'),
    tags: JSON.parse((row.tags as string) || '[]'),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

// --- Dependencies ---

export function addDependency(
  db: BetterSqlite3.Database,
  sourceType: string,
  sourceId: string,
  targetType: string,
  targetId: string,
): void {
  db.prepare(
    `
    INSERT OR IGNORE INTO dependencies (source_type, source_id, target_type, target_id)
    VALUES (?, ?, ?, ?)
  `,
  ).run(sourceType, sourceId, targetType, targetId);
}

export function getDependents(
  db: BetterSqlite3.Database,
  sourceType: string,
  sourceId: string,
): Array<{ targetType: string; targetId: string }> {
  return db
    .prepare(
      'SELECT target_type as targetType, target_id as targetId FROM dependencies WHERE source_type = ? AND source_id = ?',
    )
    .all(sourceType, sourceId) as Array<{ targetType: string; targetId: string }>;
}

// --- Series & Episodes ---

export function upsertSeries(db: BetterSqlite3.Database, series: Series): void {
  db.prepare(
    `
    INSERT INTO series (id, title, description, style_guide, episode_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, description=excluded.description,
      style_guide=excluded.style_guide, episode_ids=excluded.episode_ids,
      updated_at=excluded.updated_at
  `,
  ).run(
    series.id,
    series.title,
    series.description ?? '',
    JSON.stringify(series.styleGuide ?? {}),
    JSON.stringify(series.episodeIds ?? []),
    series.createdAt,
    series.updatedAt,
  );
}

export function getSeries(db: BetterSqlite3.Database, id: string): Series | undefined {
  const row = db.prepare('SELECT * FROM series WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? '',
    styleGuide: JSON.parse((row.style_guide as string) || '{}'),
    episodeIds: JSON.parse((row.episode_ids as string) || '[]'),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export function deleteSeries(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM series WHERE id = ?').run(id);
  db.prepare('DELETE FROM episodes WHERE series_id = ?').run(id);
}

export function upsertEpisode(
  db: BetterSqlite3.Database,
  episode: {
    id: string;
    seriesId: string;
    title: string;
    order: number;
    projectId?: string;
    status?: string;
    createdAt: number;
    updatedAt: number;
  },
): void {
  db.prepare(
    `
    INSERT INTO episodes (id, series_id, title, episode_order, project_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      series_id=excluded.series_id, title=excluded.title, episode_order=excluded.episode_order,
      project_id=excluded.project_id, status=excluded.status, updated_at=excluded.updated_at
  `,
  ).run(
    episode.id,
    episode.seriesId,
    episode.title,
    episode.order,
    episode.projectId ?? null,
    episode.status ?? 'draft',
    episode.createdAt,
    episode.updatedAt,
  );
}

export function listEpisodes(
  db: BetterSqlite3.Database,
  seriesId: string,
): Array<{
  id: string;
  seriesId: string;
  title: string;
  order: number;
  projectId: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}> {
  const rows = db
    .prepare('SELECT * FROM episodes WHERE series_id = ? ORDER BY episode_order ASC')
    .all(seriesId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as string,
    seriesId: r.series_id as string,
    title: r.title as string,
    order: r.episode_order as number,
    projectId: (r.project_id as string) ?? null,
    status: (r.status as string) ?? 'draft',
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  }));
}

export function deleteEpisode(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM episodes WHERE id = ?').run(id);
}

// --- Preset Overrides ---

export function upsertPresetOverride(
  db: BetterSqlite3.Database,
  override: {
    id: string;
    projectId: string;
    presetId: string;
    category: string;
    name: string;
    description?: string;
    prompt?: string;
    params?: unknown[];
    defaults?: Record<string, unknown>;
    isUser: boolean;
    createdAt: number;
    updatedAt: number;
  },
): void {
  db.prepare(
    `
    INSERT INTO preset_overrides (id, project_id, preset_id, category, name, description, prompt, params, defaults, is_user, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      project_id=excluded.project_id, preset_id=excluded.preset_id, category=excluded.category,
      name=excluded.name, description=excluded.description, prompt=excluded.prompt,
      params=excluded.params, defaults=excluded.defaults, is_user=excluded.is_user,
      updated_at=excluded.updated_at
  `,
  ).run(
    override.id,
    override.projectId,
    override.presetId,
    override.category,
    override.name,
    override.description ?? '',
    override.prompt ?? '',
    JSON.stringify(override.params ?? []),
    JSON.stringify(override.defaults ?? {}),
    override.isUser ? 1 : 0,
    override.createdAt,
    override.updatedAt,
  );
}

export function listPresetOverrides(
  db: BetterSqlite3.Database,
  projectId: string,
): Array<{
  id: string;
  projectId: string;
  presetId: string;
  category: string;
  name: string;
  description: string;
  prompt: string;
  params: unknown[];
  defaults: Record<string, unknown>;
  isUser: boolean;
  createdAt: number;
  updatedAt: number;
}> {
  const rows = db
    .prepare('SELECT * FROM preset_overrides WHERE project_id = ? ORDER BY category, name')
    .all(projectId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    presetId: r.preset_id as string,
    category: r.category as string,
    name: r.name as string,
    description: (r.description as string) ?? '',
    prompt: (r.prompt as string) ?? '',
    params: JSON.parse((r.params as string) || '[]'),
    defaults: JSON.parse((r.defaults as string) || '{}'),
    isUser: (r.is_user as number) === 1,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  }));
}

export function deletePresetOverride(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM preset_overrides WHERE id = ?').run(id);
}

export function deletePresetOverridesByProject(
  db: BetterSqlite3.Database,
  projectId: string,
): void {
  db.prepare('DELETE FROM preset_overrides WHERE project_id = ?').run(projectId);
}
