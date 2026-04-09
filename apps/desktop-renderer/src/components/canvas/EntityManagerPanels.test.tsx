// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Character, Equipment, Location } from '@lucid-fin/contracts';
import { setLocale, t } from '../../i18n.js';
import { getAPI } from '../../utils/api.js';
import { charactersSlice } from '../../store/slices/characters.js';
import { equipmentSlice } from '../../store/slices/equipment.js';
import { locationsSlice } from '../../store/slices/locations.js';
import { CharacterManagerPanel } from './CharacterManagerPanel.js';
import { EquipmentManagerPanel } from './EquipmentManagerPanel.js';
import { LocationManagerPanel } from './LocationManagerPanel.js';

vi.mock('../../utils/api.js', () => ({
  getAPI: vi.fn(),
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

function createEquipment(): Equipment {
  return {
    id: 'equipment-1',
    projectId: 'project-1',
    name: 'Pulse Rifle',
    type: 'weapon',
    description: 'Compact energy rifle',
    tags: ['ranged'],
    referenceImages: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function createLocation(): Location {
  return {
    id: 'location-1',
    projectId: 'project-1',
    name: 'Hangar Bay',
    type: 'interior',
    description: 'Industrial launch bay',
    tags: ['industrial'],
    referenceImages: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function renderWithStore(panel: React.ReactElement) {
  const store = configureStore({
    reducer: {
      characters: charactersSlice.reducer,
      equipment: equipmentSlice.reducer,
      locations: locationsSlice.reducer,
    },
  });

  const character = createCharacter();
  const equipment = createEquipment();
  const location = createLocation();

  store.dispatch(
    charactersSlice.actions.restore({
      items: [character],
      selectedId: character.id,
      loading: false,
    }),
  );
  store.dispatch(
    equipmentSlice.actions.restore({
      items: [equipment],
      selectedId: equipment.id,
      filterType: 'all',
      loading: false,
    }),
  );
  store.dispatch(
    locationsSlice.actions.restore({
      items: [location],
      selectedId: location.id,
      filterType: 'all',
      loading: false,
      search: '',
    }),
  );

  render(<Provider store={store}>{panel}</Provider>);
}

describe('Entity manager panels', () => {
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
  });

  afterEach(() => {
    cleanup();
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
    'renders the embedded generation controls below the reference image section in $name',
    async ({ panel, referenceLabelKey }) => {
      renderWithStore(panel);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: t('entityGeneration.generateReferenceImage') }),
        ).toBeTruthy();
      });

      const referenceHeading = screen.getByText(t(referenceLabelKey));
      const generateButton = screen.getByRole('button', {
        name: t('entityGeneration.generateReferenceImage'),
      });

      expect(referenceHeading.compareDocumentPosition(generateButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );
});
