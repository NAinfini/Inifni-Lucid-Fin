import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type { AIProviderAdapter, GenerationRequest } from '@lucid-fin/contracts';
import { CAS } from '@lucid-fin/storage';
import { makeGenerateImage } from './commander-image-gen.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('makeGenerateImage', () => {
  const roots: string[] = [];

  function setup(estimatedCost: number, reportedCost?: number) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-image-gen-'));
    roots.push(root);
    const generatedPath = path.join(root, 'generated.png');
    fs.writeFileSync(generatedPath, ONE_PIXEL_PNG);

    const generate = vi.fn(async (request: GenerationRequest) => ({
      assetHash: '',
      assetPath: generatedPath,
      provider: 'test-image',
      ...(reportedCost !== undefined ? { cost: reportedCost } : {}),
      metadata: { model: 'image-model-test', seed: request.seed },
    }));
    const adapter: AIProviderAdapter = {
      id: 'test-image',
      name: 'Test image provider',
      type: 'image',
      capabilities: ['text-to-image'],
      maxConcurrent: 1,
      configure: () => undefined,
      validate: async () => true,
      generate,
      estimateCost: () => ({
        provider: 'test-image',
        estimatedCost,
        currency: 'USD',
        unit: 'image',
      }),
      checkStatus: async () => 'completed',
      cancel: async () => undefined,
    };
    const adapterRegistry = new AdapterRegistry();
    adapterRegistry.register(adapter);
    const cas = new CAS(path.join(root, 'assets'));
    const onStart = vi.fn();
    const generateImage = makeGenerateImage({ adapterRegistry, cas, onStart });
    return { generate, generateImage, onStart };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects an estimate above the approved bound before provider submission', async () => {
    const { generate, generateImage, onStart } = setup(0.5);

    await expect(
      generateImage('A radio room', {
        providerId: 'test-image',
        width: 1024,
        height: 576,
        maxEstimatedCostUsd: 0.4,
      }),
    ).rejects.toThrow(/exceeds the remaining approved audition budget/);
    expect(generate).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('returns auditable provider metadata and ignores non-finite reported cost', async () => {
    const { generate, generateImage } = setup(0.3, Number.NaN);

    const result = await generateImage('A radio room', {
      providerId: 'test-image',
      width: 1024,
      height: 576,
      seed: 73,
      negativePrompt: 'no neon',
      maxEstimatedCostUsd: 0.3,
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'A radio room',
        negativePrompt: 'no neon',
        seed: 73,
      }),
    );
    expect(result).toMatchObject({
      providerId: 'test-image',
      model: 'image-model-test',
      requestedSeed: 73,
      reportedSeed: 73,
      estimatedCostUsd: 0.3,
    });
    expect(result.reportedActualCostUsd).toBeUndefined();
  });
});
