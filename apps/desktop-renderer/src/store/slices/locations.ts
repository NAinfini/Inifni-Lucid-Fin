import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Folder, Location, ReferenceImage } from '@lucid-fin/contracts';

export interface LocationsState {
  items: Location[];
  selectedId: string | null;
  loading: boolean;
  search: string;
  folders: Folder[];
  currentFolderId: string | null;
  foldersLoading: boolean;
}

const initialState: LocationsState = {
  items: [],
  selectedId: null,
  loading: false,
  search: '',
  folders: [],
  currentFolderId: null,
  foldersLoading: false,
};

export const locationsSlice = createSlice({
  name: 'locations',
  initialState,
  reducers: {
    setLocations(state, action: PayloadAction<Location[]>) {
      state.items = action.payload;
    },
    addLocation(state, action: PayloadAction<Location>) {
      state.items.push(action.payload);
    },
    updateLocation(state, action: PayloadAction<{ id: string; data: Partial<Location> }>) {
      const item = state.items.find((l) => l.id === action.payload.id);
      if (item) Object.assign(item, action.payload.data);
    },
    removeLocation(state, action: PayloadAction<string>) {
      state.items = state.items.filter((l) => l.id !== action.payload);
      if (state.selectedId === action.payload) state.selectedId = null;
    },
    selectLocation(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },
    setLocationsLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setLocationsSearch(state, action: PayloadAction<string>) {
      state.search = action.payload;
    },
    setLocationRefImage(
      state,
      action: PayloadAction<{ locationId: string; refImage: ReferenceImage }>,
    ) {
      const item = state.items.find((l) => l.id === action.payload.locationId);
      if (!item) return;
      const refs = item.referenceImages.filter((r) => r.slot !== action.payload.refImage.slot);
      refs.push(action.payload.refImage);
      item.referenceImages = refs;
    },
    removeLocationRefImage(
      state,
      action: PayloadAction<{ locationId: string; slot: string }>,
    ) {
      const item = state.items.find((l) => l.id === action.payload.locationId);
      if (!item) return;
      item.referenceImages = item.referenceImages.filter((r) => r.slot !== action.payload.slot);
    },
    restore(_, action: PayloadAction<LocationsState>) {
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
    moveItemToFolder(
      state,
      action: PayloadAction<{ id: string; folderId: string | null }>,
    ) {
      const item = state.items.find((l) => l.id === action.payload.id);
      if (item) item.folderId = action.payload.folderId;
    },
  },
});

export const {
  setLocations,
  addLocation,
  updateLocation,
  removeLocation,
  selectLocation,
  setLocationsLoading,
  setLocationsSearch,
  setLocationRefImage,
  removeLocationRefImage,
  setFolders,
  addFolder,
  updateFolder,
  removeFolder,
  setCurrentFolder,
  setFoldersLoading,
  moveItemToFolder,
} = locationsSlice.actions;
