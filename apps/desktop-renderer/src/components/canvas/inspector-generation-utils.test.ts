import { describe, expect, it } from 'vitest';
import {
  createRandomSeed,
  getDefaultResolution,
  getResolutionPresetValue,
  resolveSeedRequest,
} from './inspector-generation-utils.js';

describe('inspector generation utils', () => {
  it('returns per-node default resolutions', () => {
    expect(getDefaultResolution('image')).toEqual({ width: 1024, height: 1024 });
    expect(getDefaultResolution('video')).toEqual({ width: 1280, height: 720 });
  });

  it('matches known presets and falls back to custom for unknown sizes', () => {
    expect(getResolutionPresetValue('image', 1024, 1024)).toBe('square-1024');
    expect(getResolutionPresetValue('video', 1920, 1080)).toBe('landscape-1080');
    expect(getResolutionPresetValue('video', 1000, 1000)).toBe('custom');
  });

  it('keeps locked seeds stable and backfills missing locked seeds', () => {
    expect(resolveSeedRequest({ seed: 77, seedLocked: true, randomSeed: 999 })).toEqual({
      requestSeed: 77,
      persistImmediately: undefined,
      persistAfterCompletion: undefined,
    });

    expect(resolveSeedRequest({ seed: undefined, seedLocked: true, randomSeed: 321 })).toEqual({
      requestSeed: 321,
      persistImmediately: 321,
      persistAfterCompletion: undefined,
    });
  });

  it('uses a fresh seed for unlocked runs and persists it after completion', () => {
    expect(resolveSeedRequest({ seed: 77, seedLocked: false, randomSeed: 654 })).toEqual({
      requestSeed: 654,
      persistImmediately: undefined,
      persistAfterCompletion: 654,
    });
  });

  it('creates positive integer random seeds', () => {
    expect(createRandomSeed(() => 0)).toBe(1);
    expect(createRandomSeed(() => 0.5)).toBeGreaterThan(0);
  });
});
