import type { IpcMain } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import { parseSessionId, parseSnapshotId } from '@lucid-fin/contracts-parse';
import log from '../../logger.js';

const MAX_SESSIONS = 50;

export function registerSnapshotHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  const { sessions, snapshots } = db.repos;

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  ipcMain.handle('session:upsert', async (_e, args: {
    id: string;
    canvasId: string | null;
    title: string;
    messages: string;
    createdAt: number;
    updatedAt: number;
  }) => {
    if (!args?.id) throw new Error('id is required');
    sessions.upsert({ ...args, id: parseSessionId(args.id) });
    // Prune oldest sessions beyond MAX_SESSIONS
    const all = sessions.list(MAX_SESSIONS + 10).rows;
    if (all.length > MAX_SESSIONS) {
      for (const old of all.slice(MAX_SESSIONS)) {
        sessions.delete(parseSessionId(old.id));
      }
    }
  });

  ipcMain.handle('session:list', async (_e, args?: { limit?: number }) => {
    const list = sessions.list(args?.limit ?? MAX_SESSIONS).rows;
    // Strip messages from list response (heavy payload)
    return list.map(({ messages: _m, ...rest }) => rest);
  });

  ipcMain.handle('session:get', async (_e, args: { id: string }) => {
    if (!args?.id) throw new Error('id is required');
    const s = sessions.get(parseSessionId(args.id));
    if (!s) throw new Error(`Session not found: ${args.id}`);
    return s;
  });

  ipcMain.handle('session:delete', async (_e, args: { id: string }) => {
    if (!args?.id) throw new Error('id is required');
    sessions.delete(parseSessionId(args.id));
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // Snapshots
  // ---------------------------------------------------------------------------

  ipcMain.handle('snapshot:capture', async (_e, args: {
    sessionId: string;
    label: string;
    trigger?: 'auto' | 'manual';
  }) => {
    if (!args?.sessionId) throw new Error('sessionId is required');
    const trigger = args.trigger ?? 'auto';
    const snap = snapshots.capture(parseSessionId(args.sessionId), args.label ?? '', trigger);
    // Tiered retention: keep recent snapshots dense, thin out older ones
    snapshots.pruneTiered();
    log.debug('Snapshot captured', { category: 'snapshot', sessionId: args.sessionId, snapId: snap.id, trigger });
    // Return metadata without the heavy data blob
    const { data: _d, ...meta } = snap;
    return meta;
  });

  ipcMain.handle('snapshot:restore', async (_e, args: { snapshotId: string }) => {
    if (!args?.snapshotId) throw new Error('snapshotId is required');
    snapshots.restore(parseSnapshotId(args.snapshotId));
    log.info('Snapshot restored', { category: 'snapshot', snapshotId: args.snapshotId });
    return { success: true };
  });

  ipcMain.handle('snapshot:list', async (_e, args: { sessionId: string }) => {
    if (!args?.sessionId) throw new Error('sessionId is required');
    const snaps = snapshots.list(parseSessionId(args.sessionId)).rows;
    return snaps.map(({ data: _d, ...meta }) => meta);
  });

  ipcMain.handle('snapshot:delete', async (_e, args: { snapshotId: string }) => {
    if (!args?.snapshotId) throw new Error('snapshotId is required');
    snapshots.delete(parseSnapshotId(args.snapshotId));
    return { success: true };
  });
}
