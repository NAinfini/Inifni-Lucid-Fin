import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
import { registerReviewCutHandlers } from './review-cut.handlers.js';

describe('registerReviewCutHandlers', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const service = {
    startApproved: vi.fn(() => ({
      jobId: 'job-1',
      status: 'queued',
      progress: 0,
      outputPath: 'C:\\exports\\review.mp4',
      manifestRevision: 2,
      manifestHash: 'a'.repeat(64),
    })),
    getStatus: vi.fn(() => null),
    cancel: vi.fn(() => null),
    requireCompletedOutputPath: vi.fn(() => 'C:\\exports\\review.mp4'),
  };
  const showSaveDialog = vi.fn();
  const openPath = vi.fn(async () => '');

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerReviewCutHandlers(
      { handle: (channel, handler) => handlers.set(channel, handler) } as unknown as IpcMain,
      () => null,
      service as never,
      { dialog: { showSaveDialog } as never, shell: { openPath } },
    );
  });

  it('uses the host save dialog and starts from approval identity only', async () => {
    showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: 'C:\\exports\\review.mp4',
    });
    const request = {
      taskListId: 'list-1',
      canvasId: 'canvas-1',
      expectedManifestRevision: 2,
      expectedManifestHash: 'a'.repeat(64),
    };

    await expect(handlers.get('reviewCut:start')?.({}, request)).resolves.toMatchObject({
      cancelled: false,
      job: { jobId: 'job-1' },
    });
    expect(showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: 'review-cut-aaaaaaaaaaaa.mp4',
        filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      }),
    );
    expect(service.startApproved).toHaveBeenCalledWith({
      ...request,
      outputPath: 'C:\\exports\\review.mp4',
    });
  });

  it('does not create a job when the host picker is cancelled', async () => {
    showSaveDialog.mockResolvedValueOnce({ canceled: true });

    await expect(
      handlers.get('reviewCut:start')?.({}, {
        taskListId: 'list-1',
        canvasId: 'canvas-1',
        expectedManifestRevision: 2,
        expectedManifestHash: 'a'.repeat(64),
      }),
    ).resolves.toEqual({ cancelled: true });
    expect(service.startApproved).not.toHaveBeenCalled();
  });

  it('rejects renderer-provided paths and source facts', async () => {
    const request = {
      taskListId: 'list-1',
      canvasId: 'canvas-1',
      expectedManifestRevision: 2,
      expectedManifestHash: 'a'.repeat(64),
    };

    await expect(
      handlers.get('reviewCut:start')?.({}, { ...request, outputPath: 'C:\\forged.mp4' }),
    ).rejects.toThrow('unsupported field "outputPath"');
    await expect(
      handlers.get('reviewCut:start')?.({}, { ...request, items: [{ trimInMs: 0 }] }),
    ).rejects.toThrow('unsupported field "items"');
  });

  it('registers only start, status, cancel, and open', async () => {
    expect([...handlers.keys()].sort()).toEqual([
      'reviewCut:cancel',
      'reviewCut:open',
      'reviewCut:start',
      'reviewCut:status',
    ]);
    await expect(
      handlers.get('reviewCut:open')?.({}, { jobId: 'job-1' }),
    ).resolves.toEqual({ opened: true });
    expect(openPath).toHaveBeenCalledWith('C:\\exports\\review.mp4');
  });
});
