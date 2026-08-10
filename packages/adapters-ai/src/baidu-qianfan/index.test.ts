import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, JobStatus, type GenerationRequest } from '@lucid-fin/contracts';
import { BaiduQianfanAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'image',
    providerId: 'baidu-qianfan',
    prompt: 'A cinematic lantern market after rain',
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

describe('BaiduQianfanAdapter', () => {
  it('uses the official V2 image generation endpoint and returns its final asset URL', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://qianfan.baidubce.com/v2/images/generations');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer qianfan-key');
      return json({
        id: 'as-image-1',
        data: [{ url: 'https://media.example/qianfan-image.png' }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new BaiduQianfanAdapter();
    adapter.configure('qianfan-key', { generationType: 'image' });
    const result = await adapter.generate(
      request({
        width: 1024,
        height: 1024,
        negativePrompt: 'blurry',
        seed: 42,
        cfgScale: 4,
        params: { prompt_extend: false, watermark: true },
      }),
    );

    expect(result).toMatchObject({
      assetPath: 'https://media.example/qianfan-image.png',
      metadata: { model: 'qwen-image', mode: 'text', requestId: 'as-image-1' },
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'qwen-image',
      prompt: 'A cinematic lantern market after rain',
      negative_prompt: 'blurry',
      size: '1024x1024',
      seed: 42,
      guidance: 4,
      prompt_extend: false,
      watermark: true,
    });
  });

  it('uses qwen-image-edit and a full data URI for local image-to-image input', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'qianfan-image-'));
    const source = path.join(directory, 'reference.webp');
    await writeFile(source, Buffer.from([1, 2, 3]));
    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        expect(String(input)).toBe('https://qianfan.baidubce.com/v2/images/edits');
        return json({ data: [{ url: 'https://media.example/qianfan-edit.png' }] });
      });
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new BaiduQianfanAdapter();
      adapter.configure('qianfan-key', { generationType: 'image' });
      await expect(
        adapter.generate(request({ sourceImagePath: source, seed: 9 })),
      ).resolves.toMatchObject({ assetPath: 'https://media.example/qianfan-edit.png' });

      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({
        model: 'qwen-image-edit',
        image: 'data:image/webp;base64,AQID',
        prompt: 'A cinematic lantern market after rain',
        seed: 9,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('submits text-to-video and polls the documented qianfan-video task endpoint to its final URL', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://qianfan.baidubce.com/beta/video/generations/qianfan-video') {
        expect(init?.method).toBe('POST');
        return json({
          code: 0,
          request_id: 'as-video-submit',
          data: { task_id: 'video-task-1', task_status: 'submitted' },
        });
      }
      if (
        url ===
        'https://qianfan.baidubce.com/beta/video/generations/qianfan-video?task_id=video-task-1&model=K3.0'
      ) {
        const count = fetchMock.mock.calls.filter(([called]) => String(called) === url).length;
        return json({
          code: 0,
          request_id: 'as-video-status',
          data:
            count === 1
              ? { task_id: 'video-task-1', task_status: 'processing' }
              : {
                  task_id: 'video-task-1',
                  task_status: 'succeed',
                  task_result: { videos: [{ url: 'https://media.example/qianfan-video.mp4' }] },
                },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new BaiduQianfanAdapter();
    adapter.configure('qianfan-key', {
      generationType: 'video',
      pollIntervalMs: 0,
      maxPollAttempts: 2,
    });
    const updates: string[] = [];
    const result = await adapter.subscribe(
      request({ type: 'video', duration: 5, audio: true, width: 1920, height: 1080 }),
      { onQueueUpdate: (update) => updates.push(update.status) },
    );

    expect(result).toMatchObject({
      assetPath: 'https://media.example/qianfan-video.mp4',
      metadata: {
        taskId: 'video-task-1',
        requestId: 'as-video-status',
        model: 'K3.0',
        mode: 'text',
        status: 'succeed',
      },
    });
    const [, submitInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(submitInit.body))).toEqual({
      model: 'K3.0',
      type: 'text2video',
      model_parameters: {
        prompt: 'A cinematic lantern market after rain',
        mode: 'std',
        aspect_ratio: '16:9',
        duration: '5',
        sound: 'on',
      },
    });
    expect(updates).toContain('queued');
    expect(updates).toContain('completed');
  });

  it('uses VQ image-to-video body and full data URI local input', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'qianfan-video-'));
    const source = path.join(directory, 'first.jpg');
    await writeFile(source, Buffer.from([4, 5, 6]));
    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url === 'https://qianfan.baidubce.com/beta/video/generations/qianfan-video') {
          return json({ task_id: 'video-image-1', status: 'created' });
        }
        if (
          url ===
          'https://qianfan.baidubce.com/beta/video/generations/qianfan-video?task_id=video-image-1&model=VQ3-Turbo'
        ) {
          return json({
            code: 0,
            data: {
              task_id: 'video-image-1',
              task_status: 'succeed',
              task_result: { videos: [{ url: 'https://media.example/qianfan-image-video.mp4' }] },
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const adapter = new BaiduQianfanAdapter();
      adapter.configure('qianfan-key', {
        generationType: 'video',
        pollIntervalMs: 0,
        maxPollAttempts: 1,
      });
      await expect(
        adapter.generate(
          request({
            type: 'video',
            sourceImagePath: source,
            duration: 5,
            quality: '720p',
            audio: false,
            seed: 7,
          }),
        ),
      ).resolves.toMatchObject({ assetPath: 'https://media.example/qianfan-image-video.mp4' });

      const [, submitInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(String(submitInit.body))).toEqual({
        model: 'VQ3-Turbo',
        type: 'img2video',
        model_parameters: {
          images: ['data:image/jpeg;base64,BAUG'],
          prompt: 'A cinematic lantern market after rain',
          audio: false,
          duration: 5,
          resolution: '720p',
          seed: 7,
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('maps task states, normalizes provider errors, and explicitly exposes no cancellation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('status-failed')) {
        return json({ code: 0, data: { task_id: 'status-failed', task_status: 'failed' } });
      }
      return json({ code: 'invalid_request_error', message: 'invalid prompt' }, 400);
    });
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new BaiduQianfanAdapter();
    adapter.configure('qianfan-key', { generationType: 'video' });

    await expect(adapter.checkStatus('status-failed')).resolves.toBe(JobStatus.Failed);
    await expect(adapter.generate(request())).rejects.toMatchObject({
      code: ErrorCode.InvalidRequest,
    });
    await expect(adapter.cancel('video-task-1')).rejects.toThrow(/does not document/i);
    expect(adapter.executionCapabilities.cancellation).toBe(false);
  });
});
