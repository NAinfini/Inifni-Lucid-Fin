import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAIDalleAdapter } from './openai-dalle/index.js';
import { RunwayAdapter } from './runway/index.js';
import type { GenerationRequest } from '@lucid-fin/contracts';

function makeImageRequest(): GenerationRequest {
  return {
    type: 'image',
    providerId: 'openai-dalle',
    prompt: 'cinematic skyline',
    width: 1024,
    height: 1024,
  };
}

function makeVideoRequest(): GenerationRequest {
  return {
    type: 'video',
    providerId: 'runway-gen4',
    prompt: 'slow dolly through a neon alley',
    duration: 5,
    width: 1280,
    height: 720,
  };
}

describe('adapter subscribe support', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('streams synchronous OpenAI image generation through subscribe callbacks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ url: 'https://example.com/image.png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const adapter = new OpenAIDalleAdapter();
    adapter.configure('sk-test');

    if (!adapter.subscribe) {
      throw new Error('OpenAIDalleAdapter.subscribe must be implemented');
    }

    const queueUpdates: Array<{ status: string }> = [];
    const progressUpdates: Array<{ percentage: number; currentStep?: string }> = [];

    const result = await adapter.subscribe(makeImageRequest(), {
      onQueueUpdate: (update) => queueUpdates.push({ status: update.status }),
      onProgress: (update) =>
        progressUpdates.push({
          percentage: update.percentage,
          currentStep: update.currentStep,
        }),
    });

    expect(result.assetPath).toBe('https://example.com/image.png');
    expect(queueUpdates.map((update) => update.status)).toEqual(['processing', 'completed']);
    expect(progressUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ percentage: 5 }),
        expect.objectContaining({ percentage: 100, currentStep: 'completed' }),
      ]),
    );
  });

  it('polls Runway task progress through subscribe and returns the final asset url', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'task-1', status: 'PENDING' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'task-1',
              status: 'RUNNING',
              progress: 0.4,
              progress_text: 'rendering',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: 'task-1',
              status: 'SUCCEEDED',
              progress: 1,
              output: ['https://example.com/video.mp4'],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        ),
    );

    const adapter = new RunwayAdapter();
    adapter.configure('sk-test', { pollIntervalMs: 0 });

    if (!adapter.subscribe) {
      throw new Error('RunwayAdapter.subscribe must be implemented');
    }

    const queueUpdates: Array<{ status: string; jobId?: string }> = [];
    const progressUpdates: Array<{ percentage: number; currentStep?: string; jobId?: string }> =
      [];

    const result = await adapter.subscribe(makeVideoRequest(), {
      onQueueUpdate: (update) =>
        queueUpdates.push({
          status: update.status,
          jobId: update.jobId,
        }),
      onProgress: (update) =>
        progressUpdates.push({
          percentage: update.percentage,
          currentStep: update.currentStep,
          jobId: update.jobId,
        }),
    });

    expect(result).toEqual(
      expect.objectContaining({
        provider: 'runway-gen4',
        assetPath: 'https://example.com/video.mp4',
        metadata: expect.objectContaining({
          taskId: 'task-1',
          status: 'SUCCEEDED',
          url: 'https://example.com/video.mp4',
        }),
      }),
    );
    expect(queueUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'queued', jobId: 'task-1' }),
        expect.objectContaining({ status: 'processing', jobId: 'task-1' }),
        expect.objectContaining({ status: 'completed', jobId: 'task-1' }),
      ]),
    );
    expect(progressUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          percentage: 40,
          currentStep: 'rendering',
          jobId: 'task-1',
        }),
        expect.objectContaining({
          percentage: 100,
          currentStep: 'completed',
          jobId: 'task-1',
        }),
      ]),
    );
  });
});
