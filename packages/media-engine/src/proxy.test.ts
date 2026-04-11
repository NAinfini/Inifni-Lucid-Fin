import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createCommandMock, runCommandMock } = vi.hoisted(() => ({
  createCommandMock: vi.fn(),
  runCommandMock: vi.fn(),
}));

vi.mock('./ffmpeg-utils.js', () => ({
  createCommand: createCommandMock,
  runCommand: runCommandMock,
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
    runCommandMock.mockResolvedValue(undefined);
  });

  it('builds the expected proxy command with default options', async () => {
    const cmd = makeCommandChain();
    createCommandMock.mockReturnValue(cmd);

    await generateProxy('input.mov', 'proxy.mp4');

    expect(createCommandMock).toHaveBeenCalledWith('input.mov');
    expect(cmd.videoCodec).toHaveBeenCalledWith('libx264');
    expect(cmd.addOutputOptions).toHaveBeenCalledWith([
      '-vf scale=trunc(iw/8)*2:trunc(ih/8)*2',
      '-profile:v baseline',
      '-b:v 2M',
      '-preset fast',
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
