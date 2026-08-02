import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

const mockRenderTimeline = vi.hoisted(() => vi.fn(async () => undefined));
const mockGetOutputExtension = vi.hoisted(() => vi.fn(() => 'mp4'));

vi.mock('@lucid-fin/media-engine', () => ({
  renderTimeline: mockRenderTimeline,
  getOutputExtension: mockGetOutputExtension,
}));

vi.mock('../path-safety.js', () => ({
  assertSafePath: (p: string) => p,
  getSafeRoots: () => ['/tmp'],
}));

import type { IpcMain } from 'electron';
import { registerRenderHandlers } from './render.handlers.js';

describe('registerRenderHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  let finalExportService: {
    startApproved: ReturnType<typeof vi.fn>;
    assertLegacyRenderAllowed: ReturnType<typeof vi.fn>;
    resolveLegacyCanvasSegments: ReturnType<typeof vi.fn>;
    getStatus: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    handlers = new Map();
    finalExportService = {
      startApproved: vi.fn(async () => ({
        jobId: 'persistent-job',
        outputPath: '/tmp/approved.mp4',
        duration: 5,
        format: 'mp4',
      })),
      assertLegacyRenderAllowed: vi.fn(),
      resolveLegacyCanvasSegments: vi.fn(() => [
        { inputPath: '/tmp/derived.mp4', startTime: 0, duration: 5, speed: 1 },
      ]),
      getStatus: vi.fn(() => ({ progress: 0, stage: 'unknown' })),
      cancel: vi.fn(),
    };
    const ipcMain = {
      handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn),
    } as unknown as IpcMain;
    registerRenderHandlers(ipcMain, finalExportService as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('render:start', () => {
    it('returns jobId and outputPath on valid input', async () => {
      const handler = handlers.get('render:start')!;
      const result = (await handler(
        {},
        {
          sceneId: 'scene-1',
          segments: [{ type: 'image', assetPath: '/tmp/img.png', duration: 3 }],
          outputFormat: 'mp4',
        },
      )) as { jobId: string; outputPath: string };

      expect(result.jobId).toBeTypeOf('string');
      expect(result.outputPath).toContain('lucid-render-');
      expect(result.format).toBe('mp4');
    });

    it('throws when segments is empty or missing', async () => {
      const handler = handlers.get('render:start')!;
      await expect(
        handler({}, { sceneId: 's', segments: [], outputFormat: 'mp4' }),
      ).rejects.toThrow('segments array is required');
      await expect(handler({}, null)).rejects.toThrow('request is required');
    });

    it('uses custom outputPath when provided', async () => {
      const handler = handlers.get('render:start')!;
      const result = (await handler(
        {},
        {
          sceneId: 'scene-1',
          segments: [{ type: 'image', assetPath: '/tmp/img.png', duration: 3 }],
          outputFormat: 'mp4',
          outputPath: '/tmp/custom-output.mp4',
        },
      )) as { outputPath: string };
      expect(result.outputPath).toBe('/tmp/custom-output.mp4');
    });

    it('derives manual canvas segments in the host when the renderer supplies no paths', async () => {
      const handler = handlers.get('render:start')!;
      await handler({}, { sceneId: 'scene-1', outputFormat: 'mp4' });

      expect(finalExportService.resolveLegacyCanvasSegments).toHaveBeenCalledWith('scene-1');
      await vi.waitFor(() =>
        expect(mockRenderTimeline).toHaveBeenCalledWith(
          [{ inputPath: '/tmp/derived.mp4', startTime: 0, duration: 5, speed: 1 }],
          expect.any(String),
          expect.any(Object),
        ),
      );
    });

    it('defaults codec to prores for mov format', async () => {
      const handler = handlers.get('render:start')!;
      mockGetOutputExtension.mockReturnValueOnce('mov');
      await handler(
        {},
        {
          sceneId: 'scene-1',
          segments: [{ type: 'image', assetPath: '/tmp/img.png', duration: 3 }],
          outputFormat: 'mov',
        },
      );
      expect(mockGetOutputExtension).toHaveBeenCalledWith('prores');
    });

    it('never starts the media engine before the persistent workflow service authorizes it', async () => {
      finalExportService.startApproved.mockRejectedValueOnce(
        new Error('Exact final_export approval is required'),
      );
      const handler = handlers.get('render:start')!;
      await expect(
        handler(
          {},
          {
            sceneId: 'canvas-1',
            workflowRunId: 'run-1',
            expectedManifestRevision: 1,
            expectedManifestHash: 'a'.repeat(64),
            outputPath: '/tmp/approved.mp4',
          },
        ),
      ).rejects.toThrow(/exact final_export approval is required/i);
      expect(mockRenderTimeline).not.toHaveBeenCalled();
    });

    it('rejects caller-supplied media and settings for a persistent workflow', async () => {
      const handler = handlers.get('render:start')!;
      await expect(
        handler(
          {},
          {
            sceneId: 'canvas-1',
            workflowRunId: 'run-1',
            expectedManifestRevision: 1,
            expectedManifestHash: 'a'.repeat(64),
            segments: [{ inputPath: '/tmp/forged.mp4', startTime: 0, duration: 1, speed: 1 }],
          },
        ),
      ).rejects.toThrow(/derive segments and output settings only from the approved manifest/i);
      expect(finalExportService.startApproved).not.toHaveBeenCalled();
      expect(mockRenderTimeline).not.toHaveBeenCalled();
    });

    it('blocks the legacy path when the service finds a persistent workflow bound to the canvas', async () => {
      finalExportService.assertLegacyRenderAllowed.mockImplementationOnce(() => {
        throw new Error('Canvas is owned by persistent workflow');
      });
      const handler = handlers.get('render:start')!;
      await expect(
        handler(
          {},
          {
            sceneId: 'canvas-1',
            segments: [{ inputPath: '/tmp/forged.mp4', startTime: 0, duration: 1, speed: 1 }],
            outputFormat: 'mp4',
          },
        ),
      ).rejects.toThrow(/owned by persistent workflow/i);
      expect(mockRenderTimeline).not.toHaveBeenCalled();
    });
  });

  describe('render:status', () => {
    it('returns stage and progress for existing job', async () => {
      const start = handlers.get('render:start')!;
      const { jobId } = (await start(
        {},
        {
          sceneId: 'scene-1',
          segments: [{ type: 'image', assetPath: '/tmp/img.png', duration: 3 }],
          outputFormat: 'mp4',
        },
      )) as { jobId: string };

      const status = handlers.get('render:status')!;
      const result = (await status({}, { jobId })) as { stage: string; progress: number };
      expect(result.stage).toBeTypeOf('string');
      expect(result.progress).toBeTypeOf('number');
    });

    it('returns unknown stage for non-existent job', async () => {
      const status = handlers.get('render:status')!;
      const result = (await status({}, { jobId: 'no-such-job' })) as { stage: string };
      expect(result.stage).toBe('unknown');
    });

    it('throws when jobId is missing', async () => {
      const status = handlers.get('render:status')!;
      await expect(status({}, {})).rejects.toThrow('jobId required');
    });
  });

  describe('render:cancel', () => {
    it('sets job stage to cancelled', async () => {
      const start = handlers.get('render:start')!;
      const { jobId } = (await start(
        {},
        {
          sceneId: 'scene-1',
          segments: [{ type: 'image', assetPath: '/tmp/img.png', duration: 3 }],
          outputFormat: 'mp4',
        },
      )) as { jobId: string };

      const cancel = handlers.get('render:cancel')!;
      await cancel({}, { jobId });

      const status = handlers.get('render:status')!;
      const result = (await status({}, { jobId })) as { stage: string };
      expect(result.stage).toBe('cancelled');
    });

    it('throws when jobId is missing', async () => {
      const cancel = handlers.get('render:cancel')!;
      await expect(cancel({}, {})).rejects.toThrow('jobId required');
    });

    it('no-ops for non-existent job', async () => {
      const cancel = handlers.get('render:cancel')!;
      await expect(cancel({}, { jobId: 'missing' })).resolves.toBeUndefined();
    });
  });
});
