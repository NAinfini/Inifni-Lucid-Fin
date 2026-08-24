import { createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Folder } from '@lucid-fin/contracts';

export interface Asset {
  id: string;
  hash: string;
  name: string;
  type: 'image' | 'video' | 'audio' | 'font' | 'subtitle' | 'other';
  path: string;
  thumbnailPath?: string;
  tags: string[];
  /** Global = shared across projects */
  global: boolean;
  size: number;
  createdAt: number;
  /** File format/extension (e.g. "png", "mp4") */
  format?: string;
  /** Pixel width (images/video) */
  width?: number;
  /** Pixel height (images/video) */
  height?: number;
  /** Duration in seconds (video/audio) */
  duration?: number;
  /** AI provider that generated this asset */
  provider?: string;
  /** Original generation prompt */
  prompt?: string;
  /** Exact negative prompt submitted with the provider request. */
  negativePrompt?: string;
  /** Durable Prompt Assembly revision that authored the provider request. */
  promptAssemblyId?: string;
  /** Folder membership (null = ungrouped / root). */
  folderId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AssetsState {
  items: Asset[];
  searchQuery: string;
  filterType: Asset['type'] | 'all';
  filterTags: string[];
  sortBy: 'name' | 'date' | 'size' | 'type';
  sortOrder: 'asc' | 'desc';
  folders: Folder[];
  currentFolderId: string | null;
  foldersLoading: boolean;
}

const initialState: AssetsState = {
  items: [],
  searchQuery: '',
  filterType: 'all',
  filterTags: [],
  sortBy: 'date',
  sortOrder: 'desc',
  folders: [],
  currentFolderId: null,
  foldersLoading: false,
};

export const assetsSlice = createSlice({
  name: 'assets',
  initialState,
  reducers: {
    setAssets(state, action: PayloadAction<Asset[]>) {
      state.items = action.payload;
    },

    addAsset(state, action: PayloadAction<Asset>) {
      const existing = state.items.find((a) => a.id === action.payload.id);
      if (existing) {
        existing.name = action.payload.name;
        existing.tags = [...new Set([...existing.tags, ...action.payload.tags])];
        if (action.payload.metadata)
          existing.metadata = { ...existing.metadata, ...action.payload.metadata };
      } else {
        state.items.push(action.payload);
      }
    },

    addAssets(state, action: PayloadAction<Asset[]>) {
      state.items.push(...action.payload);
    },

    removeAsset(state, action: PayloadAction<string>) {
      state.items = state.items.filter((a) => a.id !== action.payload);
    },

    removeAssets(state, action: PayloadAction<string[]>) {
      const ids = new Set(action.payload);
      state.items = state.items.filter((asset) => !ids.has(asset.id));
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
      for (const asset of state.items) {
        if (asset.folderId === action.payload) asset.folderId = null;
      }
    },
    setCurrentFolder(state, action: PayloadAction<string | null>) {
      state.currentFolderId = action.payload;
    },
    setFoldersLoading(state, action: PayloadAction<boolean>) {
      state.foldersLoading = action.payload;
    },
    moveItemToFolder(state, action: PayloadAction<{ id: string; folderId: string | null }>) {
      const asset = state.items.find((a) => a.id === action.payload.id);
      if (asset) asset.folderId = action.payload.folderId;
    },
    moveItemsToFolder(state, action: PayloadAction<{ ids: string[]; folderId: string | null }>) {
      const ids = new Set(action.payload.ids);
      for (const asset of state.items) {
        if (ids.has(asset.id)) asset.folderId = action.payload.folderId;
      }
    },
  },
});

export const {
  setAssets,
  addAsset,
  addAssets,
  removeAsset,
  removeAssets,
  updateAsset,
  addTag,
  removeTag,
  setSearchQuery,
  setFilterType,
  setFilterTags,
  setSortBy,
  setSortOrder,
  setFolders,
  addFolder,
  updateFolder,
  removeFolder,
  setCurrentFolder,
  setFoldersLoading,
  moveItemToFolder,
  moveItemsToFolder,
} = assetsSlice.actions;

/** Selector: filtered + sorted assets */
const selectAssetsState = (state: { assets: AssetsState }) => state.assets;
const selectAssetItems = (state: { assets: AssetsState }) => state.assets.items;

export const selectImageAssets = createSelector([selectAssetItems], (items) =>
  items.filter((asset) => asset.type === 'image'),
);

/** Selector: filtered + sorted assets */
export const selectFilteredAssets = createSelector(
  [selectAssetItems, selectAssetsState],
  (items, assetsState) => {
    const { searchQuery, filterType, filterTags, sortBy, sortOrder } = assetsState;
    let filteredItems = [...items];

    if (filterType !== 'all') {
      filteredItems = filteredItems.filter((asset) => asset.type === filterType);
    }

    if (filterTags.length > 0) {
      filteredItems = filteredItems.filter((asset) =>
        filterTags.every((tag) => asset.tags.includes(tag)),
      );
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredItems = filteredItems.filter(
        (asset) =>
          asset.name.toLowerCase().includes(query) ||
          asset.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }

    const direction = sortOrder === 'asc' ? 1 : -1;
    filteredItems.sort((left, right) => {
      switch (sortBy) {
        case 'name':
          return direction * left.name.localeCompare(right.name);
        case 'date':
          return direction * (left.createdAt - right.createdAt);
        case 'size':
          return direction * (left.size - right.size);
        case 'type':
          return direction * left.type.localeCompare(right.type);
        default:
          return 0;
      }
    });

    return filteredItems;
  },
);

/**
 * Memoized selector: assets filtered by folder ID.
 * Avoids re-renders when unrelated assets change in other folders.
 */
export const selectAssetsByFolder = createSelector(
  [selectAssetItems, (_state: { assets: AssetsState }, folderId: string | null) => folderId],
  (items, folderId) =>
    items.filter((asset) => (folderId === null ? !asset.folderId : asset.folderId === folderId)),
);
