import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { SiliconFlowImageAdapter, SiliconFlowVideoAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'image',
    providerId: 'siliconflow-image',
    prompt: 'A polished production concept frame',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SiliconFlow public media adapters', () => {
  it('posts image generations with bearer auth and parses image/data responses', async () => {
    const fetchMock = vi.fn(async () =>
      json({ data: [{ b64_json: 'YWJj', output_format: 'png' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new SiliconFlowImageAdapter();
    adapter.configure('silicon-test-key');

    await expect(
      adapter.generate(request({ referenceImages: ['data:image/png;base64,YQ=='] })),
    ).resolves.toMatchObject({ assetPath: 'data:image/png;base64,YWJj' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.siliconflow.cn/v1/images/generations');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer silicon-test-key' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'Kwai-Kolors/Kolors',
      image: 'data:image/png;base64,YQ==',
    });
  });

  it('submits and bounded-polls video status until results.videos[0].url is present', async () => {
    let polls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://api.siliconflow.cn/v1/video/submit') {
        return json({ requestId: 'silicon-video-1' });
      }
      if (url === 'https://api.siliconflow.cn/v1/video/status') {
        expect(JSON.parse(String(init?.body))).toEqual({ requestId: 'silicon-video-1' });
        polls += 1;
        return polls === 1
          ? json({ status: 'InQueue' })
          : json({
              status: 'Succeed',
              results: { videos: [{ url: 'https://media.example/silicon.mp4' }] },
            });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new SiliconFlowVideoAdapter();
    adapter.configure('silicon-test-key', { pollIntervalMs: 0, maxPollAttempts: 2 });

    await expect(
      adapter.generate(request({ type: 'video', providerId: adapter.id })),
    ).resolves.toMatchObject({
      assetPath: 'https://media.example/silicon.mp4',
      metadata: { requestId: 'silicon-video-1' },
    });
    expect(polls).toBe(2);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
