import { describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const describeImageAsset = vi.hoisted(() => vi.fn(async () => 'bright hero frame'));

vi.mock('../../logger.js', () => ({
  default: logger,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
}));

vi.mock('./vision.handlers.js', () => ({
  describeImageAsset,
}));

import { registerEmbeddingHandlers } from './embedding.handlers.js';

function registerHandlers() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const db = {
    repos: {
      assets: {
        insertEmbedding: vi.fn(),
        searchByTokens: vi.fn(() => [{ hash: 'asset-1' }]),
        query: vi.fn(() => ({ rows: [] })),
        getAllEmbeddedHashes: vi.fn(() => []),
      },
    },
  };

  registerEmbeddingHandlers(
    {
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never,
    {
      cas: {} as never,
      keychain: {} as never,
      db: db as never,
    },
  );

  return { handlers, db };
}

describe('registerEmbeddingHandlers', () => {
  it('registers all embedding IPC handlers', () => {
    const { handlers } = registerHandlers();

    expect([...handlers.keys()].sort()).toEqual([
      'asset:generateEmbedding',
      'asset:reindexEmbeddings',
      'asset:searchSemantic',
    ]);
  });

  it('rejects malformed generateEmbedding requests at the typed IPC boundary', async () => {
    const { handlers } = registerHandlers();

    await expect(
      handlers.get('asset:generateEmbedding')?.({}, { assetHash: 42 }),
    ).rejects.toThrow('assetHash is required');
  });

  it('generates an embedding for a valid asset hash', async () => {
    const { handlers, db } = registerHandlers();
    const validHash = 'e'.repeat(64);

    await expect(
      handlers.get('asset:generateEmbedding')?.({}, { assetHash: validHash }),
    ).resolves.toEqual({ ok: true });

    expect(describeImageAsset).toHaveBeenCalledWith({}, {}, validHash, 'description');
    expect(db.repos.assets.insertEmbedding).toHaveBeenCalledWith(
      validHash,
      'bright hero frame',
      ['bright', 'hero', 'frame'],
      'vision-description',
    );
  });
});
