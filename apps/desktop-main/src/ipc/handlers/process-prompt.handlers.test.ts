import { describe, expect, it, vi } from 'vitest';
import { registerProcessPromptHandlers } from './process-prompt.handlers.js';

describe('registerProcessPromptHandlers', () => {
  it('registers CRUD handlers backed by the process prompt store', () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const store = {
      list: vi.fn(() => [{ processKey: 'image-node-generation', customValue: null }]),
      get: vi.fn((processKey: string) =>
        processKey === 'image-node-generation'
          ? { processKey, customValue: 'custom', defaultValue: 'default' }
          : null,
      ),
      setCustom: vi.fn(),
      resetToDefault: vi.fn(),
    };

    registerProcessPromptHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      store as never,
    );

    expect(handlers.get('processPrompt:list')?.({}, undefined)).toEqual([
      { processKey: 'image-node-generation', customValue: null },
    ]);
    expect(
      handlers.get('processPrompt:get')?.({}, { processKey: 'image-node-generation' }),
    ).toEqual({
      processKey: 'image-node-generation',
      customValue: 'custom',
      defaultValue: 'default',
    });
    expect(() =>
      handlers.get('processPrompt:get')?.({}, { processKey: 'missing-process' }),
    ).toThrow('Process prompt not found: missing-process');

    expect(
      handlers.get('processPrompt:setCustom')?.(
        {},
        {
          processKey: 'image-node-generation',
          value: 'updated',
        },
      ),
    ).toBeUndefined();
    expect(store.setCustom).toHaveBeenCalledWith('image-node-generation', 'updated');

    expect(
      handlers.get('processPrompt:reset')?.({}, { processKey: 'image-node-generation' }),
    ).toBeUndefined();
    expect(store.resetToDefault).toHaveBeenCalledWith('image-node-generation');
  });
});
