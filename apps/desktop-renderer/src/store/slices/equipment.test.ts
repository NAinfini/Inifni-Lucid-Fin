import { describe, expect, it } from 'vitest';
import type { Equipment, ReferenceImage } from '@lucid-fin/contracts';
import {
  equipmentSlice,
  setEquipment,
  addEquipment,
  updateEquipment,
  removeEquipment,
  selectEquipment,
  setLoading,
  setEquipmentRefImage,
  removeEquipmentRefImage,
} from './equipment.js';

function makeEquipment(overrides?: Partial<Equipment>): Equipment {
  return {
    id: 'eq-1',
    name: 'Sword',
    type: 'weapon',
    description: 'A steel sword',
    tags: ['melee'],
    referenceImages: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('equipment slice', () => {
  it('sets equipment list', () => {
    const items = [makeEquipment(), makeEquipment({ id: 'eq-2', name: 'Shield', type: 'armor' })];
    const state = equipmentSlice.reducer(undefined, setEquipment(items));
    expect(state.items).toHaveLength(2);
    expect(state.items[0].name).toBe('Sword');
    expect(state.items[1].name).toBe('Shield');
  });

  it('adds equipment', () => {
    const state = equipmentSlice.reducer(undefined, addEquipment(makeEquipment()));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe('eq-1');
  });

  it('updates equipment', () => {
    let state = equipmentSlice.reducer(undefined, addEquipment(makeEquipment()));
    state = equipmentSlice.reducer(
      state,
      updateEquipment({ id: 'eq-1', data: { name: 'Magic Sword', type: 'weapon' } }),
    );
    expect(state.items[0].name).toBe('Magic Sword');
  });

  it('removes equipment and clears selectedId if matching', () => {
    let state = equipmentSlice.reducer(undefined, addEquipment(makeEquipment()));
    state = equipmentSlice.reducer(state, selectEquipment('eq-1'));
    expect(state.selectedId).toBe('eq-1');

    state = equipmentSlice.reducer(state, removeEquipment('eq-1'));
    expect(state.items).toHaveLength(0);
    expect(state.selectedId).toBeNull();
  });

  it('selects equipment', () => {
    let state = equipmentSlice.reducer(undefined, addEquipment(makeEquipment()));
    state = equipmentSlice.reducer(state, selectEquipment('eq-1'));
    expect(state.selectedId).toBe('eq-1');

    state = equipmentSlice.reducer(state, selectEquipment(null));
    expect(state.selectedId).toBeNull();
  });

  it('sets loading', () => {
    let state = equipmentSlice.reducer(undefined, setLoading(true));
    expect(state.loading).toBe(true);

    state = equipmentSlice.reducer(state, setLoading(false));
    expect(state.loading).toBe(false);
  });

  it('sets a reference image on equipment', () => {
    let state = equipmentSlice.reducer(undefined, addEquipment(makeEquipment()));
    const refImage: ReferenceImage = { slot: 'front', assetHash: 'abc123', isStandard: true };
    state = equipmentSlice.reducer(state, setEquipmentRefImage({ equipmentId: 'eq-1', refImage }));
    expect(state.items[0].referenceImages).toHaveLength(1);
    expect(state.items[0].referenceImages[0].slot).toBe('front');
    expect(state.items[0].referenceImages[0].assetHash).toBe('abc123');
  });

  it('replaces an existing reference image in the same slot', () => {
    let state = equipmentSlice.reducer(undefined, addEquipment(makeEquipment()));
    state = equipmentSlice.reducer(
      state,
      setEquipmentRefImage({
        equipmentId: 'eq-1',
        refImage: { slot: 'front', assetHash: 'hash1', isStandard: true },
      }),
    );
    state = equipmentSlice.reducer(
      state,
      setEquipmentRefImage({
        equipmentId: 'eq-1',
        refImage: { slot: 'front', assetHash: 'hash2', isStandard: true },
      }),
    );
    expect(state.items[0].referenceImages).toHaveLength(1);
    expect(state.items[0].referenceImages[0].assetHash).toBe('hash2');
  });

  it('removes a reference image by slot', () => {
    let state = equipmentSlice.reducer(undefined, addEquipment(makeEquipment()));
    state = equipmentSlice.reducer(
      state,
      setEquipmentRefImage({
        equipmentId: 'eq-1',
        refImage: { slot: 'front', assetHash: 'abc', isStandard: true },
      }),
    );
    state = equipmentSlice.reducer(
      state,
      setEquipmentRefImage({
        equipmentId: 'eq-1',
        refImage: { slot: 'back', assetHash: 'def', isStandard: true },
      }),
    );
    expect(state.items[0].referenceImages).toHaveLength(2);

    state = equipmentSlice.reducer(
      state,
      removeEquipmentRefImage({ equipmentId: 'eq-1', slot: 'front' }),
    );
    expect(state.items[0].referenceImages).toHaveLength(1);
    expect(state.items[0].referenceImages[0].slot).toBe('back');
  });

  it('restore replaces entire state', () => {
    const initial = equipmentSlice.reducer(undefined, addEquipment(makeEquipment()));
    const restored = equipmentSlice.reducer(
      initial,
      equipmentSlice.actions.restore({
        items: [makeEquipment({ id: 'eq-99', name: 'Restored' })],
        selectedId: 'eq-99',
        loading: false,
        folders: [],
        currentFolderId: null,
        foldersLoading: false,
      }),
    );
    expect(restored.items).toHaveLength(1);
    expect(restored.items[0].id).toBe('eq-99');
    expect(restored.selectedId).toBe('eq-99');
  });
});
