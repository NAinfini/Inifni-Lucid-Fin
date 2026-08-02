import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

import { exportAllData, estimateExportSize, type ExportPaths } from './data-export.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makePaths(base: string): ExportPaths {
  return {
    dbPath: path.join(base, 'lucid-fin.db'),
    promptsDbPath: path.join(base, 'prompts.db'),
    assetsRoot: path.join(base, 'assets'),
    logsDir: path.join(base, 'logs'),
  };
}

async function setupSourceData(base: string): Promise<ExportPaths> {
  const paths = makePaths(base);

  // Create source files
  await fsp.mkdir(base, { recursive: true });
  await fsp.writeFile(paths.dbPath, 'sqlite-main-database-content');
  await fsp.writeFile(paths.promptsDbPath, 'sqlite-prompts-content');

  // Create CAS directory with some asset files
  const imageDir = path.join(paths.assetsRoot, 'image', 'abcd1234');
  await fsp.mkdir(imageDir, { recursive: true });
  await fsp.writeFile(path.join(imageDir, 'original.png'), 'fake-image-data');
  await fsp.writeFile(path.join(imageDir, 'meta.json'), '{"format":"png"}');

  return paths;
}

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'data-export-test-'));
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('estimateExportSize', () => {
  it('returns sum of all data sizes', async () => {
    const srcDir = path.join(tmpDir, 'src');
    const paths = await setupSourceData(srcDir);

    const size = await estimateExportSize(paths);
    expect(size).toBeGreaterThan(0);
  });

  it('returns 0 when no files exist', async () => {
    const emptyPaths = makePaths(path.join(tmpDir, 'nonexistent'));
    const size = await estimateExportSize(emptyPaths);
    expect(size).toBe(0);
  });
});

describe('exportAllData', () => {
  it('produces correct directory structure with manifest', async () => {
    const srcDir = path.join(tmpDir, 'src');
    const destDir = path.join(tmpDir, 'export');
    const paths = await setupSourceData(srcDir);

    const mockDb = { pragma: vi.fn() };
    const result = await exportAllData(destDir, paths, mockDb, '1.0.0');

    expect(result.success).toBe(true);
    expect(result.exportDir).toBe(destDir);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify WAL checkpoint was called
    expect(mockDb.pragma).toHaveBeenCalledWith('wal_checkpoint(TRUNCATE)');

    // Verify exported files exist
    expect(fs.existsSync(path.join(destDir, 'lucid-fin.db'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'prompts.db'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'settings.json'))).toBe(false);
    expect(fs.existsSync(path.join(destDir, 'assets', 'image', 'abcd1234', 'original.png'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(destDir, 'manifest.json'))).toBe(true);

    // Verify manifest contents
    const manifest = JSON.parse(await fsp.readFile(path.join(destDir, 'manifest.json'), 'utf-8'));
    expect(manifest.version).toBe(1);
    expect(manifest.appVersion).toBe('1.0.0');
    expect(manifest.items.length).toBeGreaterThanOrEqual(3);
    expect(manifest.totalBytes).toBeGreaterThan(0);

    // Verify each item has a sha256 checksum
    for (const item of manifest.items) {
      expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(item.sizeBytes).toBeGreaterThan(0);
      expect(item.relativePath).toBeTruthy();
    }
  });

  it('does NOT include API keys in export', async () => {
    const srcDir = path.join(tmpDir, 'src');
    const destDir = path.join(tmpDir, 'export');
    const paths = await setupSourceData(srcDir);

    const mockDb = { pragma: vi.fn() };
    const result = await exportAllData(destDir, paths, mockDb, '1.0.0');
    expect(result.success).toBe(true);

    // Walk all exported files and verify none contain keytar/keychain references
    const manifest = result.manifest!;
    const exportedPaths = manifest.items.map((i) => i.relativePath);

    // No keychain/keytar files should be in the export
    for (const p of exportedPaths) {
      expect(p).not.toContain('keychain');
      expect(p).not.toContain('keytar');
      expect(p).not.toContain('apikey');
      expect(p).not.toContain('api-key');
    }
  });

  it('handles missing source files gracefully', async () => {
    const destDir = path.join(tmpDir, 'export');
    const paths = makePaths(path.join(tmpDir, 'nonexistent'));

    const mockDb = { pragma: vi.fn() };
    const result = await exportAllData(destDir, paths, mockDb, '1.0.0');

    expect(result.success).toBe(true);
    expect(result.manifest!.items.length).toBe(0);
    expect(result.manifest!.totalBytes).toBe(0);
  });

  it('continues when WAL checkpoint fails', async () => {
    const srcDir = path.join(tmpDir, 'src');
    const destDir = path.join(tmpDir, 'export');
    const paths = await setupSourceData(srcDir);

    const mockDb = {
      pragma: vi.fn().mockImplementation(() => {
        throw new Error('WAL fail');
      }),
    };
    const result = await exportAllData(destDir, paths, mockDb, '1.0.0');

    // Should still succeed — WAL checkpoint is best-effort
    expect(result.success).toBe(true);
    expect(result.manifest!.items.length).toBeGreaterThan(0);
  });

  it('preserves file content integrity', async () => {
    const srcDir = path.join(tmpDir, 'src');
    const destDir = path.join(tmpDir, 'export');
    const paths = await setupSourceData(srcDir);

    const mockDb = { pragma: vi.fn() };
    await exportAllData(destDir, paths, mockDb, '1.0.0');

    // Compare source and destination content
    const srcContent = await fsp.readFile(paths.dbPath, 'utf-8');
    const destContent = await fsp.readFile(path.join(destDir, 'lucid-fin.db'), 'utf-8');
    expect(destContent).toBe(srcContent);

    expect(fs.existsSync(path.join(destDir, 'settings.json'))).toBe(false);
  });
});
