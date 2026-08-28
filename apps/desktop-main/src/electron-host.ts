import { fileURLToPath } from 'node:url';
import { LUCID_FIN_WIRE_PUSH_CHANNEL_V1, type WirePushV1 } from '@lucid-fin/contracts';
import {
  startDesktopComposition,
  type DesktopComposition,
  type DesktopCompositionOptions,
} from './composition-root.js';
import type { IpcMainLike } from './ipc/router.js';
import type { WirePushSink } from './ipc/push-gateway.js';
import { installMediaPreviewProtocol, type MediaPreviewProtocol } from './media-preview.js';

export interface RendererWindowLike {
  readonly webContents: {
    isDestroyed(): boolean;
    send(channel: string, push: WirePushV1): void;
  };
  isDestroyed(): boolean;
  destroy(): void;
}

export interface ElectronHostOptions<Event, Window extends RendererWindowLike> {
  readonly composition: Omit<
    DesktopCompositionOptions<Event>,
    'authorizeInvocation' | 'ipcMain' | 'runEventSink'
  >;
  readonly ipcMain: IpcMainLike<Event>;
  readonly mediaPreviewProtocol: MediaPreviewProtocol;
  readonly isTrustedInvocation: (invocation: Event, window: Window) => boolean;
  readonly createWindow: (preloadPath: string) => Window;
  readonly loadWindow: (window: Window) => Promise<void>;
  readonly moduleUrl?: string;
}

export interface ElectronHost<Window extends RendererWindowLike> {
  readonly composition: DesktopComposition;
  readonly window: Window;
  close(): Promise<void>;
}

export function preloadPath(moduleUrl: string = import.meta.url): string {
  return fileURLToPath(new URL('./preload.cjs', moduleUrl));
}

export function createElectronPushSink<Window extends RendererWindowLike>(
  getWindow: () => Window | null,
): WirePushSink {
  return Object.freeze({
    send(push: WirePushV1): void {
      const window = getWindow();
      if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) return;
      window.webContents.send(LUCID_FIN_WIRE_PUSH_CHANNEL_V1, push);
    },
  });
}

export async function startElectronHost<Event, Window extends RendererWindowLike>(
  options: ElectronHostOptions<Event, Window>,
): Promise<ElectronHost<Window>> {
  let window: Window | null = null;
  const runEventSink = createElectronPushSink(() => window);
  const composition = await startDesktopComposition({
    ...options.composition,
    authorizeInvocation: (_request, invocation) => {
      const activeWindow = window;
      return activeWindow !== null && options.isTrustedInvocation(invocation, activeWindow);
    },
    ipcMain: options.ipcMain,
    runEventSink,
  });
  let disposeMediaPreviewProtocol: (() => void) | undefined;

  try {
    disposeMediaPreviewProtocol = installMediaPreviewProtocol(
      options.mediaPreviewProtocol,
      composition.mediaPreview,
    );
    window = options.createWindow(preloadPath(options.moduleUrl));
    await options.loadWindow(window);
  } catch (cause) {
    if (window !== null && !window.isDestroyed()) window.destroy();
    try {
      disposeMediaPreviewProtocol?.();
      disposeMediaPreviewProtocol = undefined;
    } catch (closeCause) {
      options.composition.onInternalError(closeCause);
    }
    try {
      await composition.close();
    } catch (closeCause) {
      options.composition.onInternalError(closeCause);
    }
    throw cause;
  }

  const readyWindow = window;
  let closed = false;
  return Object.freeze({
    composition,
    window: readyWindow,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      try {
        disposeMediaPreviewProtocol?.();
        disposeMediaPreviewProtocol = undefined;
      } finally {
        try {
          await composition.close();
        } finally {
          if (!readyWindow.isDestroyed()) readyWindow.destroy();
        }
      }
    },
  });
}
