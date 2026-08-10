import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobStatus, type GenerationRequest } from '@lucid-fin/contracts';
import { LtxAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'video',
    providerId: 'ltx',
    prompt: 'A fox crosses a moonlit forest clearing while the camera slowly tracks left',
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

describe('LtxAdapter', () => {
  it('submits the documented text-to-video payload, polls pending work, and returns result.video_url', async () => {
    let statusRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://ltx.example/v2/text-to-video') {
        expect(init?.method).toBe('POST');
        return json({ id: 'ltx-text-1', created_at: '2026-08-04T00:00:00Z' }, 202);
      }
      if (url === 'https://ltx.example/v2/text-to-video/ltx-text-1') {
        statusRequests += 1;
        return json(
          statusRequests === 1
            ? { id: 'ltx-text-1', status: 'pending' }
            : {
                id: 'ltx-text-1',
                status: 'completed',
                result: { video_url: 'https://media.example/ltx-text.mp4' },
              },
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new LtxAdapter();
    adapter.configure('ltx-test-key', {
      baseUrl: 'https://ltx.example',
      pollIntervalMs: 0,
      maxPollAttempts: 2,
    });
    const queueUpdates: string[] = [];

    await expect(
      adapter.subscribe(request(), { onQueueUpdate: (update) => queueUpdates.push(update.status) }),
    ).resolves.toMatchObject({
      assetPath: 'https://media.example/ltx-text.mp4',
      metadata: { jobId: 'ltx-text-1', model: 'ltx-2-3-pro', endpoint: 'text-to-video' },
    });

    const [, submitInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(submitInit.headers).toMatchObject({ Authorization: 'Bearer ltx-test-key' });
    expect(JSON.parse(String(submitInit.body))).toEqual({
      prompt: 'A fox crosses a moonlit forest clearing while the camera slowly tracks left',
      model: 'ltx-2-3-pro',
      duration: 8,
      resolution: '1920x1080',
    });
    expect(queueUpdates).toContain('queued');
    expect(queueUpdates).toContain('completed');
  });

  it('uses image-to-video and materializes local first frames as LTX image data URIs', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://ltx.example/v2/image-to-video') {
        return json({ id: 'ltx-image-1', created_at: '2026-08-04T00:00:00Z' }, 202);
      }
      if (url === 'https://ltx.example/v2/image-to-video/ltx-image-1') {
        return json({
          id: 'ltx-image-1',
          status: 'completed',
          result: { video_url: 'https://media.example/ltx-image.mp4' },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new LtxAdapter();
    adapter.configure('ltx-test-key', {
      baseUrl: 'https://ltx.example',
      model: 'ltx-2-3-fast',
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });

    await expect(
      adapter.generate(
        request({
          sourceImagePath: path.resolve('asset/Logo.png'),
          frameReferenceImages: { last: 'https://images.example/last-frame.png' },
          duration: 6,
          audio: false,
        }),
      ),
    ).resolves.toMatchObject({
      assetPath: 'https://media.example/ltx-image.mp4',
      metadata: { endpoint: 'image-to-video', model: 'ltx-2-3-fast' },
    });

    const [, submitInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(submitInit.body))).toMatchObject({
      prompt: 'A fox crosses a moonlit forest clearing while the camera slowly tracks left',
      model: 'ltx-2-3-fast',
      duration: 6,
      resolution: '1920x1080',
      generate_audio: false,
      image_uri: expect.stringMatching(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
      last_frame_uri: 'https://images.example/last-frame.png',
    });
  });

  it.each([
    ['pending', JobStatus.Queued],
    ['processing', JobStatus.Running],
    ['completed', JobStatus.Completed],
    ['failed', JobStatus.Failed],
  ])('maps documented LTX status %s', async (providerStatus, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ id: 'ltx-status-1', status: providerStatus })),
    );
    const adapter = new LtxAdapter();
    adapter.configure('ltx-test-key', { baseUrl: 'https://ltx.example' });

    await expect(adapter.checkStatus('ltx-status-1')).resolves.toBe(expected);
  });

  it('normalizes documented API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { type: 'rate_limit_error', message: 'Slow down' } }, 429)),
    );
    const adapter = new LtxAdapter();
    adapter.configure('ltx-test-key');

    await expect(adapter.generate(request())).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('explicitly rejects audio-to-video input and does not invent cancellation', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new LtxAdapter();
    adapter.configure('ltx-test-key');

    await expect(
      adapter.generate(request({ params: { audio_uri: 'https://media.example/dialogue.wav' } })),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(adapter.cancel('ltx-job-1')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(adapter.executionCapabilities.cancellation).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
