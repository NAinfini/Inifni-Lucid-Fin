// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const flushPendingPersistence = vi.hoisted(() => vi.fn());

vi.mock('../store/middleware/persist.js', () => ({ flushPendingPersistence }));

describe('registerFlushOnQuit', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('registers once and acknowledges only after persistence finishes', async () => {
    let finish!: () => void;
    flushPendingPersistence.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    let listener: (() => void) | undefined;
    const api = {
      onFlushBeforeQuit: vi.fn((callback: () => void) => {
        listener = callback;
        return vi.fn();
      }),
      sendFlushComplete: vi.fn(),
    };
    window.lucidAPI = api as never;

    const { registerFlushOnQuit } = await import('./flush-on-quit.js');
    registerFlushOnQuit();
    registerFlushOnQuit();
    expect(api.onFlushBeforeQuit).toHaveBeenCalledOnce();

    listener?.();
    await Promise.resolve();
    expect(api.sendFlushComplete).not.toHaveBeenCalled();

    finish();
    await vi.waitFor(() => expect(api.sendFlushComplete).toHaveBeenCalledOnce());
  });
});
