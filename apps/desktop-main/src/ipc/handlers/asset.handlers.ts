import type { IpcMain } from 'electron';
import { dialog } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { CAS, SqliteIndex, Keychain } from '@lucid-fin/storage';
import type { AssetType } from '@lucid-fin/contracts';
import { parseAssetHash } from '@lucid-fin/contracts-parse';
import log from '../../logger.js';
import { assertValidAssetType } from '../validation.js';
import { generateEmbeddingForAsset } from './embedding.handlers.js';
import { assertSafePath, getImportSafeRoots } from '../path-safety.js';

const FALLBACK_EXTS: Record<string, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
  video: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'bin'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
};

function findAssetFile(
  cas: CAS,
  hash: string,
  type: AssetType,
  requestedFormat?: string,
): string | null {
  // 1. Try meta.json for actual format
  let ext = requestedFormat || (type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'png');
  try {
    const metaPath = cas.getAssetPath(hash, type, 'meta.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { format?: string };
    if (meta.format) ext = meta.format;
  } catch {
    /* meta.json not found */
  }

  // 2. Try exact path
  const exactPath = cas.getAssetPath(hash, type, ext);
  if (fs.existsSync(exactPath)) return exactPath;

  // 3. Try fallback extensions for same type
  for (const tryExt of FALLBACK_EXTS[type] ?? []) {
    if (tryExt === ext) continue;
    const tryPath = cas.getAssetPath(hash, type, tryExt);
    if (fs.existsSync(tryPath)) return tryPath;
  }

  // 4. Try other asset type directories
  for (const tryType of ['image', 'video', 'audio'] as const) {
    if (tryType === type) continue;
    for (const tryExt of FALLBACK_EXTS[tryType] ?? []) {
      const tryPath = cas.getAssetPath(hash, tryType, tryExt);
      if (fs.existsSync(tryPath)) return tryPath;
    }
  }

  return null;
}

const ASSET_FILTERS: Record<string, Electron.FileFilter[]> = {
  image: [
    { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'] },
    { name: 'All Files', extensions: ['*'] },
  ],
  video: [
    { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] },
    { name: 'All Files', extensions: ['*'] },
  ],
  audio: [
    { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'] },
    { name: 'All Files', extensions: ['*'] },
  ],
};

export function registerAssetHandlers(
  ipcMain: IpcMain,
  cas: CAS,
  db: SqliteIndex,
  keychain?: Keychain,
): void {
  ipcMain.handle('asset:import', async (_e, args: { filePath: string; type: AssetType }) => {
    if (!args.filePath || typeof args.filePath !== 'string')
      throw new Error('filePath is required');
    assertValidAssetType(args.type);
    const safePath = assertSafePath(args.filePath, getImportSafeRoots(cas.getAssetsRoot()));
    const { ref, meta } = await cas.importAsset(safePath, args.type);
    db.repos.assets.insert({ ...meta });
    log.info('Asset imported', {
      category: 'asset',
      type: args.type,
      filePath: args.filePath,
      hash: ref.hash,
    });
    if (args.type === 'image' && keychain) {
      void generateEmbeddingForAsset(cas, keychain, db, ref.hash).catch((err) =>
        log.warn('Auto-embed failed after import', {
          category: 'embedding',
          hash: ref.hash,
          error: String(err),
        }),
      );
    }
    return ref;
  });

  ipcMain.handle(
    'asset:importBuffer',
    async (_e, args: { buffer: ArrayBuffer; fileName: string; type: AssetType }) => {
      if (!args.buffer || !args.fileName) throw new Error('buffer and fileName are required');
      assertValidAssetType(args.type);
      const MAX_BUFFER_BYTES = 100 * 1024 * 1024;
      const buf = Buffer.from(args.buffer);
      if (buf.length > MAX_BUFFER_BYTES) {
        throw new Error(
          `Buffer exceeds 100 MB limit (${(buf.length / 1024 / 1024).toFixed(1)} MB)`,
        );
      }
      const { ref, meta } = await cas.importBuffer(buf, args.fileName, args.type);
      db.repos.assets.insert({ ...meta });
      log.info('Asset imported from buffer', {
        category: 'asset',
        type: args.type,
        fileName: args.fileName,
        hash: ref.hash,
        size: buf.length,
      });
      if (args.type === 'image' && keychain) {
        void generateEmbeddingForAsset(cas, keychain, db, ref.hash).catch((err) =>
          log.warn('Auto-embed failed after buffer import', {
            category: 'embedding',
            hash: ref.hash,
            error: String(err),
          }),
        );
      }
      return ref;
    },
  );

  ipcMain.handle('asset:pickFile', async (_e, args: { type: AssetType }) => {
    assertValidAssetType(args.type);
    const filters = ASSET_FILTERS[args.type] ?? [{ name: 'All Files', extensions: ['*'] }];
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters,
    });
    if (result.canceled || result.filePaths.length === 0) {
      log.info('Asset picker cancelled', {
        category: 'asset',
        type: args.type,
      });
      return null;
    }
    const filePath = result.filePaths[0];
    const { ref, meta } = await cas.importAsset(filePath, args.type);
    db.repos.assets.insert({ ...meta });
    log.info('Asset picked and imported', {
      category: 'asset',
      type: args.type,
      filePath,
      hash: ref.hash,
    });
    if (args.type === 'image' && keychain) {
      void generateEmbeddingForAsset(cas, keychain, db, ref.hash).catch((err) =>
        log.warn('Auto-embed failed after pick', {
          category: 'embedding',
          hash: ref.hash,
          error: String(err),
        }),
      );
    }
    return ref;
  });

  ipcMain.handle(
    'asset:query',
    async (
      _e,
      args: { type?: string; tags?: string[]; search?: string; limit?: number; offset?: number },
    ) => {
      if (args.search) {
        return db.repos.assets.search(args.search, args.limit).rows;
      }
      return db.repos.assets.query({
        type: args.type,
        limit: args.limit,
        offset: args.offset,
      }).rows;
    },
  );

  ipcMain.handle(
    'asset:getPath',
    async (_e, args: { hash: string; type: AssetType; ext: string }) => {
      if (!args.hash || typeof args.hash !== 'string') throw new Error('hash is required');
      assertValidAssetType(args.type);
      const filePath = cas.getAssetPath(args.hash, args.type, args.ext || 'png');
      // Verify the returned path stays within CAS assets root
      assertSafePath(filePath, [cas.getAssetsRoot()]);
      return filePath;
    },
  );

  ipcMain.handle('asset:delete', async (_e, args: { hash: string }) => {
    if (!args.hash || typeof args.hash !== 'string') throw new Error('hash is required');
    try {
      cas.deleteAsset(args.hash);
      db.repos.assets.delete(parseAssetHash(args.hash));
      log.info('Asset deleted', {
        category: 'asset',
        hash: args.hash,
      });
      return { success: true };
    } catch (err) {
      log.error('Failed to delete asset', {
        category: 'asset',
        hash: args.hash,
        error: String(err),
      });
      throw err;
    }
  });

  ipcMain.handle(
    'asset:export',
    async (_e, args: { hash: string; type: AssetType; format: string; name?: string }) => {
      if (!args.hash || typeof args.hash !== 'string') throw new Error('hash is required');
      assertValidAssetType(args.type);

      try {
        const sourcePath = findAssetFile(cas, args.hash, args.type, args.format);
        if (!sourcePath) {
          throw new Error(`Asset file not found: ${args.hash}`);
        }
        const ext = path.extname(sourcePath).slice(1) || args.format;
        const defaultName = args.name
          ? `${args.name.replace(/\.[^.]+$/, '')}.${ext}`
          : `${args.hash.slice(0, 12)}.${ext}`;
        const filters = ASSET_FILTERS[args.type] ?? [{ name: 'All Files', extensions: ['*'] }];
        const result = await dialog.showSaveDialog({ defaultPath: defaultName, filters });
        if (result.canceled || !result.filePath) {
          log.info('Asset export cancelled', {
            category: 'asset',
            hash: args.hash,
            type: args.type,
            format: args.format,
          });
          return null;
        }
        await fsp.copyFile(sourcePath, result.filePath);
        log.info('Asset export completed', {
          category: 'asset',
          hash: args.hash,
          type: args.type,
          format: args.format,
          sourcePath,
          destinationPath: result.filePath,
        });
        return { success: true, path: result.filePath };
      } catch (error) {
        log.error('Asset export failed', {
          category: 'asset',
          hash: args.hash,
          type: args.type,
          format: args.format,
          detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
        });
        throw error;
      }
    },
  );

  ipcMain.handle(
    'asset:exportBatch',
    async (_e, args: { items: Array<{ hash: string; type: AssetType; name?: string }> }) => {
      if (!Array.isArray(args?.items) || args.items.length === 0) throw new Error('items required');

      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      if (result.canceled || result.filePaths.length === 0) {
        log.info('Asset batch export cancelled', {
          category: 'asset',
          requestedCount: args.items.length,
        });
        return null;
      }
      const outputDir = result.filePaths[0];

      const exported: string[] = [];
      for (const item of args.items) {
        assertValidAssetType(item.type);
        const sourcePath = findAssetFile(cas, item.hash, item.type);
        if (!sourcePath) continue;

        const ext = path.extname(sourcePath).slice(1) || 'bin';
        const safeName = item.name ? item.name.replace(/[/\\:]/g, '_') : undefined;
        const fileName = safeName
          ? `${safeName.replace(/\.[^.]+$/, '')}.${ext}`
          : `${item.hash.slice(0, 12)}.${ext}`;
        const destPath = path.join(outputDir, fileName);
        await fsp.copyFile(sourcePath, destPath);
        exported.push(destPath);
      }
      log.info('Asset batch export completed', {
        category: 'asset',
        requestedCount: args.items.length,
        exportedCount: exported.length,
        skippedCount: args.items.length - exported.length,
        outputDir,
      });
      return { success: true, count: exported.length, directory: outputDir };
    },
  );

  // One-time startup repair: backfill file_size for legacy assets with 0 or NULL
  const repaired = db.repos.assets.repairSizes((hash, type, format) =>
    cas.getAssetPath(hash, type as AssetType, format),
  );
  if (repaired > 0) {
    log.info('Repaired asset file sizes', { category: 'asset', repairedCount: repaired });
  }
}
