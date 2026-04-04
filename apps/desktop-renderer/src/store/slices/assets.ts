import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface Asset {
  id: string;
  hash: string;
  name: string;
  type: 'image' | 'video' | 'audio' | 'font' | 'subtitle' | 'other';
  path: string;
  thumbnailPath?: string;
  tags: string[];
  projectId?: string;
  /** Global = shared across projects */
  global: boolean;
  size: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface AssetsState {
  items: Asset[];
  searchQuery: string;
  filterType: Asset['type'] | 'all';
  filterTags: string[];
  sortBy: 'name' | 'date' | 'size' | 'type';
  sortOrder: 'asc' | 'desc';
}

const initialState: AssetsState = {
  items: [],
  searchQuery: '',
  filterType: 'all',
  filterTags: [],
  sortBy: 'date',
  sortOrder: 'desc',
};

export const assetsSlice = createSlice({
  name: 'assets',
  initialState,
  reducers: {
    setAssets(state, action: PayloadAction<Asset[]>) {
      state.items = action.payload;
    },

    addAsset(state, action: PayloadAction<Asset>) {
      const existing = state.items.find((a) => a.hash === action.payload.hash);
      if (existing) {
        // Merge: update name/tags if re-imported
        existing.name = action.payload.name;
        existing.tags = [...new Set([...existing.tags, ...action.payload.tags])];
        if (action.payload.metadata)
          existing.metadata = { ...existing.metadata, ...action.payload.metadata };
      } else {
        state.items.push(action.payload);
      }
    },

    removeAsset(state, action: PayloadAction<string>) {
      state.items = state.items.filter((a) => a.id !== action.payload);
    },

    updateAsset(
      state,
      action: PayloadAction<{
        id: string;
        data: Partial<Pick<Asset, 'name' | 'tags' | 'global' | 'metadata'>>;
      }>,
    ) {
      const asset = state.items.find((a) => a.id === action.payload.id);
      if (!asset) return;
      const { name, tags, global: isGlobal, metadata } = action.payload.data;
      if (name !== undefined) asset.name = name;
      if (tags !== undefined) asset.tags = tags;
      if (isGlobal !== undefined) asset.global = isGlobal;
      if (metadata !== undefined) asset.metadata = metadata;
    },

    addTag(state, action: PayloadAction<{ assetId: string; tag: string }>) {
      const asset = state.items.find((a) => a.id === action.payload.assetId);
      if (asset && !asset.tags.includes(action.payload.tag)) {
        asset.tags.push(action.payload.tag);
      }
    },

    removeTag(state, action: PayloadAction<{ assetId: string; tag: string }>) {
      const asset = state.items.find((a) => a.id === action.payload.assetId);
      if (asset) {
        asset.tags = asset.tags.filter((t) => t !== action.payload.tag);
      }
    },

    setSearchQuery(state, action: PayloadAction<string>) {
      state.searchQuery = action.payload;
    },

    setFilterType(state, action: PayloadAction<Asset['type'] | 'all'>) {
      state.filterType = action.payload;
    },

    setFilterTags(state, action: PayloadAction<string[]>) {
      state.filterTags = action.payload;
    },

    setSortBy(state, action: PayloadAction<AssetsState['sortBy']>) {
      state.sortBy = action.payload;
    },

    setSortOrder(state, action: PayloadAction<'asc' | 'desc'>) {
      state.sortOrder = action.payload;
    },
  },
});

export const {
  setAssets,
  addAsset,
  removeAsset,
  updateAsset,
  addTag,
  removeTag,
  setSearchQuery,
  setFilterType,
  setFilterTags,
  setSortBy,
  setSortOrder,
} = assetsSlice.actions;

/** Selector: filtered + sorted assets */
export function selectFilteredAssets(state: { assets: AssetsState }): Asset[] {
  let items = [...state.assets.items];
  const { searchQuery, filterType, filterTags, sortBy, sortOrder } = state.assets;

  // Type filter
  if (filterType !== 'all') {
    items = items.filter((a) => a.type === filterType);
  }

  // Tag filter
  if (filterTags.length > 0) {
    items = items.filter((a) => filterTags.every((t) => a.tags.includes(t)));
  }

  // FTS search (name + tags)
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = items.filter(
      (a) => a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  // Sort
  const dir = sortOrder === 'asc' ? 1 : -1;
  items.sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return dir * a.name.localeCompare(b.name);
      case 'date':
        return dir * (a.createdAt - b.createdAt);
      case 'size':
        return dir * (a.size - b.size);
      case 'type':
        return dir * a.type.localeCompare(b.type);
      default:
        return 0;
    }
  });

  return items;
}
