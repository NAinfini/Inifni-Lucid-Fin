import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { KreaAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'image',
    providerId: 'krea',
    prompt: 'An expressive editorial illustration of a moonlit train station',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('KreaAdapter', () => {
  it('keeps image configuration separate and materializes a local Krea 2 reference image', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://image.krea.example/generate/image/krea/krea-2/medium') {
        expect(init?.method).toBe('POST');
        return json({ job_id: 'krea-image-1' });
      }
      if (url === 'https://image.krea.example/jobs/krea-image-1') {
        return json({
          status: 'COMPLETED',
          result: { urls: ['https://media.example/krea-image.png'] },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new KreaAdapter();
    adapter.configure('krea-test-key', {
      generationType: 'image',
      baseUrl: 'https://image.krea.example',
      model: 'image/krea/krea-2/medium',
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });
    adapter.configure('krea-test-key', {
      generationType: 'video',
      baseUrl: 'https://video.krea.example',
      model: 'video/minimax/hailuo-2.3',
    });

    const queueUpdates: string[] = [];
    await expect(
      adapter.subscribe(
        request({ sourceImagePath: path.resolve('package.json'), width: 1600, height: 1200 }),
        { onQueueUpdate: (update) => queueUpdates.push(update.status) },
      ),
    ).resolves.toMatchObject({
      assetPath: 'https://media.example/krea-image.png',
      metadata: { jobId: 'krea-image-1', model: 'image/krea/krea-2/medium' },
    });

    const [, submitInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(submitInit.headers).toMatchObject({ Authorization: 'Bearer krea-test-key' });
    expect(JSON.parse(String(submitInit.body))).toMatchObject({
      prompt: 'An expressive editorial illustration of a moonlit train station',
      aspect_ratio: '4:3',
      image_url: expect.stringMatching(/^data:image\/png;base64,/),
    });
    expect(queueUpdates).toContain('queued');
    expect(queueUpdates).toContain('completed');
  });

  it('uses the video slot, sends ordered start and end frames, and cancels its Krea job', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://video.krea.example/generate/video/minimax/hailuo-2.3') {
        return json({ job_id: 'krea-video-1' });
      }
      if (url === 'https://video.krea.example/jobs/krea-video-1' && init?.method === 'DELETE') {
        return json({ status: 'cancelled' });
      }
      if (url === 'https://video.krea.example/jobs/krea-video-1') {
        return json({
          status: 'completed',
          result: { urls: ['https://media.example/krea-video.mp4'] },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new KreaAdapter();
    adapter.configure('krea-test-key', {
      generationType: 'video',
      baseUrl: 'https://video.krea.example',
      model: 'video/minimax/hailuo-2.3',
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });

    await expect(
      adapter.generate(
        request({
          type: 'video',
          duration: 6,
          width: 1080,
          height: 1920,
          negativePrompt: 'no flicker',
          sourceImagePath: 'data:image/png;base64,c3RhcnQ=',
          frameReferenceImages: { last: 'data:image/png;base64,ZW5k' },
          params: { resolution: '768p' },
        }),
      ),
    ).resolves.toMatchObject({
      assetPath: 'https://media.example/krea-video.mp4',
      metadata: { jobId: 'krea-video-1', model: 'video/minimax/hailuo-2.3' },
    });
    await adapter.cancel('krea-video-1');

    const [, submitInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(submitInit.body))).toMatchObject({
      prompt: 'An expressive editorial illustration of a moonlit train station',
      negative_prompt: 'no flicker',
      duration: 6,
      aspect_ratio: '9:16',
      resolution: '768p',
      start_image: 'data:image/png;base64,c3RhcnQ=',
      end_image: 'data:image/png;base64,ZW5k',
    });
    const [, cancelInit] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(cancelInit.method).toBe('DELETE');
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
