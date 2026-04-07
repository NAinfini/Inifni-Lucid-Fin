import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  customAdapterConfigure,
  customAdapterCompleteWithTools,
  customAdapterInstances,
  buildRuntimeLLMAdapter,
} = vi.hoisted(() => {
  const configure = vi.fn();
  const completeWithTools = vi.fn(async () => {
    throw new Error('Selected provider request failed');
  });
  const instances: Array<Record<string, unknown>> = [];
  const build = vi.fn((cfg: Record<string, unknown>) => {
    instances.push(cfg);
    return {
      id: cfg.id,
      name: cfg.name,
      capabilities: [],
      configure,
      validate: vi.fn(async () => true),
      complete: vi.fn(async () => ''),
      stream: vi.fn(async function* stream() {}),
      completeWithTools,
    };
  });

  return {
    customAdapterConfigure: configure,
    customAdapterCompleteWithTools: completeWithTools,
    customAdapterInstances: instances,
    buildRuntimeLLMAdapter: build,
  };
});

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
    getBufferedLogs: vi.fn(() => []),
  };
});

vi.mock('@lucid-fin/adapters-ai', () => ({
  buildRuntimeLLMAdapter,
  OpenAICompatibleLLM: class MockOpenAICompatibleLLM {
    id: string;
    name: string;

    constructor(cfg: { id: string; name: string }) {
      this.id = cfg.id;
      this.name = cfg.name;
      customAdapterInstances.push({ id: cfg.id, name: cfg.name });
    }

    configure = customAdapterConfigure;
    validate = vi.fn(async () => true);
    complete = vi.fn(async () => '');
    stream = vi.fn(async function* stream() {});
    completeWithTools = customAdapterCompleteWithTools;
  },
}));

import logger from '../../logger.js';
import { registerCommanderHandlers } from './commander.handlers.js';

