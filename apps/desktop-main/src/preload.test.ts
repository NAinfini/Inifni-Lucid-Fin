import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_WIRE_METHODS_V1,
  LUCID_FIN_DESKTOP_API_GLOBAL_V1,
  LUCID_FIN_WIRE_INVOKE_CHANNEL_V1,
  LUCID_FIN_WIRE_PUSH_CHANNEL_V1,
  LUCID_FIN_WINDOW_CONTROL_CHANNEL_V1,
  type DesktopApiV1,
  type WirePushV1,
} from '@lucid-fin/contracts';

const exposeInMainWorld = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn());
const on = vi.hoisted(() => vi.fn());
const removeListener = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, removeListener, send },
}));

describe('desktop preload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    invoke.mockResolvedValue({ kind: 'success' });
  });

  it('exposes every canonical use case through one invoke channel', async () => {
    await import('./preload.cjs');
    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    expect(exposeInMainWorld.mock.calls[0]?.[0]).toBe(LUCID_FIN_DESKTOP_API_GLOBAL_V1);
    const api = exposeInMainWorld.mock.calls[0]?.[1] as DesktopApiV1;
    const exposedUseCases = Object.entries(api)
      .filter(([namespace]) => namespace !== 'windowControls')
      .flatMap(([namespace, methods]) =>
      Object.keys(methods)
        .filter((method) => method !== 'onEventsAppended')
        .map((method) => `${namespace}.${method}`),
      );
    expect(exposedUseCases).toHaveLength(Object.keys(PUBLIC_WIRE_METHODS_V1).length);

    const request = {
      requestId: 'request.preload.project-list.1',
      input: { cursor: null, limit: 20 },
    };
    await api.project.list(request);
    expect(invoke).toHaveBeenCalledWith(LUCID_FIN_WIRE_INVOKE_CHANNEL_V1, {
      wireVersion: 1,
      kind: 'request',
      requestId: request.requestId,
      method: 'project.list',
      input: request.input,
    });
    expect(new Set(invoke.mock.calls.map((call) => call[0]))).toEqual(
      new Set([LUCID_FIN_WIRE_INVOKE_CHANNEL_V1]),
    );
  });

  it('exposes isolated one-way custom window controls', async () => {
    await import('./preload.cjs');
    const api = exposeInMainWorld.mock.calls[0]?.[1] as DesktopApiV1;

    api.windowControls.minimize();
    api.windowControls.toggleMaximize();
    api.windowControls.close();

    expect(send.mock.calls).toEqual([
      [LUCID_FIN_WINDOW_CONTROL_CHANNEL_V1, 'minimize'],
      [LUCID_FIN_WINDOW_CONTROL_CHANNEL_V1, 'toggleMaximize'],
      [LUCID_FIN_WINDOW_CONTROL_CHANNEL_V1, 'close'],
    ]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('exposes one typed Run push subscription with exact listener cleanup', async () => {
    let listener: ((event: unknown, push: WirePushV1) => void) | undefined;
    on.mockImplementation((channel: string, value: typeof listener) => {
      if (channel === LUCID_FIN_WIRE_PUSH_CHANNEL_V1) listener = value;
    });
    await import('./preload.cjs');
    const api = exposeInMainWorld.mock.calls[0]?.[1] as DesktopApiV1;
    const callback = vi.fn();
    const dispose = api.run.onEventsAppended(callback);
    const push = {
      wireVersion: 1,
      kind: 'push',
      method: 'run.events.appended',
      payload: {
        cursor: { sequence: 1, eventHash: 'a'.repeat(64) },
        event: {
          visibility: 'public',
          eventId: 'event.preload.1',
          eventVersion: 1,
          runId: 'run.preload.1',
          sequence: 1,
          occurredAt: '2026-08-24T12:00:00.000Z',
          actor: 'commander',
          causation: { kind: 'run', runId: 'run.preload.1' },
          correlationId: null,
          idempotencyKey: null,
          payloadHash: 'b'.repeat(64),
          previousEventHash: null,
          eventHash: 'a'.repeat(64),
          payloadState: {
            state: 'available',
            payload: { type: 'progress', summary: 'Working' },
          },
        },
      },
    } as const satisfies WirePushV1;

    listener?.({}, push);
    expect(callback).toHaveBeenCalledWith(push);
    dispose();
    expect(removeListener).toHaveBeenCalledWith(LUCID_FIN_WIRE_PUSH_CHANNEL_V1, listener);
  });
});
