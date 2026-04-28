import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { BUILT_IN_PRESET_LIBRARY, createEmptyPresetTrackSet } from '@lucid-fin/contracts';
import type {
  Canvas,
  CanvasNode,
  Character,
  CharacterRef,
  Equipment,
  ImageNodeData,
  Location,
  LocationRef,
  PresetDefinition,
  StyleGuide,
  VideoNodeData,
} from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';

// ---------------------------------------------------------------------------
// Hoist mocks before any imports that trigger module resolution
// ---------------------------------------------------------------------------

// project-context has been removed — loadCurrentProjectStyleGuide now returns DEFAULT_STYLE_GUIDE directly

vi.mock('../validation.js', () => ({
  assertWithinRoot: vi.fn((root: string, file: string) => path.join(root, file)),
}));

import {
  applyStyleGuideDefaultsToEmptyTracks,
  collectConnectedTextContent,
  findConnectedImageHash,
  hasCharacterRefs,
  hasEquipmentRefs,
  hasLocationRefs,
  hasPresetTracks,
  loadCurrentProjectStyleGuide,
  resolveCharacterEntities,
  resolveLocationEntities,
  resolveReferenceImages,
  resolveStandaloneEquipment,
  resolveVideoFrameReferenceImages,
} from './generation-prompt-compiler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000;

function makeStyleGuide(overrides?: Partial<StyleGuide['global']>): StyleGuide {
  return {
    global: {
      artStyle: '',
      colorPalette: { primary: '', secondary: '', forbidden: [] },
      lighting: 'natural',
      texture: '',
      referenceImages: [],
      freeformDescription: '',
      ...overrides,
    },
    sceneOverrides: {},
  };
}

