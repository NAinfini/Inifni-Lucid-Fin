import { describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

const APP_ROOT = path.join(os.homedir(), '.lucid-fin');
const CAS_ROOT = path.join(APP_ROOT, 'assets');

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));
const showOpenDialog = vi.hoisted(() => vi.fn());
const showSaveDialog = vi.hoisted(() => vi.fn());
const probeMedia = vi.hoisted(() => vi.fn());

vi.mock('../../logger.js', () => ({ default: logger }));
vi.mock('electron', () => ({ dialog: { showOpenDialog, showSaveDialog } }));
vi.mock('@lucid-fin/media-engine', () => ({ probeMedia }));

import { registerAssetHandlers } from './asset.handlers.js';

type Handler = (...args: unknown[]) => unknown;

function createEntry(id: string, hash = 'hash-1') {
  return {
    id,
    hash,
    displayName: `${id}.png`,
    tags: [],
    folderId: null,
    type: 'image',
    format: 'png',
    originalName: `${id}.png`,
    fileSize: 10,
    createdAt: 1,
    contentCreatedAt: 1,
  };
}

function setup(overrides?: { cas?: Record<string, unknown>; assets?: Record<string, unknown> }) {
  vi.clearAllMocks();
  const handlers = new Map<string, Handler>();
  const cas = {
    importAsset: vi.fn(),
    importBuffer: vi.fn(),
    getAssetPath: vi.fn((hash: string, type: string, ext: string) =>
      path.join(CAS_ROOT, type, `${hash}.${ext}`),
    ),
    getAssetsRoot: vi.fn(() => CAS_ROOT),
    deleteAsset: vi.fn(),
    ...overrides?.cas,
  };
  const assets = {
    insert: vi.fn(),
    query: vi.fn(() => ({ rows: [] })),
    search: vi.fn(() => ({ rows: [] })),
    copyEntries: vi.fn(() => []),
    moveEntry: vi.fn(),
    renameEntry: vi.fn(),
    deleteEntry: vi.fn(),
    findByHash: vi.fn(),
    updateTechnicalMetadata: vi.fn(),
    repairSizes: vi.fn(() => 0),
    ...overrides?.assets,
  };

  registerAssetHandlers(
    { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) } as never,
    cas as never,
    { repos: { assets } } as never,
  );

  return { handlers, cas, assets };
}

