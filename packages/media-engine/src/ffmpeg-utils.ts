import ffmpeg from 'fluent-ffmpeg';

export function detectFfmpeg(): string {
  const envPath = process.env.FFMPEG_PATH;
  if (envPath) return envPath;
  return 'ffmpeg';
}

export function createCommand(input?: string): ffmpeg.FfmpegCommand {
  const cmd = ffmpeg(input);
  cmd.setFfmpegPath(detectFfmpeg());
  return cmd;
}

export function runCommand(cmd: ffmpeg.FfmpegCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    cmd
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}
