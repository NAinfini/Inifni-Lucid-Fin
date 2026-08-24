import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { AssetEntryId } from '@lucid-fin/contracts';
import { setDegradeReporter, type DegradeReporter } from '@lucid-fin/contracts-parse';
import { AssetRepository } from './asset-repository.js';

const SCHEMA = `
CREATE TABLE asset_folders (id TEXT PRIMARY KEY);

CREATE TABLE asset_contents (
  hash TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  format TEXT NOT NULL,
  prompt TEXT,
  provider TEXT,
  created_at INTEGER NOT NULL,
  file_size INTEGER,
  width INTEGER,
  height INTEGER,
  duration REAL,
  has_audio INTEGER,
  generation_metadata TEXT
);

CREATE TABLE asset_entries (
  id TEXT PRIMARY KEY,
  asset_hash TEXT NOT NULL REFERENCES asset_contents(hash) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK (trim(display_name) <> ''),
  tags TEXT NOT NULL DEFAULT '[]',
  folder_id TEXT REFERENCES asset_folders(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE asset_entries_fts USING fts5(
  entry_id UNINDEXED, display_name, tags, prompt
);

CREATE TRIGGER asset_entries_ai AFTER INSERT ON asset_entries BEGIN
  INSERT INTO asset_entries_fts(entry_id, display_name, tags, prompt)
  SELECT new.id, new.display_name, new.tags, prompt
    FROM asset_contents WHERE hash = new.asset_hash;
END;

CREATE TRIGGER asset_entries_ad AFTER DELETE ON asset_entries BEGIN
  DELETE FROM asset_entries_fts WHERE entry_id = old.id;
END;

CREATE TRIGGER asset_entries_au AFTER UPDATE ON asset_entries BEGIN
  UPDATE asset_entries_fts
     SET display_name = new.display_name,
         tags = new.tags,
         prompt = (SELECT prompt FROM asset_contents WHERE hash = new.asset_hash)
   WHERE entry_id = old.id;
END;

`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.exec("INSERT INTO asset_folders (id) VALUES ('folder-a'), ('folder-b')");
  return db;
}

