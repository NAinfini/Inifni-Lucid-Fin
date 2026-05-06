import { describe, expect, it } from 'vitest';
import { estimateCost } from './cost-estimator.js';
import type { CostEstimate } from '@lucid-fin/contracts';

describe('estimateCost', () => {
  it('returns exact confidence for local providers', () => {
    const result = estimateCost('ollama', 'image', { prompt: 'test' });
    expect(result.estimatedCostUsd).toBe(0);
    expect(result.confidence).toBe('exact');
    expect(result.disclaimer).toContain('Local');
  });

  it('returns approximate confidence when adapter provides a cost', () => {
    const adapterEstimate: CostEstimate = {
      provider: 'openai-dalle',
      estimatedCost: 0.04,
      currency: 'USD',
      unit: 'per image',
    };
    const result = estimateCost(
      'openai-dalle',
      'image',
      { prompt: 'a sunset' },
      adapterEstimate,
    );
    expect(result.estimatedCostUsd).toBe(0.04);
    expect(result.confidence).toBe('approximate');
    expect(result.disclaimer).toContain('Estimate only');
  });

  it('falls back to pricing table when adapter returns 0', () => {
    const adapterEstimate: CostEstimate = {
      provider: 'runway',
      estimatedCost: 0,
      currency: 'USD',
      unit: 'per video',
    };
    const result = estimateCost(
      'runway',
      'video',
      { prompt: 'a forest', duration: 10 },
      adapterEstimate,
    );
    expect(result.estimatedCostUsd).toBeCloseTo(0.5);
    expect(result.confidence).toBe('approximate');
  });

  it('computes image cost from pricing table without adapter estimate', () => {
    const result = estimateCost('flux', 'image', { prompt: 'a cat' });
    expect(result.estimatedCostUsd).toBe(0.003);
    expect(result.confidence).toBe('approximate');
  });

  it('computes video cost proportional to duration', () => {
    const result = estimateCost('kling', 'video', { prompt: 'forest walk', duration: 10 });
    expect(result.estimatedCostUsd).toBeCloseTo(0.7);
  });

  it('computes voice cost from character count', () => {
    const result = estimateCost('elevenlabs', 'voice', {
      prompt: 'Hello world, this is a test.',
    });
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
    expect(result.confidence).toBe('approximate');
  });

  it('returns unknown confidence for unrecognized providers', () => {
    const result = estimateCost('some-unknown-provider', 'image', { prompt: 'test' });
    expect(result.estimatedCostUsd).toBe(0);
    expect(result.confidence).toBe('unknown');
    expect(result.disclaimer).toContain('unknown');
  });

  it('handles sfx cost from audio second pricing', () => {
    const result = estimateCost('elevenlabs-sfx', 'sfx', {
      prompt: 'explosion',
      duration: 5,
    });
    expect(result.estimatedCostUsd).toBeCloseTo(0.05);
  });

  it('handles music cost from audio second pricing', () => {
    const result = estimateCost('suno', 'music', {
      prompt: 'ambient track',
      duration: 30,
    });
    expect(result.estimatedCostUsd).toBeCloseTo(0.3);
  });
});
