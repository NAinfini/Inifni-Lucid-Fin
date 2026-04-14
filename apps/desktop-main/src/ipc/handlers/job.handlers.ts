import type { IpcMain, BrowserWindow } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import type { GenerationRequest } from '@lucid-fin/contracts';
import type { JobQueue } from '@lucid-fin/application';
import log from '../../logger.js';

export function registerJobHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  db: SqliteIndex,
  queue: JobQueue,
): void {
  ipcMain.handle(
    'job:submit',
    async (_e, args: GenerationRequest & { segmentId?: string }) => {
      const jobId = queue.submit(args);
      log.info('Job submitted', {
        category: 'job',
        jobId,
        providerId: args.providerId,
        generationType: args.type,
        segmentId: args.segmentId,
      });
      return { jobId };
    },
  );

  ipcMain.handle('job:list', async (_e, args: { status?: string }) => {
    return db.listJobs(args);
  });

  ipcMain.handle('job:cancel', async (_e, args: { jobId: string }) => {
    log.info('Job cancel requested', {
      category: 'job',
      jobId: args.jobId,
    });
    queue.cancel(args.jobId);
  });

  ipcMain.handle('job:pause', async (_e, args: { jobId: string }) => {
    log.info('Job pause requested', {
      category: 'job',
      jobId: args.jobId,
    });
    queue.pause(args.jobId);
  });

  ipcMain.handle('job:resume', async (_e, args: { jobId: string }) => {
    log.info('Job resume requested', {
      category: 'job',
      jobId: args.jobId,
    });
    queue.resume(args.jobId);
  });

  const notifiedJobs = new Set<string>();

  // Event-driven IPC notifications — replaces 2s poll loop
  queue.on('job:submitted', (data: { id: string; status: string }) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('job:submitted', data);
  });

  queue.on('job:progress', (data: { jobId: string; progress: number; completedSteps?: number; totalSteps?: number; currentStep?: string; message?: string }) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('job:progress', data);
  });

  queue.on('job:completed', (data: { id: string; status: string }) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (notifiedJobs.has(data.id)) return;
    notifiedJobs.add(data.id);
    const job = db.listJobs({ status: 'completed' }).find((j) => j.id === data.id);
    win.webContents.send('job:complete', {
      jobId: data.id,
      success: true,
      result: job?.result,
    });
  });

  queue.on('job:failed', (data: { id: string; status: string; error?: string }) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (notifiedJobs.has(data.id)) return;
    notifiedJobs.add(data.id);
    win.webContents.send('job:complete', {
      jobId: data.id,
      success: false,
      error: data.error,
    });
    win.webContents.send('job:failed', data);
  });

  queue.on('job:cancelled', (data: { id: string; status: string }) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('job:cancelled', data);
  });

  queue.on('job:paused', (data: { id: string; status: string }) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('job:paused', data);
  });

  queue.on('job:resumed', (data: { id: string; status: string }) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('job:resumed', data);
  });
}
