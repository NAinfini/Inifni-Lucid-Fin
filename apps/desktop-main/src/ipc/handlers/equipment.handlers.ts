import type { IpcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { Equipment, EquipmentType, ReferenceImage } from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';
import { parseEquipmentId } from '@lucid-fin/contracts-parse';

const VALID_TYPES: EquipmentType[] = [
  'weapon',
  'armor',
  'clothing',
  'accessory',
  'vehicle',
  'tool',
  'furniture',
  'other',
];

export function registerEquipmentHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  ipcMain.handle('equipment:list', async (_e, args?: { type?: string } | void) => {
    const typeFilter = args && typeof args === 'object' && typeof args.type === 'string'
      ? args.type
      : undefined;
    return db.repos.entities.listEquipment(typeFilter).rows;
  });

  ipcMain.handle('equipment:get', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    const equip = db.repos.entities.getEquipment(parseEquipmentId(args.id));
    if (!equip) throw new Error(`Equipment not found: ${args.id}`);
    return equip;
  });

  ipcMain.handle('equipment:save', async (_e, args: Partial<Equipment>) => {
    if (!args || (typeof args.name !== 'string' && typeof args.id !== 'string')) {
      throw new Error('name or id is required');
    }
    const existing =
      typeof args.id === 'string' && args.id
        ? db.repos.entities.getEquipment(parseEquipmentId(args.id))
        : undefined;
    const now = Date.now();

    const name = (typeof args.name === 'string' ? args.name : (existing?.name ?? '')).trim();
    if (!name) throw new Error('name is required');

    const type =
      typeof args.type === 'string' && VALID_TYPES.includes(args.type as EquipmentType)
        ? (args.type as EquipmentType)
        : (existing?.type ?? 'other');

    const equip: Equipment = {
      id: existing?.id ?? (typeof args.id === 'string' && args.id ? parseEquipmentId(args.id) : randomUUID()),
      name,
      type,
      subtype: typeof args.subtype === 'string' ? args.subtype : existing?.subtype,
      description:
        typeof args.description === 'string' ? args.description : (existing?.description ?? ''),
      function: typeof args.function === 'string' ? args.function : existing?.function,
      tags: Array.isArray(args.tags)
        ? args.tags.filter((t): t is string => typeof t === 'string')
        : (existing?.tags ?? []),
      referenceImages: Array.isArray(args.referenceImages)
        ? args.referenceImages
        : (existing?.referenceImages ?? []),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    db.repos.entities.upsertEquipment({
      id: equip.id,
      name: equip.name,
      type: equip.type,
      subtype: equip.subtype,
      description: equip.description,
      functionDesc: equip.function,
      tags: equip.tags,
      referenceImages: equip.referenceImages,
      createdAt: equip.createdAt,
      updatedAt: equip.updatedAt,
    });
    return equip;
  });

  ipcMain.handle('equipment:delete', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    db.repos.entities.deleteEquipment(parseEquipmentId(args.id));
  });

  ipcMain.handle(
    'equipment:setRefImage',
    async (
      _e,
      args: { equipmentId: string; slot: string; assetHash: string; isStandard: boolean },
    ) => {
      if (!args || typeof args.equipmentId !== 'string')
        throw new Error('equipmentId is required');
      if (typeof args.slot !== 'string') throw new Error('slot is required');
      if (typeof args.assetHash !== 'string') throw new Error('assetHash is required');

      const equip = db.repos.entities.getEquipment(parseEquipmentId(args.equipmentId));
      if (!equip) throw new Error(`Equipment not found: ${args.equipmentId}`);

      const existing = equip.referenceImages.find((r) => r.slot === args.slot);
      const refImage: ReferenceImage = {
        slot: args.slot,
        assetHash: args.assetHash,
        isStandard: args.isStandard ?? true,
        ...(existing?.variants ? { variants: existing.variants } : {}),
      };

      const refs = equip.referenceImages.filter((r) => r.slot !== args.slot);
      refs.push(refImage);

      db.repos.entities.upsertEquipment({
        ...equip,
        referenceImages: refs,
        updatedAt: Date.now(),
      });

      return refImage;
    },
  );

  ipcMain.handle(
    'equipment:removeRefImage',
    async (_e, args: { equipmentId: string; slot: string }) => {
      if (!args || typeof args.equipmentId !== 'string')
        throw new Error('equipmentId is required');
      if (typeof args.slot !== 'string') throw new Error('slot is required');

      const equip = db.repos.entities.getEquipment(parseEquipmentId(args.equipmentId));
      if (!equip) throw new Error(`Equipment not found: ${args.equipmentId}`);

      const refs = equip.referenceImages.filter((r) => r.slot !== args.slot);

      db.repos.entities.upsertEquipment({
        ...equip,
        referenceImages: refs,
        updatedAt: Date.now(),
      });
    },
  );
}
