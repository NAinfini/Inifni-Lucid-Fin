import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';

let traceIdCounter = 0;

/**
 * Generate a short trace ID for IPC request correlation.
 * Uses a monotonic counter + random suffix for uniqueness without full UUID overhead.
 */
export function generateTraceId(): string {
  return `t${++traceIdCounter}-${randomUUID().slice(0, 8)}`;
}

/**
 * Synchronous trace context for the main process.
 * Stores the current trace ID so handlers and sub-calls can access it.
 *
 * NOTE: withTraceId does NOT propagate across async await boundaries.
 * For sync handlers (e.g. better-sqlite3) the context is fully reliable.
 * For async handlers the traceId is set at invocation start but may be
 * overwritten by a concurrent request before the handler completes.
 * Use getTraceId() only at the synchronous top of an async handler, or
 * capture the traceId from generateTraceId() directly.
 */
let currentTraceId: string | undefined;

export function withTraceId<T>(traceId: string, fn: () => T): T {
  const prev = currentTraceId;
  currentTraceId = traceId;
  try {
    return fn();
  } finally {
    currentTraceId = prev;
  }
}

export function getTraceId(): string | undefined {
  return currentTraceId;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- must match Electron's IpcMain.handle signature
type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => any;

/**
 * Register an IPC handler wrapped with trace ID injection.
 *
 * A fresh traceId is generated at the start of each invocation and stored in
 * the synchronous trace context for the duration of the call. On error the
 * traceId is included in the console output for log correlation.
 *
 * Usage:
 *   tracedHandle(ipcMain, 'channel:name', async (event, args) => { ... });
 */
export function tracedHandle(ipcMain: IpcMain, channel: string, handler: IpcHandler): void {
  ipcMain.handle(channel, (event, ...args) => {
    const traceId = generateTraceId();
    return withTraceId(traceId, () => {
      try {
        return handler(event, ...args);
      } catch (error) {
        console.error(`[${traceId}] IPC error on ${channel}:`, error);
        throw error;
      }
    });
  });
}
