import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  assertSafePathMock,
  detectScenesMock,
  extractFrameAtTimeMock,
  getSafeRootsMock,
  logger,
  mkdtempSyncMock,
  progressEmitMock,
  rmSyncMock,
  showOpenDialogMock,
  tmpdirMock,
} = vi.hoisted(() => ({
  assertSafePathMock: vi.fn(),
  detectScenesMock: vi.fn(),
  extractFrameAtTimeMock: vi.fn(),
  getSafeRootsMock: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
  mkdtempSyncMock: vi.fn(),
  progressEmitMock: vi.fn(),
  rmSyncMock: vi.fn(),
  showOpenDialogMock: vi.fn(),
  tmpdirMock: vi.fn(),
}));

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: showOpenDialogMock,
  },
}));

vi.mock('node:fs', () => ({
  default: {
    mkdtempSync: mkdtempSyncMock,
    rmSync: rmSyncMock,
  },
  mkdtempSync: mkdtempSyncMock,
  rmSync: rmSyncMock,
}));

vi.mock('node:os', () => ({
  default: {
    tmpdir: tmpdirMock,
  },
  tmpdir: tmpdirMock,
}));

vi.mock('@lucid-fin/media-engine', () => ({
  detectScenes: detectScenesMock,
  extractFrameAtTime: extractFrameAtTimeMock,
}));

vi.mock('../../features/ipc/push-gateway.js', () => ({
  createRendererPushGateway: vi.fn(() => ({ emit: progressEmitMock })),
}));

vi.mock('../path-safety.js', () => ({
  assertSafePath: assertSafePathMock,
  getSafeRoots: getSafeRootsMock,
}));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

import { registerVideoCloneHandlers } from './video-clone.handlers.js';

type Handler = (...args: unknown[]) => Promise<unknown>;

function registerHandlers() {
  const handlers = new Map<string, Handler>();
  const importAsset = vi.fn();
  const save = vi.fn();

  registerVideoCloneHandlers(
    {
      handle(channel: string, handler: Handler) {
        handlers.set(channel, handler);
      },
    } as never,
    {
      cas: { importAsset },
      canvasStore: { save },
      getWindow: () => null,
    } as never,
  );

  return { handlers, importAsset, save };
}

function getHandler(handlers: Map<string, Handler>, channel: string): Handler {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Missing handler: ${channel}`);
  return handler;
}

beforeEach(() => {
  vi.clearAllMocks();
  detectScenesMock.mockResolvedValue([]);
  getSafeRootsMock.mockReturnValue(['C:\\temp']);
  mkdtempSyncMock.mockReturnValue('C:\\temp\\lucid-video-clone-test');
  showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });
  tmpdirMock.mockReturnValue('C:\\temp');
});

describe('registerVideoCloneHandlers', () => {
  it('rejects clone requests without a string file path', async () => {
    const { handlers } = registerHandlers();
    const clone = getHandler(handlers, 'video:clone');

    await expect(clone({}, {})).rejects.toThrow('filePath is required');
    await expect(clone({}, { filePath: 42 })).rejects.toThrow('filePath is required');

    expect(assertSafePathMock).not.toHaveBeenCalled();
    expect(mkdtempSyncMock).not.toHaveBeenCalled();
  });

  it('returns an empty result and removes the temp directory when no scenes are detected', async () => {
    const { handlers, save } = registerHandlers();
    const clone = getHandler(handlers, 'video:clone');
    const filePath = 'C:\\temp\\source.mp4';

    await expect(clone({}, { filePath })).resolves.toEqual({
      canvasId: '',
      nodeCount: 0,
    });

    expect(assertSafePathMock).toHaveBeenCalledWith(filePath, ['C:\\temp']);
    expect(detectScenesMock).toHaveBeenCalledWith(filePath, 0.4);
    expect(extractFrameAtTimeMock).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(rmSyncMock).toHaveBeenCalledWith('C:\\temp\\lucid-video-clone-test', {
      recursive: true,
      force: true,
    });
  });

  it('builds a connected video canvas from detected scenes', async () => {
    detectScenesMock.mockResolvedValue([{ time: 0 }, { time: 2.5 }]);
    extractFrameAtTimeMock.mockResolvedValue(undefined);
    const { handlers, importAsset, save } = registerHandlers();
    importAsset
      .mockResolvedValueOnce({ ref: { hash: 'frame-hash-1' } })
      .mockResolvedValueOnce({ ref: { hash: 'frame-hash-2' } });
    const clone = getHandler(handlers, 'video:clone');

    await expect(clone({}, { filePath: 'C:\\temp\\source.mp4', threshold: 0.6 })).resolves.toEqual({
      canvasId: expect.any(String),
      nodeCount: 2,
    });

    expect(extractFrameAtTimeMock).toHaveBeenNthCalledWith(
      1,
      'C:\\temp\\source.mp4',
      0,
      'C:\\temp\\lucid-video-clone-test\\frame-0.png',
    );
    expect(importAsset).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledOnce();
    const canvas = save.mock.calls[0]?.[0] as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
      edges: Array<{ source: string; target: string }>;
    };
    expect(canvas.nodes).toHaveLength(2);
    expect(canvas.nodes[0]?.data).toMatchObject({ sourceImageHash: 'frame-hash-1' });
    expect(canvas.nodes[1]?.data).toMatchObject({
      sourceImageHash: 'frame-hash-2',
      firstFrameAssetHash: 'frame-hash-1',
    });
    expect(canvas.edges).toEqual([
      expect.objectContaining({ source: canvas.nodes[0]?.id, target: canvas.nodes[1]?.id }),
    ]);
    expect(progressEmitMock.mock.calls.map((call) => call[1]?.step)).toEqual([
      'detect',
      'extract',
      'extract',
      'build',
    ]);
    expect(rmSyncMock).toHaveBeenCalledWith('C:\\temp\\lucid-video-clone-test', {
      recursive: true,
      force: true,
    });
  });

  it('returns null for a cancelled picker and the selected video path otherwise', async () => {
    const { handlers } = registerHandlers();
    const pickFile = getHandler(handlers, 'video:pickFile');
    showOpenDialogMock
      .mockResolvedValueOnce({ canceled: true, filePaths: [] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\videos\\sample.mp4'] });

    await expect(pickFile({})).resolves.toBeNull();
    await expect(pickFile({})).resolves.toBe('C:\\videos\\sample.mp4');

    expect(showOpenDialogMock).toHaveBeenCalledTimes(2);
    expect(showOpenDialogMock).toHaveBeenCalledWith({
      filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] }],
      properties: ['openFile'],
    });
  });
});
