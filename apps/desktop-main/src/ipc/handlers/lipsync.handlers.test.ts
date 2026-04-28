import { describe, expect, it, vi } from 'vitest';
import type { Canvas, CanvasNode, CanvasEdge } from '@lucid-fin/contracts';

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

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
vi.mock('./lipsync-registry.js', () => ({ getLipSyncAdapter: vi.fn() }));

import { findAudioAssetForVideoNode } from './lipsync.handlers.js';

function makeNode(id: string, type: CanvasNode['type'], data: Record<string, unknown> = {}): CanvasNode {
  return {
    id,
    type,
    title: id,
    position: { x: 0, y: 0 },
    data: { ...data },
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

describe('findAudioAssetForVideoNode', () => {
  it('returns undefined when no edges target the video node', () => {
    const video = makeNode('v1', 'video');
    const canvas = makeCanvas([video], []);
    expect(findAudioAssetForVideoNode(canvas, video)).toBeUndefined();
  });

  it('returns undefined when incoming edge source is not an audio node', () => {
    const video = makeNode('v1', 'video');
    const text = makeNode('t1', 'text', { content: 'hello' });
    const canvas = makeCanvas([video, text], [makeEdge('e1', 't1', 'v1')]);
    expect(findAudioAssetForVideoNode(canvas, video)).toBeUndefined();
  });

  it('returns the assetHash of a single connected audio node', () => {
    const video = makeNode('v1', 'video');
    const audio = makeNode('a1', 'audio', { assetHash: 'audio-hash-1' });
    const canvas = makeCanvas([video, audio], [makeEdge('e1', 'a1', 'v1')]);
    expect(findAudioAssetForVideoNode(canvas, video)).toBe('audio-hash-1');
  });

  it('uses the last-connected audio when multiple audio edges exist', () => {
    const video = makeNode('v1', 'video');
    const audio1 = makeNode('a1', 'audio', { assetHash: 'hash-first' });
    const audio2 = makeNode('a2', 'audio', { assetHash: 'hash-second' });
    const canvas = makeCanvas(
      [video, audio1, audio2],
      [makeEdge('e1', 'a1', 'v1'), makeEdge('e2', 'a2', 'v1')],
    );
    expect(findAudioAssetForVideoNode(canvas, video)).toBe('hash-second');
  });

  it('logs a warning when multiple audio edges exist', () => {
    const video = makeNode('v1', 'video');
    const audio1 = makeNode('a1', 'audio', { assetHash: 'h1' });
    const audio2 = makeNode('a2', 'audio', { assetHash: 'h2' });
    const canvas = makeCanvas(
      [video, audio1, audio2],
      [makeEdge('e1', 'a1', 'v1'), makeEdge('e2', 'a2', 'v1')],
    );
    findAudioAssetForVideoNode(canvas, video);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('multiple audio nodes'),
      expect.objectContaining({ videoNodeId: 'v1', audioNodeIds: ['a1', 'a2'] }),
    );
  });

  it('ignores outgoing edges from the video node', () => {
    const video = makeNode('v1', 'video');
    const audio = makeNode('a1', 'audio', { assetHash: 'hash-out' });
    const canvas = makeCanvas([video, audio], [makeEdge('e1', 'v1', 'a1')]);
    expect(findAudioAssetForVideoNode(canvas, video)).toBeUndefined();
  });
});
