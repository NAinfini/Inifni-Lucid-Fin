import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RendererWindowLike } from './electron-host.js';

const startElectronHost = vi.hoisted(() => vi.fn());
const createProductionCompositionOptions = vi.hoisted(() => vi.fn());
const systemRecoveryKeyStore = vi.hoisted(() => vi.fn());
const electron = vi.hoisted(() => ({
  app: { exit: vi.fn(), getPath: vi.fn(), whenReady: vi.fn() },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn() },
  protocol: { handle: vi.fn(), unhandle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  session: { fromPartition: vi.fn() },
}));

vi.mock('electron', () => electron);
vi.mock('./electron-host.js', () => ({ startElectronHost }));
vi.mock('./production-adapters.js', () => ({
  LOCAL_OLLAMA_PROVIDER_ID: 'ollama-local',
  systemRecoveryKeyStore,
}));
vi.mock('./production-composition.js', () => ({ createProductionCompositionOptions }));

import {
  LUCID_FIN_SESSION_PARTITION,
  applyWindowControl,
  createProductionBootstrap,
  isElectronMain,
  isTrustedRendererInvocation,
  rendererPath,
  secureRendererWindow,
  startElectronEntry,
  windowOptions,
} from './electron.js';

function compositionOptions() {
  return {
    layout: { databasePath: 'C:/test-user-data/lucid-fin-v1/project.sqlite' },
    dataAccess: {},
    provisionHost: vi.fn(),
    createAcceptanceSeedFor: vi.fn(),
    pickMedia: vi.fn(),
    contextForRequest: vi.fn(),
    createRuntime: vi.fn(),
    createPushRequestId: vi.fn(),
    reportStartup: vi.fn(),
    onInternalError: vi.fn(),
  };
}

