/**
 * Typed IPC handler registrar.
 *
 * Phase B-3. Consumes channel definitions from `@lucid-fin/contracts-parse`
 * and registers them with Electron's `ipcMain` while:
 *
 *   1. Running `parseStrict` on the request — malformed renderer payloads
 *      become `LucidError(VALIDATION_FAILED)` at the boundary (not in every
 *      handler body).
 *   2. Generating a branded `IpcInvocationId` per call.
 *   3. Providing an `AbortSignal` on cancellable invocations, wired to a
 *      companion `<channel>:cancel` channel the renderer invokes with the
 *      invocation id.
 *   4. Exposing `emit(event)` for invoke channels that stream events back;
 *      each event is validated against the declared zod schema so drift
 *      between main and renderer surfaces immediately in dev.
 *   5. Wrapping any thrown value (including non-`LucidError` exceptions)
 *      with `LucidError.fromUnknown` so the renderer only ever sees the
 *      structured error envelope.
 *
 * The legacy `ipc-error-handler.ts` becomes a last-resort `fromUnknown`
 * wrapper for hand-written handlers that haven't been migrated yet.
 */
import { randomUUID } from 'node:crypto';
import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';
import type {
  IpcInvocationId,
  InvokeChannelType,
  PushChannelType,
  ReplyChannelType,
} from '@lucid-fin/contracts';
import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import {
  parseStrict,
  unsafeBrand,
  type InvokeChannelDef,
  type PushChannelDef,
  type ReplyChannelDef,
} from '@lucid-fin/contracts-parse';
import log from '../../logger.js';

// ---------------------------------------------------------------------------
// Context passed to invoke/reply handlers
// ---------------------------------------------------------------------------

/**
 * Context object threaded into every registered handler. Exposes the
 * invocation id, an optional abort signal (populated only for `cancellable`
 * invokes), and — for invoke channels that declared `events` — a typed
 * `emit` function. `getWindow` is available for handlers that need to push
 * ad-hoc messages (discouraged — prefer typed events).
 */
export interface InvokeContext<Evt = never> {
  readonly invocationId: IpcInvocationId;
  readonly signal: AbortSignal | undefined;
  readonly emit: [Evt] extends [never] ? undefined : (event: Evt) => void;
  readonly getWindow: () => BrowserWindow | null;
  readonly rawEvent: IpcMainInvokeEvent;
}

export interface ReplyContext {
  readonly invocationId: IpcInvocationId;
  readonly rawEvent: IpcMainInvokeEvent;
}

export type InvokeHandler<Req, Res, Evt> = (
  ctx: InvokeContext<Evt>,
  req: Req,
) => Promise<Res> | Res;

export type ReplyHandler<Req, Res> = (
  ctx: ReplyContext,
  req: Req,
) => Promise<Res> | Res;

// ---------------------------------------------------------------------------
// Shared registrar config
// ---------------------------------------------------------------------------

export interface RegistrarDeps {
  readonly ipcMain: IpcMain;
  readonly getWindow: () => BrowserWindow | null;
}

// Active abort controllers for cancellable invocations, keyed by invocation id.
// Entries are removed when the handler settles or on explicit cancel.
const abortControllers = new Map<IpcInvocationId, AbortController>();

/** Must be called once during app bootstrap. Registers the shared cancel
 *  channel that any cancellable invoke piggy-backs on. */
