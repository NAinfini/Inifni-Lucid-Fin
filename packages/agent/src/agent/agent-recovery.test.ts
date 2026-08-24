import { describe, expect, it, vi } from 'vitest';
import type {
  LLMAdapter,
  LLMMessage,
  LLMStreamEvent,
  LLMToolCall,
} from '@lucid-fin/contracts';
import { AgentOrchestrator, type AgentRecoveryState } from './agent-orchestrator.js';
import { RunResourceBudgetController } from './run-resource-budget.js';
import {
  makeStampedEmit,
  type StampedStreamEmission,
  type StampedStreamSink,
} from './stream-emit.js';
import { ToolExecutor } from './tool-executor.js';
import {
  NO_TOOL_RESOURCE,
  ToolRegistry,
  toolResultSchema,
  type ToolDefinition,
} from './tool-registry.js';

async function* responseStream(response: {
  content: string;
  reasoning?: string;
  toolCalls?: LLMToolCall[];
  finishReason: 'stop' | 'tool_calls';
}): AsyncIterable<LLMStreamEvent> {
  if (response.reasoning) yield { kind: 'reasoning_delta', delta: response.reasoning };
  if (response.content) yield { kind: 'text_delta', delta: response.content };
  for (const call of response.toolCalls ?? []) {
    yield { kind: 'tool_call_started', id: call.id, name: call.name };
    yield {
      kind: 'tool_call_complete',
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      thoughtSignature: call.thoughtSignature,
    };
  }
  yield { kind: 'finished', finishReason: response.finishReason };
}

function adapterFor(
  responses: Array<{
    content: string;
    reasoning?: string;
    toolCalls?: LLMToolCall[];
    finishReason: 'stop' | 'tool_calls';
  }>,
): LLMAdapter & { requests: LLMMessage[][] } {
  let index = 0;
  const requests: LLMMessage[][] = [];
  return {
    id: 'recovery-test',
    name: 'Recovery test',
    capabilities: ['text-generation'],
    requests,
    configure: vi.fn(),
    validate: vi.fn(async () => true),
    complete: vi.fn(async () => ''),
    stream: vi.fn(async function* () {}),
    completeWithTools: vi.fn(async (messages) => {
      requests.push(structuredClone(messages));
      return responseStream(responses[Math.min(index++, responses.length - 1)]!);
    }),
  };
}

function collector(initialSeq = 0) {
  const emissions: StampedStreamEmission[] = [];
  const sink = ((emission: StampedStreamEmission) => emissions.push(emission)) as StampedStreamSink;
  sink.batch = (batch) => emissions.push(...batch);
  return { emissions, emit: makeStampedEmit('run-tool', () => 1, sink, initialSeq) };
}

function registerMutation(registry: ToolRegistry, execute: ToolDefinition['execute']): void {
  registry.register({
    name: 'canvas.mutate',
    description: 'Mutate canvas',
    process: 'canvas',
    category: 'mutation',
    contextReplay: 'status_only',
    resource: NO_TOOL_RESOURCE,
    tier: 1,
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string' },
        prompt: { type: 'string' },
      },
      required: ['canvasId', 'prompt'],
    },
    outputSchema: toolResultSchema({
      type: 'object',
      properties: { applied: { type: 'boolean' } },
      required: ['applied'],
    }),
    execute,
  });
}

function recoveryState(overrides: Partial<AgentRecoveryState> = {}): AgentRecoveryState {
  return {
    history: [{ role: 'user', content: 'Create it' }],
    completedSteps: [1],
    dedupSeeds: [],
    startPaused: false,
    ...overrides,
  };
}

