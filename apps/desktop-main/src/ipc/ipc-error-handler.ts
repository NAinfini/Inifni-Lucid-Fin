/**
 * Last-resort IPC error wrapper (Phase B-5).
 *
 * The typed registrar in `features/ipc/registrar.ts` is the preferred
 * entry point for new channels — it already converts validation failures,
 * aborts, and unknown throws into `LucidError`. This module remains for
 * hand-written `ipcMain.handle` call sites that have not yet been migrated
 * to the registrar. Its only job is to guarantee that every non-registrar
 * handler still serializes its error as an `IpcErrorPayload` with a
 * `LucidError`-derived `code`.
 *
 * Do not call this from new code. Add the channel to the registry and use
 * `registerInvoke` / `registerReply` / `registerPush` instead.
 */
import log from '../logger.js';
import { LucidError, ErrorCode } from '@lucid-fin/contracts';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';

/**
 * Structured IPC error returned to the renderer.
 * The renderer can inspect `code` and `retryable` for error recovery.
 */
export interface IpcErrorPayload {
  __ipcError: true;
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

/**
 * Convert any thrown value into the renderer-facing `IpcErrorPayload`
 * envelope. Shared between the typed registrar and legacy `safeHandle`.
 */
export function toIpcErrorPayload(error: unknown): IpcErrorPayload {
  const lucid =
    error instanceof LucidError ? error : LucidError.fromUnknown(error, ErrorCode.Unknown);
  const details = lucid.details as Record<string, unknown> | undefined;
  return {
    __ipcError: true,
    code: lucid.code,
    message: lucid.message,
    retryable: details?.retryable === true,
    details,
  };
}

function toIpcError(error: unknown, _channel: string): IpcErrorPayload {
  return toIpcErrorPayload(error);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- must match Electron's own IpcMain.handle signature
type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any;

/**
 * Wraps an IPC handler with consistent error logging and structured error responses.
 *
 * Usage:
 *   ipcMain.handle('channel', withIpcHandler('channel', async (event, args) => { ... }));
 *
 * Or use the convenience helper:
 *   safeHandle(ipcMain, 'channel', async (event, args) => { ... });
 */
export function withIpcHandler(channel: string, handler: IpcHandler): IpcHandler {
  return async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      log.error(`IPC handler error [${channel}]`, {
        category: 'ipc',
        channel,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw toIpcError(error, channel);
    }
  };
}

/**
 * Convenience: register an IPC handler with automatic error wrapping.
 *
 * Replaces:
 *   ipcMain.handle('channel', async (_e, args) => { ... });
 *
 * With:
 *   safeHandle(ipcMain, 'channel', async (_e, args) => { ... });
 */
export function safeHandle(ipcMain: IpcMain, channel: string, handler: IpcHandler): void {
  ipcMain.handle(channel, withIpcHandler(channel, handler));
}
