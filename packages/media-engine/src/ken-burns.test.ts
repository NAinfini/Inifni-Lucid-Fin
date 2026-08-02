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

import { kenBurns } from './ken-burns.js';

function makeCommandChain() {
  return {
    inputOptions: vi.fn().mockReturnThis(),
    videoFilters: vi.fn().mockReturnThis(),
    videoCodec: vi.fn().mockReturnThis(),
    outputOptions: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
  };
}

describe('kenBurns', () => {
  beforeEach(() => {
    createCommandMock.mockReset();
    runCommandMock.mockReset();
    getLgplVideoCodecConfigMock.mockReset();
    runCommandMock.mockResolvedValue(undefined);
    getLgplVideoCodecConfigMock.mockReturnValue({
      encoder: 'test-h264',
      outputOptions: ['-b:v 8M'],
    });
  });

  it('uses 1920x1080 by default', async () => {
    const cmd = makeCommandChain();
    createCommandMock.mockReturnValue(cmd);

    await kenBurns('input.jpg', 'output.mp4', { duration: 5 });

    expect(createCommandMock).toHaveBeenCalledWith('input.jpg');
    expect(cmd.videoFilters).toHaveBeenCalledWith(expect.stringContaining(':s=1920x1080:fps=24'));
    expect(getLgplVideoCodecConfigMock).toHaveBeenCalledWith('h264', { quality: 'standard' });
    expect(cmd.videoCodec).toHaveBeenCalledWith('test-h264');
    expect(cmd.outputOptions).toHaveBeenCalledWith(['-pix_fmt yuv420p', '-r 24', '-b:v 8M', '-an']);
    expect(runCommandMock).toHaveBeenCalledWith(cmd);
  });

  it('uses caller-provided output resolution', async () => {
    const cmd = makeCommandChain();
    createCommandMock.mockReturnValue(cmd);

    await kenBurns('input.jpg', 'output.mp4', {
      duration: 5,
      width: 1280,
      height: 720,
    });

    expect(cmd.videoFilters).toHaveBeenCalledWith(expect.stringContaining(':s=1280x720:fps=24'));
    expect(runCommandMock).toHaveBeenCalledWith(cmd);
  });
});
