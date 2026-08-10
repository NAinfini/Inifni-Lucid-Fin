// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
      'inspector.autoAngle': 'Auto angle',
      'inspector.referenceImage': 'Reference image',
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
        onLocationSlotChange={vi.fn()}
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

  it('renders localized slot selectors for characters, equipment, and locations', () => {
    const onCharacterSlotChange = vi.fn();
    const onEquipmentSlotChange = vi.fn();
    const onLocationSlotChange = vi.fn();
    render(
      <InspectorContextTab
        t={t}
        selectedNodeType="video"
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
            selectedSlot: 'full-sheet',
            slotOptions: [
              { value: 'full-sheet', label: 'Full sheet' },
              { value: 'extra-angle:left', label: 'Left' },
            ],
          },
        ]}
        equipmentItems={[
          {
            id: 'equipment-1',
            label: 'Blade',
            selectedSlot: 'ortho-grid',
            slotOptions: [{ value: 'ortho-grid', label: 'Ortho grid' }],
          },
        ]}
        locationItems={[
          {
            id: 'location-1',
            label: 'Hangar Bay',
            selectedSlot: 'bible',
            slotOptions: [
              { value: 'bible', label: 'Bible' },
              { value: 'fake-360', label: 'Fake 360' },
            ],
          },
        ]}
        onToggleCharPicker={vi.fn()}
        onToggleEquipPicker={vi.fn()}
        onToggleLocPicker={vi.fn()}
        onAddCharacter={vi.fn()}
        onAddEquipment={vi.fn()}
        onAddLocation={vi.fn()}
        onCharacterSlotChange={onCharacterSlotChange}
        onEquipmentSlotChange={onEquipmentSlotChange}
        onLocationSlotChange={onLocationSlotChange}
        onRemoveCharacter={vi.fn()}
        onRemoveEquipment={vi.fn()}
        onRemoveLocation={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Astra: Reference image'), {
      target: { value: 'extra-angle:left' },
    });
    fireEvent.change(screen.getByLabelText('Blade: Reference image'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByLabelText('Hangar Bay: Reference image'), {
      target: { value: 'fake-360' },
    });

    expect(onCharacterSlotChange).toHaveBeenCalledWith('character-1', 'extra-angle:left');
    expect(onEquipmentSlotChange).toHaveBeenCalledWith('equipment-1', undefined);
    expect(onLocationSlotChange).toHaveBeenCalledWith('location-1', 'fake-360');
    expect(screen.getAllByText('Auto angle')).toHaveLength(3);
  });
});
