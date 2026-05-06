/**
 * IPC handlers for provider runtime health monitoring (R43).
 *
 * Exposes the in-memory ProviderHealthTracker to the renderer via
 * typed invoke channels.
 */
import type { IpcMain, BrowserWindow } from 'electron';
import { providerHealth } from '@lucid-fin/adapters-ai';
import { registerInvoke, type RegistrarDeps } from '../../features/ipc/registrar.js';
import {
  providerHealthChannel,
  providerHealthGetChannel,
} from '@lucid-fin/contracts-parse';

export function registerProviderHealthHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
): void {
  const deps: RegistrarDeps = { ipcMain, getWindow };

  registerInvoke(deps, providerHealthChannel, async () => {
    return providerHealth.getAllStatuses();
  });

  registerInvoke(deps, providerHealthGetChannel, async (_ctx, req) => {
    return providerHealth.getStatus(req.providerId);
  });
}
