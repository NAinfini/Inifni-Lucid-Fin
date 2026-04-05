import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Canvas, GenerationResult } from '@lucid-fin/contracts';
import { BUILT_IN_PRESET_LIBRARY, createEmptyPresetTrackSet, type StyleGuide } from '@lucid-fin/contracts';
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
    expect(canonicalizeCanvasProviderId('openai-image')).toBe('openai-dalle');
    expect(canonicalizeCanvasProviderId('recraft-v4')).toBe('recraft-v3');
    expect(canonicalizeCanvasProviderId('elevenlabs')).toBe('elevenlabs-v2');
    expect(canonicalizeCanvasProviderId('openai-tts')).toBe('openai-tts-1-hd');
    expect(canonicalizeCanvasProviderId('fish-audio')).toBe('fish-audio-v1');
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

function makeDeps(canvas: Canvas, adapter: { generate: (req: import('@lucid-fin/contracts').GenerationRequest) => Promise<GenerationResult> } | null) {
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
});

describe('startCanvasGeneration progress events', () => {
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
});
