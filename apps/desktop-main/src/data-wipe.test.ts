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

const mockFindCredentials = vi.hoisted(() => vi.fn());
const mockDeletePassword = vi.hoisted(() => vi.fn());

vi.mock('keytar', () => ({
  default: {
    findCredentials: mockFindCredentials,
    deletePassword: mockDeletePassword,
  },
  findCredentials: mockFindCredentials,
  deletePassword: mockDeletePassword,
}));

import { wipeAllData, WIPE_CONFIRMATION_TOKEN, type WipePaths, type WipeDeps } from './data-wipe.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makePaths(base: string): WipePaths {
  return {
    dbPath: path.join(base, 'lucid-fin.db'),
    promptsDbPath: path.join(base, 'prompts.db'),
    assetsRoot: path.join(base, 'assets'),
    logDirs: [path.join(base, 'logs')],
  };
}

async function setupWipeData(base: string): Promise<WipePaths> {
  const paths = makePaths(base);

  await fsp.mkdir(base, { recursive: true });

  // Create database files
  await fsp.writeFile(paths.dbPath, 'db-content');
  await fsp.writeFile(paths.dbPath + '-wal', 'wal-content');
  await fsp.writeFile(paths.dbPath + '-shm', 'shm-content');

  // Create prompts DB
  await fsp.writeFile(paths.promptsDbPath, 'prompts-db');

  // Create assets
  const assetDir = path.join(paths.assetsRoot, 'image', 'abc123');
  await fsp.mkdir(assetDir, { recursive: true });
  await fsp.writeFile(path.join(assetDir, 'test.png'), 'image-data');

  // Create logs
  await fsp.mkdir(paths.logDirs[0], { recursive: true });
  await fsp.writeFile(path.join(paths.logDirs[0], 'app.log'), 'log-content');

  return paths;
}

function makeDeps(): WipeDeps {
  return {
    cancelActiveJobs: vi.fn(),
    flushPendingSaves: vi.fn().mockResolvedValue(undefined),
    closeDb: vi.fn(),
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockFindCredentials.mockResolvedValue([
    { account: 'openai', password: 'sk-test' },
    { account: 'anthropic', password: 'sk-ant-test' },
  ]);
  mockDeletePassword.mockResolvedValue(true);
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'data-wipe-test-'));
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WIPE_CONFIRMATION_TOKEN', () => {
  it('equals "DELETE"', () => {
    expect(WIPE_CONFIRMATION_TOKEN).toBe('DELETE');
  });
});

describe('wipeAllData', () => {
  it('deletes all expected files', async () => {
    const base = path.join(tmpDir, 'data');
    const paths = await setupWipeData(base);
    const deps = makeDeps();

    const result = await wipeAllData(paths, deps);

    expect(result.success).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify all files are gone
    expect(fs.existsSync(paths.dbPath)).toBe(false);
    expect(fs.existsSync(paths.dbPath + '-wal')).toBe(false);
    expect(fs.existsSync(paths.dbPath + '-shm')).toBe(false);
    expect(fs.existsSync(paths.promptsDbPath)).toBe(false);
    expect(fs.existsSync(paths.assetsRoot)).toBe(false);
    expect(fs.existsSync(paths.logDirs[0])).toBe(false);
  });

  it('calls deps in the correct order', async () => {
    const base = path.join(tmpDir, 'data');
    const paths = await setupWipeData(base);
    const deps = makeDeps();

    const callOrder: string[] = [];
    (deps.cancelActiveJobs as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push('cancelActiveJobs');
    });
    (deps.flushPendingSaves as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callOrder.push('flushPendingSaves');
    });
    (deps.closeDb as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push('closeDb');
    });

    await wipeAllData(paths, deps);

    expect(callOrder).toEqual(['cancelActiveJobs', 'flushPendingSaves', 'closeDb']);
  });

  it('clears keytar entries', async () => {
    const base = path.join(tmpDir, 'data');
    const paths = await setupWipeData(base);
    const deps = makeDeps();

    await wipeAllData(paths, deps);

    expect(mockFindCredentials).toHaveBeenCalledWith('lucid-fin');
    expect(mockDeletePassword).toHaveBeenCalledTimes(2);
    expect(mockDeletePassword).toHaveBeenCalledWith('lucid-fin', 'openai');
    expect(mockDeletePassword).toHaveBeenCalledWith('lucid-fin', 'anthropic');
  });

  it('partial failure is recoverable — continues after individual step failure', async () => {
    const base = path.join(tmpDir, 'data');
    const paths = await setupWipeData(base);
    const deps = makeDeps();

    // Make closeDb throw — the wipe should still continue with file deletion
    (deps.closeDb as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('DB already closed');
    });

    const result = await wipeAllData(paths, deps);

    // Should report partial failure but still have deleted files
    expect(result.steps.length).toBeGreaterThan(0);

    const closeStep = result.steps.find((s) => s.step === 'close database');
    expect(closeStep?.success).toBe(false);

    // Files should still be deleted despite closeDb failing
    expect(fs.existsSync(paths.assetsRoot)).toBe(false);
  });

  it('is idempotent — running twice on already-wiped data succeeds', async () => {
    const base = path.join(tmpDir, 'data');
    const paths = await setupWipeData(base);
    const deps = makeDeps();

    const result1 = await wipeAllData(paths, deps);
    expect(result1.success).toBe(true);

    // Run again — all files are already gone
    const result2 = await wipeAllData(paths, deps);
    expect(result2.success).toBe(true);
  });

  it('handles nonexistent paths gracefully', async () => {
    const paths = makePaths(path.join(tmpDir, 'nonexistent'));
    const deps = makeDeps();

    const result = await wipeAllData(paths, deps);
    // rm with { force: true } does not throw on missing files
    expect(result.success).toBe(true);
  });
});
