import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

const getCurrentProjectId = vi.hoisted(() => vi.fn(() => 'project-1'));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

vi.mock('../project-context.js', () => ({
  getCurrentProjectId,
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
      listForProject: vi.fn(() => []),
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

    await saveCanvas?.({}, {
      id: 'canvas-1',
      projectId: 'old-project',
      name: 'Storyboard',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: 1,
      updatedAt: 1,
    });

    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'canvas-1',
        projectId: 'project-1',
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith('Canvas saved:', 'canvas-1');
    expect(logger.info).not.toHaveBeenCalledWith('Canvas saved:', 'canvas-1');
  });
});
