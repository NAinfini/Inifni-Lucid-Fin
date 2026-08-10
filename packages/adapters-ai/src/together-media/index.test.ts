import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { TogetherMediaAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'image',
    providerId: 'together-ai',
    prompt: 'A precise watercolor scene',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TogetherMediaAdapter', () => {
  it('posts image generation with public data URI references and normalizes b64_json to a data URL', async () => {
    const fetchMock = vi.fn(async () =>
      json({ data: [{ b64_json: 'YWJj', output_format: 'png' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TogetherMediaAdapter();
    adapter.configure('together-test-key', { pollIntervalMs: 0, maxPollAttempts: 2 });

    await expect(
      adapter.generate(request({ referenceImages: ['data:image/png;base64,YQ=='] })),
    ).resolves.toMatchObject({ assetPath: 'data:image/png;base64,YWJj' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.together.ai/v1/images/generations');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer together-test-key' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'black-forest-labs/FLUX.1-schnell',
      image_url: 'data:image/png;base64,YQ==',
      reference_images: ['data:image/png;base64,YQ=='],
    });
  });

  it('submits a video then polls GET /videos/{id} until outputs.video_url is ready', async () => {
    let polls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://api.together.ai/v1/videos') {
        return json({ id: 'together-video-1', status: 'in_progress' });
      }
      if (url === 'https://api.together.ai/v1/videos/together-video-1') {
        polls += 1;
        return polls === 1
          ? json({ id: 'together-video-1', status: 'in_progress' })
          : json({
              id: 'together-video-1',
              status: 'completed',
              outputs: { video_url: 'https://media.example/together.mp4', cost: 0.17 },
            });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new TogetherMediaAdapter();
    adapter.configure('together-test-key', {
      generationType: 'video',
      pollIntervalMs: 0,
      maxPollAttempts: 2,
    });
    const progress: number[] = [];

    await expect(
      adapter.subscribe(request({ type: 'video', duration: 6 }), {
        onProgress: (update) => progress.push(update.percentage),
      }),
    ).resolves.toMatchObject({
      assetPath: 'https://media.example/together.mp4',
      cost: 0.17,
      metadata: { requestId: 'together-video-1' },
    });

    expect(polls).toBe(2);
    expect(progress).toContain(100);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
