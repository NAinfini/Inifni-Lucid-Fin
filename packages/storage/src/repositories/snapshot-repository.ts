/**
 * SnapshotRepository — Phase G1-2.10.
 *
 * Wraps `snapshots` CRUD + prune + capture/restore behind the `SnapshotId`
 * brand. Sessions stay in `SessionRepository` (G1-2.1); this repo only owns
 * the snapshot table.
 *
 * Read paths (`get` / `list`) go through `parseOrDegrade` with ctx
 * `'Snapshot'` so corrupt scalar rows surface as degraded-read telemetry +
 * skip. The `data` JSON blob is kept as an opaque string — snapshot data
 * is not shaped per-row on read to avoid paying a multi-MB parse cost for
 * every HistoryPanel refresh.
 *
 * `captureSnapshot` / `restoreSnapshot` / `pruneSnapshotsTiered` are
 * preserved verbatim (with their session-stub and table whitelist logic)
 * because they drive multi-table transactional operations that cross
 * repository boundaries. A future refactor may decompose them further, but
 * this PR preserves behavior exactly.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { SessionId, SnapshotId } from '@lucid-fin/contracts';
import { parseOrDegrade, SnapshotsTable, StoredSnapshotSchema } from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

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
  scripts: unknown[];
  presetOverrides: unknown[];
}

export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

const TBL = SnapshotsTable.tableName;
const C = SnapshotsTable.cols;

const SELECT_COLS = [
  C.id.sqlName,
  C.sessionId.sqlName,
  C.label.sqlName,
  C.trigger.sqlName,
  C.data.sqlName,
  C.createdAt.sqlName,
].join(', ');

const SNAPSHOT_SENTINEL = Symbol('snapshot-degraded');

type RawRow = {
  id: string;
  session_id: string;
  label: string;
  trigger: string;
  data: string;
  created_at: number;
};

function rowToSnapshot(row: RawRow): StoredSnapshot {
  return {
    id: row.id,
    sessionId: row.session_id,
    label: row.label,
    trigger: row.trigger as 'auto' | 'manual',
    data: row.data,
    createdAt: row.created_at,
  };
}

const SNAPSHOT_TABLES = [
  'canvases',
  'characters',
  'equipment',
  'locations',
  'scripts',
  'preset_overrides',
] as const;

/** Discover column names from the live schema — future-proof against ALTER TABLE additions. */
function discoverColumns(db: BetterSqlite3.Database, table: string): string[] {
  const ALLOWED_TABLES = new Set(SNAPSHOT_TABLES as readonly string[]);
  if (!ALLOWED_TABLES.has(table)) throw new Error(`Disallowed table: ${table}`);
  const info = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return info.map((col) => col.name);
}

