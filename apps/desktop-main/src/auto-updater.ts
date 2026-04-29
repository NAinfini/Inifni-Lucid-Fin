/**
 * Auto-updater integration using electron-updater.
 * Handles checking, downloading, and installing updates with changelog display.
 *
 * Phase F migration note: the typed `updater:toast` push now goes through
 * `RendererPushGateway`, so payload shape drift (e.g. accidentally
 * dropping `version`) becomes a loud main-process throw instead of a
 * silent renderer-side parse failure.
 *
 * Status pushes go through `updater:progress` (a dedicated push channel),
 * separate from the invoke-only `updater:status` polling endpoint.
 */
import { BrowserWindow } from 'electron';
import { updaterToastChannel, updaterProgressChannel } from '@lucid-fin/contracts-parse';
import { log } from './logger.js';
import {
  createRendererPushGateway,
  type RendererPushGateway,
} from './features/ipc/push-gateway.js';

// electron-updater is a runtime dependency — type-only import for build
type AppUpdater = {
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
};

let autoUpdater: AppUpdater | null = null;

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
  progress?: number;
  info?: UpdateInfo;
  error?: string;
}

let currentStatus: UpdateStatus = { state: 'idle' };
let pushGateway: RendererPushGateway | null = null;

function notifyRenderer(): void {
  pushGateway?.emit(updaterProgressChannel, currentStatus);
}

export async function initAutoUpdater(
  win: BrowserWindow,
  gateway?: RendererPushGateway,
): Promise<void> {
  pushGateway = gateway ?? createRendererPushGateway({ getWindow: () => win });

  try {
    // Dynamic import — electron-updater may not be available in dev
    const mod = await import('electron-updater');
    autoUpdater = (mod.autoUpdater ?? mod.default?.autoUpdater) as unknown as AppUpdater;
    if (!autoUpdater) {
      log('info', 'electron-updater loaded but autoUpdater is undefined, skipping');
      return;
    }
  } catch {
    /* electron-updater not available in dev or unsupported environment — skip */
    log('info', 'electron-updater not available, skipping auto-update init');
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    currentStatus = { state: 'checking' };
    log('info', 'Checking for updates');
    notifyRenderer();
  });

  autoUpdater.on('update-available', (info: unknown) => {
    const updateInfo = info as UpdateInfo;
    currentStatus = { state: 'available', info: updateInfo };
    log('info', 'Update available', { version: updateInfo.version });
    notifyRenderer();
    // Send toast notification to renderer via the typed push gateway.
    pushGateway?.emit(updaterToastChannel, { version: updateInfo.version });
  });

  autoUpdater.on('update-not-available', () => {
    currentStatus = { state: 'idle' };
    log('info', 'No updates available');
    notifyRenderer();
  });

  autoUpdater.on('download-progress', (progress: unknown) => {
    const p = progress as { percent: number };
    currentStatus = { ...currentStatus, state: 'downloading', progress: p.percent };
    notifyRenderer();
  });

  autoUpdater.on('update-downloaded', (info: unknown) => {
    const updateInfo = info as UpdateInfo;
    currentStatus = { state: 'downloaded', info: updateInfo };
    log('info', 'Update downloaded', { version: updateInfo.version });
    notifyRenderer();
  });

  autoUpdater.on('error', (err: unknown) => {
    const error = err instanceof Error ? err : new Error(String(err));
    currentStatus = { state: 'error', error: error.message };
    log('error', 'Auto-update error', { message: error.message });
    notifyRenderer();
  });
}

export async function checkForUpdates(): Promise<void> {
  if (!autoUpdater) {
    // No updater available (dev mode) — notify renderer so it doesn't stay stuck
    currentStatus = { state: 'idle' };
    notifyRenderer();
    return;
  }
  await autoUpdater.checkForUpdates();
}

export async function downloadUpdate(): Promise<void> {
  if (!autoUpdater) return;
  await autoUpdater.downloadUpdate();
}

export function installUpdate(): void {
  if (!autoUpdater) return;
  autoUpdater.quitAndInstall();
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus;
}