describe('Electron entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electron.app.getPath.mockReturnValue('C:/test-user-data');
    electron.app.whenReady.mockResolvedValue(undefined);
    systemRecoveryKeyStore.mockResolvedValue({});
    createProductionCompositionOptions.mockResolvedValue(compositionOptions());
  });

  it('builds the canonical host composition and keeps native selection paths in main', async () => {
    const bootstrap = await createProductionBootstrap();

    expect(createProductionCompositionOptions).toHaveBeenCalledWith({
      userDataPath: 'C:/test-user-data',
      recoveryKeyStore: {},
      model: {
        provider: {
          providerId: 'ollama-local',
          model: 'qwen3:8b',
          reasoningStrength: null,
        },
      },
      mediaPicker: expect.any(Object),
    });
    const factoryInput = createProductionCompositionOptions.mock.calls[0]?.[0] as {
      mediaPicker: {
        pick(input: {
          kinds: readonly string[];
          multiple: boolean;
        }): Promise<readonly string[] | null>;
      };
    };
    electron.dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['C:/private-media/scene.mp4'],
    });
    await expect(
      factoryInput.mediaPicker.pick({ kinds: ['video'], multiple: false }),
    ).resolves.toEqual(['C:/private-media/scene.mp4']);
    expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith({
      title: 'Select media',
      properties: ['openFile'],
      filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'webm', 'mkv'] }],
    });

    electron.dialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: 'C:/private-exports/scene.mp4',
    });
    const picker = bootstrap.composition.exportDestinationPicker!;
    await expect(
      picker.pick({
        chatId: 'chat.local',
        projectId: 'project.local',
        deliveryPlan: {
          authority: 'delivery',
          id: 'delivery.local',
          revision: 0,
          contentHash: 'a'.repeat(64),
        },
        destination: 'file',
        suggestedFileName: 'scene.mp4',
        allowedExtensions: ['mp4'],
      }),
    ).resolves.toEqual({
      state: 'selected',
      destination: 'file',
      displayLabel: 'scene.mp4',
      writableGrant: { kind: 'file', path: 'C:/private-exports/scene.mp4' },
    });
  });

  it('starts the canonical host after its platform is ready', async () => {
    const window = {
      webContents: { isDestroyed: () => false, send: vi.fn() },
      isDestroyed: () => false,
      destroy: vi.fn(),
    } satisfies RendererWindowLike;
    const host = { close: vi.fn(), composition: {}, window };
    const composition = {};
    const platform = {
      whenReady: vi.fn(async () => undefined),
      ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
      mediaPreviewProtocol: { handle: vi.fn(), unhandle: vi.fn() },
      isTrustedInvocation: vi.fn(() => true),
      createWindow: vi.fn(() => window),
      loadWindow: vi.fn(async () => undefined),
    };
    startElectronHost.mockResolvedValue(host);

    await expect(startElectronEntry({ composition } as never, platform as never)).resolves.toBe(
      host,
    );
    expect(platform.whenReady).toHaveBeenCalledOnce();
    expect(startElectronHost).toHaveBeenCalledWith({
      composition,
      ipcMain: platform.ipcMain,
      mediaPreviewProtocol: platform.mediaPreviewProtocol,
      isTrustedInvocation: platform.isTrustedInvocation,
      createWindow: platform.createWindow,
      loadWindow: platform.loadWindow,
    });
  });

  it('only autostarts when Electron executes this exact entry module', () => {
    expect(isElectronMain('file:///C:/repo/electron.js', ['electron', 'C:/repo/electron.js'])).toBe(
      true,
    );
    expect(isElectronMain('file:///C:/repo/electron.js', ['vitest', 'C:/repo/test.js'])).toBe(
      false,
    );
  });

  it('resolves the renderer beside the desktop main workspace', () => {
    const moduleUrl = pathToFileURL(path.resolve('apps/desktop-main/dist/electron.js')).href;
    expect(rendererPath(moduleUrl, false, 'C:/unused-resources')).toBe(
      path.resolve('apps/desktop-renderer/dist/index.html'),
    );
  });

  it('resolves the packaged renderer from Electron resources', () => {
    const resourcesPath = path.resolve('release/resources');
    expect(rendererPath(import.meta.url, true, resourcesPath)).toBe(
      path.join(resourcesPath, 'renderer', 'index.html'),
    );
  });

  it('uses an isolated sandboxed session and blocks renderer escape routes', () => {
    expect(windowOptions('C:/preload.cjs')).toMatchObject({
      backgroundColor: '#0d0f14',
      frame: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: 'C:/preload.cjs',
        partition: LUCID_FIN_SESSION_PARTITION,
      },
    });
    expect(windowOptions('C:/preload.cjs')).not.toHaveProperty('titleBarOverlay');

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
      mainFrame: { url: 'file:///C:/renderer/index.html' },
      isDestroyed: () => false,
      on,
      setWindowOpenHandler,
    };
    secureRendererWindow(
      { webContents, isDestroyed: () => false },
      'file:///C:/renderer/index.html',
    );

    expect(setWindowOpenHandler.mock.calls[0]?.[0]()).toEqual({ action: 'deny' });
    const blockedNavigation = { preventDefault: vi.fn() };
    navigationListener?.(blockedNavigation, 'https://untrusted.example/');
    expect(blockedNavigation.preventDefault).toHaveBeenCalledOnce();
    const allowedNavigation = { preventDefault: vi.fn() };
    navigationListener?.(allowedNavigation, 'file:///C:/renderer/index.html#/project/blue-hour');
    expect(allowedNavigation.preventDefault).not.toHaveBeenCalled();
    const queryNavigation = { preventDefault: vi.fn() };
    navigationListener?.(queryNavigation, 'file:///C:/renderer/index.html?unsafe=1');
    expect(queryNavigation.preventDefault).toHaveBeenCalledOnce();
    const webview = { preventDefault: vi.fn() };
    webviewListener?.(webview);
    expect(webview.preventDefault).toHaveBeenCalledOnce();
  });

  it('maps the custom titlebar actions to the active window', () => {
    const window = {
      webContents: {
        mainFrame: { url: 'file:///renderer/index.html' },
        isDestroyed: () => false,
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
      isDestroyed: () => false,
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      isMaximized: vi.fn(() => false),
      close: vi.fn(),
    };

    applyWindowControl(window, 'minimize');
    applyWindowControl(window, 'toggleMaximize');
    applyWindowControl(window, 'close');
    expect(window.minimize).toHaveBeenCalledOnce();
    expect(window.maximize).toHaveBeenCalledOnce();
    expect(window.close).toHaveBeenCalledOnce();

    window.isMaximized.mockReturnValue(true);
    applyWindowControl(window, 'toggleMaximize');
    expect(window.unmaximize).toHaveBeenCalledOnce();
  });

  it('trusts only the exact window, main frame, and local renderer URL', () => {
    const mainFrame = { url: 'file:///C:/renderer/index.html#/project/blue-hour' };
    const webContents = {
      mainFrame,
      isDestroyed: () => false,
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    const window = { webContents, isDestroyed: () => false };
    const invocation = { sender: webContents, senderFrame: mainFrame };

    expect(isTrustedRendererInvocation(invocation, window, 'file:///C:/renderer/index.html')).toBe(
      true,
    );
    expect(
      isTrustedRendererInvocation(
        { ...invocation, senderFrame: { url: mainFrame.url } },
        window,
        mainFrame.url,
      ),
    ).toBe(false);
    expect(isTrustedRendererInvocation(invocation, window, 'file:///C:/other/index.html')).toBe(
      false,
    );
    expect(
      isTrustedRendererInvocation(
        { ...invocation, sender: { ...webContents } },
        window,
        mainFrame.url,
      ),
    ).toBe(false);
  });
});
