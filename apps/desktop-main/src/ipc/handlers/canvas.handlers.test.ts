import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

import { registerCanvasHandlers } from './canvas.handlers.js';

describe('registerCanvasHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    handlers = new Map();
    vi.clearAllMocks();
  });

  it('logs canvas saves at debug level', async () => {
    const store = {
      get: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(() => []),
    };

    registerCanvasHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      store as never,
    );

    const saveCanvas = handlers.get('canvas:save');
    expect(saveCanvas).toBeTypeOf('function');

    await saveCanvas?.(
      {},
      {
        id: 'canvas-1',
        name: 'Storyboard',
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        notes: [],
        createdAt: 1,
        updatedAt: 1,
      },
    );

    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'canvas-1',
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith('Canvas saved:', 'canvas-1');
    expect(logger.info).not.toHaveBeenCalledWith('Canvas saved:', 'canvas-1');
  });
});
