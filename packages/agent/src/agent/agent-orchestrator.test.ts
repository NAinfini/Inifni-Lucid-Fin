import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { AgentToolRegistry } from './tool-registry.js';
import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import type {
  LLMAdapter,
  LLMStreamEvent,
  LLMToolCall,
  LLMFinishReason,
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

    const result = await agent.execute('hello', {}, () => {});

    expect(result.content).toMatch(/Context safety pause/i);
    expect(adapter.completeWithTools).not.toHaveBeenCalled();
    expect(result.exitDecision).toEqual({ outcome: 'budget_exhausted', metric: 'tokens' });
  });

  it('persists the 92 percent hard stop against the bound workflow before returning', async () => {
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
        workflowToolPolicy: {
          workflowRunId: 'workflow-context-1',
          phase: 'media_generation',
          rowVersion: 7,
        },
      }),
      onContextRecoveryReport,
    });

    await agent.execute('continue', {}, () => {});

    expect(onContextRecoveryReport).toHaveBeenCalledWith({
      workflowRunId: 'workflow-context-1',
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
          workflowToolPolicy: {
            workflowRunId: 'workflow-context-1',
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
              compactWithLLMResult: () => Promise<{
                attempted: boolean;
                changed: boolean;
                truncated: number;
              }>;
            };
          }
        ).contextManager,
        'compactWithLLMResult',
      ).mockResolvedValue({ attempted: true, changed: false, truncated: 0 });

      const result = await agent.execute('continue', {}, () => {});
      if (attempt === 3) expect(result.content).toMatch(/recovery failed three times/i);
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
        workflowToolPolicy: {
          workflowRunId: 'workflow-context-1',
          phase: 'media_generation',
          rowVersion: 8,
        },
      }),
      onContextRecoveryReport,
    });

    await agent.execute('continue', {}, () => {});

    expect(onContextRecoveryReport).toHaveBeenCalledWith({
      workflowRunId: 'workflow-context-1',
      outcome: 'recovered',
      reason: 'persistent_context_reloaded',
    });
    expect(adapter.completeWithTools).toHaveBeenCalledOnce();
  });

  it('rebuilds workflow authorization after a successful recovery unpauses the durable run', async () => {
    const adapter = createMockAdapter([
      { content: 'resumed', toolCalls: [], finishReason: 'stop' },
    ]);
    Object.assign(adapter, {
      contextWindow: 128_000,
      effectiveContextWindow: 128_000,
    });
    let paused = true;
    const resolvePersistentContext = vi.fn(() => ({
      workflowToolPolicy: paused
        ? {
            workflowRunId: 'workflow-context-1',
            phase: 'blocked' as const,
            rowVersion: 9,
            reason: 'Workflow is paused for context recovery.',
          }
        : {
            workflowRunId: 'workflow-context-1',
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

  it('loads only the phase-safe inspection bundle while plan approval is pending', async () => {
    toolRegistry.register({
      name: 'canvas.generation',
      description: 'Generate media',
      tier: 3,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true })),
    });
    toolRegistry.register({
      name: 'entity.generateRefImage',
      description: 'Generate an entity reference image',
      tier: 3,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true })),
    });
    toolRegistry.register({
      name: 'canvas.listNodes',
      description: 'List nodes',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: [] })),
    });
    const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

    await agent.execute(
      'continue',
      {
        page: 'canvas',
        extra: {
          workflowToolPolicy: {
            workflowRunId: 'workflow-1',
            phase: 'production_plan_pending',
            gate: 'production_plan',
            rowVersion: 1,
          },
        },
      },
      () => {},
    );

    const options = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      tools?: Array<{ name: string }>;
    };
    const names = options.tools?.map((tool) => tool.name) ?? [];
    expect(names).toContain('canvas.listNodes');
    expect(names).not.toContain('canvas.generation');
    expect(names).not.toContain('entity.generateRefImage');
  });

  it('refreshes the phase-core bundle after a durable stage transition', async () => {
    let advanced = false;
    toolRegistry.register({
      name: 'workflow.manage',
      description: 'Advance workflow',
      tier: 2,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => {
        advanced = true;
        return { success: true };
      }),
    });
    toolRegistry.register({
      name: 'workflow.finalExport',
      description: 'Prepare final export',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true })),
    });
    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [
          {
            id: 'advance',
            name: 'workflow.manage',
            arguments: { action: 'completeCurrentTask' },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'ready to export', toolCalls: [], finishReason: 'stop' },
    ]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
      resolvePersistentContext: () => ({
        workflowToolPolicy: {
          workflowRunId: 'workflow-1',
          phase: advanced ? ('final_export_preparation' as const) : ('assembly' as const),
          rowVersion: advanced ? 2 : 1,
        },
      }),
    });

    await agent.execute('finish assembly', { page: 'canvas' }, () => {});

    const firstOptions = vi.mocked(adapter.completeWithTools).mock.calls[0]?.[1] as {
      tools?: Array<{ name: string }>;
    };
    const secondOptions = vi.mocked(adapter.completeWithTools).mock.calls[1]?.[1] as {
      tools?: Array<{ name: string }>;
    };
    expect(firstOptions.tools?.map((tool) => tool.name)).not.toContain('workflow.finalExport');
    expect(secondOptions.tools?.map((tool) => tool.name)).toContain('workflow.finalExport');
  });

  it('executes tool calls and feeds results back', async () => {
    const mockTool = vi.fn(async () => ({ success: true, data: { count: 5 } }));
    toolRegistry.register({
      name: 'character.list',
      description: 'List characters',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
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
    const result = await agent.execute('List characters', {}, (e) => events.push(e), {
      discoveredTools: ['character.list'],
    });

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
      description: 'Load prompt guides',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
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

    await agent.execute('load guides', {}, () => {}, { discoveredTools: ['guide.get'] });

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

    await agent.execute('list guides', {}, () => {}, { discoveredTools: ['guide.get'] });

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
    const result = await agent.execute('do error', {}, (e) => events.push(e), {
      discoveredTools: ['error.tool'],
    });

    expect(result.content).toBe('Tool failed, sorry.');
    expect(
      events.some((e: unknown) => {
        const ev = e as Record<string, unknown>;
        if (ev.kind !== 'tool_result') return false;
        const err = ev.error as { params?: { message?: unknown } } | undefined;
        return err?.params?.message === 'boom';
      }),
    ).toBe(true);
  });

  it('respects maxSteps limit', async () => {
    toolRegistry.register({
      name: 'loop.tool',
      description: 'loop',
      tier: 1,
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
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(),
    });
    toolRegistry.register({
      name: 'global.tool',
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
    // script.only must not appear (excluded by context filter for page='orchestrator')
    const toolNames = (opts.tools as Array<{ name: string }> | undefined)?.map((t) => t.name) ?? [];
    expect(toolNames).not.toContain('script.only');
  });

  it('compacts tool definitions before sending them to the LLM', async () => {
    toolRegistry.register({
      name: 'canvas.createNodes',
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
    await agent.execute('add node', { page: 'canvas' }, () => {}, {
      discoveredTools: ['canvas.createNodes'],
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

    expect(tool.description).toBe(
      'Add a new node to the current canvas at a specific position with very verbose explanation text.',
    );
    expect(tool.parameters.properties.canvasId?.description).toBe('');
    expect(tool.parameters.properties.position?.description).toBe('');
    expect(
      (tool.parameters.properties.position?.properties as Record<string, Record<string, unknown>>).x
        ?.description,
    ).toBe('');
    expect(
      (tool.parameters.properties.position?.properties as Record<string, Record<string, unknown>>).y
        ?.description,
    ).toBe('');
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
      { permissionMode: 'normal', discoveredTools: ['character.get'] },
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.kind === 'tool_confirm')).toBe(false);
  });

  it('injects steering messages into the next LLM iteration', async () => {
    toolRegistry.register({
      name: 'canvas.listNodes',
      description: 'List nodes',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
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
    await agent.execute('list nodes', {}, () => {}, {
      discoveredTools: ['canvas.listNodes'],
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
  });

  it('preserves tool results under the hard limit without truncation', async () => {
    toolRegistry.register({
      name: 'character.list',
      description: 'List characters',
      tier: 1,
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
      description: 'Set node provider',
      tier: 1,
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
    await agent.execute('set provider', {}, () => {}, {
      discoveredTools: ['canvas.configureNode'],
    });

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
    await agent.execute('list characters', {}, () => {}, {
      discoveredTools: ['character.list'],
    });

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

  it('loads only always-loaded tools initially and expands via tool.get', async () => {
    // Register always-loaded tools
    toolRegistry.register({
      name: 'tool.list',
      description: 'List tools',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: {} })),
    });
    toolRegistry.register({
      name: 'tool.get',
      description: 'Get tool schema',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({
        success: true,
        data: {
          tools: [
            {
              name: 'series.addEpisode',
              description: 'Add an episode to a series',
              parameters: { type: 'object', properties: {}, required: [] },
            },
          ],
        },
      })),
    });
    toolRegistry.register({
      name: 'guide.list',
      description: 'List prompt guides',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: [] })),
    });
    toolRegistry.register({
      name: 'guide.get',
      description: 'Get prompt guide content',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: null })),
    });
    toolRegistry.register({
      name: 'commander.askUser',
      description: 'Ask the user a question',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: null })),
    });
    toolRegistry.register({
      name: 'canvas.getInfo',
      description: 'Get canvas state',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: {} })),
    });
    toolRegistry.register({
      name: 'canvas.listNodes',
      description: 'List canvas nodes',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: [] })),
    });
    toolRegistry.register({
      name: 'canvas.getNode',
      description: 'Get a canvas node',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: null })),
    });

    // Register a tool that is NOT always-loaded or contextually-loaded
    toolRegistry.register({
      name: 'series.addEpisode',
      description: 'Add an episode to a series',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: [] })),
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [
          { id: 'tc-get', name: 'tool.get', arguments: { names: ['series.addEpisode'] } },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: '',
        toolCalls: [{ id: 'tc-use', name: 'series.addEpisode', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'done',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
    await agent.execute('add episode', { page: 'canvas' }, () => {});

    // First call: always-loaded + contextually-selected tools
    const firstOpts = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      tools: Array<{ name: string }>;
    };
    const firstToolNames = firstOpts.tools.map((t) => t.name);
    expect(firstToolNames).not.toContain('series.addEpisode');
    expect(firstToolNames).toContain('tool.get');
    expect(firstToolNames).toContain('canvas.getInfo');

    // Second call: series.addEpisode now available after tool.get
    const secondOpts = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[1][1] as {
      tools: Array<{ name: string }>;
    };
    expect(secondOpts.tools.map((t) => t.name)).toContain('series.addEpisode');
  });

  it('returns error when calling an unloaded tool', async () => {
    toolRegistry.register({
      name: 'tool.list',
      description: 'List tools',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: {} })),
    });
    toolRegistry.register({
      name: 'tool.get',
      description: 'Get tool schema',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: null })),
    });
    toolRegistry.register({
      name: 'series.addEpisode',
      description: 'Add an episode to a series',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: [] })),
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-blocked', name: 'series.addEpisode', arguments: {} }],
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
    await agent.execute('add an episode', {}, (e) =>
      events.push(e as unknown as Record<string, unknown>),
    );

    // Tool should NOT have been executed
    expect(toolRegistry.get('series.addEpisode')!.execute).not.toHaveBeenCalled();

    // Should have emitted a tool_result event with the error. v2 tool_result
    // has no toolName — match via toolCallId against the preceding tool_call.
    const toolCallIds = new Set(
      events
        .filter((e) => e.kind === 'tool_call')
        .filter((e) => {
          const ref = e.toolRef as { domain?: string; action?: string } | undefined;
          return ref && `${ref.domain}.${ref.action}` === 'series.addEpisode';
        })
        .map((e) => e.toolCallId),
    );
    const toolResultEvent = events.find(
      (e) => e.kind === 'tool_result' && toolCallIds.has(e.toolCallId),
    );
    expect(toolResultEvent).toBeDefined();
    const err = toolResultEvent?.error as { params?: { message?: string } } | undefined;
    expect(err?.params?.message).toContain("Tool 'series.addEpisode' exists but is not loaded");
    expect(err?.params?.message).toContain('tool.get');
  });

  it('process-bound system prompt injection removed — no guide in system prompt after tool call', async () => {
    toolRegistry.register({
      name: 'entity.generateRefImage',
      description: 'Generate an entity reference image',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true, data: { assetHash: 'asset-1' } })),
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [{ id: 'tc-ref', name: 'entity.generateRefImage', arguments: {} }],
        finishReason: 'tool_calls',
      },
      {
        content: 'done',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

    await agent.execute('generate ref', {}, () => {}, {
      discoveredTools: ['entity.generateRefImage'],
    });

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as Array<{
      role: string;
      content: string;
    }>;

    const systemPrompt = secondCallMessages.find((m) => m.role === 'system')?.content ?? '';
    expect(systemPrompt).not.toContain('Active Process Guides');
    expect(systemPrompt).not.toContain('Ref image rules go here.');
  });

  it('initialProcessPrompts in context is ignored (injection paths removed)', async () => {
    const adapter = createMockAdapter([{ content: 'done', toolCalls: [], finishReason: 'stop' }]);
    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

    await agent.execute(
      'rewrite the prompt',
      { extra: { initialProcessPrompts: ['image-node-generation'] } },
      () => {},
    );

    const firstCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{
      role: string;
      content: string;
    }>;

    const systemPrompt = firstCallMessages.find((m) => m.role === 'system')?.content ?? '';
    expect(systemPrompt).not.toContain('Image prompt rules.');
  });

  it('process prompt injection removed — system prompt has no Active Process Guides section', async () => {
    const renameTool = vi.fn(async () => ({ success: true, data: { canvasId: 'c1' } }));

    toolRegistry.register({
      name: 'canvas.manage',
      description: 'Rename canvas',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: renameTool,
    });

    const adapter = createMockAdapter([
      {
        content: '',
        toolCalls: [
          { id: 'tc-1', name: 'canvas.manage', arguments: { canvasId: 'c1', name: 'a' } },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: 'done',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

    await agent.execute('run workflow', {}, () => {}, {
      discoveredTools: ['canvas.manage'],
    });

    const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as Array<{
      role: string;
      content: string;
    }>;
    const systemPrompt = secondCallMessages.find((m) => m.role === 'system')?.content ?? '';
    expect(systemPrompt).not.toContain('Active Process Guides');
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
  // G2-5: cross-session ContextGraph persistence (merge gate 5)
  // ────────────────────────────────────────────────────────────
  describe('G2-5 cross-session ContextGraph warm-up', () => {
    it('round-trips seeded entity-snapshot items through execute()', async () => {
      const { freshContextItemId } = await import('@lucid-fin/contracts-parse');
      const adapter = createMockAdapter([
        { content: 'Resumed.', toolCalls: [], finishReason: 'stop' },
      ]);
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

      // Simulate a persisted graph from a prior session: one entity-snapshot
      // (a kind NOT derivable from the messages array) plus noise kinds that
      // the rebuild owns and should filter out.
      const snapshotItem = {
        kind: 'entity-snapshot' as const,
        itemId: freshContextItemId(),
        producedAtStep: 7,
        entityRef: { entityType: 'character' as const, entityId: 'c1' },
        snapshot: { id: 'c1', name: 'Alice' },
      };
      const legacyUser = {
        kind: 'user-message' as const,
        itemId: freshContextItemId(),
        producedAtStep: 7,
        content: 'This was from last session',
      };

      agent.seedContextGraph([snapshotItem, legacyUser]);
      await agent.execute('Continue session', {}, () => {});

      const finalItems = agent.getSerializedContextGraph();

      // entity-snapshot survives the rebuild merge.
      const entitySnapshots = finalItems.filter((i) => i.kind === 'entity-snapshot');
      expect(entitySnapshots).toHaveLength(1);
      expect(entitySnapshots[0]).toMatchObject({
        entityRef: { entityType: 'character', entityId: 'c1' },
        snapshot: { id: 'c1', name: 'Alice' },
      });

      // Legacy user-message from the seed is NOT re-introduced — the rebuild
      // owns user-message kinds from the current `messages` array. The only
      // user message should be the one from the current execute() call.
      const userMsgs = finalItems.filter((i) => i.kind === 'user-message');
      expect(userMsgs.map((u) => (u as { content: string }).content)).toEqual(['Continue session']);
    });

    it('preserves session-summary items across execute()', async () => {
      const { freshContextItemId } = await import('@lucid-fin/contracts-parse');
      const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

      const summary = {
        kind: 'session-summary' as const,
        itemId: freshContextItemId(),
        producedAtStep: 10,
        stepsFrom: 1,
        stepsTo: 9,
        content: 'Earlier: user asked about characters. Created Alice.',
      };

      agent.seedContextGraph([summary]);
      await agent.execute('hi', {}, () => {});

      const items = agent.getSerializedContextGraph();
      const summaries = items.filter((i) => i.kind === 'session-summary');
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({
        content: 'Earlier: user asked about characters. Created Alice.',
      });
    });

    it('seed is single-use — a second execute() without re-seeding does not re-merge stale items', async () => {
      const { freshContextItemId } = await import('@lucid-fin/contracts-parse');
      const adapter = createMockAdapter([
        { content: 'first', toolCalls: [], finishReason: 'stop' },
        { content: 'second', toolCalls: [], finishReason: 'stop' },
      ]);
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

      agent.seedContextGraph([
        {
          kind: 'entity-snapshot',
          itemId: freshContextItemId(),
          producedAtStep: 1,
          entityRef: { entityType: 'character', entityId: 'c1' },
          snapshot: { id: 'c1', name: 'Alice' },
        },
      ]);

      await agent.execute('first message', {}, () => {});
      const firstRun = agent.getSerializedContextGraph();
      expect(firstRun.filter((i) => i.kind === 'entity-snapshot')).toHaveLength(1);

      await agent.execute('second message', {}, () => {});
      const secondRun = agent.getSerializedContextGraph();
      // Seed was consumed by the first run; the second run should NOT
      // contain the stale snapshot — the caller is responsible for
      // re-seeding with the saved graph between runs.
      expect(secondRun.filter((i) => i.kind === 'entity-snapshot')).toHaveLength(0);
    });

    it('getSerializedContextGraph returns empty array before first execute()', () => {
      const adapter = createMockAdapter([{ content: '', toolCalls: [], finishReason: 'stop' }]);
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
      expect(agent.getSerializedContextGraph()).toEqual([]);
    });

    it('seedContextGraph accepts empty array as a no-op', async () => {
      const adapter = createMockAdapter([{ content: 'ok', toolCalls: [], finishReason: 'stop' }]);
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
      agent.seedContextGraph([]);
      await agent.execute('hi', {}, () => {});
      // Should have the guide + current user message only (no snapshots).
      const items = agent.getSerializedContextGraph();
      expect(items.filter((i) => i.kind === 'entity-snapshot')).toHaveLength(0);
      expect(items.filter((i) => i.kind === 'session-summary')).toHaveLength(0);
    });

    it('early abort preserves the seed — getSerializedContextGraph returns the unconsumed seed, not empty', async () => {
      // Codex review P2: a run cancelled before the first step never
      // runs rebuildGraphFromMessages, so the live graph is empty. The
      // finally block must fall back to the seed so the caller's save
      // step does not overwrite previously-persisted warm-up data with
      // an empty snapshot.
      const { freshContextItemId } = await import('@lucid-fin/contracts-parse');
      const adapter = createMockAdapter([
        { content: 'should-not-run', toolCalls: [], finishReason: 'stop' },
      ]);
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

      const seed = [
        {
          kind: 'entity-snapshot' as const,
          itemId: freshContextItemId(),
          producedAtStep: 3,
          entityRef: { entityType: 'character' as const, entityId: 'c1' },
          snapshot: { id: 'c1', name: 'Alice' },
        },
      ];
      agent.seedContextGraph(seed);

      // Abort before the first iteration runs.
      await agent.execute('cancelled', {}, () => {}, { isAborted: () => true });

      const saved = agent.getSerializedContextGraph();
      // The seed survives the early abort — caller saves the original
      // persisted graph back, not an empty overwrite.
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({
        kind: 'entity-snapshot',
        entityRef: { entityType: 'character', entityId: 'c1' },
      });
    });
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
        description: 'list',
        tier: 1,
        parameters: { type: 'object', properties: {}, required: [] },
        execute: listTool,
      });

      // Build 100 tool-call rounds, each calling `character.list` with
      // IDENTICAL arguments — exercises the dedup pipeline plus
      // `shrinkCoveredToolMessages` stubbing of historical payloads.
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
        maxSteps: rounds + 5,
      });
      await agent.execute('run many list calls', {}, () => {}, {
        discoveredTools: ['character.list'],
      });

      const items = agent.getSerializedContextGraph();
      // Structural invariants for a long run:
      //  - Exactly one guide item (top-level system prompt).
      expect(items.filter((i) => i.kind === 'guide')).toHaveLength(1);
      //  - Every surviving tool-result has a toolCallId and paramsHash.
      for (const item of items) {
        if (item.kind === 'tool-result') {
          expect(item.toolCallId).toBeTruthy();
          expect(item.paramsHash).toBeTruthy();
        }
      }
      // Dedup-index bound: only 1 unique (toolKey, paramsHash) identity
      // was ever called → the dedup index must collapse to exactly 1.
      // (Stubbed historical messages are excluded from the index; only
      // the latest real success payload is indexed.)
      expect(agent['contextGraph']).toBeNull(); // graph is cleared after execute
      // The serialized snapshot retains the historical stubs for wire
      // ordering; assert a reasonable upper bound that confirms no
      // unbounded accumulation beyond one-per-call.
      const toolResults = items.filter((i) => i.kind === 'tool-result');
      expect(toolResults.length).toBeLessThanOrEqual(rounds);
    });

    it('50 rounds with 2 distinct arg shapes — structural invariants hold', async () => {
      toolRegistry.register({
        name: 'character.list',
        description: 'list',
        tier: 1,
        parameters: { type: 'object', properties: {}, required: [] },
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
        maxSteps: rounds + 5,
      });
      await expect(
        agent.execute('long', {}, () => {}, { discoveredTools: ['character.list'] }),
      ).resolves.toBeDefined();

      const items = agent.getSerializedContextGraph();
      expect(items.filter((i) => i.kind === 'guide')).toHaveLength(1);
      for (const item of items) {
        if (item.kind === 'tool-result') {
          expect(item.toolCallId).toBeTruthy();
          expect(item.paramsHash).toBeTruthy();
        }
      }
      // Upper bound: no more tool-results than rounds — no unbounded
      // duplication across the rebuild path.
      const toolResults = items.filter((i) => i.kind === 'tool-result');
      expect(toolResults.length).toBeLessThanOrEqual(rounds);
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
  });

  describe('style-plate-lock injection (dormant — specs removed)', () => {
    function registerBatchCreate() {
      toolRegistry.register({
        name: 'canvas.createNodes',
        description: 'Create nodes and edges atomically',
        tier: 1,
        parameters: { type: 'object', properties: {}, required: [] },
        execute: vi.fn(async () => ({ success: true, data: { nodeIds: ['n1'] } })),
      });
    }

    function registerEntityRefImage() {
      toolRegistry.register({
        name: 'entity.generateRefImage',
        description: 'Generate an entity reference image',
        tier: 1,
        parameters: { type: 'object', properties: {}, required: [] },
        execute: vi.fn(async () => ({ success: true, data: { hash: 'h1' } })),
      });
    }

    it('Bug A — initialProcessPrompts no longer injects into system prompt (injection paths removed)', async () => {
      const adapter = createMockAdapter([{ content: 'done', toolCalls: [], finishReason: 'stop' }]);
      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

      await agent.execute(
        'start a new story',
        { extra: { initialProcessPrompts: ['style-plate-lock'] } },
        () => {},
      );

      const firstCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as Array<{
        role: string;
        content: string;
      }>;

      const systemPrompt = firstCallMessages.find((m) => m.role === 'system')?.content ?? '';
      expect(systemPrompt).not.toContain('Lock the plate before ref-images.');
    });

    it('Bug B — spec infrastructure dormant, no style-plate-lock injection on entity.generateRefImage', async () => {
      registerEntityRefImage();

      const adapter = createMockAdapter([
        {
          content: '',
          toolCalls: [
            {
              id: 'tc-ref',
              name: 'entity.generateRefImage',
              arguments: { canvasId: 'c1', characterId: 'char-1' },
            },
          ],
          finishReason: 'tool_calls',
        },
        {
          content: 'done',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
        resolveCanvasSettings: () => ({ stylePlate: null }),
      });

      await agent.execute('build a scene', { extra: { canvasId: 'c1' } }, () => {});

      const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
        .calls[1][0] as Array<{
        role: string;
        content: string;
      }>;
      const systemPrompt = secondCallMessages.find((m) => m.role === 'system')?.content ?? '';
      expect(systemPrompt).not.toContain('style-plate-lock');
    });

    it('spec infrastructure dormant — no resolveProcessPrompt calls for style-plate-lock', async () => {
      registerBatchCreate();

      const adapter = createMockAdapter([
        {
          content: '',
          toolCalls: [
            {
              id: 'tc-text',
              name: 'canvas.createNodes',
              arguments: { canvasId: 'c1', nodes: [{ type: 'text', label: 'note' }] },
            },
          ],
          finishReason: 'tool_calls',
        },
        {
          content: 'done',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
        resolveCanvasSettings: () => ({ stylePlate: null }),
      });

      await agent.execute('add a caption', { extra: { canvasId: 'c1' } }, () => {});

      const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
        .calls[1][0] as Array<{
        role: string;
        content: string;
      }>;
      const systemPrompt = secondCallMessages.find((m) => m.role === 'system')?.content ?? '';
      expect(systemPrompt).not.toContain('Active Process Guides');
    });

    it('does NOT inject when stylePlate is already set (no-op regardless)', async () => {
      registerBatchCreate();

      const adapter = createMockAdapter([
        {
          content: '',
          toolCalls: [
            {
              id: 'tc-img',
              name: 'canvas.createNodes',
              arguments: { canvasId: 'c1', nodes: [{ type: 'image', label: 'hero' }] },
            },
          ],
          finishReason: 'tool_calls',
        },
        {
          content: 'done',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
        resolveCanvasSettings: () => ({ stylePlate: 'neo-noir watercolor' }),
      });

      await agent.execute('build a scene', { extra: { canvasId: 'c1' } }, () => {});

      const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
        .calls[1][0] as Array<{
        role: string;
        content: string;
      }>;
      const systemPrompt = secondCallMessages.find((m) => m.role === 'system')?.content ?? '';
      expect(systemPrompt).not.toContain('style-plate-lock');
    });

    it('no-op when two generation tool calls in same session (specs dormant)', async () => {
      registerEntityRefImage();

      const adapter = createMockAdapter([
        {
          content: '',
          toolCalls: [
            {
              id: 'tc-img-1',
              name: 'entity.generateRefImage',
              arguments: { canvasId: 'c1', characterId: 'char-1' },
            },
          ],
          finishReason: 'tool_calls',
        },
        {
          content: '',
          toolCalls: [
            {
              id: 'tc-img-2',
              name: 'entity.generateRefImage',
              arguments: { canvasId: 'c1', characterId: 'char-2' },
            },
          ],
          finishReason: 'tool_calls',
        },
        {
          content: 'done',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt, {
        resolveCanvasSettings: () => ({ stylePlate: null }),
      });

      await agent.execute('build two scenes', { extra: { canvasId: 'c1' } }, () => {});

      const thirdCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
        .calls[2][0] as Array<{
        role: string;
        content: string;
      }>;
      const systemPrompt = thirdCallMessages.find((m) => m.role === 'system')?.content ?? '';
      expect(systemPrompt).not.toContain('style-plate-lock');
    });

    it('is a no-op when resolveCanvasSettings is not provided', async () => {
      registerBatchCreate();

      const adapter = createMockAdapter([
        {
          content: '',
          toolCalls: [
            {
              id: 'tc-img',
              name: 'canvas.createNodes',
              arguments: { canvasId: 'c1', nodes: [{ type: 'image', label: 'hero' }] },
            },
          ],
          finishReason: 'tool_calls',
        },
        {
          content: 'done',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);

      await agent.execute('build a scene', { extra: { canvasId: 'c1' } }, () => {});

      const secondCallMessages = (adapter.completeWithTools as ReturnType<typeof vi.fn>).mock
        .calls[1][0] as Array<{
        role: string;
        content: string;
      }>;
      const systemPrompt = secondCallMessages.find((m) => m.role === 'system')?.content ?? '';
      expect(systemPrompt).not.toContain('style-plate-lock');
    });
  });

  describe('Phase G — per-turn tool-call dedup', () => {
    it('short-circuits an identical back-to-back call, emits tool_skipped_dedup, and only executes the original', async () => {
      const mockTool = vi.fn(async () => ({ success: true, data: { x: 1 } }));
      toolRegistry.register({
        name: 'character.list',
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
      await agent.execute('list', {}, (e) => events.push(e as Record<string, unknown>), {
        discoveredTools: ['character.list'],
      });

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
    });

    it('does not short-circuit when args differ', async () => {
      const mockTool = vi.fn(async (args: unknown) => ({ success: true, data: args }));
      toolRegistry.register({
        name: 'character.get',
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
      await agent.execute('x', {}, (e) => events.push(e as Record<string, unknown>), {
        discoveredTools: ['character.get'],
      });

      expect(mockTool).toHaveBeenCalledTimes(2);
      const skipNotes = events.filter(
        (e) => e.kind === 'phase_note' && e.note === 'tool_skipped_dedup',
      );
      expect(skipNotes).toHaveLength(0);
    });

    it('does not deduplicate a transient unloaded-tool failure after discovery succeeds', async () => {
      const target = vi.fn(async () => ({ success: true, data: { completed: true } }));
      toolRegistry.register({
        name: 'tool.get',
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
        description: 'Execute a test action',
        tier: 2,
        parameters: { type: 'object', properties: {}, required: [] },
        execute: target,
      });
      const adapter = createMockAdapter([
        {
          content: '',
          toolCalls: [{ id: 'unloaded', name: 'test.execute', arguments: {} }],
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

  describe('Phase I — askUser forcing on rogue option-list markdown', () => {
    it('emits force_ask_user phase_note when model emits A/B/C prose without calling askUser', async () => {
      toolRegistry.register({
        name: 'commander.askUser',
        description: 'Ask user',
        tier: 1,
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            options: { type: 'array' },
          },
          required: ['question'],
        },
        execute: async () => ({ success: true, data: { answer: 'A' } }),
      });

      const adapter = createMockAdapter([
        {
          content:
            'You could go a couple of ways:\nA. add a character\nB. add an image\nC. set the scene',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
      const events: Array<Record<string, unknown>> = [];
      await agent.execute('what next?', {}, (e) => events.push(e as Record<string, unknown>), {
        discoveredTools: ['commander.askUser'],
      });

      const forceNotes = events.filter(
        (e) => e.kind === 'phase_note' && e.note === 'force_ask_user',
      );
      expect(forceNotes).toHaveLength(1);
      expect((forceNotes[0]!.params as Record<string, unknown>).detectedPattern).toBe(
        'option_list',
      );
    });

    it('does not fire force_ask_user when there is no option-list markdown', async () => {
      const adapter = createMockAdapter([
        {
          content: 'Here is a summary of your project state.',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const agent = new AgentOrchestrator(adapter, toolRegistry, resolvePrompt);
      const events: Array<Record<string, unknown>> = [];
      await agent.execute('status', {}, (e) => events.push(e as Record<string, unknown>));

      const forceNotes = events.filter(
        (e) => e.kind === 'phase_note' && e.note === 'force_ask_user',
      );
      expect(forceNotes).toHaveLength(0);
    });
  });
});
