import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IpcMain } from 'electron';

function createMockDb() {
  const store = new Map<string, string>();
  return {
    repos: {
      projectSettings: {
        getJson: vi.fn((key: string) => {
          const raw = store.get(key);
          if (raw === undefined) return undefined;
          return JSON.parse(raw);
        }),
        setJson: vi.fn((key: string, value: unknown) => {
          store.set(key, JSON.stringify(value));
        }),
      },
    },
  };
}

describe('style handlers', () => {
  let handlers: Map<string, (_e: unknown, args: unknown) => Promise<unknown>>;
  let mockIpcMain: IpcMain;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    vi.resetModules();
    handlers = new Map();
    mockIpcMain = {
      handle: (channel: string, handler: (_e: unknown, args: unknown) => Promise<unknown>) => {
        handlers.set(channel, handler);
      },
    } as unknown as IpcMain;
    mockDb = createMockDb();

    const { registerStyleHandlers } = await import('./style.handlers.js');
    registerStyleHandlers(mockIpcMain, mockDb as never);
  });

  it('registers style:save and style:load handlers', () => {
    expect([...handlers.keys()].sort()).toEqual(['style:load', 'style:save']);
  });

  it('style:load returns default when no guide saved', async () => {
    const handler = handlers.get('style:load')!;
    const result = await handler(null, undefined);
    expect(result).toMatchObject({
      global: expect.objectContaining({ artStyle: '' }),
      sceneOverrides: {},
    });
  });

  it('style:save persists to project settings', async () => {
    const guide = {
      global: {
        artStyle: 'noir',
        colorPalette: { primary: '#000', secondary: '#fff', forbidden: [] },
        lighting: 'dramatic' as const,
        texture: '',
        referenceImages: [],
        freeformDescription: 'dark',
      },
      sceneOverrides: {},
    };
    await handlers.get('style:save')!(null, guide);
    expect(mockDb.repos.projectSettings.setJson).toHaveBeenCalledWith(
      'styleGuide',
      guide,
    );
  });

  it('style:save then style:load round-trips the guide', async () => {
    const guide = {
      global: {
        artStyle: 'noir',
        colorPalette: { primary: '#000', secondary: '#fff', forbidden: [] },
        lighting: 'dramatic' as const,
        texture: '',
        referenceImages: [],
        freeformDescription: 'dark',
      },
      sceneOverrides: {},
    };
    await handlers.get('style:save')!(null, guide);
    const loaded = await handlers.get('style:load')!(null, undefined);
    expect(loaded).toEqual(guide);
  });

  it('style:save throws on invalid payload', async () => {
    await expect(
      handlers.get('style:save')!(null, { invalid: true }),
    ).rejects.toThrow('Invalid style guide payload');
  });

  it('loadStyleGuide reads from project settings', async () => {
    const { loadStyleGuide } = await import('./style.handlers.js');
    const guide = {
      global: {
        artStyle: 'watercolor',
        colorPalette: { primary: '#abc', secondary: '#def', forbidden: [] },
        lighting: 'natural' as const,
        texture: 'canvas',
        referenceImages: [],
        freeformDescription: '',
      },
      sceneOverrides: {},
    };
    mockDb.repos.projectSettings.setJson('styleGuide', guide);
    const loaded = loadStyleGuide(mockDb as never);
    expect(loaded).toEqual(guide);
  });

  it('loadStyleGuide returns default when DB has no entry', async () => {
    const { loadStyleGuide } = await import('./style.handlers.js');
    const loaded = loadStyleGuide(mockDb as never);
    expect(loaded).toMatchObject({
      global: expect.objectContaining({ artStyle: '' }),
    });
  });
});
