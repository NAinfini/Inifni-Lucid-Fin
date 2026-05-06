/**
 * Entity (Character) CRUD integration tests with soft-delete and restore.
 *
 * Exercises the full handler -> EntityRepository -> SQLite chain.
 * Tests character:save -> character:get -> character:list -> character:delete
 * (soft) -> entity:restore -> entity:listDeleted flows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Character } from '@lucid-fin/contracts';
import {
  createFakeIpcMain,
  createTestDb,
  cleanupTestDb,
  invoke,
  type FakeIpcMain,
  type TestDb,
} from './ipc-test-harness.js';

// Mock the logger.
const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

// Mock the ipc-error-handler logger (used by safeHandle in entity-soft-delete).
vi.mock('@lucid-fin/contracts', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig };
});

import { registerCharacterHandlers } from '../../handlers/character.handlers.js';
import { registerEntitySoftDeleteHandlers } from '../../handlers/entity-soft-delete.handlers.js';

describe('Entity (Character) CRUD integration', () => {
  let testDb: TestDb;
  let ipcMain: FakeIpcMain;

  beforeEach(() => {
    testDb = createTestDb();
    ipcMain = createFakeIpcMain();
    registerCharacterHandlers(ipcMain, testDb.db);
    registerEntitySoftDeleteHandlers(ipcMain, testDb.db);
  });

  afterEach(() => {
    cleanupTestDb(testDb);
    vi.clearAllMocks();
  });

  it('create -> get -> update -> delete (soft) -> restore full lifecycle', async () => {
    // 1. Create a character
    const created = await invoke<Character>(ipcMain, 'character:save', {
      name: 'Hero',
      role: 'protagonist',
      description: 'Main character',
      appearance: 'tall, dark hair',
      personality: 'brave',
      tags: ['main'],
    });
    expect(created.id).toBeTypeOf('string');
    expect(created.name).toBe('Hero');
    expect(created.role).toBe('protagonist');
    expect(created.tags).toEqual(['main']);
    expect(created.createdAt).toBeTypeOf('number');
    expect(created.updatedAt).toBeTypeOf('number');

    // 2. Get the character
    const fetched = await invoke<Character>(ipcMain, 'character:get', { id: created.id });
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe('Hero');
    expect(fetched.role).toBe('protagonist');

    // 3. Update the character
    const updated = await invoke<Character>(ipcMain, 'character:save', {
      id: created.id,
      name: 'Super Hero',
      description: 'Updated description',
      tags: ['main', 'updated'],
    });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe('Super Hero');
    expect(updated.description).toBe('Updated description');
    expect(updated.tags).toEqual(['main', 'updated']);
    // Role should be preserved from existing
    expect(updated.role).toBe('protagonist');

    // 4. Verify updated character in DB
    const reloaded = await invoke<Character>(ipcMain, 'character:get', { id: created.id });
    expect(reloaded.name).toBe('Super Hero');
    expect(reloaded.description).toBe('Updated description');

    // 5. List characters
    const list = await invoke<Character[]>(ipcMain, 'character:list');
    expect(list).toHaveLength(1);

    // 6. Soft-delete the character
    await invoke(ipcMain, 'character:delete', { id: created.id });

    // 7. Character should not be visible anymore
    await expect(invoke(ipcMain, 'character:get', { id: created.id })).rejects.toThrow(
      /not found/i,
    );
    const listAfterDelete = await invoke<Character[]>(ipcMain, 'character:list');
    expect(listAfterDelete).toHaveLength(0);

    // 8. Should appear in deleted list
    const deletedList = await invoke<Character[]>(ipcMain, 'entity:listDeleted', {
      entityType: 'character',
    });
    expect(deletedList).toHaveLength(1);
    expect(deletedList[0].name).toBe('Super Hero');

    // 9. Restore the character
    await invoke(ipcMain, 'entity:restore', {
      entityType: 'character',
      id: created.id,
    });

    // 10. Character should be visible again
    const restored = await invoke<Character>(ipcMain, 'character:get', { id: created.id });
    expect(restored.name).toBe('Super Hero');
    const listAfterRestore = await invoke<Character[]>(ipcMain, 'character:list');
    expect(listAfterRestore).toHaveLength(1);

    // 11. Deleted list should be empty
    const deletedListAfterRestore = await invoke<Character[]>(ipcMain, 'entity:listDeleted', {
      entityType: 'character',
    });
    expect(deletedListAfterRestore).toHaveLength(0);
  });

  it('get rejects missing character id', async () => {
    await expect(invoke(ipcMain, 'character:get', { id: 'nonexistent' })).rejects.toThrow(
      /not found/i,
    );
  });

  it('save rejects character without name', async () => {
    await expect(invoke(ipcMain, 'character:save', {})).rejects.toThrow(/name/i);
  });

  it('preserves reference images through save/get round-trip', async () => {
    const created = await invoke<Character>(ipcMain, 'character:save', {
      name: 'RefTest',
      referenceImages: [
        { slot: 'front', assetHash: 'hash-front', isStandard: true },
        { slot: 'back', assetHash: 'hash-back', isStandard: true },
      ],
    });

    const loaded = await invoke<Character>(ipcMain, 'character:get', { id: created.id });
    expect(loaded.referenceImages).toHaveLength(2);
    const slots = loaded.referenceImages.map((r) => r.slot).sort();
    // 'front' normalizes to 'main'
    expect(slots).toEqual(['back', 'main']);
    expect(loaded.referenceImages.find((r) => r.slot === 'main')?.assetHash).toBe('hash-front');
    expect(loaded.referenceImages.find((r) => r.slot === 'back')?.assetHash).toBe('hash-back');
  });

  it('preserves costumes and loadouts through save/get round-trip', async () => {
    const created = await invoke<Character>(ipcMain, 'character:save', {
      name: 'LoadoutTest',
      costumes: [{ id: 'c1', name: 'Armor', description: 'Heavy plate' }],
      loadouts: [{ id: 'l1', name: 'Battle', equipmentIds: ['eq-1', 'eq-2'] }],
      defaultLoadoutId: 'l1',
    });

    const loaded = await invoke<Character>(ipcMain, 'character:get', { id: created.id });
    expect(loaded.costumes).toHaveLength(1);
    expect(loaded.costumes[0].name).toBe('Armor');
    expect(loaded.loadouts).toHaveLength(1);
    expect(loaded.loadouts[0].name).toBe('Battle');
    expect(loaded.loadouts[0].equipmentIds).toEqual(['eq-1', 'eq-2']);
    expect(loaded.defaultLoadoutId).toBe('l1');
  });

  it('invalid role falls back to supporting on create', async () => {
    const created = await invoke<Character>(ipcMain, 'character:save', {
      name: 'BadRole',
      role: 'invalid-role',
    });
    expect(created.role).toBe('supporting');
  });
});
