import { createCommand, runCommand } from './ffmpeg-utils.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ProxyOptions {
  // reserved for future extension (e.g. custom bitrate override)
}

export function generateProxy(
  inputPath: string,
  outputPath: string,
  _options: ProxyOptions = {},
): Promise<void> {
  const cmd = createCommand(inputPath)
    .videoCodec('libx264')
    .addOutputOptions([
      '-vf scale=trunc(iw/8)*2:trunc(ih/8)*2',
      '-profile:v baseline',
      '-b:v 2M',
      '-preset fast',
    ])
    .output(outputPath);

  return runCommand(cmd);
}
