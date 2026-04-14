import { createCommand, runCommand } from './ffmpeg-utils.js';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, isAbsolute, dirname, resolve, sep } from 'path';

/** Inline counting semaphore — avoids depending on @lucid-fin/application. */
class Semaphore {
  private current = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await fn(); } finally { this.release(); }
  }
  private acquire(): Promise<void> {
    if (this.current < this.limit) { this.current++; return Promise.resolve(); }
    return new Promise<void>((r) => this.queue.push(r));
  }
  private release(): void {
    const next = this.queue.shift();
    if (next) next(); else this.current--;
  }
}

const renderSemaphore = new Semaphore(3);

export type RenderCodec = 'h264' | 'h265' | 'prores';
export type RenderPreset = 'draft' | 'standard' | 'high';

export interface RenderOptions {
  codec: RenderCodec;
  preset: RenderPreset;
  width: number;
  height: number;
  fps: number;
  audioBitrate?: string;
  videoBitrate?: string;
  /** Optional root directory — all input paths must resolve within it */
  assetRoot?: string;
}

export interface RenderSegment {
  inputPath: string;
  startTime: number;
  duration: number;
  speed: number;
}

const CODEC_MAP: Record<RenderCodec, { vcodec: string; ext: string; opts: string[] }> = {
  h264: { vcodec: 'libx264', ext: 'mp4', opts: ['-pix_fmt yuv420p', '-movflags +faststart'] },
  h265: {
    vcodec: 'libx265',
    ext: 'mp4',
    opts: ['-pix_fmt yuv420p', '-tag:v hvc1', '-movflags +faststart'],
  },
  prores: { vcodec: 'prores_ks', ext: 'mov', opts: ['-profile:v 3', '-pix_fmt yuva444p10le'] },
};

const PRESET_MAP: Record<RenderPreset, { crf: number; preset: string }> = {
  draft: { crf: 28, preset: 'ultrafast' },
  standard: { crf: 20, preset: 'medium' },
  high: { crf: 14, preset: 'slow' },
};

export function getOutputExtension(codec: RenderCodec): string {
  return CODEC_MAP[codec].ext;
}

/** Validate and sanitize a file path for FFmpeg concat list */
function validatePath(inputPath: string, assetRoot?: string): string {
  const resolved = resolve(inputPath);
  if (!isAbsolute(resolved)) throw new Error(`Path must be absolute: ${inputPath}`);
  if (assetRoot) {
    const root = resolve(assetRoot);
    if (!resolved.startsWith(root + sep) && resolved !== root) {
      throw new Error(`Path traversal blocked: ${inputPath} is outside ${assetRoot}`);
    }
  }
  // Strip newlines and control chars that could break concat format
  const sanitized = resolved.replace(/[\r\n]/g, '').replace(/[^\x20-\x7E\x80-\uFFFF]/g, '');
  if (sanitized !== resolved) throw new Error(`Path contains invalid characters: ${inputPath}`);
  return sanitized;
}

function validateOutputPath(outputPath: string): void {
  if (!isAbsolute(outputPath)) throw new Error(`Output path must be absolute: ${outputPath}`);
  if (!existsSync(dirname(outputPath)))
    throw new Error(`Output directory does not exist: ${dirname(outputPath)}`);
}

function renderTimelineInternal(
  segments: RenderSegment[],
  outputPath: string,
  options: RenderOptions,
): Promise<void> {
  if (segments.length === 0) return Promise.reject(new Error('No segments to render'));
  validateOutputPath(outputPath);

  const codecCfg = CODEC_MAP[options.codec];
  const presetCfg = PRESET_MAP[options.preset];

  const listPath = join(tmpdir(), `lucid-render-${Date.now()}.txt`);
  const listContent = segments
    .map((seg) => {
      const safe = validatePath(seg.inputPath, options.assetRoot);
      const normalized = safe.replace(/\\/g, '/');
      return `file '${normalized.replace(/'/g, "'\\''")}'`;
    })
    .join('\n');
  writeFileSync(listPath, listContent, 'utf8');

  const scaleFilter = `scale=trunc(${options.width}/2)*2:trunc(${options.height}/2)*2`;

  const cmd = createCommand()
    .input(listPath)
    .inputOptions(['-f concat', '-safe 0'])
    .videoCodec(codecCfg.vcodec)
    .addOutputOptions([
      `-vf ${scaleFilter}`,
      `-r ${options.fps}`,
      ...codecCfg.opts,
      ...(options.codec !== 'prores'
        ? [`-crf ${presetCfg.crf}`, `-preset ${presetCfg.preset}`]
        : []),
      ...(options.videoBitrate ? [`-b:v ${options.videoBitrate}`] : []),
      `-b:a ${options.audioBitrate ?? '192k'}`,
    ])
    .output(outputPath);

  return runCommand(cmd).finally(() => {
    try {
      unlinkSync(listPath);
    } catch { /* temp concat list cleanup failed — non-fatal, file will be cleaned up eventually */
      /* ignore */
    }
  });
}

function renderSingleSegmentInternal(
  inputPath: string,
  outputPath: string,
  options: RenderOptions & { inPoint: number; outPoint: number; speed: number },
): Promise<void> {
  validatePath(inputPath, options.assetRoot);
  validateOutputPath(outputPath);

  const codecCfg = CODEC_MAP[options.codec];
  const presetCfg = PRESET_MAP[options.preset];
  const duration = (options.outPoint - options.inPoint) / options.speed;

  const cmd = createCommand(inputPath)
    .seekInput(options.inPoint)
    .duration(duration)
    .videoCodec(codecCfg.vcodec)
    .addOutputOptions([
      `-vf setpts=${(1 / options.speed).toFixed(4)}*PTS,scale=trunc(${options.width}/2)*2:trunc(${options.height}/2)*2`,
      `-r ${options.fps}`,
      ...codecCfg.opts,
      ...(options.codec !== 'prores'
        ? [`-crf ${presetCfg.crf}`, `-preset ${presetCfg.preset}`]
        : []),
    ])
    .output(outputPath);

  return runCommand(cmd);
}

export function renderTimeline(
  segments: RenderSegment[],
  outputPath: string,
  options: RenderOptions,
): Promise<void> {
  return renderSemaphore.run(() => renderTimelineInternal(segments, outputPath, options));
}

export function renderSingleSegment(
  inputPath: string,
  outputPath: string,
  options: RenderOptions & { inPoint: number; outPoint: number; speed: number },
): Promise<void> {
  return renderSemaphore.run(() => renderSingleSegmentInternal(inputPath, outputPath, options));
}
