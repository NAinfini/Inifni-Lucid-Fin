import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, JobStatus, type GenerationRequest } from '@lucid-fin/contracts';
import { AlibabaWanVideoAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'video',
    providerId: 'alibaba-wan-video',
    prompt: 'A lantern boat crosses a moonlit lake',
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

describe('AlibabaWanVideoAdapter', () => {
  it('submits the official Wan 2.7 text-to-video body and polls through to video_url', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (
        url ===
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis'
      ) {
        expect(init?.method).toBe('POST');
        return json({ output: { task_id: 'wan-text-1', task_status: 'PENDING' } });
      }
      if (url === 'https://dashscope.aliyuncs.com/api/v1/tasks/wan-text-1') {
        const pollCount = fetchMock.mock.calls.filter(
          ([calledUrl]) => String(calledUrl) === url,
        ).length;
        return json({
          output:
            pollCount === 1
              ? { task_id: 'wan-text-1', task_status: 'RUNNING' }
              : {
                  task_id: 'wan-text-1',
                  task_status: 'SUCCEEDED',
                  video_url: 'https://media.example/wan-text.mp4',
                },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new AlibabaWanVideoAdapter();
    adapter.configure('wan-key', { pollIntervalMs: 0, maxPollAttempts: 2 });
    const queueUpdates: string[] = [];
    const result = await adapter.subscribe(
      request({
        negativePrompt: 'text artifacts',
        duration: 10,
        width: 1080,
        height: 1920,
        params: { resolution: '720p', prompt_extend: false, watermark: true },
        seed: 77,
      }),
      { onQueueUpdate: (update) => queueUpdates.push(update.status) },
    );

    expect(result).toMatchObject({
      assetPath: 'https://media.example/wan-text.mp4',
      metadata: { taskId: 'wan-text-1', model: 'wan2.7-t2v', mode: 'text' },
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer wan-key',
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'wan2.7-t2v',
      input: {
        prompt: 'A lantern boat crosses a moonlit lake',
        negative_prompt: 'text artifacts',
      },
      parameters: {
        resolution: '720P',
        duration: 10,
        prompt_extend: false,
        watermark: true,
        ratio: '9:16',
        seed: 77,
      },
    });
    expect(queueUpdates).toContain('queued');
    expect(queueUpdates).toContain('completed');
  });

  it('uses the i2v model slot and maps a local reference plus last frame to official media types', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'lucid-wan-video-'));
    const firstFrame = path.join(directory, 'first.png');
    await writeFile(firstFrame, Buffer.from([1, 2, 3]));
    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (
          url ===
          'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis'
        ) {
          return json({ output: { task_id: 'wan-image-1', task_status: 'PENDING' } });
        }
        if (url === 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/tasks/wan-image-1') {
          return json({
            output: {
              task_id: 'wan-image-1',
              task_status: 'SUCCEEDED',
              video_url: 'https://media.example/wan-image.mp4',
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new AlibabaWanVideoAdapter();
      adapter.configure('wan-key', {
        baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com',
        model: 'wan2.7-i2v-custom',
        pollIntervalMs: 0,
        maxPollAttempts: 1,
      });
      await expect(
        adapter.generate(
          request({
            referenceImages: [firstFrame],
            frameReferenceImages: { last: 'data:image/png;base64,BAUG' },
            duration: 5,
          }),
        ),
      ).resolves.toMatchObject({
        assetPath: 'https://media.example/wan-image.mp4',
        metadata: { taskId: 'wan-image-1', model: 'wan2.7-i2v-custom', mode: 'image' },
      });

      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({
        model: 'wan2.7-i2v-custom',
        input: {
          prompt: 'A lantern boat crosses a moonlit lake',
          media: [
            { type: 'first_frame', url: 'data:image/png;base64,AQID' },
            { type: 'last_frame', url: 'data:image/png;base64,BAUG' },
          ],
        },
        parameters: {
          resolution: '1080P',
          duration: 5,
          prompt_extend: true,
          watermark: false,
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses the official r2v model and preserves ordered character reference images', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/video-synthesis')) {
        return json({ output: { task_id: 'wan-reference-1', task_status: 'PENDING' } });
      }
      if (url.endsWith('/tasks/wan-reference-1')) {
        return json({
          output: {
            task_id: 'wan-reference-1',
            task_status: 'SUCCEEDED',
            video_url: 'https://media.example/wan-reference.mp4',
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new AlibabaWanVideoAdapter();
    adapter.configure('wan-key', { pollIntervalMs: 0, maxPollAttempts: 1 });
    const result = await adapter.generate(
      request({
        referenceImages: [
          'https://media.example/character.png',
          'https://media.example/location.webp',
        ],
        width: 1920,
        height: 1080,
      }),
    );

    expect(result).toMatchObject({
      assetPath: 'https://media.example/wan-reference.mp4',
      metadata: { model: 'wan2.7-r2v', mode: 'reference' },
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'wan2.7-r2v',
      input: {
        media: [
          { type: 'reference_image', url: 'https://media.example/character.png' },
          { type: 'reference_image', url: 'https://media.example/location.webp' },
        ],
      },
      parameters: { ratio: '16:9' },
    });
    expect(adapter.conditioningCapabilities.referenceImages).toMatchObject({ maxImages: 5 });
  });

  it('normalizes provider errors, uses the documented POST cancellation endpoint, and exposes accurate capabilities', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/video-synthesis')) {
        return json({ code: 'InvalidParameter', message: 'invalid duration' }, 400);
      }
      if (url.endsWith('/tasks/wan-pending/cancel')) {
        expect(init?.method).toBe('POST');
        return json({ request_id: 'cancel-request' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new AlibabaWanVideoAdapter();
    adapter.configure('wan-key');

    await expect(adapter.generate(request())).rejects.toMatchObject({
      code: ErrorCode.InvalidRequest,
    });
    await expect(adapter.cancel('wan-pending')).resolves.toBeUndefined();
    expect(adapter.capabilities).toEqual(['text-to-video', 'image-to-video']);
    expect(adapter.conditioningCapabilities).toMatchObject({ firstFrame: true, lastFrame: true });
    expect(adapter.executionCapabilities.cancellation).toBe(true);
  });

  it.each([
    ['PENDING', JobStatus.Queued],
    ['RUNNING', JobStatus.Running],
    ['SUCCEEDED', JobStatus.Completed],
    ['FAILED', JobStatus.Failed],
    ['CANCELED', JobStatus.Cancelled],
    ['UNKNOWN', JobStatus.Failed],
  ])('maps official task status %s', async (taskStatus, expectedStatus) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ output: { task_id: 'task-status', task_status: taskStatus } })),
    );
    const adapter = new AlibabaWanVideoAdapter();
    adapter.configure('wan-key');
    await expect(adapter.checkStatus('task-status')).resolves.toBe(expectedStatus);
  });
});
