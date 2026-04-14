import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from '@lucid-fin/storage';

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

import { registerSnapshotHandlers } from './snapshot.handlers.js';

type IpcHandler = (event: unknown, args: unknown) => Promise<unknown>;

function makeMockIpc() {
  const handlers = new Map<string, IpcHandler>();
  return {
    handle: (channel: string, fn: IpcHandler) => { handlers.set(channel, fn); },
    invoke: (channel: string, args: unknown) => {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`No handler for ${channel}`);
      return fn({}, args);
    },
    handlers,
  };
}

describe('snapshot.handlers', () => {
  let db: SqliteIndex;
  let ipc: ReturnType<typeof makeMockIpc>;
  let base: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-snap-h-'));
    db = new SqliteIndex(path.join(base, 'test.db'));
    ipc = makeMockIpc();
    registerSnapshotHandlers(ipc as unknown as import('electron').IpcMain, db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('session:upsert and session:list round-trip', async () => {
    await ipc.invoke('session:upsert', {
      id: 's1', canvasId: null, title: 'T', messages: '[]', createdAt: 1000, updatedAt: 1000,
    });
    const rows = await ipc.invoke('session:list', {}) as Array<{ id: string }>;
    expect(rows.some(r => r.id === 's1')).toBe(true);
  });

  it('session:list strips messages field', async () => {
    await ipc.invoke('session:upsert', {
      id: 's1', canvasId: null, title: 'T', messages: '[{"role":"user"}]', createdAt: 1000, updatedAt: 1000,
    });
    const rows = await ipc.invoke('session:list', {}) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].messages).toBeUndefined();
    expect(rows[0].id).toBe('s1');
  });

  it('session:get returns messages field', async () => {
    await ipc.invoke('session:upsert', {
      id: 's1', canvasId: null, title: 'T', messages: '[{"role":"user"}]', createdAt: 1000, updatedAt: 1000,
    });
    const s = await ipc.invoke('session:get', { id: 's1' }) as { messages: string };
    expect(JSON.parse(s.messages)).toHaveLength(1);
  });

  it('session:get throws for unknown id', async () => {
    await expect(
      ipc.invoke('session:get', { id: 'ghost' })
    ).rejects.toThrow('Session not found');
  });

  it('session:delete removes session', async () => {
    await ipc.invoke('session:upsert', {
      id: 's1', canvasId: null, title: 'T', messages: '[]', createdAt: 1000, updatedAt: 1000,
    });
    await ipc.invoke('session:delete', { id: 's1' });
    const rows = await ipc.invoke('session:list', {}) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('snapshot:capture returns metadata without data field', async () => {
    await ipc.invoke('session:upsert', {
      id: 's1', canvasId: null, title: 'T', messages: '[]', createdAt: 1000, updatedAt: 1000,
    });
    const snap = await ipc.invoke('snapshot:capture', {
      sessionId: 's1', label: 'pre-edit', trigger: 'auto',
    }) as Record<string, unknown>;
    expect(snap.id).toBeTruthy();
    expect(snap.data).toBeUndefined();
  });

  it('snapshot:list returns metadata without data field', async () => {
    await ipc.invoke('session:upsert', {
      id: 's1', canvasId: null, title: 'T', messages: '[]', createdAt: 1000, updatedAt: 1000,
    });
    await ipc.invoke('snapshot:capture', { sessionId: 's1', label: 'x', trigger: 'auto' });
    const snaps = await ipc.invoke('snapshot:list', { sessionId: 's1' }) as Array<Record<string, unknown>>;
    expect(snaps).toHaveLength(1);
    expect(snaps[0].data).toBeUndefined();
  });

  it('snapshot:restore replaces entity data', async () => {
    db.upsertCharacter({ id: 'c1', name: 'Before' });
    await ipc.invoke('session:upsert', {
      id: 's1', canvasId: null, title: 'T', messages: '[]', createdAt: 1000, updatedAt: 1000,
    });
    const snap = await ipc.invoke('snapshot:capture', {
      sessionId: 's1', label: '', trigger: 'auto',
    }) as { id: string };

    db.upsertCharacter({ id: 'c2', name: 'After' });
    expect(db.listCharacters()).toHaveLength(2);

    await ipc.invoke('snapshot:restore', { snapshotId: snap.id });
    expect(db.listCharacters()).toHaveLength(1);
    expect(db.listCharacters()[0].name).toBe('Before');
  });

  it('snapshot:delete removes the snapshot', async () => {
    await ipc.invoke('session:upsert', {
      id: 's1', canvasId: null, title: 'T', messages: '[]', createdAt: 1000, updatedAt: 1000,
    });
    const snap = await ipc.invoke('snapshot:capture', {
      sessionId: 's1', label: '', trigger: 'auto',
    }) as { id: string };
    await ipc.invoke('snapshot:delete', { snapshotId: snap.id });
    const snaps = await ipc.invoke('snapshot:list', { sessionId: 's1' }) as unknown[];
    expect(snaps).toHaveLength(0);
  });

  it('throws on unknown snapshotId for restore', async () => {
    await expect(
      ipc.invoke('snapshot:restore', { snapshotId: 'ghost' })
    ).rejects.toThrow('Snapshot not found');
  });
});
