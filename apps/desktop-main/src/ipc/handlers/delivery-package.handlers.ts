import type { BrowserWindow, IpcMain, OpenDialogOptions } from 'electron';
import { dialog, shell } from 'electron';
import type {
  DeliveryPackageCancelRequest,
  DeliveryPackageOpenRequest,
  DeliveryPackageRetryRequest,
  DeliveryPackageStartRequest,
  DeliveryPackageStatusRequest,
} from '@lucid-fin/contracts-parse';
import type { DeliveryPackageService } from '../../services/delivery-package.service.js';

interface DeliveryPackageElectronApi {
  dialog: Pick<typeof dialog, 'showOpenDialog'>;
  shell: Pick<typeof shell, 'openPath'>;
}

const START_KEYS = new Set([
  'taskListId',
  'canvasId',
  'expectedManifestRevision',
  'expectedManifestHash',
]);

export function registerDeliveryPackageHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  service: DeliveryPackageService,
  electronApi: DeliveryPackageElectronApi = { dialog, shell },
): void {
  ipcMain.handle(
    'deliveryPackage:start',
    async (_event, request: DeliveryPackageStartRequest | undefined) => {
      assertStartRequest(request);
      const window = getWindow();
      const options: OpenDialogOptions = {
        title: 'Choose Delivery package destination',
        properties: ['openDirectory', 'createDirectory'],
      };
      const result = window
        ? await electronApi.dialog.showOpenDialog(window, options)
        : await electronApi.dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) return { cancelled: true as const };
      const attempt = await service.startApproved({
        taskListId: request.taskListId,
        canvasId: request.canvasId,
        expectedManifestRevision: request.expectedManifestRevision,
        expectedManifestHash: request.expectedManifestHash,
        destinationDirectory: result.filePaths[0],
      });
      return { cancelled: false as const, attempt };
    },
  );

  ipcMain.handle(
    'deliveryPackage:status',
    async (_event, request: DeliveryPackageStatusRequest | undefined) => {
      return service.getStatus(requireAttemptId('deliveryPackage:status', request));
    },
  );

  ipcMain.handle(
    'deliveryPackage:cancel',
    async (_event, request: DeliveryPackageCancelRequest | undefined) => ({
      attempt: service.cancel(requireAttemptId('deliveryPackage:cancel', request)),
    }),
  );

  ipcMain.handle(
    'deliveryPackage:retry',
    async (_event, request: DeliveryPackageRetryRequest | undefined) => ({
      attempt: await service.retry(requireAttemptId('deliveryPackage:retry', request)),
    }),
  );

  ipcMain.handle(
    'deliveryPackage:open',
    async (_event, request: DeliveryPackageOpenRequest | undefined) => {
      const packagePath = service.requireCompletedPackagePath(
        requireAttemptId('deliveryPackage:open', request),
      );
      const error = await electronApi.shell.openPath(packagePath);
      if (error) throw new Error(`Unable to open Delivery package: ${error}`);
      return { opened: true as const };
    },
  );
}

function assertStartRequest(
  request: DeliveryPackageStartRequest | undefined,
): asserts request is DeliveryPackageStartRequest {
  if (!request || typeof request !== 'object') {
    throw new Error('deliveryPackage:start: request is required');
  }
  const unsupported = Object.keys(request).find((key) => !START_KEYS.has(key));
  if (unsupported) throw new Error(`deliveryPackage:start: unsupported field "${unsupported}"`);
  if (!request.taskListId?.trim() || !request.canvasId?.trim()) {
    throw new Error('deliveryPackage:start: taskListId and canvasId are required');
  }
  if (
    !Number.isInteger(request.expectedManifestRevision) ||
    request.expectedManifestRevision <= 0 ||
    !/^[a-f0-9]{64}$/.test(request.expectedManifestHash)
  ) {
    throw new Error('deliveryPackage:start: exact approved manifest revision/hash is required');
  }
}

function requireAttemptId(
  channel: string,
  request: { attemptId: string } | undefined,
): string {
  if (!request?.attemptId?.trim()) throw new Error(`${channel}: attemptId is required`);
  if (Object.keys(request).some((key) => key !== 'attemptId')) {
    throw new Error(`${channel}: unsupported request field`);
  }
  return request.attemptId;
}
