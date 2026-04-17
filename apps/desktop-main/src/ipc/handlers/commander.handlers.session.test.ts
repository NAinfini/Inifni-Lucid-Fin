import { afterEach, describe, expect, it, vi } from 'vitest';

describe('registerCommanderHandlers session wiring', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('passes the commander sessionId through to snapshot tool registration', async () => {
    const executeMock = vi.fn(async () => undefined);
    const agentConstructor = vi.fn();
    const registerAllToolsMock = vi.fn();
    const requireCanvasMock = vi.fn(() => {
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
    });

    vi.doMock('../../logger.js', () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      };

      return {
        default: logger,
        debug: logger.debug,
        info: logger.info,
        warn: logger.warn,
        error: logger.error,
        fatal: logger.fatal,
      };
    });

    vi.doMock('@lucid-fin/application', () => ({
      AgentOrchestrator: class MockAgentOrchestrator {
        constructor(...args: unknown[]) {
          agentConstructor(...args);
        }

        execute = executeMock;

        compactNow = vi.fn(async () => ({
          freedChars: 0,
          messageCount: 0,
          toolCount: 0,
        }));
      },
      AgentToolRegistry: class MockAgentToolRegistry {},
    }));

    vi.doMock('./commander-tool-deps.js', () => ({
      requireCanvas: requireCanvasMock,
      registerAllTools: registerAllToolsMock,
    }));

    vi.doMock('./commander-emit.js', () => ({
      createEmitHandler: vi.fn(() => vi.fn()),
      formatErrorDetail: vi.fn((error: unknown) =>
        error instanceof Error ? error.message : String(error),
      ),
    }));

    vi.doMock('./commander-meta.handlers.js', () => ({
      registerCommanderMetaHandlers: vi.fn(),
    }));

    const { registerCommanderHandlers } = await import('./commander.handlers.js');

    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const selectedAdapter = {
      id: 'openai',
      name: 'OpenAI',
      profile: {},
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
      } as never,
      () => null,
      {
        adapterRegistry: { list: vi.fn(() => []), get: vi.fn() } as never,
        llmRegistry: { list: vi.fn(() => [selectedAdapter]) } as never,
        canvasStore: { get: vi.fn(() => requireCanvasMock()) } as never,
        presetLibrary: [],
        jobQueue: {} as never,
        workflowEngine: {} as never,
        db: {} as never,
        cas: {} as never,
        keychain: { getKey: vi.fn(async () => 'sk-live') } as never,
        resolvePrompt: vi.fn((code: string) => code),
        resolveProcessPrompt: vi.fn((processKey: string) => `process:${processKey}`),
      },
    );

    const chat = handlers.get('commander:chat');
    expect(chat).toBeTypeOf('function');

    await expect(
      chat?.({}, {
        canvasId: 'canvas-1',
        sessionId: 'session-7',
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

    expect(registerAllToolsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(Function),
      [],
      expect.anything(),
      'session-7',
      undefined,
      expect.anything(),
    );
    expect(agentConstructor).toHaveBeenCalledWith(
      selectedAdapter,
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({
        resolveProcessPrompt: expect.any(Function),
      }),
    );
    const constructorOptions = agentConstructor.mock.calls[0]?.[3] as {
      resolveProcessPrompt: (processKey: string) => string | null;
    };
    expect(constructorOptions.resolveProcessPrompt('image-node-generation')).toBe(
      'process:image-node-generation',
    );
  });
});
