import { describe, expect, it, vi } from 'vitest';
import type { AIProviderAdapter, GenerationRequest } from '@lucid-fin/contracts';
import { preflightGenerationPrompt } from './prompt-preflight.js';

function adapter(
  getPromptLimits?: AIProviderAdapter['getPromptLimits'],
): AIProviderAdapter {
  return {
    id: 'prompt-test',
    name: 'Prompt test',
    type: 'video',
    capabilities: ['text-to-video'],
    maxConcurrent: 1,
    configure: () => undefined,
    validate: vi.fn(async () => true),
    generate: vi.fn(),
    estimateCost: vi.fn(() => ({
      provider: 'prompt-test',
      estimatedCost: 0,
      currency: 'USD',
      unit: 'video',
    })),
    checkStatus: vi.fn(),
    cancel: vi.fn(),
    ...(getPromptLimits ? { getPromptLimits } : {}),
  };
}

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'video',
    providerId: 'prompt-test',
    prompt: 'A steady tracking shot',
    ...overrides,
  };
}

describe('generation prompt preflight', () => {
  it('returns bounded character diagnostics without calling the provider', () => {
    const provider = adapter(() => ({
      maxPromptChars: 100,
      maxNegativePromptChars: 20,
      negativePrompt: 'native',
    }));

    expect(
      preflightGenerationPrompt(provider, request({ negativePrompt: 'no flicker' })),
    ).toMatchObject({
      promptChars: 22,
      negativePromptChars: 10,
      limits: { maxPromptChars: 100, maxNegativePromptChars: 20 },
    });
    expect(provider.validate).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
    expect(provider.estimateCost).not.toHaveBeenCalled();
  });

  it('rejects oversized positive and negative prompts without truncating them', () => {
    const provider = adapter(() => ({
      maxPromptChars: 5,
      maxNegativePromptChars: 3,
      negativePrompt: 'native',
    }));

    expect(() => preflightGenerationPrompt(provider, request({ prompt: '123456' }))).toThrow(
      /at most 5 prompt characters; received 6/,
    );
    expect(() =>
      preflightGenerationPrompt(provider, request({ prompt: '12345', negativePrompt: '1234' })),
    ).toThrow(/at most 3 negative-prompt characters; received 4/);
  });

  it('rejects a negative prompt when the adapter explicitly cannot transport it', () => {
    const provider = adapter(() => ({
      maxPromptChars: 100,
      negativePrompt: 'unsupported',
    }));

    expect(() =>
      preflightGenerationPrompt(provider, request({ negativePrompt: 'no identity drift' })),
    ).toThrow(/does not support a separate negative prompt/);
  });
});
