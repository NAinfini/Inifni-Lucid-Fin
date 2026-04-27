import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Canvas, GenerationResult } from '@lucid-fin/contracts';
import { BUILT_IN_PRESET_LIBRARY, createEmptyPresetTrackSet, type StyleGuide } from '@lucid-fin/contracts';
import { CAS } from '../../../../../packages/storage/src/cas.js';

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

import {
  applyStyleGuideDefaultsToEmptyTracks,
  startCanvasGeneration,
} from './canvas-generation.handlers.js';
import { mergeGenerationParams } from './generation-context.js';
import { buildAdhocAdapter } from './generation-helpers.js';

/**
 * Wrap a flat db mock into the `.repos.{entities,assets}` shape expected by
 * handlers migrated in Phase G1-4.7 / G1-4.8. The same spies remain reachable
 * via both the legacy flat keys AND via `db.repos.*`, so existing tests that
 * read/write the flat spies keep working.
 */
function withEntityRepos<T extends Record<string, unknown>>(flat: T): T & {
  repos: { entities: Record<string, unknown>; assets: Record<string, unknown> };
} {
  const insertAsset = flat.insertAsset as ReturnType<typeof vi.fn> | undefined;
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
      assets: {
        insert: insertAsset ?? vi.fn(),
        delete: vi.fn(),
        query: vi.fn(() => ({ rows: [] })),
        search: vi.fn(() => ({ rows: [] })),
        repairSizes: vi.fn().mockReturnValue(0),
        insertEmbedding: vi.fn(),
        queryEmbeddingByHash: vi.fn(),
        searchByTokens: vi.fn(() => []),
        getAllEmbeddedHashes: vi.fn(() => []),
      },
    },
  };
}

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

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pZ+j9QAAAAASUVORK5CYII=',
  'base64',
);

describe('applyStyleGuideDefaultsToEmptyTracks', () => {
  it('fills empty look and scene tracks from style guide defaults', () => {
    const tracks = createEmptyPresetTrackSet();

    const result = applyStyleGuideDefaultsToEmptyTracks(
      tracks,
      makeStyleGuide({
        artStyle: 'cinematic realism',
        lighting: 'dramatic',
      }),
      BUILT_IN_PRESET_LIBRARY,
    );

    expect(result.look.entries).toHaveLength(1);
    expect(result.look.entries[0]?.presetId).toBe('builtin-look-cinematic-realism');
    expect(result.scene.entries).toHaveLength(1);
    expect(result.scene.entries[0]?.presetId).toBe('scene:low-key');
  });

  it('preserves existing tracks and only fills empty ones', () => {
    const tracks = createEmptyPresetTrackSet();
    tracks.look = {
      category: 'look',
      entries: [
        {
          id: 'existing-look',
          category: 'look',
          presetId: 'look:anime-cel',
          params: {},
          order: 0,
        },
      ],
    };

    const result = applyStyleGuideDefaultsToEmptyTracks(
      tracks,
      makeStyleGuide({
        artStyle: 'cinematic realism',
        lighting: 'neon',
      }),
      BUILT_IN_PRESET_LIBRARY,
    );

    expect(result.look.entries).toHaveLength(1);
    expect(result.look.entries[0]?.presetId).toBe('look:anime-cel');
    expect(result.scene.entries[0]?.presetId).toBe('scene:neon-noir');
  });
});

describe('mergeGenerationParams', () => {
  it('merges explicit fps into base params', () => {
    expect(
      mergeGenerationParams(
        { seedBehavior: 'locked' },
        60,
      ),
    ).toEqual({
      seedBehavior: 'locked',
      fps: 60,
    });
  });

  it('returns base params unchanged when fps is undefined', () => {
    expect(
      mergeGenerationParams(
        {
          audio: { voice: 'nova' },
          quality: 'medium',
        },
        undefined,
      ),
    ).toEqual({
      audio: { voice: 'nova' },
      quality: 'medium',
    });
  });
});

