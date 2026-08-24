import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Canvas,
  CanvasNode,
  PresetDefinition,
  PromptAssemblyOutputV1,
} from '@lucid-fin/contracts';
import { createEmptyPresetTrackSet } from '@lucid-fin/contracts';

/**
 * Wrap flat entity spies in the repository bundle shape used by production.
 */
function withEntityRepos<T extends Record<string, unknown>>(
  flat: T,
): T & {
  repos: { entities: Record<string, unknown>; projectSettings: Record<string, unknown> };
} {
  return {
    ...flat,
    repos: {
      entities: {
        getCharacter: flat.getCharacter,
        getEquipment: flat.getEquipment,
        getLocation: flat.getLocation,
        upsertCharacter: flat.upsertCharacter,
        upsertEquipment: flat.upsertEquipment,
        upsertLocation: flat.upsertLocation,
      },
      projectSettings: {
        getJson: () => undefined,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Hoist mocks before any imports that pull in the mocked modules
// ---------------------------------------------------------------------------

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

// compilePrompt returns a minimal compiled result that exercises the branches
// in buildGenerationContext without requiring the real compiler infra
const compilePromptMock = vi.hoisted(() =>
  vi.fn(() => ({
    prompt: 'compiled prompt',
    negativePrompt: undefined,
    referenceImages: [],
    params: {},
    wordCount: 3,
    budget: 100,
    segments: [],
    diagnostics: [],
  })),
);

vi.mock('@lucid-fin/application', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@lucid-fin/application')>()),
  compilePrompt: compilePromptMock,
  resolvePromptTemplate: (
    template: string,
    definitions: Array<{ key: string; default: unknown }>,
    values: Record<string, unknown>,
  ) =>
    definitions.reduce(
      (result, definition) =>
        result
          .split(`{${definition.key}}`)
          .join(String(values[definition.key] ?? definition.default)),
      template,
    ),
}));

// project-context has been removed — loadCurrentProjectStyleGuide now returns DEFAULT_STYLE_GUIDE directly

// ---------------------------------------------------------------------------
// The module under test — imported AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  buildGenerationContext,
  determineGenerationType,
  determinePromptMode,
  ensureAdapterConditioningSupports,
  ensureAdapterSupports,
  mapGenerationTypeToAdapterType,
  mapGenerationTypeToAssetType,
  mergeGenerationParams,
  resolveAdapter,
  resolveBaseSeed,
  resolveMediaDimensions,
  resolveNodeProviderId,
  resolveVariantCount,
  prepareGenerationPromptAssembly,
} from './generation-context.js';
import { hashPromptAssemblyInput } from '../../services/prompt-assembly.service.js';
import { createMediaTaskHandler } from '../../task-execution/media-task-handler.js';
import { registerCanvasTools } from './commander-tool-deps/canvas-tools.js';
import {
  DEFAULT_AUDIO_DURATION,
  DEFAULT_VIDEO_DURATION,
  MAX_VARIANTS,
} from './generation-helpers.js';

let referenceAssetDirectory = '';
let referenceAssetPath = '';

beforeAll(() => {
  referenceAssetDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-generation-context-'));
  referenceAssetPath = path.join(referenceAssetDirectory, 'reference.png');
  fs.writeFileSync(referenceAssetPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

afterAll(() => {
  if (referenceAssetDirectory) {
    fs.rmSync(referenceAssetDirectory, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeNow() {
  return Date.now();
}

function makeImageNode(overrides: Record<string, unknown> = {}): CanvasNode {
  const now = makeNow();
  return {
    id: 'node-image',
    type: 'image',
    position: { x: 0, y: 0 },
    data: {
      status: 'empty',
      variants: [],
      selectedVariantIndex: 0,
      variantCount: 1,
      seedLocked: false,
      presetTracks: createEmptyPresetTrackSet(),
      ...overrides,
    },
    title: 'Test Image',
    status: 'idle',
    bypassed: false,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

function makeVideoNode(overrides: Record<string, unknown> = {}): CanvasNode {
  const now = makeNow();
  return {
    id: 'node-video',
    type: 'video',
    position: { x: 0, y: 0 },
    data: {
      status: 'empty',
      duration: 5,
      fps: 24,
      variants: [],
      selectedVariantIndex: 0,
      variantCount: 1,
      seedLocked: false,
      presetTracks: createEmptyPresetTrackSet(),
      ...overrides,
    },
    title: 'Test Video',
    status: 'idle',
    bypassed: false,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

function makeAudioNode(overrides: Record<string, unknown> = {}): CanvasNode {
  const now = makeNow();
  return {
    id: 'node-audio',
    type: 'audio',
    position: { x: 0, y: 0 },
    data: {
      status: 'empty',
      audioType: 'voice',
      variants: [],
      selectedVariantIndex: 0,
      variantCount: 1,
      seedLocked: false,
      ...overrides,
    },
    title: 'Test Audio',
    status: 'idle',
    bypassed: false,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

function makeBackdropNode(overrides: Record<string, unknown> = {}): CanvasNode {
  const now = makeNow();
  return {
    id: 'node-backdrop',
    type: 'backdrop',
    position: { x: 0, y: 0 },
    data: {
      status: 'empty',
      variants: [],
      selectedVariantIndex: 0,
      variantCount: 1,
      seedLocked: false,
      presetTracks: createEmptyPresetTrackSet(),
      ...overrides,
    },
    title: 'Backdrop',
    status: 'idle',
    bypassed: false,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

function makeTextNode(): CanvasNode {
  const now = makeNow();
  return {
    id: 'node-text',
    type: 'text',
    position: { x: 0, y: 0 },
    data: { content: 'some text' },
    title: 'Note',
    status: 'idle',
    bypassed: false,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

function makeCanvas(nodes: CanvasNode[] = [], edges: Canvas['edges'] = []): Canvas {
  const now = makeNow();
  return {
    id: 'canvas-1',
    name: 'Test Canvas',
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
}

function makeAdapter(
  overrides: Partial<{
    id: string;
    type: string | string[];
    capabilities: string[];
  }> = {},
) {
  return {
    id: overrides.id ?? 'mock-provider',
    name: 'Mock Provider',
    type: overrides.type ?? 'image',
    capabilities: overrides.capabilities ?? ['text-to-image'],
    maxConcurrent: 1,
    resolutionController: {
      capabilities: {
        semantics: 'exact' as const,
        nativeDefault: {
          id: 'default',
          label: 'Provider default',
          mode: 'provider-default' as const,
        },
        options: [],
      },
      resolve: vi.fn((intent, context) => ({
        supported: true as const,
        plan: {
          ...context,
          requested: intent,
          ...(intent.mode === 'exact' ? { width: intent.width, height: intent.height } : {}),
          ...(intent.mode === 'tier' ? { tier: intent.tier } : {}),
          outputKnown: intent.mode === 'exact',
        },
        currency: 'USD' as const,
        warnings: [],
      })),
    },
    configure: vi.fn(),
    validate: vi.fn(async () => true),
    generate: vi.fn(async () => ({
      assetHash: '',
      assetPath: '/tmp/out.png',
      provider: 'mock-provider',
    })),
    estimateCost: vi.fn(() => ({
      estimatedCost: 0,
      currency: 'USD',
      provider: 'mock-provider',
      unit: 'image',
    })),
    checkStatus: vi.fn(async () => 'completed'),
    cancel: vi.fn(async () => undefined),
  };
}

function makeRegistry(adapter: ReturnType<typeof makeAdapter> | null = null) {
  return {
    get: vi.fn((id: string) => (adapter && id === adapter.id ? adapter : undefined)),
    list: vi.fn(() => (adapter ? [adapter] : [])),
  };
}

function makePromptAssemblyService() {
  const records = new Map<string, Record<string, unknown>>();
  const prepare = vi.fn((draft: Record<string, unknown>) => {
    const assemblyId = `assembly-${records.size + 1}`;
    const sources = ((draft.sources as Array<Record<string, unknown>> | undefined) ?? []).map(
      (source, index) => ({ ...source, sourceHash: `source-hash-${index + 1}` }),
    );
    const inputWithoutHash = {
      ...draft,
      version: 1,
      assemblyId,
      sources,
    };
    const input = {
      ...inputWithoutHash,
      inputHash: hashPromptAssemblyInput(inputWithoutHash as never),
    };
    const record = {
      id: assemblyId,
      canvasId: draft.canvasId,
      nodeId: draft.nodeId,
      nodeUpdatedAt: draft.nodeUpdatedAt,
      mediaType: draft.mediaType,
      mode: draft.mode,
      purpose: draft.purpose,
      inputHash: input.inputHash,
      input,
      status: 'prepared',
      rowVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    records.set(assemblyId, record);
    return record;
  });
  const submitCommanderOutput = vi.fn((id: string, output: PromptAssemblyOutputV1) => {
    const current = records.get(id);
    if (!current) throw new Error(`Prompt Assembly not found: ${id}`);
    const assembled = { ...current, status: 'assembled', output, rowVersion: 2, assembledAt: 2 };
    records.set(id, assembled);
    return assembled;
  });
  return {
    prepare,
    get: vi.fn((id: string) => records.get(id)),
    submitCommanderOutput,
    markSubmitted: vi.fn(),
    markFailed: vi.fn(),
    listByNode: vi.fn(() => []),
  };
}

function makeLlmRegistry() {
  return { get: vi.fn(), list: vi.fn(() => []) };
}

function makeDepsWithNode(
  node: CanvasNode,
  adapterOverrides: Partial<Parameters<typeof makeAdapter>[0]> = {},
) {
  const canvas = makeCanvas([node]);
  const adapter = makeAdapter(adapterOverrides);
  return {
    deps: {
      adapterRegistry: makeRegistry(adapter),
      cas: {
        importAsset: vi.fn(async () => ({
          ref: { hash: 'hash-out' },
          meta: {
            hash: 'hash-out',
            type: 'image',
            mimeType: 'image/png',
            size: 4,
            width: 1,
            height: 1,
            duration: undefined,
            createdAt: Date.now(),
          },
        })),
        getAssetPath: vi.fn(() => referenceAssetPath),
      },
      db: withEntityRepos({
        insertAsset: vi.fn(),
        getCharacter: vi.fn(() => undefined),
        getEquipment: vi.fn(() => undefined),
        getLocation: vi.fn(() => undefined),
      }),
      canvasStore: {
        get: vi.fn(() => canvas),
        save: vi.fn(),
      },
      keychain: {
        getKey: vi.fn(async () => 'secret-key'),
      },
      resolvePresetCatalog: vi.fn(() => []),
      promptAssemblyService: makePromptAssemblyService(),
      llmRegistry: makeLlmRegistry(),
    },
    canvas,
    adapter,
  };
}

function registerCanvasGenerationTool(
  deps: ReturnType<typeof makeDepsWithNode>['deps'],
  mediaTaskService?: unknown,
) {
  const tools = new Map<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>();
  registerCanvasTools(
    {
      register: vi.fn(
        (tool: { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> }) => {
          tools.set(tool.name, tool);
        },
      ),
    } as never,
    {
      ...deps,
      defaultCanvasId: 'canvas-1',
      authorizedCanvasIds: ['canvas-1'],
      commanderContinuation: { sessionId: 'session-1' },
      mediaTaskService,
      presetCatalog: { list: deps.resolvePresetCatalog },
      resolveProcessPrompt: vi.fn(() => 'process prompt'),
    } as never,
    () => null,
    { emit: vi.fn() } as never,
    async () => [],
    async (preset) => preset,
  );
  const tool = tools.get('canvas.generation');
  if (!tool) throw new Error('canvas.generation was not registered');
  return tool;
}

function makeCanonicalMediaTaskService(
  deps: ReturnType<typeof makeDepsWithNode>['deps'],
  parentAttempt?: {
    id: string;
    status: 'accepted';
    canvasId: string;
    nodeId: string;
    promptAssemblyId: string;
    prompt: string;
    promptHash: string;
    assetHash?: string;
  },
) {
  Object.assign(deps.db.repos, {
    taskLists: {
      getLatestProductionMediaAttempt: vi.fn(() => undefined),
      getProductionMediaAttempt: vi.fn((id: string) =>
        id === parentAttempt?.id ? parentAttempt : undefined,
      ),
    },
  });
  const handler = createMediaTaskHandler({
    generationDeps: deps as never,
    mediaGenerationService: { advance: vi.fn(), cancel: vi.fn() },
  });

  return {
    start: vi.fn(
      async (input: {
        canvasId: string;
        nodeId: string;
        providerId?: string;
        providerConfig?: { baseUrl: string; model: string };
        commanderIntent?: string;
        parentAttemptId?: string;
        feedback?: string;
      }) => {
        const taskListId = 'task-list-refinement';
        const result = await handler.execute({
          taskList: { id: taskListId, entityType: 'canvas', entityId: input.canvasId },
          task: { id: 'task-refinement', input, output: {} },
          db: deps.db,
        } as never);
        const assemblyId = (result.output as { promptAssemblyId?: string } | undefined)
          ?.promptAssemblyId;
        return {
          id: taskListId,
          promptAssembly: assemblyId ? deps.promptAssemblyService.get(assemblyId) : undefined,
        };
      },
    ),
  };
}

// ---------------------------------------------------------------------------
// determinePromptMode
// ---------------------------------------------------------------------------

describe('determinePromptMode', () => {
  it('returns text-to-image when image node has no sourceImageHash', () => {
    const node = makeImageNode();
    const canvas = makeCanvas([node]);
    expect(determinePromptMode(canvas, node)).toBe('text-to-image');
  });

  it('returns image-to-image when image node has sourceImageHash', () => {
    const node = makeImageNode({ sourceImageHash: 'abc123' });
    const canvas = makeCanvas([node]);
    expect(determinePromptMode(canvas, node)).toBe('image-to-image');
  });

  it('returns image-to-image when resolved entity reference images are present', () => {
    const node = makeImageNode();
    const canvas = makeCanvas([node]);
    expect(determinePromptMode(canvas, node, true)).toBe('image-to-image');
  });

  it('returns text-to-video when video node has no image source or connection', () => {
    const node = makeVideoNode();
    const canvas = makeCanvas([node]);
    expect(determinePromptMode(canvas, node)).toBe('text-to-video');
  });

  it('returns image-to-video when video node has sourceImageHash', () => {
    const node = makeVideoNode({ sourceImageHash: 'hash-frame' });
    const canvas = makeCanvas([node]);
    expect(determinePromptMode(canvas, node)).toBe('image-to-video');
  });

  it('returns image-to-video when resolved entity reference images are present', () => {
    const node = makeVideoNode();
    const canvas = makeCanvas([node]);
    expect(determinePromptMode(canvas, node, true)).toBe('image-to-video');
  });

  it('returns image-to-video when a connected image node has an asset hash', () => {
    const imgNode: CanvasNode = makeImageNode({ assetHash: 'img-hash' });
    imgNode.id = 'img-1';
    const vidNode = makeVideoNode();
    vidNode.id = 'vid-1';
    const canvas = makeCanvas(
      [imgNode, vidNode],
      [{ id: 'e1', source: 'img-1', target: 'vid-1', data: { status: 'idle' } }],
    );
    expect(determinePromptMode(canvas, vidNode)).toBe('image-to-video');
  });

  it('returns image-to-video when video node has firstFrameNodeId pointing to an image with asset hash', () => {
    const imgNode: CanvasNode = makeImageNode({ assetHash: 'first-frame-hash' });
    imgNode.id = 'first-img';
    const vidNode = makeVideoNode({ firstFrameNodeId: 'first-img' });
    const canvas = makeCanvas([imgNode, vidNode]);
    expect(determinePromptMode(canvas, vidNode)).toBe('image-to-video');
  });

  it('returns text-to-image for audio nodes (fallback — mode unused by audio adapters)', () => {
    const node = makeAudioNode();
    const canvas = makeCanvas([node]);
    expect(determinePromptMode(canvas, node)).toBe('text-to-image');
  });
});

// ---------------------------------------------------------------------------
// determineGenerationType
// ---------------------------------------------------------------------------

describe('determineGenerationType', () => {
  it('returns "image" for image nodes', () => {
    expect(determineGenerationType(makeImageNode())).toBe('image');
  });

  it('returns "video" for video nodes', () => {
    expect(determineGenerationType(makeVideoNode())).toBe('video');
  });

  it('returns the audioType from audio node data for audio nodes', () => {
    expect(determineGenerationType(makeAudioNode({ audioType: 'voice' }))).toBe('voice');
    expect(determineGenerationType(makeAudioNode({ audioType: 'music' }))).toBe('music');
    expect(determineGenerationType(makeAudioNode({ audioType: 'sfx' }))).toBe('sfx');
  });
});

// ---------------------------------------------------------------------------
// resolveNodeProviderId
// ---------------------------------------------------------------------------

describe('resolveNodeProviderId', () => {
  it('prefers requestedProviderId when provided', () => {
    const node = makeImageNode({ providerId: 'node-provider' });
    const result = resolveNodeProviderId(node, 'runway-gen4');
    expect(result).toBe('runway-gen4');
  });

  it('falls back to node data providerId when requestedProviderId is absent', () => {
    const node = makeImageNode({ providerId: 'openai-dalle' });
    const result = resolveNodeProviderId(node, undefined);
    expect(result).toBe('openai-dalle');
  });

  it('returns undefined when neither requestedProviderId nor node providerId is set', () => {
    const node = makeImageNode();
    const result = resolveNodeProviderId(node, undefined);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ensureAdapterSupports
// ---------------------------------------------------------------------------

describe('ensureAdapterSupports', () => {
  it('does not throw when adapter type and capability match', () => {
    const adapter = makeAdapter({ type: 'image', capabilities: ['text-to-image'] });
    expect(() => ensureAdapterSupports(adapter as never, 'image', 'text-to-image')).not.toThrow();
  });

  it('throws when adapter does not support the generationType', () => {
    const adapter = makeAdapter({ type: 'image', capabilities: ['text-to-image'] });
    expect(() => ensureAdapterSupports(adapter as never, 'video', 'text-to-video')).toThrow(
      /does not support video/,
    );
  });

  it('throws when adapter type matches but capability is missing', () => {
    const adapter = makeAdapter({ type: 'image', capabilities: ['text-to-image'] });
    expect(() => ensureAdapterSupports(adapter as never, 'image', 'image-to-image')).toThrow(
      /does not support capability image-to-image/,
    );
  });

  it('accepts adapter with array of types', () => {
    const adapter = makeAdapter({
      type: ['image', 'video'],
      capabilities: ['text-to-image', 'text-to-video'],
    });
    expect(() => ensureAdapterSupports(adapter as never, 'image', 'text-to-image')).not.toThrow();
    expect(() => ensureAdapterSupports(adapter as never, 'video', 'text-to-video')).not.toThrow();
  });

  it('accepts voice/music/sfx when capability is present', () => {
    const voiceAdapter = makeAdapter({ type: 'voice', capabilities: ['text-to-voice'] });
    expect(() =>
      ensureAdapterSupports(voiceAdapter as never, 'voice', 'text-to-voice'),
    ).not.toThrow();

    const musicAdapter = makeAdapter({ type: 'music', capabilities: ['text-to-music'] });
    expect(() =>
      ensureAdapterSupports(musicAdapter as never, 'music', 'text-to-music'),
    ).not.toThrow();

    const sfxAdapter = makeAdapter({ type: 'sfx', capabilities: ['text-to-sfx'] });
    expect(() => ensureAdapterSupports(sfxAdapter as never, 'sfx', 'text-to-sfx')).not.toThrow();
  });
});

describe('ensureAdapterConditioningSupports', () => {
  it('rejects image references when the adapter has no explicit reference contract', () => {
    const adapter = makeAdapter({ capabilities: ['text-to-image', 'image-to-image'] });
    expect(() =>
      ensureAdapterConditioningSupports(adapter as never, {
        type: 'image',
        providerId: adapter.id,
        prompt: 'portrait',
        referenceImages: ['character-a'],
      }),
    ).toThrow(/does not declare support for ordered reference images/);
  });

  it('accepts ordered references inside an explicit provider limit', () => {
    const adapter = {
      ...makeAdapter({ capabilities: ['text-to-image', 'image-to-image'] }),
      conditioningCapabilities: {
        referenceImages: { maxImages: 4, preservesOrder: true },
      },
    };
    expect(() =>
      ensureAdapterConditioningSupports(adapter as never, {
        type: 'image',
        providerId: adapter.id,
        prompt: 'portrait',
        referenceImages: ['character-a', 'wardrobe-b'],
      }),
    ).not.toThrow();
  });

  it('rejects reference overflow before an adapter can silently truncate it', () => {
    const adapter = {
      ...makeAdapter({ capabilities: ['text-to-image', 'image-to-image'] }),
      conditioningCapabilities: {
        referenceImages: { maxImages: 2, preservesOrder: true },
      },
    };
    expect(() =>
      ensureAdapterConditioningSupports(adapter as never, {
        type: 'image',
        providerId: adapter.id,
        prompt: 'portrait',
        referenceImages: ['a', 'b', 'c'],
      }),
    ).toThrow(/supports at most 2 reference images; received 3/);
  });

  it('rejects multiple video primary inputs for legacy single-image mappers', () => {
    const adapter = makeAdapter({
      type: 'video',
      capabilities: ['text-to-video', 'image-to-video'],
    });
    expect(() =>
      ensureAdapterConditioningSupports(adapter as never, {
        type: 'video',
        providerId: adapter.id,
        prompt: 'tracking shot',
        referenceImages: ['character-a', 'location-b'],
      }),
    ).toThrow(/accepts only one primary conditioning image/);
  });

  it('requires an explicit last-frame capability', () => {
    const adapter = makeAdapter({
      type: 'video',
      capabilities: ['text-to-video', 'image-to-video'],
    });
    expect(() =>
      ensureAdapterConditioningSupports(adapter as never, {
        type: 'video',
        providerId: adapter.id,
        prompt: 'transition',
        frameReferenceImages: { first: 'start', last: 'finish' },
      }),
    ).toThrow(/does not declare last-frame conditioning support/);
  });

  it('rejects generic video references combined with first/last-frame semantics by default', () => {
    const adapter = {
      ...makeAdapter({ type: 'video', capabilities: ['text-to-video', 'image-to-video'] }),
      conditioningCapabilities: {
        referenceImages: { maxImages: 9, preservesOrder: true },
        firstFrame: true,
        lastFrame: true,
      },
    };
    expect(() =>
      ensureAdapterConditioningSupports(adapter as never, {
        type: 'video',
        providerId: adapter.id,
        prompt: 'tracking shot',
        referenceImages: ['character-a'],
        frameReferenceImages: { first: 'start', last: 'finish' },
      }),
    ).toThrow(/cannot combine ordered references with first, last, or source frame/i);
  });
});

// ---------------------------------------------------------------------------
// mapGenerationTypeToAdapterType
// ---------------------------------------------------------------------------

describe('mapGenerationTypeToAdapterType', () => {
  it('maps image → image', () => {
    expect(mapGenerationTypeToAdapterType('image')).toBe('image');
  });

  it('maps video → video', () => {
    expect(mapGenerationTypeToAdapterType('video')).toBe('video');
  });

  it('maps voice → voice', () => {
    expect(mapGenerationTypeToAdapterType('voice')).toBe('voice');
  });

  it('maps music → music', () => {
    expect(mapGenerationTypeToAdapterType('music')).toBe('music');
  });

  it('maps sfx → sfx', () => {
    expect(mapGenerationTypeToAdapterType('sfx')).toBe('sfx');
  });
});

// ---------------------------------------------------------------------------
// mapGenerationTypeToAssetType
// ---------------------------------------------------------------------------

describe('mapGenerationTypeToAssetType', () => {
  it('maps image → image', () => {
    expect(mapGenerationTypeToAssetType('image')).toBe('image');
  });

  it('maps video → video', () => {
    expect(mapGenerationTypeToAssetType('video')).toBe('video');
  });

  it('maps voice/music/sfx → audio', () => {
    expect(mapGenerationTypeToAssetType('voice')).toBe('audio');
    expect(mapGenerationTypeToAssetType('music')).toBe('audio');
    expect(mapGenerationTypeToAssetType('sfx')).toBe('audio');
  });
});

// ---------------------------------------------------------------------------
// resolveVariantCount
// ---------------------------------------------------------------------------

describe('resolveVariantCount', () => {
  const minimalImageData = {
    status: 'empty' as const,
    variants: [],
    selectedVariantIndex: 0,
    variantCount: 1,
    seedLocked: false,
  };

  it('uses requestedVariantCount when provided and valid', () => {
    expect(resolveVariantCount(minimalImageData, 3)).toBe(3);
  });

  it('falls back to node data variantCount when requestedVariantCount is not provided', () => {
    const data = { ...minimalImageData, variantCount: 4 };
    expect(resolveVariantCount(data, undefined)).toBe(4);
  });

  it('defaults to 1 when neither requestedVariantCount nor data.variantCount is set', () => {
    const data = { ...minimalImageData, variantCount: undefined };
    expect(resolveVariantCount(data as never, undefined)).toBe(1);
  });

  it('throws when variantCount is 0', () => {
    expect(() => resolveVariantCount(minimalImageData, 0)).toThrow(/variantCount/);
  });

  it('throws when variantCount exceeds MAX_VARIANTS', () => {
    expect(() => resolveVariantCount(minimalImageData, MAX_VARIANTS + 1)).toThrow(/variantCount/);
  });

  it('throws when variantCount is a float', () => {
    expect(() => resolveVariantCount(minimalImageData, 1.5)).toThrow(/variantCount/);
  });

  it('accepts MAX_VARIANTS as the upper bound', () => {
    expect(resolveVariantCount(minimalImageData, MAX_VARIANTS)).toBe(MAX_VARIANTS);
  });
});

// ---------------------------------------------------------------------------
// resolveBaseSeed
// ---------------------------------------------------------------------------

describe('resolveBaseSeed', () => {
  const minimalData = {
    status: 'empty' as const,
    variants: [],
    selectedVariantIndex: 0,
    variantCount: 1,
    seedLocked: false,
  };

  it('returns undefined when no seed is specified', () => {
    expect(resolveBaseSeed(minimalData, undefined)).toBeUndefined();
  });

  it('prefers requestedSeed over node data seed', () => {
    const data = { ...minimalData, seed: 111 };
    expect(resolveBaseSeed(data, 999)).toBe(999);
  });

  it('falls back to node data seed when requestedSeed is absent', () => {
    const data = { ...minimalData, seed: 42 };
    expect(resolveBaseSeed(data, undefined)).toBe(42);
  });

  it('throws when seed is a float', () => {
    expect(() => resolveBaseSeed(minimalData, 1.5)).toThrow(/seed must be an integer/);
  });

  it('accepts 0 as a valid seed', () => {
    expect(resolveBaseSeed(minimalData, 0)).toBe(0);
  });

  it('accepts negative integer seeds', () => {
    expect(resolveBaseSeed(minimalData, -7)).toBe(-7);
  });
});

// ---------------------------------------------------------------------------
// resolveMediaDimensions
// ---------------------------------------------------------------------------

describe('resolveMediaDimensions', () => {
  it('leaves image pixels unset when the provider owns the default', () => {
    const node = makeImageNode();
    const result = resolveMediaDimensions(node, 'image');
    expect(result).toEqual({});
  });

  it('uses explicit image node dimensions', () => {
    const node = makeImageNode({ width: 512, height: 768 });
    const result = resolveMediaDimensions(node, 'image');
    expect(result).toEqual({ width: 512, height: 768 });
  });

  it('leaves video pixels unset while retaining non-resolution defaults', () => {
    const node = makeVideoNode({
      width: undefined,
      height: undefined,
      duration: undefined,
      fps: undefined,
    });
    const result = resolveMediaDimensions(node, 'video');
    expect(result).toEqual({ duration: DEFAULT_VIDEO_DURATION, fps: 24 });
  });

  it('uses explicit video node dimensions, duration, and fps', () => {
    const node = makeVideoNode({ width: 1920, height: 1080, duration: 10, fps: 60 });
    const result = resolveMediaDimensions(node, 'video');
    expect(result).toEqual({ width: 1920, height: 1080, duration: 10, fps: 60 });
  });

  it('returns default audio duration for voice generation', () => {
    const node = makeAudioNode({ duration: undefined });
    const result = resolveMediaDimensions(node, 'voice');
    expect(result).toEqual({ duration: DEFAULT_AUDIO_DURATION });
  });

  it('returns explicit duration for music generation', () => {
    const node = makeAudioNode({ duration: 30 });
    const result = resolveMediaDimensions(node, 'music');
    expect(result).toEqual({ duration: 30 });
  });

  it('returns default audio duration for sfx generation', () => {
    const node = makeAudioNode({ duration: undefined });
    const result = resolveMediaDimensions(node, 'sfx');
    expect(result).toEqual({ duration: DEFAULT_AUDIO_DURATION });
  });

  it('returns empty object for unknown generation type', () => {
    const node = makeImageNode();
    const result = resolveMediaDimensions(node, 'unknown' as never);
    expect(result).toEqual({});
  });

  it('uses canvas publishImageResolution as fallback for image nodes without explicit size', () => {
    const node = makeImageNode();
    const canvas = makeCanvas([node]);
    canvas.settings = { publishImageResolution: { width: 2048, height: 2048 } };
    const result = resolveMediaDimensions(node, 'image', canvas);
    expect(result).toEqual({ width: 2048, height: 2048 });
  });

  it('uses the Canvas reference-image policy for reference image nodes', () => {
    const node = makeImageNode({ generationPurpose: 'reference-image' });
    const canvas = makeCanvas([node]);
    canvas.settings = {
      refResolution: { width: 1536, height: 1024 },
      publishImageResolution: { width: 2048, height: 2048 },
    };

    expect(resolveMediaDimensions(node, 'image', canvas)).toEqual({ width: 1536, height: 1024 });
  });

  it('keeps a reference image node override above the Canvas reference-image policy', () => {
    const node = makeImageNode({
      generationPurpose: 'reference-image',
      resolutionIntent: { mode: 'exact', width: 896, height: 1152 },
    });
    const canvas = makeCanvas([node]);
    canvas.settings = { refResolution: { width: 1536, height: 1024 } };

    expect(resolveMediaDimensions(node, 'image', canvas)).toEqual({ width: 896, height: 1152 });
  });

  it('prefers node dimensions over canvas publishImageResolution', () => {
    const node = makeImageNode({ width: 512, height: 768 });
    const canvas = makeCanvas([node]);
    canvas.settings = { publishImageResolution: { width: 2048, height: 2048 } };
    const result = resolveMediaDimensions(node, 'image', canvas);
    expect(result).toEqual({ width: 512, height: 768 });
  });

  it('uses canvas publishVideoResolution as fallback for video nodes without explicit size', () => {
    const node = makeVideoNode({ width: undefined, height: undefined, duration: 5, fps: 30 });
    const canvas = makeCanvas([node]);
    canvas.settings = { publishVideoResolution: { width: 1920, height: 1080 } };
    const result = resolveMediaDimensions(node, 'video', canvas);
    expect(result).toEqual({ width: 1920, height: 1080, duration: 5, fps: 30 });
  });

  it('uses provider-native defaults when Canvas has no resolution settings', () => {
    const node = makeImageNode();
    const canvas = makeCanvas([node]);
    canvas.settings = {};
    const result = resolveMediaDimensions(node, 'image', canvas);
    expect(result).toEqual({});
  });

  it('uses provider-native defaults without a Canvas parameter', () => {
    const node = makeImageNode();
    const result = resolveMediaDimensions(node, 'image');
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// mergeGenerationParams
// ---------------------------------------------------------------------------

describe('mergeGenerationParams', () => {
  it('merges fps into base params when fps is a number', () => {
    const result = mergeGenerationParams({ seedBehavior: 'locked' }, 30);
    expect(result).toEqual({ seedBehavior: 'locked', fps: 30 });
  });

  it('returns base params unchanged when fps is undefined', () => {
    const base = { audio: { voice: 'nova' } };
    expect(mergeGenerationParams(base, undefined)).toBe(base);
  });

  it('merges fps into undefined base params', () => {
    expect(mergeGenerationParams(undefined, 24)).toEqual({ fps: 24 });
  });

  it('returns undefined base params unchanged when fps is also undefined', () => {
    expect(mergeGenerationParams(undefined, undefined)).toBeUndefined();
  });

  it('overwrites existing fps in base params', () => {
    const result = mergeGenerationParams({ fps: 24 }, 60);
    expect(result).toEqual({ fps: 60 });
  });
});

// ---------------------------------------------------------------------------
// resolveAdapter
// ---------------------------------------------------------------------------

describe('resolveAdapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('returns the registered adapter when providerId matches and capabilities align', async () => {
    const adapter = makeAdapter({
      id: 'openai-dalle',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    const registry = makeRegistry(adapter);

    const result = await resolveAdapter(
      registry as never,
      'openai-dalle',
      'image',
      'text-to-image',
      undefined,
      { getKey: vi.fn(async () => 'sk-test') } as never,
    );

    expect(result.id).toBe('openai-dalle');
    expect(adapter.configure).toHaveBeenCalledWith(
      'sk-test',
      expect.objectContaining({ generationType: 'image' }),
    );
  });

  it('does not read or configure API-key credentials for an OAuth adapter', async () => {
    const adapter = makeAdapter({
      id: 'codex-imagegen',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    Object.assign(adapter, { credentialMode: 'oauth' });
    const registry = makeRegistry(adapter);
    const keychain = { getKey: vi.fn(async () => 'must-not-be-read') };

    const result = await resolveAdapter(
      registry as never,
      'codex-imagegen',
      'image',
      'text-to-image',
      undefined,
      keychain as never,
    );

    expect(result).toBe(adapter);
    expect(keychain.getKey).not.toHaveBeenCalled();
    expect(adapter.configure).not.toHaveBeenCalled();
  });

  it('configures adapter with baseUrl and model from providerConfig', async () => {
    const adapter = makeAdapter({
      id: 'openai-dalle',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    const registry = makeRegistry(adapter);

    await resolveAdapter(
      registry as never,
      'openai-dalle',
      'image',
      'text-to-image',
      { baseUrl: 'https://proxy.example/v1', model: 'gpt-image-1' },
      { getKey: vi.fn(async () => null) } as never,
    );

    expect(adapter.configure).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ baseUrl: 'https://proxy.example/v1', model: 'gpt-image-1' }),
    );
  });

  it('falls back to first supported adapter from list when no providerId is given', async () => {
    const adapter = makeAdapter({
      id: 'fallback-image',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    const registry = {
      get: vi.fn(() => undefined),
      list: vi.fn(() => [adapter]),
    };

    const result = await resolveAdapter(registry as never, undefined, 'image', 'text-to-image');

    expect(result.id).toBe('fallback-image');
  });

  it('throws when no adapter is available for the generation type', async () => {
    const registry = {
      get: vi.fn(() => undefined),
      list: vi.fn(() => []),
    };

    await expect(
      resolveAdapter(registry as never, undefined, 'image', 'text-to-image'),
    ).rejects.toThrow(/No configured adapter available for image/);
  });

  it('uses apiKey from providerConfig instead of keychain', async () => {
    const adapter = makeAdapter({
      id: 'openai-dalle',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    const registry = makeRegistry(adapter);
    const keychain = { getKey: vi.fn(async () => 'keychain-key') };

    // baseUrl and model are empty strings — options object stays empty, so configure
    // receives undefined as the second arg (no non-empty options to pass through)
    await resolveAdapter(
      registry as never,
      'openai-dalle',
      'image',
      'text-to-image',
      { baseUrl: '', model: '', apiKey: 'override-key' },
      keychain as never,
    );

    expect(adapter.configure).toHaveBeenCalledWith(
      'override-key',
      expect.objectContaining({ generationType: 'image' }),
    );
    expect(keychain.getKey).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildGenerationContext — integration-level tests
// ---------------------------------------------------------------------------

describe('buildGenerationContext', () => {
  beforeEach(() => {
    compilePromptMock.mockReturnValue({
      prompt: 'compiled prompt',
      negativePrompt: undefined,
      referenceImages: [],
      params: {},
      wordCount: 3,
      budget: 100,
      segments: [],
      diagnostics: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('throws when canvas is not found', async () => {
    const node = makeImageNode();
    const { deps } = makeDepsWithNode(node);
    (deps.canvasStore.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    await expect(
      buildGenerationContext(deps as never, { canvasId: 'missing-canvas', nodeId: 'node-image' }),
    ).rejects.toThrow(/Canvas not found: missing-canvas/);
  });

  it('throws when node is not found in the canvas', async () => {
    const node = makeImageNode();
    const { deps } = makeDepsWithNode(node);

    await expect(
      buildGenerationContext(deps as never, { canvasId: 'canvas-1', nodeId: 'no-such-node' }),
    ).rejects.toThrow(/Node not found: no-such-node/);
  });

  it('throws when attempting to generate a text node', async () => {
    const textNode = makeTextNode();
    const canvas = makeCanvas([textNode]);
    const adapter = makeAdapter();
    const deps = {
      adapterRegistry: makeRegistry(adapter),
      cas: { importAsset: vi.fn(), getAssetPath: vi.fn() },
      db: withEntityRepos({
        insertAsset: vi.fn(),
        getCharacter: vi.fn(() => undefined),
        getEquipment: vi.fn(() => undefined),
        getLocation: vi.fn(() => undefined),
      }),
      canvasStore: { get: vi.fn(() => canvas), save: vi.fn() },
      keychain: { getKey: vi.fn(async () => 'key') },
      resolvePresetCatalog: vi.fn(() => []),
      promptAssemblyService: makePromptAssemblyService(),
      llmRegistry: makeLlmRegistry(),
    };

    await expect(
      buildGenerationContext(deps as never, { canvasId: 'canvas-1', nodeId: 'node-text' }),
    ).rejects.toThrow(/Text nodes cannot be generated/);
  });

  it('builds a valid context for a minimal image node', async () => {
    const node = makeImageNode({ providerId: 'mock-provider' });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });

    const ctx = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
    });

    expect(ctx.nodeType).toBe('image');
    expect(ctx.generationType).toBe('image');
    expect(ctx.mode).toBe('text-to-image');
    expect(ctx.adapter.id).toBe('mock-provider');
    expect(ctx.variantCount).toBe(1);
    expect(ctx.baseSeed).toBeUndefined();
    expect(ctx.requestBase.prompt).toBe('compiled prompt');
    expect(ctx.requestBase.type).toBe('image');
  });

  it('uses the resolved custom preset catalog for image compilation and provider requests', async () => {
    const preset: PresetDefinition = {
      id: 'custom:image-look',
      category: 'look',
      name: 'Project Image Look',
      description: 'Project-owned image look',
      prompt: 'project custom image look fragment',
      builtIn: false,
      modified: false,
      params: [],
      defaults: {},
    };
    const presetTracks = createEmptyPresetTrackSet();
    presetTracks.look.entries.push({
      id: 'image-look-entry',
      category: 'look',
      presetId: preset.id,
      params: {},
      order: 0,
      enabled: true,
    });
    const node = makeImageNode({ providerId: 'mock-provider', presetTracks });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    deps.resolvePresetCatalog.mockReturnValue([preset]);
    compilePromptMock.mockReturnValue({
      prompt: 'compiled image request with project custom image look fragment',
      negativePrompt: undefined,
      referenceImages: [],
      params: {},
      wordCount: 8,
      budget: 100,
      segments: [],
      diagnostics: [],
    });

    const context = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: node.id,
    });

    expect(compilePromptMock).toHaveBeenCalledWith(
      expect.objectContaining({ presetLibrary: [preset], presetTracks }),
    );
    expect(deps.promptAssemblyService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            kind: 'preset',
            content: expect.stringContaining('project custom image look fragment'),
          }),
        ]),
      }),
    );
    expect(context.requestBase.prompt).toBe(
      'compiled image request with project custom image look fragment',
    );
  });

  it('resolves active preset template parameters before presenting the source to Commander', async () => {
    const preset: PresetDefinition = {
      id: 'builtin-camera-test-arc',
      category: 'camera',
      name: 'Test Arc',
      description: 'Parameterized camera direction',
      prompt: 'default camera arc',
      defaultPrompt: 'default camera arc',
      promptTemplate: 'camera arcs {speed} around the subject',
      promptParamDefs: [
        {
          key: 'speed',
          label: 'Speed',
          type: 'select',
          default: 'smoothly',
          options: ['smoothly', 'slowly'],
        },
      ],
      builtIn: true,
      modified: false,
      params: [],
      defaults: {},
    };
    const presetTracks = createEmptyPresetTrackSet();
    presetTracks.camera.intensity = 50;
    presetTracks.camera.entries.push({
      id: 'camera-entry',
      category: 'camera',
      presetId: preset.id,
      params: { speed: 'slowly' },
      intensity: 50,
      order: 0,
      enabled: true,
    });
    const node = makeVideoNode({ providerId: 'mock-provider', presetTracks });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'video',
      capabilities: ['text-to-video'],
    });
    deps.resolvePresetCatalog.mockReturnValue([preset]);

    await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: node.id,
    });

    expect(deps.promptAssemblyService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            kind: 'preset',
            content: expect.stringContaining('camera arcs slowly around the subject'),
            metadata: expect.objectContaining({ intensity: 25 }),
          }),
        ]),
      }),
    );
  });

  it('stores Commander intent as a required assembly source while compiling node facts', async () => {
    const node = makeImageNode({ providerId: 'mock-provider' });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    compilePromptMock.mockReturnValue({
      prompt: 'compiled Commander prompt with style authority',
      negativePrompt: undefined,
      referenceImages: [],
      params: {},
      wordCount: 6,
      budget: 100,
      segments: [],
      diagnostics: [],
    });

    const ctx = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
      commanderIntent: 'Commander scene delta',
    });

    expect(compilePromptMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Test Image' }),
    );
    expect(deps.promptAssemblyService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            sourceId: 'user-intent',
            kind: 'user-intent',
            content: 'Commander scene delta',
            required: true,
          }),
          expect.objectContaining({
            sourceId: 'node-prompt',
            kind: 'node-prompt',
            content: 'Test Image',
            required: true,
          }),
        ]),
      }),
    );
    expect(ctx.requestBase.prompt).toBe('compiled Commander prompt with style authority');
  });

  it('makes reference-image purpose a required Commander source and applies its Canvas policy', async () => {
    const node = makeImageNode({
      providerId: 'mock-provider',
      generationPurpose: 'reference-image',
    });
    const { deps, canvas } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    canvas.settings = {
      resolutionPolicy: {
        referenceImage: { mode: 'exact', width: 1536, height: 1024 },
        image: { mode: 'exact', width: 2048, height: 2048 },
      },
    };

    const context = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: canvas.id,
      nodeId: node.id,
    });

    expect(context.requestBase).toEqual(expect.objectContaining({ width: 1536, height: 1024 }));
    expect(deps.promptAssemblyService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            sourceId: 'generation-purpose',
            required: true,
            metadata: { generationPurpose: 'reference-image' },
          }),
        ]),
      }),
    );
  });

  it('prepares a parent-linked refinement from the exact prior prompt and feedback', async () => {
    const node = makeImageNode({ providerId: 'mock-provider' });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    const priorPrompt =
      'Exact prior provider prompt\nUSER QUALITY FEEDBACK (additive): brighten the eyes';

    const ctx = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
      promptAssemblyPurpose: 'user_refine',
      promptAssemblyParent: {
        assemblyId: 'parent-assembly',
        finalPrompt: priorPrompt,
        promptHash: 'a'.repeat(64),
        userFeedback: 'brighten the eyes',
      },
    });

    expect(ctx.promptAssemblyId).toBe('assembly-1');
    expect(deps.promptAssemblyService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'user_refine',
        parentAssemblyId: 'parent-assembly',
        sources: expect.arrayContaining([
          expect.objectContaining({
            sourceId: 'parent-final-prompt',
            kind: 'parent-prompt',
            content: priorPrompt,
            required: true,
            metadata: expect.objectContaining({ promptHash: 'a'.repeat(64) }),
          }),
          expect.objectContaining({
            sourceId: 'user-feedback',
            kind: 'user-feedback',
            content: 'brighten the eyes',
            required: true,
          }),
        ]),
      }),
    );
  });

  it('preserves every byte of the accepted parent prompt through canonical prepare', async () => {
    const priorPrompt = '  Exact prior provider prompt\nkeep trailing space  ';
    const node = makeImageNode({
      providerId: 'mock-provider',
      assetHash: 'asset-existing',
    });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    const expectedHash = createHash('sha256').update(priorPrompt, 'utf8').digest('hex');
    const mediaTaskService = makeCanonicalMediaTaskService(deps, {
      id: 'parent-attempt',
      status: 'accepted',
      canvasId: 'canvas-1',
      nodeId: 'node-image',
      promptAssemblyId: 'parent-assembly',
      prompt: priorPrompt,
      promptHash: expectedHash,
      assetHash: 'asset-existing',
    });

    await expect(
      registerCanvasGenerationTool(deps, mediaTaskService).execute({
        action: 'prepare',
        canvasId: 'canvas-1',
        nodeId: 'node-image',
        parentAttemptId: 'parent-attempt',
        feedback: 'Brighten the eyes',
      }),
    ).resolves.toMatchObject({ success: true });

    expect(deps.promptAssemblyService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        parentAssemblyId: 'parent-assembly',
        sourceAssetHash: 'asset-existing',
        sources: expect.arrayContaining([
          expect.objectContaining({
            sourceId: 'parent-final-prompt',
            content: priorPrompt,
            metadata: expect.objectContaining({ promptHash: expectedHash }),
          }),
        ]),
      }),
    );
  });

  it('refuses a legacy asset without an accepted parent attempt during canonical prepare', async () => {
    const node = makeImageNode({
      providerId: 'mock-provider',
      assetHash: 'legacy-asset',
    });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    const mediaTaskService = makeCanonicalMediaTaskService(deps);

    await expect(
      registerCanvasGenerationTool(deps, mediaTaskService).execute({
        action: 'prepare',
        canvasId: 'canvas-1',
        nodeId: 'node-image',
        parentAttemptId: 'legacy-asset',
        feedback: 'Brighten the eyes',
      }),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('exact accepted or definitively failed parent media attempt'),
    });
    expect(deps.promptAssemblyService.prepare).not.toHaveBeenCalled();
  });

  it('passes an external Commander final prompt and negative prompt to the provider unchanged', async () => {
    const node = makeImageNode({ providerId: 'mock-provider' });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    const preparedContext = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
    });
    const prepared = deps.promptAssemblyService.get(preparedContext.promptAssemblyId) as {
      id: string;
      input: {
        inputHash: string;
        sources: Array<{ sourceId: string; sourceHash: string }>;
      };
    };
    const finalPrompt = 'Exact Commander final prompt — keep every byte.\nShot: close-up';
    const negativePrompt = 'no host suffix\nno forced preset tail';
    const output: PromptAssemblyOutputV1 = {
      version: 1,
      assemblyId: prepared.id,
      inputHash: prepared.input.inputHash,
      finalPrompt,
      negativePrompt,
      sourceDecisions: prepared.input.sources.map((source) => ({
        sourceId: source.sourceId,
        sourceHash: source.sourceHash,
        disposition: 'applied',
      })),
      summary: 'Commander reconciled the sources',
      warnings: [],
    };
    Object.assign(deps, {
      preferredPromptAssembler: { id: 'commander-test', name: 'Commander Test' },
    });

    const context = await buildGenerationContext(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
      promptAssemblyId: prepared.id,
      promptAssemblyOutput: output,
    });

    expect(context.requestBase.prompt).toBe(finalPrompt);
    expect(context.requestBase.negativePrompt).toBe(negativePrompt);
  });

  it('fails closed when image generation has no persisted Prompt Assembly', async () => {
    const node = makeImageNode({ providerId: 'mock-provider' });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });

    await expect(
      buildGenerationContext(deps as never, {
        canvasId: 'canvas-1',
        nodeId: 'node-image',
      }),
    ).rejects.toThrow('requires a prepared Prompt Assembly');
    expect(deps.promptAssemblyService.prepare).not.toHaveBeenCalled();
  });

  it('estimates image cost without preparing prompts or nesting an active Commander LLM', async () => {
    const node = makeImageNode({ providerId: 'mock-provider' });
    const { deps, canvas, adapter } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    canvas.settings = {
      resolutionPolicy: {
        image: { mode: 'exact', width: 1536, height: 1024 },
      },
    };
    adapter.estimateCost.mockReturnValue({
      estimatedCost: 0.37,
      currency: 'USD',
      provider: 'mock-provider',
      unit: 'image',
    });
    deps.promptAssemblyService.prepare.mockReturnValue({
      id: 'assembly-that-must-not-exist',
      canvasId: canvas.id,
      nodeId: node.id,
      status: 'prepared',
      input: { nodeUpdatedAt: node.updatedAt },
    });

    const tools = new Map<
      string,
      { execute: (args: Record<string, unknown>) => Promise<unknown> }
    >();
    registerCanvasTools(
      {
        register: vi.fn(
          (tool: {
            name: string;
            execute: (args: Record<string, unknown>) => Promise<unknown>;
          }) => {
            tools.set(tool.name, tool);
          },
        ),
      } as never,
      {
        ...deps,
        defaultCanvasId: canvas.id,
        authorizedCanvasIds: [canvas.id],
        presetCatalog: { list: deps.resolvePresetCatalog },
        activeLLMAdapter: { id: 'active-commander', name: 'Active Commander' },
        resolveProcessPrompt: vi.fn(() => 'process prompt'),
      } as never,
      () => null,
      { emit: vi.fn() } as never,
      async () => [],
      async (preset) => preset,
    );

    await expect(
      tools.get('canvas.generation')?.execute({
        action: 'estimate',
        canvasId: canvas.id,
        nodeIds: [node.id],
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        totalEstimatedCost: 0.37,
        currency: 'USD',
        nodeCosts: [{ nodeId: node.id, estimatedCost: 0.37 }],
      },
    });
    expect(deps.promptAssemblyService.prepare).not.toHaveBeenCalled();
    expect(adapter.resolutionController.resolve).toHaveBeenCalledOnce();
    expect(adapter.estimateCost).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1536, height: 1024 }),
    );
  });

  it('passes the canonical Canvas visual-style policy into manual generation', async () => {
    const node = makeImageNode({ providerId: 'mock-provider' });
    const { deps, canvas } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    canvas.settings = {
      visualStylePolicy: {
        version: 1,
        summary: 'ink-wash neo-noir',
        locked: { palette: 'muted teal and ochre' },
      },
    };

    const ctx = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
    });

    expect(compilePromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        visualStylePolicy: expect.objectContaining({ summary: 'ink-wash neo-noir' }),
      }),
    );
    expect(ctx.visualStyle).toEqual(
      expect.objectContaining({ source: 'canvas-draft', policyHash: expect.any(String) }),
    );
  });

  it('does not mix Canvas draft or project style defaults into Visual Constitution generation', async () => {
    const node = makeImageNode({ providerId: 'mock-provider' });
    const { deps, canvas } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    canvas.settings = {
      visualStylePolicy: { version: 1, summary: 'unapproved Canvas draft' },
    };

    await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
      styleAuthority: 'visual-constitution',
    });

    expect(compilePromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        visualStylePolicy: undefined,
        styleGuide: undefined,
      }),
    );
  });

  it('builds a valid context for a video node', async () => {
    const node = makeVideoNode({
      providerId: 'mock-provider',
      width: 1280,
      height: 720,
      duration: 5,
      fps: 24,
    });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'video',
      capabilities: ['text-to-video'],
    });

    const ctx = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-video',
    });

    expect(ctx.nodeType).toBe('video');
    expect(ctx.generationType).toBe('video');
    expect(ctx.mode).toBe('text-to-video');
    expect(ctx.requestBase.width).toBe(1280);
    expect(ctx.requestBase.height).toBe(720);
    expect(ctx.requestBase.duration).toBe(5);
    expect(ctx.requestBase.params).toMatchObject({ fps: 24 });
  });

  it('uses a resolved built-in override for video compilation and provider requests', async () => {
    const override: PresetDefinition = {
      id: 'camera:arc-left',
      category: 'camera',
      name: 'Arc Left',
      description: 'Project override',
      prompt: 'project-overridden left arc with a restrained finish',
      defaultPrompt: 'default left arc',
      promptTemplate: 'camera arcs {speed} to the left',
      promptParamDefs: [
        {
          key: 'speed',
          label: 'Speed',
          type: 'select',
          default: 'quickly',
          options: ['quickly', 'slowly'],
        },
      ],
      builtIn: true,
      modified: true,
      params: [],
      defaults: {},
    };
    const presetTracks = createEmptyPresetTrackSet();
    presetTracks.camera.entries.push({
      id: 'video-camera-entry',
      category: 'camera',
      presetId: override.id,
      params: {},
      order: 0,
      enabled: true,
    });
    const node = makeVideoNode({ providerId: 'mock-provider', presetTracks });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'video',
      capabilities: ['text-to-video'],
    });
    deps.resolvePresetCatalog.mockReturnValue([override]);
    compilePromptMock.mockReturnValue({
      prompt: 'compiled video request with project-overridden left arc',
      negativePrompt: undefined,
      referenceImages: [],
      params: {},
      wordCount: 7,
      budget: 100,
      segments: [],
      diagnostics: [],
    });

    const context = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: node.id,
    });

    expect(compilePromptMock).toHaveBeenCalledWith(
      expect.objectContaining({ presetLibrary: [override], presetTracks }),
    );
    expect(deps.promptAssemblyService.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            kind: 'preset',
            content: expect.stringContaining(
              'project-overridden left arc with a restrained finish',
            ),
          }),
        ]),
      }),
    );
    expect(context.requestBase.prompt).toBe(
      'compiled video request with project-overridden left arc',
    );
  });

  it('rejects an unknown active preset before prompt compilation', async () => {
    const presetTracks = createEmptyPresetTrackSet();
    presetTracks.camera.entries.push({
      id: 'missing-camera-entry',
      category: 'camera',
      presetId: 'camera:missing-project-preset',
      params: {},
      order: 0,
      enabled: true,
    });
    const node = makeVideoNode({ providerId: 'mock-provider', presetTracks });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'video',
      capabilities: ['text-to-video'],
    });

    await expect(
      buildGenerationContext(deps as never, {
        canvasId: 'canvas-1',
        nodeId: node.id,
      }),
    ).rejects.toThrow(
      'Node "node-video" references unknown active preset "camera:missing-project-preset"',
    );
    expect(compilePromptMock).not.toHaveBeenCalled();
  });

  it('separates video frame refs from generic entity refs and forwards negativePrompt to the compiler', async () => {
    const firstFrameNode = makeImageNode({ assetHash: 'frame-first-hash' });
    firstFrameNode.id = 'first-frame-node';
    const videoNode = makeVideoNode({
      providerId: 'mock-provider',
      negativePrompt: 'no duplicate people',
      firstFrameNodeId: 'first-frame-node',
      lastFrameAssetHash: 'frame-last-hash',
      characterRefs: [{ characterId: 'char-1', loadoutId: '' }],
      locationRefs: [{ locationId: 'loc-1' }],
    } as Record<string, unknown>);

    const canvas = makeCanvas(
      [videoNode, firstFrameNode],
      [
        {
          id: 'edge-1',
          source: 'first-frame-node',
          target: 'node-video',
          data: { status: 'idle' },
        },
      ],
    );
    const adapter = makeAdapter({
      id: 'mock-provider',
      type: 'video',
      capabilities: ['text-to-video', 'image-to-video'],
    });
    Object.assign(adapter, {
      conditioningCapabilities: {
        referenceImages: {
          maxImages: 2,
          preservesOrder: true,
          canCombineWithFrameImages: true,
        },
        firstFrame: true,
        lastFrame: true,
      },
    });
    const deps = {
      adapterRegistry: makeRegistry(adapter),
      cas: {
        importAsset: vi.fn(async () => ({
          ref: { hash: 'hash-out' },
          meta: {
            hash: 'hash-out',
            type: 'video',
            mimeType: 'video/mp4',
            size: 4,
            duration: 1,
            createdAt: Date.now(),
          },
        })),
        getAssetPath: vi.fn(() => referenceAssetPath),
      },
      db: withEntityRepos({
        insertAsset: vi.fn(),
        getCharacter: vi.fn(() => ({
          id: 'char-1',
          name: 'Alex',
          role: 'protagonist',
          description: 'Detective',
          appearance: 'short brown hair',
          personality: 'stoic',
          costumes: [],
          tags: [],
          referenceImages: [{ slot: 'front', assetHash: 'char-ref-hash', isStandard: true }],
          loadouts: [],
          defaultLoadoutId: '',
          createdAt: 0,
          updatedAt: 0,
        })),
        getEquipment: vi.fn(() => undefined),
        getLocation: vi.fn(() => ({
          id: 'loc-1',
          name: 'Blue Moon Bar',
          description: 'neon bar',
          tags: [],
          referenceImages: [
            { slot: 'wide-establishing', assetHash: 'loc-ref-hash', isStandard: true },
          ],
          createdAt: 0,
          updatedAt: 0,
        })),
      }),
      canvasStore: { get: vi.fn(() => canvas), save: vi.fn() },
      keychain: { getKey: vi.fn(async () => 'secret-key') },
      resolvePresetCatalog: vi.fn(() => []),
      promptAssemblyService: makePromptAssemblyService(),
      llmRegistry: makeLlmRegistry(),
    };

    compilePromptMock.mockReturnValue({
      prompt: 'compiled prompt',
      negativePrompt: 'compiled negative',
      referenceImages: ['char-ref-hash', 'loc-ref-hash'],
      params: {},
      wordCount: 3,
      budget: 100,
      segments: [],
      diagnostics: [],
    });

    const ctx = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-video',
    });

    expect(compilePromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        negativePrompt: 'no duplicate people',
        referenceImages: expect.arrayContaining(['char-ref-hash', 'loc-ref-hash']),
      }),
    );
    expect(ctx.requestBase.referenceImages).toEqual(['char-ref-hash', 'loc-ref-hash']);
    expect(ctx.requestBase.frameReferenceImages).toEqual({
      first: 'frame-first-hash',
      last: 'frame-last-hash',
    });
  });

  it('builds a valid context for an audio (voice) node', async () => {
    const node = makeAudioNode({ providerId: 'mock-provider', audioType: 'voice', duration: 10 });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'voice',
      capabilities: ['text-to-voice'],
    });

    const ctx = await buildGenerationContext(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-audio',
    });

    expect(ctx.nodeType).toBe('audio');
    expect(ctx.generationType).toBe('voice');
    expect(ctx.requestBase.duration).toBe(10);
  });

  it('maps backdrop to generableNodeType "image" inside buildGenerationContext', async () => {
    // backdrop's generableNodeType is 'image', but determineGenerationType returns the
    // audio.audioType fallback (undefined) for non-image/non-video nodes.
    // An adapter that lists 'sfx' type covers the path that resolveAdapter takes.
    const node = makeBackdropNode({ providerId: 'mock-provider' });
    const canvas = makeCanvas([node]);
    const adapter = makeAdapter({
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    const deps = {
      adapterRegistry: {
        get: vi.fn((id: string) => (id === 'mock-provider' ? adapter : undefined)),
        list: vi.fn(() => [adapter]),
      },
      cas: { importAsset: vi.fn(), getAssetPath: vi.fn() },
      db: withEntityRepos({
        insertAsset: vi.fn(),
        getCharacter: vi.fn(() => undefined),
        getEquipment: vi.fn(() => undefined),
        getLocation: vi.fn(() => undefined),
      }),
      canvasStore: { get: vi.fn(() => canvas), save: vi.fn() },
      keychain: { getKey: vi.fn(async () => 'key') },
      resolvePresetCatalog: vi.fn(() => []),
      promptAssemblyService: makePromptAssemblyService(),
      llmRegistry: makeLlmRegistry(),
    };

    const ctx = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-backdrop',
    });

    // generableNodeType (used for prompt compilation and presetTracks logic) is 'image'
    expect(ctx.nodeType).toBe('image');
  });

  it('propagates requestedVariantCount into the context', async () => {
    const node = makeImageNode({ providerId: 'mock-provider' });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });

    const ctx = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
      requestedVariantCount: 3,
    });

    expect(ctx.variantCount).toBe(3);
  });

  it('propagates requestedSeed into the context', async () => {
    const node = makeImageNode({ providerId: 'mock-provider' });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });

    const ctx = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
      requestedSeed: 77777,
    });

    expect(ctx.baseSeed).toBe(77777);
    expect(ctx.requestBase.seed).toBe(77777);
  });

  it('falls back to node.title when prompt is empty', async () => {
    const node = makeImageNode({
      providerId: 'mock-provider',
      prompt: '',
    });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });

    compilePromptMock.mockImplementation((args: { prompt: string }) => ({
      prompt: args.prompt,
      negativePrompt: undefined,
      referenceImages: [],
      params: {},
      wordCount: 3,
      budget: 100,
      segments: [],
      diagnostics: [],
    }));

    const ctx = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
    });

    expect(ctx.requestBase.prompt).toBe('Test Image');
  });

  it('passes sourceImageHash and img2imgStrength into the request for image nodes', async () => {
    const node = makeImageNode({
      providerId: 'mock-provider',
      sourceImageHash: 'src-hash-abc',
      img2imgStrength: 0.75,
    });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image', 'image-to-image'],
    });

    const ctx = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
    });

    expect(ctx.requestBase.sourceImageHash).toBe('src-hash-abc');
    expect(ctx.requestBase.img2imgStrength).toBe(0.75);
    expect(ctx.mode).toBe('image-to-image');
  });

  it('passes emotionVector into the request for audio nodes', async () => {
    const node = makeAudioNode({
      providerId: 'mock-provider',
      audioType: 'voice',
      emotionVector: { valence: 0.8, arousal: 0.6 },
    });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'voice',
      capabilities: ['text-to-voice'],
    });

    const ctx = await buildGenerationContext(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-audio',
    });

    expect(ctx.requestBase.emotionVector).toEqual({ valence: 0.8, arousal: 0.6 });
  });

  it('does not include emotionVector for non-audio nodes', async () => {
    const node = makeImageNode({ providerId: 'mock-provider' });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });

    const ctx = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
    });

    expect(ctx.requestBase.emotionVector).toBeUndefined();
  });

  it('logs compilation diagnostics when present', async () => {
    const node = makeImageNode({ providerId: 'mock-provider' });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });

    compilePromptMock.mockReturnValue({
      prompt: 'compiled',
      negativePrompt: undefined,
      referenceImages: [],
      params: {},
      wordCount: 5,
      budget: 100,
      segments: [],
      diagnostics: [
        {
          severity: 'warning',
          message: 'Too many refs',
          type: 'ref-overflow',
          source: 'characters',
        },
        { severity: 'info', message: 'Preset matched', type: 'preset-match', source: 'look' },
      ],
    });

    await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
    });

    expect(logger.warn).toHaveBeenCalledWith(
      '[prompt] Too many refs',
      expect.objectContaining({ category: 'prompt-compiler' }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[prompt] Preset matched',
      expect.objectContaining({ category: 'prompt-compiler' }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      '[prompt] compilation summary',
      expect.objectContaining({ wordCount: 5 }),
    );
  });

  it('does not log compilation diagnostics when there are none', async () => {
    const node = makeImageNode({ providerId: 'mock-provider' });
    const { deps } = makeDepsWithNode(node, {
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });

    await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
    });

    expect(logger.debug).not.toHaveBeenCalledWith(
      '[prompt] compilation summary',
      expect.anything(),
    );
  });

  it('resolves the override provider when requestedProviderId is specified', async () => {
    const node = makeImageNode({ providerId: 'some-other-provider' });
    const canvas = makeCanvas([node]);
    const adapter = makeAdapter({
      id: 'mock-provider',
      type: 'image',
      capabilities: ['text-to-image'],
    });
    const deps = {
      adapterRegistry: {
        get: vi.fn((id: string) => (id === 'mock-provider' ? adapter : undefined)),
        list: vi.fn(() => [adapter]),
      },
      cas: { importAsset: vi.fn(), getAssetPath: vi.fn() },
      db: withEntityRepos({
        insertAsset: vi.fn(),
        getCharacter: vi.fn(() => undefined),
        getEquipment: vi.fn(() => undefined),
        getLocation: vi.fn(() => undefined),
      }),
      canvasStore: { get: vi.fn(() => canvas), save: vi.fn() },
      keychain: { getKey: vi.fn(async () => 'key') },
      resolvePresetCatalog: vi.fn(() => []),
      promptAssemblyService: makePromptAssemblyService(),
      llmRegistry: makeLlmRegistry(),
    };

    const ctx = await prepareGenerationPromptAssembly(deps as never, {
      canvasId: 'canvas-1',
      nodeId: 'node-image',
      requestedProviderId: 'mock-provider',
    });

    expect(ctx.adapter.id).toBe('mock-provider');
  });
});
