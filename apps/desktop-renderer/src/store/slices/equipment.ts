import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Equipment, EquipmentType, ReferenceImage } from '@lucid-fin/contracts';

export interface EquipmentState {
  items: Equipment[];
  selectedId: string | null;
  filterType: EquipmentType | 'all';
  loading: boolean;
}

const initialState: EquipmentState = {
  items: [],
  selectedId: null,
  filterType: 'all',
  loading: false,
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
    updateEquipment(state, action: PayloadAction<{ id: string; data: Partial<Equipment> }>) {
      const item = state.items.find((e) => e.id === action.payload.id);
      if (item) Object.assign(item, action.payload.data);
    },
    removeEquipment(state, action: PayloadAction<string>) {
      state.items = state.items.filter((e) => e.id !== action.payload);
      if (state.selectedId === action.payload) state.selectedId = null;
    },
    selectEquipment(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },
    setFilterType(state, action: PayloadAction<EquipmentType | 'all'>) {
      state.filterType = action.payload;
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
    removeEquipmentRefImage(
      state,
      action: PayloadAction<{ equipmentId: string; slot: string }>,
    ) {
      const item = state.items.find((e) => e.id === action.payload.equipmentId);
      if (!item) return;
      item.referenceImages = item.referenceImages.filter((r) => r.slot !== action.payload.slot);
    },
    restore(_, action: PayloadAction<EquipmentState>) {
      return action.payload;
    },
  },
});

export const {
  setEquipment,
  addEquipment,
  updateEquipment,
  removeEquipment,
  selectEquipment,
  setFilterType,
  setLoading,
  setEquipmentRefImage,
  removeEquipmentRefImage,
} = equipmentSlice.actions;
