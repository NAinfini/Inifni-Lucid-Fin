import { describe, expect, it, vi } from 'vitest';
import type { CodexRuntime } from './codex-runtime.js';
import { CodexImageGenAdapter } from './codex-imagegen.adapter.js';

describe('Codex image adapter', () => {
  it('declares managed single-flight image capabilities and delegates generation', async () => {
    const runtime = {
      getStatus: vi.fn(() => ({ state: 'ready' })),
      generateImage: vi.fn(async () => ({
        assetHash: '',
        assetPath: 'generated.png',
        provider: 'codex-imagegen',
      })),
      isGenerationActive: vi.fn(() => false),
      cancelGeneration: vi.fn(async () => undefined),
    } as unknown as CodexRuntime;
    const adapter = new CodexImageGenAdapter(runtime);
    const request = {
      type: 'image' as const,
      providerId: adapter.id,
      prompt: 'existing prompt',
    };

    expect(adapter.credentialMode).toBe('oauth');
    expect(adapter.capabilities).toEqual(['text-to-image', 'image-to-image']);
    expect(adapter.conditioningCapabilities.referenceImages).toEqual({
      maxImages: 4,
      preservesOrder: true,
    });
    expect(adapter.maxConcurrent).toBe(1);
    await expect(adapter.generate(request)).resolves.toMatchObject({ provider: adapter.id });
    expect(runtime.generateImage).toHaveBeenCalledWith(request);
    expect(adapter.estimateCost(request)).toMatchObject({
      estimatedCost: 0,
      unit: 'ChatGPT subscription quota',
    });
  });
});