describe('registerAssetHandlers', () => {
  it('registers only canonical entry and content product channels', () => {
    const { handlers } = setup();

    expect([...handlers.keys()].sort()).toEqual([
      'assetContent:export',
      'assetContent:getPath',
      'assetContent:inspect',
      'assetEntry:copy',
      'assetEntry:delete',
      'assetEntry:import',
      'assetEntry:importBuffer',
      'assetEntry:move',
      'assetEntry:pickFile',
      'assetEntry:query',
      'assetEntry:rename',
    ]);
    expect([...handlers.keys()].some((channel) => channel.startsWith('asset:'))).toBe(false);
  });

  it('imports CAS content and returns the created logical entry', async () => {
    const entry = createEntry('entry-import', 'hash-import');
    const meta = {
      hash: 'hash-import',
      type: 'image',
      format: 'png',
      originalName: 'hero.png',
      fileSize: 10,
      createdAt: 1,
    };
    const { handlers, cas, assets } = setup({
      cas: { importAsset: vi.fn(async () => ({ ref: { hash: 'hash-import' }, meta })) },
      assets: { insert: vi.fn(() => entry) },
    });
    const filePath = path.join(os.tmpdir(), 'hero.png');

    await expect(
      handlers.get('assetEntry:import')?.({}, { filePath, type: 'image' }),
    ).resolves.toEqual(entry);
    expect(cas.importAsset).toHaveBeenCalledWith(filePath, 'image');
    expect(assets.insert).toHaveBeenCalledWith(meta);
    expect(logger.info).toHaveBeenCalledWith(
      'Asset imported',
      expect.objectContaining({ hash: 'hash-import', entryId: 'entry-import' }),
    );
  });

  it('persists authoritative embedded-audio facts when importing a video', async () => {
    probeMedia.mockResolvedValue({
      durationSeconds: 12.5,
      width: 1920,
      height: 1080,
      hasAudio: true,
    });
    const entry = { ...createEntry('entry-video', 'hash-video'), type: 'video', format: 'mp4' };
    const meta = {
      hash: 'hash-video',
      type: 'video',
      format: 'mp4',
      originalName: 'scene.mp4',
      fileSize: 10,
      createdAt: 1,
    };
    const videoPath = path.join(CAS_ROOT, 'video', 'hash-video.mp4');
    const { handlers, assets } = setup({
      cas: {
        importAsset: vi.fn(async () => ({ ref: { hash: 'hash-video', path: videoPath }, meta })),
      },
      assets: { insert: vi.fn(() => entry) },
    });

    await expect(
      handlers.get('assetEntry:import')?.({}, { filePath: path.join(os.tmpdir(), 'scene.mp4'), type: 'video' }),
    ).resolves.toEqual(entry);
    expect(probeMedia).toHaveBeenCalledWith(videoPath);
    expect(assets.insert).toHaveBeenCalledWith({
      ...meta,
      width: 1920,
      height: 1080,
      duration: 12.5,
      hasAudio: true,
    });
  });

  it('re-inspects existing audio/video content and persists technical metadata', async () => {
    probeMedia.mockResolvedValue({
      durationSeconds: 8,
      width: 1280,
      height: 720,
      hasAudio: false,
    });
    const asset = {
      hash: 'hash-inspect',
      type: 'video',
      format: 'mp4',
      originalName: 'inspect.mp4',
      fileSize: 10,
      createdAt: 1,
    };
    const inspected = { ...asset, width: 1280, height: 720, duration: 8, hasAudio: false };
    const { handlers, cas, assets } = setup({
      assets: {
        findByHash: vi.fn(() => asset),
        updateTechnicalMetadata: vi.fn(() => inspected),
      },
    });

    await expect(
      handlers.get('assetContent:inspect')?.({}, { hash: 'hash-inspect' }),
    ).resolves.toEqual(inspected);
    expect(cas.getAssetPath).toHaveBeenCalledWith('hash-inspect', 'video', 'mp4');
    expect(assets.updateTechnicalMetadata).toHaveBeenCalledWith('hash-inspect', {
      width: 1280,
      height: 720,
      duration: 8,
      hasAudio: false,
    });
  });

  it('copies entries without duplicating CAS content', async () => {
    const copies = [createEntry('entry-copy', 'shared-hash')];
    const { handlers, cas, assets } = setup({
      assets: { copyEntries: vi.fn(() => copies) },
    });

    await expect(
      handlers.get('assetEntry:copy')?.(
        {},
        { entryIds: ['entry-source'], targetFolderId: 'folder-target' },
      ),
    ).resolves.toEqual(copies);
    expect(assets.copyEntries).toHaveBeenCalledWith(['entry-source'], 'folder-target');
    expect(cas.importAsset).not.toHaveBeenCalled();
    expect(cas.importBuffer).not.toHaveBeenCalled();
  });

  it('moves a logical entry batch and renames one entry', async () => {
    const moved = { ...createEntry('entry-1'), folderId: 'folder-1' };
    const renamed = { ...moved, displayName: 'Hero close-up' };
    const { handlers, assets } = setup({
      assets: {
        moveEntry: vi.fn(() => ['entry-1', 'entry-2']),
        renameEntry: vi.fn(() => renamed),
      },
    });

    await expect(
      handlers.get('assetEntry:move')?.(
        {},
        { entryIds: ['entry-1', 'entry-2'], folderId: 'folder-1' },
      ),
    ).resolves.toEqual({ movedEntryIds: ['entry-1', 'entry-2'] });
    await expect(
      handlers.get('assetEntry:rename')?.(
        {},
        { entryId: 'entry-1', displayName: '  Hero close-up  ' },
      ),
    ).resolves.toEqual(renamed);
    expect(assets.moveEntry).toHaveBeenCalledOnce();
    expect(assets.moveEntry).toHaveBeenCalledWith(['entry-1', 'entry-2'], 'folder-1');
    expect(assets.renameEntry).toHaveBeenCalledWith('entry-1', 'Hero close-up');
  });

  it('deletes a logical entry batch and leaves CAS content untouched', async () => {
    const { handlers, cas, assets } = setup({
      assets: { deleteEntry: vi.fn(() => ['entry-1', 'entry-2']) },
    });

    await expect(
      handlers.get('assetEntry:delete')?.({}, { entryIds: ['entry-1', 'entry-2'] }),
    ).resolves.toEqual({ deletedEntryIds: ['entry-1', 'entry-2'] });
    expect(assets.deleteEntry).toHaveBeenCalledOnce();
    expect(assets.deleteEntry).toHaveBeenCalledWith(['entry-1', 'entry-2']);
    expect(cas.deleteAsset).not.toHaveBeenCalled();

    await expect(handlers.get('assetEntry:delete')?.({}, { entryIds: [] })).rejects.toThrow(
      'entryIds are required',
    );
    expect(assets.deleteEntry).toHaveBeenCalledOnce();
  });

  it('routes logical queries to entry search or listing', async () => {
    const searched = [createEntry('searched')];
    const listed = [createEntry('listed')];
    const { handlers, assets } = setup({
      assets: {
        search: vi.fn(() => ({ rows: searched })),
        query: vi.fn(() => ({ rows: listed })),
      },
    });

    await expect(
      handlers.get('assetEntry:query')?.({}, { search: 'hero', limit: 5 }),
    ).resolves.toEqual(searched);
    await expect(
      handlers.get('assetEntry:query')?.({}, { type: 'audio', tags: ['voice'], offset: 4 }),
    ).resolves.toEqual(listed);
    expect(assets.search).toHaveBeenCalledWith('hero', 5);
    expect(assets.query).toHaveBeenCalledWith({
      type: 'audio',
      tags: ['voice'],
      limit: undefined,
      offset: 4,
    });
  });

  it('resolves content paths by hash without requiring an entry', async () => {
    const { handlers, cas } = setup();
    const expected = path.join(CAS_ROOT, 'image', 'hash-content.png');

    await expect(
      handlers.get('assetContent:getPath')?.({}, { hash: 'hash-content', type: 'image', ext: '' }),
    ).resolves.toBe(expected);
    expect(cas.getAssetPath).toHaveBeenCalledWith('hash-content', 'image', 'png');
  });

  it('returns null when the entry file picker is cancelled', async () => {
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const { handlers, cas } = setup();

    await expect(handlers.get('assetEntry:pickFile')?.({}, { type: 'video' })).resolves.toBeNull();
    expect(cas.importAsset).not.toHaveBeenCalled();
  });
});
