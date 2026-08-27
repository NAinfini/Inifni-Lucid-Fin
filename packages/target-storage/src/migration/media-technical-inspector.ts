import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { MediaTechnicalFacts } from '@lucid-fin/target-contracts';
import { inspectLegacyStaticImageBytes } from './static-image-byte-evidence.js';

const execFileAsync = promisify(execFile);
const MAXIMUM_PROBE_OUTPUT_BYTES = 4 * 1024 * 1024;
const PROBE_TIMEOUT_MILLISECONDS = 30_000;

export type LegacyMediaTechnicalType = 'image' | 'video' | 'audio';

export interface LegacyMediaTechnicalInspectionInput {
  readonly sourcePath: string;
  readonly declaredType: LegacyMediaTechnicalType;
  readonly declaredFormat: string;
  readonly probeAudioVisual?: LegacyAudioVisualProbe;
}

export interface LegacyMediaTechnicalInspection {
  readonly type: LegacyMediaTechnicalType;
  readonly format: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly technicalFacts: MediaTechnicalFacts;
}

export type LegacyAudioVisualProbe = (
  sourcePath: string,
) => Promise<Readonly<Record<string, unknown>>>;

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
});

const FORMAT_ALIASES: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  mp4: new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']),
  mov: new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']),
  m4a: new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']),
  webm: new Set(['matroska', 'webm']),
  mp3: new Set(['mp3']),
  wav: new Set(['wav']),
  ogg: new Set(['ogg']),
  flac: new Set(['flac']),
  aac: new Set(['aac']),
});

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = positiveNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function frameRate(value: unknown): number | null {
  if (typeof value === 'number') return positiveNumber(value);
  if (typeof value !== 'string') return null;
  const [numeratorText, denominatorText = '1'] = value.split('/');
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? positiveNumber(numerator / denominator)
    : null;
}

function durationMilliseconds(
  format: Readonly<Record<string, unknown>>,
  stream: Readonly<Record<string, unknown>>,
): number | null {
  const seconds = positiveNumber(format.duration) ?? positiveNumber(stream.duration);
  if (seconds === null) return null;
  const milliseconds = Math.round(seconds * 1_000);
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : null;
}

function assertFormat(declaredFormat: string, format: Readonly<Record<string, unknown>>): void {
  const accepted = FORMAT_ALIASES[declaredFormat];
  if (!accepted) throw new TypeError(`Unsupported Legacy media format: ${declaredFormat}`);
  const actual = typeof format.format_name === 'string' ? format.format_name.split(',') : [];
  if (!actual.some((name) => accepted.has(name))) {
    throw new TypeError('Legacy media container does not match the declared format');
  }
}

function audioFacts(
  stream: Readonly<Record<string, unknown>>,
  format: Readonly<Record<string, unknown>>,
): Extract<MediaTechnicalFacts, { kind: 'audio' }> {
  const durationMs = durationMilliseconds(format, stream);
  const sampleRateHz = positiveInteger(stream.sample_rate);
  const channels = positiveInteger(stream.channels);
  if (durationMs === null || sampleRateHz === null || channels === null) {
    throw new TypeError('Legacy audio bytes have incomplete technical facts');
  }
  return { kind: 'audio', durationMs, sampleRateHz, channels };
}

function videoFacts(
  stream: Readonly<Record<string, unknown>>,
  format: Readonly<Record<string, unknown>>,
  hasAudio: boolean,
): Extract<MediaTechnicalFacts, { kind: 'video' }> {
  const width = positiveInteger(stream.width);
  const height = positiveInteger(stream.height);
  const durationMs = durationMilliseconds(format, stream);
  const fps = frameRate(stream.avg_frame_rate) ?? frameRate(stream.r_frame_rate);
  if (width === null || height === null || durationMs === null || fps === null) {
    throw new TypeError('Legacy video bytes have incomplete technical facts');
  }
  const normalizedFrameRate = Math.round(fps);
  if (!Number.isSafeInteger(normalizedFrameRate) || normalizedFrameRate <= 0) {
    throw new TypeError('Legacy video frame rate is invalid');
  }
  return { kind: 'video', width, height, durationMs, frameRate: normalizedFrameRate, hasAudio };
}

/** Creates a bounded, shell-free ffprobe adapter for all accepted A/V containers. */
export function createLegacyFfprobe(executablePath: string): LegacyAudioVisualProbe {
  if (!executablePath.trim()) throw new TypeError('ffprobe executable path must not be empty');
  return async (sourcePath) => {
    const { stdout } = await execFileAsync(
      executablePath,
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', sourcePath],
      {
        encoding: 'utf8',
        maxBuffer: MAXIMUM_PROBE_OUTPUT_BYTES,
        timeout: PROBE_TIMEOUT_MILLISECONDS,
        windowsHide: true,
      },
    );
    const parsed: unknown = JSON.parse(stdout);
    const result = record(parsed);
    if (!result) throw new TypeError('ffprobe returned a non-object document');
    return result;
  };
}

/**
 * Derives canonical target technical facts from bytes. Database width,
 * duration, audio-presence, frame-rate, sample-rate, and channel claims are
 * intentionally ignored.
 */
export async function inspectLegacyMediaTechnicalBytes(
  input: LegacyMediaTechnicalInspectionInput,
): Promise<LegacyMediaTechnicalInspection> {
  const info = await lstat(input.sourcePath);
  if (!info.isFile() || info.size <= 0 || !Number.isSafeInteger(info.size)) {
    throw new TypeError('Legacy media is not a positive-size regular file');
  }
  if (input.declaredType === 'image') {
    const evidence = await inspectLegacyStaticImageBytes(input.sourcePath);
    if (evidence.format !== input.declaredFormat) {
      throw new TypeError('Legacy image bytes do not match the declared format');
    }
    return {
      type: 'image',
      format: evidence.format,
      mimeType: evidence.mimeType,
      byteLength: evidence.byteLength,
      technicalFacts: { kind: 'image', width: evidence.width, height: evidence.height },
    };
  }
  if (!input.probeAudioVisual) {
    throw new TypeError('Legacy audio/video inspection requires the explicit ffprobe adapter');
  }
  const probe = await input.probeAudioVisual(input.sourcePath);
  const format = record(probe.format);
  const streams: readonly Readonly<Record<string, unknown>>[] = Array.isArray(probe.streams)
    ? probe.streams.flatMap((value): readonly Readonly<Record<string, unknown>>[] => {
        const found = record(value);
        return found ? [found] : [];
      })
    : [];
  if (!format) throw new TypeError('Legacy media probe has no format facts');
  assertFormat(input.declaredFormat, format);
  const video = streams.find(({ codec_type }) => codec_type === 'video');
  const audio = streams.find(({ codec_type }) => codec_type === 'audio');
  const mimeType = MIME_TYPES[input.declaredFormat];
  if (!mimeType) throw new TypeError(`Unsupported Legacy media format: ${input.declaredFormat}`);
  if (input.declaredType === 'video') {
    if (!video) throw new TypeError('Legacy declared video contains no video stream');
    return {
      type: 'video',
      format: input.declaredFormat,
      mimeType,
      byteLength: info.size,
      technicalFacts: videoFacts(video, format, audio !== undefined),
    };
  }
  if (!audio || video)
    throw new TypeError('Legacy declared audio stream kind does not match bytes');
  return {
    type: 'audio',
    format: input.declaredFormat,
    mimeType,
    byteLength: info.size,
    technicalFacts: audioFacts(audio, format),
  };
}
