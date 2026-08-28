import ffmpeg from 'fluent-ffmpeg';
import { resolveFfmpegBinary } from './ffmpeg-binary.js';

export function detectFfmpeg(): string {
  return resolveFfmpegBinary('ffmpeg');
}

export function detectFfprobe(): string {
  return resolveFfmpegBinary('ffprobe');
}

export function createCommand(input?: string): ffmpeg.FfmpegCommand {
  const cmd = ffmpeg(input);
  cmd.setFfmpegPath(detectFfmpeg());
  cmd.setFfprobePath(detectFfprobe());
  return cmd;
}

export function runCommand(cmd: ffmpeg.FfmpegCommand, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Render aborted'));
      return;
    }

    const onAbort = () => {
      cmd.kill('SIGTERM');
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    cmd
      .on('end', () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      })
      .on('error', (err: Error) => {
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) {
          reject(new Error('Render aborted'));
        } else {
          reject(err);
        }
      })
      .run();
  });
}

export interface MediaProbeResult {
  durationSeconds: number;
  width?: number;
  height?: number;
  fps?: number;
  sampleRateHz?: number;
  channels?: number;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio: boolean;
  formatName?: string;
}

/** Read bounded technical metadata with the same packaged ffprobe as rendering. */
export function probeMedia(filePath: string): Promise<MediaProbeResult> {
  const cmd = createCommand(filePath);
  return new Promise((resolve, reject) => {
    cmd.ffprobe((error, data) => {
      if (error) {
        reject(error);
        return;
      }
      const streams = Array.isArray(data.streams)
        ? (data.streams as Array<Record<string, unknown>>)
        : [];
      const video = streams.find((stream) => stream.codec_type === 'video');
      const audio = streams.find((stream) => stream.codec_type === 'audio');
      const format = (data.format ?? {}) as Record<string, unknown>;
      const duration =
        finiteNonNegative(format.duration) ?? finiteNonNegative(video?.duration) ?? 0;
      const rate = video?.avg_frame_rate ?? video?.r_frame_rate;
      resolve({
        durationSeconds: duration,
        width: finitePositiveInteger(video?.width),
        height: finitePositiveInteger(video?.height),
        fps: parseFrameRate(rate),
        sampleRateHz: finitePositiveInteger(audio?.sample_rate),
        channels: finitePositiveInteger(audio?.channels),
        videoCodec: nonEmptyString(video?.codec_name),
        audioCodec: nonEmptyString(audio?.codec_name),
        hasAudio: Boolean(audio),
        formatName: nonEmptyString(format.format_name),
      });
    });
  });
}

function parseFrameRate(value: unknown): number | undefined {
  if (typeof value === 'number') return value > 0 && Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const [numeratorText, denominatorText] = value.split('/');
  const numerator = Number(numeratorText);
  const denominator = denominatorText === undefined ? 1 : Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return undefined;
  }
  const result = numerator / denominator;
  return result > 0 && Number.isFinite(result) ? result : undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function finitePositiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export interface SceneCut {
  time: number; // seconds
  score: number; // scene change score (0-1)
}

export function detectScenes(videoPath: string, threshold?: number): Promise<SceneCut[]> {
  const raw = threshold ?? 0.4;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    throw new Error(`detectScenes: threshold must be a finite number between 0 and 1, got ${raw}`);
  }
  const t = raw;
  const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return new Promise((resolve, reject) => {
    const cuts: SceneCut[] = [];
    const cmd = createCommand(videoPath);
    cmd
      .videoFilters(`select='gt(scene,${t})',showinfo`)
      .outputOptions(['-f null'])
      .output(nullOutput);
    cmd.on('stderr', (line: string) => {
      try {
        if (!line.includes('[Parsed_showinfo_1]')) return;
        const timeMatch = /pts_time:([\d.]+)/.exec(line);
        const scoreMatch = /scene_score=([\d.]+)/.exec(line);
        if (timeMatch && scoreMatch) {
          cuts.push({
            time: parseFloat(timeMatch[1]),
            score: parseFloat(scoreMatch[1]),
          });
        }
      } catch {
        /* malformed ffmpeg output line — skip and continue parsing scene cuts */
        // Ignore parse errors on individual lines
      }
    });
    cmd.on('end', () => {
      cuts.sort((a, b) => a.time - b.time);
      resolve(cuts);
    });
    cmd.on('error', (err: Error) => reject(err));
    cmd.run();
  });
}

export function extractFrameAtTime(
  videoPath: string,
  timeSeconds: number,
  outputPath: string,
): Promise<void> {
  const cmd = createCommand(videoPath);
  cmd
    .inputOptions([`-ss ${timeSeconds}`])
    .outputOptions(['-frames:v 1', '-update 1'])
    .output(outputPath);
  return runCommand(cmd);
}
