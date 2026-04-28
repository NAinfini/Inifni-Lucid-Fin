import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Canvas, CanvasNode, CanvasEdge, VideoNodeData } from '@lucid-fin/contracts';

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

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    rmSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  rmSync: vi.fn(),
}));

vi.mock('@lucid-fin/media-engine', () => ({
  extractLastFrame: vi.fn(async () => {}),
}));

import fs from 'node:fs';
import { autoChainVideoFrame } from './video-chain.js';

function makeVideoNode(id: string, data: Partial<VideoNodeData> = {}, x = 0): CanvasNode {
  return {
    id,
    type: 'video',
    title: id,
    position: { x, y: 0 },
    data: {
      assetHash: `hash-${id}`,
      variants: [],
      selectedVariantIndex: 0,
      ...data,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as CanvasNode;
}

function makeEdge(id: string, source: string, target: string): CanvasEdge {
  return { id, source, target, type: 'default', data: {} } as CanvasEdge;
}

function makeCanvas(nodes: CanvasNode[], edges: CanvasEdge[]): Canvas {
  return {
    id: 'canvas-1',
    title: 'Test',
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as Canvas;
}

function makeCas() {
  return {
    getAssetPath: vi.fn((_hash: string, _type: string, _ext: string) => '/fake/path.mp4'),
    importAsset: vi.fn(async () => ({
      ref: { hash: 'frame-hash-001' },
      meta: { hash: 'frame-hash-001', type: 'image', size: 100 },
    })),
  } as unknown as Parameters<typeof autoChainVideoFrame>[2];
}

describe('autoChainVideoFrame', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('chains to the next video node via outgoing edge', async () => {
    const v1 = makeVideoNode('v1');
    const v2 = makeVideoNode('v2');
    const canvas = makeCanvas([v1, v2], [makeEdge('e1', 'v1', 'v2')]);
    const cas = makeCas();

    await autoChainVideoFrame(canvas, v1, cas);

    const v2Data = v2.data as VideoNodeData;
    expect(v2Data.firstFrameAssetHash).toBe('frame-hash-001');
  });

  it('does NOT chain via spatial proximity when no edge exists', async () => {
    const v1 = makeVideoNode('v1', {}, 0);
    const v2 = makeVideoNode('v2', {}, 100);
    const canvas = makeCanvas([v1, v2], []);
    const cas = makeCas();

    await autoChainVideoFrame(canvas, v1, cas);

    const v2Data = v2.data as VideoNodeData;
    expect(v2Data.firstFrameAssetHash).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('no next video node found'),
      expect.any(Object),
    );
  });

  it('skips next node if it already has firstFrameAssetHash', async () => {
    const v1 = makeVideoNode('v1');
    const v2 = makeVideoNode('v2', { firstFrameAssetHash: 'existing-frame' });
    const canvas = makeCanvas([v1, v2], [makeEdge('e1', 'v1', 'v2')]);
    const cas = makeCas();

    await autoChainVideoFrame(canvas, v1, cas);

    const v2Data = v2.data as VideoNodeData;
    expect(v2Data.firstFrameAssetHash).toBe('existing-frame');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('already has firstFrameAssetHash'),
      expect.any(Object),
    );
  });

  it('ignores non-video edge targets', async () => {
    const v1 = makeVideoNode('v1');
    const textNode = {
      id: 't1', type: 'text', title: 't1',
      position: { x: 100, y: 0 },
      data: { content: 'text' },
      createdAt: Date.now(), updatedAt: Date.now(),
    } as CanvasNode;
    const canvas = makeCanvas([v1, textNode], [makeEdge('e1', 'v1', 't1')]);
    const cas = makeCas();

    await autoChainVideoFrame(canvas, v1, cas);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('no next video node found'),
      expect.any(Object),
    );
  });

  it('warns and returns early when completed node has no assetHash', async () => {
    const v1 = makeVideoNode('v1', { assetHash: undefined });
    const canvas = makeCanvas([v1], []);
    const cas = makeCas();

    await autoChainVideoFrame(canvas, v1, cas);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no assetHash'),
      expect.any(Object),
    );
  });
});
