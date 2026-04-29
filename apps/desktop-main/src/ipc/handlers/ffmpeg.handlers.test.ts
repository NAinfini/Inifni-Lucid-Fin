import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const createCommandMock = vi.hoisted(() => vi.fn());
const runCommandMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@lucid-fin/media-engine', () => ({
  createCommand: createCommandMock,
  detectFfmpeg: vi.fn(() => 'C:\\ffmpeg\\ffmpeg.exe'),
  runCommand: runCommandMock,
}));

vi.mock('../../logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { registerFfmpegHandlers } from './ffmpeg.handlers.js';

function registerHandlers() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  registerFfmpegHandlers({
    handle(channel: string, handler: (...args: unknown[]) => unknown) {
      handlers.set(channel, handler);
    },
  } as never);
  return handlers;
}

function makeCommand() {
  return {
    addOutputOptions: vi.fn().mockReturnThis(),
    audioCodec: vi.fn().mockReturnThis(),
    frames: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
    seekInput: vi.fn().mockReturnThis(),
    videoCodec: vi.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  createCommandMock.mockReset();
  runCommandMock.mockClear();
});

describe('registerFfmpegHandlers', () => {
  it('allows a constrained transcode option set for temp/app paths', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const command = makeCommand();
    createCommandMock.mockReturnValue(command);
    const handlers = registerHandlers();
    const transcode = handlers.get('ffmpeg:transcode');
    const input = path.join(os.tmpdir(), 'input.mp4');
    const output = path.join(os.tmpdir(), 'output.mp4');

    await expect(
      transcode?.(
        {},
        {
          input,
          output,
          options: {
            audioCodec: 'aac',
            outputOptions: ['-movflags', '+faststart'],
            videoCodec: 'libx264',
          },
        },
      ),
    ).resolves.toBeUndefined();

    expect(createCommandMock).toHaveBeenCalledWith(input);
    expect(command.videoCodec).toHaveBeenCalledWith('libx264');
    expect(command.audioCodec).toHaveBeenCalledWith('aac');
    expect(command.addOutputOptions).toHaveBeenCalledWith(['-movflags']);
    expect(command.output).toHaveBeenCalledWith(output);
    expect(runCommandMock).toHaveBeenCalledWith(command);
  });
});
