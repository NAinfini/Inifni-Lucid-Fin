import { createCommand, runCommand } from './ffmpeg-utils.js';

export interface KenBurnsOptions {
  duration: number;
  zoomStart?: number;
  zoomEnd?: number;
  panX?: number;
  panY?: number;
  width?: number;
  height?: number;
}

export function kenBurns(
  inputImage: string,
  outputVideo: string,
  options: KenBurnsOptions,
): Promise<void> {
  const {
    duration,
    zoomStart = 1.0,
    zoomEnd = 1.2,
    panX = 0,
    panY = 0,
    width = 1920,
    height = 1080,
  } = options;

  const fps = 24;
  const totalFrames = duration * fps;

  // zoompan filter: z=zoom expression, x/y=pan, d=duration in frames, s=output size
  const zoomExpr = `zoom+'(${zoomEnd - zoomStart}/${totalFrames})'`;
  const xExpr = panX !== 0 ? `x+${panX}` : `iw/2-(iw/zoom/2)`;
  const yExpr = panY !== 0 ? `y+${panY}` : `ih/2-(ih/zoom/2)`;
  const zoompan = `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${width}x${height}:fps=${fps}`;

  const cmd = createCommand(inputImage)
    .inputOptions(['-loop 1', `-t ${duration}`])
    .videoFilters(zoompan)
    .videoCodec('libx264')
    .outputOptions(['-pix_fmt yuv420p', `-r ${fps}`, '-an'])
    .output(outputVideo);

  return runCommand(cmd);
}
