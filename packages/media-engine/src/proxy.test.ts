import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createCommandMock, runCommandMock, getLgplVideoCodecConfigMock } = vi.hoisted(() => ({
  createCommandMock: vi.fn(),
  runCommandMock: vi.fn(),
  getLgplVideoCodecConfigMock: vi.fn(),
}));

vi.mock('./ffmpeg-utils.js', () => ({
  createCommand: createCommandMock,
  runCommand: runCommandMock,
}));

vi.mock('./codec-policy.js', () => ({
  getLgplVideoCodecConfig: getLgplVideoCodecConfigMock,
}));

import { generateProxy } from './proxy.js';

function makeCommandChain() {
  return {
    videoCodec: vi.fn().mockReturnThis(),
    addOutputOptions: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
  };
}

describe('generateProxy', () => {
  beforeEach(() => {
    createCommandMock.mockReset();
    runCommandMock.mockReset();
    getLgplVideoCodecConfigMock.mockReset();
    runCommandMock.mockResolvedValue(undefined);
    getLgplVideoCodecConfigMock.mockReturnValue({ encoder: 'test-h264', outputOptions: [] });
  });

  it('builds the expected proxy command with default options', async () => {
    const cmd = makeCommandChain();
    createCommandMock.mockReturnValue(cmd);

    await generateProxy('input.mov', 'proxy.mp4');

    expect(createCommandMock).toHaveBeenCalledWith('input.mov');
    expect(getLgplVideoCodecConfigMock).toHaveBeenCalledWith('h264');
    expect(cmd.videoCodec).toHaveBeenCalledWith('test-h264');
    expect(cmd.addOutputOptions).toHaveBeenCalledWith([
      '-vf scale=trunc(iw/8)*2:trunc(ih/8)*2',
      '-profile:v baseline',
      '-b:v 2M',
    ]);
    expect(cmd.output).toHaveBeenCalledWith('proxy.mp4');
    expect(runCommandMock).toHaveBeenCalledWith(cmd);
  });

  it('accepts an explicit empty options object without changing the command', async () => {
    const cmd = makeCommandChain();
    createCommandMock.mockReturnValue(cmd);

    await generateProxy('input.mov', 'proxy.mp4', {});

    expect(createCommandMock).toHaveBeenCalledWith('input.mov');
    expect(runCommandMock).toHaveBeenCalledWith(cmd);
  });

  it('propagates ffmpeg execution failures', async () => {
    const cmd = makeCommandChain();
    createCommandMock.mockReturnValue(cmd);
    runCommandMock.mockRejectedValue(new Error('proxy render failed'));

    await expect(generateProxy('input.mov', 'proxy.mp4')).rejects.toThrow('proxy render failed');
  });
});
