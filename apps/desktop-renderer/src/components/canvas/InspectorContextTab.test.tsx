// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectorContextTab } from './InspectorContextTab.js';

vi.mock('../../hooks/useAssetUrl.js', () => ({
  useAssetUrl: (hash?: string) => ({
    url: hash ? `mock-asset://${hash}` : null,
    loading: false,
    markFailed: vi.fn(),
  }),
}));

const t = (key: string) =>
  (
    ({
      'inspector.characters': 'Characters',
      'inspector.equipment': 'Equipment',
      'inspector.locations': 'Locations',
      'inspector.addCharacter': 'Add character',
      'inspector.addEquipment': 'Add equipment',
      'inspector.addLocation': 'Add location',
      'inspector.noCharacters': 'No characters',
      'inspector.noEquipment': 'No equipment',
      'inspector.noLocations': 'No locations',
    }) as Record<string, string>
  )[key] ?? key;

afterEach(() => {
  cleanup();
});

describe('InspectorContextTab', () => {
  it('renders fixed 40x40 thumbnails for referenced entities', () => {
    render(
      <InspectorContextTab
        t={t}
        selectedNodeType="image"
        charPickerOpen={false}
        equipPickerOpen={false}
        locPickerOpen={false}
        allCharacters={[]}
        allEquipment={[]}
        allLocations={[]}
        addedCharacterIds={new Set()}
        addedEquipmentIds={new Set()}
        addedLocationIds={new Set()}
        characterItems={[
          {
            id: 'character-1',
            label: 'Astra',
            thumbnailAssetHash: 'character-hash',
          },
        ]}
        equipmentItems={[
          {
            id: 'equipment-1',
            label: 'Blade',
          },
        ]}
        locationItems={[
          {
            id: 'location-1',
            label: 'Hangar Bay',
            thumbnailAssetHash: 'location-hash',
          },
        ]}
        onToggleCharPicker={vi.fn()}
        onToggleEquipPicker={vi.fn()}
        onToggleLocPicker={vi.fn()}
        onAddCharacter={vi.fn()}
        onAddEquipment={vi.fn()}
        onAddLocation={vi.fn()}
        onCharacterSlotChange={vi.fn()}
        onEquipmentSlotChange={vi.fn()}
        onRemoveCharacter={vi.fn()}
        onRemoveEquipment={vi.fn()}
        onRemoveLocation={vi.fn()}
      />,
    );

    const characterThumb = screen.getByTestId('reference-thumb-character-1');
    const equipmentThumb = screen.getByTestId('reference-thumb-equipment-1');
    const locationThumb = screen.getByTestId('reference-thumb-location-1');

    expect(characterThumb.className).toContain('h-10');
    expect(characterThumb.className).toContain('w-10');
    expect(equipmentThumb.className).toContain('h-10');
    expect(equipmentThumb.className).toContain('w-10');
    expect(locationThumb.className).toContain('h-10');
    expect(locationThumb.className).toContain('w-10');

    expect(screen.getByAltText('Astra').getAttribute('src')).toBe('mock-asset://character-hash');
    expect(screen.getByAltText('Hangar Bay').getAttribute('src')).toBe(
      'mock-asset://location-hash',
    );
    expect(equipmentThumb.querySelector('img')).toBeNull();
    expect(screen.getByText('Blade')).toBeTruthy();
  });
});
