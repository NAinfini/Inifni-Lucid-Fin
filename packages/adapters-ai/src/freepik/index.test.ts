import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { FreepikAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'image',
    providerId: 'freepik',
    prompt: 'A precise product photograph of polished obsidian and citrus peel',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FreepikAdapter', () => {
  it('uses the image endpoint, materializes a local input, and returns data.generated[0]', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://freepik.example/v1/ai/text-to-image/flux-2-pro') {
        expect(init?.method).toBe('POST');
        return json({ data: { task_id: 'freepik-image-1', status: 'CREATED' } });
      }
      if (url === 'https://freepik.example/v1/ai/text-to-image/flux-2-pro/freepik-image-1') {
        return json({
          data: {
            task_id: 'freepik-image-1',
            status: 'COMPLETED',
            generated: ['https://media.example/freepik-image.png'],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new FreepikAdapter();
    adapter.configure('freepik-test-key', {
      generationType: 'image',
      baseUrl: 'https://freepik.example/v1/ai',
      model: 'text-to-image/flux-2-pro',
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });

    await expect(
      adapter.generate(request({ sourceImagePath: path.resolve('package.json'), seed: 42 })),
    ).resolves.toMatchObject({
      assetPath: 'https://media.example/freepik-image.png',
      metadata: { taskId: 'freepik-image-1', endpoint: 'text-to-image/flux-2-pro' },
    });

    const [, submitInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(submitInit.headers).toMatchObject({ 'x-freepik-api-key': 'freepik-test-key' });
    expect(JSON.parse(String(submitInit.body))).toMatchObject({
      prompt: 'A precise product photograph of polished obsidian and citrus peel',
      seed: 42,
      input_image: expect.stringMatching(/^[A-Za-z0-9+/]+={0,2}$/),
    });
  });

  it('routes default video requests to text-to-video or image-to-video and polls each model path', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://freepik.example/v1/ai/text-to-video/runway-4-5') {
        expect(init?.method).toBe('POST');
        return json({ data: { task_id: 'freepik-video-text', status: 'CREATED' } });
      }
      if (url === 'https://freepik.example/v1/ai/text-to-video/runway-4-5/freepik-video-text') {
        return json({
          data: {
            task_id: 'freepik-video-text',
            status: 'COMPLETED',
            generated: ['https://media.example/freepik-text-video.mp4'],
          },
        });
      }
      if (url === 'https://freepik.example/v1/ai/image-to-video/veo-3-1-fast') {
        expect(init?.method).toBe('POST');
        return json({ data: { task_id: 'freepik-video-image', status: 'CREATED' } });
      }
      if (url === 'https://freepik.example/v1/ai/image-to-video/veo-3-1-fast/freepik-video-image') {
        return json({
          data: {
            task_id: 'freepik-video-image',
            status: 'COMPLETED',
            generated: ['https://media.example/freepik-image-video.mp4'],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new FreepikAdapter();
    adapter.configure('freepik-test-key', {
      generationType: 'video',
      baseUrl: 'https://freepik.example/v1/ai',
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });

    await expect(adapter.generate(request({ type: 'video', duration: 4 }))).resolves.toMatchObject({
      assetPath: 'https://media.example/freepik-text-video.mp4',
      metadata: { endpoint: 'text-to-video/runway-4-5' },
    });
    await expect(
      adapter.generate(
        request({
          type: 'video',
          duration: 8,
          sourceImagePath: 'https://assets.example/keyframe.png',
          negativePrompt: 'flicker',
          audio: true,
          params: { resolution: '1080p' },
        }),
      ),
    ).resolves.toMatchObject({
      assetPath: 'https://media.example/freepik-image-video.mp4',
      metadata: { endpoint: 'image-to-video/veo-3-1-fast' },
    });

    const [, imageVideoSubmit] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(JSON.parse(String(imageVideoSubmit.body))).toMatchObject({
      prompt: 'A precise product photograph of polished obsidian and citrus peel',
      image: 'https://assets.example/keyframe.png',
      negative_prompt: 'flicker',
      duration: 8,
      resolution: '1080p',
      generate_audio: true,
    });
  });

  it('normalizes Freepik request failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'Too many generation tasks' }, 429)),
    );

    const adapter = new FreepikAdapter();
    await expect(adapter.generate(request())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('does not invent a cancellation endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new FreepikAdapter();
    await expect(adapter.cancel('freepik-task-1')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(adapter.executionCapabilities.cancellation).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
