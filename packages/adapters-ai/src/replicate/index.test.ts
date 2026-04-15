import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { ReplicateAdapter } from './index.js';

const clientMocks = vi.hoisted(() => ({
  createPrediction: vi.fn(),
  getPrediction: vi.fn(),
  cancelPrediction: vi.fn(),
  toJobStatus: vi.fn(),
}));

vi.mock('./client.js', () => clientMocks);

describe('ReplicateAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the configured video model and sora reference field for image-to-video', async () => {
    clientMocks.createPrediction.mockResolvedValue({
      id: 'prediction-1',
      status: 'succeeded',
      output: 'https://example.com/video.mp4',
    });

    const adapter = new ReplicateAdapter();
    adapter.configure('sk-replicate', { model: 'openai/sora-2', generationType: 'video' });

    const request: GenerationRequest = {
      type: 'video',
      providerId: 'replicate',
      prompt: 'A cinematic flyover of a neon city',
      referenceImages: ['https://example.com/frame.png'],
      duration: 5,
    };

    const result = await adapter.generate(request);

    expect(adapter.capabilities).toContain('image-to-video');
    expect(clientMocks.createPrediction).toHaveBeenCalledWith(
      'sk-replicate',
      'openai/sora-2',
      expect.objectContaining({
        prompt: 'A cinematic flyover of a neon city',
        input_reference: 'https://example.com/frame.png',
      }),
      'Replicate',
      'https://api.replicate.com/v1',
    );
    expect(result).toMatchObject({
      assetPath: 'https://example.com/video.mp4',
      provider: 'replicate',
    });
  });
});
