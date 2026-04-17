/**
 * Tests for the typed IPC registrar. Uses a minimal in-memory fake `IpcMain`
 * + `BrowserWindow` because we're testing the registrar's behavior, not
 * Electron IPC plumbing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  defineInvokeChannel,
  definePushChannel,
  defineReplyChannel,
} from '@lucid-fin/contracts-parse';
import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import {
  installCancelChannel,
  registerInvoke,
  registerPush,
  registerReply,
  type RegistrarDeps,
} from './registrar.js';

// ── Fakes ─────────────────────────────────────────────────────

type HandlerFn = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown | Promise<unknown>;

function createFakeIpcMain(): IpcMain & {
  __invoke(channel: string, ...args: unknown[]): Promise<unknown>;
} {
  const handlers = new Map<string, HandlerFn>();
  const fake = {
    handle(channel: string, handler: HandlerFn) {
      handlers.set(channel, handler);
    },
    removeHandler(channel: string) {
      handlers.delete(channel);
    },
    __invoke: async (channel: string, ...args: unknown[]) => {
      const h = handlers.get(channel);
      if (!h) throw new Error(`No handler for ${channel}`);
      const event = {} as IpcMainInvokeEvent;
      return h(event, ...args);
    },
  } as unknown as IpcMain & {
    __invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  };
  return fake;
}

function createFakeWindow(): {
  window: BrowserWindow;
  sent: Array<{ channel: string; payload: unknown }>;
} {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  const window = {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => {
        sent.push({ channel, payload });
      },
    },
  } as unknown as BrowserWindow;
  return { window, sent };
}

function makeDeps(): {
  deps: RegistrarDeps;
  ipcMain: ReturnType<typeof createFakeIpcMain>;
  sent: Array<{ channel: string; payload: unknown }>;
} {
  const ipcMain = createFakeIpcMain();
  const { window, sent } = createFakeWindow();
  return {
    deps: { ipcMain, getWindow: () => window },
    ipcMain,
    sent,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('registrar', () => {
  describe('registerInvoke', () => {
    const pingChannel = defineInvokeChannel({
      channel: 'health:ping',
      request: z.object({ nonce: z.string() }),
      response: z.object({ echo: z.string() }),
    });

    it('parses request and returns response', async () => {
      const { deps, ipcMain } = makeDeps();
      registerInvoke(deps, pingChannel, async (_ctx, req) => ({ echo: req.nonce }));
      const result = await ipcMain.__invoke('health:ping', { nonce: 'abc' });
      expect(result).toEqual({ echo: 'abc' });
    });

    it('throws LucidError(VALIDATION_FAILED) on bad request', async () => {
      const { deps, ipcMain } = makeDeps();
      registerInvoke(deps, pingChannel, async () => ({ echo: 'x' }));
      await expect(ipcMain.__invoke('health:ping', { wrong: true })).rejects.toMatchObject({
        code: ErrorCode.ValidationFailed,
      });
    });

    it('wraps arbitrary thrown errors as LucidError', async () => {
      const { deps, ipcMain } = makeDeps();
      registerInvoke(deps, pingChannel, async () => {
        throw new Error('oops');
      });
      await expect(ipcMain.__invoke('health:ping', { nonce: 'a' })).rejects.toBeInstanceOf(
        LucidError,
      );
    });

    it('does not re-wrap LucidError — preserves code/details', async () => {
      const { deps, ipcMain } = makeDeps();
      registerInvoke(deps, pingChannel, async () => {
        throw new LucidError(ErrorCode.ResourceNotFound, 'missing', { id: 'x' });
      });
      await expect(ipcMain.__invoke('health:ping', { nonce: 'a' })).rejects.toMatchObject({
        code: ErrorCode.ResourceNotFound,
        details: { id: 'x' },
      });
    });

    it('validates response — drift throws', async () => {
      const { deps, ipcMain } = makeDeps();
      registerInvoke(deps, pingChannel, async () => ({ wrong: 'shape' }) as never);
      await expect(ipcMain.__invoke('health:ping', { nonce: 'a' })).rejects.toMatchObject({
        code: ErrorCode.Unknown,
      });
    });
  });

  describe('cancellable invokes', () => {
    const streamChannel = defineInvokeChannel({
      channel: 'demo:stream',
      cancellable: true,
      request: z.object({ input: z.string() }),
      response: z.object({ aborted: z.boolean() }),
      events: z.object({ chunk: z.string() }),
    });

    beforeEach(() => {
      // Isolate cancel channel across tests.
    });

    it('provides AbortSignal and lets ipc:cancel trigger it', async () => {
      const { deps, ipcMain, sent } = makeDeps();
      installCancelChannel(ipcMain);

      let observedAborted = false;

      registerInvoke(deps, streamChannel, async (ctx) => {
        await new Promise<void>((resolve) => {
          ctx.signal!.addEventListener('abort', () => {
            observedAborted = true;
            resolve();
          });
          // Wait for the invocation id to be pushed to the renderer, then
          // fire cancel using it.
          queueMicrotask(() => {
            const invocationBeacon = sent.find(
              (s) => s.channel === 'demo:stream:invocation',
            );
            const id = (invocationBeacon?.payload as { invocationId: string })
              .invocationId;
            void ipcMain.__invoke('ipc:cancel', id);
          });
        });
        return { aborted: observedAborted };
      });

      const result = await ipcMain.__invoke('demo:stream', { input: 'x' });
      expect(result).toEqual({ aborted: true });
    });

    it('surfaces the invocationId to the renderer before the handler runs', async () => {
      const { deps, ipcMain, sent } = makeDeps();
      let idSeenInsideHandler: string = '';
      registerInvoke(deps, streamChannel, async (ctx) => {
        idSeenInsideHandler = ctx.invocationId;
        return { aborted: false };
      });
      await ipcMain.__invoke('demo:stream', { input: 'x' });
      const beacon = sent.find((s) => s.channel === 'demo:stream:invocation');
      expect(beacon).toBeTruthy();
      expect((beacon?.payload as { invocationId: string }).invocationId).toBe(
        idSeenInsideHandler,
      );
    });

    it('normalizes AbortError thrown by the handler to ErrorCode.Cancelled', async () => {
      const { deps, ipcMain } = makeDeps();
      installCancelChannel(ipcMain);
      registerInvoke(deps, streamChannel, async (ctx) => {
        // Simulate an abort-sensitive library throwing AbortError after the
        // caller cancels. We pre-abort so the signal is truthy.
        const controller = ctx.signal!;
        // Fire cancel synchronously so signal.aborted becomes true.
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        controller.addEventListener('abort', () => {
          // no-op
        });
        // Abort via the registry:
        queueMicrotask(() => {
          void ipcMain.__invoke('ipc:cancel', ctx.invocationId);
        });
        await new Promise((r) => queueMicrotask(() => r(null)));
        throw err;
      });
      await expect(ipcMain.__invoke('demo:stream', { input: 'x' })).rejects.toMatchObject({
        code: ErrorCode.Cancelled,
      });
    });

    it('emits typed events via webContents', async () => {
      const { deps, ipcMain, sent } = makeDeps();
      registerInvoke(deps, streamChannel, async (ctx) => {
        ctx.emit!({ chunk: 'hello' });
        ctx.emit!({ chunk: 'world' });
        return { aborted: false };
      });
      await ipcMain.__invoke('demo:stream', { input: 'x' });
      const events = sent.filter((s) => s.channel === 'demo:stream:event');
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        channel: 'demo:stream:event',
        payload: { event: { chunk: 'hello' } },
      });
      expect(events[1]?.payload).toMatchObject({ event: { chunk: 'world' } });
      // Every emit carries the same invocationId.
      const ids = events.map((s) => (s.payload as { invocationId: string }).invocationId);
      expect(ids[0]).toBe(ids[1]);
    });
  });

  describe('registerPush', () => {
    const jobProgress = definePushChannel({
      channel: 'job:progress',
      payload: z.object({ jobId: z.string(), pct: z.number() }),
    });

    it('validates payload and sends to window', () => {
      const { deps, sent } = makeDeps();
      const emit = registerPush(deps, jobProgress);
      emit({ jobId: 'j1', pct: 42 });
      expect(sent).toEqual([
        { channel: 'job:progress', payload: { jobId: 'j1', pct: 42 } },
      ]);
    });

    it('throws when payload is invalid', () => {
      const { deps } = makeDeps();
      const emit = registerPush(deps, jobProgress);
      expect(() => emit({ jobId: 'j1' } as never)).toThrow();
    });
  });

  describe('registerReply', () => {
    const replyChannel = defineReplyChannel({
      channel: 'prompt:reply',
      request: z.object({ promptId: z.string(), answer: z.string() }),
      response: z.object({ accepted: z.boolean() }),
    });

    it('parses and dispatches to handler', async () => {
      const { deps, ipcMain } = makeDeps();
      registerReply(deps, replyChannel, async (_ctx, req) => ({
        accepted: req.answer === 'yes',
      }));
      const result = await ipcMain.__invoke('prompt:reply', {
        promptId: 'p',
        answer: 'yes',
      });
      expect(result).toEqual({ accepted: true });
    });
  });
});
