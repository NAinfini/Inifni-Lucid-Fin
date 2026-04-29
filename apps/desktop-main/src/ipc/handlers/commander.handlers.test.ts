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
      repos: {
        entities: {
          listCharacters: vi.fn(() => ({ rows: [], degradedCount: 0 })),
          listLocations: vi.fn(() => ({ rows: [], degradedCount: 0 })),
          listEquipment: vi.fn(() => ({ rows: [], degradedCount: 0 })),
        },
      },
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

  it('auto-injects guides that fit within budget and demotes the rest to discovery-only', () => {
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
    // Old key should never appear
    expect(extra).not.toHaveProperty('promptGuides');
    // All 4 guides (~660 chars each) fit in the 8k auto-inject budget
    expect(extra).toHaveProperty('autoInjectGuides');
    const autoInjected = extra.autoInjectGuides as Array<{
      id: string;
      name: string;
      content: string;
    }>;
    expect(autoInjected).toHaveLength(4);
    // Guide content IS present in auto-inject (rendered in system prompt)
    expect(autoInjected[0].content).toContain('body-1');
    // No overflow guides → no availablePromptGuides
    expect(extra).not.toHaveProperty('availablePromptGuides');
  });

  it('demotes overflow guides to discovery-only when auto-inject budget exceeded', () => {
    const db = makeDb();
    // Create guides that exceed the 8k budget: 3 guides of 3k chars each = 9k, only 2 fit
    const context = buildContext(
      makeCanvas(2),
      [],
      ['node-1'],
      db,
      Array.from({ length: 3 }, (_, index) => ({
        id: `guide-${index + 1}`,
        name: `Guide ${index + 1}`,
        content: `body-${index + 1}-${'x'.repeat(3000)}-TAIL-${index + 1}`,
      })),
    );

    const extra = context.extra as Record<string, unknown>;
    // First 2 guides fit in 8k budget (~3k each)
    expect(extra).toHaveProperty('autoInjectGuides');
    const autoInjected = extra.autoInjectGuides as Array<{
      id: string;
      name: string;
      content: string;
    }>;
    expect(autoInjected).toHaveLength(2);
    // Third guide is demoted to discovery-only
    expect(extra).toHaveProperty('availablePromptGuides');
    const discoveryOnly = extra.availablePromptGuides as Array<{ id: string; name: string }>;
    expect(discoveryOnly).toHaveLength(1);
    expect(discoveryOnly[0].id).toBe('guide-3');
    // Discovery-only entries do not contain content
    expect(discoveryOnly[0]).not.toHaveProperty('content');
  });

  it('keeps selected node context lightweight and leaves full node data to tools/cache', () => {
    const db = makeDb({
      getCharacter: vi.fn((id: string) =>
        id === 'char-1'
          ? { id: 'char-1', name: 'Hero', role: 'protagonist', description: 'Quiet student' }
          : undefined,
      ),
      getLocation: vi.fn((id: string) =>
        id === 'loc-1'
          ? {
              id: 'loc-1',
              name: 'School Rooftop',
              type: 'exterior',
              description: 'Empty rooftop at dusk',
            }
          : undefined,
      ),
      getEquipment: vi.fn((id: string) =>
        id === 'eq-1'
          ? {
              id: 'eq-1',
              name: 'School Bag',
              type: 'accessory',
              description: 'Worn canvas shoulder bag',
            }
          : undefined,
      ),
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

    const context = buildContext(canvas, [], ['image-1'], db, [
      { id: 'guide-1', name: 'Prompt Guide', content: 'guide body' },
    ]);

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

  it('primes workflow-orchestration on an empty canvas and does not infer ref-image guides from text alone', () => {
    const db = makeDb();
    const context = buildContext(makeCanvas(0), [], [], db, []);

    const extra = context.extra as Record<string, unknown>;
    // With an empty canvas + no selection, the pipeline seeds
    // workflow-orchestration so Commander knows the overall 6-phase flow.
    // Ref-image guides stay out — those are only primed pre-flight when the
    // model actually requests a ref-image tool.
    expect(extra.initialProcessPrompts).toEqual(['workflow-orchestration']);
  });
});
