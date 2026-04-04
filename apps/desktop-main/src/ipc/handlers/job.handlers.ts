import type { IpcMain, BrowserWindow } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import type { GenerationRequest } from '@lucid-fin/contracts';
import type { JobQueue } from '@lucid-fin/application';

export function registerJobHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  db: SqliteIndex,
  queue: JobQueue,
): void {
  ipcMain.handle(
    'job:submit',
    async (_e, args: GenerationRequest & { projectId: string; segmentId?: string }) => {
      const jobId = queue.submit(args);
      return { jobId };
    },
  );

  ipcMain.handle('job:list', async (_e, args: { projectId?: string; status?: string }) => {
    return db.listJobs(args);
  });

  ipcMain.handle('job:cancel', async (_e, args: { jobId: string }) => {
    queue.cancel(args.jobId);
  });

  ipcMain.handle('job:pause', async (_e, args: { jobId: string }) => {
    queue.pause(args.jobId);
  });

  ipcMain.handle('job:resume', async (_e, args: { jobId: string }) => {
    queue.resume(args.jobId);
  });

  const notifiedJobs = new Set<string>();

  const pollTimer = setInterval(() => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;

    const running = db.listJobs({ status: 'running' });
    for (const job of running) {
      win.webContents.send('job:progress', {
        jobId: job.id,
        progress: job.progress ?? 0,
        completedSteps: job.completedSteps,
        totalSteps: job.totalSteps,
        currentStep: job.currentStep,
        message: job.currentStep ?? `Running on ${job.provider}`,
      });
    }

    for (const status of ['completed', 'failed'] as const) {
      const jobs = db.listJobs({ status });
      for (const job of jobs) {
        if (notifiedJobs.has(job.id)) continue;
        if (job.completedAt && Date.now() - job.completedAt < 10000) {
          notifiedJobs.add(job.id);
          win.webContents.send('job:complete', {
            jobId: job.id,
            success: status === 'completed',
            result: status === 'completed' ? job.result : undefined,
            error: status === 'failed' ? job.error : undefined,
          });
        }
      }
    }
  }, 2000);

  // Cleanup when app quits
  process.on('exit', () => clearInterval(pollTimer));
}
