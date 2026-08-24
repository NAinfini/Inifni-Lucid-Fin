import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Equipment, Folder, ReferenceImage } from '@lucid-fin/contracts';

export interface EquipmentState {
  items: Equipment[];
  selectedId: string | null;
  loading: boolean;
  folders: Folder[];
  currentFolderId: string | null;
  foldersLoading: boolean;
}

const initialState: EquipmentState = {
  items: [],
  selectedId: null,
  loading: false,
  folders: [],
  currentFolderId: null,
  foldersLoading: false,
};

export const equipmentSlice = createSlice({
  name: 'equipment',
  initialState,
  reducers: {
    setEquipment(state, action: PayloadAction<Equipment[]>) {
      state.items = action.payload;
    },
    addEquipment(state, action: PayloadAction<Equipment>) {
      state.items.push(action.payload);
    },
    addEquipmentBatch(state, action: PayloadAction<Equipment[]>) {
      state.items.push(...action.payload);
    },
    updateEquipment(state, action: PayloadAction<{ id: string; data: Partial<Equipment> }>) {
      const item = state.items.find((e) => e.id === action.payload.id);
      if (item) Object.assign(item, action.payload.data);
    },
    removeEquipment(state, action: PayloadAction<string>) {
      state.items = state.items.filter((e) => e.id !== action.payload);
      if (state.selectedId === action.payload) state.selectedId = null;
    },
    removeEquipmentBatch(state, action: PayloadAction<string[]>) {
      const ids = new Set(action.payload);
      state.items = state.items.filter((equipment) => !ids.has(equipment.id));
      if (state.selectedId && ids.has(state.selectedId)) state.selectedId = null;
    },
    selectEquipment(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setEquipmentRefImage(
      state,
      action: PayloadAction<{ equipmentId: string; refImage: ReferenceImage }>,
    ) {
      const item = state.items.find((e) => e.id === action.payload.equipmentId);
      if (!item) return;
      const refs = item.referenceImages.filter((r) => r.slot !== action.payload.refImage.slot);
      refs.push(action.payload.refImage);
      item.referenceImages = refs;
    },
    removeEquipmentRefImage(state, action: PayloadAction<{ equipmentId: string; slot: string }>) {
      const item = state.items.find((e) => e.id === action.payload.equipmentId);
      if (!item) return;
      item.referenceImages = item.referenceImages.filter((r) => r.slot !== action.payload.slot);
    },
    restore(_, action: PayloadAction<EquipmentState>) {
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
      for (const item of state.items) {
        if (item.folderId === action.payload) item.folderId = null;
      }
    },
    setCurrentFolder(state, action: PayloadAction<string | null>) {
      state.currentFolderId = action.payload;
    },
    setFoldersLoading(state, action: PayloadAction<boolean>) {
      state.foldersLoading = action.payload;
    },
    moveItemToFolder(state, action: PayloadAction<{ id: string; folderId: string | null }>) {
      const item = state.items.find((e) => e.id === action.payload.id);
      if (item) item.folderId = action.payload.folderId;
    },
    moveItemsToFolder(state, action: PayloadAction<{ ids: string[]; folderId: string | null }>) {
      const ids = new Set(action.payload.ids);
      for (const equipment of state.items) {
        if (ids.has(equipment.id)) equipment.folderId = action.payload.folderId;
      }
    },
  },
});

export const {
  setEquipment,
  addEquipment,
  addEquipmentBatch,
  updateEquipment,
  removeEquipment,
  removeEquipmentBatch,
  selectEquipment,
  setLoading,
  setEquipmentRefImage,
  removeEquipmentRefImage,
  setFolders,
  addFolder,
  updateFolder,
  removeFolder,
  setCurrentFolder,
  setFoldersLoading,
  moveItemToFolder,
  moveItemsToFolder,
} = equipmentSlice.actions;
