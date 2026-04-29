import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Character, Folder, ReferenceImage, EquipmentLoadout } from '@lucid-fin/contracts';

export type CharacterState = Character;

export interface CharactersState {
  items: CharacterState[];
  selectedId: string | null;
  loading: boolean;
  folders: Folder[];
  currentFolderId: string | null;
  foldersLoading: boolean;
}

const initialState: CharactersState = {
  items: [],
  selectedId: null,
  loading: false,
  folders: [],
  currentFolderId: null,
  foldersLoading: false,
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
    removeCharacterRefImage(state, action: PayloadAction<{ characterId: string; slot: string }>) {
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
    setFolders(state, action: PayloadAction<Folder[]>) {
      state.folders = action.payload;
    },
    addFolder(state, action: PayloadAction<Folder>) {
      state.folders.push(action.payload);
    },
    updateFolder(state, action: PayloadAction<Folder>) {
      const idx = state.folders.findIndex((f) => f.id === action.payload.id);
      if (idx >= 0) state.folders[idx] = action.payload;
    },
    removeFolder(state, action: PayloadAction<string>) {
      state.folders = state.folders.filter((f) => f.id !== action.payload);
      if (state.currentFolderId === action.payload) state.currentFolderId = null;
      // Children cascade-deleted in storage; characters whose folder_id was
      // inside the subtree are reset to null by the repository. Clear local
      // folderId too so UI doesn't show stale membership.
      for (const ch of state.items) {
        if (ch.folderId === action.payload) ch.folderId = null;
      }
    },
    setCurrentFolder(state, action: PayloadAction<string | null>) {
      state.currentFolderId = action.payload;
    },
    setFoldersLoading(state, action: PayloadAction<boolean>) {
      state.foldersLoading = action.payload;
    },
    moveItemToFolder(state, action: PayloadAction<{ id: string; folderId: string | null }>) {
      const ch = state.items.find((c) => c.id === action.payload.id);
      if (ch) ch.folderId = action.payload.folderId;
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
  setFolders,
  addFolder,
  updateFolder,
  removeFolder,
  setCurrentFolder,
  setFoldersLoading,
  moveItemToFolder,
} = charactersSlice.actions;
