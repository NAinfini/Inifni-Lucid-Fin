import { describe, expect, it, vi } from 'vitest';
import type { TargetRendererWindowLike } from './electron-host.js';

const startTargetElectronHost = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: { exit: vi.fn(), whenReady: vi.fn() },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  protocol: { handle: vi.fn(), unhandle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  session: { fromPartition: vi.fn() },
}));

vi.mock('./electron-host.js', () => ({ startTargetElectronHost }));

import {
  TARGET_RC_PRODUCTION_ADAPTERS_UNAVAILABLE,
  TARGET_RC_PRODUCTION_ADAPTERS_UNAVAILABLE_MESSAGE,
  TARGET_RC_SESSION_PARTITION,
  TargetRcProductionAdaptersUnavailableError,
  isTargetRcElectronMain,
  isTrustedTargetRcInvocation,
  secureTargetRcWindow,
  startTargetRcElectronEntry,
  targetRcWindowOptions,
} from './electron-entry.js';

describe('target RC Electron entry', () => {
  it('fails explicitly until real production adapters are composed', async () => {
    await expect(startTargetRcElectronEntry()).rejects.toMatchObject({
      name: 'TargetRcProductionAdaptersUnavailableError',
      code: TARGET_RC_PRODUCTION_ADAPTERS_UNAVAILABLE,
      message: TARGET_RC_PRODUCTION_ADAPTERS_UNAVAILABLE_MESSAGE,
    });
    expect(startTargetElectronHost).not.toHaveBeenCalled();
  });

  it('starts the target host after an injected platform is ready', async () => {
    const order: string[] = [];
    const window = {
      webContents: { isDestroyed: () => false, send: vi.fn() },
      isDestroyed: () => false,
      destroy: vi.fn(),
    } satisfies TargetRendererWindowLike;
    const host = { close: vi.fn(), composition: {}, window };
    const composition = {};
    const platform = {
      whenReady: vi.fn(async () => {
        order.push('ready');
      }),
      ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
      mediaPreviewProtocol: { handle: vi.fn(), unhandle: vi.fn() },
      isTrustedInvocation: vi.fn(() => true),
      createWindow: vi.fn(() => {
        order.push('create');
        return window;
      }),
      loadWindow: vi.fn(async () => {
        order.push('load');
      }),
    };
    startTargetElectronHost.mockImplementation(async (options) => {
      options.createWindow('target-preload.cjs');
      await options.loadWindow(window);
      return host;
    });

    await expect(
      startTargetRcElectronEntry({ composition } as never, platform as never),
    ).resolves.toBe(host);
    expect(order).toEqual(['ready', 'create', 'load']);
    expect(startTargetElectronHost).toHaveBeenCalledWith({
      composition,
      ipcMain: platform.ipcMain,
      mediaPreviewProtocol: platform.mediaPreviewProtocol,
      isTrustedInvocation: platform.isTrustedInvocation,
      createWindow: platform.createWindow,
      loadWindow: platform.loadWindow,
    });
  });

  it('only autostarts when Electron executes this exact entry module', () => {
    expect(
      isTargetRcElectronMain('file:///C:/repo/electron-entry.js', [
        'electron',
        'C:/repo/electron-entry.js',
      ]),
    ).toBe(true);
    expect(
      isTargetRcElectronMain('file:///C:/repo/electron-entry.js', ['vitest', 'C:/repo/test.js']),
    ).toBe(false);
    expect(new TargetRcProductionAdaptersUnavailableError()).toBeInstanceOf(Error);
  });

  it('uses an isolated sandboxed session and blocks renderer escape routes', () => {
    expect(targetRcWindowOptions('C:/target/preload.cjs')).toMatchObject({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: 'C:/target/preload.cjs',
        partition: TARGET_RC_SESSION_PARTITION,
      },
    });

    type PreventableEvent = { preventDefault(): void };
    type NavigationListener = (event: PreventableEvent, url: string) => void;
    type WebviewListener = (event: PreventableEvent) => void;
    let navigationListener: NavigationListener | undefined;
    let webviewListener: WebviewListener | undefined;
    function on(event: 'will-navigate', listener: NavigationListener): void;
    function on(event: 'will-attach-webview', listener: WebviewListener): void;
    function on(
      event: 'will-navigate' | 'will-attach-webview',
      listener: NavigationListener | WebviewListener,
    ): void {
      if (event === 'will-navigate') navigationListener = listener as NavigationListener;
      else webviewListener = listener as WebviewListener;
    }
    const setWindowOpenHandler = vi.fn();
    const webContents = {
      mainFrame: { url: 'file:///C:/target/index.html' },
      isDestroyed: () => false,
      on,
      setWindowOpenHandler,
    };
    secureTargetRcWindow({ webContents, isDestroyed: () => false }, 'file:///C:/target/index.html');

    expect(setWindowOpenHandler.mock.calls[0]?.[0]()).toEqual({ action: 'deny' });
    const blockedNavigation = { preventDefault: vi.fn() };
    navigationListener?.(blockedNavigation, 'https://untrusted.example/');
    expect(blockedNavigation.preventDefault).toHaveBeenCalledOnce();
    const allowedNavigation = { preventDefault: vi.fn() };
    navigationListener?.(allowedNavigation, 'file:///C:/target/index.html#/project/blue-hour');
    expect(allowedNavigation.preventDefault).not.toHaveBeenCalled();
    const queryNavigation = { preventDefault: vi.fn() };
    navigationListener?.(queryNavigation, 'file:///C:/target/index.html?unsafe=1');
    expect(queryNavigation.preventDefault).toHaveBeenCalledOnce();
    const webview = { preventDefault: vi.fn() };
    webviewListener?.(webview);
    expect(webview.preventDefault).toHaveBeenCalledOnce();
  });

  it('trusts only the exact window, main frame, and local renderer URL', () => {
    const mainFrame = { url: 'file:///C:/target/index.html#/project/blue-hour' };
    const webContents = {
      mainFrame,
      isDestroyed: () => false,
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    const window = { webContents, isDestroyed: () => false };
    const invocation = { sender: webContents, senderFrame: mainFrame };

    expect(isTrustedTargetRcInvocation(invocation, window, 'file:///C:/target/index.html')).toBe(
      true,
    );
    expect(
      isTrustedTargetRcInvocation(
        { ...invocation, senderFrame: { url: mainFrame.url } },
        window,
        mainFrame.url,
      ),
    ).toBe(false);
    expect(isTrustedTargetRcInvocation(invocation, window, 'file:///C:/other/index.html')).toBe(
      false,
    );
    expect(
      isTrustedTargetRcInvocation(
        { ...invocation, sender: { ...webContents } },
        window,
        mainFrame.url,
      ),
    ).toBe(false);
  });
});
