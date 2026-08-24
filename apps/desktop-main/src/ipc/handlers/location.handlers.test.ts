import { describe, expect, it, vi } from 'vitest';

const randomUUID = vi.hoisted(() => vi.fn(() => 'location-generated'));

vi.mock('node:crypto', () => ({
  randomUUID,
}));

import { registerLocationHandlers } from './location.handlers.js';

function resetCommon() {
  vi.clearAllMocks();
  randomUUID.mockReset();
  randomUUID.mockReturnValue('location-generated');
}

function makeLocation(overrides?: Record<string, unknown>) {
  return {
    id: 'location-1',
    name: 'Warehouse',
    type: 'interior',
    subLocation: 'Aisle 4',
    description: 'dusty',
    timeOfDay: 'night',
    mood: 'tense',
    weather: 'rain',
    lighting: 'neon',
    tags: ['industrial'],
    referenceImages: [{ slot: 'wide', assetHash: 'hash-wide', isStandard: true }],
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

function registerHandlers(db?: Record<string, unknown>) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  const entities = db
    ? {
        listLocations: vi.fn((type?: string) => {
          const fn = db.listLocations as ((t?: string) => unknown[]) | undefined;
          return { rows: fn ? fn(type) : [], degradedCount: 0 };
        }),
        getLocation: db.getLocation,
        upsertLocation: db.upsertLocation,
        copyLocations: db.copyLocations,
        deleteLocation: db.deleteLocation,
      }
    : {
        listLocations: vi.fn(() => ({ rows: [], degradedCount: 0 })),
        getLocation: vi.fn(),
        upsertLocation: vi.fn(),
        copyLocations: vi.fn(),
        deleteLocation: vi.fn(),
      };

  registerLocationHandlers(
    {
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never,
    {
      ...(db ?? {
        listLocations: vi.fn(),
        getLocation: vi.fn(),
        upsertLocation: vi.fn(),
        deleteLocation: vi.fn(),
      }),
      repos: { entities },
    } as never,
  );

  return handlers;
}

describe('registerLocationHandlers', () => {
  it('registers all location IPC handlers', () => {
    resetCommon();
    const handlers = registerHandlers();

    expect([...handlers.keys()].sort()).toEqual([
      'location:copy',
      'location:delete',
      'location:get',
      'location:list',
      'location:removeRefImage',
      'location:save',
      'location:setRefImage',
    ]);
  });

  it('copies and deletes multiple locations with one repository call', async () => {
    resetCommon();
    const created = [makeLocation({ id: 'copy-1' }), makeLocation({ id: 'copy-2' })];
    const db = {
      listLocations: vi.fn(),
      getLocation: vi.fn(),
      upsertLocation: vi.fn(),
      copyLocations: vi.fn(() => created),
      deleteLocation: vi.fn((ids: string[]) => [...new Set(ids)]),
    };
    const handlers = registerHandlers(db);

    await expect(
      handlers.get('location:copy')?.(
        {},
        { ids: ['location-1', 'location-2'], targetFolderId: 'folder-1' },
      ),
    ).resolves.toEqual({ created });
    expect(db.copyLocations).toHaveBeenCalledOnce();
    expect(db.copyLocations).toHaveBeenCalledWith(['location-1', 'location-2'], 'folder-1');

    await expect(
      handlers.get('location:delete')?.({}, { ids: ['location-1', 'location-2'] }),
    ).resolves.toEqual({ deletedIds: ['location-1', 'location-2'] });
    expect(db.deleteLocation).toHaveBeenCalledOnce();
    expect(db.deleteLocation).toHaveBeenCalledWith(['location-1', 'location-2']);
  });

  it('lists locations with the active project id and optional type filter', async () => {
    resetCommon();
    const db = {
      listLocations: vi.fn(() => [makeLocation()]),
      getLocation: vi.fn(),
      upsertLocation: vi.fn(),
      deleteLocation: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const list = handlers.get('location:list');

    await expect(list?.({}, { type: 'interior' })).resolves.toEqual([makeLocation()]);
    expect(db.listLocations).toHaveBeenCalledWith('interior');
  });

  it('creates a new location with normalized name and default type fallback', async () => {
    resetCommon();
    const db = {
      listLocations: vi.fn(),
      getLocation: vi.fn(() => undefined),
      upsertLocation: vi.fn(),
      deleteLocation: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const save = handlers.get('location:save');

    const result = await save?.(
      {},
      {
        name: '  Alley  ',
        type: 'invalid',
        description: 'narrow',
        mood: 'ominous',
        weather: 'fog',
        lighting: 'moonlight',
        tags: ['urban', 1, 'night'],
        referenceImages: [{ slot: 'wide', assetHash: 'hash-alley', isStandard: true }],
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'location-generated',
        name: 'Alley',
        type: 'interior',
        tags: ['urban', 'night'],
      }),
    );
    expect(db.upsertLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'location-generated',
        type: 'interior',
        mood: 'ominous',
        weather: 'fog',
        lighting: 'moonlight',
      }),
    );
  });

  it('replaces and removes location reference images by slot', async () => {
    resetCommon();
    const db = {
      listLocations: vi.fn(),
      getLocation: vi.fn(() =>
        makeLocation({
          referenceImages: [
            { slot: 'wide', assetHash: 'old-wide', isStandard: true },
            { slot: 'detail', assetHash: 'keep-detail', isStandard: false },
          ],
        }),
      ),
      upsertLocation: vi.fn(),
      deleteLocation: vi.fn(),
    };
    const handlers = registerHandlers(db);
    const setRefImage = handlers.get('location:setRefImage');
    const removeRefImage = handlers.get('location:removeRefImage');

    await expect(
      setRefImage?.(
        {},
        {
          locationId: 'location-1',
          slot: 'wide',
          assetHash: 'new-wide',
          isStandard: true,
        },
      ),
    ).resolves.toEqual({
      slot: 'wide',
      assetHash: 'new-wide',
      isStandard: true,
    });

    await expect(
      removeRefImage?.({}, { locationId: 'location-1', slot: 'detail' }),
    ).resolves.toBeUndefined();

    expect(db.upsertLocation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'location-1',
        referenceImages: [
          { slot: 'detail', assetHash: 'keep-detail', isStandard: false },
          { slot: 'wide', assetHash: 'new-wide', isStandard: true },
        ],
      }),
    );
    expect(db.upsertLocation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'location-1',
        referenceImages: [{ slot: 'wide', assetHash: 'old-wide', isStandard: true }],
      }),
    );
  });

  it('rejects missing locations', async () => {
    resetCommon();
    const db = {
      listLocations: vi.fn(),
      getLocation: vi.fn(() => undefined),
      upsertLocation: vi.fn(),
      deleteLocation: vi.fn(),
    };
    const handlers = registerHandlers(db);

    await expect(handlers.get('location:get')?.({}, { id: 'missing' })).rejects.toThrow(
      'Location not found: missing',
    );
  });
});
