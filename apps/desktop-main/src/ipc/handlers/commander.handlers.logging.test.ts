import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    scoped: vi.fn(),
  };
  logger.scoped.mockReturnValue(logger);

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
import { AgentOrchestrator } from '@lucid-fin/application';
import { runningSessions } from './commander-registry.js';
import { registerCommanderHandlers } from './commander.handlers.js';

function makeCanvas() {
  const now = Date.now();
  return {
    id: 'canvas-1',
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
    runningSessions.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    runningSessions.clear();
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

    expect(logger.error).toHaveBeenCalledWith(
      'Commander chat failed',
      expect.objectContaining({
        category: 'commander',
        canvasId: 'canvas-1',
        selectedNodeCount: 0,
        historyCount: 0,
      }),
    );
    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        event: expect.objectContaining({
          kind: 'assistant_text',
          content: 'No configured LLM adapter. Please configure an AI provider in Settings.',
        }),
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
          model: 'gpt-5.4',
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
        event: expect.objectContaining({
          kind: 'assistant_text',
          content: 'Selected provider request failed',
        }),
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
        event: expect.objectContaining({
          kind: 'assistant_text',
          content: 'Selected provider request failed',
        }),
      }),
    );
  });

  it('warns and streams when the selected provider is missing runtime connection fields', async () => {
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
          baseUrl: '',
          model: '',
          protocol: 'openai-compatible',
          authStyle: 'bearer',
        },
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      'Selected LLM provider is missing runtime connection fields',
      expect.objectContaining({
        category: 'provider',
        providerId: 'openai',
        providerName: 'OpenAI',
        baseUrl: '',
        model: '',
      }),
    );
    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        event: expect.objectContaining({
          kind: 'assistant_text',
          content: 'Selected LLM provider "OpenAI" is missing a base URL or model.',
        }),
      }),
    );
  });

  it('warns and streams when the selected provider requires an API key but none is stored', async () => {
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
        customLLMProvider: {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
          protocol: 'openai-compatible',
          authStyle: 'bearer',
        },
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      'Selected LLM provider has no stored API key',
      expect.objectContaining({
        category: 'provider',
        providerId: 'openai',
        providerName: 'OpenAI',
        source: 'selected-custom-provider',
      }),
    );
    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        event: expect.objectContaining({
          kind: 'assistant_text',
          content: 'Selected LLM provider "OpenAI" has no API key configured.',
        }),
      }),
    );
  });

  it('rejects a second commander session while another session is active', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();

    registerCommanderHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as Parameters<typeof registerCommanderHandlers>[0],
      () => null,
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

    runningSessions.set('canvas-1', { aborted: false, canvasId: 'canvas-1' });

    const chat = handlers.get('commander:chat');
    await expect(
      chat?.({}, {
        canvasId: 'canvas-1',
        message: 'hello',
        history: [],
        selectedNodeIds: [],
      }),
    ).rejects.toThrow('Commander already has an active session');
  });

  it('rejects invalid commander chat payloads before session setup', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();

    registerCommanderHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as Parameters<typeof registerCommanderHandlers>[0],
      () => null,
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

    await expect(chat?.({}, null as never)).rejects.toThrow('canvasId is required');
    await expect(
      chat?.({}, {
        canvasId: 'canvas-1',
        message: 'hello',
        history: 'bad-history',
        selectedNodeIds: [],
      }),
    ).rejects.toThrow('history must be an array');
    await expect(
      chat?.({}, {
        canvasId: 'canvas-1',
        message: 'hello',
        history: [],
        selectedNodeIds: 'bad-selected',
      }),
    ).rejects.toThrow('selectedNodeIds must be an array');
    await expect(
      chat?.({}, {
        canvasId: 'canvas-1',
        message: 'hello',
        history: [{ role: 'system', content: 'bad' }],
        selectedNodeIds: [],
      }),
    ).rejects.toThrow('history entries must contain a valid role and content');
  });

  it('logs session completion with response length when commander returns assistant content', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const send = vi.fn();
    async function* responseStream() {
      yield { kind: 'text_delta', delta: 'hello from commander' };
      yield { kind: 'finished', finishReason: 'stop' };
    }
    customAdapterCompleteWithTools.mockResolvedValueOnce(responseStream());

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
        event: expect.objectContaining({
          kind: 'assistant_text',
          content: 'hello from commander',
        }),
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Session complete',
      expect.objectContaining({
        category: 'commander',
        canvasId: 'canvas-1',
      }),
    );
  });

  it('streams orchestrator events and emits canvas/entity refresh payloads for mutating tool results', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const send = vi.fn();
    const canvas = makeCanvas();
    vi.spyOn(AgentOrchestrator.prototype, 'execute').mockImplementationOnce(
      async (_message, _context, rawEmit, options) => {
        let seq = 0;
        const emit = (body: Record<string, unknown>) =>
          rawEmit({ ...body, runId: 'run-test', step: 1, seq: seq++, emittedAt: Date.now() } as never);
        options?.onLLMRequest?.({
          step: 1,
          toolCount: 4,
          toolSchemaChars: 1200,
          messageCount: 2,
          messageChars: 32,
          systemPromptChars: 128,
          promptGuideChars: 0,
          estimatedTokensUsed: 100,
          contextWindowTokens: 8192,
          cacheChars: 0,
          cacheEntryCount: 0,
          utilizationRatio: 0.01,
        });

        emit({
          kind: 'assistant_text',
          content: 'partial response',
          isDelta: true,
        });
        emit({
          kind: 'tool_call',
          toolCallId: 'call-1',
          toolRef: { domain: 'canvas', action: 'addNode' },
          args: { canvasId: 'canvas-1', nodeId: 'node-1' },
        });
        emit({
          kind: 'tool_result',
          toolCallId: 'call-1',
          result: { ok: true },
          durationMs: 10,
        });
        emit({
          kind: 'tool_confirm_prompt',
          toolCallId: 'call-2',
          toolRef: { domain: 'character', action: 'create' },
          args: { name: 'Hero' },
          tier: 3,
        });
        emit({
          kind: 'question_prompt',
          questionId: 'q-1',
          prompt: 'Continue?',
          options: [{ id: 'yes', label: 'Yes' }],
          allowFreeText: false,
        });
        emit({
          kind: 'tool_call',
          toolCallId: 'call-4',
          toolRef: { domain: 'character', action: 'create' },
          args: { name: 'Hero' },
        });
        emit({
          kind: 'tool_result',
          toolCallId: 'call-4',
          result: { id: 'char-1' },
          durationMs: 9,
        });
        emit({
          kind: 'tool_call',
          toolCallId: 'call-5',
          toolRef: { domain: 'character', action: 'explode' },
          args: {},
        });
        emit({
          kind: 'tool_result',
          toolCallId: 'call-5',
          error: { code: 'TOOL_RUNTIME', params: { message: 'Tool exploded' } },
          durationMs: 1,
        });
        emit({
          kind: 'assistant_text',
          content: 'assistant response',
          isDelta: false,
        });
        emit({
          kind: 'run_end',
          status: 'completed',
        });
        return { content: 'assistant response', toolCalls: [], finishReason: 'stop' } as never;
      },
    );

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
        canvasStore: { get: vi.fn(() => canvas) } as never,
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
        customLLMProvider: {
          id: 'local',
          name: 'Local',
          baseUrl: 'http://127.0.0.1:37123/v1',
          model: 'gpt-5.4',
          protocol: 'openai-compatible',
          authStyle: 'none',
        },
      }),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        event: expect.objectContaining({
          kind: 'assistant_text',
          content: 'partial response',
        }),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        event: expect.objectContaining({
          kind: 'tool_call',
          toolCallId: 'call-1',
          toolRef: { domain: 'canvas', action: 'addNode' },
        }),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        event: expect.objectContaining({
          kind: 'tool_result',
          toolCallId: 'call-1',
          result: { ok: true },
        }),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        event: expect.objectContaining({
          kind: 'tool_confirm_prompt',
          toolCallId: 'call-2',
          tier: 3,
        }),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        event: expect.objectContaining({
          kind: 'question_prompt',
          questionId: 'q-1',
          prompt: 'Continue?',
        }),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        event: expect.objectContaining({
          kind: 'tool_result',
          toolCallId: 'call-5',
          error: expect.objectContaining({
            params: expect.objectContaining({ message: 'Tool exploded' }),
          }),
        }),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      'commander:canvas:dispatch',
      expect.objectContaining({
        canvasId: 'canvas-1',
        canvas,
      }),
    );
    expect(send).toHaveBeenCalledWith(
      'commander:entities:updated',
      expect.objectContaining({
        toolName: 'character.create',
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'Commander LLM request prepared',
      expect.objectContaining({
        category: 'commander',
        canvasId: 'canvas-1',
        toolCount: 4,
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'Tool: canvas.addNode',
      expect.objectContaining({
        category: 'commander',
        toolName: 'canvas.addNode',
        toolCallId: 'call-1',
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      'Result: canvas.addNode',
      expect.objectContaining({
        category: 'commander',
        toolName: 'canvas.addNode',
        toolCallId: 'call-1',
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'TOOL_RUNTIME',
      expect.objectContaining({
        category: 'commander',
        toolCallId: 'call-5',
      }),
    );

  });

  it('cleans up the running commander session when orchestrator execution fails', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const send = vi.fn();

    vi
      .spyOn(AgentOrchestrator.prototype, 'execute')
      .mockRejectedValueOnce(new Error('LLM transport failed'));

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
          authStyle: 'none',
        },
      }),
    ).resolves.toBeUndefined();

    expect(runningSessions.size).toBe(0);
    expect(send).toHaveBeenCalledWith(
      'commander:stream',
      expect.objectContaining({
        event: expect.objectContaining({
          kind: 'assistant_text',
          content: 'LLM transport failed',
        }),
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Commander chat failed',
      expect.objectContaining({
        category: 'commander',
        canvasId: 'canvas-1',
      }),
    );
  });

  it('does not emit commander stream payloads when the main window is unavailable', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();

    vi
      .spyOn(AgentOrchestrator.prototype, 'execute')
      .mockImplementationOnce(async (_message, _context, rawEmit) => {
        let seq = 0;
        const emit = (body: Record<string, unknown>) =>
          rawEmit({ ...body, runId: 'run-test', step: 1, seq: seq++, emittedAt: Date.now() } as never);
        emit({
          kind: 'assistant_text',
          content: 'assistant response',
          isDelta: false,
        });
        emit({
          kind: 'run_end',
          status: 'completed',
        });
        return { content: 'assistant response', toolCalls: [], finishReason: 'stop' } as never;
      });

    registerCommanderHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as Parameters<typeof registerCommanderHandlers>[0],
      () => null,
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
          authStyle: 'none',
        },
      }),
    ).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith(
      'Session complete',
      expect.objectContaining({
        category: 'commander',
        canvasId: 'canvas-1',
      }),
    );
  });
});
