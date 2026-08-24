import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { ToolRegistry, toolResultSchema, type ToolDefinition } from './tool-registry.js';
import {
  arraySchema,
  canonicalJsonSchema,
  numberSchema,
  objectSchema,
  stringSchema,
} from './tools/tool-runtime-schemas.js';
import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import type {
  LLMAdapter,
  LLMStreamEvent,
  LLMToolCall,
  LLMFinishReason,
  LLMMessage,
} from '@lucid-fin/contracts';

/**
 * Test-only shape — mirrors the pre-streaming `LLMCompletionResult` so the
 * existing response fixtures in these tests stay readable. `createMockAdapter`
 * wraps each entry in an `AsyncIterable<LLMStreamEvent>` that the orchestrator
 * drains.
 */
interface MockLLMResponse {
  content: string;
  reasoning?: string;
  usage?: { promptTokens?: number; completionTokens?: number; reasoningTokens?: number };
  toolCalls: LLMToolCall[];
  finishReason: LLMFinishReason;
}

async function* responseToStream(r: MockLLMResponse): AsyncIterable<LLMStreamEvent> {
  if (r.reasoning) yield { kind: 'reasoning_delta', delta: r.reasoning };
  if (r.content) yield { kind: 'text_delta', delta: r.content };
  for (const tc of r.toolCalls) {
    yield { kind: 'tool_call_started', id: tc.id, name: tc.name };
    yield {
      kind: 'tool_call_complete',
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
      thoughtSignature: tc.thoughtSignature,
    };
  }
  if (r.usage) yield { kind: 'usage', ...r.usage };
  yield { kind: 'finished', finishReason: r.finishReason };
}

function createMockAdapter(responses: MockLLMResponse[]): LLMAdapter {
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
      const r = responses[Math.min(callIdx, responses.length - 1)]!;
      callIdx++;
      return responseToStream(r);
    }),
  };
}

const resolvePrompt = () => 'You are a test assistant.';

type TestToolDefinition = Omit<ToolDefinition, 'resource' | 'inputSchema' | 'outputSchema'> &
  Partial<Pick<ToolDefinition, 'resource' | 'inputSchema' | 'outputSchema'>> & {
    parameters?: ToolDefinition['inputSchema'];
  };
type TestToolRegistry = ToolRegistry & {
  register(tool: TestToolDefinition): void;
};

function createTestToolRegistry(): TestToolRegistry {
  const registry = new ToolRegistry();
  const register = registry.register.bind(registry);
  registry.register = ((tool: TestToolDefinition) =>
    register({
      ...tool,
      resource: tool.resource ?? { kind: 'none' },
      inputSchema: tool.inputSchema ?? tool.parameters ?? { type: 'object', properties: {} },
      outputSchema: tool.outputSchema ?? toolResultSchema(canonicalJsonSchema, { dataOptional: true }),
    } as ToolDefinition)) as (
    tool: ToolDefinition,
  ) => void;
  return registry as TestToolRegistry;
}

