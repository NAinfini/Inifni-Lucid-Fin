import { describe, expect, it } from 'vitest';
import type { Location, ReferenceImage } from '@lucid-fin/contracts';
import type { LocationsState } from './locations.js';
import {
  addLocation,
  locationsSlice,
  removeLocation,
  removeLocationRefImage,
  selectLocation,
  setLocationRefImage,
  setLocations,
  setLocationsLoading,
  setLocationsSearch,
  updateLocation,
} from './locations.js';

function makeReferenceImage(overrides: Partial<ReferenceImage> = {}): ReferenceImage {
  return {
    slot: 'wide-establishing',
    assetHash: 'loc-ref-1',
    isStandard: true,
    ...overrides,
  };
}

function makeLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: 'location-1',
    name: 'Warehouse',
    description: 'Abandoned warehouse',
    tags: ['industrial'],
    referenceImages: [makeReferenceImage()],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('locations slice', () => {
  it('has the expected initial state', () => {
    expect(locationsSlice.reducer(undefined, { type: '@@INIT' })).toEqual({
      items: [],
      selectedId: null,
      loading: false,
      search: '',
      folders: [],
      currentFolderId: null,
      foldersLoading: false,
    });
  });

  it('sets, adds, updates, selects, and removes locations', () => {
    let state = locationsSlice.reducer(
      undefined,
      setLocations([makeLocation(), makeLocation({ id: 'location-2', name: 'Alley' })]),
    );
    state = locationsSlice.reducer(
      state,
      addLocation(makeLocation({ id: 'location-3', name: 'Hallway' })),
    );
    state = locationsSlice.reducer(state, selectLocation('location-2'));
    state = locationsSlice.reducer(
      state,
      updateLocation({
        id: 'location-2',
        data: { name: 'Back Alley', tags: ['wet'], mood: 'tense' },
      }),
    );
    state = locationsSlice.reducer(
      state,
      updateLocation({
        id: 'missing',
        data: { name: 'Ignored' },
      }),
    );
    state = locationsSlice.reducer(state, setLocationsLoading(true));
    state = locationsSlice.reducer(state, setLocationsSearch('alley'));
    state = locationsSlice.reducer(state, removeLocation('location-2'));
    state = locationsSlice.reducer(state, removeLocation('missing'));

    expect(state.items.map((item) => item.id)).toEqual(['location-1', 'location-3']);
    expect(state.selectedId).toBeNull();
    expect(state.loading).toBe(true);
    expect(state.search).toBe('alley');
  });

  it('replaces and removes reference images by slot and ignores missing locations', () => {
    let state = locationsSlice.reducer(undefined, setLocations([makeLocation()]));
    state = locationsSlice.reducer(
      state,
      setLocationRefImage({
        locationId: 'location-1',
        refImage: makeReferenceImage({ slot: 'wide-establishing', assetHash: 'updated-wide' }),
      }),
    );
    state = locationsSlice.reducer(
      state,
      setLocationRefImage({
        locationId: 'location-1',
        refImage: makeReferenceImage({ slot: 'overhead', assetHash: 'overhead-ref' }),
      }),
    );
    state = locationsSlice.reducer(
      state,
      setLocationRefImage({
        locationId: 'missing',
        refImage: makeReferenceImage({ slot: 'ignored' }),
      }),
    );
    state = locationsSlice.reducer(
      state,
      removeLocationRefImage({ locationId: 'location-1', slot: 'wide-establishing' }),
    );
    state = locationsSlice.reducer(
      state,
      removeLocationRefImage({ locationId: 'missing', slot: 'overhead' }),
    );

    expect(state.items[0]?.referenceImages).toEqual([
      expect.objectContaining({ slot: 'overhead', assetHash: 'overhead-ref' }),
    ]);
  });

  it('restores full state snapshots', () => {
    const restored: LocationsState = {
      items: [makeLocation({ id: 'location-restore', name: 'Restored Dock' })],
      selectedId: 'location-restore',
      loading: true,
      search: 'dock',
      folders: [],
      currentFolderId: null,
      foldersLoading: false,
    };

    expect(locationsSlice.reducer(undefined, locationsSlice.actions.restore(restored))).toEqual(
      restored,
    );
  });
});
