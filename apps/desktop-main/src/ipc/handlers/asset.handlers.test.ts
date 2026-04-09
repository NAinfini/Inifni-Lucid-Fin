import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

const showSaveDialog = vi.hoisted(() => vi.fn());
const showOpenDialog = vi.hoisted(() => vi.fn());
const getCurrentProjectId = vi.hoisted(() => vi.fn(() => 'project-1'));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

vi.mock('electron', () => ({
  dialog: {
    showSaveDialog,
    showOpenDialog,
  },
}));

vi.mock('../project-context.js', () => ({
  getCurrentProjectId,
}));

import { registerAssetHandlers } from './asset.handlers.js';

describe('registerAssetHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    handlers = new Map();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs asset export success with source and destination paths', async () => {
    const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementation(() => undefined);
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => JSON.stringify({ format: 'png' }));
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'C:\\exports\\hero.png',
    });

    const cas = {
      getAssetPath: vi.fn((hash: string, type: string, ext: string) => `C:\\cas\\${type}\\${hash}.${ext}`),
    };
    const db = {
      insertAsset: vi.fn(),
      deleteAsset: vi.fn(),
      searchAssets: vi.fn(),
      queryAssets: vi.fn(),
    };

    registerAssetHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      cas as never,
      db as never,
    );

    const exportAsset = handlers.get('asset:export');
    expect(exportAsset).toBeTypeOf('function');

    await expect(
      exportAsset?.({}, {
        hash: 'hash-123',
        type: 'image',
        format: 'png',
        name: 'hero',
      }),
    ).resolves.toEqual({
      success: true,
      path: 'C:\\exports\\hero.png',
    });

    expect(readSpy).toHaveBeenCalled();
    expect(existsSpy).toHaveBeenCalled();
    expect(copySpy).toHaveBeenCalledWith('C:\\cas\\image\\hash-123.png', 'C:\\exports\\hero.png');
    expect(logger.info).toHaveBeenCalledWith(
      'Asset export completed',
      expect.objectContaining({
        category: 'asset',
        hash: 'hash-123',
        type: 'image',
        sourcePath: 'C:\\cas\\image\\hash-123.png',
        destinationPath: 'C:\\exports\\hero.png',
      }),
    );
  });

  it('logs asset export failures before throwing', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('meta missing');
    });
    showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'C:\\exports\\hero.png',
    });

    const cas = {
      getAssetPath: vi.fn((hash: string, type: string, ext: string) => `C:\\cas\\${type}\\${hash}.${ext}`),
    };

    registerAssetHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      cas as never,
      {
        insertAsset: vi.fn(),
        deleteAsset: vi.fn(),
        searchAssets: vi.fn(),
        queryAssets: vi.fn(),
      } as never,
    );

    const exportAsset = handlers.get('asset:export');
    expect(exportAsset).toBeTypeOf('function');

    await expect(
      exportAsset?.({}, {
        hash: 'missing-hash',
        type: 'image',
        format: 'png',
      }),
    ).rejects.toThrow('Asset file not found: missing-hash');

    expect(logger.error).toHaveBeenCalledWith(
      'Asset export failed',
      expect.objectContaining({
        category: 'asset',
        hash: 'missing-hash',
        type: 'image',
        format: 'png',
      }),
    );
  });

  it('logs batch export counts including skipped assets', async () => {
    const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'existsSync').mockImplementation((target) => String(target).includes('hash-ok'));
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => JSON.stringify({ format: 'png' }));
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:\\exports'],
    });

    const cas = {
      getAssetPath: vi.fn((hash: string, type: string, ext: string) => `C:\\cas\\${type}\\${hash}.${ext}`),
    };

    registerAssetHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      cas as never,
      {
        insertAsset: vi.fn(),
        deleteAsset: vi.fn(),
        searchAssets: vi.fn(),
        queryAssets: vi.fn(),
      } as never,
    );

    const exportBatch = handlers.get('asset:exportBatch');
    expect(exportBatch).toBeTypeOf('function');

    await expect(
      exportBatch?.({}, {
        items: [
          { hash: 'hash-ok', type: 'image', name: 'hero' },
          { hash: 'hash-missing', type: 'image', name: 'villain' },
        ],
      }),
    ).resolves.toEqual({
      success: true,
      count: 1,
      directory: 'C:\\exports',
    });

    expect(copySpy).toHaveBeenCalledTimes(1);
    expect(copySpy).toHaveBeenCalledWith(
      'C:\\cas\\image\\hash-ok.png',
      path.join('C:\\exports', 'hero.png'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Asset batch export completed',
      expect.objectContaining({
        category: 'asset',
        requestedCount: 2,
        exportedCount: 1,
        skippedCount: 1,
        outputDir: 'C:\\exports',
      }),
    );
  });

  it('deletes the asset from CAS as well as the database record', async () => {
    const cas = {
      getAssetPath: vi.fn(),
      deleteAsset: vi.fn(),
    };
    const db = {
      insertAsset: vi.fn(),
      deleteAsset: vi.fn(),
      searchAssets: vi.fn(),
      queryAssets: vi.fn(),
    };

    registerAssetHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      cas as never,
      db as never,
    );

    const deleteAsset = handlers.get('asset:delete');
    expect(deleteAsset).toBeTypeOf('function');

    await expect(deleteAsset?.({}, { hash: 'hash-123' })).resolves.toEqual({ success: true });

    expect(db.deleteAsset).toHaveBeenCalledWith('hash-123');
    expect(cas.deleteAsset).toHaveBeenCalledWith('hash-123');
  });
});
