import { afterEach, describe, expect, it, vi } from 'vitest';
import { KlingAdapter } from './kling/index.js';
import { LeonardoAdapter } from './leonardo/index.js';
import { LumaAdapter } from './luma/index.js';
import { RunwayAdapter } from './runway/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('official asynchronous adapters', () => {
  it('polls Luma through completion and returns assets.video', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ id: 'luma-1', state: 'queued' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'luma-1', state: 'dreaming' }))
        .mockResolvedValueOnce(
          jsonResponse({
            id: 'luma-1',
            state: 'completed',
            assets: { video: 'https://cdn.test/luma.mp4' },
          }),
        ),
    );
    const adapter = new LumaAdapter();
    adapter.configure('luma-key', { pollIntervalMs: 0, maxPollAttempts: 3 });

    await expect(
      adapter.generate({ type: 'video', providerId: 'luma', prompt: 'Ocean at dawn' }),
    ).resolves.toMatchObject({ assetPath: 'https://cdn.test/luma.mp4' });
  });

  it('polls Kling through completion and extracts its nested video URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ data: { task_id: 'kling-1', task_status: 'submitted' } }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              task_id: 'kling-1',
              task_status: 'succeed',
              task_result: { videos: [{ url: 'https://cdn.test/kling.mp4' }] },
            },
          }),
        ),
    );
    const adapter = new KlingAdapter();
    adapter.configure('kling-token', { pollIntervalMs: 0, maxPollAttempts: 2 });

    await expect(
      adapter.generate({ type: 'video', providerId: 'kling', prompt: 'A tracking shot' }),
    ).resolves.toMatchObject({ assetPath: 'https://cdn.test/kling.mp4' });
  });

  it('polls Leonardo through completion and returns the generated image', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ sdGenerationJob: { generationId: 'leo-1' } }))
        .mockResolvedValueOnce(
          jsonResponse({
            generations_by_pk: {
              status: 'COMPLETE',
              generated_images: [{ url: 'https://cdn.test/leonardo.png' }],
            },
          }),
        ),
    );
    const adapter = new LeonardoAdapter();
    adapter.configure('leonardo-key', { pollIntervalMs: 0, maxPollAttempts: 2 });

    await expect(
      adapter.generate({ type: 'image', providerId: 'leonardo', prompt: 'Editorial portrait' }),
    ).resolves.toMatchObject({ assetPath: 'https://cdn.test/leonardo.png' });
  });

  it('bounds Runway polling instead of waiting forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ id: 'runway-1', status: 'PENDING' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'runway-1', status: 'RUNNING' })),
    );
    const adapter = new RunwayAdapter();
    adapter.configure('runway-key', { pollIntervalMs: 0, maxPollAttempts: 1 });

    await expect(
      adapter.subscribe({ type: 'video', providerId: 'runway', prompt: 'Aerial reveal' }, {}),
    ).rejects.toThrow('did not finish after 1 checks');
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
