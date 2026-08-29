import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  type BrowserWindowConstructorOptions,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { WireRequestV1 } from '@lucid-fin/contracts';
import {
  startElectronHost,
  type ElectronHost,
  type ElectronHostOptions,
  type RendererWindowLike,
} from './electron-host.js';
import type { IpcMainLike } from './ipc/router.js';
import {
  registerMediaPreviewScheme,
  type MediaPreviewProtocol,
  type MediaPreviewProtocolRequest,
} from './media-preview.js';
import type { ExportDestinationPickerAdapter } from './export-destination.js';
import { LOCAL_OLLAMA_PROVIDER_ID, systemRecoveryKeyStore } from './production-adapters.js';
import { createProductionCompositionOptions } from './production-composition.js';
import type { FilesystemExportGrant, LocalMediaPicker } from './production-local-adapters.js';

type DesktopBrowserWindow = BrowserWindow & RendererWindowLike;

export const LUCID_FIN_SESSION_PARTITION = 'lucid-fin-desktop' as const;

interface NavigationEventLike {
  preventDefault(): void;
}

interface FrameLike {
  readonly url: string;
}

interface WebContentsSecurityLike {
  readonly mainFrame: FrameLike;
  isDestroyed(): boolean;
  on(event: 'will-navigate', listener: (event: NavigationEventLike, url: string) => void): unknown;
  on(event: 'will-attach-webview', listener: (event: NavigationEventLike) => void): unknown;
  setWindowOpenHandler(handler: () => { readonly action: 'deny' }): unknown;
}

interface TrustedWindowLike {
  readonly webContents: WebContentsSecurityLike;
  isDestroyed(): boolean;
}

interface IpcInvocationLike {
  readonly sender: WebContentsSecurityLike;
  readonly senderFrame: FrameLike | null;
}

export interface ProductionBootstrap<Event, Window extends RendererWindowLike> {
  readonly composition: ElectronHostOptions<Event, Window>['composition'];
  readonly moduleUrl?: string;
}

export interface ElectronPlatform<Event, Window extends RendererWindowLike> {
  whenReady(): Promise<void>;
  readonly ipcMain: IpcMainLike<Event>;
  readonly mediaPreviewProtocol: MediaPreviewProtocol;
  isTrustedInvocation(invocation: Event, window: Window): boolean;
  createWindow(preloadPath: string): Window;
  loadWindow(window: Window): Promise<void>;
}

const MEDIA_EXTENSIONS = Object.freeze({
  image: Object.freeze(['png', 'jpg', 'jpeg', 'webp']),
  video: Object.freeze(['mp4', 'mov', 'webm', 'mkv']),
  audio: Object.freeze(['wav', 'mp3', 'aac', 'flac']),
});

