import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { XAIImagineAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'image',
    providerId: 'xai-imagine',
    prompt: 'A cinematic autumn street scene',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('XAIImagineAdapter', () => {
  it('uses the official image generation endpoint and returns the final image URL', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ url: 'https://imgen.x.ai/final.jpg' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new XAIImagineAdapter();
    adapter.configure('xai-test');

    const result = await adapter.generate(request());

    expect(result.assetPath).toBe('https://imgen.x.ai/final.jpg');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.x.ai/v1/images/generations');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer xai-test' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'grok-imagine-image-quality',
      response_format: 'url',
    });
  });

  it('uses the official edit payload for a source image', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ url: 'https://imgen.x.ai/edit.jpg' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new XAIImagineAdapter();
    adapter.configure('xai-test');

    await adapter.generate(request({ sourceImagePath: 'https://assets.example/source.png' }));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.x.ai/v1/images/edits');
    expect(JSON.parse(String(init.body))).toMatchObject({
      image: { url: 'https://assets.example/source.png', type: 'image_url' },
    });
  });

  it('polls xAI video generation until a done result provides the final video URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ request_id: 'video-request' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'processing', progress: 40 }))
      .mockResolvedValueOnce(
        jsonResponse({ status: 'done', video: { url: 'https://vidgen.x.ai/final.mp4' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new XAIImagineAdapter();
    adapter.configure('xai-test', {
      generationType: 'video',
      pollIntervalMs: 0,
      maxPollAttempts: 3,
    });

    const result = await adapter.generate(
      request({
        type: 'video',
        duration: 8,
        referenceImages: [
          'https://assets.example/character.png',
          'https://assets.example/wardrobe.png',
        ],
      }),
    );

    expect(result.assetPath).toBe('https://vidgen.x.ai/final.mp4');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.x.ai/v1/videos/generations',
      'https://api.x.ai/v1/videos/video-request',
      'https://api.x.ai/v1/videos/video-request',
    ]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'grok-imagine-video',
      reference_images: [
        { url: 'https://assets.example/character.png' },
        { url: 'https://assets.example/wardrobe.png' },
      ],
    });
  });

  it('rejects more than seven video reference images before submission', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new XAIImagineAdapter();
    adapter.configure('xai-test');

    await expect(
      adapter.generate(
        request({
          type: 'video',
          referenceImages: Array.from(
            { length: 8 },
            (_, index) => `https://assets.example/${index}.png`,
          ),
        }),
      ),
    ).rejects.toThrow(/at most 7/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
