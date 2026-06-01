import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import { registerEntitySoftDeleteHandlers } from './entity-soft-delete.handlers.js';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

vi.mock('@lucid-fin/contracts-parse', () => ({
  parseCharacterId: (id: string) => id,
  parseEquipmentId: (id: string) => id,
  parseLocationId: (id: string) => id,
}));

vi.mock('../ipc-error-handler.js', () => ({
  safeHandle: (
    ipc: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => void },
    channel: string,
    handler: (...args: unknown[]) => unknown,
  ) => {
    ipc.handle(channel, handler);
  },
}));

describe('registerEntitySoftDeleteHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  let db: {
    repos: {
      entities: Record<string, ReturnType<typeof vi.fn>>;
    };
  };

  beforeEach(() => {
    handlers = new Map();
    const ipcMain = {
      handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn),
    } as unknown as IpcMain;

    db = {
      repos: {
        entities: {
          listDeletedCharacters: vi.fn(() => ({ rows: [{ id: 'c1' }] })),
          listDeletedEquipment: vi.fn(() => ({ rows: [{ id: 'e1' }] })),
          listDeletedLocations: vi.fn(() => ({ rows: [{ id: 'l1' }] })),
          restoreCharacter: vi.fn(),
          restoreEquipment: vi.fn(),
          restoreLocation: vi.fn(),
          purgeCharacter: vi.fn(),
          purgeEquipment: vi.fn(),
          purgeLocation: vi.fn(),
          purgeCharactersOlderThan: vi.fn(() => 2),
          purgeEquipmentOlderThan: vi.fn(() => 1),
          purgeLocationsOlderThan: vi.fn(() => 3),
        },
      },
    };

    registerEntitySoftDeleteHandlers(ipcMain, db as unknown as SqliteIndex);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('entity:listDeleted', () => {
    it('routes to correct repo method based on entityType', async () => {
      const handler = handlers.get('entity:listDeleted')!;

      const characters = await handler({}, { entityType: 'character' });
      expect(characters).toEqual([{ id: 'c1' }]);
      expect(db.repos.entities.listDeletedCharacters).toHaveBeenCalled();

      const equipment = await handler({}, { entityType: 'equipment' });
      expect(equipment).toEqual([{ id: 'e1' }]);
      expect(db.repos.entities.listDeletedEquipment).toHaveBeenCalled();

      const locations = await handler({}, { entityType: 'location' });
      expect(locations).toEqual([{ id: 'l1' }]);
      expect(db.repos.entities.listDeletedLocations).toHaveBeenCalled();
    });

    it('throws if entityType is missing or invalid', async () => {
      const handler = handlers.get('entity:listDeleted')!;

      await expect(handler({}, {})).rejects.toThrow('entityType is required');
      await expect(handler({}, null)).rejects.toThrow('entityType is required');
      await expect(handler({}, { entityType: 'invalid' })).rejects.toThrow(
        'Unknown entity type: invalid',
      );
    });
  });

  describe('entity:restore', () => {
    it('routes to correct restore method based on entityType', async () => {
      const handler = handlers.get('entity:restore')!;

      await handler({}, { entityType: 'character', id: 'c1' });
      expect(db.repos.entities.restoreCharacter).toHaveBeenCalledWith('c1');

      await handler({}, { entityType: 'equipment', id: 'e1' });
      expect(db.repos.entities.restoreEquipment).toHaveBeenCalledWith('e1');

      await handler({}, { entityType: 'location', id: 'l1' });
      expect(db.repos.entities.restoreLocation).toHaveBeenCalledWith('l1');
    });

    it('throws if id or entityType is missing', async () => {
      const handler = handlers.get('entity:restore')!;

      await expect(handler({}, { entityType: 'character' })).rejects.toThrow('id is required');
      await expect(handler({}, { id: 'c1' })).rejects.toThrow('entityType is required');
      await expect(handler({}, null)).rejects.toThrow('id is required');
    });
  });

  describe('entity:purge', () => {
    it('routes to correct purge method based on entityType', async () => {
      const handler = handlers.get('entity:purge')!;

      await handler({}, { entityType: 'character', id: 'c1' });
      expect(db.repos.entities.purgeCharacter).toHaveBeenCalledWith('c1');

      await handler({}, { entityType: 'equipment', id: 'e1' });
      expect(db.repos.entities.purgeEquipment).toHaveBeenCalledWith('e1');

      await handler({}, { entityType: 'location', id: 'l1' });
      expect(db.repos.entities.purgeLocation).toHaveBeenCalledWith('l1');
    });
  });

  describe('entity:purgeOlderThan', () => {
    it('returns purge counts for all entity types', async () => {
      const handler = handlers.get('entity:purgeOlderThan')!;

      const result = await handler({}, { days: 30 });

      expect(result).toEqual({
        purged: { characters: 2, equipment: 1, locations: 3 },
      });
      expect(db.repos.entities.purgeCharactersOlderThan).toHaveBeenCalledWith(30);
      expect(db.repos.entities.purgeEquipmentOlderThan).toHaveBeenCalledWith(30);
      expect(db.repos.entities.purgeLocationsOlderThan).toHaveBeenCalledWith(30);
    });

    it('throws if days is not a positive number', async () => {
      const handler = handlers.get('entity:purgeOlderThan')!;

      await expect(handler({}, { days: 0 })).rejects.toThrow('days must be a positive number');
      await expect(handler({}, { days: -1 })).rejects.toThrow('days must be a positive number');
      await expect(handler({}, {})).rejects.toThrow('days must be a positive number');
    });
  });
});