describe('AssetRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: AssetRepository;
  const reports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    reports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    db = openDb();
    repo = new AssetRepository(db);
    reports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    db.close();
  });

  it('records one content row and one logical entry per insert', () => {
    const entry = repo.insert({
      hash: 'h1',
      type: 'image',
      format: 'png',
      displayName: 'Hero shot',
      tags: ['hero', 'shot'],
      fileSize: 1024,
      createdAt: 100,
    });

    expect(entry).toMatchObject({
      hash: 'h1',
      displayName: 'Hero shot',
      tags: ['hero', 'shot'],
      createdAt: 100,
      contentCreatedAt: 100,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM asset_contents').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM asset_entries').get()).toEqual({ count: 1 });
  });

  it('copies entries by identity while sharing immutable content', () => {
    const original = repo.insert({
      hash: 'shared-hash',
      type: 'image',
      format: 'png',
      displayName: 'Original',
      tags: ['original'],
      folderId: 'folder-a',
      fileSize: 10,
      createdAt: 1,
    });

    const findEntryById = vi.spyOn(repo, 'findEntryById');
    const [copy] = repo.copyEntries([original.id as AssetEntryId], 'folder-b');
    expect(findEntryById).not.toHaveBeenCalled();
    expect(copy.id).not.toBe(original.id);
    expect(copy).toMatchObject({
      hash: original.hash,
      displayName: 'Original',
      tags: ['original'],
      folderId: 'folder-b',
    });

    repo.renameEntry(copy.id as AssetEntryId, 'Independent copy');
    repo.setEntryTags(copy.id as AssetEntryId, ['copy']);
    repo.moveEntry([original.id as AssetEntryId], null);

    expect(repo.findEntryById(original.id as AssetEntryId)).toMatchObject({
      displayName: 'Original',
      tags: ['original'],
      folderId: null,
    });
    expect(repo.findEntryById(copy.id as AssetEntryId)).toMatchObject({
      displayName: 'Independent copy',
      tags: ['copy'],
      folderId: 'folder-b',
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM asset_contents').get()).toEqual({ count: 1 });
  });

  it('deleting one entry keeps shared content and the other entry', () => {
    const original = repo.insert({
      hash: 'shared-hash',
      type: 'video',
      format: 'mp4',
      fileSize: 10,
      createdAt: 1,
    });
    const [copy] = repo.copyEntries([original.id as AssetEntryId], null);

    repo.deleteEntry([original.id as AssetEntryId]);

    expect(repo.findEntryById(original.id as AssetEntryId)).toBeUndefined();
    expect(repo.findEntryById(copy.id as AssetEntryId)?.hash).toBe('shared-hash');
    expect(repo.findByHash('shared-hash')).toMatchObject({ hash: 'shared-hash', type: 'video' });
  });

  it('moves and deletes deduplicated entry IDs in one transaction with rollback', () => {
    const first = repo.insert({
      hash: 'batch-first',
      type: 'image',
      format: 'png',
      folderId: 'folder-a',
      fileSize: 1,
      createdAt: 1,
    });
    const second = repo.insert({
      hash: 'batch-second',
      type: 'image',
      format: 'png',
      folderId: 'folder-a',
      fileSize: 1,
      createdAt: 2,
    });
    const firstId = first.id as AssetEntryId;
    const secondId = second.id as AssetEntryId;
    const transaction = vi.spyOn(db, 'transaction');

    expect(repo.moveEntry([firstId, firstId, secondId], 'folder-b')).toEqual([firstId, secondId]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(repo.findEntryById(firstId)?.folderId).toBe('folder-b');
    expect(repo.findEntryById(secondId)?.folderId).toBe('folder-b');

    transaction.mockClear();
    expect(() => repo.moveEntry([firstId, 'missing' as AssetEntryId], null)).toThrow(
      'Asset entry not found: missing',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(repo.findEntryById(firstId)?.folderId).toBe('folder-b');

    transaction.mockClear();
    expect(() => repo.deleteEntry([firstId, 'missing' as AssetEntryId])).toThrow(
      'Asset entry not found: missing',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(repo.findEntryById(firstId)).toBeDefined();

    transaction.mockClear();
    expect(repo.deleteEntry([firstId, secondId, firstId])).toEqual([firstId, secondId]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(repo.findEntryById(firstId)).toBeUndefined();
    expect(repo.findEntryById(secondId)).toBeUndefined();
  });

  it('loads multiple content records in one batch and ignores duplicate or missing hashes', () => {
    repo.insert({ hash: 'batch-a', type: 'image', format: 'png', fileSize: 1, createdAt: 1 });
    repo.insert({ hash: 'batch-b', type: 'video', format: 'mp4', fileSize: 2, createdAt: 2 });

    expect([...repo.findByHashes(['batch-b', 'missing', 'batch-a', 'batch-b'])]).toEqual([
      ['batch-a', expect.objectContaining({ hash: 'batch-a', type: 'image' })],
      ['batch-b', expect.objectContaining({ hash: 'batch-b', type: 'video' })],
    ]);
  });

  it('round-trips video audio metadata and updates only technical probe fields', () => {
    const entry = repo.insert({
      hash: 'probed-video',
      type: 'video',
      format: 'mp4',
      prompt: 'keep this',
      fileSize: 5,
      createdAt: 10,
    });
    expect(entry.hasAudio).toBeUndefined();

    expect(
      repo.updateTechnicalMetadata('probed-video', {
        width: 1920,
        height: 1080,
        duration: 4.5,
        hasAudio: true,
      }),
    ).toMatchObject({
      hash: 'probed-video',
      width: 1920,
      height: 1080,
      duration: 4.5,
      hasAudio: true,
      prompt: 'keep this',
    });
    expect(repo.findEntryById(entry.id as AssetEntryId)).toMatchObject({ hasAudio: true });
    expect(db.prepare('SELECT COUNT(*) AS count FROM asset_entries').get()).toEqual({ count: 1 });

    repo.insert({
      hash: 'probed-video',
      type: 'video',
      format: 'mp4',
      fileSize: 5,
      createdAt: 11,
    });
    expect(repo.findByHash('probed-video')).toMatchObject({ hasAudio: true });
  });

  it('rejects invalid technical metadata and missing content', () => {
    expect(() => repo.updateTechnicalMetadata('missing', { hasAudio: false })).toThrow(
      'Asset content not found',
    );
    expect(() => repo.updateTechnicalMetadata('missing', { duration: -1 })).toThrow(
      'duration must be',
    );

    repo.insert({ hash: 'still', type: 'image', format: 'png', fileSize: 1, createdAt: 1 });
    expect(() => repo.updateTechnicalMetadata('still', { hasAudio: true })).toThrow(
      'only valid for video',
    );
    expect(repo.updateTechnicalMetadata('still', { width: undefined })).toMatchObject({
      hash: 'still',
      width: undefined,
    });
  });

  it('queries independent entries by type, tags, and creation order', () => {
    repo.insert({
      hash: 'a',
      type: 'image',
      format: 'png',
      tags: ['hero'],
      fileSize: 1,
      createdAt: 1,
    });
    repo.insert({
      hash: 'b',
      type: 'video',
      format: 'mp4',
      tags: ['hero'],
      fileSize: 1,
      createdAt: 2,
    });
    repo.insert({
      hash: 'c',
      type: 'image',
      format: 'jpg',
      tags: ['other'],
      fileSize: 1,
      createdAt: 3,
    });

    expect(repo.query({ type: 'image' }).rows.map(({ hash }) => hash)).toEqual(['c', 'a']);
    expect(repo.query({ tags: ['hero'] }).rows.map(({ hash }) => hash)).toEqual(['b', 'a']);
  });

  it('searches logical entry names and content prompts', () => {
    repo.insert({
      hash: 'search-1',
      type: 'image',
      format: 'png',
      displayName: 'Rain portrait',
      prompt: 'cinematic midnight',
      fileSize: 1,
      createdAt: 1,
    });

    expect(repo.search('Rain').rows.map(({ hash }) => hash)).toEqual(['search-1']);
    expect(repo.search('midnight').rows.map(({ hash }) => hash)).toEqual(['search-1']);
  });

  it('fault injection skips a malformed entry and reports degradation', () => {
    repo.insert({ hash: 'good', type: 'image', format: 'png', fileSize: 1, createdAt: 1 });
    db.prepare(
      `INSERT INTO asset_contents (hash, type, format, created_at, file_size)
       VALUES ('bad', 'garbage', 'png', 2, 1)`,
    ).run();
    db.prepare(
      `INSERT INTO asset_entries (id, asset_hash, display_name, tags, created_at)
       VALUES ('bad-entry', 'bad', 'Bad', '[]', 2)`,
    ).run();

    const { rows, degradedCount } = repo.query({});
    expect(degradedCount).toBe(1);
    expect(rows.map(({ hash }) => hash)).toEqual(['good']);
    expect(reports).toEqual([expect.objectContaining({ schema: 'AssetEntry' })]);
  });

  it('accepts an explicit transaction boundary', () => {
    db.transaction(() => {
      repo.insert({ hash: 'tx', type: 'image', format: 'png', fileSize: 1, createdAt: 1 }, db);
    })();
    expect(repo.query({}).rows.map(({ hash }) => hash)).toEqual(['tx']);
  });
});
