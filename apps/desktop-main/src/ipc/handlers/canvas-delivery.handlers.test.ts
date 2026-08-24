import { describe, expect, it, vi } from 'vitest';
import { registerCanvasDeliveryHandlers } from './canvas-delivery.handlers.js';

const deliverySequence = {
  revision: 1,
  items: [],
  updatedAt: 10,
};

describe('registerCanvasDeliveryHandlers', () => {
  it('delegates a validated compare-and-set update and refreshes the Canvas cache', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const repository = { updateDeliverySequence: vi.fn(() => deliverySequence) };
    const cache = { replace: vi.fn() };
    registerCanvasDeliveryHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      () => null,
      repository as never,
      cache,
    );

    await expect(
      handlers.get('canvasDelivery:update')?.(
        {},
        { canvasId: 'canvas-1', expectedRevision: 0, deliverySequence },
      ),
    ).resolves.toEqual({ deliverySequence });
    expect(repository.updateDeliverySequence).toHaveBeenCalledWith('canvas-1', 0, deliverySequence);
    expect(cache.replace).toHaveBeenCalledWith('canvas-1', deliverySequence);
  });

  it('rejects revision jumps before calling storage', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const repository = { updateDeliverySequence: vi.fn() };
    registerCanvasDeliveryHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      () => null,
      repository as never,
      { replace: vi.fn() },
    );

    await expect(
      handlers.get('canvasDelivery:update')?.(
        {},
        {
          canvasId: 'canvas-1',
          expectedRevision: 0,
          deliverySequence: { ...deliverySequence, revision: 2 },
        },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(repository.updateDeliverySequence).not.toHaveBeenCalled();
  });
});
