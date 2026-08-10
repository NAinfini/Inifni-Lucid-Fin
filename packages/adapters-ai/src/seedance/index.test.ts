import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { SeedanceAdapter } from './index.js';
import { toSeedanceInput } from './mapper.js';

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'video',
    providerId: 'seedance-2',
    prompt: 'The same character walks through the approved location.',
    duration: 6,
    seed: 42,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Seedance 2.0 adapter', () => {
  it('maps ordered generic references to the official reference_images field', () => {
    expect(
      toSeedanceInput(
        request({
          referenceImages: ['https://assets.example/character.png', 'data:image/png;base64,Yg=='],
          audio: true,
          params: { resolution: '1080p', aspect_ratio: '16:9' },
        }),
      ),
    ).toEqual({
      prompt: 'The same character walks through the approved location.',
      reference_images: ['https://assets.example/character.png', 'data:image/png;base64,Yg=='],
      seed: 42,
      duration: 6,
      resolution: '1080p',
      aspect_ratio: '16:9',
      generate_audio: true,
    });
  });

  it('uses the official first/last-frame fields only when generic references are absent', () => {
    expect(
      toSeedanceInput(
        request({
          frameReferenceImages: {
            first: 'https://assets.example/first.png',
            last: 'https://assets.example/last.png',
          },
        }),
      ),
    ).toMatchObject({
      image: 'https://assets.example/first.png',
      last_frame_image: 'https://assets.example/last.png',
    });
  });

  it.each([
    {
      label: 'ordered references with a frame input',
      overrides: {
        referenceImages: ['https://assets.example/character.png'],
        frameReferenceImages: { first: 'https://assets.example/first.png' },
      },
      error: /cannot combine ordered references/i,
    },
    {
      label: 'a last frame without a first frame',
      overrides: {
        frameReferenceImages: { last: 'https://assets.example/last.png' },
      },
      error: /last frame requires a first frame/i,
    },
    {
      label: 'a materialized source image with an explicit first frame',
      overrides: {
        sourceImagePath: 'C:\\tmp\\source.png',
        frameReferenceImages: { first: 'https://assets.example/first.png' },
      },
      error: /cannot combine a source image with an explicit first frame/i,
    },
  ])('rejects $label before calling Replicate', async ({ overrides, error }) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new SeedanceAdapter();

    await expect(adapter.generate(request(overrides))).rejects.toThrow(error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reserves the current non-video-input price by output resolution and duration', () => {
    const adapter = new SeedanceAdapter();
    expect(adapter.estimateCost(request({ height: 1080, duration: 6 }))).toMatchObject({
      estimatedCost: 2.7,
      unit: 'per second of output video',
    });
    expect(adapter.estimateCost(request({ height: 2160, duration: -1 }))).toMatchObject({
      estimatedCost: 15,
    });
  });

  it('uploads local references in order and submits them to the official Seedance 2.0 model', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-seedance-'));
    const first = path.join(root, 'character.png');
    const second = path.join(root, 'location.png');
    fs.writeFileSync(first, Buffer.from('character'));
    fs.writeFileSync(second, Buffer.from('location'));

    const predictionBodies: Array<Record<string, unknown>> = [];
    let upload = 0;
    const fetchMock = vi.fn(async (input: Request | string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/files')) {
        upload += 1;
        return new Response(
          JSON.stringify({
            id: `file-${upload}`,
            urls: { get: `https://api.replicate.com/v1/files/file-${upload}` },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/models/bytedance/seedance-2.0/predictions')) {
        predictionBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            id: 'prediction-1',
            status: 'succeeded',
            output: 'https://replicate.delivery/generated.mp4',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected Replicate request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const adapter = new SeedanceAdapter();
      adapter.configure('test-token');
      await expect(
        adapter.generate(request({ referenceImages: [first, second] })),
      ).resolves.toMatchObject({
        assetPath: 'https://replicate.delivery/generated.mp4',
        provider: 'seedance-2',
        metadata: { predictionId: 'prediction-1', model: 'bytedance/seedance-2.0' },
      });

      expect(predictionBodies).toHaveLength(1);
      expect(predictionBodies[0]).toMatchObject({
        input: {
          reference_images: [
            'https://api.replicate.com/v1/files/file-1',
            'https://api.replicate.com/v1/files/file-2',
          ],
        },
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
