import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, LucidError, type GenerationRequest } from '@lucid-fin/contracts';
import { SegmindAdapter } from './index.js';

const fetchMock = vi.fn<typeof fetch>();

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'image',
    providerId: 'segmind',
    prompt: 'cinematic fox portrait',
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SegmindAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  it('keeps image and video model configuration separate and returns final assets', async () => {
    const adapter = new SegmindAdapter();
    adapter.configure('sg-key', {
      generationType: 'image',
      model: 'seedream-5-pro',
      pollIntervalMs: 0,
    });
    adapter.configure('sg-key', {
      generationType: 'video',
      model: 'seedance-2.0',
      pollIntervalMs: 0,
    });
    fetchMock
      .mockResolvedValueOnce(
        response({
          request_id: 'image-job',
          status_url: 'https://api.segmind.com/v2/requests/image-job/status',
          response_url: 'https://api.segmind.com/v2/requests/image-job',
        }),
      )
      .mockResolvedValueOnce(response({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        response({ status: 'COMPLETED', output: 'https://assets.example/image.jpg' }),
      );

    await expect(
      adapter.generate(
        request({
          referenceImages: ['data:image/png;base64,YQ=='],
          width: 2048,
          height: 2048,
        }),
      ),
    ).resolves.toMatchObject({ assetPath: 'https://assets.example/image.jpg' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.segmind.com/v2/seedream-5-pro',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({
      prompt: 'cinematic fox portrait',
      image_input: ['data:image/png;base64,YQ=='],
      size: '2K',
    });
  });

  it('maps Seedance frame, audio, duration, and quality fields', async () => {
    const adapter = new SegmindAdapter();
    adapter.configure('sg-key', { generationType: 'video', pollIntervalMs: 0 });
    fetchMock
      .mockResolvedValueOnce(response({ request_id: 'video-job' }))
      .mockResolvedValueOnce(response({ status: 'PROCESSING' }))
      .mockResolvedValueOnce(response({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(
        response({
          status: 'COMPLETED',
          output: 'https://assets.example/video.mp4',
          metrics: { cost: 0.42 },
        }),
      );

    const result = await adapter.generate(
      request({
        type: 'video',
        frameReferenceImages: { first: 'https://assets.example/first.png' },
        duration: 8,
        quality: '1080p',
        audio: true,
      }),
    );

    expect(result).toMatchObject({ assetPath: 'https://assets.example/video.mp4', cost: 0.42 });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.segmind.com/v2/seedance-2.0',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({
      duration: 8,
      resolution: '1080p',
      generate_audio: true,
      first_frame_url: 'https://assets.example/first.png',
    });
  });

  it('rejects incompatible Seedance conditioning instead of dropping references', async () => {
    const adapter = new SegmindAdapter();
    adapter.configure('sg-key', { generationType: 'video' });
    await expect(
      adapter.generate(
        request({
          type: 'video',
          frameReferenceImages: { first: 'https://assets.example/first.png' },
          referenceImages: ['https://assets.example/character.png'],
        }),
      ),
    ).rejects.toMatchObject<Partial<LucidError>>({ code: ErrorCode.InvalidRequest });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses a non-mutating status probe for credential validation', async () => {
    const adapter = new SegmindAdapter();
    adapter.configure('sg-key');
    fetchMock.mockResolvedValueOnce(response({ detail: 'not found' }, 404));
    await expect(adapter.validate()).resolves.toBe(true);
    fetchMock.mockResolvedValueOnce(response({ detail: 'unauthorized' }, 401));
    await expect(adapter.validate()).resolves.toBe(false);
  });
});
