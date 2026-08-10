import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleImagen3Adapter } from './index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GoogleImagen3Adapter', () => {
  it('uses the current Gemini Interactions API and returns the final image block', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'interaction-1',
          steps: [
            {
              type: 'model_output',
              content: [{ type: 'image', mime_type: 'image/png', data: 'final-image' }],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new GoogleImagen3Adapter();
    adapter.configure('google-key', {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.1-flash-image',
    });

    const result = await adapter.generate({
      type: 'image',
      providerId: 'google-image',
      prompt: 'A cinematic lighthouse',
      width: 2048,
      height: 1152,
      referenceImages: ['data:image/png;base64,reference-image'],
    });

    expect(result.assetPath).toBe('data:image/png;base64,final-image');
    expect(result.metadata).toMatchObject({
      interactionId: 'interaction-1',
      model: 'gemini-3.1-flash-image',
      referenceImageCount: 1,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'google-key' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gemini-3.1-flash-image',
      response_format: { type: 'image', aspect_ratio: '16:9', image_size: '2K' },
      input: [
        { type: 'text', text: 'A cinematic lighthouse' },
        { type: 'image', mime_type: 'image/png', data: 'reference-image' },
      ],
    });
  });

  it('rejects malformed successful responses instead of returning an empty asset', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 'interaction-empty', steps: [] }), { status: 200 }),
        ),
    );
    const adapter = new GoogleImagen3Adapter();
    adapter.configure('google-key');

    await expect(
      adapter.generate({ type: 'image', providerId: 'google-image', prompt: 'test' }),
    ).rejects.toThrow('did not include an output image');
  });

  it('uses capability-scoped OAuth headers without an API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_image: { mime_type: 'image/png', data: 'oauth-image' },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new GoogleImagen3Adapter({
      id: 'google-imagen3-oauth',
      credentialMode: 'oauth',
      oauthTarget: { provider: 'gemini', capability: 'image' },
      authorizationHeaders: async () => ({
        Authorization: 'Bearer image-token',
        'x-goog-user-project': 'quota-project',
      }),
    });
    adapter.configure('');

    await adapter.generate({
      type: 'image',
      providerId: 'google-image-oauth',
      prompt: 'OAuth image',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer image-token',
      'x-goog-user-project': 'quota-project',
    });
    expect(init.headers).not.toHaveProperty('x-goog-api-key');
  });
});
