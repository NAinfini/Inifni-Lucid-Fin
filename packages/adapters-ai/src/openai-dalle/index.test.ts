import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIDalleAdapter } from './index.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('OpenAIDalleAdapter', () => {
  it('uses GPT Image 2 generation for requests without references', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new OpenAIDalleAdapter();
    adapter.configure('sk-test');

    await adapter.generate({
      type: 'image',
      providerId: adapter.id,
      prompt: 'cinematic style plate',
      width: 1024,
      height: 1024,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'gpt-image-2',
      quality: 'auto',
      size: '1024x1024',
    });
  });

  it('sends all reference images to the ordered Image API edits payload', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-openai-ref-'));
    tempDirs.push(directory);
    const first = path.join(directory, 'character.png');
    const second = path.join(directory, 'wardrobe.webp');
    fs.writeFileSync(first, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(second, Buffer.from('RIFF0000WEBP'));

    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new OpenAIDalleAdapter();
    adapter.configure('sk-test');

    await adapter.generate({
      type: 'image',
      providerId: adapter.id,
      prompt: 'preserve the same character and wardrobe',
      referenceImages: [first, second],
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect(init.headers).not.toHaveProperty('Content-Type');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-image-2');
    expect(form.getAll('image[]').map((entry) => (entry as File).name)).toEqual([
      'character.png',
      'wardrobe.webp',
    ]);
  });

  it('uses current GPT Image 2 output prices and reserves reference-input cost', () => {
    const adapter = new OpenAIDalleAdapter();

    expect(
      adapter.estimateCost({
        type: 'image',
        providerId: adapter.id,
        prompt: 'style plate',
        width: 1024,
        height: 1024,
        quality: 'high',
      }).estimatedCost,
    ).toBe(0.216);
    expect(
      adapter.estimateCost({
        type: 'image',
        providerId: adapter.id,
        prompt: 'preserve both references',
        width: 1536,
        height: 1024,
        quality: 'medium',
        referenceImages: ['character.png', 'wardrobe.png'],
      }).estimatedCost,
    ).toBe(0.246);
    expect(
      adapter.estimateCost({
        type: 'image',
        providerId: adapter.id,
        prompt: 'edit this frame',
        quality: 'low',
        sourceImageHash: 'asset-hash',
      }).estimatedCost,
    ).toBe(0.111);
  });

  it('conservatively scales unlisted GPT Image 2 resolutions', () => {
    const adapter = new OpenAIDalleAdapter();
    const estimate = adapter.estimateCost({
      type: 'image',
      providerId: adapter.id,
      prompt: '4K establishing frame',
      width: 3840,
      height: 2160,
      quality: 'high',
    });

    expect(estimate.estimatedCost).toBeGreaterThan(2);
  });
});
