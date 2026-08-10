import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { ViduAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'video',
    providerId: 'vidu',
    prompt: 'A camera drifts through a bright botanical conservatory',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ViduAdapter', () => {
  it('uses Token authentication and returns the completed creation URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'vidu-task', state: 'created' }))
      .mockResolvedValueOnce(
        jsonResponse({
          state: 'success',
          creations: [{ url: 'https://media.vidu.example/final.mp4' }],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new ViduAdapter();
    adapter.configure('vidu-test', { pollIntervalMs: 0, maxPollAttempts: 2 });

    const result = await adapter.generate(request());

    expect(result.assetPath).toBe('https://media.vidu.example/final.mp4');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.vidu.com/ent/v2/text2video',
      'https://api.vidu.com/ent/v2/tasks/vidu-task/creations',
    ]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: 'Token vidu-test' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'viduq3-pro',
      resolution: '720p',
    });
  });

  it('uses start-end2video when first and last frame images are supplied', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'start-end-task' }))
      .mockResolvedValueOnce(
        jsonResponse({
          state: 'success',
          creations: [{ url: 'https://media.vidu.example/start-end.mp4' }],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new ViduAdapter();
    adapter.configure('vidu-test', { pollIntervalMs: 0, maxPollAttempts: 2 });

    await adapter.generate(
      request({
        frameReferenceImages: {
          first: 'https://assets.example/first.png',
          last: 'https://assets.example/last.png',
        },
      }),
    );

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.vidu.com/ent/v2/start-end2video');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      images: ['https://assets.example/first.png', 'https://assets.example/last.png'],
    });
  });

  it('cancels with the official task cancellation endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new ViduAdapter();
    adapter.configure('vidu-test');

    await adapter.cancel('cancel-task');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.vidu.com/ent/v2/tasks/cancel-task/cancel');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Token vidu-test' } });
    expect(JSON.parse(String(init.body))).toEqual({ id: 'cancel-task' });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
