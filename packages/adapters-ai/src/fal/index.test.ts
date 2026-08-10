import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { FalAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'image',
    providerId: 'fal-ai',
    prompt: 'A cinematic lighthouse at dusk',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FalAdapter', () => {
  it('uses image-specific queue configuration, polls status_url, and retrieves the final image', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://queue.example/fal-ai/custom-image') {
        return json({
          request_id: 'fal-image-1',
          status_url: 'https://status.example/fal-image-1',
          response_url: 'https://response.example/fal-image-1',
          cancel_url: 'https://cancel.example/fal-image-1',
        });
      }
      if (url === 'https://status.example/fal-image-1') {
        return json({ status: 'COMPLETED', request_id: 'fal-image-1' });
      }
      if (url === 'https://response.example/fal-image-1') {
        return json({ images: [{ url: 'https://media.example/final.png' }] });
      }
      if (url === 'https://cancel.example/fal-image-1') {
        expect(init?.method).toBe('PUT');
        return json({ status: 'CANCELLATION_REQUESTED' }, 202);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new FalAdapter();
    adapter.configure('fal-test-key', {
      generationType: 'image',
      baseUrl: 'https://queue.example',
      model: 'fal-ai/custom-image',
      pollIntervalMs: 0,
      maxPollAttempts: 2,
    });

    const queueUpdates: string[] = [];
    await expect(
      adapter.subscribe(request({ referenceImages: ['data:image/png;base64,YQ=='] }), {
        onQueueUpdate: (update) => queueUpdates.push(update.status),
      }),
    ).resolves.toMatchObject({
      assetPath: 'https://media.example/final.png',
      metadata: { requestId: 'fal-image-1', model: 'fal-ai/custom-image' },
    });
    await adapter.cancel('fal-image-1');

    const [queueUrl, queueInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(queueUrl).toBe('https://queue.example/fal-ai/custom-image');
    expect(queueInit.headers).toMatchObject({ Authorization: 'Key fal-test-key' });
    expect(JSON.parse(String(queueInit.body))).toMatchObject({
      prompt: 'A cinematic lighthouse at dusk',
      image_url: 'data:image/png;base64,YQ==',
    });
    expect(queueUpdates).toContain('queued');
    expect(queueUpdates).toContain('completed');
  });

  it('uses video-specific model configuration and extracts video.url after queue completion', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://video-queue.example/fal-ai/custom-video') {
        return json({ request_id: 'fal-video-1' });
      }
      if (url === 'https://video-queue.example/fal-ai/custom-video/requests/fal-video-1/status') {
        return json({ status: 'COMPLETED' });
      }
      if (url === 'https://video-queue.example/fal-ai/custom-video/requests/fal-video-1') {
        return json({ video: { url: 'https://media.example/final.mp4' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new FalAdapter();
    adapter.configure('fal-test-key', {
      generationType: 'video',
      baseUrl: 'https://video-queue.example',
      model: 'fal-ai/custom-video',
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });

    await expect(adapter.generate(request({ type: 'video', duration: 4 }))).resolves.toMatchObject({
      assetPath: 'https://media.example/final.mp4',
      metadata: { requestId: 'fal-video-1', model: 'fal-ai/custom-video' },
    });
  });

  it('routes MiniMax H3 text, keyframe, and multimodal references to their official endpoints', async () => {
    const submissions: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.startsWith('https://queue.example/minimax/h3/')) {
        const requestId = `h3-${submissions.length + 1}`;
        submissions.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return json({
          request_id: requestId,
          status_url: `https://status.example/${requestId}`,
          response_url: `https://result.example/${requestId}`,
        });
      }
      if (url.startsWith('https://status.example/')) return json({ status: 'COMPLETED' });
      if (url.startsWith('https://result.example/')) {
        return json({ video: { url: `${url}.mp4` } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new FalAdapter();
    adapter.configure('fal-test-key', {
      generationType: 'video',
      baseUrl: 'https://queue.example',
      model: 'minimax/h3/text-to-video',
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });

    await adapter.generate(
      request({
        type: 'video',
        duration: 7,
        width: 1920,
        height: 1080,
        params: { resolution: '2K' },
      }),
    );
    await adapter.generate(
      request({
        type: 'video',
        frameReferenceImages: {
          first: 'data:image/png;base64,Zmlyc3Q=',
          last: 'data:image/png;base64,bGFzdA==',
        },
      }),
    );
    await adapter.generate(
      request({
        type: 'video',
        referenceImages: ['https://assets.example/character.png', 'data:image/png;base64,c3R5bGU='],
        params: {
          reference_video_urls: ['https://assets.example/motion.mp4'],
          reference_audio_urls: ['data:audio/mpeg;base64,YXVkaW8='],
        },
      }),
    );

    expect(submissions).toEqual([
      {
        url: 'https://queue.example/minimax/h3/text-to-video',
        body: {
          prompt: 'A cinematic lighthouse at dusk',
          duration: 7,
          resolution: '2K',
          aspect_ratio: '16:9',
        },
      },
      {
        url: 'https://queue.example/minimax/h3/image-to-video',
        body: {
          prompt: 'A cinematic lighthouse at dusk',
          duration: 5,
          resolution: '2K',
          image_url: 'data:image/png;base64,Zmlyc3Q=',
          end_image_url: 'data:image/png;base64,bGFzdA==',
        },
      },
      {
        url: 'https://queue.example/minimax/h3/reference-to-video',
        body: {
          prompt: 'A cinematic lighthouse at dusk',
          duration: 5,
          resolution: '2K',
          reference_image_urls: [
            'https://assets.example/character.png',
            'data:image/png;base64,c3R5bGU=',
          ],
          reference_video_urls: ['https://assets.example/motion.mp4'],
          reference_audio_urls: ['data:audio/mpeg;base64,YXVkaW8='],
          aspect_ratio: 'adaptive',
        },
      },
    ]);
    expect(adapter.estimateCost(request({ type: 'video', duration: 5 }))).toMatchObject({
      estimatedCost: 1.3,
      unit: 'per second of output video',
    });
  });

  it('rejects invalid MiniMax H3 mode combinations before queue submission', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new FalAdapter();
    adapter.configure('fal-test-key', {
      generationType: 'video',
      model: 'minimax/h3/text-to-video',
    });

    await expect(
      adapter.generate(
        request({
          type: 'video',
          frameReferenceImages: { first: 'https://assets.example/first.png' },
          referenceImages: ['https://assets.example/character.png'],
        }),
      ),
    ).rejects.toThrow(/cannot combine/i);
    await expect(adapter.generate(request({ type: 'video', duration: 4 }))).rejects.toThrow(
      /5 to 15 seconds/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
