import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ffmpegMock, setFfmpegPathMock } = vi.hoisted(() => ({
  ffmpegMock: vi.fn(),
  setFfmpegPathMock: vi.fn(),
}));

vi.mock('fluent-ffmpeg', () => ({
  default: ffmpegMock,
}));

import { createCommand, detectFfmpeg, runCommand } from './ffmpeg-utils.js';

describe('detectFfmpeg', () => {
  beforeEach(() => {
    delete process.env.FFMPEG_PATH;
  });

  it('returns the configured FFMPEG_PATH when present', () => {
    process.env.FFMPEG_PATH = 'C:\\tools\\ffmpeg.exe';

    expect(detectFfmpeg()).toBe('C:\\tools\\ffmpeg.exe');
  });

  it('falls back to ffmpeg when the env var is absent', () => {
    expect(detectFfmpeg()).toBe('ffmpeg');
  });
});

describe('createCommand', () => {
  beforeEach(() => {
    ffmpegMock.mockReset();
    setFfmpegPathMock.mockReset();
    delete process.env.FFMPEG_PATH;
  });

  it('creates a fluent-ffmpeg command and configures the detected binary path', () => {
    process.env.FFMPEG_PATH = '/opt/bin/ffmpeg';
    const cmd = { setFfmpegPath: setFfmpegPathMock };
    ffmpegMock.mockReturnValue(cmd);

    expect(createCommand('input.mp4')).toBe(cmd);
    expect(ffmpegMock).toHaveBeenCalledWith('input.mp4');
    expect(setFfmpegPathMock).toHaveBeenCalledWith('/opt/bin/ffmpeg');
  });

  it('uses the default ffmpeg binary when no env path is configured', () => {
    const cmd = { setFfmpegPath: setFfmpegPathMock };
    ffmpegMock.mockReturnValue(cmd);

    createCommand();

    expect(ffmpegMock).toHaveBeenCalledWith(undefined);
    expect(setFfmpegPathMock).toHaveBeenCalledWith('ffmpeg');
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
