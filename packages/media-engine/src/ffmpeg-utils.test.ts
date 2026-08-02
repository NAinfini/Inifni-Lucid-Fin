import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ffmpegMock, resolveFfmpegBinaryMock, setFfmpegPathMock, setFfprobePathMock } = vi.hoisted(
  () => ({
    ffmpegMock: vi.fn(),
    resolveFfmpegBinaryMock: vi.fn(),
    setFfmpegPathMock: vi.fn(),
    setFfprobePathMock: vi.fn(),
  }),
);

vi.mock('fluent-ffmpeg', () => ({
  default: ffmpegMock,
}));

vi.mock('./ffmpeg-binary.js', () => ({
  resolveFfmpegBinary: resolveFfmpegBinaryMock,
}));

import {
  createCommand,
  detectFfmpeg,
  detectFfprobe,
  probeMedia,
  runCommand,
} from './ffmpeg-utils.js';

describe('detectFfmpeg', () => {
  beforeEach(() => {
    delete process.env.FFMPEG_PATH;
    delete process.env.FFPROBE_PATH;
    resolveFfmpegBinaryMock.mockReset();
    resolveFfmpegBinaryMock.mockImplementation((name: string) => {
      if (name === 'ffprobe') return process.env.FFPROBE_PATH ?? 'ffprobe';
      return process.env.FFMPEG_PATH ?? 'ffmpeg';
    });
  });

  it('returns the configured FFMPEG_PATH when present', () => {
    process.env.FFMPEG_PATH = 'C:\\tools\\ffmpeg.exe';

    expect(detectFfmpeg()).toBe('C:\\tools\\ffmpeg.exe');
  });

  it('falls back to ffmpeg when the env var is absent', () => {
    expect(detectFfmpeg()).toBe('ffmpeg');
  });

  it('resolves ffprobe independently from ffmpeg', () => {
    process.env.FFPROBE_PATH = 'C:\\tools\\ffprobe.exe';

    expect(detectFfprobe()).toBe('C:\\tools\\ffprobe.exe');
    expect(resolveFfmpegBinaryMock).toHaveBeenCalledWith('ffprobe');
  });
});

describe('createCommand', () => {
  beforeEach(() => {
    ffmpegMock.mockReset();
    setFfmpegPathMock.mockReset();
    setFfprobePathMock.mockReset();
    delete process.env.FFMPEG_PATH;
    delete process.env.FFPROBE_PATH;
    resolveFfmpegBinaryMock.mockReset();
    resolveFfmpegBinaryMock.mockImplementation((name: string) => {
      if (name === 'ffprobe') return process.env.FFPROBE_PATH ?? 'ffprobe';
      return process.env.FFMPEG_PATH ?? 'ffmpeg';
    });
  });

  it('creates a fluent-ffmpeg command and configures the detected binary path', () => {
    process.env.FFMPEG_PATH = '/opt/bin/ffmpeg';
    const cmd = { setFfmpegPath: setFfmpegPathMock, setFfprobePath: setFfprobePathMock };
    ffmpegMock.mockReturnValue(cmd);

    expect(createCommand('input.mp4')).toBe(cmd);
    expect(ffmpegMock).toHaveBeenCalledWith('input.mp4');
    expect(setFfmpegPathMock).toHaveBeenCalledWith('/opt/bin/ffmpeg');
    expect(setFfprobePathMock).toHaveBeenCalledWith('ffprobe');
  });

  it('uses the default ffmpeg binary when no env path is configured', () => {
    const cmd = { setFfmpegPath: setFfmpegPathMock, setFfprobePath: setFfprobePathMock };
    ffmpegMock.mockReturnValue(cmd);

    createCommand();

    expect(ffmpegMock).toHaveBeenCalledWith(undefined);
    expect(setFfmpegPathMock).toHaveBeenCalledWith('ffmpeg');
    expect(setFfprobePathMock).toHaveBeenCalledWith('ffprobe');
  });
});

function makeRunnableCommand() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const cmd = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
      return cmd;
    }),
    run: vi.fn(),
  };

  return { cmd, handlers };
}

describe('runCommand', () => {
  it('resolves when ffmpeg emits end', async () => {
    const { cmd, handlers } = makeRunnableCommand();
    cmd.run.mockImplementation(() => {
      handlers.end?.();
    });

    await expect(runCommand(cmd as never)).resolves.toBeUndefined();
    expect(cmd.on).toHaveBeenNthCalledWith(1, 'end', expect.any(Function));
    expect(cmd.on).toHaveBeenNthCalledWith(2, 'error', expect.any(Function));
    expect(cmd.run).toHaveBeenCalledTimes(1);
  });

  it('rejects when ffmpeg emits error', async () => {
    const { cmd, handlers } = makeRunnableCommand();
    const error = new Error('ffmpeg failed');
    cmd.run.mockImplementation(() => {
      handlers.error?.(error);
    });

    await expect(runCommand(cmd as never)).rejects.toThrow('ffmpeg failed');
    expect(cmd.run).toHaveBeenCalledTimes(1);
  });
});

describe('probeMedia', () => {
  it('normalizes ffprobe streams and rational frame rate', async () => {
    const cmd = {
      setFfmpegPath: setFfmpegPathMock,
      setFfprobePath: setFfprobePathMock,
      ffprobe: vi.fn((callback: (error: Error | null, data: unknown) => void) => {
        callback(null, {
          format: { duration: 4.25, format_name: 'mov,mp4' },
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              width: 1920,
              height: 1080,
              avg_frame_rate: '30000/1001',
            },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
        });
      }),
    };
    ffmpegMock.mockReturnValue(cmd);

    await expect(probeMedia('clip.mp4')).resolves.toEqual({
      durationSeconds: 4.25,
      width: 1920,
      height: 1080,
      fps: 30000 / 1001,
      videoCodec: 'h264',
      audioCodec: 'aac',
      hasAudio: true,
      formatName: 'mov,mp4',
    });
    expect(cmd.ffprobe).toHaveBeenCalledTimes(1);
  });
});
