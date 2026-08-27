import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectLegacyMediaTechnicalBytes } from './media-technical-inspector.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function bytesFile(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lucid-fin-media-inspector-'));
  roots.push(root);
  const path = join(root, name);
  await writeFile(path, Buffer.from('verified-container-bytes'));
  return path;
}

describe('Legacy media technical byte inspector', () => {
  it('normalizes complete ffprobe video facts and ignores Legacy database claims', async () => {
    const sourcePath = await bytesFile('clip.mp4');
    const report = await inspectLegacyMediaTechnicalBytes({
      sourcePath,
      declaredType: 'video',
      declaredFormat: 'mp4',
      probeAudioVisual: async () => ({
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '1.251' },
        streams: [
          {
            codec_type: 'video',
            width: 1920,
            height: 1080,
            avg_frame_rate: '30000/1001',
          },
          { codec_type: 'audio', sample_rate: '48000', channels: 2 },
        ],
      }),
    });

    expect(report).toEqual({
      type: 'video',
      format: 'mp4',
      mimeType: 'video/mp4',
      byteLength: Buffer.byteLength('verified-container-bytes'),
      technicalFacts: {
        kind: 'video',
        width: 1920,
        height: 1080,
        durationMs: 1251,
        frameRate: 30,
        hasAudio: true,
      },
    });
  });

  it('derives audio facts and blocks missing or mismatched byte inspection', async () => {
    const sourcePath = await bytesFile('audio.wav');
    await expect(
      inspectLegacyMediaTechnicalBytes({
        sourcePath,
        declaredType: 'audio',
        declaredFormat: 'wav',
      }),
    ).rejects.toThrow('explicit ffprobe adapter');

    await expect(
      inspectLegacyMediaTechnicalBytes({
        sourcePath,
        declaredType: 'audio',
        declaredFormat: 'wav',
        probeAudioVisual: async () => ({
          format: { format_name: 'mp3', duration: 1 },
          streams: [{ codec_type: 'audio', sample_rate: 44_100, channels: 1 }],
        }),
      }),
    ).rejects.toThrow('container does not match');

    await expect(
      inspectLegacyMediaTechnicalBytes({
        sourcePath,
        declaredType: 'audio',
        declaredFormat: 'wav',
        probeAudioVisual: async () => ({
          format: { format_name: 'wav', duration: 2.5 },
          streams: [{ codec_type: 'audio', sample_rate: '44100', channels: 1 }],
        }),
      }),
    ).resolves.toMatchObject({
      mimeType: 'audio/wav',
      technicalFacts: { kind: 'audio', durationMs: 2500, sampleRateHz: 44_100, channels: 1 },
    });
  });
});
