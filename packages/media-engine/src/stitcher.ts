import { createCommand, runCommand } from './ffmpeg-utils.js';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface StitchOptions {
  crossfadeDuration?: number;
  /** Duration of each input segment in seconds (required for crossfade) */
  segmentDurations?: number[];
}

export function stitchVideos(
  inputs: string[],
  outputPath: string,
  options: StitchOptions = {},
): Promise<void> {
  const { crossfadeDuration, segmentDurations } = options;

  if (crossfadeDuration && crossfadeDuration > 0 && inputs.length >= 2) {
    return stitchWithCrossfade(inputs, outputPath, crossfadeDuration, segmentDurations);
  }
  return stitchConcat(inputs, outputPath);
}

function stitchConcat(inputs: string[], outputPath: string): Promise<void> {
  const listPath = join(tmpdir(), `lucid-concat-${Date.now()}.txt`);
  // ffmpeg concat demuxer requires forward slashes even on Windows
  const listContent = inputs
    .map((f) => {
      const normalized = f.replace(/\\/g, '/');
      return `file '${normalized.replace(/'/g, "'\\''")}'`;
    })
    .join('\n');
  writeFileSync(listPath, listContent, 'utf8');

  const cmd = createCommand()
    .input(listPath)
    .inputOptions(['-f concat', '-safe 0'])
    .outputOptions(['-c copy'])
    .output(outputPath);

  return runCommand(cmd).finally(() => {
    try {
      unlinkSync(listPath);
    } catch { /* temp concat list cleanup failed — non-fatal, file will be cleaned up eventually */
      /* ignore */
    }
  });
}

function stitchWithCrossfade(
  inputs: string[],
  outputPath: string,
  crossfadeDuration: number,
  segmentDurations?: number[],
): Promise<void> {
  if (inputs.length < 2) {
    return stitchConcat(inputs, outputPath);
  }

  const cmd = createCommand();
  inputs.forEach((f) => cmd.input(f));

  // Default segment duration if not provided (3s fallback)
  const durations = segmentDurations ?? inputs.map(() => 3);

  const filterParts: string[] = [];
  let prevLabel = '[0:v]';
  let accumulatedOffset = 0;

  for (let i = 1; i < inputs.length; i++) {
    const outLabel = i === inputs.length - 1 ? '[vout]' : `[v${i}]`;
    // Offset = accumulated duration of previous segments minus accumulated crossfade overlaps
    accumulatedOffset += durations[i - 1] - crossfadeDuration;
    const offset = Math.max(0, accumulatedOffset);
    filterParts.push(
      `${prevLabel}[${i}:v]xfade=transition=fade:duration=${crossfadeDuration}:offset=${offset}${outLabel}`,
    );
    prevLabel = outLabel;
  }

  cmd
    .complexFilter(filterParts)
    .outputOptions(['-map [vout]', '-c:v libx264', '-pix_fmt yuv420p'])
    .output(outputPath);

  return runCommand(cmd);
}
