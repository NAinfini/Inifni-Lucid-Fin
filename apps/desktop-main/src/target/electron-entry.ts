import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  session,
  type BrowserWindowConstructorOptions,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  startTargetElectronHost,
  type TargetElectronHost,
  type TargetElectronHostOptions,
  type TargetRendererWindowLike,
} from './electron-host.js';
import type { TargetIpcMainLike } from './ipc/router.js';
import {
  registerTargetMediaPreviewScheme,
  type TargetMediaPreviewProtocol,
  type TargetMediaPreviewProtocolRequest,
} from './media-preview.js';

export const TARGET_RC_PRODUCTION_ADAPTERS_UNAVAILABLE =
  'target_rc_production_adapters_unavailable';
export const TARGET_RC_PRODUCTION_ADAPTERS_UNAVAILABLE_MESSAGE =
  'Target RC cannot start because production adapters are not composed.';

export class TargetRcProductionAdaptersUnavailableError extends Error {
  readonly code = TARGET_RC_PRODUCTION_ADAPTERS_UNAVAILABLE;

  constructor() {
    super(TARGET_RC_PRODUCTION_ADAPTERS_UNAVAILABLE_MESSAGE);
    this.name = 'TargetRcProductionAdaptersUnavailableError';
  }
}

type TargetRcBrowserWindow = BrowserWindow & TargetRendererWindowLike;

export const TARGET_RC_SESSION_PARTITION = 'lucid-fin-target-rc' as const;

interface TargetRcNavigationEventLike {
  preventDefault(): void;
}

interface TargetRcFrameLike {
  readonly url: string;
}

interface TargetRcWebContentsSecurityLike {
  readonly mainFrame: TargetRcFrameLike;
  isDestroyed(): boolean;
  on(
    event: 'will-navigate',
    listener: (event: TargetRcNavigationEventLike, url: string) => void,
  ): unknown;
  on(event: 'will-attach-webview', listener: (event: TargetRcNavigationEventLike) => void): unknown;
  setWindowOpenHandler(handler: () => { readonly action: 'deny' }): unknown;
}

interface TargetRcTrustedWindowLike {
  readonly webContents: TargetRcWebContentsSecurityLike;
  isDestroyed(): boolean;
}

interface TargetRcIpcInvocationLike {
  readonly sender: TargetRcWebContentsSecurityLike;
  readonly senderFrame: TargetRcFrameLike | null;
}

export interface TargetRcProductionBootstrap<Event, Window extends TargetRendererWindowLike> {
  readonly composition: TargetElectronHostOptions<Event, Window>['composition'];
  readonly moduleUrl?: string;
}

export interface TargetRcElectronPlatform<Event, Window extends TargetRendererWindowLike> {
  whenReady(): Promise<void>;
  readonly ipcMain: TargetIpcMainLike<Event>;
  readonly mediaPreviewProtocol: TargetMediaPreviewProtocol;
  isTrustedInvocation(invocation: Event, window: Window): boolean;
  createWindow(preloadPath: string): Window;
  loadWindow(window: Window): Promise<void>;
}

export function targetRcRendererPath(moduleUrl: string = import.meta.url): string {
  return path.resolve(
    path.dirname(fileURLToPath(moduleUrl)),
    '../../../desktop-renderer/dist-target-rc/index.html',
  );
}

export function targetRcRendererUrl(moduleUrl: string = import.meta.url): string {
  return pathToFileURL(targetRcRendererPath(moduleUrl)).href;
}

export function targetRcWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload,
      partition: TARGET_RC_SESSION_PARTITION,
    },
  };
}

function isTargetRcRendererDocumentUrl(value: string, expectedRendererUrl: string): boolean {
  try {
    const actual = new URL(value);
    actual.hash = '';
    return actual.href === expectedRendererUrl;
  } catch {
    return false;
  }
}

export function secureTargetRcWindow(
  window: TargetRcTrustedWindowLike,
  expectedRendererUrl: string,
): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTargetRcRendererDocumentUrl(url, expectedRendererUrl)) event.preventDefault();
  });
}