export class SnapshotRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  insert(snapshot: StoredSnapshot, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `INSERT OR IGNORE INTO ${TBL}
         (${C.id.sqlName}, ${C.sessionId.sqlName}, ${C.label.sqlName},
          ${C.trigger.sqlName}, ${C.data.sqlName}, ${C.createdAt.sqlName})
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      snapshot.id,
      snapshot.sessionId,
      snapshot.label,
      snapshot.trigger,
      snapshot.data,
      snapshot.createdAt,
    );
  }

  get(id: SnapshotId, tx?: Tx): StoredSnapshot | undefined {
    const d = tx ?? this.db;
    const row = d.prepare(`SELECT ${SELECT_COLS} FROM ${TBL} WHERE ${C.id.sqlName} = ?`).get(id) as
      | RawRow
      | undefined;
    if (!row) return undefined;
    const parsed = parseOrDegrade(
      StoredSnapshotSchema,
      rowToSnapshot(row),
      SNAPSHOT_SENTINEL as unknown as StoredSnapshot,
      { ctx: { name: 'Snapshot' } },
    );
    return (parsed as unknown) === SNAPSHOT_SENTINEL ? undefined : (parsed as StoredSnapshot);
  }

  list(sessionId: SessionId, tx?: Tx): ListResult<StoredSnapshot> {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT ${SELECT_COLS}
         FROM ${TBL}
         WHERE ${C.sessionId.sqlName} = ?
         ORDER BY ${C.createdAt.sqlName} DESC`,
      )
      .all(sessionId) as RawRow[];
    const out: StoredSnapshot[] = [];
    let degradedCount = 0;
    for (const row of rows) {
      const parsed = parseOrDegrade(
        StoredSnapshotSchema,
        rowToSnapshot(row),
        SNAPSHOT_SENTINEL as unknown as StoredSnapshot,
        { ctx: { name: 'Snapshot' } },
      );
      if ((parsed as unknown) === SNAPSHOT_SENTINEL) {
        degradedCount += 1;
        continue;
      }
      out.push(parsed as StoredSnapshot);
    }
    return { rows: out, degradedCount };
  }

  delete(id: SnapshotId, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${TBL} WHERE ${C.id.sqlName} = ?`).run(id);
  }

  /**
   * Keep only the N newest auto-triggered snapshots for a session.
   * Manual snapshots are never pruned by this helper.
   */
  prune(sessionId: SessionId, maxKeep: number, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `DELETE FROM ${TBL}
       WHERE ${C.sessionId.sqlName} = ?
         AND ${C.trigger.sqlName} = 'auto'
         AND ${C.id.sqlName} NOT IN (
           SELECT ${C.id.sqlName} FROM ${TBL}
           WHERE ${C.sessionId.sqlName} = ? AND ${C.trigger.sqlName} = 'auto'
           ORDER BY ${C.createdAt.sqlName} DESC LIMIT ?
         )`,
    ).run(sessionId, sessionId, maxKeep);
  }

  /**
   * Tiered retention policy — Time Machine style. Runs globally across ALL
   * sessions. Only prunes auto-triggered snapshots.
   *
   * Tiers:
   *   - Last 24 hours:  keep up to 20
   *   - 1–7 days:       keep 1 per 3-hour window
   *   - 7–30 days:      keep 1 per day
   *   - Older than 30d: delete
   */
  pruneTiered(tx?: Tx): void {
    const d = tx ?? this.db;
    const now = Date.now();
    const HOUR = 3_600_000;
    const DAY = 24 * HOUR;
    const t24h = now - DAY;
    const t7d = now - 7 * DAY;
    const t30d = now - 30 * DAY;

    // 1) Drop all auto snapshots older than 30 days.
    d.prepare(
      `DELETE FROM ${TBL} WHERE ${C.trigger.sqlName} = 'auto' AND ${C.createdAt.sqlName} < ?`,
    ).run(t30d);

    // 2) 7–30 days: keep newest per-day window.
    const weekToMonthRows = d
      .prepare(
        `SELECT ${C.id.sqlName} AS id, ${C.createdAt.sqlName} AS created_at
         FROM ${TBL}
         WHERE ${C.trigger.sqlName} = 'auto'
           AND ${C.createdAt.sqlName} >= ? AND ${C.createdAt.sqlName} < ?
         ORDER BY ${C.createdAt.sqlName} DESC`,
      )
      .all(t30d, t7d) as Array<{ id: string; created_at: number }>;
    const dayKeepers = pickOnePerWindow(weekToMonthRows, DAY);
    const dayDeleteIds = weekToMonthRows.filter((r) => !dayKeepers.has(r.id)).map((r) => r.id);
    if (dayDeleteIds.length > 0) {
      const placeholders = dayDeleteIds.map(() => '?').join(',');
      d.prepare(`DELETE FROM ${TBL} WHERE ${C.id.sqlName} IN (${placeholders})`).run(
        ...dayDeleteIds,
      );
    }

    // 3) 1–7 days: keep newest per 3-hour window.
    const dayToWeekRows = d
      .prepare(
        `SELECT ${C.id.sqlName} AS id, ${C.createdAt.sqlName} AS created_at
         FROM ${TBL}
         WHERE ${C.trigger.sqlName} = 'auto'
           AND ${C.createdAt.sqlName} >= ? AND ${C.createdAt.sqlName} < ?
         ORDER BY ${C.createdAt.sqlName} DESC`,
      )
      .all(t7d, t24h) as Array<{ id: string; created_at: number }>;
    const hourKeepers = pickOnePerWindow(dayToWeekRows, 3 * HOUR);
    const hourDeleteIds = dayToWeekRows.filter((r) => !hourKeepers.has(r.id)).map((r) => r.id);
    if (hourDeleteIds.length > 0) {
      const placeholders = hourDeleteIds.map(() => '?').join(',');
      d.prepare(`DELETE FROM ${TBL} WHERE ${C.id.sqlName} IN (${placeholders})`).run(
        ...hourDeleteIds,
      );
    }

    // 4) Last 24 hours: trim anything beyond 20 newest.
    const recentRows = d
      .prepare(
        `SELECT ${C.id.sqlName} AS id FROM ${TBL}
         WHERE ${C.trigger.sqlName} = 'auto' AND ${C.createdAt.sqlName} >= ?
         ORDER BY ${C.createdAt.sqlName} DESC`,
      )
      .all(t24h) as Array<{ id: string }>;
    if (recentRows.length > 20) {
      const trimIds = recentRows.slice(20).map((r) => r.id);
      const placeholders = trimIds.map(() => '?').join(',');
      d.prepare(`DELETE FROM ${TBL} WHERE ${C.id.sqlName} IN (${placeholders})`).run(...trimIds);
    }
  }

  capture(sessionId: SessionId, label: string, trigger: 'auto' | 'manual'): StoredSnapshot {
    const doCapture = this.db.transaction(() => {
      const data: Record<string, unknown[]> = {};
      for (const table of SNAPSHOT_TABLES) {
        const cols = discoverColumns(this.db, table);
        if (cols.length === 0) continue;
        data[table] = this.db.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all() as unknown[];
      }
      return data;
    });

    const data = doCapture();

    // Ensure the referenced session exists in SQLite (may only live in
    // Redux/localStorage at this point). Insert a minimal stub so the FK
    // on snapshots.session_id is satisfied.
    const now = Date.now();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO commander_sessions (id, canvas_id, title, messages, created_at, updated_at)
       VALUES (?, NULL, '', '[]', ?, ?)`,
      )
      .run(sessionId, now, now);

    const snap: StoredSnapshot = {
      id: crypto.randomUUID(),
      sessionId,
      label,
      trigger,
      data: JSON.stringify(data),
      createdAt: now,
    };
    this.insert(snap);
    return snap;
  }

  restore(snapshotId: SnapshotId): void {
    const snap = this.get(snapshotId);
    if (!snap) throw new Error(`Snapshot not found: ${snapshotId}`);
    const parsed = JSON.parse(snap.data) as Record<string, Array<Record<string, unknown>>>;

    const doRestore = this.db.transaction(() => {
      for (const table of SNAPSHOT_TABLES) {
        const rows = parsed[table] ?? [];
        const liveCols = new Set(discoverColumns(this.db, table));

        // Collect IDs of rows captured in this snapshot.
        const snapshotIds = rows
          .map((r) => r['id'] as string | undefined)
          .filter((id): id is string => typeof id === 'string');

        // Only delete rows that were part of the snapshot — leave other sessions' data intact.
        if (snapshotIds.length > 0) {
          const placeholders = snapshotIds.map(() => '?').join(', ');
          this.db.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders})`).run(...snapshotIds);
        }

        if (rows.length === 0) continue;

        const rawCols = Object.keys(rows[0]);
        const cols = rawCols.filter((c) => liveCols.has(c));
        if (cols.length === 0) continue;

        const safeCols = cols.map((c) => `"${c.replace(/"/g, '""')}"`);
        const placeholders = cols.map(() => '?').join(', ');
        const stmt = this.db.prepare(
          `INSERT OR REPLACE INTO ${table} (${safeCols.join(', ')}) VALUES (${placeholders})`,
        );
        for (const row of rows) {
          stmt.run(...cols.map((c) => row[c]));
        }
      }
    });

    doRestore();
  }
}

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
