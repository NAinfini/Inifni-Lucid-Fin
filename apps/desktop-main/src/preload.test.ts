import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    await import('./preload.js');

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
});
