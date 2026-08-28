import { existsSync } from 'node:fs';
import { dirname, extname, isAbsolute } from 'node:path';
import { getLgplVideoCodecConfig } from './codec-policy.js';
import { createCommand, runCommand } from './ffmpeg-utils.js';

const SAMPLE_RATE = 48_000;

export interface ReviewCutVideoInput {
  sourcePath: string;
  trimInMs: number;
  trimOutMs: number;
  sourceDurationMs: number;
  embeddedAudioEnabled: boolean;
  hasEmbeddedAudio: boolean;
}

export interface ReviewCutInput {
  videos: ReviewCutVideoInput[];
  width: number;
  height: number;
  fps: number;
}

export interface ReviewCutCommandPlan {
  inputPaths: string[];
  filterComplex: string;
  outputOptions: string[];
  durationMs: number;
}

export interface ReviewCutProgress {
  percentage: number;
}

export interface RenderReviewCutOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ReviewCutProgress) => void;
}

export function buildReviewCutCommandPlan(input: ReviewCutInput): ReviewCutCommandPlan {
  validateInput(input);

  const filters: string[] = [];
  const concatInputs: string[] = [];
  let durationMs = 0;

  for (const [index, video] of input.videos.entries()) {
    const duration = video.trimOutMs - video.trimInMs;
    durationMs += duration;
    filters.push(
      `[${index}:v]trim=start=${seconds(video.trimInMs)}:end=${seconds(video.trimOutMs)},` +
        `setpts=PTS-STARTPTS,${scaleAndPad(input)},fps=${input.fps},format=yuv420p[v${index}]`,
    );

    if (video.embeddedAudioEnabled) {
      filters.push(
        `[${index}:a]atrim=start=${seconds(video.trimInMs)}:end=${seconds(video.trimOutMs)},` +
          `asetpts=PTS-STARTPTS,aresample=${SAMPLE_RATE},` +
          `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,` +
          `apad=whole_dur=${seconds(duration)},atrim=duration=${seconds(duration)}[a${index}]`,
      );
    } else {
      filters.push(
        `anullsrc=r=${SAMPLE_RATE}:cl=stereo,atrim=duration=${seconds(duration)},` +
          `asetpts=PTS-STARTPTS[a${index}]`,
      );
    }
    concatInputs.push(`[v${index}][a${index}]`);
  }

  filters.push(`${concatInputs.join('')}concat=n=${input.videos.length}:v=1:a=1[vout][aout]`);
  const codec = getLgplVideoCodecConfig('h264', { quality: 'standard' });

  return {
    inputPaths: input.videos.map((video) => video.sourcePath),
    filterComplex: filters.join(';'),
    outputOptions: [
      '-map [vout]',
      '-map [aout]',
      `-c:v ${codec.encoder}`,
      ...codec.outputOptions,
      '-pix_fmt yuv420p',
      '-c:a aac',
      '-b:a 192k',
      `-ar ${SAMPLE_RATE}`,
      '-ac 2',
      `-r ${input.fps}`,
      '-movflags +faststart',
      '-f mp4',
    ],
    durationMs,
  };
}

export async function renderReviewCut(
  input: ReviewCutInput,
  outputPath: string,
  options: RenderReviewCutOptions = {},
): Promise<void> {
  if (options.signal?.aborted) throw new Error('Render aborted');
  validateOutputPath(outputPath);
  const plan = buildReviewCutCommandPlan(input);
  const command = createCommand();
  for (const inputPath of plan.inputPaths) command.input(inputPath);

  let lastPercentage = 0;
  options.onProgress?.({ percentage: lastPercentage });
  command.on('progress', ({ timemark }) => {
    const processedMs = parseTimemarkMs(timemark);
    if (processedMs === undefined) return;
    const percentage = Math.min(99, Math.max(0, Math.floor((processedMs / plan.durationMs) * 100)));
    if (percentage <= lastPercentage) return;
    lastPercentage = percentage;
    options.onProgress?.({ percentage });
  });
  command.complexFilter(plan.filterComplex).addOutputOptions(plan.outputOptions).output(outputPath);

  await runCommand(command, options.signal);
  options.onProgress?.({ percentage: 100 });
}

function validateInput(input: ReviewCutInput): void {
  if (input.videos.length === 0) throw new Error('Review Cut requires at least one video');
  positiveInteger(input.width, 'width');
  positiveInteger(input.height, 'height');
  positiveInteger(input.fps, 'fps');
  if (input.width % 2 !== 0 || input.height % 2 !== 0) {
    throw new Error('Review Cut dimensions must be even integers');
  }

  for (const [index, video] of input.videos.entries()) {
    const label = `Video ${index + 1}`;
    if (!isAbsolute(video.sourcePath)) throw new Error(`${label} sourcePath must be absolute`);
    if (hasAsciiControlCharacter(video.sourcePath)) {
      throw new Error(`${label} sourcePath contains invalid characters`);
    }
    nonNegativeInteger(video.trimInMs, `${label} trimInMs`);
    nonNegativeInteger(video.trimOutMs, `${label} trimOutMs`);
    positiveInteger(video.sourceDurationMs, `${label} sourceDurationMs`);
    if (video.trimInMs >= video.trimOutMs || video.trimOutMs > video.sourceDurationMs) {
      throw new Error(`${label} has an invalid trim range`);
    }
    if (video.embeddedAudioEnabled && !video.hasEmbeddedAudio) {
      throw new Error(`${label} cannot enable missing embedded audio`);
    }
  }
}

function validateOutputPath(outputPath: string): void {
  if (!isAbsolute(outputPath)) throw new Error(`Output path must be absolute: ${outputPath}`);
  if (hasAsciiControlCharacter(outputPath))
    throw new Error('Output path contains invalid characters');
  if (extname(outputPath).toLowerCase() !== '.mp4') {
    throw new Error('Output path must use the .mp4 extension');
  }
  if (!existsSync(dirname(outputPath))) {
    throw new Error(`Output directory does not exist: ${dirname(outputPath)}`);
  }
}

function scaleAndPad(input: ReviewCutInput): string {
  return (
    `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease:` +
    `force_divisible_by=2,pad=${input.width}:${input.height}:` +
    '(ow-iw)/2:(oh-ih)/2:color=black,setsar=1'
  );
}

function parseTimemarkMs(timemark: string): number | undefined {
  const parts = timemark.split(':');
  if (parts.length !== 3) return undefined;
  const [hours, minutes, seconds] = parts.map(Number);
  if (
    hours === undefined ||
    minutes === undefined ||
    seconds === undefined ||
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds)
  ) {
    return undefined;
  }
  return (hours * 3_600 + minutes * 60 + seconds) * 1_000;
}

function seconds(milliseconds: number): string {
  return Number((milliseconds / 1_000).toFixed(6)).toString();
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive integer`);
}

function nonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function hasAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}
