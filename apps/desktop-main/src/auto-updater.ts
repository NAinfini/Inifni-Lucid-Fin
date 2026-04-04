/**
 * Auto-updater integration using electron-updater.
 * Handles checking, downloading, and installing updates with changelog display.
 */
import { BrowserWindow } from 'electron';
import { log } from './logger.js';

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
let mainWindow: BrowserWindow | null = null;

function notifyRenderer(): void {
  mainWindow?.webContents.send('updater:status', currentStatus);
}

export async function initAutoUpdater(win: BrowserWindow): Promise<void> {
  mainWindow = win;

  try {
    // Dynamic import — electron-updater may not be available in dev
    // @ts-expect-error electron-updater is an optional runtime dependency
    const mod = await import('electron-updater');
    autoUpdater = mod.autoUpdater as unknown as AppUpdater;
  } catch {
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
    // Send toast notification to renderer
    mainWindow?.webContents.send('updater:toast', {
      version: updateInfo.version,
    });
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
  if (!autoUpdater) return;
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
