import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Canvas, GenerationResult } from '@lucid-fin/contracts';
import { BUILT_IN_PRESET_LIBRARY, createEmptyPresetTrackSet, type StyleGuide } from '@lucid-fin/contracts';

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
  canonicalizeCanvasProviderId,
  startCanvasGeneration,
} from './canvas-generation.handlers.js';

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

    expect(result.look.aiDecide).toBe(false);
    expect(result.look.entries).toHaveLength(1);
    expect(result.look.entries[0]?.presetId).toBe('builtin-look-cinematic-realism');
    expect(result.scene.aiDecide).toBe(false);
    expect(result.scene.entries).toHaveLength(1);
    expect(result.scene.entries[0]?.presetId).toBe('scene:low-key');
  });

  it('preserves existing tracks and only fills empty ones', () => {
    const tracks = createEmptyPresetTrackSet();
    tracks.look = {
      category: 'look',
      aiDecide: false,
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

describe('canonicalizeCanvasProviderId', () => {
  it('maps legacy provider ids to the current adapter ids', () => {
    expect(canonicalizeCanvasProviderId('runway')).toBe('runway-gen4');
    expect(canonicalizeCanvasProviderId('veo')).toBe('google-veo-2');
    expect(canonicalizeCanvasProviderId('pika')).toBe('pika-v2');
    expect(canonicalizeCanvasProviderId('openai-image', 'image')).toBe('openai-dalle');
    expect(canonicalizeCanvasProviderId('openai', 'image')).toBe('openai-dalle');
    expect(canonicalizeCanvasProviderId('openai', 'voice')).toBe('openai-tts-1-hd');
    expect(canonicalizeCanvasProviderId('google-image', 'image')).toBe('google-imagen3');
    expect(canonicalizeCanvasProviderId('google-video', 'video')).toBe('google-veo-2');
    expect(canonicalizeCanvasProviderId('recraft', 'image')).toBe('recraft-v3');
    expect(canonicalizeCanvasProviderId('recraft-v4')).toBe('recraft-v3');
    expect(canonicalizeCanvasProviderId('elevenlabs')).toBe('elevenlabs-v2');
    expect(canonicalizeCanvasProviderId('openai-tts', 'voice')).toBe('openai-tts-1-hd');
    expect(canonicalizeCanvasProviderId('cartesia', 'voice')).toBe('cartesia-sonic');
    expect(canonicalizeCanvasProviderId('playht', 'voice')).toBe('playht-3');
    expect(canonicalizeCanvasProviderId('fish-audio', 'voice')).toBe('fish-audio-v1');
  });

  it('passes through already-canonical ids', () => {
    expect(canonicalizeCanvasProviderId('runway-gen4')).toBe('runway-gen4');
    expect(canonicalizeCanvasProviderId('google-veo-2')).toBe('google-veo-2');
    expect(canonicalizeCanvasProviderId('openai-dalle')).toBe('openai-dalle');
    expect(canonicalizeCanvasProviderId(undefined)).toBeUndefined();
  });
});

function makeCanvas(nodeType: 'image' | 'video' | 'audio' = 'image'): Canvas {
  const now = Date.now();
  return {
    id: 'canvas-1',
    projectId: 'project-1',
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
      db: {
        insertAsset: vi.fn(),
        getCharacter: vi.fn(() => undefined),
        getEquipment: vi.fn(() => undefined),
        getLocation: vi.fn(() => undefined),
      },
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

  it('configures registered adapters with aliased keys and runtime provider overrides', async () => {
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
        providerId: 'openai-image',
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
        db: {
          insertAsset: vi.fn(),
          getCharacter: vi.fn(() => undefined),
          getEquipment: vi.fn(() => undefined),
          getLocation: vi.fn(() => undefined),
        },
        canvasStore: {
          get: vi.fn(() => canvas),
          save,
        },
        keychain: {
          getKey: vi.fn(async (provider: string) => (provider === 'openai' ? 'sk-openai' : null)),
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
          db: {
            insertAsset: vi.fn(),
            getCharacter: vi.fn(() => undefined),
            getEquipment: vi.fn(() => undefined),
            getLocation: vi.fn(() => undefined),
          },
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
