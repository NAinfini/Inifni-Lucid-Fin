import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { BFLFluxAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'image',
    providerId: 'bfl-flux',
    prompt: 'A polished ceramic vase in a sunlit studio',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BFLFluxAdapter', () => {
  it('posts to the configured FLUX endpoint and follows the returned polling URL', async () => {
    const pollingUrl = 'https://api.bfl.ai/v1/get_result?id=bfl-task';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'bfl-task', polling_url: pollingUrl }))
      .mockResolvedValueOnce(jsonResponse({ status: 'Pending', progress: 25 }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'Ready',
          result: { sample: 'https://delivery.us.bfl.ai/final.webp' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new BFLFluxAdapter();
    adapter.configure('bfl-test', {
      model: 'flux-2-klein-4b',
      pollIntervalMs: 0,
      maxPollAttempts: 3,
    });

    const result = await adapter.generate(request({ width: 1440, height: 810 }));

    expect(result.assetPath).toBe('https://delivery.us.bfl.ai/final.webp');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.bfl.ai/v1/flux-2-klein-4b',
      pollingUrl,
      pollingUrl,
    ]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'x-key': 'bfl-test' });
    expect(JSON.parse(String(init.body))).toMatchObject({ width: 1440, height: 810 });
  });

  it('passes a source image through the documented input_image field', async () => {
    const pollingUrl = 'https://api.bfl.ai/v1/get_result?id=bfl-edit';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'bfl-edit', polling_url: pollingUrl }))
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'Ready',
          result: { sample: 'https://delivery.us.bfl.ai/edit.webp' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new BFLFluxAdapter();
    adapter.configure('bfl-test', { pollIntervalMs: 0, maxPollAttempts: 2 });

    await adapter.generate(request({ sourceImagePath: 'https://assets.example/input.png' }));

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      input_image: 'https://assets.example/input.png',
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
