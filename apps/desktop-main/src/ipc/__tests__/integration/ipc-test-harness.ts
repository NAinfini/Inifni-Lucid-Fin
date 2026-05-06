/**
 * Shared IPC integration test harness.
 *
 * Provides a real SqliteIndex (temp-file DB with the full schema),
 * a fake IpcMain that captures handler registrations, and a typed `invoke`
 * helper that simulates the Electron IPC round-trip without Electron itself.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { SqliteIndex } from '@lucid-fin/storage';

// ---------------------------------------------------------------------------
// Fake IpcMain
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerFn = (event: IpcMainInvokeEvent, ...args: any[]) => any;

export interface FakeIpcMain extends IpcMain {
  /** Read-only map of registered channels -> handlers. */
  readonly handlers: ReadonlyMap<string, HandlerFn>;
}

/**
 * Create a minimal fake `IpcMain` that records `.handle()` calls.
 * Only `.handle()` is implemented — other methods throw if called.
 */
export function createFakeIpcMain(): FakeIpcMain {
  const handlers = new Map<string, HandlerFn>();

  const fake = {
    handle(channel: string, listener: HandlerFn) {
      if (handlers.has(channel)) {
        throw new Error(`IPC channel already registered: ${channel}`);
      }
      handlers.set(channel, listener);
    },
    get handlers() {
      return handlers;
    },
  } as unknown as FakeIpcMain;

  return fake;
}

// ---------------------------------------------------------------------------
// invoke() helper
// ---------------------------------------------------------------------------

/**
 * Simulate `ipcRenderer.invoke(channel, args)` by calling the registered
 * handler directly. Returns the handler's return value or throws its error.
 */
export async function invoke<T = unknown>(
  ipcMain: FakeIpcMain,
  channel: string,
  args?: unknown,
): Promise<T> {
  const handler = ipcMain.handlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for channel: ${channel}`);
  }
  // Simulate the IpcMainInvokeEvent (handlers only use `_event` as a throwaway).
  const fakeEvent = {} as IpcMainInvokeEvent;
  return (await handler(fakeEvent, args)) as T;
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

export interface TestDb {
  db: SqliteIndex;
  dbPath: string;
  tmpDir: string;
}

/**
 * Create a real SqliteIndex backed by a temporary file DB.
 * Runs full schema bootstrap.
 * Caller MUST call `cleanup()` in `afterEach`.
 */
export function createTestDb(): TestDb {
  const tmpDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-ipc-int-'));
  const dbPath = path.join(tmpDirPath, 'test.db');
  const db = new SqliteIndex(dbPath);
  return { db, dbPath, tmpDir: tmpDirPath };
}

/**
 * Tear down the test DB — close the connection and remove temp files.
 */
export function cleanupTestDb(testDb: TestDb): void {
  testDb.db.close();
  fs.rmSync(testDb.tmpDir, { recursive: true, force: true });
}
