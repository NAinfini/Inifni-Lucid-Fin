import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobStatus, type GenerationRequest } from '@lucid-fin/contracts';
import { PixVerseAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'video',
    providerId: 'pixverse',
    prompt: 'A red fox runs through a snowy cedar forest',
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PixVerseAdapter V6', () => {
  it('submits text-to-video with a unique trace ID, polls V6 statuses, and reports callbacks', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://app-api.pixverse.ai/openapi/v2/video/text/generate') {
        expect(init?.method).toBe('POST');
        return json({ ErrCode: 0, ErrMsg: 'success', Resp: { video_id: 42 } });
      }
      if (url === 'https://app-api.pixverse.ai/openapi/v2/video/result/42') {
        const statusCount = fetchMock.mock.calls.filter(
          ([calledUrl]) => String(calledUrl) === url,
        ).length;
        return json(
          statusCount === 1
            ? { ErrCode: 0, Resp: { status: 5 } }
            : { ErrCode: 0, Resp: { status: 1, url: 'https://media.example/pixverse.mp4' } },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new PixVerseAdapter();
    adapter.configure('pixverse-test-key', { pollIntervalMs: 0, maxPollAttempts: 2 });
    const updates: string[] = [];
    const result = await adapter.subscribe(
      request({ duration: 5, audio: true, width: 1920, height: 1080 }),
      { onQueueUpdate: (update) => updates.push(update.status) },
    );

    expect(result).toMatchObject({
      assetPath: 'https://media.example/pixverse.mp4',
      metadata: { videoId: '42', model: 'v6', status: 1 },
    });
    const [, submitInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(submitInit.body))).toEqual({
      model: 'v6',
      prompt: 'A red fox runs through a snowy cedar forest',
      duration: 5,
      quality: '720p',
      generate_audio_switch: true,
      aspect_ratio: '16:9',
    });
    const traceIds = fetchMock.mock.calls.map(([, init]) =>
      new Headers((init as RequestInit).headers).get('Ai-trace-id'),
    );
    expect(traceIds.every((traceId) => typeof traceId === 'string' && traceId.length > 0)).toBe(
      true,
    );
    expect(new Set(traceIds).size).toBe(fetchMock.mock.calls.length);
    expect(updates).toContain('queued');
    expect(updates).toContain('completed');
    expect(adapter.estimateCost(request({ duration: 5, audio: true }))).toMatchObject({
      estimatedCost: 60,
      currency: 'credits',
    });
  });

  it('uploads a URL image before image-to-video generation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://app-api.pixverse.ai/openapi/v2/image/upload') {
        expect(init?.body).toBeInstanceOf(FormData);
        expect((init?.body as FormData).get('image_url')).toBe('https://images.example/fox.png');
        return json({ ErrCode: 0, Resp: { img_id: 99 } });
      }
      if (url === 'https://app-api.pixverse.ai/openapi/v2/video/img/generate') {
        return json({ ErrCode: 0, Resp: { video_id: 100 } });
      }
      if (url === 'https://app-api.pixverse.ai/openapi/v2/video/result/100') {
        return json({
          ErrCode: 0,
          Resp: { status: 1, url: 'https://media.example/from-image.mp4' },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new PixVerseAdapter();
    adapter.configure('pixverse-test-key', { pollIntervalMs: 0, maxPollAttempts: 1 });

    await expect(
      adapter.generate(request({ referenceImages: ['https://images.example/fox.png'] })),
    ).resolves.toMatchObject({ assetPath: 'https://media.example/from-image.mp4' });

    const [, generationInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(generationInit.body))).toEqual({
      model: 'v6',
      prompt: 'A red fox runs through a snowy cedar forest',
      duration: 5,
      quality: '720p',
      img_id: '99',
    });
  });

  it('rejects unsupported last-frame requests and exposes no cancellation endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new PixVerseAdapter();
    adapter.configure('pixverse-test-key');

    await expect(
      adapter.generate(
        request({ frameReferenceImages: { last: 'https://images.example/last.png' } }),
      ),
    ).rejects.toThrow(/last-frame/i);
    await expect(adapter.cancel('video-id')).rejects.toThrow(/does not document/i);
    expect(adapter.executionCapabilities.cancellation).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [1, JobStatus.Completed],
    [5, JobStatus.Running],
    [7, JobStatus.Failed],
    [8, JobStatus.Failed],
  ])('maps documented PixVerse result status %s', async (providerStatus, expectedStatus) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ ErrCode: 0, Resp: { status: providerStatus } })),
    );
    const adapter = new PixVerseAdapter();
    adapter.configure('pixverse-test-key');
    await expect(adapter.checkStatus('video-status')).resolves.toBe(expectedStatus);
  });
});
