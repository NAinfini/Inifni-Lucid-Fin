import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlibabaWanImageAdapter, StepFunImageAdapter, VolcengineImageAdapter } from './index.js';

describe('official JSON image adapters', () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each([
    [new StepFunImageAdapter(), { data: [{ url: 'https://cdn.example/step.jpg' }] }],
    [new VolcengineImageAdapter(), { data: [{ url: 'https://cdn.example/seedream.jpg' }] }],
    [
      new AlibabaWanImageAdapter(),
      {
        output: {
          choices: [
            { message: { content: [{ type: 'image', image: 'https://cdn.example/wan.png' }] } },
          ],
        },
      },
    ],
  ])('returns a real image URL from %s', async (adapter, payload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
    adapter.configure('test-key');
    const result = await adapter.generate({
      type: 'image',
      providerId: adapter.id,
      prompt: 'cinematic portrait',
      width: 1024,
      height: 1024,
    });
    expect(result.assetPath).toMatch(/^https:\/\//);
  });
});
