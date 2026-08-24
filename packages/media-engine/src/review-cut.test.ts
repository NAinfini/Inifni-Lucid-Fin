import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createCommandMock, runCommandMock, existsSyncMock, codecConfigMock } = vi.hoisted(() => ({
  createCommandMock: vi.fn(),
  runCommandMock: vi.fn(),
  existsSyncMock: vi.fn(),
  codecConfigMock: vi.fn(),
}));

vi.mock('./ffmpeg-utils.js', () => ({
  createCommand: createCommandMock,
  runCommand: runCommandMock,
}));

vi.mock('./codec-policy.js', () => ({
  getLgplVideoCodecConfig: codecConfigMock,
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}));

import {
  buildReviewCutCommandPlan,
  renderReviewCut,
  type ReviewCutInput,
} from './review-cut.js';

function makeInput(): ReviewCutInput {
  return {
    videos: [
      {
        sourcePath: 'C:\\media\\first.mp4',
        trimInMs: 500,
        trimOutMs: 2_500,
        sourceDurationMs: 3_000,
        embeddedAudioEnabled: true,
        hasEmbeddedAudio: true,
      },
      {
        sourcePath: 'C:\\media\\second.mp4',
        trimInMs: 0,
        trimOutMs: 1_000,
        sourceDurationMs: 1_000,
        embeddedAudioEnabled: false,
        hasEmbeddedAudio: true,
      },
      {
        sourcePath: 'C:\\media\\silent.mp4',
        trimInMs: 200,
        trimOutMs: 1_200,
        sourceDurationMs: 1_500,
        embeddedAudioEnabled: false,
        hasEmbeddedAudio: false,
      },
    ],
    width: 1_920,
    height: 1_080,
    fps: 24,
  };
}

describe('buildReviewCutCommandPlan', () => {
  beforeEach(() => {
    codecConfigMock.mockReset();
    codecConfigMock.mockReturnValue({ encoder: 'test-h264', outputOptions: ['-b:v 8M'] });
  });

  it('builds one normalized hard-cut graph with source audio or matching silence per video', () => {
    const plan = buildReviewCutCommandPlan(makeInput());

    expect(plan.inputPaths).toEqual([
      'C:\\media\\first.mp4',
      'C:\\media\\second.mp4',
      'C:\\media\\silent.mp4',
    ]);
    expect(plan.durationMs).toBe(4_000);
    expect(plan.filterComplex).toContain('[0:v]trim=start=0.5:end=2.5,setpts=PTS-STARTPTS');
    expect(plan.filterComplex).toContain(
      'scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,' +
        'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=24,format=yuv420p[v0]',
    );
    expect(plan.filterComplex).toContain('[0:a]atrim=start=0.5:end=2.5');
    expect(plan.filterComplex).not.toContain('[1:a]');
    expect(plan.filterComplex).not.toContain('[2:a]');
    expect(plan.filterComplex.match(/anullsrc=r=48000:cl=stereo/g)).toHaveLength(2);
    expect(plan.filterComplex).toContain(
      '[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[vout][aout]',
    );
    expect(plan.outputOptions).toEqual([
      '-map [vout]',
      '-map [aout]',
      '-c:v test-h264',
      '-b:v 8M',
      '-pix_fmt yuv420p',
      '-c:a aac',
      '-b:a 192k',
      '-ar 48000',
      '-ac 2',
      '-r 24',
      '-movflags +faststart',
      '-f mp4',
      '-n',
    ]);
  });

  it.each([
    ['empty input', (input: ReviewCutInput) => (input.videos = []), 'at least one video'],
    [
      'invalid trim',
      (input: ReviewCutInput) => (input.videos[0]!.trimOutMs = 500),
      'invalid trim range',
    ],
    [
      'out-of-bounds trim',
      (input: ReviewCutInput) => (input.videos[0]!.trimOutMs = 3_001),
      'invalid trim range',
    ],
    [
      'missing enabled audio',
      (input: ReviewCutInput) => (input.videos[0]!.hasEmbeddedAudio = false),
      'cannot enable missing embedded audio',
    ],
    ['odd width', (input: ReviewCutInput) => (input.width = 1_919), 'even integers'],
    [
      'relative source',
      (input: ReviewCutInput) => (input.videos[0]!.sourcePath = 'first.mp4'),
      'sourcePath must be absolute',
    ],
  ])('rejects %s', (_label, mutate, expected) => {
    const input = makeInput();
    mutate(input);
    expect(() => buildReviewCutCommandPlan(input)).toThrow(expected);
  });
});

describe('renderReviewCut', () => {
  beforeEach(() => {
    createCommandMock.mockReset();
    runCommandMock.mockReset();
    existsSyncMock.mockReset();
    codecConfigMock.mockReset();
    existsSyncMock.mockReturnValue(true);
    codecConfigMock.mockReturnValue({ encoder: 'test-h264', outputOptions: ['-b:v 8M'] });
  });

  it('runs the canonical command with progress and cancellation wiring', async () => {
    let progressListener:
      | ((progress: { percent?: number; timemark: string }) => void)
      | undefined;
    const command = {
      input: vi.fn().mockReturnThis(),
      on: vi.fn().mockImplementation((event, listener) => {
        if (event === 'progress') progressListener = listener;
        return command;
      }),
      complexFilter: vi.fn().mockReturnThis(),
      addOutputOptions: vi.fn().mockReturnThis(),
      output: vi.fn().mockReturnThis(),
    };
    createCommandMock.mockReturnValue(command);
    runCommandMock.mockImplementation(async () => {
      progressListener?.({ timemark: '00:00:02.000' });
    });
    const controller = new AbortController();
    const updates: number[] = [];

    await renderReviewCut(makeInput(), 'C:\\exports\\review.mp4', {
      signal: controller.signal,
      onProgress: ({ percentage }) => updates.push(percentage),
    });

    expect(command.input.mock.calls).toEqual([
      ['C:\\media\\first.mp4'],
      ['C:\\media\\second.mp4'],
      ['C:\\media\\silent.mp4'],
    ]);
    expect(command.complexFilter).toHaveBeenCalledWith(expect.stringContaining('concat=n=3'));
    expect(command.output).toHaveBeenCalledWith('C:\\exports\\review.mp4');
    expect(runCommandMock).toHaveBeenCalledWith(command, controller.signal);
    expect(updates).toEqual([0, 50, 100]);
  });

  it('rejects an aborted render before creating FFmpeg work', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      renderReviewCut(makeInput(), 'C:\\exports\\review.mp4', { signal: controller.signal }),
    ).rejects.toThrow('Render aborted');
    expect(createCommandMock).not.toHaveBeenCalled();
  });

  it('requires an existing output directory and an MP4 path', async () => {
    existsSyncMock.mockReturnValue(false);
    await expect(renderReviewCut(makeInput(), 'C:\\missing\\review.mp4')).rejects.toThrow(
      'Output directory does not exist',
    );

    existsSyncMock.mockReturnValue(true);
    await expect(renderReviewCut(makeInput(), 'C:\\exports\\review.mov')).rejects.toThrow(
      'Output path must use the .mp4 extension',
    );
  });
});
