/**
 * Minimal `electron` surface used by desktop-main modules we re-import from
 * the harness. Everything is a no-op stub — no windows open, no IPC flows,
 * no packaging/auto-update hooks fire.
 *
 * What we need to provide:
 *   - `app.getPath(name)`  — logger.ts uses 'userData' for log dir
 *   - `app.on()`           — misc bootstrap code
 *   - `ipcMain.handle/on`  — handlers register into this without firing
 *   - `BrowserWindow`      — type + a harmless class (never instantiated)
 *   - `net.fetch`          — protocol handler; we don't register any
 *   - `session.defaultSession` — canvas-generation.handlers may touch it
 *   - `protocol.handle`    — electron-assets protocol; no-op
 */
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const USER_DATA_DIR = path.join(os.tmpdir(), 'lucid-fin-harness-electron-stub');

class StubApp extends EventEmitter {
  getPath(name) {
    if (name === 'userData' || name === 'appData') return USER_DATA_DIR;
    if (name === 'logs') return path.join(USER_DATA_DIR, 'logs');
    if (name === 'temp') return os.tmpdir();
    if (name === 'home') return os.homedir();
    return USER_DATA_DIR;
  }
  getName() {
    return 'lucid-fin-harness';
  }
  getVersion() {
    return '0.0.0-harness';
  }
  isReady() {
    return true;
  }
  whenReady() {
    return Promise.resolve();
  }
  quit() {
    /* no-op */
  }
  isPackaged = false;
}

class StubIpcMain extends EventEmitter {
  handle(_channel, _listener) {
    /* no-op — nothing calls into these during harness runs */
  }
  handleOnce(_channel, _listener) {
    /* no-op */
  }
  removeHandler(_channel) {
    /* no-op */
  }
  on(channel, listener) {
    super.on(channel, listener);
    return this;
  }
}

class StubBrowserWindow extends EventEmitter {
  webContents = { send: () => {}, id: -1 };
  isDestroyed() {
    return true;
  }
  close() {}
  static getAllWindows() {
    return [];
  }
  static getFocusedWindow() {
    return null;
  }
}

const stubSession = {
  defaultSession: {
    webRequest: { onBeforeRequest: () => {} },
    protocol: { handle: () => {}, registerFileProtocol: () => {} },
  },
};

const stubProtocol = {
  handle: () => {},
  registerFileProtocol: () => {},
  registerSchemesAsPrivileged: () => {},
};

const stubNet = {
  fetch: (...args) => fetch(...args),
};

export const app = new StubApp();
export const ipcMain = new StubIpcMain();
export const BrowserWindow = StubBrowserWindow;
export const session = stubSession;
export const protocol = stubProtocol;
export const net = stubNet;
export const shell = { openExternal: async () => {}, openPath: async () => '' };
export const dialog = { showMessageBox: async () => ({ response: 0 }) };
export const screen = {
  getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
};
export const nativeTheme = { shouldUseDarkColors: false };
export const powerMonitor = new EventEmitter();
export const systemPreferences = {};

export default {
  app,
  ipcMain,
  BrowserWindow,
  session,
  protocol,
  net,
  shell,
  dialog,
  screen,
  nativeTheme,
  powerMonitor,
  systemPreferences,
};