function selectableMediaExtensions(kinds: readonly string[]): string[] {
  const extensions = new Set<string>();
  for (const kind of kinds) {
    for (const extension of MEDIA_EXTENSIONS[kind as keyof typeof MEDIA_EXTENSIONS] ?? []) {
      extensions.add(extension);
    }
  }
  return [...extensions];
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function safeOutputLabel(value: string | null, allowedExtensions: readonly string[]): string {
  const fallback = `delivery.${allowedExtensions[0]!.toLowerCase()}`;
  if (
    value === null ||
    value !== path.basename(value) ||
    value === '.' ||
    value === '..' ||
    /[\\/]/u.test(value) ||
    containsControlCharacter(value)
  ) {
    return fallback;
  }
  const extension = path.extname(value).slice(1).toLowerCase();
  return allowedExtensions.some((allowed) => allowed.toLowerCase() === extension)
    ? value
    : fallback;
}

function absoluteSelectedPath(value: string | undefined): string | null {
  return value !== undefined && path.isAbsolute(value) ? value : null;
}

function createElectronMediaPicker(): LocalMediaPicker {
  return Object.freeze({
    async pick(input: Parameters<LocalMediaPicker['pick']>[0]) {
      const extensions = selectableMediaExtensions(input.kinds);
      if (extensions.length === 0) return null;
      const result = await dialog.showOpenDialog({
        title: 'Select media',
        properties: ['openFile', ...(input.multiple ? ['multiSelections' as const] : [])],
        filters: [{ name: 'Media', extensions }],
      });
      if (result.canceled) return null;
      const paths = result.filePaths.filter((filePath) => path.isAbsolute(filePath));
      return paths.length === result.filePaths.length ? paths : null;
    },
  });
}

function createElectronExportDestinationPicker(): ExportDestinationPickerAdapter {
  return Object.freeze({
    async pick(input: Parameters<ExportDestinationPickerAdapter['pick']>[0]) {
      const label = safeOutputLabel(input.suggestedFileName, input.allowedExtensions);
      if (input.destination === 'file') {
        const result = await dialog.showSaveDialog({
          title: 'Export delivery',
          defaultPath: label,
          filters: [{ name: 'Delivery', extensions: [...input.allowedExtensions] }],
        });
        const filePath = result.canceled ? null : absoluteSelectedPath(result.filePath);
        if (filePath === null) return Object.freeze({ state: 'cancelled' as const });
        const writableGrant: FilesystemExportGrant = Object.freeze({
          kind: 'file',
          path: filePath,
        });
        return Object.freeze({
          state: 'selected' as const,
          destination: 'file' as const,
          displayLabel: path.basename(filePath),
          writableGrant,
        });
      }
      const result = await dialog.showOpenDialog({
        title: 'Choose export folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      const folderPath = result.canceled ? null : absoluteSelectedPath(result.filePaths[0]);
      if (folderPath === null) return Object.freeze({ state: 'cancelled' as const });
      const writableGrant: FilesystemExportGrant = Object.freeze({
        kind: 'folder',
        path: folderPath,
      });
      return Object.freeze({
        state: 'selected' as const,
        destination: 'folder' as const,
        displayLabel: label,
        writableGrant,
      });
    },
  });
}

export async function createProductionBootstrap(): Promise<
  ProductionBootstrap<IpcMainInvokeEvent, DesktopBrowserWindow>
> {
  await app.whenReady();
  const composition = await createProductionCompositionOptions({
    userDataPath: app.getPath('userData'),
    recoveryKeyStore: await systemRecoveryKeyStore(),
    model: {
      provider: {
        providerId: LOCAL_OLLAMA_PROVIDER_ID,
        model: 'qwen3:8b',
        reasoningStrength: null,
      },
    },
    mediaPicker: createElectronMediaPicker(),
  });
  return Object.freeze({
    composition: {
      databasePath: composition.layout.databasePath,
      dataAccess: composition.dataAccess,
      provisionHost: composition.provisionHost,
      createAcceptanceSeedFor: composition.createAcceptanceSeedFor,
      exportDestinationPicker: createElectronExportDestinationPicker(),
      pickMedia: composition.pickMedia,
      contextForRequest: (request: WireRequestV1) => composition.contextForRequest(request),
      createRuntime: composition.createRuntime,
      createPushRequestId: composition.createPushRequestId,
      reportStartup: composition.reportStartup,
      onInternalError: composition.onInternalError,
    },
  });
}

export function rendererPath(
  moduleUrl: string = import.meta.url,
  packaged: boolean = app.isPackaged,
  resourcesPath: string = process.resourcesPath,
): string {
  if (packaged) return path.join(resourcesPath, 'renderer', 'index.html');
  return path.resolve(
    path.dirname(fileURLToPath(moduleUrl)),
    '../../desktop-renderer/dist/index.html',
  );
}

export function rendererDocumentUrl(moduleUrl: string = import.meta.url): string {
  return pathToFileURL(rendererPath(moduleUrl)).href;
}

export function windowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: '#0d0f14',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#11141a',
      symbolColor: '#aeb8c6',
      height: 40,
    },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload,
      partition: LUCID_FIN_SESSION_PARTITION,
    },
  };
}

function isRendererDocumentUrl(value: string, expectedRendererUrl: string): boolean {
  try {
    const actual = new URL(value);
    actual.hash = '';
    return actual.href === expectedRendererUrl;
  } catch {
    return false;
  }
}

