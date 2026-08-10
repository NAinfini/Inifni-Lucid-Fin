import { describe, expect, it } from 'vitest';
import { getBuiltinMediaProvider, listBuiltinMediaProviders } from './media-provider-catalog.js';

describe('built-in media provider catalog', () => {
  it('keeps provider IDs unique within each settings group', () => {
    const entries = listBuiltinMediaProviders(undefined, { includeExcluded: true });
    const keys = entries.map((entry) => `${entry.group}:${entry.providerId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('contains only usable providers in the default public list', () => {
    const entries = listBuiltinMediaProviders();
    expect(entries.length).toBeGreaterThanOrEqual(30);
    expect(entries.every((entry) => entry.access !== 'excluded')).toBe(true);
    expect(entries.every((entry) => entry.allowedHosts.length > 0)).toBe(true);
    expect(entries.every((entry) => entry.docsUrl.startsWith('https://'))).toBe(true);
  });

  it('pins the researched current MiniMax and Google models', () => {
    expect(getBuiltinMediaProvider('video', 'minimax')).toMatchObject({
      model: 'MiniMax-H3',
      baseUrl: 'https://api.minimax.io',
      defaultDurationSeconds: 5,
      supportsAudio: true,
    });
    expect(getBuiltinMediaProvider('video', 'fal')).toMatchObject({
      model: 'minimax/h3/text-to-video',
      adapterId: 'fal-ai',
    });
    expect(getBuiltinMediaProvider('image', 'fal')).toMatchObject({
      model: 'fal-ai/flux-2-pro',
    });
    expect(getBuiltinMediaProvider('video', 'replicate')).toMatchObject({
      model: 'minimax/hailuo-2.3',
    });
    expect(getBuiltinMediaProvider('image', 'google-image')).toMatchObject({
      model: 'gemini-3.1-flash-image',
    });
    expect(getBuiltinMediaProvider('video', 'google-video')).toMatchObject({
      model: 'gemini-omni-flash-preview',
    });
  });

  it('removes obsolete shortcut cards while retaining the supported Hunyuan hub route', () => {
    expect(getBuiltinMediaProvider('image', 'kolors')).toBeUndefined();
    expect(getBuiltinMediaProvider('video', 'wan')).toBeUndefined();
    expect(getBuiltinMediaProvider('video', 'hunyuan')).toMatchObject({
      adapterId: 'replicate',
      model: 'tencent/hunyuan-video',
    });
  });

  it('includes every researched first-party and major hub transport in the runtime catalog', () => {
    expect(listBuiltinMediaProviders('image').map((entry) => entry.providerId)).toEqual(
      expect.arrayContaining(['bria', 'baidu-qianfan', 'krea', 'higgsfield', 'segmind', 'freepik']),
    );
    expect(listBuiltinMediaProviders('video').map((entry) => entry.providerId)).toEqual(
      expect.arrayContaining([
        'ltx',
        'alibaba-wan-video',
        'baidu-qianfan',
        'pixverse',
        'krea',
        'higgsfield',
        'segmind',
        'freepik',
      ]),
    );
    expect(getBuiltinMediaProvider('video', 'alibaba-wan-video')).toMatchObject({
      model: 'wan2.7-t2v',
      adapterId: 'alibaba-wan-video',
      supportsReferenceImage: true,
      supportsAudio: true,
    });
    expect(getBuiltinMediaProvider('video', 'pixverse')).toMatchObject({
      model: 'v6',
      adapterId: 'pixverse',
    });
  });

  it('documents non-public or unsafe direct integrations without exposing them as defaults', () => {
    const excluded = listBuiltinMediaProviders(undefined, { includeExcluded: true }).filter(
      (entry) => entry.access === 'excluded',
    );
    expect(excluded.map((entry) => entry.providerId)).toEqual(
      expect.arrayContaining([
        'adobe-firefly',
        'amazon-nova-canvas',
        'amazon-nova-reel',
        'heygen-avatar-video',
        'midjourney',
        'openai-sora',
        'pika',
        'stepfun-video',
        'tencent-hunyuan-video',
      ]),
    );
    expect(excluded.every((entry) => Boolean(entry.excludedReason))).toBe(true);
  });
});
