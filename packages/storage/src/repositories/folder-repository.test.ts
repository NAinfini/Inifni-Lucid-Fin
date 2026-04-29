import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { FolderRepository, FolderCycleError, FolderNotFoundError } from './folder-repository.js';

const SCHEMA = `
CREATE TABLE character_folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES character_folders(id) ON DELETE CASCADE
);
CREATE TABLE equipment_folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES equipment_folders(id) ON DELETE CASCADE
);
CREATE TABLE location_folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES location_folders(id) ON DELETE CASCADE
);
CREATE TABLE asset_folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES asset_folders(id) ON DELETE CASCADE
);
CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder_id TEXT
);
CREATE TABLE equipment (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder_id TEXT
);
CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder_id TEXT
);
CREATE TABLE assets (
  hash TEXT PRIMARY KEY,
  folder_id TEXT
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

describe('FolderRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: FolderRepository;

  beforeEach(() => {
    db = openDb();
    repo = new FolderRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('creates a root folder with sort_order 0', () => {
      const f = repo.create('character', { parentId: null, name: 'Heroes' });
      expect(f.id).toBeTruthy();
      expect(f.kind).toBe('character');
      expect(f.parentId).toBeNull();
      expect(f.name).toBe('Heroes');
      expect(f.order).toBe(0);
    });

    it('assigns ascending sort_order within same parent', () => {
      const a = repo.create('character', { parentId: null, name: 'A' });
      const b = repo.create('character', { parentId: null, name: 'B' });
      const c = repo.create('character', { parentId: null, name: 'C' });
      expect(a.order).toBe(0);
      expect(b.order).toBe(1);
      expect(c.order).toBe(2);
    });

    it('creates nested folder with its own sort_order counter', () => {
      const root = repo.create('character', { parentId: null, name: 'Heroes' });
      const knight = repo.create('character', { parentId: root.id, name: 'Knight' });
      const mage = repo.create('character', { parentId: root.id, name: 'Mage' });
      expect(knight.order).toBe(0);
      expect(mage.order).toBe(1);
      expect(knight.parentId).toBe(root.id);
    });

    it('rejects empty name', () => {
      expect(() => repo.create('character', { parentId: null, name: '   ' })).toThrow();
    });

    it('rejects non-existent parent', () => {
      expect(() => repo.create('character', { parentId: 'bogus', name: 'x' })).toThrow(
        FolderNotFoundError,
      );
    });
  });

  describe('list / get', () => {
    it('lists all folders sorted by order, name', () => {
      const a = repo.create('character', { parentId: null, name: 'Alpha' });
      const b = repo.create('character', { parentId: null, name: 'Beta' });
      const list = repo.list('character');
      expect(list.map((f) => f.id)).toEqual([a.id, b.id]);
    });

    it('returns null for missing folder', () => {
      expect(repo.get('character', 'missing')).toBeNull();
    });

    it('kinds are isolated', () => {
      repo.create('character', { parentId: null, name: 'Heroes' });
      expect(repo.list('equipment')).toHaveLength(0);
      expect(repo.list('location')).toHaveLength(0);
      expect(repo.list('asset')).toHaveLength(0);
    });
  });

  describe('rename', () => {
    it('renames an existing folder', () => {
      const f = repo.create('character', { parentId: null, name: 'old' });
      const renamed = repo.rename('character', f.id, 'new');
      expect(renamed.name).toBe('new');
      expect(repo.get('character', f.id)?.name).toBe('new');
    });

    it('rejects empty name', () => {
      const f = repo.create('character', { parentId: null, name: 'x' });
      expect(() => repo.rename('character', f.id, '')).toThrow();
    });

    it('rejects unknown id', () => {
      expect(() => repo.rename('character', 'missing', 'x')).toThrow(FolderNotFoundError);
    });
  });

  describe('move', () => {
    it('reparents folder', () => {
      const a = repo.create('character', { parentId: null, name: 'A' });
      const b = repo.create('character', { parentId: null, name: 'B' });
      const moved = repo.move('character', b.id, a.id);
      expect(moved.parentId).toBe(a.id);
    });

    it('moves to root (newParentId=null)', () => {
      const a = repo.create('character', { parentId: null, name: 'A' });
      const child = repo.create('character', { parentId: a.id, name: 'Child' });
      const moved = repo.move('character', child.id, null);
      expect(moved.parentId).toBeNull();
    });

    it('rejects moving folder onto itself', () => {
      const a = repo.create('character', { parentId: null, name: 'A' });
      expect(() => repo.move('character', a.id, a.id)).toThrow(FolderCycleError);
    });

    it('rejects cycle: cannot move parent into its descendant', () => {
      const a = repo.create('character', { parentId: null, name: 'A' });
      const b = repo.create('character', { parentId: a.id, name: 'B' });
      const c = repo.create('character', { parentId: b.id, name: 'C' });
      expect(() => repo.move('character', a.id, c.id)).toThrow(FolderCycleError);
    });

    it('rejects non-existent target', () => {
      const a = repo.create('character', { parentId: null, name: 'A' });
      expect(() => repo.move('character', a.id, 'bogus')).toThrow(FolderNotFoundError);
    });
  });

  describe('delete', () => {
    it('deletes folder and cascades children', () => {
      const a = repo.create('character', { parentId: null, name: 'A' });
      const b = repo.create('character', { parentId: a.id, name: 'B' });
      const c = repo.create('character', { parentId: b.id, name: 'C' });
      repo.delete('character', a.id);
      expect(repo.get('character', a.id)).toBeNull();
      expect(repo.get('character', b.id)).toBeNull();
      expect(repo.get('character', c.id)).toBeNull();
    });

    it('clears folder_id on entities within deleted subtree', () => {
      const a = repo.create('character', { parentId: null, name: 'A' });
      const b = repo.create('character', { parentId: a.id, name: 'B' });
      db.prepare('INSERT INTO characters (id, name, folder_id) VALUES (?, ?, ?)').run(
        'ch1',
        'Alice',
        a.id,
      );
      db.prepare('INSERT INTO characters (id, name, folder_id) VALUES (?, ?, ?)').run(
        'ch2',
        'Bob',
        b.id,
      );
      db.prepare('INSERT INTO characters (id, name, folder_id) VALUES (?, ?, NULL)').run(
        'ch3',
        'Eve',
      );

      repo.delete('character', a.id);

      const rows = db.prepare('SELECT id, folder_id FROM characters ORDER BY id').all() as Array<{
        id: string;
        folder_id: string | null;
      }>;
      for (const r of rows) {
        expect(r.folder_id).toBeNull();
      }
    });

    it('asset kind clears folder_id on assets (hash PK)', () => {
      const a = repo.create('asset', { parentId: null, name: 'Renders' });
      db.prepare('INSERT INTO assets (hash, folder_id) VALUES (?, ?)').run('h1', a.id);
      repo.delete('asset', a.id);
      const row = db.prepare('SELECT folder_id FROM assets WHERE hash = ?').get('h1') as
        | { folder_id: string | null }
        | undefined;
      expect(row?.folder_id).toBeNull();
    });

    it('is a no-op on unknown id', () => {
      expect(() => repo.delete('character', 'nonexistent')).not.toThrow();
    });
  });
});
