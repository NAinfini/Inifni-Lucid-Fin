import { describe, expect, it, vi } from 'vitest';
import {
  listBuiltinMediaProviders,
  type AIProviderAdapter,
  type CanvasSettings,
  type GenerationRequest,
} from '@lucid-fin/contracts';
import { resolveEffectiveResolutionIntent } from './effective-resolution.js';
import { preflightGenerationResolution, resolveBuiltinResolution } from './resolution-resolver.js';

describe('unified resolution policy', () => {
  it('uses node exact override before Canvas policy', () => {
    const settings: CanvasSettings = {
      resolutionPolicy: { video: { mode: 'tier', tier: '720P' } },
    };
    expect(
      resolveEffectiveResolutionIntent({
        mediaType: 'video',
        canvasSettings: settings,
        nodeData: { width: 1920, height: 1080 },
      }),
    ).toEqual({ intent: { mode: 'exact', width: 1920, height: 1080 }, source: 'node' });
  });

  it('lets an explicit node provider-default bypass Canvas exact pixels', () => {
    expect(
      resolveEffectiveResolutionIntent({
        mediaType: 'image',
        canvasSettings: {
          resolutionPolicy: { image: { mode: 'exact', width: 2048, height: 2048 } },
        },
        nodeData: { resolutionIntent: { mode: 'provider-default' } },
      }),
    ).toEqual({ intent: { mode: 'provider-default' }, source: 'node' });
  });

  it('maps legacy Canvas dimensions lazily and otherwise uses provider default', () => {
    expect(
      resolveEffectiveResolutionIntent({
        mediaType: 'video',
        canvasSettings: { publishVideoResolution: { width: 1280, height: 720 } },
      }),
    ).toEqual({ intent: { mode: 'exact', width: 1280, height: 720 }, source: 'canvas' });
    expect(resolveEffectiveResolutionIntent({ mediaType: 'video' })).toEqual({
      intent: { mode: 'provider-default' },
      source: 'provider',
    });
  });

  it('rejects unsupported exact outputs instead of silently changing them', () => {
    const result = resolveBuiltinResolution(
      'ltx',
      'video',
      { mode: 'exact', width: 1280, height: 720 },
      'canvas',
    );
    expect(result.supported).toBe(false);
  });

  it('estimates only after applying the resolved request and never validates or generates', () => {
    const estimateCost = vi.fn(() => ({
      provider: 'alibaba-wan-video',
      estimatedCost: 0.25,
      currency: 'USD',
      unit: 'video',
    }));
    const adapter = {
      id: 'alibaba-wan-video',
      name: 'Wan',
      type: 'video',
      capabilities: ['text-to-video'],
      maxConcurrent: 1,
      estimateCost,
      validate: vi.fn(),
      generate: vi.fn(),
    } as unknown as AIProviderAdapter;
    const request: GenerationRequest = {
      type: 'video',
      providerId: adapter.id,
      prompt: 'test',
    };

    const result = preflightGenerationResolution({
      adapter,
      request,
      intent: { mode: 'tier', tier: '720P', aspectRatio: '16:9' },
      source: 'canvas',
    });

    expect(result.supported).toBe(true);
    expect(result.request?.params?.resolution).toBe('720P');
    expect(estimateCost).toHaveBeenCalledWith(result.request);
    expect(adapter.validate).not.toHaveBeenCalled();
    expect(adapter.generate).not.toHaveBeenCalled();
  });

  it('can preflight provider-native defaults for every enabled media adapter', () => {
    for (const provider of listBuiltinMediaProviders()) {
      const result = resolveBuiltinResolution(
        provider.adapterId,
        provider.group,
        { mode: 'provider-default' },
        'provider',
      );
      expect(result.supported, `${provider.providerId}/${provider.adapterId}`).toBe(true);
    }
  });
});
