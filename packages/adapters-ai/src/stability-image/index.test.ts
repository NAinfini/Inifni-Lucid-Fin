import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { StabilityImageAdapter } from './index.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'image',
    providerId: 'stability-image',
    prompt: 'A lantern on a cliff above a stormy sea',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('StabilityImageAdapter', () => {
  it('submits official Stable Image Core multipart data and converts JSON base64 output', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ image: 'aGVsbG8=' }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new StabilityImageAdapter();
    adapter.configure('stability-test');

    const result = await adapter.generate(request({ width: 1920, height: 1080 }));

    expect(result.assetPath).toBe('data:image/png;base64,aGVsbG8=');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stability.ai/v2beta/stable-image/generate/core');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer stability-test',
      Accept: 'application/json',
    });
    expect(init.headers).not.toHaveProperty('Content-Type');
    const form = init.body as FormData;
    expect(form.get('prompt')).toBe('A lantern on a cliff above a stormy sea');
    expect(form.get('aspect_ratio')).toBe('16:9');
    expect(form.get('output_format')).toBe('png');
  });

  it('uses the requested JSON output format when producing the data URL', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ image: 'd2VicA==' }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new StabilityImageAdapter();
    adapter.configure('stability-test');

    await expect(
      adapter.generate(request({ params: { output_format: 'webp' } })),
    ).resolves.toMatchObject({ assetPath: 'data:image/webp;base64,d2VicA==' });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
