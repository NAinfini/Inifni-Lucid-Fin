import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pZ+j9QAAAAASUVORK5CYII=';
const MINIMAL_MP4_BASE64 = Buffer.from([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d,
  0x69, 0x73, 0x6f, 0x32,
]).toString('base64');

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

import {
  normalizeOptionalString,
  normalizeErrorMessage,
  normalizePresetLookupValue,
  resolvePositiveInteger,
  capitalizeUpdateStatus,
  isRemoteUrl,
  extensionFromUrl,
  inferRemoteExtension,
  requireGenerateArgs,
  requireEstimateArgs,
  requireCancelArgs,
  materializeAsset,
  resolveImg2ImgSourcePath,
  materializeGenerationRequest,
  mergeVariants,
  buildAdhocAdapter,
  DEFAULT_IMAGE_SIZE,
  DEFAULT_VIDEO_SIZE,
  DEFAULT_VIDEO_DURATION,
  DEFAULT_AUDIO_DURATION,
  MAX_VARIANTS,
  MAX_ACCUMULATED_VARIANTS,
  DEFAULT_STYLE_GUIDE,
  STYLE_GUIDE_LIGHTING_PRESETS,
} from './generation-helpers.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('DEFAULT_IMAGE_SIZE is 1024x1024', () => {
    expect(DEFAULT_IMAGE_SIZE).toEqual({ width: 1024, height: 1024 });
  });

  it('DEFAULT_VIDEO_SIZE is 1280x720', () => {
    expect(DEFAULT_VIDEO_SIZE).toEqual({ width: 1280, height: 720 });
  });

  it('DEFAULT_VIDEO_DURATION is 5', () => {
    expect(DEFAULT_VIDEO_DURATION).toBe(5);
  });

  it('DEFAULT_AUDIO_DURATION is 5', () => {
    expect(DEFAULT_AUDIO_DURATION).toBe(5);
  });

  it('MAX_VARIANTS is 9', () => {
    expect(MAX_VARIANTS).toBe(9);
  });

  it('DEFAULT_STYLE_GUIDE has the expected shape', () => {
    expect(DEFAULT_STYLE_GUIDE.global.lighting).toBe('natural');
    expect(DEFAULT_STYLE_GUIDE.global.artStyle).toBe('');
    expect(DEFAULT_STYLE_GUIDE.global.referenceImages).toEqual([]);
    expect(DEFAULT_STYLE_GUIDE.sceneOverrides).toEqual({});
  });

  it('STYLE_GUIDE_LIGHTING_PRESETS maps lighting modes to scene tokens', () => {
    expect(STYLE_GUIDE_LIGHTING_PRESETS.natural).toBeUndefined();
    expect(STYLE_GUIDE_LIGHTING_PRESETS.studio).toBe('scene:high-key');
    expect(STYLE_GUIDE_LIGHTING_PRESETS.dramatic).toBe('scene:low-key');
    expect(STYLE_GUIDE_LIGHTING_PRESETS.neon).toBe('scene:neon-noir');
    expect(STYLE_GUIDE_LIGHTING_PRESETS.custom).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeOptionalString
// ---------------------------------------------------------------------------

describe('normalizeOptionalString', () => {
  it('returns the trimmed string when it has content', () => {
    expect(normalizeOptionalString('  hello  ')).toBe('hello');
    expect(normalizeOptionalString('world')).toBe('world');
  });

  it('returns undefined for empty strings', () => {
    expect(normalizeOptionalString('')).toBeUndefined();
    expect(normalizeOptionalString('   ')).toBeUndefined();
  });

  it('returns undefined for non-string values', () => {
    expect(normalizeOptionalString(undefined)).toBeUndefined();
    expect(normalizeOptionalString(null)).toBeUndefined();
    expect(normalizeOptionalString(42)).toBeUndefined();
    expect(normalizeOptionalString(0)).toBeUndefined();
    expect(normalizeOptionalString(false)).toBeUndefined();
    expect(normalizeOptionalString({})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeErrorMessage
// ---------------------------------------------------------------------------

describe('normalizeErrorMessage', () => {
  it('returns the error message for Error instances', () => {
    expect(normalizeErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('converts non-Error values to strings', () => {
    expect(normalizeErrorMessage('a string error')).toBe('a string error');
    expect(normalizeErrorMessage(42)).toBe('42');
    expect(normalizeErrorMessage({ code: 500 })).toBe('[object Object]');
    expect(normalizeErrorMessage(undefined)).toBe('undefined');
    expect(normalizeErrorMessage(null)).toBe('null');
  });
});

// ---------------------------------------------------------------------------
// normalizePresetLookupValue
// ---------------------------------------------------------------------------

describe('normalizePresetLookupValue', () => {
  it('lowercases and strips non-alphanumeric characters', () => {
    expect(normalizePresetLookupValue('Cinematic Realism')).toBe('cinematicrealism');
    expect(normalizePresetLookupValue('anime-cel')).toBe('animecel');
    expect(normalizePresetLookupValue('Low Key!')).toBe('lowkey');
  });

  it('returns empty string for undefined', () => {
    expect(normalizePresetLookupValue(undefined)).toBe('');
  });

  it('returns empty string for an empty string', () => {
    expect(normalizePresetLookupValue('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// resolvePositiveInteger
// ---------------------------------------------------------------------------

describe('resolvePositiveInteger', () => {
  it('returns the value when it is a positive integer', () => {
    expect(resolvePositiveInteger(3, 1)).toBe(3);
    expect(resolvePositiveInteger(9, 1)).toBe(9);
    expect(resolvePositiveInteger(1, 5)).toBe(1);
  });

  it('returns the fallback for non-positive, non-integer, or undefined values', () => {
    expect(resolvePositiveInteger(0, 5)).toBe(5);
    expect(resolvePositiveInteger(-1, 5)).toBe(5);
    expect(resolvePositiveInteger(1.5, 5)).toBe(5);
    expect(resolvePositiveInteger(undefined, 5)).toBe(5);
    expect(resolvePositiveInteger(NaN, 5)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// capitalizeUpdateStatus
// ---------------------------------------------------------------------------

describe('capitalizeUpdateStatus', () => {
  it('capitalizes the first character and preserves the rest', () => {
    expect(capitalizeUpdateStatus('pending')).toBe('Pending');
    expect(capitalizeUpdateStatus('processing')).toBe('Processing');
    expect(capitalizeUpdateStatus('completed')).toBe('Completed');
    expect(capitalizeUpdateStatus('Failed')).toBe('Failed');
    expect(capitalizeUpdateStatus('a')).toBe('A');
  });

  it('handles empty string without throwing', () => {
    expect(capitalizeUpdateStatus('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// isRemoteUrl
// ---------------------------------------------------------------------------

describe('isRemoteUrl', () => {
  it('returns true for http and https URLs', () => {
    expect(isRemoteUrl('http://example.com/image.png')).toBe(true);
    expect(isRemoteUrl('https://cdn.example.com/asset')).toBe(true);
    expect(isRemoteUrl('HTTP://CAPS.EXAMPLE.COM')).toBe(true);
    expect(isRemoteUrl('HTTPS://CAPS.EXAMPLE.COM')).toBe(true);
  });

  it('returns false for local paths and data URLs', () => {
    expect(isRemoteUrl('/local/path/to/file.png')).toBe(false);
    expect(isRemoteUrl('C:\\Users\\file.png')).toBe(false);
    expect(isRemoteUrl('data:image/png;base64,abc')).toBe(false);
    expect(isRemoteUrl('')).toBe(false);
    expect(isRemoteUrl('ftp://example.com')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extensionFromUrl
// ---------------------------------------------------------------------------

describe('extensionFromUrl', () => {
  it('extracts the extension from a URL pathname', () => {
    expect(extensionFromUrl('https://cdn.example.com/image.png')).toBe('png');
    expect(extensionFromUrl('https://cdn.example.com/video.mp4')).toBe('mp4');
    expect(extensionFromUrl('https://cdn.example.com/path/file.WEBP')).toBe('webp');
    expect(extensionFromUrl('https://cdn.example.com/file.JPG?token=123')).toBe('jpg');
  });

  it('returns undefined for URLs without a file extension', () => {
    expect(extensionFromUrl('https://cdn.example.com/noext')).toBeUndefined();
    expect(extensionFromUrl('https://cdn.example.com/')).toBeUndefined();
  });

  it('returns undefined for invalid URLs', () => {
    expect(extensionFromUrl('not-a-url')).toBeUndefined();
    expect(extensionFromUrl('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// inferRemoteExtension
// ---------------------------------------------------------------------------

describe('inferRemoteExtension', () => {
  it('prefers URL extension over content-type', () => {
    expect(inferRemoteExtension('https://cdn.example.com/image.png', 'image/jpeg')).toBe('png');
    expect(inferRemoteExtension('https://cdn.example.com/video.mp4', 'video/webm')).toBe('mp4');
  });

  it('falls back to content-type when URL has no extension', () => {
    expect(inferRemoteExtension('https://cdn.example.com/asset', 'image/jpeg')).toBe('jpg');
    expect(inferRemoteExtension('https://cdn.example.com/asset', 'image/webp')).toBe('webp');
    expect(inferRemoteExtension('https://cdn.example.com/asset', 'image/png')).toBe('png');
    expect(inferRemoteExtension('https://cdn.example.com/asset', 'video/mp4')).toBe('mp4');
    expect(inferRemoteExtension('https://cdn.example.com/asset', 'audio/mpeg')).toBe('mp3');
    expect(inferRemoteExtension('https://cdn.example.com/asset', 'audio/wav')).toBe('wav');
  });

  it('falls back to "bin" for unknown content types', () => {
    expect(inferRemoteExtension('https://cdn.example.com/asset', 'application/octet-stream')).toBe('bin');
    expect(inferRemoteExtension('https://cdn.example.com/asset', null)).toBe('bin');
    expect(inferRemoteExtension('https://cdn.example.com/asset', '')).toBe('bin');
  });

  it('strips charset and parameters from content-type before matching', () => {
    expect(inferRemoteExtension('https://cdn.example.com/asset', 'image/png; charset=utf-8')).toBe('png');
    expect(inferRemoteExtension('https://cdn.example.com/asset', 'video/mp4; codecs=avc1')).toBe('mp4');
  });
});

// ---------------------------------------------------------------------------
// requireGenerateArgs
// ---------------------------------------------------------------------------

describe('requireGenerateArgs', () => {
  it('returns canvasId and nodeId for valid args', () => {
    const result = requireGenerateArgs({ canvasId: 'canvas-1', nodeId: 'node-1' });
    expect(result).toEqual({ canvasId: 'canvas-1', nodeId: 'node-1' });
  });

  it('trims whitespace from ids', () => {
    const result = requireGenerateArgs({ canvasId: '  canvas-1  ', nodeId: '  node-1  ' });
    expect(result).toEqual({ canvasId: 'canvas-1', nodeId: 'node-1' });
  });

  it('throws when args are undefined', () => {
    expect(() => requireGenerateArgs(undefined)).toThrow('canvas:generate request is required');
  });

  it('throws when canvasId is missing or blank', () => {
    expect(() => requireGenerateArgs({ canvasId: '', nodeId: 'node-1' })).toThrow(
      'canvasId and nodeId are required',
    );
    expect(() => requireGenerateArgs({ canvasId: '  ', nodeId: 'node-1' })).toThrow(
      'canvasId and nodeId are required',
    );
  });

  it('throws when nodeId is missing or blank', () => {
    expect(() => requireGenerateArgs({ canvasId: 'canvas-1', nodeId: '' })).toThrow(
      'canvasId and nodeId are required',
    );
    expect(() => requireGenerateArgs({ canvasId: 'canvas-1', nodeId: '   ' })).toThrow(
      'canvasId and nodeId are required',
    );
  });
});

// ---------------------------------------------------------------------------
// requireEstimateArgs
// ---------------------------------------------------------------------------

describe('requireEstimateArgs', () => {
  it('returns canvasId, nodeId, and providerId for valid args', () => {
    const result = requireEstimateArgs({
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      providerId: 'provider-1',
    });
    expect(result).toEqual({
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      providerId: 'provider-1',
      providerConfig: undefined,
    });
  });

  it('passes through providerConfig when present', () => {
    const config = { baseUrl: 'https://api.example.com', model: 'my-model' };
    const result = requireEstimateArgs({
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      providerId: 'provider-1',
      providerConfig: config,
    });
    expect(result.providerConfig).toEqual(config);
  });

  it('throws when args are undefined', () => {
    expect(() => requireEstimateArgs(undefined)).toThrow('canvas:estimateCost request is required');
  });

  it('throws when any required field is missing', () => {
    expect(() =>
      requireEstimateArgs({ canvasId: '', nodeId: 'node-1', providerId: 'provider-1' }),
    ).toThrow('canvasId, nodeId and providerId are required');

    expect(() =>
      requireEstimateArgs({ canvasId: 'canvas-1', nodeId: '', providerId: 'provider-1' }),
    ).toThrow('canvasId, nodeId and providerId are required');

    expect(() =>
      requireEstimateArgs({ canvasId: 'canvas-1', nodeId: 'node-1', providerId: '' }),
    ).toThrow('canvasId, nodeId and providerId are required');
  });
});

// ---------------------------------------------------------------------------
// requireCancelArgs
// ---------------------------------------------------------------------------

describe('requireCancelArgs', () => {
  it('returns canvasId and nodeId for valid args', () => {
    const result = requireCancelArgs({ canvasId: 'canvas-1', nodeId: 'node-1' });
    expect(result).toEqual({ canvasId: 'canvas-1', nodeId: 'node-1' });
  });

  it('throws when args are undefined', () => {
    expect(() => requireCancelArgs(undefined)).toThrow('canvas:cancelGeneration request is required');
  });

  it('throws when canvasId or nodeId is blank', () => {
    expect(() => requireCancelArgs({ canvasId: '', nodeId: 'node-1' })).toThrow(
      'canvasId and nodeId are required',
    );
    expect(() => requireCancelArgs({ canvasId: 'canvas-1', nodeId: '' })).toThrow(
      'canvasId and nodeId are required',
    );
  });
});

// ---------------------------------------------------------------------------
// materializeAsset
// ---------------------------------------------------------------------------

describe('materializeAsset', () => {
  it('returns filePath directly for existing local paths', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-gen-test-'));
    const filePath = path.join(tmpDir, 'asset.png');
    fs.writeFileSync(filePath, Buffer.from([1, 2, 3]));

    try {
      const result = await materializeAsset({ assetPath: filePath });
      expect(result).toEqual({ filePath });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws for non-existent local paths', async () => {
    await expect(
      materializeAsset({ assetPath: '/does/not/exist/file.png' }),
    ).rejects.toThrow('Generated asset path not found');
  });

  it('decodes base64 PNG data URLs to a temp file', async () => {
    // 1x1 transparent PNG in base64
    const base64Png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pZ+j9QAAAAASUVORK5CYII=';
    const result = await materializeAsset({ assetPath: base64Png });
    try {
      expect(result.filePath).toMatch(/lucid-fin-gen-.*\.png$/);
      expect(fs.existsSync(result.filePath)).toBe(true);
    } finally {
      fs.rmSync(result.filePath, { force: true });
    }
  });

  it('decodes base64 JPEG data URLs with correct extension', async () => {
    const base64Jpeg = 'data:image/jpeg;base64,/9j/4AAQ';
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const result = await materializeAsset({ assetPath: base64Jpeg });
    expect(result.filePath).toMatch(/\.jpg$/);
  });

  it('decodes base64 video data URLs to a temp file', async () => {
    const base64Video = 'data:video/mp4;base64,AAAAHGZ0eXBtcDQy';
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const result = await materializeAsset({ assetPath: base64Video });
    expect(result.filePath).toMatch(/\.mp4$/);
  });

  it('decodes base64 audio data URLs to a temp file', async () => {
    const base64Audio = 'data:audio/wav;base64,UklGRiQ=';
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    const result = await materializeAsset({ assetPath: base64Audio });
    expect(result.filePath).toMatch(/\.wav$/);
  });

  it('downloads remote URLs and returns filePath, cleanupPath, sourceUrl', async () => {
    const pngBytes = Buffer.from([137, 80, 78, 71]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => pngBytes.buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await materializeAsset({ assetPath: 'https://cdn.example.com/image.png' });
      expect(result.filePath).toMatch(/generated-.*\.png$/);
      expect(result.cleanupPath).toBeDefined();
      expect(result.sourceUrl).toBe('https://cdn.example.com/image.png');
      expect(fs.existsSync(result.filePath)).toBe(true);
      if (result.cleanupPath) {
        fs.rmSync(result.cleanupPath, { recursive: true, force: true });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws when remote download fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(
        materializeAsset({ assetPath: 'https://cdn.example.com/broken.png' }),
      ).rejects.toThrow('Failed to download generated asset: 503');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resolves asset from metadata.url when assetPath is absent', async () => {
    const pngBytes = Buffer.from([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => pngBytes.buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await materializeAsset({
        metadata: { url: 'https://cdn.example.com/image.png' },
      });
      expect(result.sourceUrl).toBe('https://cdn.example.com/image.png');
      if (result.cleanupPath) {
        fs.rmSync(result.cleanupPath, { recursive: true, force: true });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resolves asset from metadata.video_url when assetPath and url are absent', async () => {
    const bytes = Buffer.from([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'video/mp4' },
      arrayBuffer: async () => bytes.buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await materializeAsset({
        metadata: { video_url: 'https://cdn.example.com/video.mp4' },
      });
      expect(result.sourceUrl).toBe('https://cdn.example.com/video.mp4');
      if (result.cleanupPath) {
        fs.rmSync(result.cleanupPath, { recursive: true, force: true });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resolves asset from metadata.output when other fields absent', async () => {
    const bytes = Buffer.from([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => bytes.buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await materializeAsset({
        metadata: { output: 'https://cdn.example.com/output.png' },
      });
      expect(result.sourceUrl).toBe('https://cdn.example.com/output.png');
      if (result.cleanupPath) {
        fs.rmSync(result.cleanupPath, { recursive: true, force: true });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('resolves asset from metadata.download_url as last fallback', async () => {
    const bytes = Buffer.from([1, 2, 3]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => bytes.buffer,
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await materializeAsset({
        metadata: { download_url: 'https://cdn.example.com/dl.png' },
      });
      expect(result.sourceUrl).toBe('https://cdn.example.com/dl.png');
      if (result.cleanupPath) {
        fs.rmSync(result.cleanupPath, { recursive: true, force: true });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('decodes base64 data URL from metadata.url', async () => {
    const base64Png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pZ+j9QAAAAASUVORK5CYII=';
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);

    const result = await materializeAsset({ metadata: { url: base64Png } });
    expect(result.filePath).toMatch(/\.png$/);
  });

  it('throws when no usable path or URL is found', async () => {
    await expect(materializeAsset({})).rejects.toThrow(
      'Generated asset did not include a usable file path or URL',
    );
    await expect(materializeAsset({ metadata: {} })).rejects.toThrow(
      'Generated asset did not include a usable file path or URL',
    );
    await expect(
      materializeAsset({ assetPath: '', metadata: {} }),
    ).rejects.toThrow('Generated asset did not include a usable file path or URL');
  });
});

// ---------------------------------------------------------------------------
// resolveImg2ImgSourcePath
// ---------------------------------------------------------------------------

describe('resolveImg2ImgSourcePath', () => {
  it('returns the path for the first existing extension', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-img2img-'));
    const pngPath = path.join(tmpDir, 'abc123.image.png');
    fs.writeFileSync(pngPath, Buffer.from([1, 2]));

    const cas = {
      getAssetPath: vi.fn((hash: string, type: string, ext: string) =>
        path.join(tmpDir, `${hash}.${type}.${ext}`),
      ),
    };

    try {
      const result = resolveImg2ImgSourcePath('abc123', cas as never);
      expect(result).toBe(pngPath);
      expect(cas.getAssetPath).toHaveBeenCalledWith('abc123', 'image', 'png');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('falls through to jpg when png is absent', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-img2img-'));
    const jpgPath = path.join(tmpDir, 'abc123.image.jpg');
    fs.writeFileSync(jpgPath, Buffer.from([1, 2]));

    const cas = {
      getAssetPath: vi.fn((hash: string, type: string, ext: string) =>
        path.join(tmpDir, `${hash}.${type}.${ext}`),
      ),
    };

    try {
      const result = resolveImg2ImgSourcePath('abc123', cas as never);
      expect(result).toBe(jpgPath);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns undefined when no extension matches', () => {
    const cas = {
      getAssetPath: vi.fn(() => '/no/such/file.png'),
    };
    const result = resolveImg2ImgSourcePath('missing-hash', cas as never);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// materializeGenerationRequest
// ---------------------------------------------------------------------------

describe('materializeGenerationRequest', () => {
  function makeCas(assetMap: Record<string, string>) {
    return {
      getAssetPath: vi.fn((hash: string, _type: string, ext: string) => {
        const key = `${hash}.${ext}`;
        return assetMap[key] ?? `/no/such/${hash}.${ext}`;
      }),
    };
  }

  it('passes request through unchanged when no special fields are set', () => {
    const cas = makeCas({});
    const req = {
      type: 'image' as const,
      providerId: 'mock',
      prompt: 'a test prompt',
    };
    const result = materializeGenerationRequest(req, cas as never);
    expect(result.prompt).toBe('a test prompt');
    expect(result.params).toBeUndefined();
  });

  it('merges steps into params when present', () => {
    const cas = makeCas({});
    const req = {
      type: 'image' as const,
      providerId: 'mock',
      prompt: 'test',
      steps: 30,
    };
    const result = materializeGenerationRequest(req, cas as never);
    expect(result.params).toEqual({ steps: 30 });
  });

  it('merges cfgScale and scheduler into params', () => {
    const cas = makeCas({});
    const req = {
      type: 'image' as const,
      providerId: 'mock',
      prompt: 'test',
      cfgScale: 7.5,
      scheduler: 'euler',
    };
    const result = materializeGenerationRequest(req, cas as never);
    expect(result.params).toEqual({ cfgScale: 7.5, scheduler: 'euler' });
  });

  it('merges extra params on top of existing params without overwriting unrelated keys', () => {
    const cas = makeCas({});
    const req = {
      type: 'image' as const,
      providerId: 'mock',
      prompt: 'test',
      steps: 25,
      params: { quality: 'hd', seedBehavior: 'locked' },
    };
    const result = materializeGenerationRequest(req, cas as never);
    expect(result.params).toEqual({ quality: 'hd', seedBehavior: 'locked', steps: 25 });
  });

  it('resolves sourceImageHash to sourceImagePath via CAS', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-mat-req-'));
    const pngPath = path.join(tmpDir, 'source.png');
    fs.writeFileSync(pngPath, Buffer.from([1, 2, 3]));

    const cas = {
      getAssetPath: vi.fn((hash: string, _type: string, ext: string) => {
        if (hash === 'source-hash' && ext === 'png') return pngPath;
        return `/missing/${hash}.${ext}`;
      }),
    };

    try {
      const req = {
        type: 'image' as const,
        providerId: 'mock',
        prompt: 'test',
        sourceImageHash: 'source-hash',
      };
      const result = materializeGenerationRequest(req, cas as never);
      expect(result.sourceImagePath).toBe(pngPath);
      expect(result.params?.sourceImagePath).toBe(pngPath);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('resolves frameReferenceImages hashes to file paths via CAS', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-mat-frames-'));
    const firstPath = path.join(tmpDir, 'first.png');
    const lastPath = path.join(tmpDir, 'last.png');
    fs.writeFileSync(firstPath, Buffer.from([1]));
    fs.writeFileSync(lastPath, Buffer.from([2]));

    const cas = {
      getAssetPath: vi.fn((hash: string, _type: string, ext: string) => {
        if (hash === 'first-hash' && ext === 'png') return firstPath;
        if (hash === 'last-hash' && ext === 'png') return lastPath;
        return `/missing/${hash}.${ext}`;
      }),
    };

    try {
      const req = {
        type: 'video' as const,
        providerId: 'mock',
        prompt: 'test',
        frameReferenceImages: {
          first: 'first-hash',
          last: 'last-hash',
        },
      };
      const result = materializeGenerationRequest(req, cas as never);
      expect(result.frameReferenceImages).toEqual({
        first: firstPath,
        last: lastPath,
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('logs a warning when sourceImageHash cannot be resolved', () => {
    const cas = makeCas({});
    const req = {
      type: 'image' as const,
      providerId: 'mock',
      prompt: 'test',
      sourceImageHash: 'unresolvable-hash',
    };
    materializeGenerationRequest(req, cas as never);
    expect(logger.warn).toHaveBeenCalledWith(
      '[canvas:generation] sourceImageHash could not be resolved to a file',
      expect.objectContaining({ sourceImageHash: 'unresolvable-hash' }),
    );
  });

  it('resolves referenceImages hashes to file paths via CAS', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-mat-ref-'));
    const ref1 = path.join(tmpDir, 'ref1.png');
    const ref2 = path.join(tmpDir, 'ref2.jpg');
    fs.writeFileSync(ref1, Buffer.from([1]));
    fs.writeFileSync(ref2, Buffer.from([2]));

    const cas = {
      getAssetPath: vi.fn((hash: string, _type: string, ext: string) => {
        if (hash === 'hash-ref1' && ext === 'png') return ref1;
        if (hash === 'hash-ref2' && ext === 'jpg') return ref2;
        return `/missing/${hash}.${ext}`;
      }),
    };

    try {
      const req = {
        type: 'image' as const,
        providerId: 'mock',
        prompt: 'test',
        referenceImages: ['hash-ref1', 'hash-ref2'],
      };
      const result = materializeGenerationRequest(req, cas as never);
      expect(result.referenceImages).toEqual([ref1, ref2]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('logs a warning when some referenceImages cannot be resolved', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-mat-partial-'));
    const ref1 = path.join(tmpDir, 'ref1.png');
    fs.writeFileSync(ref1, Buffer.from([1]));

    const cas = {
      getAssetPath: vi.fn((hash: string, _type: string, ext: string) => {
        if (hash === 'hash-ref1' && ext === 'png') return ref1;
        return `/missing/${hash}.${ext}`;
      }),
    };

    try {
      const req = {
        type: 'image' as const,
        providerId: 'mock',
        prompt: 'test',
        referenceImages: ['hash-ref1', 'hash-missing'],
      };
      const result = materializeGenerationRequest(req, cas as never);
      expect(result.referenceImages).toEqual([ref1]);
      expect(logger.warn).toHaveBeenCalledWith(
        '[canvas:generation] some referenceImage hashes could not be resolved',
        expect.objectContaining({ total: 2, resolved: 1 }),
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('sets referenceImages to undefined when none can be resolved', () => {
    const cas = makeCas({});
    const req = {
      type: 'image' as const,
      providerId: 'mock',
      prompt: 'test',
      referenceImages: ['hash-missing-a', 'hash-missing-b'],
    };
    const result = materializeGenerationRequest(req, cas as never);
    expect(result.referenceImages).toBeUndefined();
  });

});

// ---------------------------------------------------------------------------
// buildAdhocAdapter
// ---------------------------------------------------------------------------

describe('buildAdhocAdapter', () => {
  const baseConfig = {
    baseUrl: 'https://api.example.com/generate',
    model: 'test-model',
    apiKey: 'sk-test',
  };

  function makeKeychain(key: string | null = null) {
    return { getKey: vi.fn(async () => key) } as never;
  }

  it('returns an adapter with the expected structure', async () => {
    const adapter = await buildAdhocAdapter('my-provider', baseConfig, makeKeychain());
    expect(adapter.id).toBe('my-provider');
    expect(adapter.name).toBe('my-provider');
    expect(adapter.type).toBe('image');
    expect(adapter.capabilities).toContain('text-to-image');
    expect(adapter.capabilities).toContain('image-to-image');
    expect(adapter.maxConcurrent).toBe(1);
    expect(adapter.executionCapabilities?.subscribe).toBe(true);
    expect(adapter.executionCapabilities?.cancellation).toBe(false);
  });

  it('sets type="video" and video capabilities for genType=video', async () => {
    const adapter = await buildAdhocAdapter('vid-provider', baseConfig, makeKeychain(), 'video');
    expect(adapter.type).toBe('video');
    expect(adapter.capabilities).toContain('text-to-video');
    expect(adapter.capabilities).toContain('image-to-video');
  });

  it('sets type="voice" and voice capabilities for genType=voice', async () => {
    const adapter = await buildAdhocAdapter('tts-provider', baseConfig, makeKeychain(), 'voice');
    expect(adapter.type).toBe('voice');
    expect(adapter.capabilities).toContain('text-to-voice');
  });

  it('sets type="voice" and music capabilities for genType=music', async () => {
    const adapter = await buildAdhocAdapter('music-provider', baseConfig, makeKeychain(), 'music');
    expect(adapter.type).toBe('voice');
    expect(adapter.capabilities).toContain('text-to-music');
  });

  it('sets type="voice" and sfx capabilities for genType=sfx', async () => {
    const adapter = await buildAdhocAdapter('sfx-provider', baseConfig, makeKeychain(), 'sfx');
    expect(adapter.type).toBe('voice');
    expect(adapter.capabilities).toContain('text-to-sfx');
  });

  it('validate() returns true', async () => {
    const adapter = await buildAdhocAdapter('my-provider', baseConfig, makeKeychain());
    expect(await adapter.validate()).toBe(true);
  });

  it('estimateCost() returns zero cost', async () => {
    const adapter = await buildAdhocAdapter('my-provider', baseConfig, makeKeychain());
    const estimate = adapter.estimateCost({
      type: 'image',
      providerId: 'my-provider',
      prompt: 'test',
    });
    expect(estimate).toEqual({ estimatedCost: 0, currency: 'USD', provider: 'my-provider', unit: 'image' });
  });

  it('checkStatus() resolves to Completed', async () => {
    const adapter = await buildAdhocAdapter('my-provider', baseConfig, makeKeychain());
    const status = await adapter.checkStatus('any-job-id');
    expect(status).toBe('completed');
  });

  it('cancel() resolves without error', async () => {
    const adapter = await buildAdhocAdapter('my-provider', baseConfig, makeKeychain());
    await expect(adapter.cancel('any-job-id')).resolves.toBeUndefined();
  });

  it('fetches API key from keychain when config.apiKey is absent', async () => {
    const keychainKey = 'keychain-secret';
    const keychain = { getKey: vi.fn(async () => keychainKey) };
    const configWithoutKey = { baseUrl: 'https://api.example.com/gen', model: 'model-1' };
    const adapter = await buildAdhocAdapter('provider-x', configWithoutKey, keychain as never);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ url: 'https://cdn.example.com/img.png' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await adapter.generate({ type: 'image', providerId: 'provider-x', prompt: 'hi' });
      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = callArgs[1];
      const headers = body.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${keychainKey}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  describe('generate()', () => {
    it('extracts assetPath from { data: [{ url }] } format', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ url: 'https://cdn.example.com/img.png' }] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        const result = await adapter.generate({ type: 'image', providerId: 'p1', prompt: 'test' });
        expect(result.assetPath).toBe('https://cdn.example.com/img.png');
        expect(result.provider).toBe('p1');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('extracts assetPath from { data: [{ b64_json }] } format for images', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ b64_json: ONE_PIXEL_PNG_BASE64 }] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        const result = await adapter.generate({ type: 'image', providerId: 'p1', prompt: 'test' });
        expect(result.assetPath).toBe(`data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('extracts assetPath from { data: [{ b64_json }] } format for video', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ b64_json: MINIMAL_MP4_BASE64 }] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain(), 'video');
        const result = await adapter.generate({ type: 'video', providerId: 'p1', prompt: 'test' });
        expect(result.assetPath).toBe(`data:video/mp4;base64,${MINIMAL_MP4_BASE64}`);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('rejects video responses whose b64_json payload decodes to an image', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ b64_json: ONE_PIXEL_PNG_BASE64 }] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain(), 'video');
        await expect(
          adapter.generate({ type: 'video', providerId: 'p1', prompt: 'test' }),
        ).rejects.toThrow(/expected video response payload, received image/i);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('extracts assetPath from chat completions choices[0].message.images format', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { images: [{ image_url: { url: 'https://cdn.example.com/chat-img.png' } }] } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        const result = await adapter.generate({ type: 'image', providerId: 'p1', prompt: 'test' });
        expect(result.assetPath).toBe('https://cdn.example.com/chat-img.png');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('rejects image-only chat payloads for video generation', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { images: [{ image_url: { url: 'https://cdn.example.com/chat-img.png' } }] } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain(), 'video');
        await expect(
          adapter.generate({ type: 'video', providerId: 'p1', prompt: 'test' }),
        ).rejects.toThrow(/image response field cannot satisfy video generation/i);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('extracts assetPath from choices[0].message.content when content is a data URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'data:image/png;base64,chatcontent' } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        const result = await adapter.generate({ type: 'image', providerId: 'p1', prompt: 'test' });
        expect(result.assetPath).toBe('data:image/png;base64,chatcontent');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('extracts media URL from message content via regex', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Here is your image: https://cdn.example.com/result.png enjoy!' } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        const result = await adapter.generate({ type: 'image', providerId: 'p1', prompt: 'test' });
        expect(result.assetPath).toBe('https://cdn.example.com/result.png');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('extracts assetPath from direct { url } field', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ url: 'https://cdn.example.com/direct.png' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        const result = await adapter.generate({ type: 'image', providerId: 'p1', prompt: 'test' });
        expect(result.assetPath).toBe('https://cdn.example.com/direct.png');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('extracts assetPath from { video_url } field', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ video_url: 'https://cdn.example.com/video.mp4' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain(), 'video');
        const result = await adapter.generate({ type: 'video', providerId: 'p1', prompt: 'test' });
        expect(result.assetPath).toBe('https://cdn.example.com/video.mp4');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('extracts assetPath from { audio_url } field', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ audio_url: 'https://cdn.example.com/audio.mp3' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain(), 'voice');
        const result = await adapter.generate({ type: 'voice', providerId: 'p1', prompt: 'test' });
        expect(result.assetPath).toBe('https://cdn.example.com/audio.mp3');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('throws a helpful 404 error message', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        await expect(
          adapter.generate({ type: 'image', providerId: 'p1', prompt: 'test' }),
        ).rejects.toThrow('endpoint not found');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('throws a helpful 500 error message', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        await expect(
          adapter.generate({ type: 'image', providerId: 'p1', prompt: 'test' }),
        ).rejects.toThrow('server error');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('throws when response has no extractable media', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok', message: 'done but no url' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        await expect(
          adapter.generate({ type: 'image', providerId: 'p1', prompt: 'test' }),
        ).rejects.toThrow('Could not extract media from response');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('throws with async task message when response has taskId but no immediate output', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'task-abc123', status: 'pending' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        await expect(
          adapter.generate({ type: 'video', providerId: 'p1', prompt: 'test' }),
        ).rejects.toThrow('task-abc123');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('sends chat completions format when baseUrl contains /chat/completions', async () => {
      const chatConfig = {
        baseUrl: 'https://api.example.com/chat/completions',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'https://cdn.example.com/chat.png' } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', chatConfig, makeKeychain());
        await adapter.generate({ type: 'image', providerId: 'p1', prompt: 'draw a cat' });
        const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
        const bodyStr = callArgs[1].body as string;
        const body = JSON.parse(bodyStr) as Record<string, unknown>;
        expect(body.messages).toBeDefined();
        expect((body.messages as Array<{ role: string; content: string }>)[0]?.role).toBe('user');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('includes model in request body when model is non-empty', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ url: 'https://cdn.example.com/img.png' }] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        await adapter.generate({ type: 'image', providerId: 'p1', prompt: 'test' });
        const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
        const bodyStr = callArgs[1].body as string;
        const body = JSON.parse(bodyStr) as Record<string, unknown>;
        expect(body.model).toBe('test-model');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('includes http reference image in video request body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ url: 'https://cdn.example.com/video.mp4' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain(), 'video');
        await adapter.generate({
          type: 'video',
          providerId: 'p1',
          prompt: 'test',
          referenceImages: ['https://cdn.example.com/ref.png'],
        });
        const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
        const bodyStr = callArgs[1].body as string;
        const body = JSON.parse(bodyStr) as Record<string, unknown>;
        expect(body.image).toBe('https://cdn.example.com/ref.png');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('encodes a local materialized video conditioning image into the request body', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-adhoc-video-ref-'));
      const refPath = path.join(tmpDir, 'ref.png');
      fs.writeFileSync(refPath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'));
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ url: 'https://cdn.example.com/video.mp4' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain(), 'video');
        await adapter.generate({
          type: 'video',
          providerId: 'p1',
          prompt: 'test',
          sourceImagePath: refPath,
        });
        const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
        const bodyStr = callArgs[1].body as string;
        const body = JSON.parse(bodyStr) as Record<string, unknown>;
        expect(String(body.image)).toContain('data:image/png;base64,');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.unstubAllGlobals();
      }
    });

    it('uses input_reference field for sora-2 model', async () => {
      const soraConfig = {
        baseUrl: 'https://api.example.com/generate',
        model: 'openai/sora-2',
        apiKey: 'sk-test',
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ url: 'https://cdn.example.com/video.mp4' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', soraConfig, makeKeychain(), 'video');
        await adapter.generate({
          type: 'video',
          providerId: 'p1',
          prompt: 'test',
          referenceImages: ['https://cdn.example.com/ref.png'],
        });
        const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
        const bodyStr = callArgs[1].body as string;
        const body = JSON.parse(bodyStr) as Record<string, unknown>;
        expect(body['input_reference']).toBe('https://cdn.example.com/ref.png');
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('subscribe()', () => {
    it('calls onProgress and onQueueUpdate for immediate response with assetPath', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ url: 'https://cdn.example.com/img.png' }] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        const onProgress = vi.fn();
        const onQueueUpdate = vi.fn();

        const result = await adapter.subscribe!(
          { type: 'image', providerId: 'p1', prompt: 'test' },
          { onProgress, onQueueUpdate },
        );

        expect(result.assetPath).toBe('https://cdn.example.com/img.png');
        expect(onProgress).toHaveBeenCalledWith(
          expect.objectContaining({ percentage: 100, currentStep: 'completed' }),
        );
        expect(onQueueUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'completed' }),
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('polls status URL for async jobs and returns final result', async () => {
      vi.useFakeTimers();

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'task-poll-1',
            status_url: 'https://provider.example/status/task-poll-1',
            status: 'queued',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'processing', progress: 50 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'completed', url: 'https://cdn.example.com/final.png' }),
        });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        const onQueueUpdate = vi.fn();
        const onProgress = vi.fn();

        const subscribePromise = adapter.subscribe!(
          { type: 'image', providerId: 'p1', prompt: 'test' },
          { onQueueUpdate, onProgress },
        );

        await vi.advanceTimersByTimeAsync(15_000);
        const result = await subscribePromise;

        expect(result.assetPath).toBe('https://cdn.example.com/final.png');
        expect(onQueueUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'queued', jobId: 'task-poll-1' }),
        );
        expect(onProgress).toHaveBeenCalledWith(
          expect.objectContaining({ percentage: 50 }),
        );
        expect(onQueueUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'completed' }),
        );
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    });

    it('throws when taskId is present but statusUrl is absent', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'task-no-status-url', status: 'queued' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        await expect(
          adapter.subscribe!({ type: 'image', providerId: 'p1', prompt: 'test' }, {}),
        ).rejects.toThrow('task-no-status-url');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('throws when response has no extractable media or task info', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ nothing: 'here' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        await expect(
          adapter.subscribe!({ type: 'image', providerId: 'p1', prompt: 'test' }, {}),
        ).rejects.toThrow('Could not extract media from response');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('throws when poll status request fails', async () => {
      vi.useFakeTimers();

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'task-fail-poll',
            status_url: 'https://provider.example/status/fail',
            status: 'queued',
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 502,
          text: async () => 'Bad Gateway',
        });
      vi.stubGlobal('fetch', fetchMock);

      let caughtError: unknown;
      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        const subscribePromise = adapter.subscribe!(
          { type: 'image', providerId: 'p1', prompt: 'test' },
          {},
        ).catch((e: unknown) => { caughtError = e; });

        await vi.advanceTimersByTimeAsync(6_000);
        await subscribePromise;

        expect(caughtError).toBeInstanceOf(Error);
        expect((caughtError as Error).message).toContain('Provider status error 502');
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    });

    it('throws when poll task reports failed status', async () => {
      vi.useFakeTimers();

      const fetchMock = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'task-failed',
            status_url: 'https://provider.example/status/failed',
            status: 'queued',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: 'failed' }),
        });
      vi.stubGlobal('fetch', fetchMock);

      let caughtError: unknown;
      try {
        const adapter = await buildAdhocAdapter('p1', baseConfig, makeKeychain());
        const subscribePromise = adapter.subscribe!(
          { type: 'image', providerId: 'p1', prompt: 'test' },
          {},
        ).catch((e: unknown) => { caughtError = e; });

        await vi.advanceTimersByTimeAsync(6_000);
        await subscribePromise;

        expect(caughtError).toBeInstanceOf(Error);
        expect((caughtError as Error).message).toContain('Provider task task-failed failed');
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    });
  });
});

describe('mergeVariants', () => {
  it('appends new variants to existing ones', () => {
    const result = mergeVariants(['a', 'b'], ['c', 'd']);
    expect(result.variants).toEqual(['a', 'b', 'c', 'd']);
    expect(result.selectedVariantIndex).toBe(2);
  });

  it('deduplicates incoming variants that already exist', () => {
    const result = mergeVariants(['a', 'b'], ['b', 'c']);
    expect(result.variants).toEqual(['a', 'b', 'c']);
    expect(result.selectedVariantIndex).toBe(2);
  });

  it('returns existing variants unchanged when all incoming are duplicates', () => {
    const result = mergeVariants(['a', 'b'], ['a', 'b']);
    expect(result.variants).toEqual(['a', 'b']);
    expect(result.selectedVariantIndex).toBe(0);
  });

  it('handles empty existing array', () => {
    const result = mergeVariants([], ['x', 'y']);
    expect(result.variants).toEqual(['x', 'y']);
    expect(result.selectedVariantIndex).toBe(0);
  });

  it('handles empty incoming array', () => {
    const result = mergeVariants(['a', 'b'], []);
    expect(result.variants).toEqual(['a', 'b']);
    expect(result.selectedVariantIndex).toBe(0);
  });

  it('trims oldest when exceeding MAX_ACCUMULATED_VARIANTS', () => {
    const existing = Array.from({ length: 18 }, (_, i) => `existing-${i}`);
    const incoming = ['new-0', 'new-1', 'new-2', 'new-3', 'new-4'];
    const result = mergeVariants(existing, incoming);
    expect(result.variants.length).toBe(MAX_ACCUMULATED_VARIANTS);
    expect(result.variants).not.toContain('existing-0');
    expect(result.variants).not.toContain('existing-1');
    expect(result.variants).not.toContain('existing-2');
    expect(result.variants).toContain('existing-3');
    expect(result.variants).toContain('new-4');
    expect(result.selectedVariantIndex).toBe(result.variants.indexOf('new-0'));
  });

  it('selects the first new variant as selectedVariantIndex', () => {
    const result = mergeVariants(['a'], ['b', 'c', 'd']);
    expect(result.selectedVariantIndex).toBe(1);
  });

  it('MAX_ACCUMULATED_VARIANTS is 20', () => {
    expect(MAX_ACCUMULATED_VARIANTS).toBe(20);
  });
});
