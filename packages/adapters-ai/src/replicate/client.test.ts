import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import { createPrediction } from './client.js';

describe('Replicate client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('surfaces the response body when Replicate rejects a request with 422', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: 'The selected model does not support width/height for this input.',
        }),
        {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await expect(
      createPrediction(
        'sk-replicate',
        'black-forest-labs/flux-1.1-pro',
        { prompt: 'hero frame', width: 1024, height: 1024 },
        'Replicate',
      ),
    ).rejects.toMatchObject<Partial<LucidError>>({
      code: ErrorCode.InvalidRequest,
      message: expect.stringContaining('width/height'),
      details: expect.objectContaining({
        provider: 'Replicate',
        model: 'black-forest-labs/flux-1.1-pro',
        status: 422,
      }),
    });
  });
});
