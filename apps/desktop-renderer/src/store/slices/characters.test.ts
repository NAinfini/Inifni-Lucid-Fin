import { describe, expect, it } from 'vitest';
import type { EquipmentLoadout, ReferenceImage } from '@lucid-fin/contracts';
import type { CharacterState, CharactersState } from './characters.js';
import {
  addCharacter,
  charactersSlice,
  removeCharacter,
  removeCharacterLoadout,
  removeCharacterRefImage,
  selectCharacter,
  setCharacterLoadout,
  setCharacterRefImage,
  setCharacters,
  setLoading,
  updateCharacter,
} from './characters.js';

function makeReferenceImage(overrides: Partial<ReferenceImage> = {}): ReferenceImage {
  return {
    slot: 'front',
    assetHash: 'ref-front',
    isStandard: true,
    ...overrides,
  };
}

function makeLoadout(overrides: Partial<EquipmentLoadout> = {}): EquipmentLoadout {
  return {
    id: 'loadout-1',
    name: 'Default Loadout',
    equipmentIds: ['sword'],
    ...overrides,
  };
}

function makeCharacter(overrides: Partial<CharacterState> = {}): CharacterState {
  return {
    id: 'character-1',
    name: 'Hero',
    role: 'protagonist',
    description: 'Main character',
    appearance: 'Tall and calm',
    personality: 'Focused',
    costumes: [],
    tags: ['lead'],
    referenceImages: [makeReferenceImage()],
    loadouts: [makeLoadout()],
    defaultLoadoutId: 'loadout-1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('characters slice', () => {
  it('has the expected initial state', () => {
    expect(charactersSlice.reducer(undefined, { type: '@@INIT' })).toEqual({
      items: [],
      selectedId: null,
      loading: false,
      folders: [],
      currentFolderId: null,
      foldersLoading: false,
    });
  });

  it('sets, adds, updates, selects, and removes characters', () => {
    let state = charactersSlice.reducer(
      undefined,
      setCharacters([makeCharacter(), makeCharacter({ id: 'character-2', name: 'Villain' })]),
    );
    state = charactersSlice.reducer(
      state,
      addCharacter(makeCharacter({ id: 'character-3', name: 'Support', defaultLoadoutId: '' })),
    );
    state = charactersSlice.reducer(state, selectCharacter('character-2'));
    state = charactersSlice.reducer(
      state,
      updateCharacter({
        id: 'character-2',
        data: { name: 'Villain Prime', tags: ['enemy'], defaultLoadoutId: 'loadout-1' },
      }),
    );
    state = charactersSlice.reducer(
      state,
      updateCharacter({
        id: 'missing',
        data: { name: 'Ignored' },
      }),
    );
    state = charactersSlice.reducer(state, setLoading(true));
    state = charactersSlice.reducer(state, removeCharacter('character-2'));

    expect(state.items.map((item) => item.id)).toEqual(['character-1', 'character-3']);
    expect(state.items.find((item) => item.id === 'character-1')?.name).toBe('Hero');
    expect(state.selectedId).toBeNull();
    expect(state.loading).toBe(true);
  });

  it('replaces reference images by slot and ignores missing characters', () => {
    let state = charactersSlice.reducer(undefined, setCharacters([makeCharacter()]));
    state = charactersSlice.reducer(
      state,
      setCharacterRefImage({
        characterId: 'character-1',
        refImage: makeReferenceImage({ slot: 'front', assetHash: 'ref-front-updated' }),
      }),
    );
    state = charactersSlice.reducer(
      state,
      setCharacterRefImage({
        characterId: 'character-1',
        refImage: makeReferenceImage({ slot: 'back', assetHash: 'ref-back' }),
      }),
    );
    state = charactersSlice.reducer(
      state,
      setCharacterRefImage({
        characterId: 'missing',
        refImage: makeReferenceImage({ slot: 'ignored' }),
      }),
    );
    state = charactersSlice.reducer(
      state,
      removeCharacterRefImage({ characterId: 'character-1', slot: 'front' }),
    );
    state = charactersSlice.reducer(
      state,
      removeCharacterRefImage({ characterId: 'missing', slot: 'back' }),
    );

    expect(state.items[0]?.referenceImages).toEqual([
      expect.objectContaining({ slot: 'back', assetHash: 'ref-back' }),
    ]);
  });

  it('manages loadouts and keeps default loadout consistent', () => {
    let state = charactersSlice.reducer(
      undefined,
      setCharacters([
        makeCharacter({
          referenceImages: [],
          loadouts: [],
          defaultLoadoutId: '',
        }),
      ]),
    );

    state = charactersSlice.reducer(
      state,
      setCharacterLoadout({
        characterId: 'character-1',
        loadout: makeLoadout({ id: 'loadout-1', name: 'Starter' }),
      }),
    );
    state = charactersSlice.reducer(
      state,
      setCharacterLoadout({
        characterId: 'character-1',
        loadout: makeLoadout({ id: 'loadout-2', name: 'Battle', equipmentIds: ['shield'] }),
      }),
    );
    state = charactersSlice.reducer(
      state,
      setCharacterLoadout({
        characterId: 'character-1',
        loadout: makeLoadout({
          id: 'loadout-2',
          name: 'Battle Updated',
          equipmentIds: ['shield', 'armor'],
        }),
      }),
    );
    state = charactersSlice.reducer(
      state,
      removeCharacterLoadout({ characterId: 'character-1', loadoutId: 'loadout-1' }),
    );
    state = charactersSlice.reducer(
      state,
      removeCharacterLoadout({ characterId: 'character-1', loadoutId: 'loadout-2' }),
    );
    state = charactersSlice.reducer(
      state,
      removeCharacterLoadout({ characterId: 'missing', loadoutId: 'ignored' }),
    );

    expect(state.items[0]).toMatchObject({
      loadouts: [],
      defaultLoadoutId: '',
    });
  });

  it('restores full state snapshots', () => {
    const restored: CharactersState = {
      items: [makeCharacter({ id: 'character-restore', name: 'Restored' })],
      selectedId: 'character-restore',
      loading: true,
      folders: [],
      currentFolderId: null,
      foldersLoading: false,
    };

    expect(charactersSlice.reducer(undefined, charactersSlice.actions.restore(restored))).toEqual(
      restored,
    );
  });
});
