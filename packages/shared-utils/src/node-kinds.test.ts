import { describe, it, expect } from 'vitest';
import type { NodeKind } from '@lucid-fin/contracts';
import { matchNode, isGeneratableMedia, isVisualMedia, isMediaNode } from './node-kinds.js';

describe('matchNode', () => {
  it('dispatches each variant', () => {
    const cases: Array<[NodeKind, string]> = [
      ['image', 'I'],
      ['video', 'V'],
      ['audio', 'A'],
      ['text', 'T'],
      ['backdrop', 'B'],
    ];
    for (const [kind, expected] of cases) {
      const result = matchNode(kind, {
        image: () => 'I',
        video: () => 'V',
        audio: () => 'A',
        text: () => 'T',
        backdrop: () => 'B',
      });
      expect(result).toBe(expected);
    }
  });

  it('throws on unknown kind at runtime', () => {
    expect(() =>
      matchNode('alien' as NodeKind, {
        image: () => '',
        video: () => '',
        audio: () => '',
        text: () => '',
        backdrop: () => '',
      }),
    ).toThrow(/matchNode/);
  });
});

describe('isGeneratableMedia', () => {
  it('returns true for generatable kinds', () => {
    expect(isGeneratableMedia('image')).toBe(true);
    expect(isGeneratableMedia('video')).toBe(true);
    expect(isGeneratableMedia('audio')).toBe(true);
  });
  it('returns false for non-generatable kinds', () => {
    expect(isGeneratableMedia('text')).toBe(false);
    expect(isGeneratableMedia('backdrop')).toBe(false);
  });
});

describe('isVisualMedia', () => {
  it('returns true for visual kinds only', () => {
    expect(isVisualMedia('image')).toBe(true);
    expect(isVisualMedia('video')).toBe(true);
    expect(isVisualMedia('audio')).toBe(false);
    expect(isVisualMedia('text')).toBe(false);
  });
});

describe('isMediaNode', () => {
  it('is an alias for isGeneratableMedia', () => {
    expect(isMediaNode).toBe(isGeneratableMedia);
  });
});