describe('AgentOrchestrator', () => {
  let toolRegistry: TestToolRegistry;

  beforeEach(() => {
    toolRegistry = createTestToolRegistry();
  });

  it('returns text response when no tools called', async () => {
    const adapter = createMockAdapter([{ content: 'Hello!', toolCalls: [], finishReason: 'stop' }]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

    const events: unknown[] = [];
    const result = await agent.execute('Hi', {}, (e) => events.push(e));

    expect(result.content).toBe('Hello!');
    expect(result.toolCalls).toHaveLength(0);
    expect(events.some((e: unknown) => (e as Record<string, unknown>).kind === 'run_end')).toBe(
      true,
    );
    expect(
      events.some(
        (e: unknown) =>
          (e as Record<string, unknown>).kind === 'assistant_text' &&
          (e as Record<string, unknown>).content === 'Hello!',
      ),
    ).toBe(true);
  });

  it('routes runChecklist.manage through the registered ToolDefinition executor', async () => {
    const execute = vi.fn(async () => ({ success: true, data: { source: 'definition' } }));
    toolRegistry.register({
      name: 'runChecklist.manage',
      description: 'Manage run checklist',
      process: 'meta',
      category: 'meta',
      contextReplay: 'status_only',
      tier: 1,
      inputSchema: objectSchema({
        action: { type: 'string', enum: ['set'] },
        items: arraySchema(objectSchema({ label: stringSchema })),
      }),
      outputSchema: toolResultSchema(objectSchema({ source: stringSchema })),
      execute,
    });
    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{
          id: 'checklist-1',
          name: 'runChecklist.manage',
          arguments: { action: 'set', items: [{ label: 'One' }, { label: 'Two' }] },
        }],
        finishReason: 'tool_calls',
      },
      { content: 'Done', toolCalls: [], finishReason: 'stop' },
    ]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

    await agent.execute('Plan this', {}, () => {});

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ action: 'set' }));
  });

  it('uses the host-reserved run ID for every emitted event', async () => {
    const adapter = createMockAdapter([{ content: 'Hello!', toolCalls: [], finishReason: 'stop' }]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    const events: Array<Record<string, unknown>> = [];

    await agent.execute('Hi', {}, (event) => events.push(event), { runId: 'run_reserved' });

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.runId === 'run_reserved')).toBe(true);
  });

  it('continues after a host-persisted run_start without emitting it twice', async () => {
    const adapter = createMockAdapter([{ content: 'Hello!', toolCalls: [], finishReason: 'stop' }]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    const events: Array<Record<string, unknown>> = [];

    await agent.execute('Hi', {}, (event) => events.push(event), {
      runId: 'run_reserved',
      initialSeq: 1,
      emitRunStart: false,
    });

    expect(events.some((event) => event.kind === 'run_start')).toBe(false);
    expect(events[0]?.seq).toBe(1);
    expect(events.every((event) => event.runId === 'run_reserved')).toBe(true);
  });

  it('returns whether a pending confirmation or question was actually resolved', () => {
    const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    const internals = agent as unknown as {
      pendingResolvers: Map<string, (approved: boolean) => void>;
      pendingQuestionResolvers: Map<string, (answer: string) => void>;
    };
    const resolveConfirmation = vi.fn();
    const resolveQuestion = vi.fn();

    internals.pendingResolvers.set('confirm-1', resolveConfirmation);
    internals.pendingQuestionResolvers.set('question-1', resolveQuestion);

    expect(agent.confirmTool('confirm-1', true)).toBe(true);
    expect(resolveConfirmation).toHaveBeenCalledWith(true);
    expect(agent.confirmTool('confirm-1', true)).toBe(false);

    expect(agent.hasPendingQuestion('question-1')).toBe(true);
    expect(agent.answerQuestion('question-1', 'yes')).toBe(true);
    expect(resolveQuestion).toHaveBeenCalledWith('yes');
    expect(agent.hasPendingQuestion('question-1')).toBe(false);
    expect(agent.answerQuestion('question-1', 'yes')).toBe(false);
  });

  it('emits one matching failed terminal event when execution throws after run_start', async () => {
    const adapter = createMockAdapter([{ content: 'unused', toolCalls: [], finishReason: 'stop' }]);
    (adapter.completeWithTools as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('LLM exploded'),
    );
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    const events: Array<Record<string, unknown>> = [];

    await expect(agent.execute('Hi', {}, (event) => events.push(event))).rejects.toThrow(
      'LLM exploded',
    );

    const started = events.find((event) => event.kind === 'run_start');
    const terminals = events.filter((event) => event.kind === 'run_end');
    expect(started).toBeDefined();
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({
      kind: 'run_end',
      status: 'failed',
      runId: started?.runId,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'public_progress',
        status: 'failed',
        runId: started?.runId,
      }),
    );
    expect(JSON.stringify(events)).not.toContain('LLM exploded');
  });

  it('publishes one cumulative resource snapshot without exposing provider reasoning', async () => {
    const secret = 'SECRET_REASONING_SENTINEL';
    const adapter = createMockAdapter([{
      content: 'Public answer',
      reasoning: secret,
      usage: { promptTokens: 12, completionTokens: 5, reasoningTokens: 3 },
      toolCalls: [],
      finishReason: 'stop',
    }]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    const events: Array<Record<string, unknown>> = [];

    await agent.execute('Hi', {}, (event) => events.push(event));

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'resource_state',
        cause: {
          kind: 'settled',
          operationId: 'model:1:attempt:0',
          source: 'model',
        },
        usage: expect.objectContaining({
          tokens: { knowledge: 'known', value: 17 },
          toolCalls: 0,
          costUsd: { knowledge: 'unknown' },
        }),
      }),
    );
    expect(events.some((event) => event.kind === 'resource_usage')).toBe(false);
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  it('keeps the context-window cap separate from the provider output limit', async () => {
    const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);
    Object.assign(adapter, {
      contextWindow: 128_000,
      effectiveContextWindow: 128_000,
    });
    const diagnostics: Array<{ contextWindowTokens: number }> = [];
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
      contextWindowTokens: 200_000,
      maxOutputTokens: 200_000,
    });

    await agent.execute('hello', {}, () => {}, {
      onLLMRequest: (value) => diagnostics.push(value),
    });

    const options = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      maxTokens: number;
    };
    expect(options.maxTokens).toBe(4096);
    expect(diagnostics[0]?.contextWindowTokens).toBe(128_000);
  });

  it('reports the characters used by auto-injected guide summaries', async () => {
    const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);
    const diagnostics: Array<{ promptGuideChars: number }> = [];
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

    await agent.execute(
      'hello',
      {
        extra: {
          autoInjectGuides: [
            { id: 'guide-1', name: 'Guide One', content: 'alpha' },
            { id: 'guide-2', name: 'Guide Two', content: 'beta!' },
          ],
        },
      },
      () => {},
      { onLLMRequest: (value) => diagnostics.push(value) },
    );

    expect(diagnostics[0]?.promptGuideChars).toBe(10);
  });

  it('does not call the provider when protected context remains at or above 92 percent', async () => {
    const adapter = createMockAdapter([
      { content: 'must not run', toolCalls: [], finishReason: 'stop' },
    ]);
    Object.assign(adapter, {
      contextWindow: 1024,
      effectiveContextWindow: 1024,
    });
    const agent = new AgentOrchestrator(adapter, toolRegistry, () => 'x'.repeat(8_000), {
      contextWindowTokens: 1024,
    });
    const events: Array<Record<string, unknown>> = [];

    const result = await agent.execute('hello', {}, (event) => events.push(event));

    expect(result.content).toBe('');
    expect(adapter.completeWithTools).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'run_end',
        status: 'blocked',
        blocker: { kind: 'safety_limit', limit: 'context_window' },
      }),
    );
  });

  it('persists the 92 percent hard stop against the bound task list before returning', async () => {
    const adapter = createMockAdapter([
      { content: 'must not run', toolCalls: [], finishReason: 'stop' },
    ]);
    Object.assign(adapter, {
      contextWindow: 1024,
      effectiveContextWindow: 1024,
    });
    const onContextRecoveryReport = vi.fn(async () => ({
      state: 'recovery_required' as const,
      consecutiveFailures: 1,
      changed: true,
    }));
    const agent = new AgentOrchestrator(adapter, toolRegistry, () => 'x'.repeat(8_000), {
      contextWindowTokens: 1024,
      resolvePersistentContext: () => ({
        taskListToolPolicy: {
          taskListId: 'task-list-context-1',
          phase: 'media_generation',
          rowVersion: 7,
        },
      }),
      onContextRecoveryReport,
    });

    await agent.execute('continue', {}, () => {});

    expect(onContextRecoveryReport).toHaveBeenCalledWith({
      taskListId: 'task-list-context-1',
      outcome: 'failed',
      reason: 'hard_stop',
      forcePause: true,
    });
    expect(adapter.completeWithTools).not.toHaveBeenCalled();
  });

  it('pauses after the third durable compaction failure across orchestrator instances', async () => {
    let durableFailures = 0;
    const onContextRecoveryReport = vi.fn(async (report: { outcome: 'failed' | 'recovered' }) => {
      if (report.outcome === 'recovered') durableFailures = 0;
      else durableFailures += 1;
      return {
        state: durableFailures >= 3 ? ('recovery_required' as const) : ('recovering' as const),
        consecutiveFailures: durableFailures,
        changed: durableFailures === 3,
      };
    });
    const providerCalls: Array<ReturnType<typeof vi.fn>> = [];

    for (let attempt = 1; attempt <= 3; attempt++) {
      const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);
      Object.assign(adapter, {
        contextWindow: 4096,
        effectiveContextWindow: 4096,
      });
      providerCalls.push(adapter.completeWithTools as ReturnType<typeof vi.fn>);
      const agent = new AgentOrchestrator(adapter, toolRegistry, () => 'x'.repeat(12_300), {
        contextWindowTokens: 4096,
        resolvePersistentContext: () => ({
          taskListToolPolicy: {
            taskListId: 'task-list-context-1',
            phase: 'media_generation',
            rowVersion: attempt,
          },
        }),
        onContextRecoveryReport,
      });
      vi.spyOn(
        (
          agent as unknown as {
            contextManager: {
              compactWithLLMResult: (messages: readonly LLMMessage[]) => Promise<{
                attempted: boolean;
                changed: boolean;
                truncated: number;
                view: LLMMessage[];
              }>;
            };
          }
        ).contextManager,
        'compactWithLLMResult',
      ).mockImplementation(async (messages: readonly LLMMessage[]) => ({
        attempted: true,
        changed: false,
        truncated: 0,
        view: structuredClone(messages),
      }));

      const events: Array<Record<string, unknown>> = [];
      const result = await agent.execute('continue', {}, (event) => events.push(event));
      if (attempt === 3) {
        expect(result.content).toBe('');
        expect(events).toContainEqual(
          expect.objectContaining({
            kind: 'run_end',
            status: 'blocked',
            blocker: { kind: 'safety_limit', limit: 'recovery_required' },
          }),
        );
      }
    }

    expect(onContextRecoveryReport).toHaveBeenCalledTimes(3);
    expect(providerCalls[0]).toHaveBeenCalledOnce();
    expect(providerCalls[1]).toHaveBeenCalledOnce();
    expect(providerCalls[2]).not.toHaveBeenCalled();
  });

  it('reports a verified persistent-context reload so the durable failure counter is cleared', async () => {
    const adapter = createMockAdapter([{ content: 'ready', toolCalls: [], finishReason: 'stop' }]);
    Object.assign(adapter, {
      contextWindow: 128_000,
      effectiveContextWindow: 128_000,
    });
    const onContextRecoveryReport = vi.fn(async () => ({
      state: 'active' as const,
      consecutiveFailures: 0,
      changed: true,
    }));
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
      resolvePersistentContext: () => ({
        taskListToolPolicy: {
          taskListId: 'task-list-context-1',
          phase: 'media_generation',
          rowVersion: 8,
        },
      }),
      onContextRecoveryReport,
    });

    await agent.execute('continue', {}, () => {});

    expect(onContextRecoveryReport).toHaveBeenCalledWith({
      taskListId: 'task-list-context-1',
      outcome: 'recovered',
      reason: 'persistent_context_reloaded',
    });
    expect(adapter.completeWithTools).toHaveBeenCalledOnce();
  });

  it('rebuilds task-list authorization after recovery unpauses the durable task list', async () => {
    const adapter = createMockAdapter([
      { content: 'resumed', toolCalls: [], finishReason: 'stop' },
    ]);
    Object.assign(adapter, {
      contextWindow: 128_000,
      effectiveContextWindow: 128_000,
    });
    let paused = true;
    const resolvePersistentContext = vi.fn(() => ({
      taskListToolPolicy: paused
        ? {
            taskListId: 'task-list-context-1',
            phase: 'blocked' as const,
            rowVersion: 9,
            reason: 'Task list is paused for context recovery.',
          }
        : {
            taskListId: 'task-list-context-1',
            phase: 'media_generation' as const,
            rowVersion: 10,
          },
    }));
    const onContextRecoveryReport = vi.fn(async () => {
      paused = false;
      return { state: 'active' as const, consecutiveFailures: 0, changed: true };
    });
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
      resolvePersistentContext,
      onContextRecoveryReport,
    });

    const result = await agent.execute('continue', {}, () => {});

    expect(result.content).toBe('resumed');
    expect(resolvePersistentContext).toHaveBeenCalledTimes(4);
    expect(onContextRecoveryReport).toHaveBeenCalledOnce();
    expect(adapter.completeWithTools).toHaveBeenCalledOnce();
  });

  it('keeps forbidden task-list tools visible while execution remains denied', async () => {
    const generate = vi.fn(async () => ({ success: true }));
    toolRegistry.register({
      name: 'canvas.generation',
      process: 'image-node-generation',
      category: 'mutation',
      contextReplay: 'status_only',
      description: 'Generate media',
      tier: 3,
      inputSchema: objectSchema({}, []),
      outputSchema: toolResultSchema(undefined, { dataOptional: true }),
      execute: generate,
    });
    toolRegistry.register({
      name: 'canvas.listNodes',
      process: 'canvas-structure',
      category: 'query',
      contextReplay: 'status_only',
      description: 'List nodes',
      tier: 1,
      inputSchema: objectSchema({}, []),
      outputSchema: toolResultSchema(arraySchema(canonicalJsonSchema)),
      execute: vi.fn(async () => ({ success: true, data: [] })),
    });
    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'forbidden', name: 'canvas.generation', arguments: {} }],
        finishReason: 'tool_calls',
      },
      { content: 'blocked', toolCalls: [], finishReason: 'stop' },
    ]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    const events: Array<Record<string, unknown>> = [];

    await agent.execute(
      'continue',
      {
        page: 'canvas',
        extra: {
          taskListToolPolicy: {
            taskListId: 'task-list-1',
            phase: 'production_plan_pending',
            gate: 'production_plan',
            rowVersion: 1,
          },
        },
      },
      (event) => events.push(event as unknown as Record<string, unknown>),
    );

    const options = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      tools?: Array<{ name: string }>;
    };
    const names = options.tools?.map((tool) => tool.name) ?? [];
    expect(names).toContain('canvas.listNodes');
    expect(names).toContain('canvas.generation');
    expect(generate).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'tool_result', toolCallId: 'forbidden', skipped: true }),
    );
  });

  it('keeps identical tool names and schema count across phase changes and long runs', async () => {
    let advanced = false;
    toolRegistry.register({
      name: 'taskList.manage',
      process: 'task-list-orchestration',
      category: 'mutation',
      contextReplay: 'status_only',
      description: 'Advance task list',
      tier: 2,
      inputSchema: objectSchema({ action: { type: 'string', enum: ['completeCurrentTask'] } }),
      outputSchema: toolResultSchema(undefined, { dataOptional: true }),
      execute: vi.fn(async () => {
        advanced = true;
        return { success: true };
      }),
    });
    toolRegistry.register({
      name: 'task.delivery',
      process: 'ordered-delivery',
      category: 'mutation',
      contextReplay: 'status_only',
      description: 'Prepare Delivery manifest',
      tier: 1,
      inputSchema: objectSchema({}, []),
      outputSchema: toolResultSchema(undefined, { dataOptional: true }),
      execute: vi.fn(async () => ({ success: true })),
    });
    toolRegistry.register({
      name: 'canvas.listNodes',
      process: 'canvas-structure',
      category: 'query',
      contextReplay: 'status_only',
      description: 'List Canvas nodes',
      tier: 1,
      inputSchema: objectSchema({ page: numberSchema }, []),
      outputSchema: toolResultSchema(arraySchema(canonicalJsonSchema)),
      execute: vi.fn(async () => ({ success: true, data: [] })),
    });
    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [
          {
            id: 'advance',
            name: 'taskList.manage',
            arguments: { action: 'completeCurrentTask' },
          },
        ],
        finishReason: 'tool_calls',
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        content: '',
        toolCalls: [
          { id: `inspect-${index}`, name: 'canvas.listNodes', arguments: { page: index } },
        ],
        finishReason: 'tool_calls' as const,
      })),
      { content: 'ready to export', toolCalls: [], finishReason: 'stop' },
    ]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
      resolvePersistentContext: () => ({
        taskListToolPolicy: {
          taskListId: 'task-list-1',
          phase: advanced ? ('delivery_preparation' as const) : ('assembly' as const),
          rowVersion: advanced ? 2 : 1,
        },
      }),
    });

    await agent.execute('finish assembly', { page: 'canvas' }, () => {});

    const toolSets = vi.mocked(adapter.completeWithTools).mock.calls.map((call) => {
      const options = call[1] as { tools?: Array<{ name: string }> };
      return (options.tools ?? []).map((tool) => tool.name).sort();
    });
    const expected = toolRegistry
      .list()
      .map((tool) => tool.name)
      .sort();

    expect(advanced).toBe(true);
    expect(toolSets).toHaveLength(7);
    expect(toolSets.every((names) => names.length === expected.length)).toBe(true);
    expect(toolSets.every((names) => JSON.stringify(names) === JSON.stringify(expected))).toBe(
      true,
    );
  });

  it('executes tool calls and feeds results back', async () => {
    const mockTool = vi.fn(async () => ({ success: true, data: { count: 5 } }));
    toolRegistry.register({
      name: 'character.list',
      process: 'entity-management',
      category: 'query',
      contextReplay: 'status_only',
      description: 'List characters',
      tier: 1,
      inputSchema: objectSchema({}, []),
      outputSchema: toolResultSchema(objectSchema({ count: numberSchema })),
      execute: mockTool,
    });

    const adapter = createMockAdapter([
      {
        content: '',
        reasoning: 'I should inspect the character list.',
        toolCalls: [
          {
            id: 'tc1',
            name: 'character.list',
            arguments: {},
            thoughtSignature: 'opaque-signature',
          },
        ],
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
    const secondRequest = vi.mocked(adapter.completeWithTools).mock.calls[1]?.[0];
    expect(secondRequest?.find((message) => message.role === 'assistant')).toMatchObject({
      reasoning: 'I should inspect the character list.',
      toolCalls: [{ id: 'tc1', thoughtSignature: 'opaque-signature' }],
    });
    expect(events.some((e: unknown) => (e as Record<string, unknown>).kind === 'tool_call')).toBe(
      true,
    );
    expect(events.some((e: unknown) => (e as Record<string, unknown>).kind === 'tool_result')).toBe(
      true,
    );
  });

  it('records guide_loaded evidence for every guide returned by guide.get', async () => {
    toolRegistry.register({
      name: 'guide.get',
      process: 'meta',
      category: 'meta',
      contextReplay: 'status_only',
      description: 'Load prompt guides',
      tier: 1,
      inputSchema: objectSchema({ ids: arraySchema(stringSchema) }),
      outputSchema: toolResultSchema(objectSchema({
        guides: arraySchema(objectSchema({
          id: stringSchema,
          name: stringSchema,
          content: stringSchema,
        })),
      })),
      execute: vi.fn(async () => ({
        success: true,
        data: {
          guides: [
            { id: 'guide-1', name: 'Guide One', content: 'alpha' },
            { id: 'guide-2', name: 'Guide Two', content: 'beta' },
          ],
        },
      })),
    });
    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [
          { id: 'tc-guide', name: 'guide.get', arguments: { ids: ['guide-1', 'guide-2'] } },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'loaded', toolCalls: [], finishReason: 'stop' },
    ]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

    await agent.execute('load guides', {}, () => {});

    const evidence = (
      agent as unknown as {
        evidenceLedger: {
          entries(): ReadonlyArray<{ kind: string; guideId?: string }>;
        };
      }
    ).evidenceLedger.entries();
    expect(
      evidence.filter((entry) => entry.kind === 'guide_loaded').map((entry) => entry.guideId),
    ).toEqual(['guide-1', 'guide-2']);
  });

  it('does not treat guide-list metadata as loaded guide content', async () => {
    toolRegistry.register({
      name: 'guide.get',
      process: 'meta',
      category: 'meta',
      contextReplay: 'status_only',
      description: 'List prompt guides',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({
        success: true,
        data: { total: 1, guides: [{ id: 'guide-1', name: 'Guide One' }] },
      })),
    });
    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-guide-list', name: 'guide.get', arguments: {} }],
        finishReason: 'tool_calls',
      },
      { content: 'listed', toolCalls: [], finishReason: 'stop' },
    ]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

    await agent.execute('list guides', {}, () => {});

    const evidence = (
      agent as unknown as {
        evidenceLedger: {
          entries(): ReadonlyArray<{ kind: string; guideId?: string }>;
        };
      }
    ).evidenceLedger.entries();
    expect(evidence.filter((entry) => entry.kind === 'guide_loaded')).toEqual([]);
  });

  it('handles tool execution errors gracefully', async () => {
    toolRegistry.register({
      name: 'error.tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      description: 'fail',
      tier: 1,
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
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'tool_result',
        toolCallId: 'tc1',
        status: 'failed',
        errorCode: 'TOOL_RUNTIME',
      }),
    );
  });

  it('has no fixed step ceiling while productive work and resources remain', async () => {
    toolRegistry.register({
      name: 'loop.tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: { kind: 'none' },
      description: 'loop',
      tier: 1,
      parameters: {
        type: 'object',
        properties: { index: { type: 'number', description: 'Unique iteration' } },
        required: ['index'],
      },
      execute: vi.fn(async () => ({ success: true, data: 'loop' })),
    });

    const rounds = 205;
    const adapter = createMockAdapter([
      ...Array.from({ length: rounds }, (_, index) => ({
        content: '',
        toolCalls: [{ id: `tc-${index}`, name: 'loop.tool', arguments: { index } }],
        finishReason: 'tool_calls' as const,
      })),
      { content: 'Finished naturally', toolCalls: [], finishReason: 'stop' },
    ]);
    Object.assign(adapter, { contextWindow: 2_000_000, effectiveContextWindow: 2_000_000 });

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
      contextWindowTokens: 2_000_000,
    });
    const result = await agent.execute('loop', {}, () => {});

    expect(result.content).toBe('Finished naturally');
    expect(adapter.completeWithTools).toHaveBeenCalledTimes(rounds + 1);
  });

  it('blocks before provider execution when a configured cost cap has no safe quote', async () => {
    const adapter = createMockAdapter([
      { content: 'must not execute', toolCalls: [], finishReason: 'stop' },
    ]);
    const events: Array<Record<string, unknown>> = [];
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
      resourceBudget: { maxCostUsd: 1 },
    });

    const result = await agent.execute('answer', {}, (event) => events.push(event));

    expect(result.content).toBe('');
    expect(adapter.completeWithTools).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'run_end',
        status: 'blocked',
        blocker: { kind: 'resource_budget', metric: 'cost', reason: 'unavailable' },
      }),
    );
    expect(events.some((event) => event.kind === 'assistant_text')).toBe(false);
  });

  it('ends with a typed blocker before tools run when the tool-call budget is exhausted', async () => {
    const execute = vi.fn(async () => ({ success: true }));
    toolRegistry.register({
      name: 'budget.read',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: { kind: 'none' },
      description: 'Read a budget fixture',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute,
    });
    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [
          { id: 'tool-1', name: 'budget.read', arguments: {} },
          { id: 'tool-2', name: 'budget.read', arguments: {} },
        ],
        finishReason: 'tool_calls',
      },
    ]);
    const events: Array<Record<string, unknown>> = [];
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
      resourceBudget: { maxToolCalls: 1 },
    });

    const result = await agent.execute('read', {}, (event) => events.push(event));

    expect(result.content).toBe('');
    expect(execute).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'run_end',
        status: 'blocked',
        blocker: { kind: 'resource_budget', metric: 'tool_calls', reason: 'exhausted' },
      }),
    );
    expect(events.some((event) => event.kind === 'tool_call')).toBe(false);
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

  it('keeps context-tagged registered tools visible on every page', async () => {
    toolRegistry.register({
      name: 'script.only',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      description: 'script tool',
      contexts: ['script-editor'],
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });
    toolRegistry.register({
      name: 'global.tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      description: 'global',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });

    const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('test', { page: 'orchestrator' }, () => {});

    const call = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0];
    const opts = call[1];
    const toolNames = (opts.tools as Array<{ name: string }> | undefined)?.map((t) => t.name) ?? [];
    expect(toolNames).toEqual(['script.only', 'global.tool']);
  });

  it('forwards registered tool definitions without adaptive schema compaction', async () => {
    toolRegistry.register({
      name: 'canvas.createNodes',
      process: 'canvas-structure',
      category: 'mutation',
      contextReplay: 'status_only',
      description:
        'Add a new node to the current canvas at a specific position with very verbose explanation text.',
      tier: 1,
      parameters: {
        type: 'object',
        properties: {
          canvasId: {
            type: 'string',
            description:
              'The target canvas identifier with extra explanatory prose that should not be forwarded verbatim.',
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

    expect(tool.description).toBe(
      'Add a new node to the current canvas at a specific position with very verbose explanation text.',
    );
    expect(tool.parameters.properties.canvasId?.description).toBe(
      'The target canvas identifier with extra explanatory prose that should not be forwarded verbatim.',
    );
    expect(tool.parameters.properties.position?.description).toBe(
      'The desired node coordinates on the canvas surface.',
    );
    expect(
      (tool.parameters.properties.position?.properties as Record<string, Record<string, unknown>>).x
        ?.description,
    ).toBe('Horizontal coordinate with long explanation.');
    expect(
      (tool.parameters.properties.position?.properties as Record<string, Record<string, unknown>>).y
        ?.description,
    ).toBe('Vertical coordinate with long explanation.');
  });

  it('injects history into the LLM message list', async () => {
    const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('latest', { page: 'canvas' }, () => {}, {
      history: [
        { role: 'user', content: 'older user message' },
        { role: 'assistant', content: 'older assistant message' },
      ],
    });

    const messages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{
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
    await agent.execute('latest', { page: 'canvas' }, () => {}, {
      history: [
        { role: 'user', content: 'A'.repeat(10000) },
        { role: 'assistant', content: 'B'.repeat(10000) },
        { role: 'user', content: 'C'.repeat(10000) },
        { role: 'assistant', content: 'D'.repeat(10000) },
      ],
    });

    const messages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{
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

    const result = await agent.execute('stop', {}, (event) => events.push(event), {
      isAborted: () => true,
    });

    expect(result.content).toBe('Cancelled.');
    expect((adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ kind: 'run_end', status: 'cancelled' }),
    );
  });

  it('does not require confirmation for untiered tools in normal mode', async () => {
    const execute = vi.fn(async () => ({ success: true, data: { id: 'char-1' } }));
    toolRegistry.register({
      name: 'character.get',
      process: 'entity-management',
      category: 'query',
      contextReplay: 'status_only',
      description: 'Get a character',
      tier: 1,
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
        if (record.kind === 'tool_confirm' && typeof record.toolCallId === 'string') {
          agent.confirmTool(record.toolCallId, true);
        }
      },
      { permissionMode: 'normal' },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.kind === 'tool_confirm')).toBe(false);
  });

  it('preserves an injected user message without adding host-authored steering', async () => {
    toolRegistry.register({
      name: 'canvas.listNodes',
      process: 'canvas-structure',
      category: 'query',
      contextReplay: 'status_only',
      description: 'List nodes',
      tier: 1,
      inputSchema: objectSchema({}, []),
      outputSchema: toolResultSchema(arraySchema(objectSchema({ id: stringSchema, title: stringSchema }))),
      execute: vi.fn(async () => {
        (agent as unknown as { injectMessage?: (content: string) => void }).injectMessage?.(
          'Focus on node n-2',
        );
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
    const events: Array<Record<string, unknown>> = [];
    await agent.execute('list nodes', {}, (event) => {
      events.push(event as unknown as Record<string, unknown>);
    });

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as Array<{
      role: string;
      content: string;
    }>;
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'Focus on node n-2' }),
      ]),
    );
    expect(secondCallMessages.filter((message) => message.role === 'system')).toEqual([
      expect.objectContaining({ content: expect.stringContaining('You are a test assistant.') }),
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'user_message', content: 'Focus on node n-2' }),
      ]),
    );
  });

  it('records repeated tool failures without injecting host-authored model messages', async () => {
    toolRegistry.register({
      name: 'canvas.updateNodes',
      process: 'canvas-node-editing',
      category: 'mutation',
      contextReplay: 'status_only',
      description: 'Update nodes',
      tier: 2,
      inputSchema: {
        type: 'object',
        properties: { attempt: { type: 'number' } },
        required: ['attempt'],
      },
      outputSchema: toolResultSchema(undefined, { dataOptional: true }),
      execute: vi.fn(async () => ({ success: false, error: 'persisted failure' })),
    });
    const adapter = createMockAdapter([
      ...[1, 2, 3].map((attempt) => ({
        content: '',
        toolCalls: [{ id: `tc-failure-${attempt}`, name: 'canvas.updateNodes', arguments: { attempt } }],
        finishReason: 'tool_calls' as const,
      })),
      { content: 'stopped', toolCalls: [], finishReason: 'stop' },
    ]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

    await agent.execute('try the update', {}, () => {});

    const finalMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
      .calls[3][0] as LLMMessage[];
    expect(finalMessages.filter((message) => message.role === 'user')).toEqual([
      expect.objectContaining({ content: 'try the update' }),
    ]);
    expect(finalMessages.filter((message) => message.role === 'system')).toEqual([
      expect.objectContaining({ content: expect.stringContaining('You are a test assistant.') }),
    ]);
  });

  it('preserves tool results under the hard limit without truncation', async () => {
    toolRegistry.register({
      name: 'character.list',
      process: 'entity-management',
      category: 'query',
      contextReplay: 'status_only',
      description: 'List characters',
      tier: 1,
      inputSchema: objectSchema({}, []),
      outputSchema: toolResultSchema(arraySchema(canonicalJsonSchema)),
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
    await agent.execute('list characters', {}, () => {});

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as Array<{
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
      name: 'canvas.configureNode',
      process: 'node-provider-selection',
      category: 'mutation',
      contextReplay: 'status_only',
      description: 'Set node provider',
      tier: 1,
      inputSchema: objectSchema({}, []),
      outputSchema: toolResultSchema(objectSchema({
        nodeId: stringSchema,
        nodeTitle: stringSchema,
        status: stringSchema,
        providerId: stringSchema,
        details: stringSchema,
      })),
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
        toolCalls: [{ id: 'tc-mutation-summary', name: 'canvas.configureNode', arguments: {} }],
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

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as Array<{
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

    const messages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    const systemMsg = messages.find((message) => message.role === 'system');
    const largeStringLine = systemMsg?.content
      .split('\n')
      .find((line) => line.startsWith('largeString: '));
    const largeObjectLine = systemMsg?.content
      .split('\n')
      .find((line) => line.startsWith('largeObject: '));

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
      process: 'entity-management',
      category: 'query',
      contextReplay: 'status_only',
      description: 'List characters',
      tier: 1,
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

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as Array<{
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

  it('keeps the provider tool surface unchanged when tool.get queries the registry', async () => {
    const getTool = vi.fn(async () => ({
      success: true,
      data: {
        tools: [
          {
            name: 'asset.import',
            description: 'Import an asset',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        ],
      },
    }));
    toolRegistry.register({
      name: 'tool.get',
      process: 'meta',
      category: 'meta',
      contextReplay: 'status_only',
      description: 'Get tool schema',
      tier: 1,
      inputSchema: objectSchema({ names: arraySchema(stringSchema) }),
      outputSchema: toolResultSchema(objectSchema({
        tools: arraySchema(objectSchema(
          {
            name: stringSchema,
            description: stringSchema,
            parameters: canonicalJsonSchema,
          },
          ['name'],
        )),
      })),
      execute: getTool,
    });

    toolRegistry.register({
      name: 'asset.import',
      process: 'asset-library-management',
      category: 'mutation',
      contextReplay: 'status_only',
      description: 'Import an asset',
      tier: 1,
      inputSchema: objectSchema({}, []),
      outputSchema: toolResultSchema(arraySchema(canonicalJsonSchema)),
      execute: vi.fn(async () => ({ success: true, data: [] })),
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-get', name: 'tool.get', arguments: { names: ['asset.import'] } }],
        finishReason: 'tool_calls',
      },
      { content: 'done', toolCalls: [], finishReason: 'stop' },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('import an asset', { page: 'canvas' }, () => {});

    const firstOpts = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      tools: Array<{ name: string }>;
    };
    const secondOpts = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[1][1] as {
      tools: Array<{ name: string }>;
    };
    expect(firstOpts.tools.map((tool) => tool.name).sort()).toEqual(['asset.import', 'tool.get']);
    expect(secondOpts.tools).toEqual(firstOpts.tools);
    expect(getTool).toHaveBeenCalledOnce();
  });

  it('executes any registered tool without a tool.get activation step', async () => {
    const importAsset = vi.fn(async () => ({ success: true, data: [] }));
    toolRegistry.register({
      name: 'asset.import',
      process: 'asset-library-management',
      category: 'mutation',
      contextReplay: 'status_only',
      description: 'Import an asset',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: importAsset,
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-blocked', name: 'asset.import', arguments: {} }],
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
    await agent.execute('import an asset', {}, (e) =>
      events.push(e as unknown as Record<string, unknown>),
    );

    expect(importAsset).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'tool_result', toolCallId: 'tc-blocked' }),
    );
  });

  it('executes a process-bound tool without adding a system message', async () => {
    const generate = vi.fn(async () => ({ success: true, data: { assetHash: 'asset-1' } }));
    toolRegistry.register({
      name: 'canvas.generation',
      process: 'image-node-generation',
      category: 'mutation',
      contextReplay: 'status_only',
      description: 'Generate Canvas media through Prompt Assembly',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: generate,
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-ref', name: 'canvas.generation', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'done',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

    await agent.execute('generate ref', {}, () => {});

    expect(generate).toHaveBeenCalledOnce();

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as Array<{
      role: string;
      content: string;
    }>;

    const systemMessages = secondCallMessages.filter((message) => message.role === 'system');
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0]!.content).toContain('You are a test assistant.');
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
      stream: vi.fn(async function* () {
        yield '';
      }),
      completeWithTools: vi.fn(async (messages: unknown[]) => {
        capturedRequests.push(messages);
        return responseToStream({
          content: 'Graph path response.',
          toolCalls: [],
          finishReason: 'stop',
        });
      }),
    };

    const agent = new AgentOrchestrator(openaiAdapter, toolRegistry, resolvePrompt);
    const events: unknown[] = [];
    const result = await agent.execute('Hello from graph path', {}, (e) => events.push(e));

    expect(result.content).toBe('Graph path response.');
    expect(events.some((e: unknown) => (e as Record<string, unknown>).kind === 'run_end')).toBe(
      true,
    );

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
      stream: vi.fn(async function* () {
        yield '';
      }),
      completeWithTools: vi.fn(async (messages: unknown[]) => {
        capturedRequests.push(messages);
        return responseToStream({
          content: 'Claude graph response.',
          toolCalls: [],
          finishReason: 'stop',
        });
      }),
      profile: {
        providerId: 'claude',
        charsPerToken: 3.5,
        sanitizeToolNames: true,
        maxUtilization: 0.9,
        outputReserveTokens: 4096,
      },
    };

    const agent = new AgentOrchestrator(claudeAdapter, toolRegistry, resolvePrompt);
    const events: unknown[] = [];
    const result = await agent.execute('Hello Claude', {}, (e) => events.push(e));

    expect(result.content).toBe('Claude graph response.');
    expect(events.some((e: unknown) => (e as Record<string, unknown>).kind === 'run_end')).toBe(
      true,
    );
    expect(capturedRequests.length).toBeGreaterThan(0);
    const firstRequest = capturedRequests[0] as Array<Record<string, unknown>>;
    expect(firstRequest[0]!.role).toBe('system');
  });

  // ────────────────────────────────────────────────────────────
  // G2 merge gate 6: long-session stability (100+ tool-call steps)
  // ────────────────────────────────────────────────────────────
  describe('G2 long-session stability', () => {
    it('100 identical get/list calls — dedup index bounded, structural invariants hold', async () => {
      // Register a list tool — list category is dedup-safe in ContextGraph.
      const listTool = vi.fn(async () => ({ success: true, data: { nodes: [{ id: 'n1' }] } }));
      toolRegistry.register({
        name: 'character.list',
        process: 'entity-management',
        category: 'query',
        contextReplay: 'status_only',
        description: 'list',
        tier: 1,
        inputSchema: objectSchema({}, []),
        outputSchema: toolResultSchema(objectSchema({
          nodes: arraySchema(objectSchema({ id: stringSchema })),
        })),
        execute: listTool,
      });

      // Build 100 tool-call rounds with identical arguments to exercise the
      // bounded dedup path without relying on a persisted private graph.
      const rounds = 100;
      const responses: MockLLMResponse[] = [];
      for (let i = 0; i < rounds; i++) {
        responses.push({
          content: '',
          toolCalls: [{ id: `tc-${i}`, name: 'character.list', arguments: {} }],
          finishReason: 'tool_calls',
        });
      }
      responses.push({ content: 'done', toolCalls: [], finishReason: 'stop' });

      const adapter = createMockAdapter(responses);
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
        contextWindowTokens: 2_000_000,
      });
      await agent.execute('run many list calls', {}, () => {});

      expect(listTool).toHaveBeenCalled();
      expect(listTool.mock.calls.length).toBeLessThan(rounds);
      expect(adapter.completeWithTools).toHaveBeenCalledTimes(rounds + 1);
      expect(agent['contextGraph']).toBeNull();
    });

    it('50 rounds with 2 distinct arg shapes — structural invariants hold', async () => {
      toolRegistry.register({
        name: 'character.list',
        process: 'entity-management',
        category: 'query',
        contextReplay: 'status_only',
        description: 'list',
        tier: 1,
        inputSchema: objectSchema({ page: numberSchema }, []),
        outputSchema: toolResultSchema(objectSchema({}, [])),
        execute: vi.fn(async () => ({ success: true, data: {} })),
      });

      const rounds = 50;
      const responses: MockLLMResponse[] = [];
      for (let i = 0; i < rounds; i++) {
        responses.push({
          content: '',
          toolCalls: [{ id: `tc-${i}`, name: 'character.list', arguments: { page: i % 2 } }],
          finishReason: 'tool_calls',
        });
      }
      responses.push({ content: 'final', toolCalls: [], finishReason: 'stop' });

      const adapter = createMockAdapter(responses);
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
        contextWindowTokens: 2_000_000,
      });
      await expect(agent.execute('long', {}, () => {})).resolves.toBeDefined();

      const execute = toolRegistry.get('character.list')?.execute as ReturnType<typeof vi.fn>;
      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls.length).toBeLessThan(rounds);
      expect(adapter.completeWithTools).toHaveBeenCalledTimes(rounds + 1);
      expect(agent['contextGraph']).toBeNull();
    });
  });

  describe('Phase 5 resilience', () => {
    it('retries SERVICE_UNAVAILABLE and emits an llm_retry phase_note with jitter-bounded delay', async () => {
      // First call throws, second succeeds. The retry path should emit a
      // phase_note and resolve the run.
      vi.spyOn(Math, 'random').mockReturnValue(0); // delay = 0 → test runs fast
      const adapter = createMockAdapter([
        { content: 'hello', toolCalls: [], finishReason: 'stop' },
      ]);
      let callCount = 0;
      adapter.completeWithTools = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new LucidError(ErrorCode.ServiceUnavailable, 'transient');
        }
        return responseToStream({ content: 'hello', toolCalls: [], finishReason: 'stop' });
      });
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
      const emits: Array<{ kind: string; [k: string]: unknown }> = [];
      await agent.execute('hi', { canvasId: 'c1', extra: {} } as never, (event) =>
        emits.push(event as never),
      );
      expect(callCount).toBe(2);
      const retryNotes = emits.filter((e) => e.kind === 'phase_note' && e.note === 'llm_retry');
      expect(retryNotes).toHaveLength(1);
      expect(String((retryNotes[0].params as Record<string, unknown>).detail)).toMatch(
        /attempt 2 of 3 after \d+ms/,
      );
      vi.restoreAllMocks();
    });

    it('cancelCurrentStep aborts the in-flight step and lets the retry succeed', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      let callCount = 0;
      let sawSignal: AbortSignal | undefined;
      const adapter: LLMAdapter = {
        ...createMockAdapter([]),
        completeWithTools: vi.fn(async (_msgs, opts) => {
          callCount++;
          if (callCount === 1) {
            sawSignal = opts?.signal;
            // Simulate a stuck LLM: wait until the signal aborts, then throw.
            return (async function* () {
              await new Promise<void>((resolve, reject) => {
                opts?.signal?.addEventListener(
                  'abort',
                  () =>
                    reject(
                      new LucidError(ErrorCode.Cancelled, 'aborted', {
                        reason: 'step cancel',
                      }),
                    ),
                  { once: true },
                );
                if (opts?.signal?.aborted) reject(new LucidError(ErrorCode.Cancelled, 'aborted'));
                // Fallback: if nothing aborts in 500ms, fail the test hard.
                setTimeout(() => resolve(), 500);
              });
              yield { kind: 'finished', finishReason: 'stop' } as LLMStreamEvent;
            })();
          }
          return responseToStream({ content: 'recovered', toolCalls: [], finishReason: 'stop' });
        }),
      };
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
      const emits: Array<{ kind: string; [k: string]: unknown }> = [];
      const exec = agent.execute('hi', { canvasId: 'c1', extra: {} } as never, (event) =>
        emits.push(event as never),
      );
      // Give the first call a chance to install the signal listener.
      await new Promise((r) => setTimeout(r, 20));
      const { escalated } = agent.cancelCurrentStep();
      expect(escalated).toBe(false);
      await exec;
      expect(callCount).toBe(2);
      expect(sawSignal).toBeDefined();
      const retryNotes = emits.filter((e) => e.kind === 'phase_note' && e.note === 'llm_retry');
      expect(retryNotes).toHaveLength(1);
      expect(String((retryNotes[0].params as Record<string, unknown>).detail)).toContain(
        'step_cancel',
      );
      vi.restoreAllMocks();
    });

    it('cancelCurrentStep escalates to a full cancel when called twice within 2s', () => {
      const adapter = createMockAdapter([{ content: 'hi', toolCalls: [], finishReason: 'stop' }]);
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
      // Start execute() in the background so the abort controllers exist.
      void agent.execute('hi', { canvasId: 'c1', extra: {} } as never, () => {});
      const first = agent.cancelCurrentStep();
      const second = agent.cancelCurrentStep();
      expect(first.escalated).toBe(false);
      expect(second.escalated).toBe(true);
    });

    it('pauses at the next safe boundary and resumes the same run without scheduling work while paused', async () => {
      let releaseTool!: () => void;
      const toolStarted = new Promise<void>((resolve) => {
        toolRegistry.register({
          name: 'canvas.inspect',
          process: 'canvas-management',
          category: 'query',
          contextReplay: 'status_only',
          description: 'Inspect the Canvas',
          tier: 1,
          parameters: { type: 'object', properties: {}, required: [] },
          execute: vi.fn(async () => {
            resolve();
            await new Promise<void>((release) => {
              releaseTool = release;
            });
            return { success: true, data: { inspected: true } };
          }),
        });
      });
      const adapter = createMockAdapter([
        {
          content: '',
          toolCalls: [{ id: 'inspect-1', name: 'canvas.inspect', arguments: {} }],
          finishReason: 'tool_calls',
        },
        { content: 'Inspection complete', toolCalls: [], finishReason: 'stop' },
      ]);
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
      const events: Array<Record<string, unknown>> = [];
      const execution = agent.execute('Inspect', {}, (event) => events.push(event));

      await toolStarted;
      expect(agent.pause()).toBe(true);
      expect(adapter.completeWithTools).toHaveBeenCalledTimes(1);
      releaseTool();
      await vi.waitFor(() => {
        expect(events.some((event) => event.kind === 'run_paused')).toBe(true);
      });
      expect(adapter.completeWithTools).toHaveBeenCalledTimes(1);

      expect(agent.resume()).toBe(true);
      await execution;

      expect(events.some((event) => event.kind === 'run_resumed')).toBe(true);
      expect(adapter.completeWithTools).toHaveBeenCalledTimes(2);
    });

    it('cancels a paused run without resuming or scheduling another model step', async () => {
      let releaseTool!: () => void;
      const toolStarted = new Promise<void>((resolve) => {
        toolRegistry.register({
          name: 'canvas.inspect',
          process: 'canvas-management',
          category: 'query',
          contextReplay: 'status_only',
          description: 'Inspect the Canvas',
          tier: 1,
          parameters: { type: 'object', properties: {}, required: [] },
          execute: vi.fn(async () => {
            resolve();
            await new Promise<void>((release) => {
              releaseTool = release;
            });
            return { success: true, data: { inspected: true } };
          }),
        });
      });
      const adapter = createMockAdapter([
        {
          content: '',
          toolCalls: [{ id: 'inspect-1', name: 'canvas.inspect', arguments: {} }],
          finishReason: 'tool_calls',
        },
        { content: 'must not run', toolCalls: [], finishReason: 'stop' },
      ]);
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
      const events: Array<Record<string, unknown>> = [];
      const execution = agent.execute('Inspect', {}, (event) => events.push(event));

      await toolStarted;
      expect(agent.pause()).toBe(true);
      expect(agent.pause()).toBe(false);
      releaseTool();
      await vi.waitFor(() => {
        expect(events.some((event) => event.kind === 'run_paused')).toBe(true);
      });

      agent.cancel();
      await execution;

      expect(agent.resume()).toBe(false);
      expect(events.some((event) => event.kind === 'run_resumed')).toBe(false);
      expect(events).toContainEqual(expect.objectContaining({ kind: 'run_end', status: 'cancelled' }));
      expect(adapter.completeWithTools).toHaveBeenCalledTimes(1);
    });
  });

  describe('Phase G — per-turn tool-call dedup', () => {
    it('short-circuits an identical back-to-back call, emits tool_skipped_dedup, and only executes the original', async () => {
      const mockTool = vi.fn(async () => ({ success: true, data: { x: 1 } }));
      toolRegistry.register({
        name: 'character.list',
        process: 'entity-management',
        category: 'query',
        contextReplay: 'status_only',
        description: 'List characters',
        tier: 1,
        parameters: { type: 'object', properties: {}, required: [] },
        execute: mockTool,
      });

      // Step 1: model calls character.list({}).
      // Step 2: model calls character.list({}) again with identical args —
      //         dedup should short-circuit this one.
      // Step 3: model finishes.
      const adapter = createMockAdapter([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'character.list', arguments: {} }],
          finishReason: 'tool_calls',
        },
        {
          content: '',
          toolCalls: [{ id: 'tc-2', name: 'character.list', arguments: {} }],
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
      await agent.execute('list', {}, (e) => events.push(e as Record<string, unknown>));

      // Only the first call actually executes.
      expect(mockTool).toHaveBeenCalledTimes(1);

      // A tool_skipped_dedup phase_note fired for the second call.
      const skipNotes = events.filter(
        (e) => e.kind === 'phase_note' && e.note === 'tool_skipped_dedup',
      );
      expect(skipNotes).toHaveLength(1);
      const params = skipNotes[0]!.params as Record<string, unknown>;
      expect(params.toolDomain).toBe('character');
      expect(params.toolAction).toBe('list');
      expect(params.priorWasError).toBe(false);

      // A synthetic skipped tool_result was emitted for tc-2.
      const skippedResults = events.filter(
        (e) => e.kind === 'tool_result' && (e as Record<string, unknown>).skipped === true,
      );
      expect(skippedResults).toHaveLength(1);
      expect((skippedResults[0] as Record<string, unknown>).toolCallId).toBe('tc-2');
      expect((skippedResults[0] as Record<string, unknown>).synthetic).toBe(true);

      const finalRequest = vi.mocked(adapter.completeWithTools).mock.calls[2]?.[0] as Array<{
        role: string;
        content: string;
        toolCallId?: string;
      }>;
      const duplicateFact = finalRequest.find((message) => message.toolCallId === 'tc-2');
      expect(JSON.parse(duplicateFact?.content ?? '{}')).toMatchObject({
        success: false,
        error: 'Identical tool call was skipped because it already completed in this run.',
      });
      expect(duplicateFact?.content).not.toMatch(/change arguments|try a different|instead of/i);
    });

    it('does not short-circuit when args differ', async () => {
      const mockTool = vi.fn(async (args: unknown) => ({ success: true, data: args }));
      toolRegistry.register({
        name: 'character.get',
        process: 'entity-management',
        category: 'query',
        contextReplay: 'status_only',
        description: 'Get character',
        tier: 1,
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        execute: mockTool,
      });

      const adapter = createMockAdapter([
        {
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'character.get', arguments: { id: 'a' } }],
          finishReason: 'tool_calls',
        },
        {
          content: '',
          toolCalls: [{ id: 'tc-2', name: 'character.get', arguments: { id: 'b' } }],
          finishReason: 'tool_calls',
        },
        { content: 'done', toolCalls: [], finishReason: 'stop' },
      ]);

      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
      const events: Array<Record<string, unknown>> = [];
      await agent.execute('x', {}, (e) => events.push(e as Record<string, unknown>));

      expect(mockTool).toHaveBeenCalledTimes(2);
      const skipNotes = events.filter(
        (e) => e.kind === 'phase_note' && e.note === 'tool_skipped_dedup',
      );
      expect(skipNotes).toHaveLength(0);
    });

    it('does not reset tool-call deduplication when tool.get queries the registry', async () => {
      const target = vi.fn(async () => ({ success: true, data: { completed: true } }));
      toolRegistry.register({
        name: 'tool.get',
        process: 'meta',
        category: 'meta',
        contextReplay: 'status_only',
        description: 'Load tool schema',
        tier: 1,
        parameters: { type: 'object', properties: {}, required: [] },
        execute: vi.fn(async () => ({
          success: true,
          data: { tools: [{ name: 'test.execute' }] },
        })),
      });
      toolRegistry.register({
        name: 'test.execute',
        process: 'test',
        category: 'mutation',
        contextReplay: 'status_only',
        description: 'Execute a test action',
        tier: 2,
        parameters: { type: 'object', properties: {}, required: [] },
        execute: target,
      });
      const adapter = createMockAdapter([
        {
          content: '',
          toolCalls: [{ id: 'first', name: 'test.execute', arguments: {} }],
          finishReason: 'tool_calls',
        },
        {
          content: '',
          toolCalls: [{ id: 'discover', name: 'tool.get', arguments: { names: ['test.execute'] } }],
          finishReason: 'tool_calls',
        },
        {
          content: '',
          toolCalls: [{ id: 'retry', name: 'test.execute', arguments: {} }],
          finishReason: 'tool_calls',
        },
        { content: 'done', toolCalls: [], finishReason: 'stop' },
      ]);

      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
      await agent.execute('run test action', { page: 'canvas' }, () => {});

      expect(target).toHaveBeenCalledOnce();
    });
  });

});
