import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Location, ReferenceImage } from '@lucid-fin/contracts';

export interface LocationsState {
  items: Location[];
  selectedId: string | null;
  loading: boolean;
  search: string;
}

const initialState: LocationsState = {
  items: [],
  selectedId: null,
  loading: false,
  search: '',
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
} = locationsSlice.actions;
