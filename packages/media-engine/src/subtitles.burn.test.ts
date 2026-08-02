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

import { burnSubtitles } from './subtitles.js';

function makeCommandChain() {
  return {
    videoCodec: vi.fn().mockReturnThis(),
    addOutputOptions: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
  };
}

describe('burnSubtitles', () => {
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

  it('uses the LGPL H.264 policy and compatible bitrate control', async () => {
    const cmd = makeCommandChain();
    createCommandMock.mockReturnValue(cmd);

    await burnSubtitles('input.mp4', 'captions.srt', 'output.mp4');

    expect(getLgplVideoCodecConfigMock).toHaveBeenCalledWith('h264', { quality: 'standard' });
    expect(cmd.videoCodec).toHaveBeenCalledWith('test-h264');
    expect(cmd.addOutputOptions).toHaveBeenCalledWith([
      "-vf subtitles='captions.srt'",
      '-b:v 8M',
      '-c:a copy',
    ]);
    expect(runCommandMock).toHaveBeenCalledWith(cmd);
  });

  it('uses the selected H.265 policy without forwarding x264-only parameters', async () => {
    const cmd = makeCommandChain();
    createCommandMock.mockReturnValue(cmd);
    getLgplVideoCodecConfigMock.mockReturnValue({
      encoder: 'test-h265',
      outputOptions: ['-b:v 16M'],
    });

    await burnSubtitles('input.mp4', 'captions.ass', 'output.mp4', { codec: 'h265' });

    expect(getLgplVideoCodecConfigMock).toHaveBeenCalledWith('h265', { quality: 'standard' });
    expect(cmd.videoCodec).toHaveBeenCalledWith('test-h265');
    expect(cmd.addOutputOptions).toHaveBeenCalledWith([
      "-vf ass='captions.ass'",
      '-b:v 16M',
      '-c:a copy',
    ]);
  });
});
