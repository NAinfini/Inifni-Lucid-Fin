import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createCommandMock, runCommandMock } = vi.hoisted(() => ({
  createCommandMock: vi.fn(),
  runCommandMock: vi.fn(),
}));

vi.mock('./ffmpeg-utils.js', () => ({
  createCommand: createCommandMock,
  runCommand: runCommandMock,
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
    runCommandMock.mockResolvedValue(undefined);
  });

  it('uses 1920x1080 by default', async () => {
    const cmd = makeCommandChain();
    createCommandMock.mockReturnValue(cmd);

    await kenBurns('input.jpg', 'output.mp4', { duration: 5 });

    expect(createCommandMock).toHaveBeenCalledWith('input.jpg');
    expect(cmd.videoFilters).toHaveBeenCalledWith(expect.stringContaining(':s=1920x1080:fps=24'));
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
