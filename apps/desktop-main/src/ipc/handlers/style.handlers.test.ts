import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IpcMain } from 'electron';

describe('style handlers (project-free)', () => {
  let handlers: Map<string, (_e: unknown, args: unknown) => Promise<unknown>>;
  let mockIpcMain: IpcMain;

  beforeEach(async () => {
    vi.resetModules();
    handlers = new Map();
    mockIpcMain = {
      handle: (channel: string, handler: (_e: unknown, args: unknown) => Promise<unknown>) => {
        handlers.set(channel, handler);
      },
    } as unknown as IpcMain;

    const { registerStyleHandlers } = await import('./style.handlers.js');
    registerStyleHandlers(mockIpcMain);
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
      handlers.get('style:save')!(null, { invalid: true })
    ).rejects.toThrow('Invalid style guide payload');
  });

  it('primeStyleGuideCache warms the cache for style:load', async () => {
    const { primeStyleGuideCache } = await import('./style.handlers.js');
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
    primeStyleGuideCache(guide);
    const loaded = await handlers.get('style:load')!(null, undefined);
    expect(loaded).toEqual(guide);
  });

  it('primeStyleGuideCache ignores null', async () => {
    const { primeStyleGuideCache } = await import('./style.handlers.js');
    primeStyleGuideCache(null);
    const loaded = await handlers.get('style:load')!(null, undefined);
    expect(loaded).toMatchObject({
      global: expect.objectContaining({ artStyle: '' }),
    });
  });
});
