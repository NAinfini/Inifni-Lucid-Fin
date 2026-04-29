// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Character, Equipment, Location, ReferenceImage } from '@lucid-fin/contracts';
import { setLocale, t } from '../../i18n.js';
import { getAPI } from '../../utils/api.js';
import { charactersSlice } from '../../store/slices/characters.js';
import { equipmentSlice } from '../../store/slices/equipment.js';
import { locationsSlice } from '../../store/slices/locations.js';
import { canvasReducer } from '../../store/slices/canvas.js';
import { assetsSlice } from '../../store/slices/assets.js';
import { CharacterManagerPanel } from './CharacterManagerPanel.js';
import { EquipmentManagerPanel } from './EquipmentManagerPanel.js';
import { LocationManagerPanel } from './LocationManagerPanel.js';

vi.mock('../../utils/api.js', () => ({
  getAPI: vi.fn(),
}));

vi.mock('../ui/Dialog.js', () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function createCharacter(): Character {
  return {
    id: 'character-1',
    name: 'Astra',
    role: 'protagonist',
    description: 'Scout leader',
    appearance: 'Short silver hair',
    personality: 'Focused',
    costumes: [],
    tags: ['leader'],
    referenceImages: [],
    loadouts: [],
    defaultLoadoutId: '',
    createdAt: 1,
    updatedAt: 1,
  };
}

function createReferenceImages(): ReferenceImage[] {
  return [
    {
      slot: 'main',
      assetHash: 'asset-main',
      isStandard: true,
      variants: ['asset-variant-1'],
    },
  ];
}

function createCharacterVariant(
  id: string,
  name: string,
  overrides: Partial<Character> = {},
): Character {
  return {
    ...createCharacter(),
    id,
    name,
    ...overrides,
  };
}

function createEquipment(): Equipment {
  return {
    id: 'equipment-1',
    name: 'Pulse Rifle',
    type: 'weapon',
    description: 'Compact energy rifle',
    tags: ['ranged'],
    referenceImages: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function createEquipmentVariant(
  id: string,
  name: string,
  overrides: Partial<Equipment> = {},
): Equipment {
  return {
    ...createEquipment(),
    id,
    name,
    ...overrides,
  };
}

function createLocation(): Location {
  return {
    id: 'location-1',
    name: 'Hangar Bay',
    description: 'Industrial launch bay',
    tags: ['industrial'],
    referenceImages: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function createLocationVariant(
  id: string,
  name: string,
  overrides: Partial<Location> = {},
): Location {
  return {
    ...createLocation(),
    id,
    name,
    ...overrides,
  };
}

function renderWithStore(
  panel: React.ReactElement,
  options?: {
    characters?: Character[];
    selectedCharacterId?: string;
    equipment?: Equipment[];
    selectedEquipmentId?: string;
    locations?: Location[];
    selectedLocationId?: string;
  },
) {
  const store = configureStore({
    reducer: {
      characters: charactersSlice.reducer,
      equipment: equipmentSlice.reducer,
      locations: locationsSlice.reducer,
      canvas: canvasReducer,
      assets: assetsSlice.reducer,
    },
  });

  const character = createCharacter();
  const equipment = createEquipment();
  const location = createLocation();
  const characters = options?.characters ?? [character];
  const selectedCharacterId = options?.selectedCharacterId ?? characters[0]?.id ?? null;
  const equipmentItems = options?.equipment ?? [equipment];
  const selectedEquipmentId = options?.selectedEquipmentId ?? equipmentItems[0]?.id ?? null;
  const locations = options?.locations ?? [location];
  const selectedLocationId = options?.selectedLocationId ?? locations[0]?.id ?? null;

  store.dispatch(
    charactersSlice.actions.restore({
      items: characters,
      selectedId: selectedCharacterId,
      loading: false,
      folders: [],
      currentFolderId: null,
      foldersLoading: false,
    }),
  );
  store.dispatch(
    equipmentSlice.actions.restore({
      items: equipmentItems,
      selectedId: selectedEquipmentId,
      loading: false,
      folders: [],
      currentFolderId: null,
      foldersLoading: false,
    }),
  );
  store.dispatch(
    locationsSlice.actions.restore({
      items: locations,
      selectedId: selectedLocationId,
      loading: false,
      search: '',
      folders: [],
      currentFolderId: null,
      foldersLoading: false,
    }),
  );

  render(<Provider store={store}>{panel}</Provider>);

  return store;
}

async function renderAndOpenDetail(
  panel: React.ReactElement,
  options?: Parameters<typeof renderWithStore>[1],
) {
  const store = renderWithStore(panel, options);
  // Pull all possible selected ids so we can resolve whichever matches the
  // rendered panel (tests restore selectedId on every slice for convenience,
  // so we can't pick by slice order — we have to probe the DOM).
  const state = store.getState() as {
    characters: { selectedId: string | null };
    equipment: { selectedId: string | null };
    locations: { selectedId: string | null };
  };
  const candidates = [
    state.characters.selectedId,
    state.equipment.selectedId,
    state.locations.selectedId,
  ].filter((id): id is string => Boolean(id));
  // Panels render a file-explorer first; wait for the initial async load to
  // resolve (setLoading(true) → API mock → setLoading(false)), then open the
  // detail drawer by double-clicking the selected entity's tile so tests can
  // assert on the drawer's form contents.
  const tile = await waitFor(() => {
    for (const id of candidates) {
      const match = document.querySelector(`[data-tile-id="${id}"]`);
      if (match) return match;
    }
    const fallback = document.querySelector('[data-tile-id]');
    if (fallback) return fallback;
    throw new Error(`no entity tile rendered (candidates=${candidates.join(',')})`);
  });
  fireEvent.doubleClick(tile);
  return store;
}

describe('Entity manager panels', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setLocale('en-US');
    vi.mocked(getAPI).mockReset();
    vi.mocked(getAPI).mockReturnValue({
      character: {
        list: vi.fn().mockResolvedValue([createCharacter()]),
      },
      equipment: {
        list: vi.fn().mockResolvedValue([createEquipment()]),
      },
      location: {
        list: vi.fn().mockResolvedValue([createLocation()]),
      },
    } as unknown as ReturnType<typeof getAPI>);
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    confirmSpy.mockRestore();
  });

  it.each([
    {
      name: 'CharacterManagerPanel',
      panel: <CharacterManagerPanel />,
      referenceLabelKey: 'characterManager.referenceImages',
    },
    {
      name: 'EquipmentManagerPanel',
      panel: <EquipmentManagerPanel />,
      referenceLabelKey: 'equipmentManager.referenceImages',
    },
    {
      name: 'LocationManagerPanel',
      panel: <LocationManagerPanel />,
      referenceLabelKey: 'locationManager.referenceImages',
    },
  ])(
    'renders the asset picker button below the reference image section in $name',
    async ({ panel, referenceLabelKey }) => {
      await renderAndOpenDetail(panel);

      await waitFor(() => {
        expect(screen.getByText(t('entity.fromAssets'))).toBeTruthy();
      });

      const referenceHeading = screen.getByText(t(referenceLabelKey));
      const fromAssetsButton = screen.getByText(t('entity.fromAssets'));

      expect(
        referenceHeading.compareDocumentPosition(fromAssetsButton) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  it.each([
    {
      name: 'CharacterManagerPanel',
      panel: <CharacterManagerPanel />,
      configureApi: () => ({
        character: {
          list: vi.fn().mockResolvedValue([
            createCharacterVariant('character-1', 'Astra', {
              referenceImages: createReferenceImages(),
            }),
          ]),
        },
        equipment: {
          list: vi.fn().mockResolvedValue([createEquipment()]),
        },
        location: {
          list: vi.fn().mockResolvedValue([createLocation()]),
        },
      }),
      renderOptions: {
        characters: [
          createCharacterVariant('character-1', 'Astra', {
            referenceImages: createReferenceImages(),
          }),
        ],
      },
    },
    {
      name: 'EquipmentManagerPanel',
      panel: <EquipmentManagerPanel />,
      configureApi: () => ({
        character: {
          list: vi.fn().mockResolvedValue([createCharacter()]),
        },
        equipment: {
          list: vi.fn().mockResolvedValue([
            createEquipmentVariant('equipment-1', 'Pulse Rifle', {
              referenceImages: createReferenceImages(),
            }),
          ]),
        },
        location: {
          list: vi.fn().mockResolvedValue([createLocation()]),
        },
      }),
      renderOptions: {
        equipment: [
          createEquipmentVariant('equipment-1', 'Pulse Rifle', {
            referenceImages: createReferenceImages(),
          }),
        ],
      },
    },
    {
      name: 'LocationManagerPanel',
      panel: <LocationManagerPanel />,
      configureApi: () => ({
        character: {
          list: vi.fn().mockResolvedValue([createCharacter()]),
        },
        equipment: {
          list: vi.fn().mockResolvedValue([createEquipment()]),
        },
        location: {
          list: vi.fn().mockResolvedValue([
            createLocationVariant('location-1', 'Hangar Bay', {
              referenceImages: createReferenceImages(),
            }),
          ]),
        },
      }),
      renderOptions: {
        locations: [
          createLocationVariant('location-1', 'Hangar Bay', {
            referenceImages: createReferenceImages(),
          }),
        ],
      },
    },
  ])(
    'positions the variant delete button fully inside the thumbnail in $name',
    async ({ panel, configureApi, renderOptions }) => {
      vi.mocked(getAPI).mockReturnValue(configureApi() as unknown as ReturnType<typeof getAPI>);

      await renderAndOpenDetail(panel, renderOptions);

      const deleteButtons = await screen.findAllByRole('button', { name: 'Delete variant' });

      expect(deleteButtons.length).toBeGreaterThan(0);

      for (const deleteButton of deleteButtons) {
        const className = deleteButton.getAttribute('class') ?? '';
        expect(className).toContain('top-1');
        expect(className).toContain('right-1');
        expect(className).not.toContain('-top-1');
        expect(className).not.toContain('-right-1');
      }
    },
  );

  it('uses dialog confirmation instead of window.confirm for unsaved character changes', async () => {
    const characters = [
      createCharacterVariant('character-1', 'Astra'),
      createCharacterVariant('character-2', 'Nova'),
    ];
    vi.mocked(getAPI).mockReturnValue({
      character: {
        list: vi.fn().mockResolvedValue(characters),
      },
      equipment: {
        list: vi.fn().mockResolvedValue([createEquipment()]),
      },
      location: {
        list: vi.fn().mockResolvedValue([createLocation()]),
      },
    } as unknown as ReturnType<typeof getAPI>);

    await renderAndOpenDetail(<CharacterManagerPanel />, {
      characters,
      selectedCharacterId: 'character-1',
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Astra')).toBeTruthy();
    });

    fireEvent.change(screen.getByDisplayValue('Astra'), {
      target: { value: 'Astra Prime' },
    });

    await waitFor(() => {
      expect(screen.getByText('Nova')).toBeTruthy();
    });

    fireEvent.doubleClick(screen.getByText('Nova'));

    await waitFor(() => {
      expect(screen.getByText(t('characterManager.unsavedChanges'))).toBeTruthy();
    });

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('uses dialog confirmation instead of window.confirm for character deletion', async () => {
    setLocale('zh-CN');
    await renderAndOpenDetail(<CharacterManagerPanel />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Astra')).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle(t('action.delete')));

    await waitFor(() => {
      expect(
        screen.getByText(t('characterManager.deleteConfirm').replace('{name}', 'Astra')),
      ).toBeTruthy();
    });
    expect(screen.getAllByRole('button', { name: t('action.cancel') }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: t('action.confirm') }).length).toBeGreaterThan(0);

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('uses dialog confirmation instead of window.confirm for unsaved equipment changes', async () => {
    const equipment = [
      createEquipmentVariant('equipment-1', 'Pulse Rifle'),
      createEquipmentVariant('equipment-2', 'Field Pack', { type: 'tool' }),
    ];
    vi.mocked(getAPI).mockReturnValue({
      character: {
        list: vi.fn().mockResolvedValue([createCharacter()]),
      },
      equipment: {
        list: vi.fn().mockResolvedValue(equipment),
      },
      location: {
        list: vi.fn().mockResolvedValue([createLocation()]),
      },
    } as unknown as ReturnType<typeof getAPI>);

    await renderAndOpenDetail(<EquipmentManagerPanel />, {
      equipment,
      selectedEquipmentId: 'equipment-1',
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Pulse Rifle')).toBeTruthy();
    });

    fireEvent.change(screen.getByDisplayValue('Pulse Rifle'), {
      target: { value: 'Pulse Rifle Mk II' },
    });

    await waitFor(() => {
      expect(screen.getByText('Field Pack')).toBeTruthy();
    });

    fireEvent.doubleClick(screen.getByText('Field Pack'));

    await waitFor(() => {
      expect(screen.getByText(t('equipmentManager.unsavedChanges'))).toBeTruthy();
    });

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('hides equipment list header filter and search controls', async () => {
    setLocale('zh-CN');

    renderWithStore(<EquipmentManagerPanel />, {
      equipment: [
        createEquipmentVariant('equipment-1', 'Pulse Rifle'),
        createEquipmentVariant('equipment-2', 'Field Pack', { type: 'tool' }),
      ],
      selectedEquipmentId: 'equipment-1',
    });

    await waitFor(() => {
      expect(screen.getByText(t('equipmentManager.title'))).toBeTruthy();
    });

    expect(screen.queryByText(t('equipmentManager.allTypes'))).toBeNull();
    expect(screen.queryByPlaceholderText(t('fileExplorer.searchPlaceholder'))).toBeNull();
  });

  it('uses dialog confirmation instead of window.confirm for equipment deletion', async () => {
    setLocale('zh-CN');
    await renderAndOpenDetail(<EquipmentManagerPanel />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Pulse Rifle')).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle(t('action.delete')));

    await waitFor(() => {
      expect(
        screen.getByText(t('equipmentManager.deleteConfirm').replace('{name}', 'Pulse Rifle')),
      ).toBeTruthy();
    });
    expect(screen.getAllByRole('button', { name: t('action.cancel') }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: t('action.confirm') }).length).toBeGreaterThan(0);

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('uses dialog confirmation instead of window.confirm for unsaved location changes', async () => {
    const locations = [
      createLocationVariant('location-1', 'Hangar Bay'),
      createLocationVariant('location-2', 'Observation Deck'),
    ];
    vi.mocked(getAPI).mockReturnValue({
      character: {
        list: vi.fn().mockResolvedValue([createCharacter()]),
      },
      equipment: {
        list: vi.fn().mockResolvedValue([createEquipment()]),
      },
      location: {
        list: vi.fn().mockResolvedValue(locations),
      },
    } as unknown as ReturnType<typeof getAPI>);

    await renderAndOpenDetail(<LocationManagerPanel />, {
      locations,
      selectedLocationId: 'location-1',
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Hangar Bay')).toBeTruthy();
    });

    fireEvent.change(screen.getByDisplayValue('Hangar Bay'), {
      target: { value: 'Hangar Bay Prime' },
    });

    await waitFor(() => {
      expect(screen.getByText('Observation Deck')).toBeTruthy();
    });

    fireEvent.doubleClick(screen.getByText('Observation Deck'));

    await waitFor(() => {
      expect(screen.getByText(t('locationManager.unsavedChanges'))).toBeTruthy();
    });

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('uses dialog confirmation instead of window.confirm for location deletion', async () => {
    await renderAndOpenDetail(<LocationManagerPanel />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Hangar Bay')).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle(t('locationManager.delete')));

    await waitFor(() => {
      expect(
        screen.getByText(t('locationManager.deleteConfirm').replace('{name}', 'Hangar Bay')),
      ).toBeTruthy();
    });

    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