function makeCanvas(nodeType: 'image' | 'video' | 'audio' = 'image'): Canvas {
  const now = Date.now();
  return {
    id: 'canvas-1',
    name: 'Test Canvas',
    nodes: [
      {
        id: 'node-1',
        type: nodeType,
        position: { x: 0, y: 0 },
        data:
          nodeType === 'audio'
            ? {
                status: 'empty',
                audioType: 'voice',
                variants: [],
                selectedVariantIndex: 0,
                variantCount: 1,
                seedLocked: false,
              }
            : {
                status: 'empty',
                variants: [],
                selectedVariantIndex: 0,
                variantCount: 1,
                seedLocked: false,
                ...(nodeType === 'image' ? { presetTracks: createEmptyPresetTrackSet() } : {}),
                ...(nodeType === 'video' ? { duration: 5, presetTracks: createEmptyPresetTrackSet() } : {}),
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
}

function makeDeps(
  canvas: Canvas,
  adapter:
    | {
        generate: (req: import('@lucid-fin/contracts').GenerationRequest) => Promise<GenerationResult>;
        subscribe?: import('@lucid-fin/contracts').AIProviderAdapter['subscribe'];
      }
    | null,
) {
  const save = vi.fn();
  return {
    deps: {
      adapterRegistry: {
        get: vi.fn((id: string) => (adapter && id === 'mock-provider' ? {
          id: 'mock-provider',
          name: 'Mock Provider',
          type: canvas.nodes[0]?.type === 'video' ? 'video' : canvas.nodes[0]?.type === 'audio' ? 'voice' : 'image',
          capabilities: [canvas.nodes[0]?.type === 'video' ? 'text-to-video' : canvas.nodes[0]?.type === 'audio' ? 'text-to-voice' : 'text-to-image'],
          maxConcurrent: 1,
          configure: vi.fn(),
          validate: vi.fn(async () => true),
          generate: adapter.generate,
          subscribe: adapter.subscribe,
          estimateCost: vi.fn(() => ({ estimatedCost: 0, currency: 'USD', provider: 'mock-provider', unit: 'image' })),
          checkStatus: vi.fn(async () => 'completed'),
          cancel: vi.fn(async () => undefined),
        } : undefined)),
        list: vi.fn(() => (adapter ? [{
          id: 'mock-provider',
          name: 'Mock Provider',
          type: canvas.nodes[0]?.type === 'video' ? 'video' : canvas.nodes[0]?.type === 'audio' ? 'voice' : 'image',
          capabilities: [canvas.nodes[0]?.type === 'video' ? 'text-to-video' : canvas.nodes[0]?.type === 'audio' ? 'text-to-voice' : 'text-to-image'],
          maxConcurrent: 1,
          configure: vi.fn(),
          validate: vi.fn(async () => true),
          generate: adapter.generate,
          subscribe: adapter.subscribe,
          estimateCost: vi.fn(() => ({ estimatedCost: 0, currency: 'USD', provider: 'mock-provider', unit: 'image' })),
          checkStatus: vi.fn(async () => 'completed'),
          cancel: vi.fn(async () => undefined),
        }] : [])),
      },
      cas: {
        importAsset: vi.fn(async () => ({
          ref: { hash: `hash-${Math.random().toString(36).slice(2, 8)}` },
          meta: {
            hash: 'unused',
            type: 'image',
            mimeType: 'image/png',
            size: 4,
            width: 1,
            height: 1,
            duration: undefined,
            createdAt: Date.now(),
          },
        })),
      },
      db: withEntityRepos({
        insertAsset: vi.fn(),
        getCharacter: vi.fn(() => undefined),
        getEquipment: vi.fn(() => undefined),
        getLocation: vi.fn(() => undefined),
      }),
      canvasStore: {
        get: vi.fn(() => canvas),
        save,
      },
      keychain: {
        getKey: vi.fn(async () => 'secret-key'),
      },
    },
    save,
  };
}

function createSender() {
  const events: Array<{ channel: string; payload: unknown }> = [];
  let resolveDone: (() => void) | undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  return {
    events,
    done,
    sender: {
      send(channel: string, payload: unknown) {
        events.push({ channel, payload });
        if (channel === 'canvas:generation:complete' || channel === 'canvas:generation:failed') {
          resolveDone?.();
        }
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('startCanvasGeneration progress events', () => {
  it('prefers adapter subscribe callbacks when the adapter supports realtime updates', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-canvas-subscribe-'));
    const assetPath = path.join(tmpDir, 'subscribed.png');
    fs.writeFileSync(assetPath, Buffer.from([1, 2, 3, 4]));

    const canvas = makeCanvas('image');
    const adapter = {
      generate: vi.fn(async () => {
        throw new Error('generate should not be used when subscribe exists');
      }),
      subscribe: vi.fn(async (_request, callbacks) => {
        callbacks.onQueueUpdate?.({
          status: 'processing',
          jobId: 'provider-job-1',
        });
        callbacks.onProgress?.({
          type: 'progress',
          percentage: 60,
          currentStep: 'rendering',
          jobId: 'provider-job-1',
        });

        return {
          assetHash: '',
          assetPath,
          provider: 'mock-provider',
          metadata: {
            taskId: 'provider-job-1',
          },
        };
      }),
    };
    const { deps } = makeDeps(canvas, adapter);
    const { sender, events, done } = createSender();

    await startCanvasGeneration(
      sender,
      {
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        providerId: 'mock-provider',
        variantCount: 1,
      },
      deps as never,
    );

    await done;

    expect(adapter.subscribe).toHaveBeenCalledOnce();
    const progressEvents = events.filter((event) => event.channel === 'canvas:generation:progress');
    expect(progressEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            currentStep: 'rendering',
          }),
        }),
      ]),
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits variant-by-variant progress updates for built-in adapters', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-canvas-gen-'));
    const assetPath = path.join(tmpDir, 'built-in.png');
    fs.writeFileSync(assetPath, Buffer.from([1, 2, 3, 4]));

    const canvas = makeCanvas('image');
    const adapter = {
      generate: vi.fn(async () => ({
        assetHash: '',
        assetPath,
        provider: 'mock-provider',
      })),
    };
    const { deps } = makeDeps(canvas, adapter);
    const { sender, events, done } = createSender();

    await startCanvasGeneration(sender, {
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      providerId: 'mock-provider',
      variantCount: 2,
    }, deps as never);

    await done;

    expect(logger.info).toHaveBeenCalledWith(
      'Canvas generation requested',
      expect.objectContaining({
        category: 'canvas-generation',
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        providerId: 'mock-provider',
        generationType: 'image',
        variantCount: 2,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Canvas generation completed',
      expect.objectContaining({
        category: 'canvas-generation',
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        providerId: 'mock-provider',
        generatedAssetCount: 2,
      }),
    );

    const progressEvents = events.filter((event) => event.channel === 'canvas:generation:progress');
    expect(progressEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            currentStep: 'Generating variant 1',
          }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({
            currentStep: 'Generating variant 2',
          }),
        }),
      ]),
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes node media options through to the generation request', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-canvas-video-'));
    const assetPath = path.join(tmpDir, 'video.mp4');
    fs.writeFileSync(assetPath, Buffer.from([1, 2, 3, 4]));

    const canvas = makeCanvas('video');
    const node = canvas.nodes[0];
    if (!node || node.type !== 'video') {
      throw new Error('expected video node');
    }
    Object.assign(node.data, {
      width: 1920,
      height: 1080,
      duration: 8,
      fps: 60,
      seed: 123456,
    });

    const adapter = {
      generate: vi.fn(async () => ({
        assetHash: '',
        assetPath,
        provider: 'mock-provider',
      })),
    };
    const { deps } = makeDeps(canvas, adapter);
    const { sender, done } = createSender();

    await startCanvasGeneration(
      sender,
      {
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        providerId: 'mock-provider',
        variantCount: 1,
      },
      deps as never,
    );

    await done;

    expect(adapter.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 1920,
        height: 1080,
        duration: 8,
        seed: 123456,
        params: expect.objectContaining({
          fps: 60,
        }),
      }),
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('compiles entity context into image prompts and attaches entity reference images', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-canvas-image-entity-'));
    const assetPath = path.join(tmpDir, 'image.png');
    const charRefPath = path.join(tmpDir, 'char-ref.png');
    const locRefPath = path.join(tmpDir, 'loc-ref.png');
    fs.writeFileSync(assetPath, Buffer.from([1, 2, 3, 4]));
    fs.writeFileSync(charRefPath, Buffer.from([5, 6, 7, 8]));
    fs.writeFileSync(locRefPath, Buffer.from([9, 10, 11, 12]));

    const now = Date.now();
    const canvas: Canvas = {
      id: 'canvas-1',
      name: 'Test Canvas',
      nodes: [
        {
          id: 'node-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: {
            status: 'empty',
            prompt: 'hero at the bar',
            negativePrompt: 'no crowd',
            variants: [],
            selectedVariantIndex: 0,
            variantCount: 1,
            seedLocked: false,
            presetTracks: createEmptyPresetTrackSet(),
            characterRefs: [{ characterId: 'char-1', loadoutId: '' }],
            locationRefs: [{ locationId: 'loc-1' }],
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

    const generate = vi.fn(async () => ({
      assetHash: '',
      assetPath,
      provider: 'mock-provider',
    }));
    const save = vi.fn();
    const { sender, done } = createSender();

    await startCanvasGeneration(
      sender,
      {
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        providerId: 'mock-provider',
        variantCount: 1,
      },
      {
        adapterRegistry: {
          get: vi.fn(() => ({
            id: 'mock-provider',
            name: 'Mock Provider',
            type: 'image',
            capabilities: ['text-to-image'],
            maxConcurrent: 1,
            configure: vi.fn(),
            validate: vi.fn(async () => true),
            generate,
            estimateCost: vi.fn(() => ({
              estimatedCost: 0,
              currency: 'USD',
              provider: 'mock-provider',
              unit: 'image',
            })),
            checkStatus: vi.fn(async () => 'completed'),
            cancel: vi.fn(async () => undefined),
          })),
          list: vi.fn(() => []),
        },
        cas: {
          importAsset: vi.fn(async () => ({
            ref: { hash: 'hash-image-entity' },
            meta: {
              hash: 'hash-image-entity',
              type: 'image',
              mimeType: 'image/png',
              size: 4,
              width: 1,
              height: 1,
              duration: undefined,
              createdAt: Date.now(),
            },
          })),
          getAssetPath: vi.fn((hash: string, _type: string, ext: string) => {
            if (hash === 'char-ref-hash' && ext === 'png') return charRefPath;
            if (hash === 'loc-ref-hash' && ext === 'png') return locRefPath;
            return path.join(tmpDir, `${hash}.${ext}`);
          }),
        },
        db: withEntityRepos({
          insertAsset: vi.fn(),
          getCharacter: vi.fn(() => ({
            id: 'char-1',
            name: 'Alex',
            role: 'protagonist',
            description: 'A grizzled detective',
            appearance: 'Tall with sharp jawline. Short brown hair. Scar on left cheek.',
            personality: 'Stoic',
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
            name: 'The Blue Moon Bar',
            description: 'A dimly lit dive bar with neon signs',
            timeOfDay: 'night',
            mood: 'tense',
            lighting: 'neon, dim',
            tags: [],
            referenceImages: [{ slot: 'wide-establishing', assetHash: 'loc-ref-hash', isStandard: true }],
            createdAt: 0,
            updatedAt: 0,
          })),
        }),
        canvasStore: {
          get: vi.fn(() => canvas),
          save,
        },
        keychain: {
          getKey: vi.fn(async () => 'secret-key'),
        },
      } as never,
    );

    await done;

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Alex'),
        negativePrompt: expect.stringContaining('no crowd'),
        referenceImages: [charRefPath, locRefPath],
      }),
    );
    expect(generate.mock.calls[0]?.[0]?.prompt).toContain('The Blue Moon Bar');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes ordered first and last frame slot images to video generation requests', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-canvas-video-frames-'));
    const assetPath = path.join(tmpDir, 'video.mp4');
    fs.writeFileSync(assetPath, Buffer.from([1, 2, 3, 4]));
    // Create dummy reference image files for CAS resolution
    const firstFramePath = path.join(tmpDir, 'connected-first-frame.png');
    const lastFramePath = path.join(tmpDir, 'uploaded-last-frame.png');
    fs.writeFileSync(firstFramePath, Buffer.from([5, 6, 7, 8]));
    fs.writeFileSync(lastFramePath, Buffer.from([9, 10, 11, 12]));

    const now = Date.now();
    const canvas: Canvas = {
      id: 'canvas-1',
      name: 'Test Canvas',
      nodes: [
        {
          id: 'node-1',
          type: 'video',
          position: { x: 140, y: 0 },
          data: {
            status: 'empty',
            duration: 5,
            fps: 24,
            variants: [],
            selectedVariantIndex: 0,
            variantCount: 1,
            seedLocked: false,
            presetTracks: createEmptyPresetTrackSet(),
            firstFrameNodeId: 'first-image',
            lastFrameAssetHash: 'uploaded-last-frame',
          },
          title: 'Hero Shot',
          status: 'idle',
          bypassed: false,
          locked: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'first-image',
          type: 'image',
          position: { x: 0, y: 0 },
          data: {
            status: 'done',
            assetHash: 'connected-first-frame',
            variants: ['connected-first-frame'],
            selectedVariantIndex: 0,
            variantCount: 1,
            seedLocked: false,
            presetTracks: createEmptyPresetTrackSet(),
          },
          title: 'First Image',
          status: 'done',
          bypassed: false,
          locked: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'first-image',
          target: 'node-1',
          data: { status: 'idle' },
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: now,
      updatedAt: now,
    };

    const generate = vi.fn(async () => ({
      assetHash: '',
      assetPath,
      provider: 'mock-provider',
    }));
    const save = vi.fn();
    const { sender, done } = createSender();

    await startCanvasGeneration(
      sender,
      {
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        providerId: 'mock-provider',
        variantCount: 1,
      },
      {
        adapterRegistry: {
          get: vi.fn(() => ({
            id: 'mock-provider',
            name: 'Mock Provider',
            type: 'video',
            capabilities: ['text-to-video', 'image-to-video'],
            maxConcurrent: 1,
            configure: vi.fn(),
            validate: vi.fn(async () => true),
            generate,
            estimateCost: vi.fn(() => ({
              estimatedCost: 0,
              currency: 'USD',
              provider: 'mock-provider',
              unit: 'video',
            })),
            checkStatus: vi.fn(async () => 'completed'),
            cancel: vi.fn(async () => undefined),
          })),
          list: vi.fn(() => []),
        },
        cas: {
          importAsset: vi.fn(async () => ({
            ref: { hash: 'hash-video-frames' },
            meta: {
              hash: 'hash-video-frames',
              type: 'video',
              mimeType: 'video/mp4',
              size: 4,
              duration: 1,
              createdAt: Date.now(),
            },
          })),
          getAssetPath: vi.fn((hash: string, _type: string, ext: string) => {
            if (hash === 'connected-first-frame') return firstFramePath;
            if (hash === 'uploaded-last-frame') return lastFramePath;
            return path.join(tmpDir, `${hash}.${ext}`);
          }),
        },
        db: withEntityRepos({
          insertAsset: vi.fn(),
          getCharacter: vi.fn(() => undefined),
          getEquipment: vi.fn(() => undefined),
          getLocation: vi.fn(() => undefined),
        }),
        canvasStore: {
          get: vi.fn(() => canvas),
          save,
        },
        keychain: {
          getKey: vi.fn(async () => 'secret-key'),
        },
      } as never,
    );

    await done;

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        frameReferenceImages: {
          first: firstFramePath,
          last: lastFramePath,
        },
      }),
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits polling progress updates for ad-hoc async providers', async () => {
    vi.useFakeTimers();

    const canvas = makeCanvas('image');
    const { deps } = makeDeps(canvas, null);
    const { sender, events, done } = createSender();
    const base64Png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pZ+j9QAAAAASUVORK5CYII=';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'task-1', status_url: 'https://provider.example/tasks/task-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'processing', progress: 35 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'completed', output: base64Png }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await startCanvasGeneration(sender, {
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      providerId: 'adhoc-provider',
      variantCount: 1,
      providerConfig: {
        baseUrl: 'https://provider.example/generate',
        model: 'demo-model',
        apiKey: 'secret-key',
      },
    }, deps as never);

    await vi.advanceTimersByTimeAsync(10000);
    await done;

    const progressEvents = events.filter((event) => event.channel === 'canvas:generation:progress');
    expect(progressEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            currentStep: expect.stringContaining('processing'),
          }),
        }),
      ]),
    );

    vi.useRealTimers();
  });

  it('maps sora-style image-to-video requests for ad-hoc video providers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: 'https://example.com/video.mp4',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const adapter = await buildAdhocAdapter(
        'adhoc-video',
        {
          baseUrl: 'https://provider.example/generate',
          model: 'openai/sora-2',
          apiKey: 'sk-demo',
        },
        {
          getKey: vi.fn(async () => null),
        } as never,
        'video',
      );

      await adapter.generate({
        type: 'video',
        providerId: 'adhoc-video',
        prompt: 'A dramatic close-up',
        referenceImages: ['https://example.com/reference.png'],
        duration: 5,
      });

      expect(adapter.capabilities).toContain('image-to-video');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://provider.example/generate',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"input_reference":"https://example.com/reference.png"'),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('configures registered adapters with runtime provider overrides', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-canvas-provider-config-'));
    const assetPath = path.join(tmpDir, 'configured.png');
    fs.writeFileSync(assetPath, Buffer.from([1, 2, 3, 4]));

    const canvas = makeCanvas('image');
    const configure = vi.fn();
    const generate = vi.fn(async () => ({
      assetHash: '',
      assetPath,
      provider: 'openai-dalle',
    }));
    const adapter = {
      id: 'openai-dalle',
      name: 'OpenAI Image',
      type: 'image',
      capabilities: ['text-to-image'],
      maxConcurrent: 1,
      configure,
      validate: vi.fn(async () => true),
      generate,
      estimateCost: vi.fn(() => ({
        estimatedCost: 0,
        currency: 'USD',
        provider: 'openai-dalle',
        unit: 'image',
      })),
      checkStatus: vi.fn(async () => 'completed'),
      cancel: vi.fn(async () => undefined),
    };
    const save = vi.fn();
    const { sender, done } = createSender();

    await startCanvasGeneration(
      sender,
      {
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        providerId: 'openai-dalle',
        providerConfig: {
          baseUrl: 'https://proxy.example/v1',
          model: 'gpt-image-1',
        },
        variantCount: 1,
      },
      {
        adapterRegistry: {
          get: vi.fn((id: string) => (id === 'openai-dalle' ? adapter : undefined)),
          list: vi.fn(() => [adapter]),
        },
        cas: {
          importAsset: vi.fn(async () => ({
            ref: { hash: 'hash-configured' },
            meta: {
              hash: 'hash-configured',
              type: 'image',
              mimeType: 'image/png',
              size: 4,
              width: 1,
              height: 1,
              duration: undefined,
              createdAt: Date.now(),
            },
          })),
        },
        db: withEntityRepos({
          insertAsset: vi.fn(),
          getCharacter: vi.fn(() => undefined),
          getEquipment: vi.fn(() => undefined),
          getLocation: vi.fn(() => undefined),
        }),
        canvasStore: {
          get: vi.fn(() => canvas),
          save,
        },
        keychain: {
          getKey: vi.fn(async (provider: string) => (provider === 'openai-dalle' ? 'sk-openai' : null)),
        },
      } as never,
    );

    await done;

    expect(configure).toHaveBeenCalledWith(
      'sk-openai',
      expect.objectContaining({
        baseUrl: 'https://proxy.example/v1',
        model: 'gpt-image-1',
      }),
    );
    expect(generate).toHaveBeenCalled();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('falls back to the ad-hoc adapter when a registered provider id does not support the requested media type', async () => {
    const canvas = makeCanvas('audio');
    const save = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        audio_url: 'data:audio/mpeg;base64,SUQz',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const incompatibleReplicateAdapter = {
      id: 'replicate',
      name: 'Replicate',
      type: ['image', 'video'],
      capabilities: ['text-to-image', 'text-to-video'],
      maxConcurrent: 1,
      configure: vi.fn(),
      validate: vi.fn(async () => true),
      generate: vi.fn(async () => {
        throw new Error('registered replicate adapter should be bypassed for audio');
      }),
      estimateCost: vi.fn(() => ({
        estimatedCost: 0.01,
        currency: 'USD',
        provider: 'replicate',
        unit: 'per generation',
      })),
      checkStatus: vi.fn(async () => 'completed'),
      cancel: vi.fn(async () => undefined),
    };
    const { sender, done } = createSender();

    try {
      await startCanvasGeneration(
        sender,
        {
          canvasId: 'canvas-1',
          nodeId: 'node-1',
          providerId: 'replicate',
          providerConfig: {
            baseUrl: 'https://proxy.example/audio',
            model: 'suno-ai/bark',
          },
          variantCount: 1,
        },
        {
          adapterRegistry: {
            get: vi.fn((id: string) => (id === 'replicate' ? incompatibleReplicateAdapter : undefined)),
            list: vi.fn(() => [incompatibleReplicateAdapter]),
          },
          cas: {
            importAsset: vi.fn(async () => ({
              ref: { hash: 'hash-audio' },
              meta: {
                hash: 'hash-audio',
                type: 'audio',
                mimeType: 'audio/mpeg',
                size: 3,
                duration: 1,
                createdAt: Date.now(),
              },
            })),
          },
          db: withEntityRepos({
            insertAsset: vi.fn(),
            getCharacter: vi.fn(() => undefined),
            getEquipment: vi.fn(() => undefined),
            getLocation: vi.fn(() => undefined),
          }),
          canvasStore: {
            get: vi.fn(() => canvas),
            save,
          },
          keychain: {
            getKey: vi.fn(async (provider: string) => (provider === 'replicate' ? 'sk-replicate' : null)),
          },
        } as never,
      );

      await done;

      expect(fetchMock).toHaveBeenCalledWith(
        'https://proxy.example/audio',
        expect.objectContaining({
          method: 'POST',
        }),
      );
      expect(incompatibleReplicateAdapter.generate).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        '[canvas:generation] registered adapter incompatible with requested media type, falling back to ad-hoc provider config',
        expect.objectContaining({
          category: 'canvas-generation',
          requestedProviderId: 'replicate',
          canonicalProviderId: 'replicate',
          adapterId: 'replicate',
          generationType: 'voice',
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails video generation when the provider returns an image asset', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-canvas-video-mismatch-'));
    const assetPath = path.join(tmpDir, 'returned-image.png');
    fs.writeFileSync(assetPath, ONE_PIXEL_PNG);

    const canvas = makeCanvas('video');
    const save = vi.fn();
    const db = withEntityRepos({
      insertAsset: vi.fn(),
      getCharacter: vi.fn(() => undefined),
      getEquipment: vi.fn(() => undefined),
      getLocation: vi.fn(() => undefined),
    });
    const { sender, events, done } = createSender();

    await startCanvasGeneration(
      sender,
      {
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        providerId: 'mock-provider',
        variantCount: 1,
      },
      {
        adapterRegistry: {
          get: vi.fn(() => ({
            id: 'mock-provider',
            name: 'Mock Provider',
            type: 'video',
            capabilities: ['text-to-video'],
            maxConcurrent: 1,
            configure: vi.fn(),
            validate: vi.fn(async () => true),
            generate: vi.fn(async (): Promise<GenerationResult> => ({
              assetHash: '',
              assetPath,
              provider: 'mock-provider',
            })),
            estimateCost: vi.fn(() => ({
              estimatedCost: 0,
              currency: 'USD',
              provider: 'mock-provider',
              unit: 'video',
            })),
            checkStatus: vi.fn(async () => 'completed'),
            cancel: vi.fn(async () => undefined),
          })),
          list: vi.fn(() => []),
        },
        cas: new CAS(path.join(tmpDir, 'assets')),
        db,
        canvasStore: {
          get: vi.fn(() => canvas),
          save,
        },
        keychain: {
          getKey: vi.fn(async () => 'secret-key'),
        },
      } as never,
    );

    await done;

    expect(db.insertAsset).not.toHaveBeenCalled();
    expect(canvas.nodes[0]?.status).toBe('failed');
    expect((canvas.nodes[0]?.data as { error?: string }).error).toMatch(/expected video asset/i);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'canvas:generation:failed',
          payload: expect.objectContaining({
            canvasId: 'canvas-1',
            nodeId: 'node-1',
            error: expect.stringMatching(/expected video asset/i),
          }),
        }),
      ]),
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('logs structured failure details when generation fails', async () => {
    const canvas = makeCanvas('image');
    const adapter = {
      generate: vi.fn(async () => {
        throw new Error('provider exploded');
      }),
    };
    const { deps } = makeDeps(canvas, adapter);
    const { sender, done } = createSender();

    await startCanvasGeneration(sender, {
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      providerId: 'mock-provider',
      variantCount: 1,
    }, deps as never);

    await done;

    expect(logger.error).toHaveBeenCalledWith(
      'Canvas generation failed',
      expect.objectContaining({
        category: 'canvas-generation',
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        providerId: 'mock-provider',
        generationType: 'image',
        error: 'provider exploded',
      }),
    );
  });
});