export function isTrustedTargetRcInvocation(
  invocation: TargetRcIpcInvocationLike,
  window: TargetRcTrustedWindowLike,
  expectedRendererUrl: string,
): boolean {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
  const frame = invocation.senderFrame;
  return (
    invocation.sender === window.webContents &&
    frame !== null &&
    frame === window.webContents.mainFrame &&
    isTargetRcRendererDocumentUrl(frame.url, expectedRendererUrl) &&
    isTargetRcRendererDocumentUrl(window.webContents.mainFrame.url, expectedRendererUrl)
  );
}

function createTargetRcElectronPlatform(): TargetRcElectronPlatform<
  IpcMainInvokeEvent,
  TargetRcBrowserWindow
> {
  let sessionConfigured = false;
  const targetSession = () => session.fromPartition(TARGET_RC_SESSION_PARTITION);
  const rendererUrl = targetRcRendererUrl();
  return Object.freeze({
    whenReady: async () => {
      await app.whenReady();
      if (sessionConfigured) return;
      sessionConfigured = true;
      const isolatedSession = targetSession();
      isolatedSession.setPermissionCheckHandler(() => false);
      isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false),
      );
    },
    ipcMain: ipcMain as unknown as TargetIpcMainLike<IpcMainInvokeEvent>,
    mediaPreviewProtocol: Object.freeze({
      handle: (
        scheme: string,
        handler: (request: TargetMediaPreviewProtocolRequest) => Response | Promise<Response>,
      ) => targetSession().protocol.handle(scheme, handler),
      unhandle: (scheme: string) => targetSession().protocol.unhandle(scheme),
    }),
    isTrustedInvocation: (invocation: IpcMainInvokeEvent, window: TargetRcBrowserWindow) =>
      isTrustedTargetRcInvocation(invocation, window, rendererUrl),
    createWindow: (preloadPath: string): TargetRcBrowserWindow => {
      const window = new BrowserWindow(targetRcWindowOptions(preloadPath)) as TargetRcBrowserWindow;
      secureTargetRcWindow(window, rendererUrl);
      return window;
    },
    loadWindow: async (window: TargetRcBrowserWindow) => {
      await window.loadFile(targetRcRendererPath());
      window.show();
    },
  });
}

registerTargetMediaPreviewScheme({
  registerSchemesAsPrivileged: (schemes) =>
    protocol.registerSchemesAsPrivileged(schemes.map((scheme) => ({ ...scheme }))),
});

/**
 * Starts the target host only when a real production adapter composition is injected.
 * The RC entry deliberately has no legacy fallback or synthetic adapter implementation.
 */
export async function startTargetRcWithProductionAdapters<
  Event,
  Window extends TargetRendererWindowLike,
>(
  bootstrap: TargetRcProductionBootstrap<Event, Window>,
  platform: TargetRcElectronPlatform<Event, Window>,
): Promise<TargetElectronHost<Window>> {
  await platform.whenReady();
  return startTargetElectronHost({
    ...bootstrap,
    ipcMain: platform.ipcMain,
    mediaPreviewProtocol: platform.mediaPreviewProtocol,
    isTrustedInvocation: platform.isTrustedInvocation,
    createWindow: platform.createWindow,
    loadWindow: platform.loadWindow,
  });
}

export function unavailableTargetRcProductionBootstrap(): never {
  throw new TargetRcProductionAdaptersUnavailableError();
}

/**
 * This isolated RC process proves its target-only startup closure. It remains non-operational until
 * a production adapter composition is implemented and explicitly approved for cutover.
 */
export async function startTargetRcElectronEntry(
  bootstrap?: TargetRcProductionBootstrap<IpcMainInvokeEvent, TargetRcBrowserWindow>,
  platform?: TargetRcElectronPlatform<IpcMainInvokeEvent, TargetRcBrowserWindow>,
): Promise<TargetElectronHost<TargetRcBrowserWindow>> {
  if (bootstrap === undefined) return unavailableTargetRcProductionBootstrap();
  return startTargetRcWithProductionAdapters(
    bootstrap,
    platform ?? createTargetRcElectronPlatform(),
  );
}

export function isTargetRcElectronMain(
  moduleUrl: string = import.meta.url,
  argv: readonly string[] = process.argv,
): boolean {
  const entryPath = argv[1];
  return (
    entryPath !== undefined && path.resolve(entryPath) === path.resolve(fileURLToPath(moduleUrl))
  );
}

if (isTargetRcElectronMain()) {
  void startTargetRcElectronEntry().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[target-rc] ${message}`);
    app.exit(1);
  });
}
