import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { AgentToolRegistry } from './tool-registry.js';
import type { LLMAdapter, LLMCompletionResult } from '@lucid-fin/contracts';

function createMockAdapter(responses: LLMCompletionResult[]): LLMAdapter {
  let callIdx = 0;
  return {
    id: 'mock',
    name: 'Mock LLM',
    capabilities: ['text-generation'],
    configure: vi.fn(),
    validate: vi.fn(async () => true),
    complete: vi.fn(async () => responses[0]?.content ?? ''),
    stream: vi.fn(async function* () {
      yield responses[0]?.content ?? '';
    }),
    completeWithTools: vi.fn(async () => {
      const r = responses[Math.min(callIdx, responses.length - 1)];
      callIdx++;
      return r;
    }),
  };
}

const resolvePrompt = () => 'You are a test assistant.';

describe('AgentOrchestrator', () => {
  let toolRegistry: AgentToolRegistry;

  beforeEach(() => {
    toolRegistry = new AgentToolRegistry();
  });

  it('returns text response when no tools called', async () => {
    const adapter = createMockAdapter([{ content: 'Hello!', toolCalls: [], finishReason: 'stop' }]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

    const events: unknown[] = [];
    const result = await agent.execute('Hi', {}, (e) => events.push(e));

    expect(result.content).toBe('Hello!');
    expect(result.toolCalls).toHaveLength(0);
    expect(events.some((e: unknown) => (e as Record<string, unknown>).type === 'done')).toBe(true);
    expect(
      events.some(
        (e: unknown) =>
          (e as Record<string, unknown>).type === 'stream_chunk' &&
          (e as Record<string, unknown>).content === 'Hello!',
      ),
    ).toBe(true);
  });

  it('executes tool calls and feeds results back', async () => {
    const mockTool = vi.fn(async () => ({ success: true, data: { count: 5 } }));
    toolRegistry.register({
      name: 'character.list',
      description: 'List characters',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: mockTool,
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'character.list', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'Found 5 characters.',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    const events: unknown[] = [];
    const result = await agent.execute('List characters', {}, (e) => events.push(e));

    expect(mockTool).toHaveBeenCalled();
    expect(result.content).toBe('Found 5 characters.');
    expect(events.some((e: unknown) => (e as Record<string, unknown>).type === 'tool_call')).toBe(true);
    expect(events.some((e: unknown) => (e as Record<string, unknown>).type === 'tool_result')).toBe(true);
  });

  it('handles tool execution errors gracefully', async () => {
    toolRegistry.register({
      name: 'error.tool',
      description: 'fail',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'error.tool', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'Tool failed, sorry.',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    const events: unknown[] = [];
    const result = await agent.execute('do error', {}, (e) => events.push(e));

    expect(result.content).toBe('Tool failed, sorry.');
    expect(events.some((e: unknown) => (e as Record<string, unknown>).type === 'error' && (e as Record<string, unknown>).error === 'boom')).toBe(true);
  });

  it('respects maxSteps limit', async () => {
    toolRegistry.register({
      name: 'loop.tool',
      description: 'loop',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: 'loop' })),
    });

    // Always returns tool_calls — infinite loop
    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'loop.tool', arguments: {} }],
        finishReason: 'tool_calls',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, { maxSteps: 3 });
    await agent.execute('loop', {}, () => {});

    expect((adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it('includes context in system prompt', async () => {
    const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('test', { page: 'script-editor', sceneId: 'sc-1' }, () => {});

    const call = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages = call[0] as Array<{ role: string; content: string }>;
    const systemMsg = messages.find((m) => m.role === 'system')!;
    expect(systemMsg.content).toContain('script-editor');
    expect(systemMsg.content).toContain('sc-1');
  });

  it('filters tools by context page', async () => {
    toolRegistry.register({
      name: 'script.only',
      description: 'script tool',
      context: ['script-editor'],
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });
    toolRegistry.register({
      name: 'global.tool',
      description: 'global',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });

    const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('test', { page: 'orchestrator' }, () => {});

    const call = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0];
    const opts = call[1];
    // script.only must not appear (excluded by context filter for page='orchestrator')
    const toolNames = (opts.tools as Array<{ name: string }> | undefined)?.map((t) => t.name) ?? [];
    expect(toolNames).not.toContain('script.only');
  });

  it('compacts tool definitions before sending them to the LLM', async () => {
    toolRegistry.register({
      name: 'canvas.addNode',
      description: 'Add a new node to the current canvas at a specific position with very verbose explanation text.',
      parameters: {
        type: 'object',
        properties: {
          canvasId: {
            type: 'string',
            description: 'The target canvas identifier with extra explanatory prose that should not be forwarded verbatim.',
          },
          position: {
            type: 'object',
            description: 'The desired node coordinates on the canvas surface.',
            properties: {
              x: {
                type: 'number',
                description: 'Horizontal coordinate with long explanation.',
              },
              y: {
                type: 'number',
                description: 'Vertical coordinate with long explanation.',
              },
            },
          },
        },
        required: ['canvasId', 'position'],
      },
      execute: vi.fn(async () => ({ success: true, data: { id: 'node-1' } })),
    });

    const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('add node', { page: 'canvas' }, () => {});

    const opts = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      tools: Array<Record<string, unknown>>;
    };
    const tool = opts.tools[0] as {
      description?: string;
      parameters: {
        properties: Record<string, Record<string, unknown>>;
      };
    };

    expect(tool.description).toBe('Add a new node to the current canvas at a specific position with very verbose explanation text.');
    expect(tool.parameters.properties.canvasId?.description).toBe('');
    expect(tool.parameters.properties.position?.description).toBe('');
    expect((tool.parameters.properties.position?.properties as Record<string, Record<string, unknown>>).x?.description).toBe('');
    expect((tool.parameters.properties.position?.properties as Record<string, Record<string, unknown>>).y?.description).toBe('');
  });

  it('injects history into the LLM message list', async () => {
    const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute(
      'latest',
      { page: 'canvas' },
      () => {},
      {
        history: [
          { role: 'user', content: 'older user message' },
          { role: 'assistant', content: 'older assistant message' },
        ],
      },
    );

    const messages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    const roles = messages.map((entry) => entry.role);
    expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    const systemMsg = messages.find((m) => m.role === 'system')!;
    expect(systemMsg.content).toContain('canvas');
    expect(systemMsg.content).toContain('Current page: canvas');
    const userMessages = messages.filter((m) => m.role === 'user');
    expect(userMessages[0]?.content).toBe('older user message');
    expect(userMessages[1]?.content).toBe('latest');
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.content).toBe('older assistant message');
  });

  it('prunes older history entries once the estimated token budget is exceeded', async () => {
    const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute(
      'latest',
      { page: 'canvas' },
      () => {},
      {
        history: [
          { role: 'user', content: 'A'.repeat(10000) },
          { role: 'assistant', content: 'B'.repeat(10000) },
          { role: 'user', content: 'C'.repeat(10000) },
          { role: 'assistant', content: 'D'.repeat(10000) },
        ],
      },
    );

    const messages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;

    expect(messages.map((entry) => `${entry.role}:${entry.content.slice(0, 1)}`)).toEqual([
      'system:Y',
      'user:A',
      'assistant:B',
      'user:C',
      'assistant:D',
      'user:l',
    ]);
  });

  it('stops execution when aborted before a loop iteration', async () => {
    const adapter = createMockAdapter([{ content: 'never', toolCalls: [], finishReason: 'stop' }]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    const events: unknown[] = [];

    const result = await agent.execute(
      'stop',
      {},
      (event) => events.push(event),
      { isAborted: () => true },
    );

    expect(result.content).toBe('Cancelled.');
    expect((adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(events.at(-1)).toEqual({ type: 'done', content: 'Cancelled.' });
  });

  it('does not require confirmation for untiered tools in normal mode', async () => {
    const execute = vi.fn(async () => ({ success: true, data: { id: 'char-1' } }));
    toolRegistry.register({
      name: 'character.get',
      description: 'Get a character',
      parameters: { type: 'object', properties: {}, required: [] },
      execute,
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-untiered', name: 'character.get', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'done',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    const events: Array<Record<string, unknown>> = [];
    await agent.execute(
      'fetch character',
      {},
      (event) => {
        const record = event as unknown as Record<string, unknown>;
        events.push(record);
        if (record.type === 'tool_confirm' && typeof record.toolCallId === 'string') {
          agent.confirmTool(record.toolCallId, true);
        }
      },
      { permissionMode: 'normal' },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === 'tool_confirm')).toBe(false);
  });

  it('injects steering messages into the next LLM iteration', async () => {
    toolRegistry.register({
      name: 'canvas.searchNodes',
      description: 'List nodes',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => {
        (agent as unknown as { injectMessage?: (content: string) => void }).injectMessage?.('Focus on node n-2');
        return {
          success: true,
          data: [{ id: 'n-1', title: 'Opening Shot' }],
        };
      }),
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-inject', name: 'canvas.searchNodes', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'updated plan',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('list nodes', {}, () => {});

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[1][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'Focus on node n-2' }),
      ]),
    );
  });

  it('summarizes large tool results before adding them to LLM context', async () => {
    toolRegistry.register({
      name: 'character.list',
      description: 'List characters',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({
        success: true,
        data: [
          {
            id: 'char-1',
            name: 'Astra',
            title: 'Captain Astra',
            biography: 'Very long hidden details that should not be forwarded to the model. '.repeat(24),
          },
        ],
      })),
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-summary', name: 'character.list', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'summary ready',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('list characters', {}, () => {});

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[1][0] as Array<{
      role: string;
      content: string;
    }>;
    const toolMessage = secondCallMessages.find((message) => message.role === 'tool');

    expect(toolMessage?.content).toContain('char-1');
    expect(toolMessage?.content).toContain('Astra');
    expect(toolMessage?.content).not.toContain('Very long hidden details');
  });

  it('preserves node titles when summarizing large mutation results', async () => {
    toolRegistry.register({
      name: 'canvas.setNodeProvider',
      description: 'Set node provider',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({
        success: true,
        data: {
          nodeId: 'node-1',
          nodeTitle: 'Opening Shot',
          status: 'done',
          providerId: 'replicate',
          details: 'Hidden verbose result '.repeat(80),
        },
      })),
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-mutation-summary', name: 'canvas.setNodeProvider', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'node updated',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('set provider', {}, () => {});

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[1][0] as Array<{
      role: string;
      content: string;
    }>;
    const toolMessage = secondCallMessages.find((message) => message.role === 'tool');

    expect(toolMessage?.content).toContain('node-1');
    expect(toolMessage?.content).toContain('Opening Shot');
    expect(toolMessage?.content).not.toContain('Hidden verbose result');
  });

  it('truncates oversized context.extra values before adding them to the system prompt', async () => {
    const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

    await agent.execute(
      'test',
      {
        page: 'canvas',
        extra: {
          largeString: `${'S'.repeat(2500)}TAIL-STRING`,
          largeObject: { details: `${'O'.repeat(5000)}TAIL-OBJECT` },
        },
      },
      () => {},
    );

    const messages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    const systemMsg = messages.find((message) => message.role === 'system');
    const largeStringLine = systemMsg?.content.split('\n').find((line) => line.startsWith('largeString: '));
    const largeObjectLine = systemMsg?.content.split('\n').find((line) => line.startsWith('largeObject: '));

    expect(largeStringLine).toBeDefined();
    expect(largeObjectLine).toBeDefined();
    expect(largeStringLine?.length).toBeLessThanOrEqual('largeString: '.length + 2000);
    expect(largeObjectLine?.length).toBeLessThanOrEqual('largeObject: '.length + 2000);
    expect(systemMsg?.content).not.toContain('TAIL-STRING');
    expect(systemMsg?.content).not.toContain('TAIL-OBJECT');
  });

  it('caps summarized collection payloads to a total item budget', async () => {
    toolRegistry.register({
      name: 'character.list',
      description: 'List characters',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({
        success: true,
        data: Array.from({ length: 10 }, (_, index) => ({
          alpha: `alpha-${index}-${'x'.repeat(500)}`,
          beta: `beta-${index}-${'y'.repeat(500)}`,
          gamma: `gamma-${index}-${'z'.repeat(500)}`,
          delta: `delta-${index}-${'q'.repeat(500)}`,
          epsilon: `epsilon-${index}-${'w'.repeat(500)}`,
          zeta: `zeta-${index}-${'e'.repeat(500)}`,
        })),
      })),
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-collection-cap', name: 'character.list', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'summary ready',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('list characters', {}, () => {});

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[1][0] as Array<{
      role: string;
      content: string;
    }>;
    const toolMessage = secondCallMessages.find((message) => message.role === 'tool');
    const parsed = JSON.parse(toolMessage?.content ?? '{}') as {
      success?: boolean;
      data?: { count?: number; items?: unknown[] };
    };

    expect(parsed.success).toBe(true);
    expect(parsed.data?.count).toBe(10);
    expect(parsed.data?.items?.length).toBeLessThan(10);
  });

  it('loads domain-relevant tools and expands discovered tools after tool.search', async () => {
    const searchExecute = vi.fn(async () => ({
      success: true,
      data: [
        {
          name: 'character.list',
          description: 'Search characters',
          tags: ['character', 'read', 'search'],
        },
      ],
    }));

    toolRegistry.register({
      name: 'tool.search',
      description: 'Search available tools',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: searchExecute,
    });
    toolRegistry.register({
      name: 'guide.list',
      description: 'List prompt guides',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: [] })),
    });
    toolRegistry.register({
      name: 'guide.get',
      description: 'Get prompt guide content',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: null })),
    });
    toolRegistry.register({
      name: 'commander.askUser',
      description: 'Ask the user a question',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: null })),
    });
    toolRegistry.register({
      name: 'character.list',
      description: 'Search characters',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: [] })),
    });
    toolRegistry.register({
      name: 'character.delete',
      description: 'Delete a character',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true })),
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-discover', name: 'tool.search', arguments: { query: 'character' } }],
        finishReason: 'tool_calls',
      },
      {
        content: 'ready',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('find character tools', { page: 'canvas' }, () => {});

    const firstOpts = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      tools: Array<{ name: string }>;
    };
    const secondOpts = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[1][1] as {
      tools: Array<{ name: string }>;
    };

    // With domain detection (canvas page + 'character' keyword), all 6 registered tools
    // are included in the first call (ALWAYS_LOADED + entity prefix match).
    // After tool.search returns character.list, it is added to discoveredToolNames (already present).
    const allToolNames = [
      'tool.search',
      'guide.list',
      'guide.get',
      'commander.askUser',
      'character.list',
      'character.delete',
    ];
    expect(firstOpts.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(allToolNames),
    );
    expect(secondOpts.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(allToolNames),
    );
  });
});