export function secureRendererWindow(window: TrustedWindowLike, expectedRendererUrl: string): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event, url) => {
    if (!isRendererDocumentUrl(url, expectedRendererUrl)) event.preventDefault();
  });
}

export function isTrustedRendererInvocation(
  invocation: IpcInvocationLike,
  window: TrustedWindowLike,
  expectedRendererUrl: string,
): boolean {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
  const frame = invocation.senderFrame;
  return (
    invocation.sender === window.webContents &&
    frame !== null &&
    frame === window.webContents.mainFrame &&
    isRendererDocumentUrl(frame.url, expectedRendererUrl) &&
    isRendererDocumentUrl(window.webContents.mainFrame.url, expectedRendererUrl)
  );
}

function createElectronPlatform(): ElectronPlatform<IpcMainInvokeEvent, DesktopBrowserWindow> {
  let sessionConfigured = false;
  const desktopSession = () => session.fromPartition(LUCID_FIN_SESSION_PARTITION);
  const expectedRendererUrl = rendererDocumentUrl();
  return Object.freeze({
    whenReady: async () => {
      await app.whenReady();
      if (sessionConfigured) return;
      sessionConfigured = true;
      const isolatedSession = desktopSession();
      isolatedSession.setPermissionCheckHandler(() => false);
      isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false),
      );
    },
    ipcMain: ipcMain as unknown as IpcMainLike<IpcMainInvokeEvent>,
    mediaPreviewProtocol: Object.freeze({
      handle: (
        scheme: string,
        handler: (request: MediaPreviewProtocolRequest) => Response | Promise<Response>,
      ) => desktopSession().protocol.handle(scheme, handler),
      unhandle: (scheme: string) => desktopSession().protocol.unhandle(scheme),
    }),
    isTrustedInvocation: (invocation: IpcMainInvokeEvent, window: DesktopBrowserWindow) =>
      isTrustedRendererInvocation(invocation, window, expectedRendererUrl),
    createWindow: (preloadPath: string): DesktopBrowserWindow => {
      const window = new BrowserWindow(windowOptions(preloadPath)) as DesktopBrowserWindow;
      secureRendererWindow(window, expectedRendererUrl);
      return window;
    },
    loadWindow: async (window: DesktopBrowserWindow) => {
      await window.loadFile(rendererPath());
      window.show();
    },
  });
}

registerMediaPreviewScheme({
  registerSchemesAsPrivileged: (schemes) =>
    protocol.registerSchemesAsPrivileged(schemes.map((scheme) => ({ ...scheme }))),
});

export async function startWithProductionAdapters<Event, Window extends RendererWindowLike>(
  bootstrap: ProductionBootstrap<Event, Window>,
  platform: ElectronPlatform<Event, Window>,
): Promise<ElectronHost<Window>> {
  await platform.whenReady();
  return startElectronHost({
    ...bootstrap,
    ipcMain: platform.ipcMain,
    mediaPreviewProtocol: platform.mediaPreviewProtocol,
    isTrustedInvocation: platform.isTrustedInvocation,
    createWindow: platform.createWindow,
    loadWindow: platform.loadWindow,
  });
}

export async function startElectronEntry(
  bootstrap?: ProductionBootstrap<IpcMainInvokeEvent, DesktopBrowserWindow>,
  platform?: ElectronPlatform<IpcMainInvokeEvent, DesktopBrowserWindow>,
): Promise<ElectronHost<DesktopBrowserWindow>> {
  return startWithProductionAdapters(
    bootstrap ?? (await createProductionBootstrap()),
    platform ?? createElectronPlatform(),
  );
}

export function isElectronMain(
  moduleUrl: string = import.meta.url,
  argv: readonly string[] = process.argv,
): boolean {
  const entryPath = argv[1];
  return (
    entryPath !== undefined && path.resolve(entryPath) === path.resolve(fileURLToPath(moduleUrl))
  );
}

if (isElectronMain()) {
  void startElectronEntry().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[desktop] ${message}`);
    app.exit(1);
  });
}
