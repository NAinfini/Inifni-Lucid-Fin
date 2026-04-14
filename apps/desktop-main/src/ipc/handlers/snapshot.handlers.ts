import type { IpcMain } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import log from '../../logger.js';

const MAX_SESSIONS = 50;

export function registerSnapshotHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
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
    db.upsertSession(args);
    // Prune oldest sessions beyond MAX_SESSIONS
    const all = db.listSessions(MAX_SESSIONS + 10);
    if (all.length > MAX_SESSIONS) {
      for (const old of all.slice(MAX_SESSIONS)) {
        db.deleteSession(old.id);
      }
    }
  });

  ipcMain.handle('session:list', async (_e, args?: { limit?: number }) => {
    const sessions = db.listSessions(args?.limit ?? MAX_SESSIONS);
    // Strip messages from list response (heavy payload)
    return sessions.map(({ messages: _m, ...rest }) => rest);
  });

  ipcMain.handle('session:get', async (_e, args: { id: string }) => {
    if (!args?.id) throw new Error('id is required');
    const s = db.getSession(args.id);
    if (!s) throw new Error(`Session not found: ${args.id}`);
    return s;
  });

  ipcMain.handle('session:delete', async (_e, args: { id: string }) => {
    if (!args?.id) throw new Error('id is required');
    db.deleteSession(args.id);
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
    const snap = db.captureSnapshot(args.sessionId, args.label ?? '', trigger);
    // Tiered retention: keep recent snapshots dense, thin out older ones
    db.pruneSnapshotsTiered();
    log.debug('Snapshot captured', { category: 'snapshot', sessionId: args.sessionId, snapId: snap.id, trigger });
    // Return metadata without the heavy data blob
    const { data: _d, ...meta } = snap;
    return meta;
  });

  ipcMain.handle('snapshot:restore', async (_e, args: { snapshotId: string }) => {
    if (!args?.snapshotId) throw new Error('snapshotId is required');
    db.restoreSnapshot(args.snapshotId);
    log.info('Snapshot restored', { category: 'snapshot', snapshotId: args.snapshotId });
    return { success: true };
  });

  ipcMain.handle('snapshot:list', async (_e, args: { sessionId: string }) => {
    if (!args?.sessionId) throw new Error('sessionId is required');
    const snaps = db.listSnapshots(args.sessionId);
    return snaps.map(({ data: _d, ...meta }) => meta);
  });

  ipcMain.handle('snapshot:delete', async (_e, args: { snapshotId: string }) => {
    if (!args?.snapshotId) throw new Error('snapshotId is required');
    db.deleteSnapshot(args.snapshotId);
    return { success: true };
  });
}
