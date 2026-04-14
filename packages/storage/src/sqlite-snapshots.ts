import type BetterSqlite3 from 'better-sqlite3';

export interface StoredSession {
  id: string;
  canvasId: string | null;
  title: string;
  messages: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredSnapshot {
  id: string;
  sessionId: string;
  label: string;
  trigger: 'auto' | 'manual';
  data: string;
  createdAt: number;
}

export interface SnapshotData {
  canvases: unknown[];
  characters: unknown[];
  equipment: unknown[];
  locations: unknown[];
  scenes: unknown[];
  scripts: unknown[];
  presetOverrides: unknown[];
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function upsertSession(db: BetterSqlite3.Database, s: StoredSession): void {
  db.prepare(`
    INSERT INTO commander_sessions (id, canvas_id, title, messages, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      canvas_id  = excluded.canvas_id,
      title      = excluded.title,
      messages   = excluded.messages,
      updated_at = excluded.updated_at
  `).run(s.id, s.canvasId ?? null, s.title, s.messages, s.createdAt, s.updatedAt);
}

export function getSession(db: BetterSqlite3.Database, id: string): StoredSession | undefined {
  const row = db.prepare(
    'SELECT id, canvas_id, title, messages, created_at, updated_at FROM commander_sessions WHERE id = ?'
  ).get(id) as RawSession | undefined;
  if (!row) return undefined;
  return rowToSession(row);
}

export function listSessions(db: BetterSqlite3.Database, limit = 50): StoredSession[] {
  const rows = db.prepare(
    'SELECT id, canvas_id, title, messages, created_at, updated_at FROM commander_sessions ORDER BY updated_at DESC LIMIT ?'
  ).all(limit) as RawSession[];
  return rows.map(rowToSession);
}

export function deleteSession(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM commander_sessions WHERE id = ?').run(id);
}

type RawSession = {
  id: string;
  canvas_id: string | null;
  title: string;
  messages: string;
  created_at: number;
  updated_at: number;
};

function rowToSession(row: RawSession): StoredSession {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    title: row.title,
    messages: row.messages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export function insertSnapshot(db: BetterSqlite3.Database, s: StoredSnapshot): void {
  db.prepare(`
    INSERT OR IGNORE INTO snapshots (id, session_id, label, trigger, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(s.id, s.sessionId, s.label, s.trigger, s.data, s.createdAt);
}

export function getSnapshot(db: BetterSqlite3.Database, id: string): StoredSnapshot | undefined {
  const row = db.prepare(
    'SELECT id, session_id, label, trigger, data, created_at FROM snapshots WHERE id = ?'
  ).get(id) as RawSnapshot | undefined;
  if (!row) return undefined;
  return rowToSnapshot(row);
}

export function listSnapshots(db: BetterSqlite3.Database, sessionId: string): StoredSnapshot[] {
  const rows = db.prepare(
    'SELECT id, session_id, label, trigger, data, created_at FROM snapshots WHERE session_id = ? ORDER BY created_at DESC'
  ).all(sessionId) as RawSnapshot[];
  return rows.map(rowToSnapshot);
}

export function deleteSnapshot(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM snapshots WHERE id = ?').run(id);
}

/**
 * Simple per-session prune: keep only the N newest snapshots for a session.
 * Only affects auto-triggered snapshots; manual snapshots are never pruned.
 */
export function pruneSnapshots(db: BetterSqlite3.Database, sessionId: string, maxKeep: number): void {
  db.prepare(`
    DELETE FROM snapshots
    WHERE session_id = ?
      AND trigger = 'auto'
      AND id NOT IN (
        SELECT id FROM snapshots WHERE session_id = ? AND trigger = 'auto' ORDER BY created_at DESC LIMIT ?
      )
  `).run(sessionId, sessionId, maxKeep);
}

/**
 * Tiered retention policy — Time Machine style.
 * Runs globally across ALL sessions. Only prunes auto-triggered snapshots;
 * manual snapshots are NEVER deleted by this function.
 *
 * Tiers:
 *   - Last 24 hours:  keep all (up to 20)
 *   - 1–7 days old:   keep 1 per 3-hour window (~8 per day max)
 *   - 7–30 days old:  keep 1 per day
 *   - Older than 30d: delete
 */
export function pruneSnapshotsTiered(db: BetterSqlite3.Database): void {
  const now = Date.now();
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  const t24h  = now - DAY;
  const t7d   = now - 7 * DAY;
  const t30d  = now - 30 * DAY;

  // 1) Delete all auto snapshots older than 30 days
  db.prepare(`
    DELETE FROM snapshots WHERE trigger = 'auto' AND created_at < ?
  `).run(t30d);

  // 2) 7–30 days: keep 1 per day (the newest in each day window)
  //    Group by floor(created_at / DAY), keep max(created_at) per group
  const weekToMonthRows = db.prepare(`
    SELECT id, created_at FROM snapshots
    WHERE trigger = 'auto' AND created_at >= ? AND created_at < ?
    ORDER BY created_at DESC
  `).all(t30d, t7d) as Array<{ id: string; created_at: number }>;

  const dayKeepers = pickOnePerWindow(weekToMonthRows, DAY);
  const dayDeleteIds = weekToMonthRows
    .filter(r => !dayKeepers.has(r.id))
    .map(r => r.id);
  if (dayDeleteIds.length > 0) {
    const placeholders = dayDeleteIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM snapshots WHERE id IN (${placeholders})`).run(...dayDeleteIds);
  }

  // 3) 1–7 days: keep 1 per 3-hour window
  const dayToWeekRows = db.prepare(`
    SELECT id, created_at FROM snapshots
    WHERE trigger = 'auto' AND created_at >= ? AND created_at < ?
    ORDER BY created_at DESC
  `).all(t7d, t24h) as Array<{ id: string; created_at: number }>;

  const hourKeepers = pickOnePerWindow(dayToWeekRows, 3 * HOUR);
  const hourDeleteIds = dayToWeekRows
    .filter(r => !hourKeepers.has(r.id))
    .map(r => r.id);
  if (hourDeleteIds.length > 0) {
    const placeholders = hourDeleteIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM snapshots WHERE id IN (${placeholders})`).run(...hourDeleteIds);
  }

  // 4) Last 24 hours: keep up to 20 (trim oldest beyond 20)
  const recentRows = db.prepare(`
    SELECT id FROM snapshots
    WHERE trigger = 'auto' AND created_at >= ?
    ORDER BY created_at DESC
  `).all(t24h) as Array<{ id: string }>;

  if (recentRows.length > 20) {
    const trimIds = recentRows.slice(20).map(r => r.id);
    const placeholders = trimIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM snapshots WHERE id IN (${placeholders})`).run(...trimIds);
  }
}

/** Pick the newest snapshot per time window from a list sorted by created_at DESC. */
function pickOnePerWindow(
  rows: Array<{ id: string; created_at: number }>,
  windowMs: number,
): Set<string> {
  const kept = new Set<string>();
  const seenWindows = new Set<number>();
  for (const row of rows) {
    const windowKey = Math.floor(row.created_at / windowMs);
    if (!seenWindows.has(windowKey)) {
      seenWindows.add(windowKey);
      kept.add(row.id);
    }
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Capture / Restore
// ---------------------------------------------------------------------------

const SNAPSHOT_TABLES = [
  'canvases',
  'characters',
  'equipment',
  'locations',
  'scenes',
  'scripts',
  'preset_overrides',
] as const;

/**
 * Hardcoded whitelist of allowed column names per snapshot table.
 * Derived from SCHEMA_SQL in sqlite-index.ts. Any column not listed here
 * will be rejected during restore to prevent SQL injection via crafted
 * snapshot data.
 */
const SNAPSHOT_TABLE_COLUMNS: Record<(typeof SNAPSHOT_TABLES)[number], readonly string[]> = {
  canvases: [
    'id', 'name', 'nodes', 'edges', 'viewport', 'notes', 'created_at', 'updated_at',
  ],
  characters: [
    'id', 'name', 'role', 'description', 'appearance', 'personality', 'ref_image',
    'costumes', 'tags', 'age', 'gender', 'voice', 'reference_images',
    'loadouts', 'default_loadout_id', 'created_at', 'updated_at',
  ],
  equipment: [
    'id', 'name', 'type', 'subtype', 'description', 'function_desc',
    'tags', 'reference_images', 'created_at', 'updated_at',
  ],
  locations: [
    'id', 'name', 'type', 'sub_location', 'description', 'time_of_day',
    'mood', 'weather', 'lighting', 'tags', 'reference_images', 'created_at', 'updated_at',
  ],
  scenes: [
    'id', 'idx', 'title', 'description', 'location', 'time_of_day',
    'characters', 'keyframes', 'segments', 'style_override', 'created_at', 'updated_at',
  ],
  scripts: [
    'id', 'content', 'format', 'parsed_scenes', 'created_at', 'updated_at',
  ],
  preset_overrides: [
    'id', 'preset_id', 'category', 'name', 'description', 'prompt',
    'params', 'defaults', 'is_user', 'created_at', 'updated_at',
  ],
};

export function captureSnapshot(
  db: BetterSqlite3.Database,
  sessionId: string,
  label: string,
  trigger: 'auto' | 'manual',
): StoredSnapshot {
  const data: Record<string, unknown[]> = {};
  for (const table of SNAPSHOT_TABLES) {
    const cols = SNAPSHOT_TABLE_COLUMNS[table];
    data[table] = db.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all() as unknown[];
  }

  const snap: StoredSnapshot = {
    id: crypto.randomUUID(),
    sessionId,
    label,
    trigger,
    data: JSON.stringify(data),
    createdAt: Date.now(),
  };
  insertSnapshot(db, snap);
  return snap;
}

export function restoreSnapshot(db: BetterSqlite3.Database, snapshotId: string): void {
  const snap = getSnapshot(db, snapshotId);
  if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`);

  const parsed = JSON.parse(snap.data) as Record<string, Array<Record<string, unknown>>>;

  const doRestore = db.transaction(() => {
    for (const table of SNAPSHOT_TABLES) {
      const rows = parsed[table] ?? [];
      db.exec(`DELETE FROM ${table}`);
      if (rows.length === 0) continue;

      const allowedCols = new Set<string>(SNAPSHOT_TABLE_COLUMNS[table]);
      const rawCols = Object.keys(rows[0]);
      const unknownCols = rawCols.filter(c => !allowedCols.has(c));
      if (unknownCols.length > 0) {
        throw new Error(
          `Snapshot restore blocked: table "${table}" contains disallowed columns: ${unknownCols.join(', ')}`,
        );
      }
      // Only use columns that are both present in the data and whitelisted
      const cols = rawCols.filter(c => allowedCols.has(c));
      if (cols.length === 0) continue;

      const placeholders = cols.map(() => '?').join(', ');
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
      );
      for (const row of rows) {
        stmt.run(...cols.map(c => row[c]));
      }
    }
  });

  doRestore();
}

type RawSnapshot = {
  id: string;
  session_id: string;
  label: string;
  trigger: string;
  data: string;
  created_at: number;
};

function rowToSnapshot(row: RawSnapshot): StoredSnapshot {
  return {
    id: row.id,
    sessionId: row.session_id,
    label: row.label,
    trigger: row.trigger as 'auto' | 'manual',
    data: row.data,
    createdAt: row.created_at,
  };
}
