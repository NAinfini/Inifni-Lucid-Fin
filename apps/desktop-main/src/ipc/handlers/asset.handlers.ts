import type { IpcMain } from 'electron';
import * as electron from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import type { AssetMeta, AssetType } from '@lucid-fin/contracts';
import { parseAssetEntryId } from '@lucid-fin/contracts-parse';
import { probeMedia } from '@lucid-fin/media-engine';
import log from '../../logger.js';
import { assertValidAssetType } from '../validation.js';
import { assertSafePath, getImportSafeRoots } from '../path-safety.js';

const { dialog } = electron;

const FALLBACK_EXTS: Record<string, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
  video: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'bin'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
};

async function findAssetFile(
  cas: CAS,
  hash: string,
  type: AssetType,
  requestedFormat?: string,
): Promise<string | null> {
  // 1. Try meta.json for actual format
  let ext = requestedFormat || (type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'png');
  try {
    const metaPath = cas.getAssetPath(hash, type, 'meta.json');
    const raw = await fsp.readFile(metaPath, 'utf-8');
    const meta = JSON.parse(raw) as { format?: string };
    if (meta.format) ext = meta.format;
  } catch {
    /* meta.json not found */
  }

  // 2. Try exact path
  const exactPath = cas.getAssetPath(hash, type, ext);
  try {
    await fsp.access(exactPath);
    return exactPath;
  } catch {
    /* not found */
  }

  // 3. Try fallback extensions for same type
  for (const tryExt of FALLBACK_EXTS[type] ?? []) {
    if (tryExt === ext) continue;
    const tryPath = cas.getAssetPath(hash, type, tryExt);
    try {
      await fsp.access(tryPath);
      return tryPath;
    } catch {
      /* not found */
    }
  }

  // 4. Try other asset type directories
  for (const tryType of ['image', 'video', 'audio'] as const) {
    if (tryType === type) continue;
    for (const tryExt of FALLBACK_EXTS[tryType] ?? []) {
      const tryPath = cas.getAssetPath(hash, tryType, tryExt);
      try {
        await fsp.access(tryPath);
        return tryPath;
      } catch {
        /* not found */
      }
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

async function inspectTechnicalMetadata(
  filePath: string,
  type: AssetType,
): Promise<Pick<AssetMeta, 'width' | 'height' | 'duration' | 'hasAudio'>> {
  if (type === 'image') return {};
  const probe = await probeMedia(filePath);
  if (probe.durationSeconds <= 0) {
    throw new Error(`Imported ${type} has no probeable duration`);
  }
  if (type === 'audio') return { duration: probe.durationSeconds };
  if (!probe.width || !probe.height) {
    throw new Error('Imported video has no probeable pixel dimensions');
  }
  return {
    width: probe.width,
    height: probe.height,
    duration: probe.durationSeconds,
    hasAudio: probe.hasAudio,
  };
}

export function registerAssetHandlers(
  ipcMain: IpcMain,
  cas: CAS,
  db: SqliteIndex,
): void {
  ipcMain.handle('assetEntry:import', async (_e, args: { filePath: string; type: AssetType }) => {
    if (!args.filePath || typeof args.filePath !== 'string')
      throw new Error('filePath is required');
    assertValidAssetType(args.type);
    const safePath = assertSafePath(args.filePath, getImportSafeRoots(cas.getAssetsRoot()));
    const { ref, meta } = await cas.importAsset(safePath, args.type);
    const technical = await inspectTechnicalMetadata(ref.path, args.type);
    const entry = db.repos.assets.insert({ ...meta, ...technical });
    log.info('Asset imported', {
      category: 'asset',
      type: args.type,
      filePath: args.filePath,
      hash: ref.hash,
      entryId: entry.id,
    });
    return entry;
  });

  ipcMain.handle(
    'assetEntry:importBuffer',
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
      const technical = await inspectTechnicalMetadata(ref.path, args.type);
      const entry = db.repos.assets.insert({ ...meta, ...technical });
      log.info('Asset imported from buffer', {
        category: 'asset',
        type: args.type,
        fileName: args.fileName,
        hash: ref.hash,
        entryId: entry.id,
        size: buf.length,
      });
      return entry;
    },
  );

  ipcMain.handle('assetEntry:pickFile', async (_e, args: { type: AssetType }) => {
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
    const technical = await inspectTechnicalMetadata(ref.path, args.type);
    const entry = db.repos.assets.insert({ ...meta, ...technical });
    log.info('Asset picked and imported', {
      category: 'asset',
      type: args.type,
      filePath,
      hash: ref.hash,
      entryId: entry.id,
    });
    return entry;
  });

  ipcMain.handle(
    'assetEntry:query',
    async (
      _e,
      args: { type?: string; tags?: string[]; search?: string; limit?: number; offset?: number },
    ) => {
      if (args.search) {
        return db.repos.assets.search(args.search, args.limit).rows;
      }
      return db.repos.assets.query({
        type: args.type,
        tags: args.tags,
        limit: args.limit,
        offset: args.offset,
      }).rows;
    },
  );

  ipcMain.handle('assetContent:inspect', async (_e, args: { hash: string }) => {
    if (!args?.hash || typeof args.hash !== 'string') throw new Error('hash is required');
    const asset = db.repos.assets.findByHash(args.hash);
    if (!asset) throw new Error(`Asset content not found: ${args.hash}`);
    if (asset.type === 'image') return asset;
    const filePath = cas.getAssetPath(asset.hash, asset.type, asset.format);
    return db.repos.assets.updateTechnicalMetadata(
      asset.hash,
      await inspectTechnicalMetadata(filePath, asset.type),
    );
  });

  ipcMain.handle(
    'assetEntry:copy',
    async (_e, args: { entryIds: string[]; targetFolderId: string | null }) => {
      if (!Array.isArray(args.entryIds) || args.entryIds.length === 0) {
        throw new Error('entryIds are required');
      }
      const entries = db.repos.assets.copyEntries(
        args.entryIds.map(parseAssetEntryId),
        args.targetFolderId ?? null,
      );
      log.info('Asset entries copied', {
        category: 'asset',
        sourceEntryIds: args.entryIds,
        targetFolderId: args.targetFolderId ?? null,
        copiedEntryIds: entries.map(({ id }) => id),
      });
      return entries;
    },
  );

  ipcMain.handle(
    'assetEntry:move',
    async (_e, args: { entryIds: string[]; folderId: string | null }) => {
      if (!Array.isArray(args?.entryIds) || args.entryIds.length === 0) {
        throw new Error('entryIds are required');
      }
      const movedEntryIds = db.repos.assets.moveEntry(
        args.entryIds.map(parseAssetEntryId),
        args.folderId ?? null,
      );
      log.info('Asset entries moved', {
        category: 'asset',
        entryIds: movedEntryIds,
        folderId: args.folderId ?? null,
      });
      return { movedEntryIds };
    },
  );

  ipcMain.handle(
    'assetEntry:rename',
    async (_e, args: { entryId: string; displayName: string }) => {
      if (!args.entryId || typeof args.entryId !== 'string') throw new Error('entryId is required');
      if (typeof args.displayName !== 'string' || !args.displayName.trim()) {
        throw new Error('Asset display name is required');
      }
      const displayName = args.displayName.trim();
      if (displayName.length > 255) throw new Error('Asset display name exceeds 255 characters');
      const entry = db.repos.assets.renameEntry(parseAssetEntryId(args.entryId), displayName);
      log.info('Asset display name updated', {
        category: 'asset',
        entryId: args.entryId,
        displayName,
      });
      return entry;
    },
  );

  ipcMain.handle(
    'assetContent:getPath',
    async (_e, args: { hash: string; type: AssetType; ext: string }) => {
      if (!args.hash || typeof args.hash !== 'string') throw new Error('hash is required');
      assertValidAssetType(args.type);
      const filePath = cas.getAssetPath(args.hash, args.type, args.ext || 'png');
      // Verify the returned path stays within CAS assets root
      assertSafePath(filePath, [cas.getAssetsRoot()]);
      return filePath;
    },
  );

  ipcMain.handle('assetEntry:delete', async (_e, args: { entryIds: string[] }) => {
    if (!Array.isArray(args?.entryIds) || args.entryIds.length === 0) {
      throw new Error('entryIds are required');
    }
    try {
      const deletedEntryIds = db.repos.assets.deleteEntry(args.entryIds.map(parseAssetEntryId));
      log.info('Asset entries deleted', {
        category: 'asset',
        entryIds: deletedEntryIds,
      });
      return { deletedEntryIds };
    } catch (err) {
      log.error('Failed to delete asset entries', {
        category: 'asset',
        entryIds: args.entryIds,
        error: String(err),
      });
      throw err;
    }
  });

  ipcMain.handle(
    'assetContent:export',
    async (_e, args: { hash: string; type: AssetType; format: string; name?: string }) => {
      if (!args.hash || typeof args.hash !== 'string') throw new Error('hash is required');
      assertValidAssetType(args.type);

      try {
        const sourcePath = await findAssetFile(cas, args.hash, args.type, args.format);
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

  // One-time startup repair: backfill file_size for legacy assets with 0 or NULL
  const repaired = db.repos.assets.repairSizes((hash, type, format) =>
    cas.getAssetPath(hash, type as AssetType, format),
  );
  if (repaired > 0) {
    log.info('Repaired asset file sizes', { category: 'asset', repairedCount: repaired });
  }
}