export function installCancelChannel(ipcMain: IpcMain): void {
  ipcMain.handle('ipc:cancel', (_event, rawId: unknown) => {
    if (typeof rawId !== 'string') return false;
    const id = unsafeBrand<IpcInvocationId>(rawId);
    const controller = abortControllers.get(id);
    if (!controller) return false;
    controller.abort();
    abortControllers.delete(id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// registerInvoke
// ---------------------------------------------------------------------------

export function registerInvoke<
  Channel extends string,
  Req,
  Res,
  Evt,
>(
  deps: RegistrarDeps,
  channel: InvokeChannelDef<Channel, Req, Res, Evt>,
  handler: InvokeHandler<Req, Res, Evt>,
): void {
  const { ipcMain, getWindow } = deps;
  const channelName = channel.channel;

  ipcMain.handle(channelName, async (event, rawReq) => {
    const invocationId = unsafeBrand<IpcInvocationId>(randomUUID());
    let controller: AbortController | undefined;

    try {
      const req = parseRequest(channel.schemas.request, rawReq, channelName);

      if (channel.cancellable) {
        controller = new AbortController();
        abortControllers.set(invocationId, controller);
        // Surface the invocation id to the renderer so it can call
        // `ipc:cancel`. Sent *before* we start the handler so the renderer
        // can abort even a synchronous-looking but long-running call.
        publishInvocation(getWindow, channelName, invocationId);
      }

      const emit = makeEmit(channel, invocationId, getWindow);

      const ctx: InvokeContext<Evt> = {
        invocationId,
        signal: controller?.signal,
        emit: emit as InvokeContext<Evt>['emit'],
        getWindow,
        rawEvent: event,
      };

      const result = await handler(ctx, req);

      // Defensive response parse — catches main→renderer contract drift in dev.
      return parseStrict(channel.schemas.response, result, {
        name: `${channelName}.response`,
      });
    } catch (error) {
      throw toLucidError(error, channelName, controller?.signal);
    } finally {
      if (controller) {
        abortControllers.delete(invocationId);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// registerReply
// ---------------------------------------------------------------------------

export function registerReply<Channel extends string, Req, Res>(
  deps: RegistrarDeps,
  channel: ReplyChannelDef<Channel, Req, Res>,
  handler: ReplyHandler<Req, Res>,
): void {
  const { ipcMain } = deps;
  const channelName = channel.channel;

  ipcMain.handle(channelName, async (event, rawReq) => {
    const invocationId = unsafeBrand<IpcInvocationId>(randomUUID());
    try {
      const req = parseRequest(channel.schemas.request, rawReq, channelName);
      const ctx: ReplyContext = { invocationId, rawEvent: event };
      const result = await handler(ctx, req);
      return parseStrict(channel.schemas.response, result, {
        name: `${channelName}.response`,
      });
    } catch (error) {
      throw toLucidError(error, channelName);
    }
  });
}

// ---------------------------------------------------------------------------
// registerPush
// ---------------------------------------------------------------------------

/**
 * Register a push channel. Returns a typed `emit(payload)` function that
 * validates the payload against the channel schema before dispatching to
 * the renderer via `webContents.send`.
 */
export function registerPush<Channel extends string, Payload>(
  deps: RegistrarDeps,
  channel: PushChannelDef<Channel, Payload>,
): (payload: Payload) => void {
  const { getWindow } = deps;
  const channelName = channel.channel;

  return (payload: Payload) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const validated = parseStrict(channel.schemas.payload, payload, {
      name: `${channelName}.payload`,
    });
    win.webContents.send(channelName, validated);
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function parseRequest<T>(
  schema: InvokeChannelDef<string, T>['schemas']['request'],
  raw: unknown,
  channelName: string,
): T {
  try {
    return parseStrict(schema, raw, { name: `${channelName}.request` });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new LucidError(
      ErrorCode.ValidationFailed,
      `IPC request validation failed on '${channelName}': ${message}`,
      { channel: channelName, cause: String(cause) },
    );
  }
}

function makeEmit<Evt>(
  channel: InvokeChannelDef<string, unknown, unknown, Evt>,
  invocationId: IpcInvocationId,
  getWindow: () => BrowserWindow | null,
): ((event: Evt) => void) | undefined {
  // `z.never()` is the no-events sentinel. Callers whose channel declared
  // no `events` simply never call `emit`; a stray `.emit(undefined)` would
  // fail validation and produce a clear diagnostic in dev.
  const eventChannel = `${channel.channel}:event`;

  return (event: Evt) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const validated = parseStrict(channel.schemas.event, event, {
      name: `${channel.channel}.event`,
    });
    win.webContents.send(eventChannel, { invocationId, event: validated });
  };
}

function publishInvocation(
  getWindow: () => BrowserWindow | null,
  channelName: string,
  invocationId: IpcInvocationId,
): void {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  // Dedicated envelope so renderers can distinguish the id-surfacing from
  // regular handler events. Channel: `${channel}:invocation`.
  win.webContents.send(`${channelName}:invocation`, { invocationId });
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError') return true;
  // Node's `AbortController.abort()` typically throws DOMException-like
  // shapes; DOMException's name === 'AbortError' handled above. Some
  // libraries surface a `.code === 'ABORT_ERR'` instead.
  const code = (error as { code?: unknown }).code;
  return code !== undefined && String(code) === 'ABORT_ERR';
}

function toLucidError(
  error: unknown,
  channelName: string,
  signal?: AbortSignal,
): LucidError {
  if (error instanceof LucidError) {
    // Don't double-wrap; keep original code + details.
    return error;
  }
  // Normalize aborts to `CANCELLED` so the renderer can distinguish
  // user-initiated cancellation from genuine failures.
  if (signal?.aborted === true || isAbortError(error)) {
    return new LucidError(
      ErrorCode.Cancelled,
      `IPC call cancelled on '${channelName}'`,
      { channel: channelName },
    );
  }
  log.error(`IPC handler error [${channelName}]`, {
    category: 'ipc',
    channel: channelName,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  return LucidError.fromUnknown(error, ErrorCode.Unknown);
}

// Phantom imports so `InvokeChannelType` / `PushChannelType` / `ReplyChannelType`
// remain part of the public shape this module documents without triggering
// "unused import" lint in consumers.
export type { InvokeChannelType, PushChannelType, ReplyChannelType };
