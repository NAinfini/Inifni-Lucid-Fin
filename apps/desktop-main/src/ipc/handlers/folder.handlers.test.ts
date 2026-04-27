import { describe, expect, it, vi } from 'vitest';
import { registerFolderHandlers } from './folder.handlers.js';

function makeDb() {
  return {
    repos: {
      folders: {
        list: vi.fn(() => [
          {
            id: 'folder-1',
            kind: 'character',
            parentId: null,
            name: 'Heroes',
            order: 0,
            createdAt: 100,
            updatedAt: 200,
          },
        ]),
        create: vi.fn(() => ({
          id: 'folder-2',
          kind: 'character',
          parentId: null,
          name: 'New',
          order: 1,
          createdAt: 100,
          updatedAt: 200,
        })),
        rename: vi.fn(),
        move: vi.fn(),
        delete: vi.fn(),
      },
      entities: {
        setCharacterFolder: vi.fn(),
        setEquipmentFolder: vi.fn(),
        setLocationFolder: vi.fn(),
      },
      assets: {
        setFolder: vi.fn(),
      },
    },
  };
}

function registerHandlers(db = makeDb()) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  registerFolderHandlers(
    {
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never,
    db as never,
  );
  return { handlers, db };
}

describe('registerFolderHandlers', () => {
  it('registers folder CRUD and setFolder IPC handlers', () => {
    const { handlers } = registerHandlers();

    expect([...handlers.keys()].sort()).toEqual([
      'asset:setFolder',
      'character:setFolder',
      'equipment:setFolder',
      'folder.asset:create',
      'folder.asset:delete',
      'folder.asset:list',
      'folder.asset:move',
      'folder.asset:rename',
      'folder.character:create',
      'folder.character:delete',
      'folder.character:list',
      'folder.character:move',
      'folder.character:rename',
      'folder.equipment:create',
      'folder.equipment:delete',
      'folder.equipment:list',
      'folder.equipment:move',
      'folder.equipment:rename',
      'folder.location:create',
      'folder.location:delete',
      'folder.location:list',
      'folder.location:move',
      'folder.location:rename',
      'location:setFolder',
    ]);
  });

  it('routes folder CRUD calls to the repository', async () => {
    const { handlers, db } = registerHandlers();

    await expect(handlers.get('folder.character:list')?.({})).resolves.toEqual([
      expect.objectContaining({ id: 'folder-1', name: 'Heroes' }),
    ]);
    await expect(
      handlers.get('folder.character:create')?.({}, { parentId: null, name: 'New' }),
    ).resolves.toEqual(expect.objectContaining({ id: 'folder-2', name: 'New' }));
    await expect(
      handlers.get('folder.character:rename')?.({}, { id: 'folder-1', name: 'Renamed' }),
    ).resolves.toBeUndefined();
    await expect(
      handlers.get('folder.character:move')?.({}, { id: 'folder-1', newParentId: 'parent-1' }),
    ).resolves.toBeUndefined();
    await expect(
      handlers.get('folder.character:delete')?.({}, { id: 'folder-1' }),
    ).resolves.toBeUndefined();

    expect(db.repos.folders.list).toHaveBeenCalledWith('character');
    expect(db.repos.folders.create).toHaveBeenCalledWith('character', {
      parentId: null,
      name: 'New',
    });
    expect(db.repos.folders.rename).toHaveBeenCalledWith('character', 'folder-1', 'Renamed');
    expect(db.repos.folders.move).toHaveBeenCalledWith('character', 'folder-1', 'parent-1');
    expect(db.repos.folders.delete).toHaveBeenCalledWith('character', 'folder-1');
  });

  it('rejects malformed folder create payloads at the typed IPC boundary', async () => {
    const { handlers, db } = registerHandlers();

    await expect(
      handlers.get('folder.character:create')?.({}, { parentId: null, name: 123 }),
    ).rejects.toThrow('name is required');
    expect(db.repos.folders.create).not.toHaveBeenCalled();
  });

  it('routes setFolder calls to entity and asset repositories', async () => {
    const { handlers, db } = registerHandlers();

    await expect(
      handlers.get('character:setFolder')?.({}, { id: 'char-1', folderId: 'folder-1' }),
    ).resolves.toBeUndefined();
    await expect(
      handlers.get('asset:setFolder')?.(
        {},
        {
          hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          folderId: null,
        },
      ),
    ).resolves.toBeUndefined();

    expect(db.repos.entities.setCharacterFolder).toHaveBeenCalledWith('char-1', 'folder-1');
    expect(db.repos.assets.setFolder).toHaveBeenCalledWith(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      null,
    );
  });
});
