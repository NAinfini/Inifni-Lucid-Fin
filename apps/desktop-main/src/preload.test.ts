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

  it('exposes commander tool discovery methods through lucidAPI', async () => {
    await import('./preload.cjs');

    expect(exposeInMainWorld).toHaveBeenCalledOnce();

    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      commander: {
        toolList?: () => Promise<unknown>;
        toolSearch?: (query?: string) => Promise<unknown>;
      };
    };

    expect(api.commander.toolList).toEqual(expect.any(Function));
    expect(api.commander.toolSearch).toEqual(expect.any(Function));

    await api.commander.toolList?.();
    await api.commander.toolSearch?.('guide');

    expect(ipcInvoke).toHaveBeenNthCalledWith(1, 'commander:tool-list');
    expect(ipcInvoke).toHaveBeenNthCalledWith(2, 'commander:tool-search', { query: 'guide' });
  });

  it('exposes session and snapshot APIs through lucidAPI', async () => {
    await import('./preload.cjs');

    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      session: Record<string, unknown>;
      snapshot: Record<string, unknown>;
    };

    expect(api.session).toBeDefined();
    expect(typeof api.session.upsert).toBe('function');
    expect(typeof api.session.list).toBe('function');
    expect(typeof api.session.get).toBe('function');
    expect(typeof api.session.delete).toBe('function');

    expect(api.snapshot).toBeDefined();
    expect(typeof api.snapshot.capture).toBe('function');
    expect(typeof api.snapshot.list).toBe('function');
    expect(typeof api.snapshot.restore).toBe('function');
    expect(typeof api.snapshot.delete).toBe('function');
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

describe('preload IPC rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    ipcInvoke.mockResolvedValue(undefined);
  });

  it('throws rate limit error when exceeding maxPerSecond for rate-limited channel', async () => {
    await import('./preload.cjs');
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      canvasGeneration: {
        generate: (...args: unknown[]) => Promise<unknown>;
      };
    };

    // canvas:generate has maxPerSecond: 2
    // First two calls should succeed
    await api.canvasGeneration.generate('c1', 'n1');
    await api.canvasGeneration.generate('c1', 'n2');

    // Third call within the same second should throw
    expect(() => api.canvasGeneration.generate('c1', 'n3')).toThrow(/IPC rate limited.*canvas:generate/);
  });

  it('does not rate limit non-limited channels', async () => {
    await import('./preload.cjs');
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      character: { list: () => Promise<unknown> };
    };

    // character:list is not rate limited, many rapid calls should be fine
    for (let i = 0; i < 20; i++) {
      await api.character.list();
    }
    expect(ipcInvoke).toHaveBeenCalledTimes(20);
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
