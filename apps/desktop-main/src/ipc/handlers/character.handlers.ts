import type { IpcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type {
  Character,
  CharacterGender,
  ReferenceImage,
  EquipmentLoadout,
} from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';
import { getCurrentProjectId } from '../project-context.js';

const VALID_ROLES: Character['role'][] = ['protagonist', 'antagonist', 'supporting', 'extra'];
const VALID_GENDERS: CharacterGender[] = ['male', 'female', 'non-binary', 'other'];

function requireProject(): { projectId: string } {
  const projectId = getCurrentProjectId();
  if (!projectId) throw new Error('No project open');
  return { projectId };
}

export function registerCharacterHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  ipcMain.handle('character:list', async () => {
    const { projectId } = requireProject();
    return db.listCharacters(projectId);
  });

  ipcMain.handle('character:get', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    const char = db.getCharacter(args.id);
    if (!char) throw new Error(`Character not found: ${args.id}`);
    return char;
  });

  ipcMain.handle('character:save', async (_e, args: Partial<Character>) => {
    if (!args || (typeof args.name !== 'string' && typeof args.id !== 'string')) {
      throw new Error('name or id is required');
    }
    const { projectId } = requireProject();
    const existing = typeof args.id === 'string' ? db.getCharacter(args.id) : undefined;
    const now = Date.now();

    const name = (typeof args.name === 'string' ? args.name : (existing?.name ?? '')).trim();
    if (!name) throw new Error('name is required');

    const role =
      typeof args.role === 'string' && VALID_ROLES.includes(args.role as Character['role'])
        ? (args.role as Character['role'])
        : (existing?.role ?? 'supporting');

    const gender =
      typeof args.gender === 'string' && VALID_GENDERS.includes(args.gender as CharacterGender)
        ? (args.gender as CharacterGender)
        : existing?.gender;

    const char: Character = {
      id: existing?.id ?? (typeof args.id === 'string' && args.id ? args.id : randomUUID()),
      name,
      projectId,
      role,
      description:
        typeof args.description === 'string' ? args.description : (existing?.description ?? ''),
      appearance:
        typeof args.appearance === 'string' ? args.appearance : (existing?.appearance ?? ''),
      personality:
        typeof args.personality === 'string' ? args.personality : (existing?.personality ?? ''),
      referenceImage:
        typeof args.referenceImage === 'string' ? args.referenceImage : existing?.referenceImage,
      costumes: Array.isArray(args.costumes) ? args.costumes : (existing?.costumes ?? []),
      tags: Array.isArray(args.tags)
        ? args.tags.filter((t): t is string => typeof t === 'string')
        : (existing?.tags ?? []),
      age: typeof args.age === 'number' ? args.age : existing?.age,
      gender,
      voice: typeof args.voice === 'string' ? args.voice : existing?.voice,
      referenceImages: Array.isArray(args.referenceImages)
        ? args.referenceImages
        : (existing?.referenceImages ?? []),
      loadouts: Array.isArray(args.loadouts) ? args.loadouts : (existing?.loadouts ?? []),
      defaultLoadoutId:
        typeof args.defaultLoadoutId === 'string'
          ? args.defaultLoadoutId
          : (existing?.defaultLoadoutId ?? ''),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    db.upsertCharacter({
      id: char.id,
      name: char.name,
      projectId: char.projectId,
      role: char.role,
      description: char.description,
      appearance: char.appearance,
      personality: char.personality,
      refImage: char.referenceImage,
      costumes: char.costumes,
      tags: char.tags,
      age: char.age,
      gender: char.gender,
      voice: char.voice,
      referenceImages: char.referenceImages,
      loadouts: char.loadouts,
      defaultLoadoutId: char.defaultLoadoutId,
      createdAt: char.createdAt,
      updatedAt: char.updatedAt,
    });
    return char;
  });

  ipcMain.handle('character:delete', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    db.deleteCharacter(args.id);
  });

  ipcMain.handle(
    'character:setRefImage',
    async (
      _e,
      args: { characterId: string; slot: string; assetHash: string; isStandard: boolean },
    ) => {
      if (!args || typeof args.characterId !== 'string') throw new Error('characterId is required');
      if (typeof args.slot !== 'string') throw new Error('slot is required');
      if (typeof args.assetHash !== 'string') throw new Error('assetHash is required');

      const char = db.getCharacter(args.characterId);
      if (!char) throw new Error(`Character not found: ${args.characterId}`);

      // Preserve existing variants when swapping the active image
      const existing = char.referenceImages.find((r) => r.slot === args.slot);
      const refImage: ReferenceImage = {
        slot: args.slot,
        assetHash: args.assetHash,
        isStandard: args.isStandard ?? true,
        ...(existing?.variants ? { variants: existing.variants } : {}),
      };

      const refs = char.referenceImages.filter((r) => r.slot !== args.slot);
      refs.push(refImage);

      db.upsertCharacter({
        id: char.id,
        name: char.name,
        projectId: char.projectId,
        referenceImages: refs,
        updatedAt: Date.now(),
      });

      return refImage;
    },
  );

  ipcMain.handle(
    'character:removeRefImage',
    async (_e, args: { characterId: string; slot: string }) => {
      if (!args || typeof args.characterId !== 'string') throw new Error('characterId is required');
      if (typeof args.slot !== 'string') throw new Error('slot is required');

      const char = db.getCharacter(args.characterId);
      if (!char) throw new Error(`Character not found: ${args.characterId}`);

      const refs = char.referenceImages.filter((r) => r.slot !== args.slot);

      db.upsertCharacter({
        id: char.id,
        name: char.name,
        projectId: char.projectId,
        referenceImages: refs,
        updatedAt: Date.now(),
      });
    },
  );

  ipcMain.handle(
    'character:saveLoadout',
    async (_e, args: { characterId: string; loadout: EquipmentLoadout }) => {
      if (!args || typeof args.characterId !== 'string') throw new Error('characterId is required');
      if (!args.loadout || typeof args.loadout.name !== 'string')
        throw new Error('loadout with name is required');

      const char = db.getCharacter(args.characterId);
      if (!char) throw new Error(`Character not found: ${args.characterId}`);

      const loadout: EquipmentLoadout = {
        id: args.loadout.id || randomUUID(),
        name: args.loadout.name.trim(),
        equipmentIds: Array.isArray(args.loadout.equipmentIds) ? args.loadout.equipmentIds : [],
      };

      const loadouts = char.loadouts.filter((l) => l.id !== loadout.id);
      loadouts.push(loadout);

      const defaultLoadoutId = char.defaultLoadoutId || loadout.id;

      db.upsertCharacter({
        id: char.id,
        name: char.name,
        projectId: char.projectId,
        loadouts,
        defaultLoadoutId,
        updatedAt: Date.now(),
      });

      return loadout;
    },
  );

  ipcMain.handle(
    'character:deleteLoadout',
    async (_e, args: { characterId: string; loadoutId: string }) => {
      if (!args || typeof args.characterId !== 'string') throw new Error('characterId is required');
      if (typeof args.loadoutId !== 'string') throw new Error('loadoutId is required');

      const char = db.getCharacter(args.characterId);
      if (!char) throw new Error(`Character not found: ${args.characterId}`);

      const loadouts = char.loadouts.filter((l) => l.id !== args.loadoutId);
      const defaultLoadoutId =
        char.defaultLoadoutId === args.loadoutId
          ? (loadouts[0]?.id ?? '')
          : char.defaultLoadoutId;

      db.upsertCharacter({
        id: char.id,
        name: char.name,
        projectId: char.projectId,
        loadouts,
        defaultLoadoutId,
        updatedAt: Date.now(),
      });
    },
  );
}
