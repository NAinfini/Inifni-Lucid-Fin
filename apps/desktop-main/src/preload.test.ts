import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const exposeInMainWorld = vi.hoisted(() => vi.fn());
const ipcInvoke = vi.hoisted(() => vi.fn());
const ipcOn = vi.hoisted(() => vi.fn());
const ipcRemoveListener = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: ipcInvoke,
    on: ipcOn,
    removeListener: ipcRemoveListener,
  },
}));

describe('preload commander bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    ipcInvoke.mockResolvedValue(undefined);
  });

  it('exposes session, snapshot, Commander control, Canvas lifecycle, Delivery, and Review Cut APIs through lucidAPI', async () => {
    await import('./preload.cjs');

    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      session: Record<string, unknown>;
      snapshot: Record<string, unknown>;
      commander: Record<string, unknown>;
      canvas: Record<string, unknown>;
      canvasDelivery: Record<string, unknown>;
      deliveryPackage: Record<string, unknown>;
      reviewCut: Record<string, unknown>;
    };

    expect(api.session).toBeDefined();
    expect(typeof api.session.upsert).toBe('function');
    expect(typeof api.session.list).toBe('function');
    expect(typeof api.session.get).toBe('function');
    expect(typeof api.session.delete).toBe('function');
    expect(typeof api.session.move).toBe('function');

    expect(api.snapshot).toBeDefined();
    expect(typeof api.snapshot.capture).toBe('function');
    expect(typeof api.snapshot.list).toBe('function');
    expect(typeof api.snapshot.restore).toBe('function');
    expect(typeof api.snapshot.delete).toBe('function');
    expect(typeof api.commander.runControl).toBe('function');
    expect(typeof api.commander.runTree).toBe('function');
    expect(typeof api.canvas.restore).toBe('function');
    expect(typeof api.canvas.deletePermanent).toBe('function');
    expect(typeof api.canvasDelivery.update).toBe('function');
    expect(Object.keys(api.deliveryPackage).sort()).toEqual([
      'cancel',
      'open',
      'retry',
      'start',
      'status',
    ]);
    expect(Object.keys(api.reviewCut).sort()).toEqual(['cancel', 'open', 'start', 'status']);
  });

  it('replays an initialization error emitted before the renderer subscribes', async () => {
    let initErrorListener: ((event: unknown, error: unknown) => void) | undefined;
    ipcOn.mockImplementation((channel: string, listener: (...args: unknown[]) => void) => {
      if (channel === 'app:init-error') initErrorListener = listener;
    });

    await import('./preload.cjs');
    initErrorListener?.({}, 'Canonical schema validation failed');

    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      onInitError: (callback: (error: string) => void) => () => void;
    };
    const callback = vi.fn();
    const unsubscribe = api.onInitError(callback);

    expect(callback).toHaveBeenCalledWith('Canonical schema validation failed');
    expect(unsubscribe).toBeTypeOf('function');
  });
});

describe('preload IPC timeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with timeout error when invoke does not respond within default timeout', async () => {
    // Make invoke hang forever
    ipcInvoke.mockReturnValue(new Promise(() => {}));

    const { default: _ } = await import('./preload.cjs');
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      app: { version: () => Promise<string> };
    };

    const promise = api.app.version();
    // Advance past the default 30s timeout
    vi.advanceTimersByTime(30_001);

    await expect(promise).rejects.toThrow(/IPC timeout.*app:version.*30000ms/);
  });

  it('resolves normally when invoke responds before timeout', async () => {
    ipcInvoke.mockResolvedValue('1.0.0');

    await import('./preload.cjs');
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      app: { version: () => Promise<string> };
    };

    const result = await api.app.version();
    expect(result).toBe('1.0.0');
  });
});

describe('preload IPC health check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    ipcInvoke.mockResolvedValue('pong');
  });

  it('exposes ipc.ping through lucidAPI', async () => {
    await import('./preload.cjs');
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      ipc: { ping: () => Promise<'pong'> };
    };

    expect(api.ipc).toBeDefined();
    expect(typeof api.ipc.ping).toBe('function');

    const result = await api.ipc.ping();
    expect(result).toBe('pong');
    expect(ipcInvoke).toHaveBeenCalledWith('ipc:ping');
  });
});
