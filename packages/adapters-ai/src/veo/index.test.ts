import { afterEach, describe, expect, it, vi } from 'vitest';
import { VeoAdapter } from './index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VeoAdapter (Gemini Omni Flash)', () => {
  it('uses the Interactions API for image-conditioned video and returns inline mp4 data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'interaction-video-1',
          steps: [
            {
              type: 'model_output',
              content: [{ type: 'video', mime_type: 'video/mp4', data: 'video-bytes' }],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new VeoAdapter();
    adapter.configure('google-key', { model: 'gemini-omni-flash-preview' });

    const result = await adapter.generate({
      type: 'video',
      providerId: 'google-video',
      prompt: 'A slow camera orbit',
      duration: 6,
      width: 720,
      height: 1280,
      sourceImagePath: 'data:image/jpeg;base64,source-frame',
    });

    expect(result.assetPath).toBe('data:video/mp4;base64,video-bytes');
    expect(result.cost).toBeCloseTo(0.6);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gemini-omni-flash-preview',
      input: [
        { type: 'image', mime_type: 'image/jpeg', data: 'source-frame' },
        { type: 'text', text: 'A slow camera orbit' },
      ],
      response_format: { type: 'video', aspect_ratio: '9:16' },
      generation_config: { video_config: { task: 'image_to_video' } },
    });
  });

  it('rejects last-frame interpolation before provider submission', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new VeoAdapter();
    adapter.configure('google-key');

    await expect(
      adapter.generate({
        type: 'video',
        providerId: 'google-video',
        prompt: 'interpolate',
        frameReferenceImages: { first: 'data:image/png;base64,a', last: 'data:image/png;base64,b' },
      }),
    ).rejects.toThrow('does not support first/last-frame interpolation');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses capability-scoped OAuth headers without an API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_video: { mime_type: 'video/mp4', data: 'oauth-video' },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new VeoAdapter({
      id: 'google-veo-2-oauth',
      credentialMode: 'oauth',
      oauthTarget: { provider: 'gemini', capability: 'video' },
      authorizationHeaders: async () => ({
        Authorization: 'Bearer video-token',
        'x-goog-user-project': 'quota-project',
      }),
    });
    adapter.configure('');

    await adapter.generate({
      type: 'video',
      providerId: 'google-video-oauth',
      prompt: 'OAuth video',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer video-token',
      'x-goog-user-project': 'quota-project',
    });
    expect(init.headers).not.toHaveProperty('x-goog-api-key');
  });
});
