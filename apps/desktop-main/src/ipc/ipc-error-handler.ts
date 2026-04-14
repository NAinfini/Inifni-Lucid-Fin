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

function toIpcError(error: unknown, _channel: string): IpcErrorPayload {
  if (error instanceof LucidError) {
    return {
      __ipcError: true,
      code: error.code,
      message: error.message,
      retryable: (error.details as Record<string, unknown> | undefined)?.retryable === true,
      details: error.details as Record<string, unknown> | undefined,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    __ipcError: true,
    code: ErrorCode.Unknown,
    message,
    retryable: false,
  };
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
export function withIpcHandler(
  channel: string,
  handler: IpcHandler,
): IpcHandler {
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
export function safeHandle(
  ipcMain: IpcMain,
  channel: string,
  handler: IpcHandler,
): void {
  ipcMain.handle(channel, withIpcHandler(channel, handler));
}
