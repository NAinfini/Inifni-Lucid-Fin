import type { IpcMain } from 'electron';
import { dialog } from 'electron';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import type { AssetType } from '@lucid-fin/contracts';
import { getCurrentProjectId } from '../project-context.js';
import { assertValidAssetType } from '../validation.js';

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

export function registerAssetHandlers(ipcMain: IpcMain, cas: CAS, db: SqliteIndex): void {
  ipcMain.handle('asset:import', async (_e, args: { filePath: string; type: AssetType }) => {
    if (!args.filePath || typeof args.filePath !== 'string')
      throw new Error('filePath is required');
    assertValidAssetType(args.type);
    const { ref, meta } = await cas.importAsset(args.filePath, args.type);
    const projectId = getCurrentProjectId();
    db.insertAsset({ ...meta, projectId: projectId ?? undefined });
    return ref;
  });

  ipcMain.handle('asset:pickFile', async (_e, args: { type: AssetType }) => {
    assertValidAssetType(args.type);
    const filters = ASSET_FILTERS[args.type] ?? [{ name: 'All Files', extensions: ['*'] }];
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const { ref, meta } = await cas.importAsset(filePath, args.type);
    const projectId = getCurrentProjectId();
    db.insertAsset({ ...meta, projectId: projectId ?? undefined });
    return ref;
  });

  ipcMain.handle(
    'asset:query',
    async (
      _e,
      args: { type?: string; tags?: string[]; search?: string; limit?: number; offset?: number },
    ) => {
      const projectId = getCurrentProjectId();
      if (args.search) {
        return db.searchAssets(args.search, args.limit, projectId ?? undefined);
      }
      return db.queryAssets({
        type: args.type,
        projectId: projectId ?? undefined,
        limit: args.limit,
        offset: args.offset,
      });
    },
  );

  ipcMain.handle(
    'asset:getPath',
    async (_e, args: { hash: string; type: AssetType; ext: string }) => {
      if (!args.hash || typeof args.hash !== 'string') throw new Error('hash is required');
      assertValidAssetType(args.type);
      const filePath = cas.getAssetPath(args.hash, args.type, args.ext || 'png');
      return filePath;
    },
  );
}
