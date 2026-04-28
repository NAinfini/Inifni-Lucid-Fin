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

export function extractLastFrame(videoPath: string, outputPath: string): Promise<void> {
  const cmd = createCommand(videoPath);
  cmd
    .inputOptions(['-sseof -0.1'])
    .outputOptions(['-frames:v 1', '-update 1'])
    .output(outputPath);
  return runCommand(cmd);
}

export interface SceneCut {
  time: number;   // seconds
  score: number;  // scene change score (0-1)
}

export function detectScenes(videoPath: string, threshold?: number): Promise<SceneCut[]> {
  const t = threshold ?? 0.4;
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
      } catch { /* malformed ffmpeg output line — skip and continue parsing scene cuts */
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

export function extractFrameAtTime(videoPath: string, timeSeconds: number, outputPath: string): Promise<void> {
  const cmd = createCommand(videoPath);
  cmd
    .inputOptions([`-ss ${timeSeconds}`])
    .outputOptions(['-frames:v 1', '-update 1'])
    .output(outputPath);
  return runCommand(cmd);
}
