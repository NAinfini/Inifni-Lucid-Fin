import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobStatus, type GenerationRequest } from '@lucid-fin/contracts';
import { MiniMaxAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'video',
    providerId: 'minimax-video01',
    prompt: 'A lantern drifts through a moonlit forest.',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MiniMax H3 and Hailuo 2.3 adapter', () => {
  it('uses MiniMax-H3 by default and returns the direct V2 task content URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'h3-task-1' }))
      .mockResolvedValueOnce(jsonResponse({ task: { id: 'h3-task-1', status: 'running' } }))
      .mockResolvedValueOnce(
        jsonResponse({
          task: {
            id: 'h3-task-1',
            model: 'MiniMax-H3',
            status: 'succeeded',
            content: { url: 'https://files.example/h3-video.mp4' },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MiniMaxAdapter();
    adapter.configure('test-key', { pollIntervalMs: 0, maxPollAttempts: 2 });

    const result = await adapter.generate(request());

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.minimax.io/v2/video_generation');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: 'A lantern drifts through a moonlit forest.' }],
      duration: 5,
      resolution: '2K',
      ratio: '16:9',
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://api.minimax.io/v2/query/video_generation/h3-task-1',
    );
    expect(result).toMatchObject({
      assetPath: 'https://files.example/h3-video.mp4',
      provider: 'minimax-video01',
      metadata: {
        taskId: 'h3-task-1',
        status: 'succeeded',
        model: 'MiniMax-H3',
        apiVersion: 'v2',
        download_url: 'https://files.example/h3-video.mp4',
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('maps H3 first and last frames to V2 content roles', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'h3-task-2' }))
      .mockResolvedValueOnce(
        jsonResponse({
          task: {
            id: 'h3-task-2',
            status: 'succeeded',
            content: { url: 'https://files.example/h3-first-last.mp4' },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new MiniMaxAdapter();
    adapter.configure('test-key', { pollIntervalMs: 0, maxPollAttempts: 1 });

    await adapter.generate(
      request({
        duration: 4,
        params: { resolution: '768P' },
        frameReferenceImages: {
          first: 'https://images.example/first.png',
          last: 'https://images.example/last.png',
        },
      }),
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      model: 'MiniMax-H3',
      content: [
        { type: 'text', text: 'A lantern drifts through a moonlit forest.' },
        {
          type: 'image_url',
          image_url: { url: 'https://images.example/first.png' },
          role: 'first_frame',
        },
        {
          type: 'image_url',
          image_url: { url: 'https://images.example/last.png' },
          role: 'last_frame',
        },
      ],
      duration: 4,
      resolution: '768P',
    });
  });

  it('maps ordered image, video, and audio references to H3 multimodal content items', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'h3-task-3' }))
      .mockResolvedValueOnce(
        jsonResponse({
          task: {
            id: 'h3-task-3',
            status: 'succeeded',
            content: { url: 'https://files.example/h3-reference.mp4' },
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new MiniMaxAdapter();
    adapter.configure('test-key', { pollIntervalMs: 0, maxPollAttempts: 1 });

    const result = await adapter.generate(
      request({
        params: {
          resolution: '2K',
          ratio: 'adaptive',
          reference_video_urls: ['https://media.example/motion.mp4'],
          reference_audio_urls: ['data:audio/mpeg;base64,YXVkaW8='],
        },
        referenceImages: [
          'https://images.example/character.png',
          'https://images.example/style.png',
        ],
      }),
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      model: 'MiniMax-H3',
      content: [
        { type: 'text', text: 'A lantern drifts through a moonlit forest.' },
        {
          type: 'image_url',
          image_url: { url: 'https://images.example/character.png' },
          role: 'reference_image',
        },
        {
          type: 'image_url',
          image_url: { url: 'https://images.example/style.png' },
          role: 'reference_image',
        },
        {
          type: 'video_url',
          video_url: { url: 'https://media.example/motion.mp4' },
          role: 'reference_video',
        },
        {
          type: 'audio_url',
          audio_url: { url: 'data:audio/mpeg;base64,YXVkaW8=' },
          role: 'reference_audio',
        },
      ],
      duration: 5,
      resolution: '2K',
      ratio: 'adaptive',
    });
    expect(result.assetPath).toBe('https://files.example/h3-reference.mp4');
    expect(adapter.estimateCost(request({ duration: 5 }))).toMatchObject({
      estimatedCost: 0.65,
      unit: 'per second plus billable reference inputs',
    });
  });

  it('uses the documented H3 DELETE endpoint for cancellation', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ task_id: 'h3-task-4', action: 'cancelled', status: 'cancelled' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new MiniMaxAdapter();
    adapter.configure('test-key');

    await expect(adapter.cancel('h3-task-4')).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.minimax.io/v2/video_generation/h3-task-4',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('preserves Hailuo 2.3 V1 submission, polling, and file retrieval', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          task_id: 'v1-task-1',
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ task_id: 'v1-task-1', status: 'Preparing', base_resp: { status_code: 0 } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          task_id: 'v1-task-1',
          status: 'Success',
          file_id: 'file-1',
          base_resp: { status_code: 0 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          file: { file_id: 'file-1', download_url: 'https://files.example/v1-video.mp4' },
          base_resp: { status_code: 0 },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MiniMaxAdapter();
    adapter.configure('test-key', {
      model: 'MiniMax-Hailuo-2.3',
      pollIntervalMs: 0,
      maxPollAttempts: 3,
    });

    const result = await adapter.generate(
      request({
        duration: 10,
        params: { resolution: '768P', prompt_optimizer: false },
      }),
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.minimax.io/v1/video_generation');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      prompt: 'A lantern drifts through a moonlit forest.',
      model: 'MiniMax-Hailuo-2.3',
      duration: 10,
      resolution: '768P',
      prompt_optimizer: false,
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://api.minimax.io/v1/query/video_generation?task_id=v1-task-1',
    );
    expect(String(fetchMock.mock.calls[3]?.[0])).toBe(
      'https://api.minimax.io/v1/files/retrieve?file_id=file-1',
    );
    expect(result.assetPath).toBe('https://files.example/v1-video.mp4');
  });

  it('preserves Hailuo 2.3 Fast image-to-video subscriptions', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'fast-task', base_resp: { status_code: 0 } }))
      .mockResolvedValueOnce(
        jsonResponse({
          task_id: 'fast-task',
          status: 'Success',
          file_id: 'fast-file',
          base_resp: { status_code: 0 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          file: { download_url: 'https://files.example/fast-video.mp4' },
          base_resp: { status_code: 0 },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MiniMaxAdapter();
    adapter.configure('test-key', {
      model: 'MiniMax-Hailuo-2.3-Fast',
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });
    const queueUpdates: string[] = [];

    const result = await adapter.subscribe(
      request({
        frameReferenceImages: {
          first: 'https://images.example/first.png',
          last: 'https://images.example/last.png',
        },
      }),
      { onQueueUpdate: (update) => queueUpdates.push(update.status) },
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'MiniMax-Hailuo-2.3-Fast',
      first_frame_image: 'https://images.example/first.png',
      last_frame_image: 'https://images.example/last.png',
      prompt_optimizer: true,
      duration: 6,
      resolution: '768P',
    });
    expect(queueUpdates).toEqual(['queued', 'completed']);
    expect(result.assetPath).toBe('https://files.example/fast-video.mp4');
  });

  it('rejects unsupported combinations before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new MiniMaxAdapter();
    adapter.configure('test-key', { pollIntervalMs: 0 });

    await expect(adapter.generate(request({ params: { model: 'T2V-02' } }))).rejects.toThrow(
      /supports/i,
    );
    await expect(adapter.generate(request({ duration: 3 }))).rejects.toThrow(/4 to 15 seconds/i);
    await expect(
      adapter.generate(
        request({
          frameReferenceImages: { first: 'https://images.example/first.png' },
          referenceImages: ['https://images.example/reference.png'],
        }),
      ),
    ).rejects.toThrow(/cannot combine references/i);

    adapter.configure('test-key', { model: 'MiniMax-Hailuo-2.3', pollIntervalMs: 0 });
    await expect(
      adapter.generate(request({ duration: 10, params: { resolution: '1080P' } })),
    ).rejects.toThrow(/768P videos for 6 or 10 seconds/i);

    adapter.configure('test-key', { model: 'MiniMax-Hailuo-2.3-Fast', pollIntervalMs: 0 });
    await expect(adapter.generate(request())).rejects.toThrow(/image-to-video generation only/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['queued', JobStatus.Queued],
    ['running', JobStatus.Running],
    ['succeeded', JobStatus.Completed],
    ['failed', JobStatus.Failed],
    ['cancelled', JobStatus.Cancelled],
  ])('maps the exact H3 %s status', async (providerStatus, expectedStatus) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ task: { status: providerStatus } })),
    );
    const adapter = new MiniMaxAdapter();
    adapter.configure('test-key');

    await expect(adapter.checkStatus('h3-status')).resolves.toBe(expectedStatus);
  });

  it.each([
    ['Queueing', JobStatus.Queued],
    ['Preparing', JobStatus.Queued],
    ['Processing', JobStatus.Running],
    ['Success', JobStatus.Completed],
    ['Fail', JobStatus.Failed],
  ])('maps the exact Hailuo V1 %s status', async (providerStatus, expectedStatus) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ status: providerStatus, base_resp: { status_code: 0 } })),
    );
    const adapter = new MiniMaxAdapter();
    adapter.configure('test-key', { model: 'MiniMax-Hailuo-2.3' });

    await expect(adapter.checkStatus('v1-status')).resolves.toBe(expectedStatus);
  });

  it('surfaces the provider failure message from a Hailuo V1 task', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'v1-task-2', base_resp: { status_code: 0 } }))
      .mockResolvedValueOnce(
        jsonResponse({
          task_id: 'v1-task-2',
          status: 'Fail',
          error_message: 'The requested video was rejected by MiniMax policy.',
          base_resp: { status_code: 0 },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new MiniMaxAdapter();
    adapter.configure('test-key', {
      model: 'MiniMax-Hailuo-2.3',
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });

    await expect(adapter.generate(request())).rejects.toThrow(
      'The requested video was rejected by MiniMax policy.',
    );
  });
});
