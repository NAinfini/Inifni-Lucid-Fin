import { describe, expect, it, vi } from 'vitest';
import type { Canvas, Character } from '@lucid-fin/contracts';
import { createEntityTools, type EntityToolDeps } from './entity-tools.js';

function createCharacter(): Character {
  return {
    id: 'character-1',
    name: 'Mara Vale',
    role: 'protagonist',
    description: 'A survey pilot.',
    appearance: 'Short black hair, amber eyes, and a weathered orange flight suit.',
    personality: 'Calm and observant.',
    costumes: [],
    tags: [],
    referenceImages: [],
    loadouts: [],
    defaultLoadoutId: '',
    createdAt: 1,
    updatedAt: 1,
  };
}

function createDeps(overrides: Partial<EntityToolDeps> = {}): EntityToolDeps {
  return {
    listCharacters: vi.fn(async () => [createCharacter()]),
    saveCharacter: vi.fn(async () => undefined),
    deleteCharacter: vi.fn(async () => undefined),
    listLocations: vi.fn(async () => []),
    saveLocation: vi.fn(async () => undefined),
    deleteLocation: vi.fn(async () => undefined),
    listEquipment: vi.fn(async () => []),
    saveEquipment: vi.fn(async () => undefined),
    deleteEquipment: vi.fn(async () => undefined),
    ...overrides,
  };
}

function getTool(name: string, deps: EntityToolDeps) {
  const tool = createEntityTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('unified entity reference-image tools', () => {
  it('does not expose a direct provider-generation shortcut', () => {
    const names = createEntityTools(createDeps()).map((tool) => tool.name);
    expect(names).not.toContain('entity.generateRefImage');
    expect(names).toContain('entity.setRefImageFromNode');
  });

  it('rejects video assets as still-image identity references', async () => {
    const canvas: Canvas = {
      id: 'canvas-1',
      name: 'Film',
      nodes: [
        {
          id: 'video-1',
          type: 'video',
          title: 'Shot',
          position: { x: 0, y: 0 },
          data: { assetHash: 'video-hash' },
          bypassed: false,
          locked: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const deps = createDeps({ getCanvas: vi.fn(async () => canvas) });

    await expect(
      getTool('entity.setRefImageFromNode', deps).execute({
        type: 'character',
        id: 'character-1',
        view: { kind: 'full-sheet' },
        canvasId: 'canvas-1',
        nodeId: 'video-1',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'Reference images require an image or backdrop node; received video',
    });
    expect(deps.saveCharacter).not.toHaveBeenCalled();
  });
});