function makeCanvas() {
  const now = Date.now();
  return {
    id: 'canvas-1',
    projectId: 'project-1',
    name: 'Storyboard',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe('registerCommanderHandlers logging', () => {
  beforeEach(() => {
    customAdapterConfigure.mockClear();
    customAdapterCompleteWithTools.mockClear();
    buildRuntimeLLMAdapter.mockClear();
    customAdapterInstances.length = 0;
  });

  it('logs and streams adapter selection failures for commander:chat', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const send = vi.fn();

    registerCommanderHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as Parameters<typeof registerCommanderHandlers>[0],
      () => ({
        isDestroyed: () => false,
        webContents: { send },
      }) as never,
      {
        adapterRegistry: { list: vi.fn(() => []), get: vi.fn() } as never,
        llmRegistry: { list: vi.fn(() => []) } as never,
        canvasStore: { get: vi.fn(() => makeCanvas()) } as never,
        presetLibrary: [],
        jobQueue: {} as never,
        workflowEngine: {} as never,
        db: {} as never,
        cas: {} as never,
        projectFS: {} as never,
        keychain: { getKey: vi.fn(async () => null) } as never,
        resolvePrompt: vi.fn((code: string) => code),
      },
    );

    const chat = handlers.get('commander:chat');
    expect(chat).toBeTypeOf('function');

    await expect(
      chat?.({}, {
        canvasId: 'canvas-1',
        message: 'hello',
        history: [],
        selectedNodeIds: [],
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        type: 'error',
        error: 'No configured LLM adapter. Please configure an AI provider in Settings.',
      }),
    );
  });

  it('does not validate fallback registry adapters when the selected registered provider fails', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const send = vi.fn();
    const selectedAdapter = {
      id: 'openai',
      name: 'OpenAI',
      capabilities: [],
      configure: vi.fn(),
      validate: vi.fn(async () => true),
      complete: vi.fn(async () => ''),
      stream: vi.fn(async function* stream() {}),
      completeWithTools: vi.fn(async () => {
        throw new Error('Selected provider request failed');
      }),
    };
    const fallbackAdapter = {
      id: 'claude',
      name: 'Claude',
      capabilities: [],
      configure: vi.fn(),
      validate: vi.fn(async () => true),
      complete: vi.fn(async () => ''),
      stream: vi.fn(async function* stream() {}),
      completeWithTools: vi.fn(async () => ''),
    };

    registerCommanderHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as Parameters<typeof registerCommanderHandlers>[0],
      () => ({
        isDestroyed: () => false,
        webContents: { send },
      }) as never,
      {
        adapterRegistry: { list: vi.fn(() => []), get: vi.fn() } as never,
        llmRegistry: { list: vi.fn(() => [selectedAdapter, fallbackAdapter]) } as never,
        canvasStore: { get: vi.fn(() => makeCanvas()) } as never,
        presetLibrary: [],
        jobQueue: {} as never,
        workflowEngine: {} as never,
        db: {} as never,
        cas: {} as never,
        projectFS: {} as never,
        keychain: { getKey: vi.fn(async () => 'sk-live') } as never,
        resolvePrompt: vi.fn((code: string) => code),
      },
    );

    const chat = handlers.get('commander:chat');
    expect(chat).toBeTypeOf('function');

    await expect(
      chat?.({}, {
        canvasId: 'canvas-1',
        message: 'hello',
        history: [],
        selectedNodeIds: [],
        customLLMProvider: {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4.1',
          protocol: 'openai-compatible',
          authStyle: 'bearer',
        },
      }),
    ).resolves.toBeUndefined();

    expect(selectedAdapter.validate).not.toHaveBeenCalled();
    expect(fallbackAdapter.validate).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        type: 'error',
        error: 'Selected provider request failed',
      }),
    );
  });

  it('does not validate registry fallbacks when the selected custom provider fails', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const send = vi.fn();
    const fallbackAdapter = {
      id: 'openai',
      name: 'OpenAI',
      capabilities: [],
      configure: vi.fn(),
      validate: vi.fn(async () => true),
      complete: vi.fn(async () => ''),
      stream: vi.fn(async function* stream() {}),
      completeWithTools: vi.fn(async () => ''),
    };

    registerCommanderHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as Parameters<typeof registerCommanderHandlers>[0],
      () => ({
        isDestroyed: () => false,
        webContents: { send },
      }) as never,
      {
        adapterRegistry: { list: vi.fn(() => []), get: vi.fn() } as never,
        llmRegistry: { list: vi.fn(() => [fallbackAdapter]) } as never,
        canvasStore: { get: vi.fn(() => makeCanvas()) } as never,
        presetLibrary: [],
        jobQueue: {} as never,
        workflowEngine: {} as never,
        db: {} as never,
        cas: {} as never,
        projectFS: {} as never,
        keychain: { getKey: vi.fn(async () => 'sk-local') } as never,
        resolvePrompt: vi.fn((code: string) => code),
      },
    );

    const chat = handlers.get('commander:chat');
    expect(chat).toBeTypeOf('function');

    await expect(
      chat?.({}, {
        canvasId: 'canvas-1',
        message: 'hello',
        history: [],
        selectedNodeIds: [],
        customLLMProvider: {
          id: 'local',
          name: 'Local',
          baseUrl: 'http://127.0.0.1:37123/v1',
          model: 'gpt-5.4',
          protocol: 'anthropic',
          authStyle: 'x-api-key',
        },
      }),
    ).resolves.toBeUndefined();

    expect(buildRuntimeLLMAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'local',
        name: 'Local',
        baseUrl: 'http://127.0.0.1:37123/v1',
        model: 'gpt-5.4',
        protocol: 'anthropic',
        authStyle: 'x-api-key',
      }),
    );
    expect(customAdapterConfigure).toHaveBeenCalledWith('sk-local', {
      baseUrl: 'http://127.0.0.1:37123/v1',
      model: 'gpt-5.4',
    });
    expect(customAdapterCompleteWithTools).toHaveBeenCalled();
    expect(fallbackAdapter.validate).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        type: 'error',
        error: 'Selected provider request failed',
      }),
    );
  });

  it('logs session completion with response length when commander returns assistant content', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const send = vi.fn();
    customAdapterCompleteWithTools.mockResolvedValueOnce({
      content: 'hello from commander',
      toolCalls: [],
      finishReason: 'stop',
    });

    registerCommanderHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as Parameters<typeof registerCommanderHandlers>[0],
      () => ({
        isDestroyed: () => false,
        webContents: { send },
      }) as never,
      {
        adapterRegistry: { list: vi.fn(() => []), get: vi.fn() } as never,
        llmRegistry: { list: vi.fn(() => []) } as never,
        canvasStore: { get: vi.fn(() => makeCanvas()) } as never,
        presetLibrary: [],
        jobQueue: {} as never,
        workflowEngine: {} as never,
        db: {} as never,
        cas: {} as never,
        projectFS: {} as never,
        keychain: { getKey: vi.fn(async () => 'sk-local') } as never,
        resolvePrompt: vi.fn((code: string) => code),
      },
    );

    const chat = handlers.get('commander:chat');
    expect(chat).toBeTypeOf('function');

    await expect(
      chat?.({}, {
        canvasId: 'canvas-1',
        message: 'hello',
        history: [],
        selectedNodeIds: [],
        customLLMProvider: {
          id: 'local',
          name: 'Local',
          baseUrl: 'http://127.0.0.1:37123/v1',
          model: 'gpt-5.4',
          protocol: 'openai-compatible',
          authStyle: 'bearer',
        },
      }),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        type: 'done',
        content: 'hello from commander',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Session complete',
      expect.objectContaining({
        category: 'commander',
        canvasId: 'canvas-1',
        responseChars: 'hello from commander'.length,
        hasContent: true,
      }),
    );
  });
});
