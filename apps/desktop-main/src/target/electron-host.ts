import { fileURLToPath } from 'node:url';
import { TARGET_WIRE_PUSH_CHANNEL_V1, type WirePushV1 } from '@lucid-fin/target-contracts';
import {
  startTargetDesktopComposition,
  type TargetDesktopComposition,
  type TargetDesktopCompositionOptions,
} from './composition-root.js';
import type { TargetIpcMainLike } from './ipc/router.js';
import type { TargetWirePushSink } from './ipc/push-gateway.js';
import {
  installTargetMediaPreviewProtocol,
  type TargetMediaPreviewProtocol,
} from './media-preview.js';

export interface TargetRendererWindowLike {
  readonly webContents: {
    isDestroyed(): boolean;
    send(channel: string, push: WirePushV1): void;
  };
  isDestroyed(): boolean;
  destroy(): void;
}

export interface TargetElectronHostOptions<Event, Window extends TargetRendererWindowLike> {
  readonly composition: Omit<
    TargetDesktopCompositionOptions<Event>,
    'authorizeInvocation' | 'ipcMain' | 'runEventSink'
  >;
  readonly ipcMain: TargetIpcMainLike<Event>;
  readonly mediaPreviewProtocol: TargetMediaPreviewProtocol;
  readonly isTrustedInvocation: (invocation: Event, window: Window) => boolean;
  readonly createWindow: (preloadPath: string) => Window;
  readonly loadWindow: (window: Window) => Promise<void>;
  readonly moduleUrl?: string;
}

export interface TargetElectronHost<Window extends TargetRendererWindowLike> {
  readonly composition: TargetDesktopComposition;
  readonly window: Window;
  close(): Promise<void>;
}

export function targetPreloadPath(moduleUrl: string = import.meta.url): string {
  return fileURLToPath(new URL('./preload.generated.cjs', moduleUrl));
}

export function createTargetElectronPushSink<Window extends TargetRendererWindowLike>(
  getWindow: () => Window | null,
): TargetWirePushSink {
  return Object.freeze({
    send(push: WirePushV1): void {
      const window = getWindow();
      if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) return;
      window.webContents.send(TARGET_WIRE_PUSH_CHANNEL_V1, push);
    },
  });
}

export async function startTargetElectronHost<Event, Window extends TargetRendererWindowLike>(
  options: TargetElectronHostOptions<Event, Window>,
): Promise<TargetElectronHost<Window>> {
  let window: Window | null = null;
  const runEventSink = createTargetElectronPushSink(() => window);
  const composition = await startTargetDesktopComposition({
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
    disposeMediaPreviewProtocol = installTargetMediaPreviewProtocol(
      options.mediaPreviewProtocol,
      composition.mediaPreview,
    );
    window = options.createWindow(targetPreloadPath(options.moduleUrl));
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
