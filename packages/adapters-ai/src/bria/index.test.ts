import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { BriaAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'image',
    providerId: 'bria',
    prompt: 'A commercial still life of translucent citrus on cobalt glass',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BriaAdapter', () => {
  it('submits Bria V2 asynchronously and polls status_url for result.image_url', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://bria.example/v2/image/generate') {
        expect(init?.method).toBe('POST');
        return json(
          { request_id: 'bria-image-1', status_url: 'https://status.bria.example/job-1' },
          202,
        );
      }
      if (url === 'https://status.bria.example/job-1') {
        return json({
          status: 'COMPLETED',
          result: {
            image_url: 'https://media.example/bria-image.png',
            seed: 42,
            refined_prompt: 'A refined commercial still life',
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new BriaAdapter();
    adapter.configure('bria-test-key', {
      baseUrl: 'https://bria.example/v2',
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });

    const queueUpdates: string[] = [];
    await expect(
      adapter.subscribe(
        request({
          referenceImages: ['https://assets.example/reference.png'],
          negativePrompt: 'blurry, low contrast',
          width: 1920,
          height: 1080,
          seed: 42,
          params: { resolution: '4MP', output_type: 'jpeg' },
        }),
        { onQueueUpdate: (update) => queueUpdates.push(update.status) },
      ),
    ).resolves.toMatchObject({
      assetPath: 'https://media.example/bria-image.png',
      metadata: { requestId: 'bria-image-1', seed: 42 },
    });

    const [, submitInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(submitInit.headers).toMatchObject({ api_token: 'bria-test-key' });
    expect(JSON.parse(String(submitInit.body))).toMatchObject({
      prompt: 'A commercial still life of translucent citrus on cobalt glass',
      images: ['https://assets.example/reference.png'],
      negative_prompt: 'blurry, low contrast',
      aspect_ratio: '16:9',
      resolution: '4MP',
      seed: 42,
      output_type: 'jpeg',
      sync: false,
    });
    expect(queueUpdates).toContain('queued');
    expect(queueUpdates).toContain('completed');
  });

  it('treats only auth responses as an invalid key and reports cancellation as unsupported', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new BriaAdapter();
    adapter.configure('bria-test-key', { baseUrl: 'https://bria.example/v2' });

    await expect(adapter.validate()).resolves.toBe(false);
    await expect(adapter.validate()).resolves.toBe(true);
    await expect(adapter.cancel('bria-image-1')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(adapter.executionCapabilities.cancellation).toBe(false);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
