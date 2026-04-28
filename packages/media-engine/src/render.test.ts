import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';

const {
  createCommandMock,
  runCommandMock,
  writeFileSyncMock,
  unlinkSyncMock,
  existsSyncMock,
  tmpdirMock,
} = vi.hoisted(() => ({
  createCommandMock: vi.fn(),
  runCommandMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  unlinkSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  tmpdirMock: vi.fn(),
}));

vi.mock('./ffmpeg-utils.js', () => ({
  createCommand: createCommandMock,
  runCommand: runCommandMock,
}));

vi.mock('fs', () => ({
  writeFileSync: writeFileSyncMock,
  unlinkSync: unlinkSyncMock,
  existsSync: existsSyncMock,
}));

vi.mock('os', () => ({
  tmpdir: tmpdirMock,
}));

import { getOutputExtension, renderSingleSegment, renderTimeline } from './render.js';

function makeTimelineCommandChain() {
  return {
    input: vi.fn().mockReturnThis(),
    inputOptions: vi.fn().mockReturnThis(),
    videoCodec: vi.fn().mockReturnThis(),
    addOutputOptions: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
  };
}

function makeSingleSegmentCommandChain() {
  return {
    seekInput: vi.fn().mockReturnThis(),
    duration: vi.fn().mockReturnThis(),
    videoCodec: vi.fn().mockReturnThis(),
    addOutputOptions: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
  };
}

describe('getOutputExtension', () => {
  it('returns the configured extension for each supported codec', () => {
    expect(getOutputExtension('h264')).toBe('mp4');
    expect(getOutputExtension('h265')).toBe('mp4');
    expect(getOutputExtension('prores')).toBe('mov');
  });
});

