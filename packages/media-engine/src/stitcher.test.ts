import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';

const { createCommandMock, runCommandMock, writeFileSyncMock, unlinkSyncMock, tmpdirMock } =
  vi.hoisted(() => ({
    createCommandMock: vi.fn(),
    runCommandMock: vi.fn(),
    writeFileSyncMock: vi.fn(),
    unlinkSyncMock: vi.fn(),
    tmpdirMock: vi.fn(),
  }));

vi.mock('./ffmpeg-utils.js', () => ({
  createCommand: createCommandMock,
  runCommand: runCommandMock,
}));

vi.mock('fs', () => ({
  writeFileSync: writeFileSyncMock,
  unlinkSync: unlinkSyncMock,
}));

vi.mock('os', () => ({
  tmpdir: tmpdirMock,
}));

import { stitchVideos } from './stitcher.js';

function makeConcatCommandChain() {
  return {
    input: vi.fn().mockReturnThis(),
    inputOptions: vi.fn().mockReturnThis(),
    outputOptions: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
  };
}

function makeCrossfadeCommandChain() {
  return {
    input: vi.fn().mockReturnThis(),
    complexFilter: vi.fn().mockReturnThis(),
    outputOptions: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
  };
}

describe('stitchVideos', () => {
  beforeEach(() => {
    createCommandMock.mockReset();
    runCommandMock.mockReset();
    writeFileSyncMock.mockReset();
    unlinkSyncMock.mockReset();
    tmpdirMock.mockReset();
    tmpdirMock.mockReturnValue('C:\\temp');
    runCommandMock.mockResolvedValue(undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a concat list file and builds a copy command when crossfade is disabled', async () => {
    const cmd = makeConcatCommandChain();
    createCommandMock.mockReturnValue(cmd);
    const listPath = join('C:\\temp', 'lucid-concat-1700000000000.txt');

    await stitchVideos(
      ['C:\\clips\\one.mp4', "C:\\clips\\o'hara.mp4"],
      'C:\\exports\\stitched.mp4',
      {},
    );

    expect(writeFileSyncMock).toHaveBeenCalledWith(
      listPath,
      "file 'C:/clips/one.mp4'\nfile 'C:/clips/o'\\''hara.mp4'",
      'utf8',
    );
    expect(createCommandMock).toHaveBeenCalledWith();
    expect(cmd.input).toHaveBeenCalledWith(listPath);
    expect(cmd.inputOptions).toHaveBeenCalledWith(['-f concat', '-safe 0']);
    expect(cmd.outputOptions).toHaveBeenCalledWith(['-c copy']);
    expect(cmd.output).toHaveBeenCalledWith('C:\\exports\\stitched.mp4');
    expect(runCommandMock).toHaveBeenCalledWith(cmd);
    expect(unlinkSyncMock).toHaveBeenCalledWith(listPath);
  });

  it('cleans up the concat list file even when ffmpeg fails', async () => {
    const cmd = makeConcatCommandChain();
    createCommandMock.mockReturnValue(cmd);
    runCommandMock.mockRejectedValue(new Error('concat failed'));
    const listPath = join('C:\\temp', 'lucid-concat-1700000000000.txt');

    await expect(
      stitchVideos(['C:\\clips\\one.mp4', 'C:\\clips\\two.mp4'], 'C:\\exports\\stitched.mp4'),
    ).rejects.toThrow('concat failed');

    expect(unlinkSyncMock).toHaveBeenCalledWith(listPath);
  });

  it('ignores cleanup failures after concat completes', async () => {
    const cmd = makeConcatCommandChain();
    createCommandMock.mockReturnValue(cmd);
    unlinkSyncMock.mockImplementation(() => {
      throw new Error('busy');
    });

    await expect(
      stitchVideos(['C:\\clips\\one.mp4', 'C:\\exports\\two.mp4'], 'C:\\exports\\stitched.mp4'),
    ).resolves.toBeUndefined();
  });

  it('builds a crossfade filter graph with explicit segment durations', async () => {
    const cmd = makeCrossfadeCommandChain();
    createCommandMock.mockReturnValue(cmd);

    await stitchVideos(['clip-a.mp4', 'clip-b.mp4', 'clip-c.mp4'], 'output.mp4', {
      crossfadeDuration: 1,
      segmentDurations: [5, 7, 6],
    });

    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(createCommandMock).toHaveBeenCalledWith();
    expect(cmd.input.mock.calls).toEqual([['clip-a.mp4'], ['clip-b.mp4'], ['clip-c.mp4']]);
    expect(cmd.complexFilter).toHaveBeenCalledWith([
      '[0:v][1:v]xfade=transition=fade:duration=1:offset=4[v1]',
      '[v1][2:v]xfade=transition=fade:duration=1:offset=10[vout]',
    ]);
    expect(cmd.outputOptions).toHaveBeenCalledWith([
      '-map [vout]',
      '-c:v libx264',
      '-pix_fmt yuv420p',
    ]);
    expect(cmd.output).toHaveBeenCalledWith('output.mp4');
    expect(runCommandMock).toHaveBeenCalledWith(cmd);
  });

  it('uses the default 3-second segment duration fallback for crossfades', async () => {
    const cmd = makeCrossfadeCommandChain();
    createCommandMock.mockReturnValue(cmd);

    await stitchVideos(['a.mp4', 'b.mp4'], 'output.mp4', { crossfadeDuration: 1 });

    expect(cmd.complexFilter).toHaveBeenCalledWith([
      '[0:v][1:v]xfade=transition=fade:duration=1:offset=2[vout]',
    ]);
  });

  it('falls back to concat when crossfade is requested for fewer than two inputs', async () => {
    const cmd = makeConcatCommandChain();
    createCommandMock.mockReturnValue(cmd);

    await stitchVideos(['solo.mp4'], 'output.mp4', { crossfadeDuration: 1 });

    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    expect(cmd.inputOptions).toHaveBeenCalledWith(['-f concat', '-safe 0']);
    expect(runCommandMock).toHaveBeenCalledWith(cmd);
  });
});
