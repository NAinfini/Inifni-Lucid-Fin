/**
 * IPC handlers for entity soft-delete operations: restore, listDeleted, purge.
 *
 * Delete operations themselves are already handled by the existing
 * character/equipment/location handlers — the underlying repository
 * methods now perform soft-delete instead of hard-delete.
 */
import type { IpcMain } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import type { EntityType } from '@lucid-fin/contracts';
import { parseCharacterId, parseEquipmentId, parseLocationId } from '@lucid-fin/contracts-parse';
import { safeHandle } from '../ipc-error-handler.js';

export function registerEntitySoftDeleteHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  // ── List deleted entities ────────────────────────────────────
  safeHandle(ipcMain, 'entity:listDeleted', async (_e, args: { entityType: EntityType }) => {
    if (!args || typeof args.entityType !== 'string') {
      throw new Error('entityType is required');
    }
    switch (args.entityType) {
      case 'character':
        return db.repos.entities.listDeletedCharacters().rows;
      case 'equipment':
        return db.repos.entities.listDeletedEquipment().rows;
      case 'location':
        return db.repos.entities.listDeletedLocations().rows;
      default:
        throw new Error(`Unknown entity type: ${args.entityType as string}`);
    }
  });

  // ── Restore a soft-deleted entity ────────────────────────────
  safeHandle(
    ipcMain,
    'entity:restore',
    async (_e, args: { entityType: EntityType; id: string }) => {
      if (!args || typeof args.id !== 'string') throw new Error('id is required');
      if (typeof args.entityType !== 'string') throw new Error('entityType is required');

      switch (args.entityType) {
        case 'character':
          db.repos.entities.restoreCharacter(parseCharacterId(args.id));
          break;
        case 'equipment':
          db.repos.entities.restoreEquipment(parseEquipmentId(args.id));
          break;
        case 'location':
          db.repos.entities.restoreLocation(parseLocationId(args.id));
          break;
        default:
          throw new Error(`Unknown entity type: ${args.entityType as string}`);
      }
    },
  );

  // ── Purge a single soft-deleted entity (permanent delete) ────
  safeHandle(ipcMain, 'entity:purge', async (_e, args: { entityType: EntityType; id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    if (typeof args.entityType !== 'string') throw new Error('entityType is required');

    switch (args.entityType) {
      case 'character':
        db.repos.entities.purgeCharacter(parseCharacterId(args.id));
        break;
      case 'equipment':
        db.repos.entities.purgeEquipment(parseEquipmentId(args.id));
        break;
      case 'location':
        db.repos.entities.purgeLocation(parseLocationId(args.id));
        break;
      default:
        throw new Error(`Unknown entity type: ${args.entityType as string}`);
    }
  });

  // ── Purge all soft-deleted entities older than N days ─────────
  safeHandle(ipcMain, 'entity:purgeOlderThan', async (_e, args: { days: number }) => {
    if (!args || typeof args.days !== 'number' || args.days < 1) {
      throw new Error('days must be a positive number');
    }
    const charCount = db.repos.entities.purgeCharactersOlderThan(args.days);
    const equipCount = db.repos.entities.purgeEquipmentOlderThan(args.days);
    const locCount = db.repos.entities.purgeLocationsOlderThan(args.days);
    return { purged: { characters: charCount, equipment: equipCount, locations: locCount } };
  });
}
