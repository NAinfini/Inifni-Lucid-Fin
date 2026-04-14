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

    db.insertAsset({
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

  it('routes colorStyle:extract through the style.extract workflow and returns a workflow id', async () => {
    const workflowEngine = {
      start: vi.fn(() => 'wf-1'),
    };

    registerColorStyleHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as Parameters<typeof registerColorStyleHandlers>[0],
      db,
      {} as Parameters<typeof registerColorStyleHandlers>[2],
      workflowEngine as Parameters<typeof registerColorStyleHandlers>[3],
    );

    const extract = handlers.get('colorStyle:extract');

    expect(extract).toBeTypeOf('function');

    const result = (await extract?.(
      {},
      {
        assetHash: 'asset-hash',
        assetType: 'image',
      },
    )) as { workflowRunId: string };

    expect(result).toEqual({ workflowRunId: 'wf-1' });
    expect(workflowEngine.start).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowType: 'style.extract',
        entityType: 'asset',
        entityId: 'asset-hash',
        triggerSource: 'colorStyle:extract',
        input: {
          assetHash: 'asset-hash',
          assetType: 'image',
        },
      }),
    );
    expect(db.listColorStyles()).toHaveLength(0);
  });
});
