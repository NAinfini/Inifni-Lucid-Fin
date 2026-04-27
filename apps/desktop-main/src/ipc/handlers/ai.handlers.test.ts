import { describe, expect, it, vi } from 'vitest';

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

import { registerAiHandlers } from './ai.handlers.js';

function resetCommon() {
  vi.clearAllMocks();
}

function registerHandlers(options?: {
  agent?: Record<string, unknown> | null;
  promptStore?: Record<string, unknown>;
  pushGateway?: Record<string, unknown>;
}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const promptStore = options?.promptStore ?? {
    list: vi.fn(() => []),
    get: vi.fn(),
    setCustom: vi.fn(),
    clearCustom: vi.fn(),
  };

  registerAiHandlers(
    {
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never,
    () => null,
    (options?.agent ?? null) as never,
    promptStore as never,
    (options?.pushGateway ?? { emit: vi.fn() }) as never,
  );

  return { handlers, promptStore };
}

describe('registerAiHandlers', () => {
  it('registers all AI IPC handlers', () => {
    resetCommon();
    const { handlers } = registerHandlers();

    expect([...handlers.keys()].sort()).toEqual([
      'ai:chat',
      'ai:prompt:clearCustom',
      'ai:prompt:get',
      'ai:prompt:list',
      'ai:prompt:setCustom',
    ]);
  });

  it('rejects malformed chat payloads at the typed IPC boundary', async () => {
    resetCommon();
    const agent = { execute: vi.fn() };
    const { handlers } = registerHandlers({ agent });

    await expect(handlers.get('ai:chat')?.({}, { message: '' })).rejects.toThrow(
      'message is required',
    );

    expect(agent.execute).not.toHaveBeenCalled();
  });

  it('lists prompt templates with historical no-argument invoke compatibility', async () => {
    resetCommon();
    const promptStore = {
      list: vi.fn(() => [
        {
          code: 'writer',
          name: 'Writer',
          type: 'system',
          customValue: null,
        },
      ]),
      get: vi.fn(),
      setCustom: vi.fn(),
      clearCustom: vi.fn(),
    };
    const { handlers } = registerHandlers({ promptStore });

    const result = handlers.get('ai:prompt:list')?.({});

    expect(result).toEqual([
      {
        code: 'writer',
        name: 'Writer',
        type: 'system',
        hasCustom: false,
      },
    ]);
  });

  it('rejects malformed prompt get payloads at the typed IPC boundary', async () => {
    resetCommon();
    const promptStore = {
      list: vi.fn(() => []),
      get: vi.fn(),
      setCustom: vi.fn(),
      clearCustom: vi.fn(),
    };
    const { handlers } = registerHandlers({ promptStore });

    expect(() => handlers.get('ai:prompt:get')?.({}, { code: '' })).toThrow(
      'Prompt not found: ',
    );
  });
});