function makeCanvas(overrides?: Partial<Canvas>): Canvas {
  return {
    id: 'canvas-1',
    name: 'Test',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeImageNode(id = 'img-1', data?: Partial<ImageNodeData>): CanvasNode {
  return {
    id,
    type: 'image',
    position: { x: 0, y: 0 },
    title: 'Image',
    status: 'idle',
    bypassed: false,
    locked: false,
    createdAt: NOW,
    updatedAt: NOW,
    data: {
      status: 'empty',
      variants: [],
      selectedVariantIndex: 0,
      variantCount: 1,
      seedLocked: false,
      presetTracks: createEmptyPresetTrackSet(),
      ...data,
    } as ImageNodeData,
  };
}

function makeVideoNode(id = 'vid-1', data?: Partial<VideoNodeData>): CanvasNode {
  return {
    id,
    type: 'video',
    position: { x: 0, y: 0 },
    title: 'Video',
    status: 'idle',
    bypassed: false,
    locked: false,
    createdAt: NOW,
    updatedAt: NOW,
    data: {
      status: 'empty',
      duration: 5,
      variants: [],
      selectedVariantIndex: 0,
      variantCount: 1,
      seedLocked: false,
      presetTracks: createEmptyPresetTrackSet(),
      ...data,
    } as VideoNodeData,
  };
}

function makeCharacter(id: string, overrides?: Partial<Character>): Character {
  return {
    id,
    name: `Character ${id}`,
    role: 'supporting',
    description: 'A test character',
    appearance: 'tall',
    personality: 'calm',
    costumes: [],
    tags: [],
    referenceImages: [],
    loadouts: [],
    defaultLoadoutId: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeEquipment(id: string, overrides?: Partial<Equipment>): Equipment {
  return {
    id,
    name: `Equipment ${id}`,
    type: 'weapon',
    description: 'A test item',
    tags: [],
    referenceImages: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeLocation(id: string, overrides?: Partial<Location>): Location {
  return {
    id,
    name: `Location ${id}`,
    type: 'interior',
    description: 'A test location',
    tags: [],
    referenceImages: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeDb(overrides?: Partial<SqliteIndex>): SqliteIndex {
  const flat = {
    getCharacter: vi.fn(() => undefined),
    getEquipment: vi.fn(() => undefined),
    getLocation: vi.fn(() => undefined),
    insertAsset: vi.fn(),
    ...overrides,
  };
  // Expose the entity spies under the new `.repos.entities` shape so handlers
  // that have been migrated to `db.repos.entities.*` still land on the same
  // mocks. Tests can continue to pass overrides flat.
  return {
    ...flat,
    repos: {
      entities: {
        getCharacter: flat.getCharacter,
        getEquipment: flat.getEquipment,
        getLocation: flat.getLocation,
      },
    },
  } as unknown as SqliteIndex;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  // no-op (project path no longer used)
});

// ===========================================================================
// loadCurrentProjectStyleGuide
// ===========================================================================

describe('loadCurrentProjectStyleGuide', () => {
  function mockDb(styleGuide?: StyleGuide) {
    return {
      repos: {
        projectSettings: {
          getJson: () => styleGuide ?? undefined,
        },
      },
    } as unknown as SqliteIndex;
  }

  it('returns default when no style guide saved', () => {
    const result = loadCurrentProjectStyleGuide(mockDb());
    expect(result.global.lighting).toBe('natural');
    expect(result.sceneOverrides).toEqual({});
  });

  it('returns saved style guide from DB', () => {
    const guide: StyleGuide = {
      global: {
        artStyle: 'anime',
        colorPalette: { primary: '#f00', secondary: '#0f0', forbidden: [] },
        lighting: 'dramatic',
        texture: 'cel',
        referenceImages: [],
        freeformDescription: '',
      },
      sceneOverrides: {},
    };
    const result = loadCurrentProjectStyleGuide(mockDb(guide));
    expect(result.global.artStyle).toBe('anime');
    expect(result.global.lighting).toBe('dramatic');
  });
});

// ===========================================================================
// applyStyleGuideDefaultsToEmptyTracks
// ===========================================================================

describe('applyStyleGuideDefaultsToEmptyTracks', () => {
  it('fills empty look track when style guide artStyle matches a built-in preset', () => {
    const tracks = createEmptyPresetTrackSet();
    const result = applyStyleGuideDefaultsToEmptyTracks(
      tracks,
      makeStyleGuide({ artStyle: 'cinematic realism', lighting: 'natural' }),
      BUILT_IN_PRESET_LIBRARY,
    );
    expect(result.look.entries).toHaveLength(1);
    expect(result.look.entries[0]?.presetId).toBe('builtin-look-cinematic-realism');
  });

  it('fills empty scene track from lighting setting', () => {
    const tracks = createEmptyPresetTrackSet();
    const result = applyStyleGuideDefaultsToEmptyTracks(
      tracks,
      makeStyleGuide({ artStyle: '', lighting: 'dramatic' }),
      BUILT_IN_PRESET_LIBRARY,
    );
    expect(result.scene.entries).toHaveLength(1);
    expect(result.scene.entries[0]?.presetId).toBe('scene:low-key');
  });

  it('fills both look and scene when both are configured', () => {
    const tracks = createEmptyPresetTrackSet();
    const result = applyStyleGuideDefaultsToEmptyTracks(
      tracks,
      makeStyleGuide({ artStyle: 'cinematic realism', lighting: 'dramatic' }),
      BUILT_IN_PRESET_LIBRARY,
    );
    expect(result.look.entries).toHaveLength(1);
    expect(result.scene.entries).toHaveLength(1);
  });

  it('does not overwrite existing look track entries', () => {
    const tracks = createEmptyPresetTrackSet();
    tracks.look = {
      category: 'look',
      entries: [
        { id: 'user-entry', category: 'look', presetId: 'look:anime-cel', params: {}, order: 0 },
      ],
    };
    const result = applyStyleGuideDefaultsToEmptyTracks(
      tracks,
      makeStyleGuide({ artStyle: 'cinematic realism', lighting: 'natural' }),
      BUILT_IN_PRESET_LIBRARY,
    );
    expect(result.look.entries).toHaveLength(1);
    expect(result.look.entries[0]?.presetId).toBe('look:anime-cel');
  });

  it('does not overwrite existing scene track entries', () => {
    const tracks = createEmptyPresetTrackSet();
    tracks.scene = {
      category: 'scene',
      entries: [
        { id: 'user-scene', category: 'scene', presetId: 'scene:neon-noir', params: {}, order: 0 },
      ],
    };
    const result = applyStyleGuideDefaultsToEmptyTracks(
      tracks,
      makeStyleGuide({ artStyle: '', lighting: 'dramatic' }),
      BUILT_IN_PRESET_LIBRARY,
    );
    expect(result.scene.entries).toHaveLength(1);
    expect(result.scene.entries[0]?.presetId).toBe('scene:neon-noir');
  });

  it('returns a full PresetTrackSet with all 8 categories when given undefined input', () => {
    const result = applyStyleGuideDefaultsToEmptyTracks(
      undefined,
      makeStyleGuide(),
      BUILT_IN_PRESET_LIBRARY,
    );
    const categories = ['camera', 'lens', 'look', 'scene', 'composition', 'emotion', 'flow', 'technical'];
    for (const cat of categories) {
      expect(result).toHaveProperty(cat);
    }
  });

  it('does not mutate the original tracks object', () => {
    const tracks = createEmptyPresetTrackSet();
    const snapshot = JSON.stringify(tracks);
    applyStyleGuideDefaultsToEmptyTracks(
      tracks,
      makeStyleGuide({ artStyle: 'cinematic realism', lighting: 'dramatic' }),
      BUILT_IN_PRESET_LIBRARY,
    );
    expect(JSON.stringify(tracks)).toBe(snapshot);
  });

  it('skips look track when artStyle does not match any preset', () => {
    const tracks = createEmptyPresetTrackSet();
    const result = applyStyleGuideDefaultsToEmptyTracks(
      tracks,
      makeStyleGuide({ artStyle: 'completely-unknown-style-xyz', lighting: 'natural' }),
      BUILT_IN_PRESET_LIBRARY,
    );
    expect(result.look.entries).toHaveLength(0);
  });

  it('skips scene track when lighting is natural or custom', () => {
    for (const lighting of ['natural', 'custom'] as const) {
      const tracks = createEmptyPresetTrackSet();
      const result = applyStyleGuideDefaultsToEmptyTracks(
        tracks,
        makeStyleGuide({ artStyle: '', lighting }),
        BUILT_IN_PRESET_LIBRARY,
      );
      expect(result.scene.entries).toHaveLength(0);
    }
  });

  it('fuzzy-matches artStyle to a preset when exact match is absent', () => {
    const fakeLibrary: PresetDefinition[] = [
      {
        id: 'builtin-look-cinematic-realism',
        category: 'look',
        name: 'Cinematic Realism',
        description: '',
        prompt: '',
        builtIn: true,
        modified: false,
        params: [],
        defaults: {},
      },
    ];
    const tracks = createEmptyPresetTrackSet();
    // 'cinematic' is a substring of 'cinematicrealism' — fuzzy should pick it up
    // only if exactly 1 fuzzy match
    const result = applyStyleGuideDefaultsToEmptyTracks(
      tracks,
      makeStyleGuide({ artStyle: 'Cinematic Realism' }),
      fakeLibrary,
    );
    expect(result.look.entries).toHaveLength(1);
    expect(result.look.entries[0]?.presetId).toBe('builtin-look-cinematic-realism');
  });

  it('does not fill look track when multiple fuzzy matches exist (ambiguous)', () => {
    const fakeLibrary: PresetDefinition[] = [
      {
        id: 'look:cinematic-dark',
        category: 'look',
        name: 'Cinematic Dark',
        description: '',
        prompt: '',
        builtIn: true,
        modified: false,
        params: [],
        defaults: {},
      },
      {
        id: 'look:cinematic-bright',
        category: 'look',
        name: 'Cinematic Bright',
        description: '',
        prompt: '',
        builtIn: true,
        modified: false,
        params: [],
        defaults: {},
      },
    ];
    const tracks = createEmptyPresetTrackSet();
    const result = applyStyleGuideDefaultsToEmptyTracks(
      tracks,
      makeStyleGuide({ artStyle: 'cinematic' }),
      fakeLibrary,
    );
    // Both presets fuzzy-match → ambiguous → no fill
    expect(result.look.entries).toHaveLength(0);
  });
});

// ===========================================================================
// hasPresetTracks / hasCharacterRefs / hasEquipmentRefs / hasLocationRefs
// ===========================================================================

describe('hasPresetTracks', () => {
  it('returns true for objects that have presetTracks key', () => {
    expect(hasPresetTracks({ presetTracks: createEmptyPresetTrackSet() })).toBe(true);
    expect(hasPresetTracks({ presetTracks: undefined })).toBe(true);
  });

  it('returns false for objects without presetTracks key', () => {
    expect(hasPresetTracks({ status: 'empty' })).toBe(false);
  });

  it('returns false for null, undefined, and primitives', () => {
    expect(hasPresetTracks(null)).toBe(false);
    expect(hasPresetTracks(undefined)).toBe(false);
    expect(hasPresetTracks('string')).toBe(false);
    expect(hasPresetTracks(42)).toBe(false);
  });
});

describe('hasCharacterRefs', () => {
  it('returns true when characterRefs key exists', () => {
    expect(hasCharacterRefs({ characterRefs: [] })).toBe(true);
    expect(hasCharacterRefs({ characterRefs: undefined })).toBe(true);
  });

  it('returns false when characterRefs key is absent', () => {
    expect(hasCharacterRefs({ status: 'empty' })).toBe(false);
    expect(hasCharacterRefs(null)).toBe(false);
    expect(hasCharacterRefs(undefined)).toBe(false);
  });
});

describe('hasEquipmentRefs', () => {
  it('returns true when equipmentRefs key exists', () => {
    expect(hasEquipmentRefs({ equipmentRefs: [] })).toBe(true);
    expect(hasEquipmentRefs({ equipmentRefs: undefined })).toBe(true);
  });

  it('returns false when equipmentRefs key is absent', () => {
    expect(hasEquipmentRefs({ status: 'empty' })).toBe(false);
    expect(hasEquipmentRefs(null)).toBe(false);
  });
});

describe('hasLocationRefs', () => {
  it('returns true when locationRefs key exists', () => {
    expect(hasLocationRefs({ locationRefs: [] })).toBe(true);
    expect(hasLocationRefs({ locationRefs: undefined })).toBe(true);
  });

  it('returns false when locationRefs key is absent', () => {
    expect(hasLocationRefs({ status: 'empty' })).toBe(false);
    expect(hasLocationRefs(null)).toBe(false);
  });
});

// ===========================================================================
// collectConnectedTextContent
// ===========================================================================

describe('collectConnectedTextContent', () => {
  it('returns text content from nodes connected via edges', () => {
    const textNode: CanvasNode = {
      id: 'text-1',
      type: 'text',
      position: { x: 0, y: 0 },
      title: 'Note',
      status: 'idle',
      bypassed: false,
      locked: false,
      createdAt: NOW,
      updatedAt: NOW,
      data: { content: 'A dramatic scene' },
    };
    const imgNode = makeImageNode('img-1');
    const canvas = makeCanvas({
      nodes: [imgNode, textNode],
      edges: [{ id: 'e1', source: 'img-1', target: 'text-1', data: { status: 'idle' } }],
    });

    const result = collectConnectedTextContent(canvas, 'img-1');
    expect(result).toEqual(['A dramatic scene']);
  });

  it('collects text from both incoming and outgoing text connections', () => {
    const textA: CanvasNode = {
      id: 'text-a',
      type: 'text',
      position: { x: 0, y: 0 },
      title: 'A',
      status: 'idle',
      bypassed: false,
      locked: false,
      createdAt: NOW,
      updatedAt: NOW,
      data: { content: 'First note' },
    };
    const textB: CanvasNode = {
      id: 'text-b',
      type: 'text',
      position: { x: 0, y: 0 },
      title: 'B',
      status: 'idle',
      bypassed: false,
      locked: false,
      createdAt: NOW,
      updatedAt: NOW,
      data: { content: 'Second note' },
    };
    const imgNode = makeImageNode('img-1');
    const canvas = makeCanvas({
      nodes: [imgNode, textA, textB],
      edges: [
        // textA → img (img is target)
        { id: 'e1', source: 'text-a', target: 'img-1', data: { status: 'idle' } },
        // img → textB (img is source)
        { id: 'e2', source: 'img-1', target: 'text-b', data: { status: 'idle' } },
      ],
    });

    const result = collectConnectedTextContent(canvas, 'img-1');
    expect(result).toContain('First note');
    expect(result).toContain('Second note');
  });

  it('ignores non-text nodes even when connected', () => {
    const imgNode = makeImageNode('img-1');
    const vidNode = makeVideoNode('vid-1');
    const canvas = makeCanvas({
      nodes: [imgNode, vidNode],
      edges: [{ id: 'e1', source: 'img-1', target: 'vid-1', data: { status: 'idle' } }],
    });

    const result = collectConnectedTextContent(canvas, 'img-1');
    expect(result).toHaveLength(0);
  });

  it('ignores text nodes with empty or whitespace-only content', () => {
    const textNode: CanvasNode = {
      id: 'text-empty',
      type: 'text',
      position: { x: 0, y: 0 },
      title: 'Empty',
      status: 'idle',
      bypassed: false,
      locked: false,
      createdAt: NOW,
      updatedAt: NOW,
      data: { content: '   ' },
    };
    const imgNode = makeImageNode('img-1');
    const canvas = makeCanvas({
      nodes: [imgNode, textNode],
      edges: [{ id: 'e1', source: 'img-1', target: 'text-empty', data: { status: 'idle' } }],
    });

    const result = collectConnectedTextContent(canvas, 'img-1');
    expect(result).toHaveLength(0);
  });

  it('returns empty array for a node with no edges', () => {
    const canvas = makeCanvas({ nodes: [makeImageNode('img-1')] });
    expect(collectConnectedTextContent(canvas, 'img-1')).toEqual([]);
  });

  it('returns empty array for an empty canvas', () => {
    const canvas = makeCanvas();
    expect(collectConnectedTextContent(canvas, 'nonexistent')).toEqual([]);
  });
});

// ===========================================================================
// findConnectedImageHash
// ===========================================================================

describe('findConnectedImageHash', () => {
  it('returns assetHash of an image node that is the source of an incoming edge (image → video)', () => {
    const imgNode = makeImageNode('img-1', { assetHash: 'hash-abc' });
    const vidNode = makeVideoNode('vid-1');
    const canvas = makeCanvas({
      nodes: [imgNode, vidNode],
      edges: [{ id: 'e1', source: 'img-1', target: 'vid-1', data: { status: 'idle' } }],
    });

    const result = findConnectedImageHash(canvas, 'vid-1');
    expect(result).toBe('hash-abc');
  });

  it('returns undefined when connected image node has no assetHash', () => {
    const imgNode = makeImageNode('img-1', { assetHash: undefined });
    const vidNode = makeVideoNode('vid-1');
    const canvas = makeCanvas({
      nodes: [imgNode, vidNode],
      edges: [{ id: 'e1', source: 'img-1', target: 'vid-1', data: { status: 'idle' } }],
    });

    const result = findConnectedImageHash(canvas, 'vid-1');
    expect(result).toBeUndefined();
  });

  it('returns undefined when there are no connected image nodes', () => {
    const vidNode = makeVideoNode('vid-1');
    const anotherVid = makeVideoNode('vid-2');
    const canvas = makeCanvas({
      nodes: [vidNode, anotherVid],
      edges: [{ id: 'e1', source: 'vid-2', target: 'vid-1', data: { status: 'idle' } }],
    });

    const result = findConnectedImageHash(canvas, 'vid-1');
    expect(result).toBeUndefined();
  });

  it('returns undefined for a node with no edges', () => {
    const canvas = makeCanvas({ nodes: [makeVideoNode('vid-1')] });
    expect(findConnectedImageHash(canvas, 'vid-1')).toBeUndefined();
  });

  it('prefers incoming image edges over fallback outgoing edges', () => {
    // Two image nodes: one incoming (source → vid), one outgoing (vid → target)
    const incomingImg = makeImageNode('img-in', { assetHash: 'incoming-hash' });
    const outgoingImg = makeImageNode('img-out', { assetHash: 'outgoing-hash' });
    const vidNode = makeVideoNode('vid-1');
    const canvas = makeCanvas({
      nodes: [incomingImg, outgoingImg, vidNode],
      edges: [
        // incoming: img-in → vid-1 (vid-1 is target)
        { id: 'e1', source: 'img-in', target: 'vid-1', data: { status: 'idle' } },
        // outgoing: vid-1 → img-out (vid-1 is source)
        { id: 'e2', source: 'vid-1', target: 'img-out', data: { status: 'idle' } },
      ],
    });

    const result = findConnectedImageHash(canvas, 'vid-1');
    expect(result).toBe('incoming-hash');
  });

  it('falls back to any connected image if there is no incoming image edge', () => {
    const imgOut = makeImageNode('img-out', { assetHash: 'outgoing-hash' });
    const vidNode = makeVideoNode('vid-1');
    const canvas = makeCanvas({
      nodes: [imgOut, vidNode],
      edges: [
        // outgoing: vid-1 → img-out (vid-1 is source)
        { id: 'e1', source: 'vid-1', target: 'img-out', data: { status: 'idle' } },
      ],
    });

    const result = findConnectedImageHash(canvas, 'vid-1');
    expect(result).toBe('outgoing-hash');
  });
});

// ===========================================================================
// resolveVideoFrameReferenceImages
// ===========================================================================

describe('resolveVideoFrameReferenceImages', () => {
  it('returns empty array for non-video nodes', () => {
    const imgNode = makeImageNode('img-1', { assetHash: 'hash' });
    const canvas = makeCanvas({ nodes: [imgNode] });
    expect(resolveVideoFrameReferenceImages(canvas, imgNode)).toEqual([]);
  });

  it('returns direct firstFrameAssetHash and lastFrameAssetHash when set', () => {
    const vidNode = makeVideoNode('vid-1', {
      firstFrameAssetHash: 'first-hash',
      lastFrameAssetHash: 'last-hash',
    });
    const canvas = makeCanvas({ nodes: [vidNode] });
    const result = resolveVideoFrameReferenceImages(canvas, vidNode);
    expect(result).toEqual(['first-hash', 'last-hash']);
  });

  it('resolves firstFrameNodeId to connected image node assetHash', () => {
    const imgNode = makeImageNode('img-first', { assetHash: 'resolved-first' });
    const vidNode = makeVideoNode('vid-1', { firstFrameNodeId: 'img-first' });
    const canvas = makeCanvas({ nodes: [imgNode, vidNode] });
    const result = resolveVideoFrameReferenceImages(canvas, vidNode);
    expect(result).toContain('resolved-first');
  });

  it('resolves lastFrameNodeId to connected image node assetHash', () => {
    const imgNode = makeImageNode('img-last', { assetHash: 'resolved-last' });
    const vidNode = makeVideoNode('vid-1', { lastFrameNodeId: 'img-last' });
    const canvas = makeCanvas({ nodes: [imgNode, vidNode] });
    const result = resolveVideoFrameReferenceImages(canvas, vidNode);
    expect(result).toContain('resolved-last');
  });

  it('skips frame resolution when referenced node is not found', () => {
    const vidNode = makeVideoNode('vid-1', { firstFrameNodeId: 'missing-node' });
    const canvas = makeCanvas({ nodes: [vidNode] });
    const result = resolveVideoFrameReferenceImages(canvas, vidNode);
    expect(result).toHaveLength(0);
  });

  it('skips frame resolution when referenced node is not an image node', () => {
    const anotherVid = makeVideoNode('vid-2');
    const vidNode = makeVideoNode('vid-1', { firstFrameNodeId: 'vid-2' });
    const canvas = makeCanvas({ nodes: [anotherVid, vidNode] });
    const result = resolveVideoFrameReferenceImages(canvas, vidNode);
    expect(result).toHaveLength(0);
  });

  it('returns only defined hashes (filters out undefined)', () => {
    const vidNode = makeVideoNode('vid-1', {
      firstFrameAssetHash: 'first-hash',
      // lastFrameAssetHash intentionally absent
    });
    const canvas = makeCanvas({ nodes: [vidNode] });
    const result = resolveVideoFrameReferenceImages(canvas, vidNode);
    expect(result).toEqual(['first-hash']);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no frame hashes or node refs are set', () => {
    const vidNode = makeVideoNode('vid-1');
    const canvas = makeCanvas({ nodes: [vidNode] });
    expect(resolveVideoFrameReferenceImages(canvas, vidNode)).toEqual([]);
  });
});

// ===========================================================================
// resolveReferenceImages
// ===========================================================================

describe('resolveReferenceImages', () => {
  it('returns empty array for image node with no refs', () => {
    const imgNode = makeImageNode('img-1');
    const canvas = makeCanvas({ nodes: [imgNode] });
    const db = makeDb();
    expect(resolveReferenceImages(db, canvas, imgNode)).toEqual([]);
  });

  it('includes character explicit referenceImageHash', () => {
    const char = makeCharacter('char-1');
    const db = makeDb({ getCharacter: vi.fn(() => char) });
    const imgNode = makeImageNode('img-1', {
      characterRefs: [
        { characterId: 'char-1', loadoutId: '', referenceImageHash: 'explicit-char-hash' },
      ],
    });
    const canvas = makeCanvas({ nodes: [imgNode] });
    const result = resolveReferenceImages(db, canvas, imgNode);
    expect(result).toContain('explicit-char-hash');
  });

  it('resolves character angleSlot when no explicit hash is given', () => {
    const char = makeCharacter('char-1', {
      referenceImages: [{ slot: 'front', assetHash: 'front-slot-hash', isStandard: true }],
    });
    const db = makeDb({ getCharacter: vi.fn(() => char) });
    const imgNode = makeImageNode('img-1', {
      characterRefs: [{ characterId: 'char-1', loadoutId: '', angleSlot: 'front' }],
    });
    const canvas = makeCanvas({ nodes: [imgNode] });
    const result = resolveReferenceImages(db, canvas, imgNode);
    expect(result).toContain('front-slot-hash');
  });

  it('resolves character refs across main/front slot aliases', () => {
    const char = makeCharacter('char-1', {
      referenceImages: [{ slot: 'main', assetHash: 'main-slot-hash', isStandard: true }],
    });
    const db = makeDb({ getCharacter: vi.fn(() => char) });
    const imgNode = makeImageNode('img-1', {
      characterRefs: [{ characterId: 'char-1', loadoutId: '', angleSlot: 'front' }],
    });
    const canvas = makeCanvas({ nodes: [imgNode] });

    const result = resolveReferenceImages(db, canvas, imgNode);

    expect(result).toContain('main-slot-hash');
  });

  it('collects all character.referenceImages when no slot or explicit hash', () => {
    const char = makeCharacter('char-1', {
      referenceImages: [
        { slot: 'front', assetHash: 'front-hash', isStandard: true },
        { slot: 'back', assetHash: 'back-hash', isStandard: true },
      ],
    });
    const db = makeDb({ getCharacter: vi.fn(() => char) });
    const imgNode = makeImageNode('img-1', {
      characterRefs: [{ characterId: 'char-1', loadoutId: '' }],
    });
    const canvas = makeCanvas({ nodes: [imgNode] });
    const result = resolveReferenceImages(db, canvas, imgNode);
    expect(result).toContain('front-hash');
    expect(result).toContain('back-hash');
  });

  it('skips character ref when character not found in db', () => {
    const db = makeDb({ getCharacter: vi.fn(() => undefined) });
    const imgNode = makeImageNode('img-1', {
      characterRefs: [{ characterId: 'missing-char', loadoutId: '' }],
    });
    const canvas = makeCanvas({ nodes: [imgNode] });
    expect(resolveReferenceImages(db, canvas, imgNode)).toHaveLength(0);
  });

  it('includes equipment explicit referenceImageHash', () => {
    const eq = makeEquipment('eq-1');
    const db = makeDb({ getEquipment: vi.fn(() => eq) });
    const imgNode = makeImageNode('img-1', {
      equipmentRefs: [{ equipmentId: 'eq-1', referenceImageHash: 'eq-explicit-hash' }],
    });
    const canvas = makeCanvas({ nodes: [imgNode] });
    const result = resolveReferenceImages(db, canvas, imgNode);
    expect(result).toContain('eq-explicit-hash');
  });

  it('resolves equipment angleSlot when no explicit hash', () => {
    const eq = makeEquipment('eq-1', {
      referenceImages: [{ slot: 'front', assetHash: 'eq-front-hash', isStandard: true }],
    });
    const db = makeDb({ getEquipment: vi.fn(() => eq) });
    const imgNode = makeImageNode('img-1', {
      equipmentRefs: [{ equipmentId: 'eq-1', angleSlot: 'front' }],
    });
    const canvas = makeCanvas({ nodes: [imgNode] });
    const result = resolveReferenceImages(db, canvas, imgNode);
    expect(result).toContain('eq-front-hash');
  });

  it('collects all equipment referenceImages when no slot or explicit hash', () => {
    const eq = makeEquipment('eq-1', {
      referenceImages: [
        { slot: 'front', assetHash: 'eq-f', isStandard: true },
        { slot: 'back', assetHash: 'eq-b', isStandard: true },
      ],
    });
    const db = makeDb({ getEquipment: vi.fn(() => eq) });
    const imgNode = makeImageNode('img-1', {
      equipmentRefs: [{ equipmentId: 'eq-1' }],
    });
    const canvas = makeCanvas({ nodes: [imgNode] });
    const result = resolveReferenceImages(db, canvas, imgNode);
    expect(result).toContain('eq-f');
    expect(result).toContain('eq-b');
  });

  it('includes location explicit referenceImageHash', () => {
    const loc = makeLocation('loc-1');
    const db = makeDb({ getLocation: vi.fn(() => loc) });
    const imgNode = makeImageNode('img-1', {
      locationRefs: [{ locationId: 'loc-1', referenceImageHash: 'loc-explicit-hash' }],
    });
    const canvas = makeCanvas({ nodes: [imgNode] });
    const result = resolveReferenceImages(db, canvas, imgNode);
    expect(result).toContain('loc-explicit-hash');
  });

  it('resolves location angleSlot when no explicit hash', () => {
    const loc = makeLocation('loc-1', {
      referenceImages: [{ slot: 'wide-establishing', assetHash: 'loc-wide-hash', isStandard: true }],
    });
    const db = makeDb({ getLocation: vi.fn(() => loc) });
    const imgNode = makeImageNode('img-1', {
      locationRefs: [{ locationId: 'loc-1', angleSlot: 'wide-establishing' }],
    });
    const canvas = makeCanvas({ nodes: [imgNode] });
    const result = resolveReferenceImages(db, canvas, imgNode);
    expect(result).toContain('loc-wide-hash');
  });

  it('collects all location referenceImages when no slot or explicit hash', () => {
    const loc = makeLocation('loc-1', {
      referenceImages: [
        { slot: 'wide-establishing', assetHash: 'loc-a', isStandard: true },
        { slot: 'atmosphere', assetHash: 'loc-b', isStandard: true },
      ],
    });
    const db = makeDb({ getLocation: vi.fn(() => loc) });
    const imgNode = makeImageNode('img-1', {
      locationRefs: [{ locationId: 'loc-1' }],
    });
    const canvas = makeCanvas({ nodes: [imgNode] });
    const result = resolveReferenceImages(db, canvas, imgNode);
    expect(result).toContain('loc-a');
    expect(result).toContain('loc-b');
  });

  it('skips equipment ref when equipment not found in db', () => {
    const db = makeDb({ getEquipment: vi.fn(() => undefined) });
    const imgNode = makeImageNode('img-1', {
      equipmentRefs: [{ equipmentId: 'missing-eq' }],
    });
    const canvas = makeCanvas({ nodes: [imgNode] });
    expect(resolveReferenceImages(db, canvas, imgNode)).toHaveLength(0);
  });

  it('deduplicates identical hashes across multiple refs', () => {
    const char = makeCharacter('char-1', {
      referenceImages: [{ slot: 'front', assetHash: 'shared-hash', isStandard: true }],
    });
    const db = makeDb({ getCharacter: vi.fn(() => char) });
    const imgNode = makeImageNode('img-1', {
      // Two refs pointing to the same character, both falling back to referenceImages
      characterRefs: [
        { characterId: 'char-1', loadoutId: '' },
        { characterId: 'char-1', loadoutId: '' },
      ],
    });
    const canvas = makeCanvas({ nodes: [imgNode] });
    const result = resolveReferenceImages(db, canvas, imgNode);
    // Should only appear once
    expect(result.filter((h) => h === 'shared-hash')).toHaveLength(1);
  });

});

// ===========================================================================
// resolveCharacterEntities
// ===========================================================================

describe('resolveCharacterEntities', () => {
  it('returns empty array for undefined or empty refs', () => {
    const db = makeDb();
    expect(resolveCharacterEntities(db, undefined)).toEqual([]);
    expect(resolveCharacterEntities(db, [])).toEqual([]);
  });

  it('skips refs whose character is not found in db', () => {
    const db = makeDb({ getCharacter: vi.fn(() => undefined) });
    const refs: CharacterRef[] = [{ characterId: 'missing', loadoutId: '' }];
    expect(resolveCharacterEntities(db, refs)).toHaveLength(0);
  });

  it('resolves character with matching loadout', () => {
    const char = makeCharacter('char-1', {
      loadouts: [{ id: 'loadout-a', name: 'Loadout A', equipmentIds: ['eq-1'] }],
      defaultLoadoutId: 'loadout-a',
    });
    const eq = makeEquipment('eq-1');
    const db = makeDb({
      getCharacter: vi.fn(() => char),
      getEquipment: vi.fn(() => eq),
    });
    const refs: CharacterRef[] = [{ characterId: 'char-1', loadoutId: 'loadout-a' }];
    const result = resolveCharacterEntities(db, refs);
    expect(result).toHaveLength(1);
    expect(result[0]?.character.id).toBe('char-1');
    expect(result[0]?.loadout?.id).toBe('loadout-a');
    expect(result[0]?.equipment).toHaveLength(1);
    expect(result[0]?.equipment?.[0]?.id).toBe('eq-1');
  });

  it('falls back to default loadout when requested loadout is not found', () => {
    const char = makeCharacter('char-1', {
      loadouts: [{ id: 'default-loadout', name: 'Default', equipmentIds: [] }],
      defaultLoadoutId: 'default-loadout',
    });
    const db = makeDb({ getCharacter: vi.fn(() => char), getEquipment: vi.fn(() => undefined) });
    const refs: CharacterRef[] = [{ characterId: 'char-1', loadoutId: 'nonexistent-loadout' }];
    const result = resolveCharacterEntities(db, refs);
    expect(result).toHaveLength(1);
    expect(result[0]?.loadout?.id).toBe('default-loadout');
  });

  it('passes through emotion and costume fields from ref', () => {
    const char = makeCharacter('char-1', { loadouts: [], defaultLoadoutId: '' });
    const db = makeDb({ getCharacter: vi.fn(() => char) });
    const refs: CharacterRef[] = [
      { characterId: 'char-1', loadoutId: '', emotion: 'happy', costume: 'battle-armor' },
    ];
    const result = resolveCharacterEntities(db, refs);
    expect(result[0]?.emotion).toBe('happy');
    expect(result[0]?.costume).toBe('battle-armor');
  });

  it('sets equipment to undefined when loadout has no equipment IDs', () => {
    const char = makeCharacter('char-1', {
      loadouts: [{ id: 'empty-loadout', name: 'Empty', equipmentIds: [] }],
      defaultLoadoutId: 'empty-loadout',
    });
    const db = makeDb({ getCharacter: vi.fn(() => char), getEquipment: vi.fn(() => undefined) });
    const refs: CharacterRef[] = [{ characterId: 'char-1', loadoutId: 'empty-loadout' }];
    const result = resolveCharacterEntities(db, refs);
    expect(result[0]?.equipment).toBeUndefined();
  });

  it('skips equipment entries that are not found in db', () => {
    const char = makeCharacter('char-1', {
      loadouts: [{ id: 'l1', name: 'L1', equipmentIds: ['found', 'missing'] }],
      defaultLoadoutId: 'l1',
    });
    const foundEq = makeEquipment('found');
    const db = makeDb({
      getCharacter: vi.fn(() => char),
      getEquipment: vi.fn((id: string) => (id === 'found' ? foundEq : undefined)),
    });
    const refs: CharacterRef[] = [{ characterId: 'char-1', loadoutId: 'l1' }];
    const result = resolveCharacterEntities(db, refs);
    expect(result[0]?.equipment).toHaveLength(1);
    expect(result[0]?.equipment?.[0]?.id).toBe('found');
  });

  it('resolves multiple character refs independently', () => {
    const char1 = makeCharacter('char-1', { loadouts: [], defaultLoadoutId: '' });
    const char2 = makeCharacter('char-2', { loadouts: [], defaultLoadoutId: '' });
    const db = makeDb({
      getCharacter: vi.fn((id: string) => (id === 'char-1' ? char1 : id === 'char-2' ? char2 : undefined)),
    });
    const refs: CharacterRef[] = [
      { characterId: 'char-1', loadoutId: '' },
      { characterId: 'char-2', loadoutId: '' },
    ];
    const result = resolveCharacterEntities(db, refs);
    expect(result).toHaveLength(2);
    expect(result[0]?.character.id).toBe('char-1');
    expect(result[1]?.character.id).toBe('char-2');
  });
});

// ===========================================================================
// resolveLocationEntities
// ===========================================================================

describe('resolveLocationEntities', () => {
  it('returns empty array for undefined or empty refs', () => {
    const db = makeDb();
    expect(resolveLocationEntities(db, undefined)).toEqual([]);
    expect(resolveLocationEntities(db, [])).toEqual([]);
  });

  it('skips refs whose location is not found in db', () => {
    const db = makeDb({ getLocation: vi.fn(() => undefined) });
    const refs: LocationRef[] = [{ locationId: 'missing' }];
    expect(resolveLocationEntities(db, refs)).toHaveLength(0);
  });

  it('resolves locations that are found in db', () => {
    const loc1 = makeLocation('loc-1');
    const loc2 = makeLocation('loc-2');
    const db = makeDb({
      getLocation: vi.fn((id: string) =>
        id === 'loc-1' ? loc1 : id === 'loc-2' ? loc2 : undefined,
      ),
    });
    const refs: LocationRef[] = [{ locationId: 'loc-1' }, { locationId: 'loc-2' }];
    const result = resolveLocationEntities(db, refs);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe('loc-1');
    expect(result[1]?.id).toBe('loc-2');
  });

  it('returns only found locations when some are missing', () => {
    const loc = makeLocation('loc-found');
    const db = makeDb({
      getLocation: vi.fn((id: string) => (id === 'loc-found' ? loc : undefined)),
    });
    const refs: LocationRef[] = [{ locationId: 'loc-found' }, { locationId: 'loc-missing' }];
    const result = resolveLocationEntities(db, refs);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('loc-found');
  });
});

// ===========================================================================
// resolveStandaloneEquipment
// ===========================================================================

describe('resolveStandaloneEquipment', () => {
  it('returns empty array for undefined or empty refs', () => {
    const db = makeDb();
    expect(resolveStandaloneEquipment(db, undefined, [])).toEqual([]);
    expect(resolveStandaloneEquipment(db, [], [])).toEqual([]);
  });

  it('returns equipment not already present in character loadouts', () => {
    const eq1 = makeEquipment('eq-standalone');
    const db = makeDb({ getEquipment: vi.fn(() => eq1) });
    const result = resolveStandaloneEquipment(db, [{ equipmentId: 'eq-standalone' }], []);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('eq-standalone');
  });

  it('excludes equipment already present in a character loadout', () => {
    const eq = makeEquipment('eq-in-loadout');
    const db = makeDb({ getEquipment: vi.fn(() => eq) });
    const resolvedCharacters = [
      {
        character: makeCharacter('char-1'),
        loadout: { id: 'l1', name: 'L1', equipmentIds: ['eq-in-loadout'] },
        equipment: [eq],
        emotion: undefined,
        costume: undefined,
      },
    ];
    const result = resolveStandaloneEquipment(
      db,
      [{ equipmentId: 'eq-in-loadout' }],
      resolvedCharacters,
    );
    expect(result).toHaveLength(0);
  });

  it('skips equipment not found in db', () => {
    const db = makeDb({ getEquipment: vi.fn(() => undefined) });
    const result = resolveStandaloneEquipment(db, [{ equipmentId: 'missing-eq' }], []);
    expect(result).toHaveLength(0);
  });

  it('includes equipment from characters with undefined equipment array in loadout check', () => {
    // ResolvedCharacter with no equipment field should not accidentally block standalone items
    const eq = makeEquipment('eq-standalone-2');
    const db = makeDb({ getEquipment: vi.fn(() => eq) });
    const resolvedCharacters = [
      {
        character: makeCharacter('char-1'),
        loadout: undefined,
        equipment: undefined,
        emotion: undefined,
        costume: undefined,
      },
    ];
    const result = resolveStandaloneEquipment(
      db,
      [{ equipmentId: 'eq-standalone-2' }],
      resolvedCharacters,
    );
    expect(result).toHaveLength(1);
  });

  it('handles multiple EquipmentRef objects', () => {
    const eqA = makeEquipment('eq-a');
    const eqB = makeEquipment('eq-b');
    const db = makeDb({
      getEquipment: vi.fn((id: string) =>
        id === 'eq-a' ? eqA : id === 'eq-b' ? eqB : undefined,
      ),
    });
    const result = resolveStandaloneEquipment(
      db,
      [{ equipmentId: 'eq-a' }, { equipmentId: 'eq-b' }],
      [],
    );
    expect(result).toHaveLength(2);
    const ids = result.map((e) => e.id);
    expect(ids).toContain('eq-a');
    expect(ids).toContain('eq-b');
  });
});
