import type { IpcMain, BrowserWindow } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import type { GenerationRequest } from '@lucid-fin/contracts';
import type { JobQueue } from '@lucid-fin/application';
import {
  jobSubmittedChannel,
  jobProgressChannel,
  jobCompleteChannel,
  jobFailedChannel,
  jobCancelledChannel,
  jobPausedChannel,
  jobResumedChannel,
} from '@lucid-fin/contracts-parse';
import {
  createRendererPushGateway,
  type RendererPushGateway,
} from '../../features/ipc/push-gateway.js';
import log from '../../logger.js';

export function registerJobHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  db: SqliteIndex,
  queue: JobQueue,
  pushGateway?: RendererPushGateway,
): void {
  // All 7 job lifecycle channels are typed push channels; route them through
  // the gateway so payload drift surfaces loudly in main instead of silently
  // in the renderer. Fall back to a locally-constructed gateway when callers
  // predate Phase F-split-5.
  const gateway = pushGateway ?? createRendererPushGateway({ getWindow });

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
    gateway.emit(jobSubmittedChannel, data);
  });

  queue.on('job:progress', (data: { jobId: string; progress: number; completedSteps?: number; totalSteps?: number; currentStep?: string; message?: string }) => {
    gateway.emit(jobProgressChannel, data);
  });

  queue.on('job:completed', (data: { id: string; status: string }) => {
    if (notifiedJobs.has(data.id)) return;
    notifiedJobs.add(data.id);
    const job = db.listJobs({ status: 'completed' }).find((j) => j.id === data.id);
    gateway.emit(jobCompleteChannel, {
      jobId: data.id,
      success: true,
      result: job?.result,
    });
  });

  queue.on('job:failed', (data: { id: string; status: string; error?: string }) => {
    if (notifiedJobs.has(data.id)) return;
    notifiedJobs.add(data.id);
    gateway.emit(jobCompleteChannel, {
      jobId: data.id,
      success: false,
      error: data.error,
    });
    gateway.emit(jobFailedChannel, data);
  });

  queue.on('job:cancelled', (data: { id: string; status: string }) => {
    gateway.emit(jobCancelledChannel, data);
  });

  queue.on('job:paused', (data: { id: string; status: string }) => {
    gateway.emit(jobPausedChannel, data);
  });

  queue.on('job:resumed', (data: { id: string; status: string }) => {
    gateway.emit(jobResumedChannel, data);
  });
}
