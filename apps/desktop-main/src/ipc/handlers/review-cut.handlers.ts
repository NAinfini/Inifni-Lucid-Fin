import type { BrowserWindow, IpcMain, SaveDialogOptions } from 'electron';
import { dialog, shell } from 'electron';
import type {
  ReviewCutCancelRequest,
  ReviewCutOpenRequest,
  ReviewCutStartRequest,
  ReviewCutStatusRequest,
} from '@lucid-fin/contracts-parse';
import type { ReviewCutService } from '../../services/review-cut.service.js';

interface ReviewCutElectronApi {
  dialog: Pick<typeof dialog, 'showSaveDialog'>;
  shell: Pick<typeof shell, 'openPath'>;
}

const START_KEYS = new Set([
  'taskListId',
  'canvasId',
  'expectedManifestRevision',
  'expectedManifestHash',
]);

export function registerReviewCutHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  service: ReviewCutService,
  electronApi: ReviewCutElectronApi = { dialog, shell },
): void {
  ipcMain.handle('reviewCut:start', async (_event, request: ReviewCutStartRequest | undefined) => {
    assertStartRequest(request);
    const options: SaveDialogOptions = {
      title: 'Save Review Cut',
      defaultPath: `review-cut-${request.expectedManifestHash.slice(0, 12)}.mp4`,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      properties: ['showOverwriteConfirmation'],
    };
    const window = getWindow();
    const result = window
      ? await electronApi.dialog.showSaveDialog(window, options)
      : await electronApi.dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { cancelled: true as const };
    const job = service.startApproved({ ...request, outputPath: result.filePath });
    return { cancelled: false as const, job };
  });

  ipcMain.handle('reviewCut:status', async (_event, request: ReviewCutStatusRequest | undefined) =>
    service.getStatus(requireJobId('reviewCut:status', request)),
  );

  ipcMain.handle('reviewCut:cancel', async (_event, request: ReviewCutCancelRequest | undefined) => ({
    job: service.cancel(requireJobId('reviewCut:cancel', request)),
  }));

  ipcMain.handle('reviewCut:open', async (_event, request: ReviewCutOpenRequest | undefined) => {
    const outputPath = service.requireCompletedOutputPath(requireJobId('reviewCut:open', request));
    const error = await electronApi.shell.openPath(outputPath);
    if (error) throw new Error(`Unable to open Review Cut: ${error}`);
    return { opened: true as const };
  });
}

function assertStartRequest(
  request: ReviewCutStartRequest | undefined,
): asserts request is ReviewCutStartRequest {
  if (!request || typeof request !== 'object') throw new Error('reviewCut:start: request is required');
  const unsupported = Object.keys(request).find((key) => !START_KEYS.has(key));
  if (unsupported) throw new Error(`reviewCut:start: unsupported field "${unsupported}"`);
  if (!request.taskListId?.trim() || !request.canvasId?.trim()) {
    throw new Error('reviewCut:start: taskListId and canvasId are required');
  }
  if (
    !Number.isInteger(request.expectedManifestRevision) ||
    request.expectedManifestRevision <= 0 ||
    !/^[a-f0-9]{64}$/.test(request.expectedManifestHash)
  ) {
    throw new Error('reviewCut:start: exact approved manifest revision/hash is required');
  }
}

function requireJobId(channel: string, request: { jobId: string } | undefined): string {
  if (!request?.jobId?.trim()) throw new Error(`${channel}: jobId is required`);
  if (Object.keys(request).some((key) => key !== 'jobId')) {
    throw new Error(`${channel}: unsupported request field`);
  }
  return request.jobId;
}
