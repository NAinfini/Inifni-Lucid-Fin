import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import {
  createBackup,
  listBackups,
  restoreBackup,
  purgeAllBackups,
  type BackupResult,
} from '../src/backup.ts';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-backup-'));
}

describe('backup module', () => {
  let base: string;
  let dbPath: string;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    base = tmpDir();
    dbPath = path.join(base, 'test.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE IF NOT EXISTS test_data (id TEXT PRIMARY KEY, value TEXT)');
    db.exec("INSERT INTO test_data VALUES ('row1', 'hello')");
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* may already be closed by restoreBackup */
    }
    // Give Windows a moment to release file handles before cleanup
    try {
      fs.rmSync(base, { recursive: true, force: true });
    } catch {
      /* best-effort on Windows — tmpdir will be cleaned up by OS */
    }
  });

  describe('createBackup', () => {
    it('creates a backup file with correct naming', () => {
      const result = createBackup(db, dbPath);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.filename).toMatch(/^test\.backup\.\d{4}-\d{2}-\d{2}T.*\.sqlite$/);
      expect(fs.existsSync(result.backupPath)).toBe(true);
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('updates the manifest with backup metadata', () => {
      const result = createBackup(db, dbPath);
      expect(result.success).toBe(true);

      const entries = listBackups(dbPath);
      expect(entries).toHaveLength(1);
      expect(entries[0].filename).toBe((result as BackupResult).filename);
      expect(entries[0].checksum).toBe((result as BackupResult).checksum);
      expect(entries[0].sizeBytes).toBe((result as BackupResult).sizeBytes);
    });

    it('enforces retention policy and deletes oldest backups', () => {
      // Create 5 backups with maxBackups=3
      for (let i = 0; i < 5; i++) {
        const r = createBackup(db, dbPath, 3);
        expect(r.success).toBe(true);
      }

      const entries = listBackups(dbPath);
      expect(entries).toHaveLength(3);

      // Verify only 3 backup files exist in the backups directory
      const backupsDir = path.join(base, 'backups');
      const backupFiles = fs
        .readdirSync(backupsDir)
        .filter((f) => f.endsWith('.sqlite'));
      expect(backupFiles).toHaveLength(3);
    });

    it('fails gracefully for in-memory database', () => {
      const result = createBackup(db, ':memory:');
      expect(result.success).toBe(false);
    });

    it('fails gracefully for non-existent database path', () => {
      const result = createBackup(db, path.join(base, 'nonexistent.db'));
      expect(result.success).toBe(false);
    });
  });

  describe('listBackups', () => {
    it('returns empty array when no backups exist', () => {
      expect(listBackups(dbPath)).toEqual([]);
    });

    it('returns backups newest-first', () => {
      createBackup(db, dbPath);
      createBackup(db, dbPath);
      createBackup(db, dbPath);

      const entries = listBackups(dbPath);
      expect(entries).toHaveLength(3);

      // Newest first = descending timestamps
      for (let i = 0; i < entries.length - 1; i++) {
        expect(new Date(entries[i].timestamp).getTime()).toBeGreaterThanOrEqual(
          new Date(entries[i + 1].timestamp).getTime(),
        );
      }
    });
  });

  describe('restoreBackup', () => {
    it('restores a backup and passes integrity check', () => {
      // Insert initial data and backup
      const backupResult = createBackup(db, dbPath);
      expect(backupResult.success).toBe(true);
      if (!backupResult.success) return;

      // Modify data after backup
      db.exec("INSERT INTO test_data VALUES ('row2', 'world')");
      const countBefore = (
        db.prepare('SELECT COUNT(*) as cnt FROM test_data').get() as { cnt: number }
      ).cnt;
      expect(countBefore).toBe(2);

      // Restore from backup
      const result = restoreBackup(db, dbPath, backupResult.filename, Database);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.preRestoreBackup).toBeTruthy();
      expect(result.restoredFrom).toBe(backupResult.filename);

      // Verify restored data — reopen since restoreBackup closed the connection
      const restored = new Database(dbPath);
      restored.pragma('journal_mode = WAL');
      const countAfter = (
        restored.prepare('SELECT COUNT(*) as cnt FROM test_data').get() as { cnt: number }
      ).cnt;
      expect(countAfter).toBe(1); // Only row1 from before backup
      restored.close();
    });

    it('creates pre-restore backup before overwriting', () => {
      const backupResult = createBackup(db, dbPath);
      expect(backupResult.success).toBe(true);
      if (!backupResult.success) return;

      const result = restoreBackup(db, dbPath, backupResult.filename, Database);
      expect(result.success).toBe(true);
      if (!result.success) return;

      // Pre-restore backup should exist
      const preRestorePath = path.join(base, 'backups', result.preRestoreBackup);
      expect(fs.existsSync(preRestorePath)).toBe(true);
    });

    it('detects tampered backup via hash mismatch', () => {
      const backupResult = createBackup(db, dbPath);
      expect(backupResult.success).toBe(true);
      if (!backupResult.success) return;

      // Tamper with the backup file
      const backupPath = path.join(base, 'backups', backupResult.filename);
      fs.appendFileSync(backupPath, 'TAMPERED');

      const result = restoreBackup(db, dbPath, backupResult.filename, Database);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('Hash mismatch');
      expect(result.rolledBack).toBe(false); // No rollback needed — DB untouched
    });

    it('rolls back to pre-restore backup on corrupt restore', () => {
      // Create a valid backup first
      const goodBackup = createBackup(db, dbPath);
      expect(goodBackup.success).toBe(true);
      if (!goodBackup.success) return;

      // Create a corrupt "backup" file directly
      const backupsDir = path.join(base, 'backups');
      const corruptFilename = 'corrupt.backup.sqlite';
      const corruptPath = path.join(backupsDir, corruptFilename);
      fs.writeFileSync(corruptPath, 'NOT A VALID SQLITE DATABASE');

      // Attempt to restore the corrupt file (no manifest entry = skip hash check)
      const result = restoreBackup(db, dbPath, corruptFilename, Database);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.rolledBack).toBe(true);

      // Verify DB is still functional after rollback
      const recovered = new Database(dbPath);
      recovered.pragma('journal_mode = WAL');
      const count = (
        recovered.prepare('SELECT COUNT(*) as cnt FROM test_data').get() as { cnt: number }
      ).cnt;
      expect(count).toBe(1); // Original data intact
      recovered.close();
    });

    it('fails gracefully for non-existent backup file', () => {
      const result = restoreBackup(db, dbPath, 'nonexistent.sqlite', Database);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error).toContain('not found');
    });
  });

  describe('purgeAllBackups', () => {
    it('removes the backups directory entirely', () => {
      createBackup(db, dbPath);
      const backupsDir = path.join(base, 'backups');
      expect(fs.existsSync(backupsDir)).toBe(true);

      purgeAllBackups(dbPath);
      expect(fs.existsSync(backupsDir)).toBe(false);
    });
  });
});
