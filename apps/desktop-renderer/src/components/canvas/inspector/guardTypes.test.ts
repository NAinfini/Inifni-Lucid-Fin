import { describe, expect, it } from 'vitest';
import { hasTracks, isGenerationNode } from './guardTypes.js';
import type { CanvasNode } from '@lucid-fin/contracts';

function makeNode(overrides: Partial<CanvasNode>): CanvasNode {
  return {
    id: 'n1',
    type: 'image',
    position: { x: 0, y: 0 },
    data: { status: 'empty', variants: [], selectedVariantIndex: 0 },
    title: '',
    status: 'idle',
    bypassed: false,
    locked: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as CanvasNode;
}

describe('hasTracks', () => {
  it('returns false for undefined', () => {
    expect(hasTracks(undefined)).toBe(false);
  });

  it('returns false for text node', () => {
    const node = makeNode({ type: 'text', data: { content: 'hello' } });
    expect(hasTracks(node)).toBe(false);
  });

  it('returns false for audio node', () => {
    const node = makeNode({
      type: 'audio',
      data: { status: 'empty', audioType: 'voice', variants: [], selectedVariantIndex: 0 },
    });
    expect(hasTracks(node)).toBe(false);
  });

  it('returns false for image node without presetTracks', () => {
    const node = makeNode({ type: 'image' });
    expect(hasTracks(node)).toBe(false);
  });

  it('returns true for image node with presetTracks', () => {
    const node = makeNode({
      type: 'image',
      data: {
        status: 'empty',
        variants: [],
        selectedVariantIndex: 0,
        presetTracks: {
          camera: { category: 'camera', entries: [] },
          lens: { category: 'lens', entries: [] },
          look: { category: 'look', entries: [] },
          scene: { category: 'scene', entries: [] },
          composition: { category: 'composition', entries: [] },
          emotion: { category: 'emotion', entries: [] },
          flow: { category: 'flow', entries: [] },
          technical: { category: 'technical', entries: [] },
        },
      },
    });
    expect(hasTracks(node)).toBe(true);
  });

  it('returns true for video node with presetTracks', () => {
    const node = makeNode({
      type: 'video',
      data: {
        status: 'empty',
        variants: [],
        selectedVariantIndex: 0,
        presetTracks: {
          camera: { category: 'camera', entries: [] },
          lens: { category: 'lens', entries: [] },
          look: { category: 'look', entries: [] },
          scene: { category: 'scene', entries: [] },
          composition: { category: 'composition', entries: [] },
          emotion: { category: 'emotion', entries: [] },
          flow: { category: 'flow', entries: [] },
          technical: { category: 'technical', entries: [] },
        },
      },
    });
    expect(hasTracks(node)).toBe(true);
  });
});

describe('isGenerationNode', () => {
  it('returns false for undefined', () => {
    expect(isGenerationNode(undefined)).toBe(false);
  });

  it('returns false for text node', () => {
    const node = makeNode({ type: 'text', data: { content: '' } });
    expect(isGenerationNode(node)).toBe(false);
  });

  it('returns false for backdrop node', () => {
    const node = makeNode({ type: 'backdrop', data: {} });
    expect(isGenerationNode(node)).toBe(false);
  });

  it('returns true for image node', () => {
    expect(isGenerationNode(makeNode({ type: 'image' }))).toBe(true);
  });

  it('returns true for video node', () => {
    const node = makeNode({
      type: 'video',
      data: { status: 'empty', variants: [], selectedVariantIndex: 0 },
    });
    expect(isGenerationNode(node)).toBe(true);
  });

  it('returns true for audio node', () => {
    const node = makeNode({
      type: 'audio',
      data: { status: 'empty', audioType: 'voice', variants: [], selectedVariantIndex: 0 },
    });
    expect(isGenerationNode(node)).toBe(true);
  });
});
