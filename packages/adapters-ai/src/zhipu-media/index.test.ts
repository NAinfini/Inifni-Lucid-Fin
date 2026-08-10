import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { ZhipuImageAdapter, ZhipuVideoAdapter } from './index.js';

function imageRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'image',
    providerId: 'zhipu-image',
    prompt: 'A bright still life of fruit on marble',
    ...overrides,
  };
}

function videoRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'video',
    providerId: 'zhipu-video',
    prompt: 'The camera moves slowly through the scene',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Zhipu media adapters', () => {
  it('uses the official image generation endpoint and accepts a URL result', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ url: 'https://cdn.zhipu.example/image.png' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new ZhipuImageAdapter();
    adapter.configure('zhipu-test');

    const result = await adapter.generate(imageRequest());

    expect(result.assetPath).toBe('https://cdn.zhipu.example/image.png');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://open.bigmodel.cn/api/paas/v4/images/generations');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer zhipu-test' });
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'glm-image', size: '1280x1280' });
  });

  it('converts a base64 image result into an asset data URL', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new ZhipuImageAdapter();
    adapter.configure('zhipu-test');

    await expect(adapter.generate(imageRequest())).resolves.toMatchObject({
      assetPath: 'data:image/png;base64,aGVsbG8=',
    });
  });

  it('submits first and last frames then polls the official async result endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'task-123', task_status: 'PROCESSING' }))
      .mockResolvedValueOnce(
        jsonResponse({
          task_status: 'SUCCESS',
          video_result: [{ url: 'https://cdn.zhipu.example/final.mp4' }],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new ZhipuVideoAdapter();
    adapter.configure('zhipu-test', { pollIntervalMs: 0, maxPollAttempts: 2 });

    const result = await adapter.generate(
      videoRequest({
        frameReferenceImages: {
          first: 'https://assets.example/first.png',
          last: 'https://assets.example/last.png',
        },
      }),
    );

    expect(result.assetPath).toBe('https://cdn.zhipu.example/final.mp4');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://open.bigmodel.cn/api/paas/v4/videos/generations',
      'https://open.bigmodel.cn/api/paas/v4/async-result/task-123',
    ]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'cogvideox-3',
      image_url: ['https://assets.example/first.png', 'https://assets.example/last.png'],
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
