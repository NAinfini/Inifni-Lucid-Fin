import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerScriptHandlers } from './script.handlers.js';

describe('registerScriptHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    handlers = new Map();
  });

  function registerWithDb(existing?: Record<string, unknown>) {
    const get = vi.fn(() => existing);
    const upsert = vi.fn();

    registerScriptHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      {
        repos: {
          scripts: {
            get,
            upsert,
          },
        },
      } as never,
    );

    return { get, upsert };
  }

  it('loads the current script without requiring a request object', async () => {
    const script = {
      id: 'script-1',
      content: 'INT. HOUSE - DAY',
      format: 'fountain',
      parsedScenes: [],
      createdAt: 1,
      updatedAt: 2,
    };
    registerWithDb(script);

    await expect(handlers.get('script:load')?.({})).resolves.toEqual(script);
  });

  it('rejects malformed parse payloads at the typed IPC boundary', async () => {
    registerWithDb();

    await expect(handlers.get('script:parse')?.({}, { content: 42 })).rejects.toThrow(
      'content is required',
    );
  });
});
