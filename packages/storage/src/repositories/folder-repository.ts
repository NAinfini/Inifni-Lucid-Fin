/**
 * FolderStore — CRUD + tree operations for entity folders.
 *
 * One kind-parameterised class backs four physical tables:
 *   character_folders / equipment_folders / location_folders / asset_folders
 *
 * Each folder has a nullable `parent_id` forming a tree with unlimited depth.
 * Cycle prevention: `move()` walks up from `newParentId`; if it encounters `id`
 * the move is rejected with `FolderCycleError`.
 *
 * Cascade: `ON DELETE CASCADE` on the self-FK removes descendant folders.
 * Entities whose `folder_id` references any deleted folder get set to NULL
 * (= virtual "Uncategorized"). Those updates are handled by this class, not
 * a trigger, so the SQL stays simple and the behaviour is explicit.
 */

import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import type { Folder, FolderKind } from '@lucid-fin/contracts';

const FOLDER_TABLE: Record<FolderKind, string> = {
  character: 'character_folders',
  equipment: 'equipment_folders',
  location: 'location_folders',
  asset: 'asset_folders',
};

/**
 * Entity table + PK column whose `folder_id` column references
 * the corresponding folder table. Used when cascading folder deletes.
 * Assets use `hash` as PK, the other three use `id`.
 */
const ENTITY_TABLE: Record<FolderKind, { table: string; idCol: string }> = {
  character: { table: 'characters', idCol: 'id' },
  equipment: { table: 'equipment', idCol: 'id' },
  location: { table: 'locations', idCol: 'id' },
  asset: { table: 'assets', idCol: 'hash' },
};

export class FolderCycleError extends Error {
  constructor(message = 'Folder move would create a cycle') {
    super(message);
    this.name = 'FolderCycleError';
  }
}

export class FolderNotFoundError extends Error {
  constructor(id: string) {
    super(`Folder not found: ${id}`);
    this.name = 'FolderNotFoundError';
  }
}

