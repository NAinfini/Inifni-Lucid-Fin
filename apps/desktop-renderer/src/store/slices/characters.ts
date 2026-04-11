import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  Character,
  ReferenceImage,
  EquipmentLoadout,
} from '@lucid-fin/contracts';

export type CharacterState = Character;

export interface CharactersState {
  items: CharacterState[];
  selectedId: string | null;
  loading: boolean;
}

const initialState: CharactersState = {
  items: [],
  selectedId: null,
  loading: false,
};

export const charactersSlice = createSlice({
  name: 'characters',
  initialState,
  reducers: {
    setCharacters(state, action: PayloadAction<CharacterState[]>) {
      state.items = action.payload;
    },
    addCharacter(state, action: PayloadAction<CharacterState>) {
      state.items.push(action.payload);
    },
    updateCharacter(state, action: PayloadAction<{ id: string; data: Partial<CharacterState> }>) {
      const ch = state.items.find((c) => c.id === action.payload.id);
      if (ch) Object.assign(ch, action.payload.data);
    },
    removeCharacter(state, action: PayloadAction<string>) {
      state.items = state.items.filter((c) => c.id !== action.payload);
      if (state.selectedId === action.payload) state.selectedId = null;
    },
    selectCharacter(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setCharacterRefImage(
      state,
      action: PayloadAction<{ characterId: string; refImage: ReferenceImage }>,
    ) {
      const ch = state.items.find((c) => c.id === action.payload.characterId);
      if (!ch) return;
      const refs = ch.referenceImages.filter((r) => r.slot !== action.payload.refImage.slot);
      refs.push(action.payload.refImage);
      ch.referenceImages = refs;
    },
    removeCharacterRefImage(
      state,
      action: PayloadAction<{ characterId: string; slot: string }>,
    ) {
      const ch = state.items.find((c) => c.id === action.payload.characterId);
      if (!ch) return;
      ch.referenceImages = ch.referenceImages.filter((r) => r.slot !== action.payload.slot);
    },
    setCharacterLoadout(
      state,
      action: PayloadAction<{ characterId: string; loadout: EquipmentLoadout }>,
    ) {
      const ch = state.items.find((c) => c.id === action.payload.characterId);
      if (!ch) return;
      const loadouts = ch.loadouts.filter((l) => l.id !== action.payload.loadout.id);
      loadouts.push(action.payload.loadout);
      ch.loadouts = loadouts;
      if (!ch.defaultLoadoutId) {
        ch.defaultLoadoutId = action.payload.loadout.id;
      }
    },
    removeCharacterLoadout(
      state,
      action: PayloadAction<{ characterId: string; loadoutId: string }>,
    ) {
      const ch = state.items.find((c) => c.id === action.payload.characterId);
      if (!ch) return;
      ch.loadouts = ch.loadouts.filter((l) => l.id !== action.payload.loadoutId);
      if (ch.defaultLoadoutId === action.payload.loadoutId) {
        ch.defaultLoadoutId = ch.loadouts[0]?.id ?? '';
      }
    },
    restore(_, action: PayloadAction<CharactersState>) {
      return action.payload;
    },
  },
});

export const {
  setCharacters,
  addCharacter,
  updateCharacter,
  removeCharacter,
  selectCharacter,
  setLoading,
  setCharacterRefImage,
  removeCharacterRefImage,
  setCharacterLoadout,
  removeCharacterLoadout,
} = charactersSlice.actions;
