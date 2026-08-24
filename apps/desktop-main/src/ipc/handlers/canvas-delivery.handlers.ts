import type { BrowserWindow, IpcMain } from 'electron';
import type { CanvasId, OrderedDeliverySequence } from '@lucid-fin/contracts';
import type { CanvasRepository } from '@lucid-fin/storage';
import { canvasDeliveryUpdateChannel, parseCanvasId } from '@lucid-fin/contracts-parse';
import { registerInvoke } from '../../features/ipc/registrar.js';

export interface CanvasDeliveryCache {
  replace(canvasId: CanvasId, deliverySequence: OrderedDeliverySequence): void;
}

export function registerCanvasDeliveryHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  repository: CanvasRepository,
  cache: CanvasDeliveryCache,
): void {
  registerInvoke(
    { ipcMain, getWindow },
    canvasDeliveryUpdateChannel,
    (_context, request) => {
      const canvasId = parseCanvasId(request.canvasId);
      const deliverySequence = repository.updateDeliverySequence(
        canvasId,
        request.expectedRevision,
        request.deliverySequence,
      );
      cache.replace(canvasId, deliverySequence);
      return { deliverySequence };
    },
  );
}