describe('Commander Agent recovery surface', () => {
  it('keeps reasoning out of model checkpoints and pairs every resource state with a checkpoint', async () => {
    let now = 10;
    const adapter = adapterFor([
      { content: 'Done', reasoning: 'private chain of thought', finishReason: 'stop' },
    ]);
    const agent = new AgentOrchestrator(adapter, new ToolRegistry(), () => 'system', {
      resourceNow: () => now++,
    });
    const emissions: StampedStreamEmission[] = [];

    await agent.execute('Hello', {}, (emission) => emissions.push(emission));

    const completed = emissions.find(
      (emission) => emission.kind === 'public_progress' && emission.status === 'completed',
    );
    expect(completed && 'recovery' in completed ? completed.recovery : undefined).toMatchObject({
      kind: 'model_checkpoint',
      content: 'Done',
      finishReason: 'stop',
      toolCalls: [],
      completedStep: 1,
    });
    expect(completed && 'recovery' in completed ? completed.recovery : {}).not.toHaveProperty(
      'reasoning',
    );
    expect(completed && 'event' in completed ? completed.event : undefined).toMatchObject({
      kind: 'public_progress',
      status: 'completed',
    });
    expect(completed && 'event' in completed ? completed.event : {}).not.toHaveProperty('recovery');

    const resourceStates = emissions.filter((emission) => emission.kind === 'resource_state');
    expect(resourceStates.length).toBeGreaterThan(0);
    expect(
      resourceStates.every(
        (emission) => 'recovery' in emission && emission.recovery.kind === 'resource_checkpoint',
      ),
    ).toBe(true);
  });

  it('keeps merged arguments and the full normalized result only in the internal recovery path', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'test.secret',
      description: 'Secret tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      inputSchema: {
        type: 'object',
        properties: { canvasId: { type: 'string' }, prompt: { type: 'string' } },
        required: ['canvasId', 'prompt'],
      },
      outputSchema: toolResultSchema({
        type: 'object',
        properties: { secret: { type: 'string' }, count: { type: 'number' } },
        required: ['secret', 'count'],
      }),
      projectPublicArguments: (args) => ({ canvasId: args.canvasId }),
      projectPublicResult: () => ({ summary: 'completed' }),
      execute: async () => ({ success: true, data: { secret: 'never-public', count: 2 } }),
    });
    const executor = new ToolExecutor(registry, { canvasId: 'canvas-1' });
    const { emissions, emit } = collector();

    await executor.executeSingle(
      { id: 'call-1', name: 'test.secret', arguments: { prompt: 'private-prompt' } },
      emit,
    );

    const call = emissions.find((emission) => emission.kind === 'tool_call');
    expect(call).toMatchObject({ args: { canvasId: 'canvas-1', prompt: 'private-prompt' } });
    const result = emissions.find((emission) => emission.kind === 'tool_result');
    expect(JSON.stringify(result?.projection)).not.toContain('never-public');
    expect(result && 'recovery' in result ? result.recovery : undefined).toEqual({
      kind: 'tool_result',
      result: { success: true, data: { secret: 'never-public', count: 2 } },
    });
    const privateResult = result && 'recovery' in result && result.recovery.kind === 'tool_result'
      ? result.recovery.result
      : undefined;
    expect(Object.isFrozen(privateResult)).toBe(true);
    expect(Object.isFrozen((privateResult as { data: object }).data)).toBe(true);
  });

  it('never attaches invalid tool output to a recovery supplement', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'test.invalid',
      description: 'Invalid tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      inputSchema: { type: 'object', properties: {} },
      outputSchema: toolResultSchema({
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      }),
      execute: async () => ({ success: true, data: { value: 42 } }),
    });
    const executor = new ToolExecutor(registry);
    const { emissions, emit } = collector();

    await executor.executeSingle({ id: 'bad-1', name: 'test.invalid', arguments: {} }, emit);

    const result = emissions.find((emission) => emission.kind === 'tool_result');
    expect(result).toMatchObject({ status: 'failed', errorCode: 'INVALID_TOOL_OUTPUT' });
    expect(result && 'recovery' in result).toBe(false);
  });

  it('pairs tool quota and metered resource transitions with checkpoints', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'test.metered',
      description: 'Metered tool',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: {
        kind: 'metered',
        quote: () => ({
          tokens: { knowledge: 'estimated', value: 1, upperBound: true },
          toolCalls: 0,
          costUsd: { knowledge: 'estimated', value: 0.01, upperBound: true },
        }),
      },
      tier: 1,
      inputSchema: { type: 'object', properties: {} },
      outputSchema: toolResultSchema({
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      }),
      execute: async () => ({ success: true, data: { value: 'done' } }),
    });
    const controller = new RunResourceBudgetController({ maxToolCalls: 1 });
    const executor = new ToolExecutor(registry, {
      currentStep: 1,
      resourceController: controller,
    });
    const { emissions, emit } = collector();

    await executor.executeToolCalls(
      [{ id: 'metered-1', name: 'test.metered', arguments: {} }],
      emit,
      [],
      () => false,
      new Map(),
      new Map(),
    );

    const resourceStates = emissions.filter((emission) => emission.kind === 'resource_state');
    expect(resourceStates.map((state) => state.cause.kind)).toEqual([
      'reserved',
      'settled',
      'reserved',
      'settled',
    ]);
    expect(
      resourceStates.every(
        (emission) => 'recovery' in emission && emission.recovery.kind === 'resource_checkpoint',
      ),
    ).toBe(true);
  });

  it('continues history, step, sequence, and mutation dedup without repeating the initial user input', async () => {
    const execute = vi.fn(async () => ({ success: true, data: { applied: true } }));
    const registry = new ToolRegistry();
    registerMutation(registry, execute);
    const adapter = adapterFor([
      {
        content: '',
        toolCalls: [{ id: 'new-call', name: 'canvas.mutate', arguments: { prompt: 'same' } }],
        finishReason: 'tool_calls',
      },
      { content: 'Already done', finishReason: 'stop' },
    ]);
    const agent = new AgentOrchestrator(adapter, registry, () => 'system');
    const resourceController = new RunResourceBudgetController({}, { leaseId: 'run-resume' });
    const emissions: StampedStreamEmission[] = [];

    await agent.execute('Create it', { extra: { canvasId: 'canvas-1' } }, (emission) => {
      emissions.push(emission);
    }, {
      runId: 'run-resume',
      initialSeq: 40,
      resourceController,
      recoveryState: recoveryState({
        completedSteps: [1, 4, 2],
        history: [
          { role: 'user', content: 'Create it' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{
              id: 'old-call',
              name: 'canvas.mutate',
              arguments: { canvasId: 'canvas-1', prompt: 'same' },
            }],
          },
          {
            role: 'tool',
            content: JSON.stringify({ success: true, data: { applied: true } }),
            toolCallId: 'old-call',
          },
        ],
        dedupSeeds: [{
          toolRef: { domain: 'canvas', action: 'mutate' },
          args: { canvasId: 'canvas-1', prompt: 'same' },
          toolCallId: 'old-call',
          step: 4,
          wasError: false,
        }],
      }),
    });

    expect(execute).not.toHaveBeenCalled();
    expect(adapter.requests[0]?.filter((message) => message.role === 'user')).toEqual([
      { role: 'user', content: 'Create it' },
    ]);
    expect(emissions.some((emission) => emission.kind === 'run_start')).toBe(false);
    expect(
      emissions.some(
        (emission) => emission.kind === 'resource_state' && emission.cause.kind === 'initialized',
      ),
    ).toBe(false);
    expect(emissions[0]?.seq).toBe(40);
    expect(emissions.filter((emission) => emission.kind === 'public_progress')[0]?.step).toBe(5);
  });

  it('waits at a restored paused boundary and supports both resume and cancel', async () => {
    const resumedAdapter = adapterFor([{ content: 'Resumed', finishReason: 'stop' }]);
    const resumedAgent = new AgentOrchestrator(resumedAdapter, new ToolRegistry(), () => 'system');
    const resumedController = new RunResourceBudgetController({}, { leaseId: 'run-paused' });
    resumedController.startPause();
    const resumedEvents: StampedStreamEmission[] = [];
    const resumed = resumedAgent.execute('Create it', {}, (emission) => resumedEvents.push(emission), {
      runId: 'run-paused',
      initialSeq: 8,
      resourceController: resumedController,
      recoveryState: recoveryState({ startPaused: true }),
    });

    expect(resumedAgent.resume()).toBe(true);
    await resumed;
    expect(resumedAdapter.completeWithTools).toHaveBeenCalledOnce();
    expect(resumedEvents.some((emission) => emission.kind === 'run_paused')).toBe(false);
    expect(resumedEvents.some((emission) => emission.kind === 'run_resumed')).toBe(true);

    const cancelledAdapter = adapterFor([{ content: 'must not run', finishReason: 'stop' }]);
    const cancelledAgent = new AgentOrchestrator(cancelledAdapter, new ToolRegistry(), () => 'system');
    const cancelledController = new RunResourceBudgetController({}, { leaseId: 'run-cancelled' });
    cancelledController.startPause();
    const cancelledEvents: StampedStreamEmission[] = [];
    const cancelled = cancelledAgent.execute(
      'Create it',
      {},
      (emission) => cancelledEvents.push(emission),
      {
        runId: 'run-cancelled',
        initialSeq: 12,
        resourceController: cancelledController,
        recoveryState: recoveryState({ startPaused: true }),
      },
    );

    cancelledAgent.cancel();
    await cancelled;
    expect(cancelledAdapter.completeWithTools).not.toHaveBeenCalled();
    expect(cancelledEvents.some((emission) => emission.kind === 'cancelled')).toBe(true);
  });
});
