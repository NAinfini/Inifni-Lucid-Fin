import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeGracefulShutdown, waitForRendererFlush } from './graceful-shutdown.js';

describe('waitForRendererFlush', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('subscribes before requesting the flush and resolves on acknowledgement', async () => {
    const order: string[] = [];
    let complete!: () => void;
    const unsubscribe = vi.fn(() => order.push('unsubscribe'));
    const waiting = waitForRendererFlush({
      subscribe: (listener) => {
        order.push('subscribe');
        complete = listener;
        return unsubscribe;
      },
      request: () => order.push('request'),
    });

    complete();
    await waiting;
    expect(order).toEqual(['subscribe', 'request', 'unsubscribe']);
  });

  it('rejects and unsubscribes after the bounded timeout', async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    const waiting = waitForRendererFlush({
      subscribe: () => unsubscribe,
      request: vi.fn(),
      timeoutMs: 5_000,
    });
    const rejected = expect(waiting).rejects.toThrow('timed out after 5000ms');

    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('completeGracefulShutdown', () => {
  it('waits for renderer and OAuth before stopping background tasks and the database', async () => {
    const order: string[] = [];
    const log = { error: vi.fn(), warn: vi.fn() };

    await completeGracefulShutdown({
      flushRenderer: async () => {
        order.push('renderer');
      },
      stopOAuth: async () => {
        order.push('oauth');
      },
      stopBackgroundTasks: () => order.push('background'),
      closeDb: () => order.push('db'),
      log,
    });

    expect(order).toEqual(['renderer', 'oauth', 'background', 'db']);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('logs a renderer timeout but still performs the remaining shutdown steps', async () => {
    const order: string[] = [];
    const log = { error: vi.fn(), warn: vi.fn() };

    await completeGracefulShutdown({
      flushRenderer: async () => {
        throw new Error('timeout');
      },
      stopOAuth: async () => {
        order.push('oauth');
      },
      stopBackgroundTasks: () => order.push('background'),
      closeDb: () => order.push('db'),
      log,
    });

    expect(order).toEqual(['oauth', 'background', 'db']);
    expect(log.error).toHaveBeenCalledWith(
      'Renderer persistence flush failed before shutdown',
      expect.objectContaining({ error: 'timeout' }),
    );
  });
});
