import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobStatus, type GenerationRequest } from '@lucid-fin/contracts';
import { HiggsfieldAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'image',
    providerId: 'higgsfield',
    prompt: 'A sunlit observatory above the clouds',
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

describe('HiggsfieldAdapter V2', () => {
  it('uses the image configuration slot, sends V2 input directly, and polls the documented status URL', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://image.example/bytedance/seedream/v4/text-to-image') {
        expect(init?.method).toBe('POST');
        return json({
          request_id: 'image-request-1',
          status: 'queued',
          status_url: 'https://status.example/image-request-1',
          cancel_url: 'https://cancel.example/image-request-1',
        });
      }
      if (url === 'https://status.example/image-request-1') {
        return json({
          request_id: 'image-request-1',
          status: 'completed',
          images: [{ url: 'https://media.example/image.png' }],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new HiggsfieldAdapter();
    adapter.configure('key-id:key-secret', {
      generationType: 'image',
      baseUrl: 'https://image.example',
      model: 'bytedance/seedream/v4/text-to-image',
      pollIntervalMs: 0,
      maxPollAttempts: 2,
    });

    const queueUpdates: string[] = [];
    const result = await adapter.subscribe(
      request({
        width: 1080,
        height: 1920,
        params: { resolution: '2K', camera_fixed: true },
      }),
      { onQueueUpdate: (update) => queueUpdates.push(update.status) },
    );

    expect(result).toMatchObject({
      assetPath: 'https://media.example/image.png',
      metadata: {
        requestId: 'image-request-1',
        model: 'bytedance/seedream/v4/text-to-image',
      },
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: 'Key key-id:key-secret',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      prompt: 'A sunlit observatory above the clouds',
      resolution: '2K',
      aspect_ratio: '9:16',
      camera_fixed: true,
    });
    expect(queueUpdates).toContain('queued');
    expect(queueUpdates).toContain('completed');
  });

  it('uses the video configuration slot and materializes a local DoP input image as a data URI', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lucid-higgsfield-'));
    const imagePath = path.join(directory, 'reference.png');
    await writeFile(imagePath, Buffer.from([1, 2, 3]));
    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === 'https://video.example/v1/image2video/dop') {
          expect(init?.method).toBe('POST');
          return json({ request_id: 'video-request-1', status: 'queued' });
        }
        if (url === 'https://video.example/requests/video-request-1/status') {
          return json({
            request_id: 'video-request-1',
            status: 'completed',
            video: { url: 'https://media.example/video.mp4' },
          });
        }
        if (url === 'https://video.example/requests/video-request-1/cancel') {
          expect(init?.method).toBe('POST');
          return json({ request_id: 'video-request-1', status: 'cancelled' });
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new HiggsfieldAdapter();
      adapter.configure('key-id:key-secret', {
        generationType: 'video',
        baseUrl: 'https://video.example',
        pollIntervalMs: 0,
        maxPollAttempts: 1,
      });

      await expect(
        adapter.generate(request({ type: 'video', sourceImagePath: imagePath })),
      ).resolves.toMatchObject({ assetPath: 'https://media.example/video.mp4' });
      await adapter.cancel('video-request-1');

      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({
        model: 'dop-turbo',
        prompt: 'A sunlit observatory above the clouds',
        input_images: [{ type: 'image_url', image_url: 'data:image/png;base64,AQID' }],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses a non-mutating status probe and only rejects malformed or explicitly unauthorized credentials', async () => {
    const adapter = new HiggsfieldAdapter();
    adapter.configure('not-a-credential');
    await expect(adapter.validate()).resolves.toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ detail: 'unknown request' }, 404)),
    );
    adapter.configure('key-id:key-secret', { baseUrl: 'https://status.example' });
    await expect(adapter.validate()).resolves.toBe(true);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ detail: 'invalid credentials' }, 401)),
    );
    await expect(adapter.validate()).resolves.toBe(false);
  });

  it.each([
    ['queued', JobStatus.Queued],
    ['in_progress', JobStatus.Running],
    ['completed', JobStatus.Completed],
    ['nsfw', JobStatus.Failed],
    ['failed', JobStatus.Failed],
    ['cancelled', JobStatus.Cancelled],
  ])('maps the documented V2 %s status', async (providerStatus, expectedStatus) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ status: providerStatus })),
    );
    const adapter = new HiggsfieldAdapter();
    adapter.configure('key-id:key-secret');
    await expect(adapter.checkStatus('request-status')).resolves.toBe(expectedStatus);
  });
});
