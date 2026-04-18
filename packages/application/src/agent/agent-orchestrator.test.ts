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
    const result = await agent.execute('List characters', {}, (e) => events.push(e), {
      discoveredTools: ['character.list'],
    });

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
    const result = await agent.execute('do error', {}, (e) => events.push(e), {
      discoveredTools: ['error.tool'],
    });

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
    await agent.execute('loop', {}, () => {}, {
      discoveredTools: ['loop.tool'],
    });

    expect((adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it('includes context in system prompt', async () => {
    const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('test', { page: 'script-editor', extra: { sceneId: 'sc-1' } }, () => {});

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
    await agent.execute('add node', { page: 'canvas' }, () => {}, {
      discoveredTools: ['canvas.addNode'],
    });

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
      { permissionMode: 'normal', discoveredTools: ['character.get'] },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type === 'tool_confirm')).toBe(false);
  });

  it('injects steering messages into the next LLM iteration', async () => {
    toolRegistry.register({
      name: 'canvas.listNodes',
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
        toolCalls: [{ id: 'tc-inject', name: 'canvas.listNodes', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'updated plan',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('list nodes', {}, () => {}, {
      discoveredTools: ['canvas.listNodes'],
    });

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

  it('preserves tool results under the hard limit without truncation', async () => {
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
            biography: 'Detailed biography content that should be preserved in full. '.repeat(10),
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
    await agent.execute('list characters', {}, () => {}, {
      discoveredTools: ['character.list'],
    });

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[1][0] as Array<{
      role: string;
      content: string;
    }>;
    const toolMessage = secondCallMessages.find((message) => message.role === 'tool');

    expect(toolMessage?.content).toContain('char-1');
    expect(toolMessage?.content).toContain('Astra');
    // Under RESULT_HARD_LIMIT — content preserved in full
    expect(toolMessage?.content).toContain('Detailed biography content');
  });

  it('preserves mutation results under hard limit and trims oversized ones', async () => {
    // Generate a mutation result that exceeds RESULT_HARD_LIMIT (20000 chars)
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
          details: 'Verbose result '.repeat(1500), // ~22500 chars → over hard limit
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
    await agent.execute('set provider', {}, () => {}, {
      discoveredTools: ['canvas.setNodeProvider'],
    });

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[1][0] as Array<{
      role: string;
      content: string;
    }>;
    const toolMessage = secondCallMessages.find((message) => message.role === 'tool');

    // Key identifiers preserved
    expect(toolMessage?.content).toContain('node-1');
    expect(toolMessage?.content).toContain('Opening Shot');
    // Over hard limit → mutation summarizer extracts only key fields, dropping verbose details
    expect(toolMessage?.content.length).toBeLessThan(500);
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

  it('trims long strings in results exceeding the hard limit', async () => {
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
    await agent.execute('list characters', {}, () => {}, {
      discoveredTools: ['character.list'],
    });

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[1][0] as Array<{
      role: string;
      content: string;
    }>;
    const toolMessage = secondCallMessages.find((message) => message.role === 'tool');
    const parsed = JSON.parse(toolMessage?.content ?? '{}') as {
      success?: boolean;
      data?: Array<Record<string, string>>;
    };

    expect(parsed.success).toBe(true);
    // All 10 items preserved (no item dropping — pagination is the tool's job)
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data?.length).toBe(10);
    // But long strings are trimmed (300 char limit + "...")
    const firstAlpha = parsed.data?.[0]?.alpha ?? '';
    expect(firstAlpha.length).toBeLessThan(500);
    expect(firstAlpha).toContain('...');
  });

  it('loads only always-loaded tools initially and expands via tool.get', async () => {
    // Register always-loaded tools
    toolRegistry.register({
      name: 'tool.list',
      description: 'List tools',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: {} })),
    });
    toolRegistry.register({
      name: 'tool.get',
      description: 'Get tool schema',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({
        success: true,
        data: { name: 'character.list', description: 'List characters', parameters: { type: 'object', properties: {}, required: [] } },
      })),
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
      name: 'canvas.getState',
      description: 'Get canvas state',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: {} })),
    });
    toolRegistry.register({
      name: 'canvas.listNodes',
      description: 'List canvas nodes',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: [] })),
    });
    toolRegistry.register({
      name: 'canvas.getNode',
      description: 'Get a canvas node',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: null })),
    });

    // Register a tool that is NOT always-loaded
    toolRegistry.register({
      name: 'character.list',
      description: 'List characters',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: [] })),
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-get', name: 'tool.get', arguments: { names: 'character.list' } }],
        finishReason: 'tool_calls',
      },
      {
        content: '',
        toolCalls: [{ id: 'tc-use', name: 'character.list', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'done',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('list characters', { page: 'canvas' }, () => {});

    // First call: only always-loaded tools (8)
    const firstOpts = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      tools: Array<{ name: string }>;
    };
    const firstToolNames = firstOpts.tools.map((t) => t.name);
    expect(firstToolNames).not.toContain('character.list');
    expect(firstToolNames).toContain('tool.list');
    expect(firstToolNames).toContain('tool.get');
    expect(firstToolNames).toContain('canvas.getState');
    expect(firstToolNames.length).toBe(8);

    // Second call: character.list now available after tool.get
    const secondOpts = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[1][1] as {
      tools: Array<{ name: string }>;
    };
    expect(secondOpts.tools.map((t) => t.name)).toContain('character.list');
  });

  it('returns error when calling an unloaded tool', async () => {
    toolRegistry.register({
      name: 'tool.list',
      description: 'List tools',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: {} })),
    });
    toolRegistry.register({
      name: 'tool.get',
      description: 'Get tool schema',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: null })),
    });
    toolRegistry.register({
      name: 'character.list',
      description: 'List characters',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: [] })),
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-blocked', name: 'character.list', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'understood',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    const events: Array<Record<string, unknown>> = [];
    await agent.execute('list characters', {}, (e) => events.push(e as unknown as Record<string, unknown>));

    // Tool should NOT have been executed
    expect(toolRegistry.get('character.list')!.execute).not.toHaveBeenCalled();

    // Should have emitted a tool_result event with the error
    const toolResultEvent = events.find(
      (e) => e.type === 'tool_result' && e.toolName === 'character.list',
    );
    expect(toolResultEvent).toBeDefined();
    const result = toolResultEvent?.result as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toContain("Tool 'character.list' exists but is not loaded");
    expect(result.error).toContain('tool.get');
  });

  it('injects a process-bound system prompt after a matching tool call', async () => {
    toolRegistry.register({
      name: 'character.generateRefImage',
      description: 'Generate a character reference image',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: { assetHash: 'asset-1' } })),
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-ref', name: 'character.generateRefImage', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'done',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
      resolveProcessPrompt: (processKey) =>
        processKey === 'character-ref-image-generation' ? 'Ref image rules go here.' : null,
    });

    await agent.execute('generate ref', {}, () => {}, {
      discoveredTools: ['character.generateRefImage'],
    });

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[1][0] as Array<{
      role: string;
      content: string;
    }>;

    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('[[process-prompt:character-ref-image-generation]]'),
        }),
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('[Process Guide: Character Reference Image Generation]'),
        }),
      ]),
    );
  });

  it('injects initial process prompts before the first LLM call when context requests them', async () => {
    const adapter = createMockAdapter([{ content: 'done', toolCalls: [], finishReason: 'stop' }]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
      resolveProcessPrompt: (processKey) =>
        processKey === 'image-node-generation' ? 'Image prompt rules.' : null,
    });

    await agent.execute(
      'rewrite the prompt',
      { extra: { initialProcessPrompts: ['image-node-generation'] } },
      () => {},
    );

    const firstCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;

    expect(firstCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('[[process-prompt:image-node-generation]]'),
        }),
      ]),
    );
  });

  it('deduplicates and later strips inactive process prompts', async () => {
    const imageGenerateTool = vi.fn(async () => ({ success: true, data: { nodeId: 'image-1' } }));
    const noopTool = vi.fn(async () => ({ success: true, data: { ok: true } }));

    toolRegistry.register({
      name: 'canvas.generate',
      description: 'Generate node media',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: imageGenerateTool,
    });
    toolRegistry.register({
      name: 'noop.tool',
      description: 'No-op',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: noopTool,
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-1', name: 'canvas.generate', arguments: { nodeType: 'image' } }],
        finishReason: 'tool_calls',
      },
      {
        content: '',
        toolCalls: [{ id: 'tc-2', name: 'canvas.generate', arguments: { nodeType: 'image' } }],
        finishReason: 'tool_calls',
      },
      {
        content: '',
        toolCalls: [{ id: 'tc-3', name: 'noop.tool', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: '',
        toolCalls: [{ id: 'tc-4', name: 'noop.tool', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: '',
        toolCalls: [{ id: 'tc-5', name: 'noop.tool', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'done',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
      resolveProcessPrompt: (processKey) =>
        processKey === 'image-node-generation' ? 'Image prompt rules.' : null,
    });

    await agent.execute('run workflow', {}, () => {}, {
      discoveredTools: ['canvas.generate', 'noop.tool'],
    });

    const thirdCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[2][0] as Array<{
      role: string;
      content: string;
    }>;
    const injectedSystemMessages = thirdCallMessages.filter(
      (message) =>
        message.role === 'system' &&
        message.content.includes('[[process-prompt:image-node-generation]]'),
    );
    expect(injectedSystemMessages).toHaveLength(1);

    const sixthCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[5][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(
      sixthCallMessages.some(
        (message) =>
          message.role === 'system' &&
          message.content.includes('[[process-prompt:image-node-generation]]'),
      ),
    ).toBe(false);
  });

  // ── ContextGraph path (openai adapter) ───

  it('graph path: wireMessages produced via ContextGraph serializer for openai adapter', async () => {
    const capturedRequests: unknown[][] = [];
    const openaiAdapter: import('@lucid-fin/contracts').LLMAdapter = {
      id: 'openai',
      name: 'OpenAI',
      capabilities: ['text-generation'],
      configure: vi.fn(),
      validate: vi.fn(async () => true),
      complete: vi.fn(async () => ''),
      stream: vi.fn(async function* () { yield ''; }),
      completeWithTools: vi.fn(async (messages: unknown[]) => {
        capturedRequests.push(messages);
        return {
          content: 'Graph path response.',
          toolCalls: [],
          finishReason: 'stop' as const,
        };
      }),
    };

    const agent = new AgentOrchestrator(openaiAdapter, toolRegistry, resolvePrompt);
    const events: unknown[] = [];
    const result = await agent.execute('Hello from graph path', {}, (e) => events.push(e));

    expect(result.content).toBe('Graph path response.');
    expect(events.some((e: unknown) => (e as Record<string, unknown>).type === 'done')).toBe(true);

    // Verify the LLM adapter was invoked with a non-empty messages array
    // and that the first kept message is a system prompt.
    expect(capturedRequests.length).toBeGreaterThan(0);
    const firstRequest = capturedRequests[0] as Array<Record<string, unknown>>;
    expect(firstRequest[0]!.role).toBe('system');
  });

  // ── ContextGraph path (claude adapter) ───

  it('graph path: activates for claude adapter', async () => {
    const capturedRequests: unknown[][] = [];
    const claudeAdapter: import('@lucid-fin/contracts').LLMAdapter = {
      id: 'claude',
      name: 'Claude',
      capabilities: ['text-generation'],
      configure: vi.fn(),
      validate: vi.fn(async () => true),
      complete: vi.fn(async () => ''),
      stream: vi.fn(async function* () { yield ''; }),
      completeWithTools: vi.fn(async (messages: unknown[]) => {
        capturedRequests.push(messages);
        return {
          content: 'Claude graph response.',
          toolCalls: [],
          finishReason: 'stop' as const,
        };
      }),
      profile: {
        providerId: 'claude',
        charsPerToken: 3.5,
        sanitizeToolNames: true,
        maxUtilization: 0.90,
        outputReserveTokens: 4096,
      },
    };

    const agent = new AgentOrchestrator(claudeAdapter, toolRegistry, resolvePrompt);
    const events: unknown[] = [];
    const result = await agent.execute('Hello Claude', {}, (e) => events.push(e));

    expect(result.content).toBe('Claude graph response.');
    expect(events.some((e: unknown) => (e as Record<string, unknown>).type === 'done')).toBe(true);
    expect(capturedRequests.length).toBeGreaterThan(0);
    const firstRequest = capturedRequests[0] as Array<Record<string, unknown>>;
    expect(firstRequest[0]!.role).toBe('system');
  });
});
