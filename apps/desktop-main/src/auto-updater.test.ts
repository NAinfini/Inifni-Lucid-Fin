import { beforeEach, describe, expect, it, vi } from 'vitest';

const updaterListeners = vi.hoisted(() => new Map<string, (...args: unknown[]) => void>());
const autoUpdaterMock = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    updaterListeners.set(event, cb);
  }),
  autoDownload: true,
  autoInstallOnAppQuit: false,
}));
const logger = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock('electron-updater', () => ({
  autoUpdater: autoUpdaterMock,
}));

vi.mock('./logger.js', () => ({
  log: logger.log,
}));

import { initAutoUpdater } from './auto-updater.js';

describe('auto-updater status pushes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updaterListeners.clear();
    autoUpdaterMock.autoDownload = true;
    autoUpdaterMock.autoInstallOnAppQuit = false;
  });

  it('sends updater:status via webContents.send on checking-for-update', async () => {
    const send = vi.fn();
    const emit = vi.fn();

    await initAutoUpdater(
      {
        webContents: { send },
      } as never,
      { emit } as never,
    );

    updaterListeners.get('checking-for-update')?.();

    // notifyRenderer() pushes via raw webContents.send, not the typed gateway
    expect(send).toHaveBeenCalledWith('updater:status', { state: 'checking' });
    // The typed gateway is NOT used for status — only for the toast
    expect(emit).not.toHaveBeenCalled();
  });

  it('sends updater:status and emits toast via typed gateway on update-available', async () => {
    const send = vi.fn();
    const emit = vi.fn();

    await initAutoUpdater(
      {
        webContents: { send },
      } as never,
      { emit } as never,
    );

    updaterListeners.get('update-available')?.({
      version: '2.0.0',
      releaseDate: '2026-04-26T00:00:00.000Z',
      releaseNotes: [
        { version: '2.0.0', note: 'Added typed updater push.' },
        { version: '1.9.0', note: 'Previous maintenance release.' },
      ],
    });

    // notifyRenderer() sends the full status via webContents.send
    expect(send).toHaveBeenCalledWith('updater:status', {
      state: 'available',
      info: {
        version: '2.0.0',
        releaseDate: '2026-04-26T00:00:00.000Z',
        releaseNotes: [
          { version: '2.0.0', note: 'Added typed updater push.' },
          { version: '1.9.0', note: 'Previous maintenance release.' },
        ],
      },
    });

    // pushGateway.emit sends the toast with just the version
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'updater:toast' }),
      { version: '2.0.0' },
    );
  });
});
