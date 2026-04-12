import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IpcMain } from 'electron';
import log from '../../logger.js';
import { createCommand, runCommand, detectFfmpeg } from '@lucid-fin/media-engine';

function requireFilePath(args: unknown, channel: string): string {
  if (!args || typeof args !== 'object') throw new Error(`${channel}: args required`);
  const filePath = (args as { filePath?: unknown }).filePath;
  if (typeof filePath !== 'string' || !filePath.trim()) throw new Error(`${channel}: filePath required`);
  if (!fs.existsSync(filePath)) throw new Error(`${channel}: file not found: ${filePath}`);
  return filePath;
}

export function registerFfmpegHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('ffmpeg:probe', async (_e, args: { filePath: string }) => {
    const filePath = requireFilePath(args, 'ffmpeg:probe');
    log.info('ffmpeg:probe', filePath);

    const ffmpegMod = (await import('fluent-ffmpeg')).default as typeof import('fluent-ffmpeg');

    return new Promise<{
      duration: number;
      width: number;
      height: number;
      codec: string;
      fps: number;
    }>((resolve, reject) => {
      const ffmpeg = ffmpegMod;
      const ffmpegPath = detectFfmpeg();
      ffmpeg.setFfprobePath(ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'));

      ffmpeg.ffprobe(filePath, (err: Error | null, metadata: import('fluent-ffmpeg').FfprobeData) => {
        if (err) return reject(err);
        const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
        const fps = videoStream?.r_frame_rate
          ? (() => {
              const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
              return den ? Math.round(num / den) : num;
            })()
          : 0;

        resolve({
          duration: metadata.format.duration ?? 0,
          width: videoStream?.width ?? 0,
          height: videoStream?.height ?? 0,
          codec: videoStream?.codec_name ?? '',
          fps,
        });
      });
    });
  });

  ipcMain.handle('ffmpeg:thumbnail', async (_e, args: { filePath: string; timestamp: number }) => {
    const filePath = requireFilePath(args, 'ffmpeg:thumbnail');
    const timestamp = typeof args.timestamp === 'number' ? args.timestamp : 0;
    log.info('ffmpeg:thumbnail', filePath, timestamp);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-thumb-'));
    const outputPath = path.join(dir, 'thumb.jpg');

    const cmd = createCommand(filePath)
      .seekInput(timestamp)
      .frames(1)
      .output(outputPath);
    await runCommand(cmd);

    return outputPath;
  });

  ipcMain.handle(
    'ffmpeg:transcode',
    async (_e, args: { input: string; output: string; options?: Record<string, unknown> }) => {
      if (!args?.input || !args?.output) throw new Error('ffmpeg:transcode: input and output required');
      log.info('ffmpeg:transcode', args.input, '->', args.output);

      const cmd = createCommand(args.input);

      if (args.options?.videoCodec && typeof args.options.videoCodec === 'string') {
        cmd.videoCodec(args.options.videoCodec);
      }
      if (args.options?.audioCodec && typeof args.options.audioCodec === 'string') {
        cmd.audioCodec(args.options.audioCodec);
      }
      if (Array.isArray(args.options?.outputOptions)) {
        cmd.addOutputOptions(args.options.outputOptions as string[]);
      }

      cmd.output(args.output);
      await runCommand(cmd);
      log.info('ffmpeg:transcode complete', args.output);
    },
  );
}
