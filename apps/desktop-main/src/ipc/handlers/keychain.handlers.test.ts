import { describe, expect, it, vi } from 'vitest';

vi.mock('../../logger.js', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };

  return {
    default: logger,
    log: vi.fn(),
    debug: logger.debug,
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
    fatal: logger.fatal,
  };
});

import logger from '../../logger.js';
import { registerKeychainHandlers } from './keychain.handlers.js';

describe('registerKeychainHandlers', () => {
  it('applies runtime provider config and logs failed LLM connection tests', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const configure = vi.fn();
    const validate = vi.fn(async () => false);

    registerKeychainHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as Parameters<typeof registerKeychainHandlers>[0],
      {
        getKey: vi.fn(async () => 'sk-test'),
      } as never,
      {
        get: vi.fn(() => undefined),
      } as never,
      {
        list: vi.fn(() => [
          {
            id: 'openai',
            name: 'OpenAI',
            configure,
            validate,
          },
        ]),
      } as never,
    );

    const testConnection = handlers.get('keychain:test');
    expect(testConnection).toBeTypeOf('function');

    const result = await testConnection?.(
      {},
      {
        provider: 'openai',
        providerConfig: {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'http://127.0.0.1:37123/v1',
          model: 'gpt-5.4',
          protocol: 'openai-compatible',
          authStyle: 'bearer',
        },
      },
    );

    expect(configure).toHaveBeenCalledWith(
      'sk-test',
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:37123/v1',
        model: 'gpt-5.4',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
      }),
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('tests custom anthropic providers with anthropic-native validation instead of openai chat completions', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      registerKeychainHandlers(
        {
          handle(channel: string, handler: (...args: unknown[]) => unknown) {
            handlers.set(channel, handler);
          },
        } as Parameters<typeof registerKeychainHandlers>[0],
        {
          getKey: vi.fn(async () => 'sk-anthropic'),
        } as never,
        {
          get: vi.fn(() => undefined),
        } as never,
        {
          list: vi.fn(() => []),
        } as never,
      );

      const testConnection = handlers.get('keychain:test');
      expect(testConnection).toBeTypeOf('function');

      const result = await testConnection?.(
        {},
        {
          provider: 'custom-anthropic',
          providerConfig: {
            id: 'custom-anthropic',
            name: 'Custom Anthropic',
            baseUrl: 'https://api.anthropic.com',
            model: 'claude-sonnet-4-20250514',
            protocol: 'anthropic',
            authStyle: 'x-api-key',
          },
        },
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.anthropic.com/v1/messages');
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'sk-anthropic',
          'anthropic-version': '2023-06-01',
        }),
      });
      expect(result).toEqual(
        expect.objectContaining({
          ok: false,
        }),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Custom provider connection test finished',
        expect.objectContaining({
          providerId: 'custom-anthropic',
          protocol: 'anthropic',
          authStyle: 'x-api-key',
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not route media provider connection tests into the llm registry when the ids overlap', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const llmValidate = vi.fn(async () => true);

    registerKeychainHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as Parameters<typeof registerKeychainHandlers>[0],
      {
        getKey: vi.fn(async () => 'sk-test'),
      } as never,
      {
        get: vi.fn(() => undefined),
      } as never,
      {
        list: vi.fn(() => [
          {
            id: 'together',
            name: 'Together AI',
            configure: vi.fn(),
            validate: llmValidate,
          },
        ]),
      } as never,
    );

    const testConnection = handlers.get('keychain:test');
    expect(testConnection).toBeTypeOf('function');

    const result = await testConnection?.(
      {},
      {
        provider: 'together',
        group: 'image',
        providerConfig: {
          id: 'together',
          name: 'Together AI',
          baseUrl: 'https://api.together.xyz/v1',
          model: 'black-forest-labs/FLUX.1-schnell',
        },
      },
    );

    expect(llmValidate).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error:
        'Direct connection test is not supported for this provider. Try a real generation request.',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'Provider connection test requested for unsupported direct media validation',
      expect.objectContaining({
        providerId: 'together',
        providerGroup: 'image',
      }),
    );
  });
});
