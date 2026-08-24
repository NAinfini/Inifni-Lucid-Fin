import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteIndex } from '@lucid-fin/storage';
import { registerColorStyleHandlers } from './color-style.handlers.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-color-style-ipc-'));
}

describe('registerColorStyleHandlers', () => {
  let base: string;
  let db: SqliteIndex;
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
    handlers = new Map();

    db.repos.assets.insert({
      hash: 'asset-hash',
      type: 'image',
      format: 'png',
      originalName: 'ref.png',
      fileSize: 42,
      tags: [],
      createdAt: 100,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('routes colorStyle:extract through the style.extract task list and returns its id', async () => {
    const taskExecutionEngine = {
      start: vi.fn(() => 'task-list-1'),
    };

    registerColorStyleHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as Parameters<typeof registerColorStyleHandlers>[0],
      db,
      {} as Parameters<typeof registerColorStyleHandlers>[2],
      taskExecutionEngine as Parameters<typeof registerColorStyleHandlers>[3],
    );

    const extract = handlers.get('colorStyle:extract');

    expect(extract).toBeTypeOf('function');

    const result = (await extract?.(
      {},
      {
        assetHash: 'asset-hash',
        assetType: 'image',
      },
    )) as { taskListId: string };

    expect(result).toEqual({ taskListId: 'task-list-1' });
    expect(taskExecutionEngine.start).toHaveBeenCalledWith(
      expect.objectContaining({
        taskListType: 'style.extract',
        entityType: 'asset',
        entityId: 'asset-hash',
        triggerSource: 'colorStyle:extract',
        input: {
          assetHash: 'asset-hash',
          assetType: 'image',
        },
      }),
    );
    expect(db.repos.colorStyles.list()).toHaveLength(0);
  });
});