function rowToFolder(kind: FolderKind, row: Record<string, unknown>): Folder {
  return {
    id: row.id as string,
    kind,
    parentId: (row.parent_id as string | null) ?? null,
    name: row.name as string,
    order: (row.sort_order as number) ?? 0,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export class FolderRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  list(kind: FolderKind): Folder[] {
    const table = FOLDER_TABLE[kind];
    const rows = this.db
      .prepare(`SELECT * FROM ${table} ORDER BY sort_order ASC, name ASC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => rowToFolder(kind, row));
  }

  get(kind: FolderKind, id: string): Folder | null {
    const table = FOLDER_TABLE[kind];
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToFolder(kind, row) : null;
  }

  create(kind: FolderKind, input: { parentId: string | null; name: string }): Folder {
    const table = FOLDER_TABLE[kind];
    const name = input.name.trim();
    if (!name) throw new Error('Folder name must be non-empty');

    if (input.parentId !== null && !this.get(kind, input.parentId)) {
      throw new FolderNotFoundError(input.parentId);
    }

    // Next sort_order = max(sort_order) + 1 within parent
    const maxRow = this.db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) AS m FROM ${table} WHERE (parent_id IS ? OR parent_id = ?)`,
      )
      .get(input.parentId, input.parentId) as { m: number } | undefined;
    const nextOrder = (maxRow?.m ?? -1) + 1;

    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO ${table} (id, parent_id, name, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.parentId, name, nextOrder, now, now);

    return {
      id,
      kind,
      parentId: input.parentId,
      name,
      order: nextOrder,
      createdAt: now,
      updatedAt: now,
    };
  }

  rename(kind: FolderKind, id: string, name: string): Folder {
    const table = FOLDER_TABLE[kind];
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Folder name must be non-empty');

    const existing = this.get(kind, id);
    if (!existing) throw new FolderNotFoundError(id);

    const now = Date.now();
    this.db
      .prepare(`UPDATE ${table} SET name = ?, updated_at = ? WHERE id = ?`)
      .run(trimmed, now, id);

    return { ...existing, name: trimmed, updatedAt: now };
  }

  /**
   * Move a folder to a new parent (or root if newParentId === null).
   * Rejects if:
   *  - folder doesn't exist
   *  - newParentId doesn't exist
   *  - newParentId is the folder itself or a descendant (cycle)
   */
  move(kind: FolderKind, id: string, newParentId: string | null): Folder {
    const table = FOLDER_TABLE[kind];
    const existing = this.get(kind, id);
    if (!existing) throw new FolderNotFoundError(id);

    if (newParentId !== null) {
      if (newParentId === id) throw new FolderCycleError();
      if (!this.get(kind, newParentId)) throw new FolderNotFoundError(newParentId);

      // Walk up from newParent to root; if we hit `id`, reject.
      let cursor: string | null = newParentId;
      const visited = new Set<string>();
      while (cursor !== null) {
        if (visited.has(cursor)) break; // defensive: corrupt data shouldn't hang
        visited.add(cursor);
        if (cursor === id) throw new FolderCycleError();
        const parent = this.get(kind, cursor);
        cursor = parent?.parentId ?? null;
      }
    }

    const now = Date.now();
    this.db
      .prepare(`UPDATE ${table} SET parent_id = ?, updated_at = ? WHERE id = ?`)
      .run(newParentId, now, id);

    return { ...existing, parentId: newParentId, updatedAt: now };
  }

  reorder(kind: FolderKind, id: string, order: number): Folder {
    const table = FOLDER_TABLE[kind];
    const existing = this.get(kind, id);
    if (!existing) throw new FolderNotFoundError(id);

    const now = Date.now();
    this.db
      .prepare(`UPDATE ${table} SET sort_order = ?, updated_at = ? WHERE id = ?`)
      .run(order, now, id);

    return { ...existing, order, updatedAt: now };
  }

  /**
   * Delete a folder. Descendant folders cascade via FK `ON DELETE CASCADE`.
   * Entities whose `folder_id` references the folder or any descendant are
   * set to NULL (virtual "Uncategorized") so no data is orphaned.
   */
  delete(kind: FolderKind, id: string): void {
    const folderTable = FOLDER_TABLE[kind];
    const { table: entityTable, idCol } = ENTITY_TABLE[kind];

    // Collect all descendant folder ids (including `id` itself) BEFORE delete
    // cascade removes them, so we can clear entity references.
    const descendantIds = this.collectDescendantIds(kind, id);
    if (descendantIds.length === 0) return;

    const placeholders = descendantIds.map(() => '?').join(', ');

    const tx = this.db.transaction(() => {
      // Clear entity folder_id refs first (FK isn't set on entity tables, so
      // a manual UPDATE is required and the order doesn't strictly matter,
      // but clearing first keeps the data consistent if anything fails mid-way).
      this.db
        .prepare(`UPDATE ${entityTable} SET folder_id = NULL WHERE folder_id IN (${placeholders})`)
        .run(...descendantIds);

      // Deleting the root triggers ON DELETE CASCADE on descendants.
      this.db.prepare(`DELETE FROM ${folderTable} WHERE id = ?`).run(id);
    });
    tx();
    // Bind `tx` via getter to silence unused — `this.db.transaction(...)` returns
    // a callable; we invoked it above. Nothing else to do.
    void idCol;
  }

  /**
   * Return all folder ids in the subtree rooted at `rootId` (inclusive).
   * Uses iterative BFS off the repository — fine for human-scale trees.
   */
  private collectDescendantIds(kind: FolderKind, rootId: string): string[] {
    const table = FOLDER_TABLE[kind];
    const out: string[] = [];
    const queue: string[] = [rootId];
    const stmt = this.db.prepare(`SELECT id FROM ${table} WHERE parent_id = ?`);
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      out.push(cur);
      const children = stmt.all(cur) as Array<{ id: string }>;
      for (const c of children) queue.push(c.id);
    }
    return out;
  }
}
