import { describe, expect, it } from 'vitest';
import type { Asset } from './assets.js';
import {
  addAsset,
  addTag,
  assetsSlice,
  removeAsset,
  removeTag,
  selectFilteredAssets,
  selectImageAssets,
  setAssets,
  setFilterTags,
  setFilterType,
  setSearchQuery,
  setSortBy,
  setSortOrder,
  updateAsset,
} from './assets.js';

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-1',
    hash: 'hash-1',
    name: 'Hero Image',
    type: 'image',
    path: '/tmp/hero.png',
    tags: ['hero'],
    global: false,
    size: 100,
    createdAt: 10,
    ...overrides,
  };
}

describe('assets slice', () => {
  it('has the expected initial state', () => {
    expect(assetsSlice.reducer(undefined, { type: '@@INIT' })).toEqual({
      items: [],
      searchQuery: '',
      filterType: 'all',
      filterTags: [],
      sortBy: 'date',
      sortOrder: 'desc',
      folders: [],
      currentFolderId: null,
      foldersLoading: false,
    });
  });

  it('exports action creators with the expected payloads', () => {
    const asset = makeAsset();

    expect(setAssets([asset])).toMatchObject({
      type: 'assets/setAssets',
      payload: [asset],
    });
    expect(addAsset(asset)).toMatchObject({
      type: 'assets/addAsset',
      payload: asset,
    });
    expect(removeAsset('asset-1')).toMatchObject({
      type: 'assets/removeAsset',
      payload: 'asset-1',
    });
    expect(
      updateAsset({
        id: 'asset-1',
        data: { name: 'Renamed', tags: ['updated'], global: true, metadata: { source: 'ai' } },
      }),
    ).toMatchObject({
      type: 'assets/updateAsset',
      payload: {
        id: 'asset-1',
        data: { name: 'Renamed', tags: ['updated'], global: true, metadata: { source: 'ai' } },
      },
    });
    expect(addTag({ assetId: 'asset-1', tag: 'portrait' })).toMatchObject({
      type: 'assets/addTag',
      payload: { assetId: 'asset-1', tag: 'portrait' },
    });
    expect(removeTag({ assetId: 'asset-1', tag: 'hero' })).toMatchObject({
      type: 'assets/removeTag',
      payload: { assetId: 'asset-1', tag: 'hero' },
    });
    expect(setSearchQuery('hero')).toMatchObject({
      type: 'assets/setSearchQuery',
      payload: 'hero',
    });
    expect(setFilterType('video')).toMatchObject({
      type: 'assets/setFilterType',
      payload: 'video',
    });
    expect(setFilterTags(['hero', 'featured'])).toMatchObject({
      type: 'assets/setFilterTags',
      payload: ['hero', 'featured'],
    });
    expect(setSortBy('name')).toMatchObject({
      type: 'assets/setSortBy',
      payload: 'name',
    });
    expect(setSortOrder('asc')).toMatchObject({
      type: 'assets/setSortOrder',
      payload: 'asc',
    });
  });

  it('deduplicates loaded assets by hash and keeps the first occurrence', () => {
    const state = assetsSlice.reducer(
      undefined,
      setAssets([
        makeAsset({ id: 'asset-1', hash: 'dup-hash', name: 'First copy' }),
        makeAsset({ id: 'asset-2', hash: 'dup-hash', name: 'Second copy' }),
        makeAsset({ id: 'asset-3', hash: 'unique-hash', name: 'Unique copy' }),
      ]),
    );

    expect(state.items).toEqual([
      expect.objectContaining({ id: 'asset-1', name: 'First copy' }),
      expect.objectContaining({ id: 'asset-3', name: 'Unique copy' }),
    ]);
  });

  it('adds new assets and merges re-imported assets by hash', () => {
    let state = assetsSlice.reducer(undefined, addAsset(makeAsset()));
    state = assetsSlice.reducer(
      state,
      addAsset(
        makeAsset({
          id: 'asset-2',
          hash: 'hash-1',
          name: 'Hero Updated',
          tags: ['hero', 'featured'],
          metadata: { source: 'upload' },
        }),
      ),
    );
    state = assetsSlice.reducer(
      state,
      addAsset(
        makeAsset({
          id: 'asset-3',
          hash: 'hash-3',
          name: 'Sound FX',
          type: 'audio',
          tags: ['sfx'],
          path: '/tmp/sfx.mp3',
        }),
      ),
    );

    expect(state.items).toHaveLength(2);
    expect(state.items[0]).toMatchObject({
      id: 'asset-1',
      hash: 'hash-1',
      name: 'Hero Updated',
      tags: ['hero', 'featured'],
      metadata: { source: 'upload' },
    });
    expect(state.items[1]).toMatchObject({
      id: 'asset-3',
      type: 'audio',
    });
  });

  it('updates and removes assets while ignoring missing ids', () => {
    let state = assetsSlice.reducer(
      undefined,
      setAssets([makeAsset(), makeAsset({ id: 'asset-2', hash: 'hash-2', name: 'Backup' })]),
    );
    state = assetsSlice.reducer(
      state,
      updateAsset({
        id: 'asset-1',
        data: { name: 'Hero Final', tags: ['lead'], global: true, metadata: { reviewed: true } },
      }),
    );
    state = assetsSlice.reducer(
      state,
      updateAsset({
        id: 'missing',
        data: { name: 'Ignored' },
      }),
    );
    state = assetsSlice.reducer(state, removeAsset('asset-2'));
    state = assetsSlice.reducer(state, removeAsset('missing'));

    expect(state.items).toEqual([
      expect.objectContaining({
        id: 'asset-1',
        name: 'Hero Final',
        tags: ['lead'],
        global: true,
        metadata: { reviewed: true },
      }),
    ]);
  });

  it('adds unique tags and removes tags while ignoring missing assets', () => {
    let state = assetsSlice.reducer(undefined, addAsset(makeAsset()));
    state = assetsSlice.reducer(state, addTag({ assetId: 'asset-1', tag: 'featured' }));
    state = assetsSlice.reducer(state, addTag({ assetId: 'asset-1', tag: 'featured' }));
    state = assetsSlice.reducer(state, addTag({ assetId: 'missing', tag: 'ignored' }));
    state = assetsSlice.reducer(state, removeTag({ assetId: 'asset-1', tag: 'hero' }));
    state = assetsSlice.reducer(state, removeTag({ assetId: 'missing', tag: 'ignored' }));

    expect(state.items[0]?.tags).toEqual(['featured']);
  });

  it('stores filter and sort preferences and selects filtered assets', () => {
    let state = assetsSlice.reducer(
      undefined,
      setAssets([
        makeAsset({
          id: 'asset-1',
          name: 'Gamma',
          tags: ['hero', 'featured'],
          size: 200,
          createdAt: 1,
        }),
        makeAsset({
          id: 'asset-2',
          hash: 'hash-2',
          name: 'alpha',
          type: 'video',
          tags: ['villain'],
          size: 500,
          createdAt: 50,
          path: '/tmp/alpha.mp4',
        }),
        makeAsset({
          id: 'asset-3',
          hash: 'hash-3',
          name: 'Beta',
          type: 'image',
          tags: ['hero', 'closeup'],
          size: 300,
          createdAt: 20,
        }),
      ]),
    );

    state = assetsSlice.reducer(state, setFilterType('image'));
    state = assetsSlice.reducer(state, setFilterTags(['hero']));
    state = assetsSlice.reducer(state, setSearchQuery('BeT'));
    state = assetsSlice.reducer(state, setSortBy('name'));
    state = assetsSlice.reducer(state, setSortOrder('asc'));

    expect(state.searchQuery).toBe('BeT');
    expect(state.filterType).toBe('image');
    expect(state.filterTags).toEqual(['hero']);
    expect(state.sortBy).toBe('name');
    expect(state.sortOrder).toBe('asc');
    expect(selectFilteredAssets({ assets: state }).map((asset) => asset.id)).toEqual(['asset-3']);

    state = assetsSlice.reducer(state, setSearchQuery(''));
    state = assetsSlice.reducer(state, setFilterTags([]));
    state = assetsSlice.reducer(state, setSortBy('size'));
    expect(selectFilteredAssets({ assets: state }).map((asset) => asset.id)).toEqual([
      'asset-1',
      'asset-3',
    ]);

    state = assetsSlice.reducer(state, setFilterType('all'));
    state = assetsSlice.reducer(state, setSortBy('type'));
    state = assetsSlice.reducer(state, setSortOrder('desc'));
    expect(selectFilteredAssets({ assets: state }).map((asset) => asset.id)).toEqual([
      'asset-2',
      'asset-1',
      'asset-3',
    ]);
  });

  it('returns the same filtered asset array when the assets state is unchanged', () => {
    const state = assetsSlice.reducer(
      undefined,
      setAssets([
        makeAsset({
          id: 'asset-1',
          name: 'Gamma',
          createdAt: 1,
        }),
        makeAsset({
          id: 'asset-2',
          hash: 'hash-2',
          name: 'Alpha',
          type: 'video',
          path: '/tmp/alpha.mp4',
          createdAt: 2,
        }),
      ]),
    );

    const first = selectFilteredAssets({ assets: state });
    const second = selectFilteredAssets({ assets: state });

    expect(second).toBe(first);
  });

  it('selects image assets with a stable reference when the asset list is unchanged', () => {
    const state = assetsSlice.reducer(
      undefined,
      setAssets([
        makeAsset({ id: 'asset-1', type: 'image' }),
        makeAsset({
          id: 'asset-2',
          hash: 'hash-2',
          type: 'video',
          name: 'Clip',
          path: '/tmp/clip.mp4',
        }),
        makeAsset({
          id: 'asset-3',
          hash: 'hash-3',
          type: 'image',
          name: 'Portrait',
        }),
      ]),
    );

    const first = selectImageAssets({ assets: state });
    const second = selectImageAssets({ assets: state });

    expect(first.map((asset) => asset.id)).toEqual(['asset-1', 'asset-3']);
    expect(second).toBe(first);
  });
});
