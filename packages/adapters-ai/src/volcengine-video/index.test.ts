import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VolcengineVideoAdapter } from './index.js';

describe('VolcengineVideoAdapter', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('submits, polls, and returns the generated video URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'cgt-1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'cgt-1',
              status: 'succeeded',
              content: { video_url: 'https://cdn.example/video.mp4' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
    );
    const adapter = new VolcengineVideoAdapter();
    adapter.configure('test', { pollIntervalMs: 0 });
    const result = await adapter.generate({
      type: 'video',
      providerId: 'volcengine-video',
      prompt: 'camera circles a dancer',
      duration: 5,
      width: 1280,
      height: 720,
    });
    expect(result.assetPath).toBe('https://cdn.example/video.mp4');
  });
});
