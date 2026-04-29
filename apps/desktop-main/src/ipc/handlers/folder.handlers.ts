import type { IpcMain } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import type { FolderKind } from '@lucid-fin/contracts';
import {
  parseCharacterId,
  parseEquipmentId,
  parseLocationId,
  parseAssetHash,
} from '@lucid-fin/contracts-parse';

/**
 * Folder IPC handlers — one registration per kind via the shared
 * FolderRepository on SqliteIndex. Channels follow the `folder.<kind>:<op>`
 * pattern:
 *   folder.character:list / create / rename / move / delete
 *   folder.equipment:... / folder.location:... / folder.asset:...
 *
 * `<entity>:setFolder` moves a single entity into (or out of) a folder. The
 * entity tables own the relation, so these channels live next to the folder
 * CRUD rather than on each entity handler file, keeping folder-feature code
 * colocated.
 */
export function registerFolderHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  const KINDS: FolderKind[] = ['character', 'equipment', 'location', 'asset'];

  for (const kind of KINDS) {
    ipcMain.handle(`folder.${kind}:list`, async () => {
      return db.repos.folders.list(kind);
    });

    ipcMain.handle(
      `folder.${kind}:create`,
      async (_e, args: { parentId: string | null; name: string }) => {
        if (!args || typeof args.name !== 'string') throw new Error('name is required');
        const parentId =
          args.parentId === null || args.parentId === undefined ? null : String(args.parentId);
        return db.repos.folders.create(kind, { parentId, name: args.name });
      },
    );

    ipcMain.handle(`folder.${kind}:rename`, async (_e, args: { id: string; name: string }) => {
      if (!args || typeof args.id !== 'string') throw new Error('id is required');
      if (typeof args.name !== 'string') throw new Error('name is required');
      return db.repos.folders.rename(kind, args.id, args.name);
    });

    ipcMain.handle(
      `folder.${kind}:move`,
      async (_e, args: { id: string; newParentId: string | null }) => {
        if (!args || typeof args.id !== 'string') throw new Error('id is required');
        const newParentId =
          args.newParentId === null || args.newParentId === undefined
            ? null
            : String(args.newParentId);
        return db.repos.folders.move(kind, args.id, newParentId);
      },
    );

    ipcMain.handle(`folder.${kind}:delete`, async (_e, args: { id: string }) => {
      if (!args || typeof args.id !== 'string') throw new Error('id is required');
      db.repos.folders.delete(kind, args.id);
    });
  }

  // ── Per-entity setFolder channels ──────────────────────────────

  ipcMain.handle(
    'character:setFolder',
    async (_e, args: { id: string; folderId: string | null }) => {
      if (!args || typeof args.id !== 'string') throw new Error('id is required');
      const folderId =
        args.folderId === null || args.folderId === undefined ? null : String(args.folderId);
      db.repos.entities.setCharacterFolder(parseCharacterId(args.id), folderId);
    },
  );

  ipcMain.handle(
    'equipment:setFolder',
    async (_e, args: { id: string; folderId: string | null }) => {
      if (!args || typeof args.id !== 'string') throw new Error('id is required');
      const folderId =
        args.folderId === null || args.folderId === undefined ? null : String(args.folderId);
      db.repos.entities.setEquipmentFolder(parseEquipmentId(args.id), folderId);
    },
  );

  ipcMain.handle(
    'location:setFolder',
    async (_e, args: { id: string; folderId: string | null }) => {
      if (!args || typeof args.id !== 'string') throw new Error('id is required');
      const folderId =
        args.folderId === null || args.folderId === undefined ? null : String(args.folderId);
      db.repos.entities.setLocationFolder(parseLocationId(args.id), folderId);
    },
  );

  ipcMain.handle('asset:setFolder', async (_e, args: { hash: string; folderId: string | null }) => {
    if (!args || typeof args.hash !== 'string') throw new Error('hash is required');
    const folderId =
      args.folderId === null || args.folderId === undefined ? null : String(args.folderId);
    db.repos.assets.setFolder(parseAssetHash(args.hash), folderId);
  });
}