describe('renderTimeline', () => {
  beforeEach(() => {
    createCommandMock.mockReset();
    runCommandMock.mockReset();
    writeFileSyncMock.mockReset();
    unlinkSyncMock.mockReset();
    existsSyncMock.mockReset();
    tmpdirMock.mockReset();
    runCommandMock.mockResolvedValue(undefined);
    existsSyncMock.mockReturnValue(true);
    tmpdirMock.mockReturnValue('C:\\temp');
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an empty timeline before creating temp files or ffmpeg commands', async () => {
    await expect(
      renderTimeline([], 'C:\\exports\\timeline.mp4', {
        codec: 'h264',
        preset: 'standard',
        width: 1920,
        height: 1080,
        fps: 24,
      }),
    ).rejects.toThrow('No segments to render');

    expect(writeFileSyncMock).not.toHaveBeenCalled();
    expect(createCommandMock).not.toHaveBeenCalled();
  });

  it('builds a concat render command with normalized list entries and default audio bitrate', async () => {
    const cmd = makeTimelineCommandChain();
    createCommandMock.mockReturnValue(cmd);
    const listPath = join('C:\\temp', 'lucid-render-1700000000000.txt');

    await renderTimeline(
      [{ inputPath: "C:\\assets\\o'hara.mp4", startTime: 0, duration: 5, speed: 1 }],
      'C:\\exports\\timeline.mp4',
      {
        codec: 'h264',
        preset: 'standard',
        width: 1920,
        height: 1080,
        fps: 24,
      },
    );

    expect(writeFileSyncMock).toHaveBeenCalledWith(
      listPath,
      "file 'C:/assets/o'\\''hara.mp4'",
      'utf8',
    );
    expect(createCommandMock).toHaveBeenCalledWith();
    expect(cmd.input).toHaveBeenCalledWith(listPath);
    expect(cmd.inputOptions).toHaveBeenCalledWith(['-f concat', '-safe 0']);
    expect(cmd.videoCodec).toHaveBeenCalledWith('libx264');
    expect(cmd.addOutputOptions).toHaveBeenCalledWith([
      '-vf scale=trunc(1920/2)*2:trunc(1080/2)*2',
      '-r 24',
      '-pix_fmt yuv420p',
      '-movflags +faststart',
      '-crf 20',
      '-preset medium',
      '-b:a 192k',
    ]);
    expect(cmd.output).toHaveBeenCalledWith('C:\\exports\\timeline.mp4');
    expect(runCommandMock).toHaveBeenCalledWith(cmd, undefined);
    expect(unlinkSyncMock).toHaveBeenCalledWith(listPath);
  });

  it('adds explicit bitrate overrides and omits crf and preset for prores renders', async () => {
    const cmd = makeTimelineCommandChain();
    createCommandMock.mockReturnValue(cmd);

    await renderTimeline(
      [{ inputPath: 'C:\\assets\\clip.mov', startTime: 0, duration: 5, speed: 1 }],
      'C:\\exports\\timeline.mov',
      {
        codec: 'prores',
        preset: 'high',
        width: 2048,
        height: 1152,
        fps: 30,
        audioBitrate: '256k',
        videoBitrate: '50M',
      },
    );

    expect(cmd.videoCodec).toHaveBeenCalledWith('prores_ks');
    expect(cmd.addOutputOptions).toHaveBeenCalledWith([
      '-vf scale=trunc(2048/2)*2:trunc(1152/2)*2',
      '-r 30',
      '-profile:v 3',
      '-pix_fmt yuva444p10le',
      '-b:v 50M',
      '-b:a 256k',
    ]);
  });

  it('cleans up the concat list file when ffmpeg rejects', async () => {
    const cmd = makeTimelineCommandChain();
    createCommandMock.mockReturnValue(cmd);
    runCommandMock.mockRejectedValue(new Error('render failed'));
    const listPath = join('C:\\temp', 'lucid-render-1700000000000.txt');

    await expect(
      renderTimeline(
        [{ inputPath: 'C:\\assets\\clip.mp4', startTime: 0, duration: 5, speed: 1 }],
        'C:\\exports\\timeline.mp4',
        {
          codec: 'h264',
          preset: 'draft',
          width: 1280,
          height: 720,
          fps: 24,
        },
      ),
    ).rejects.toThrow('render failed');

    expect(unlinkSyncMock).toHaveBeenCalledWith(listPath);
  });

  it('ignores temp file cleanup failures after rendering', async () => {
    const cmd = makeTimelineCommandChain();
    createCommandMock.mockReturnValue(cmd);
    unlinkSyncMock.mockImplementation(() => {
      throw new Error('busy');
    });

    await expect(
      renderTimeline(
        [{ inputPath: 'C:\\assets\\clip.mp4', startTime: 0, duration: 5, speed: 1 }],
        'C:\\exports\\timeline.mp4',
        {
          codec: 'h264',
          preset: 'draft',
          width: 1280,
          height: 720,
          fps: 24,
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('throws when the output path is not absolute', async () => {
    await expect(
      renderTimeline(
        [{ inputPath: 'C:\\assets\\clip.mp4', startTime: 0, duration: 5, speed: 1 }],
        'timeline.mp4',
        {
          codec: 'h264',
          preset: 'standard',
          width: 1920,
          height: 1080,
          fps: 24,
        },
      ),
    ).rejects.toThrow('Output path must be absolute: timeline.mp4');
  });

  it('throws when the output directory does not exist', async () => {
    existsSyncMock.mockReturnValue(false);

    await expect(
      renderTimeline(
        [{ inputPath: 'C:\\assets\\clip.mp4', startTime: 0, duration: 5, speed: 1 }],
        'C:\\missing\\timeline.mp4',
        {
          codec: 'h264',
          preset: 'standard',
          width: 1920,
          height: 1080,
          fps: 24,
        },
      ),
    ).rejects.toThrow('Output directory does not exist: C:\\missing');
  });

  it('throws when an input path escapes the configured assetRoot', async () => {
    await expect(
      renderTimeline(
        [{ inputPath: 'C:\\outside\\clip.mp4', startTime: 0, duration: 5, speed: 1 }],
        'C:\\exports\\timeline.mp4',
        {
          codec: 'h264',
          preset: 'standard',
          width: 1920,
          height: 1080,
          fps: 24,
          assetRoot: 'C:\\assets',
        },
      ),
    ).rejects.toThrow('Path traversal blocked: C:\\outside\\clip.mp4 is outside C:\\assets');
  });

  it('throws when an input path contains control characters', async () => {
    await expect(
      renderTimeline(
        [{ inputPath: 'C:\\assets\\bad\nclip.mp4', startTime: 0, duration: 5, speed: 1 }],
        'C:\\exports\\timeline.mp4',
        {
          codec: 'h264',
          preset: 'standard',
          width: 1920,
          height: 1080,
          fps: 24,
          assetRoot: 'C:\\assets',
        },
      ),
    ).rejects.toThrow('Path contains invalid characters: C:\\assets\\bad\nclip.mp4');
  });
});

describe('renderSingleSegment', () => {
  beforeEach(() => {
    createCommandMock.mockReset();
    runCommandMock.mockReset();
    existsSyncMock.mockReset();
    runCommandMock.mockResolvedValue(undefined);
    existsSyncMock.mockReturnValue(true);
  });

  it('builds a single-segment render command with seek, duration, and speed-adjusted setpts', async () => {
    const cmd = makeSingleSegmentCommandChain();
    createCommandMock.mockReturnValue(cmd);

    await renderSingleSegment('C:\\assets\\clip.mp4', 'C:\\exports\\shot.mp4', {
      codec: 'h265',
      preset: 'high',
      width: 1920,
      height: 1080,
      fps: 30,
      inPoint: 4,
      outPoint: 10,
      speed: 2,
      assetRoot: 'C:\\assets',
    });

    expect(createCommandMock).toHaveBeenCalledWith('C:\\assets\\clip.mp4');
    expect(cmd.seekInput).toHaveBeenCalledWith(4);
    expect(cmd.duration).toHaveBeenCalledWith(3);
    expect(cmd.videoCodec).toHaveBeenCalledWith('libx265');
    expect(cmd.addOutputOptions).toHaveBeenCalledWith([
      '-vf setpts=0.5000*PTS,scale=trunc(1920/2)*2:trunc(1080/2)*2',
      '-r 30',
      '-pix_fmt yuv420p',
      '-tag:v hvc1',
      '-movflags +faststart',
      '-crf 14',
      '-preset slow',
    ]);
    expect(cmd.output).toHaveBeenCalledWith('C:\\exports\\shot.mp4');
    expect(runCommandMock).toHaveBeenCalledWith(cmd, undefined);
  });

  it('throws when the input path is outside the assetRoot', async () => {
    await expect(
      renderSingleSegment('C:\\outside\\clip.mp4', 'C:\\exports\\shot.mp4', {
        codec: 'h264',
        preset: 'draft',
        width: 1280,
        height: 720,
        fps: 24,
        inPoint: 0,
        outPoint: 4,
        speed: 1,
        assetRoot: 'C:\\assets',
      }),
    ).rejects.toThrow('Path traversal blocked: C:\\outside\\clip.mp4 is outside C:\\assets');
  });

  it('throws when the output directory does not exist', async () => {
    existsSyncMock.mockReturnValue(false);

    await expect(
      renderSingleSegment('C:\\assets\\clip.mp4', 'C:\\missing\\shot.mp4', {
        codec: 'h264',
        preset: 'draft',
        width: 1280,
        height: 720,
        fps: 24,
        inPoint: 0,
        outPoint: 4,
        speed: 1,
      }),
    ).rejects.toThrow('Output directory does not exist: C:\\missing');
  });
});
