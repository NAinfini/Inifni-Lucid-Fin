import { describe, expect, it, vi } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import { createEmptyPresetTrackSet } from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';

vi.mock('../../logger.js', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };

  return {
    default: logger,
    log: vi.fn(),
    debug: logger.debug,
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
    fatal: logger.fatal,
  };
});

import { buildContext, entityMutatingToolNames } from './commander.handlers.js';

function makeCanvas(nodeCount = 12): Canvas {
  const now = Date.now();

  return {
    id: 'canvas-1',
    name: 'Storyboard',
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `node-${index + 1}`,
      type: 'text',
      position: { x: index * 10, y: index * 20 },
      data: { content: `Node ${index + 1}` },
      title: `Node ${index + 1}`,
      status: 'idle',
      bypassed: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    })),
    edges: [
      {
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        data: { status: 'idle', label: 'first' },
      },
      {
        id: 'edge-2',
        source: 'node-2',
        target: 'node-3',
        data: { status: 'idle', label: 'second' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe('entityMutatingToolNames', () => {
  it('includes equipment mutating tools', () => {
    expect(entityMutatingToolNames.has('equipment.create')).toBe(true);
    expect(entityMutatingToolNames.has('equipment.update')).toBe(true);
    expect(entityMutatingToolNames.has('equipment.delete')).toBe(true);
    expect(entityMutatingToolNames.has('equipment.generateRefImage')).toBe(true);
    expect(entityMutatingToolNames.has('equipment.setRefImage')).toBe(true);
    expect(entityMutatingToolNames.has('equipment.deleteRefImage')).toBe(true);
  });

  it('includes reference image tools for all entity types', () => {
    expect(entityMutatingToolNames.has('character.generateRefImage')).toBe(true);
    expect(entityMutatingToolNames.has('character.setRefImage')).toBe(true);
    expect(entityMutatingToolNames.has('character.deleteRefImage')).toBe(true);
    expect(entityMutatingToolNames.has('equipment.generateRefImage')).toBe(true);
    expect(entityMutatingToolNames.has('equipment.setRefImage')).toBe(true);
    expect(entityMutatingToolNames.has('equipment.deleteRefImage')).toBe(true);
    expect(entityMutatingToolNames.has('location.generateRefImage')).toBe(true);
    expect(entityMutatingToolNames.has('location.setRefImage')).toBe(true);
    expect(entityMutatingToolNames.has('location.deleteRefImage')).toBe(true);
  });
});

describe('buildContext', () => {
  function makeDb(_overrides?: Partial<SqliteIndex>): SqliteIndex {
    return {
      getCharacter: vi.fn(() => undefined),
      getLocation: vi.fn(() => undefined),
      getEquipment: vi.fn(() => undefined),
      insertAsset: vi.fn(),
      upsertCharacter: vi.fn(),
      upsertLocation: vi.fn(),
      upsertEquipment: vi.fn(),
    } as unknown as SqliteIndex;
  }

  it('builds lazy canvas context with only ids for selected nodes', () => {
    const db = makeDb();
    const context = buildContext(
      makeCanvas(),
      [],
      Array.from({ length: 12 }, (_, index) => `node-${index + 1}`),
      db,
    );

    const extra = context.extra as Record<string, unknown>;
    expect(extra).toMatchObject({
      canvasId: 'canvas-1',
      nodeCount: 12,
      edgeCount: 2,
      selectedNodeIds: Array.from({ length: 10 }, (_, index) => `node-${index + 1}`),
    });
    expect(extra).toHaveProperty('selectedNodes');
  });

  it('does not inject project entities into commander context', () => {
    const db = makeDb();

    const context = buildContext(makeCanvas(2), [], ['node-1'], db);
    const extra = context.extra as Record<string, unknown>;
    expect(extra).not.toHaveProperty('characters');
    expect(extra).not.toHaveProperty('locations');
  });

  it('does not inject prompt guide content into commander context', () => {
    const db = makeDb();
    const context = buildContext(
      makeCanvas(2),
      [],
      ['node-1'],
      db,
      Array.from({ length: 4 }, (_, index) => ({
        id: `guide-${index + 1}`,
        name: `Guide ${index + 1}`,
        content: `body-${index + 1}-${'x'.repeat(650)}-TAIL-${index + 1}`,
      })),
    );

    const extra = context.extra as Record<string, unknown>;
    expect(extra).not.toHaveProperty('promptGuides');
    expect(extra).toHaveProperty('availablePromptGuides');
    expect(JSON.stringify(extra)).not.toContain('body-1');
    expect(JSON.stringify(extra)).not.toContain('TAIL-1');
  });

  it('keeps selected node context lightweight and leaves full node data to tools/cache', () => {
    const db = makeDb({
      getCharacter: vi.fn((id: string) => (id === 'char-1'
        ? { id: 'char-1', name: 'Hero', role: 'protagonist', description: 'Quiet student' }
        : undefined)),
      getLocation: vi.fn((id: string) => (id === 'loc-1'
        ? { id: 'loc-1', name: 'School Rooftop', type: 'exterior', description: 'Empty rooftop at dusk' }
        : undefined)),
      getEquipment: vi.fn((id: string) => (id === 'eq-1'
        ? { id: 'eq-1', name: 'School Bag', type: 'accessory', description: 'Worn canvas shoulder bag' }
        : undefined)),
    });
    const now = Date.now();
    const canvas: Canvas = {
      id: 'canvas-1',
      name: 'Storyboard',
      nodes: [
        {
          id: 'image-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: {
            status: 'empty',
            prompt: 'Hero on the rooftop at dusk',
            negativePrompt: 'no crowd',
            providerId: 'mock-provider',
            presetTracks: createEmptyPresetTrackSet(),
            characterRefs: [{ characterId: 'char-1', loadoutId: '', emotion: 'nervous' }],
            locationRefs: [{ locationId: 'loc-1' }],
            equipmentRefs: [{ equipmentId: 'eq-1' }],
            variants: [],
            selectedVariantIndex: 0,
            variantCount: 1,
            seedLocked: false,
          },
          title: 'Hero Shot',
          status: 'idle',
          bypassed: false,
          locked: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: now,
      updatedAt: now,
    };

    const context = buildContext(
      canvas,
      [],
      ['image-1'],
      db,
      [{ id: 'guide-1', name: 'Prompt Guide', content: 'guide body' }],
      'rewrite the image prompt and generate the shot',
    );

    const extra = context.extra as Record<string, unknown>;
    expect(extra.initialProcessPrompts).toEqual(expect.arrayContaining(['image-node-generation']));
    expect(extra.selectedNodes).toEqual([
      {
        id: 'image-1',
        type: 'image',
        title: 'Hero Shot',
        status: 'idle',
        providerId: 'mock-provider',
        hasPrompt: true,
        hasNegativePrompt: true,
        characterRefIds: ['char-1'],
        locationRefIds: ['loc-1'],
        equipmentRefIds: ['eq-1'],
      },
    ]);
    expect(JSON.stringify(extra.selectedNodes)).not.toContain('Hero on the rooftop at dusk');
    expect(JSON.stringify(extra.selectedNodes)).not.toContain('no crowd');
    expect(JSON.stringify(extra.selectedNodes)).not.toContain('nervous');
    expect(JSON.stringify(extra.selectedNodes)).not.toContain('"characterRefs"');
    expect(JSON.stringify(extra.selectedNodes)).not.toContain('"locationRefs"');
    expect(JSON.stringify(extra.selectedNodes)).not.toContain('"equipmentRefs"');
  });

  it('flags character ref-image guidance up front when the request is about character sheets', () => {
    const db = makeDb();
    const context = buildContext(
      makeCanvas(0),
      [],
      [],
      db,
      [],
      'generate a character reference sheet with front side back views and facial expressions',
    );

    const extra = context.extra as Record<string, unknown>;
    expect(extra.initialProcessPrompts).toEqual(
      expect.arrayContaining(['character-ref-image-generation']),
    );
  });

  it('flags location ref-image guidance up front when the request is about location sheets', () => {
    const db = makeDb();
    const context = buildContext(
      makeCanvas(0),
      [],
      [],
      db,
      [],
      'generate a location reference sheet with wide establishing and key angles',
    );

    const extra = context.extra as Record<string, unknown>;
    expect(extra.initialProcessPrompts).toEqual(
      expect.arrayContaining(['location-ref-image-generation']),
    );
  });

  it('flags equipment ref-image guidance up front when the request is about equipment sheets', () => {
    const db = makeDb();
    const context = buildContext(
      makeCanvas(0),
      [],
      [],
      db,
      [],
      'generate an equipment turnaround sheet with front side back views',
    );

    const extra = context.extra as Record<string, unknown>;
    expect(extra.initialProcessPrompts).toEqual(
      expect.arrayContaining(['equipment-ref-image-generation']),
    );
  });
});
