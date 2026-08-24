import { describe, expect, it, vi } from 'vitest';
import { ToolExecutor } from './tool-executor.js';
import { makeStampedEmit, type StampedStreamEvent } from './stream-emit.js';
import {
  NO_TOOL_RESOURCE,
  ToolRegistry,
  toolResultSchema,
  type ToolDefinition,
} from './tool-registry.js';
import {
  arraySchema,
  booleanSchema,
  canonicalJsonSchema,
  numberSchema,
  objectSchema,
  stringSchema,
  unionSchema,
} from './tools/tool-runtime-schemas.js';
import { RunResourceBudgetController } from './run-resource-budget.js';
import {
  TOOL_PROGRAM_LIMITS,
  createToolProgramTool,
  executeToolProgram,
  parseToolProgram,
  type ToolProgramChildCall,
  type ToolProgramHost,
} from './tool-program.js';

const literal = (value: unknown) => ({ kind: 'literal' as const, value });
const input = (path?: Array<string | number>) => ({ kind: 'input' as const, ...(path ? { path } : {}) });
const step = (stepId: string, path?: Array<string | number>) => ({
  kind: 'step' as const,
  stepId,
  ...(path ? { path } : {}),
});
const item = (path?: Array<string | number>) => ({ kind: 'item' as const, ...(path ? { path } : {}) });

function fakeHost(runId = 'run-1') {
  const dispatched: ToolProgramChildCall[][] = [];
  const host: ToolProgramHost = {
    runId,
    beforeDispatch: async () => 'ready',
    dispatch: async (calls) => {
      dispatched.push([...calls]);
      return calls.map((call) => ({
        operationId: call.operationId,
        success: true,
        value: call.args.value,
      }));
    },
  };
  return { host, dispatched };
}

function makeTool(
  name: string,
  execute: ToolDefinition['execute'],
  overrides: Partial<ToolDefinition> = {},
): ToolDefinition {
  return {
    name,
    description: name,
    process: 'test',
    category: 'query',
    contextReplay: 'status_only',
    resource: NO_TOOL_RESOURCE,
    tier: 1,
    inputSchema: {
      type: 'object',
      properties: {
        value: unionSchema(
          stringSchema,
          numberSchema,
          booleanSchema,
          objectSchema({}, [], true),
          arraySchema(unionSchema(stringSchema, numberSchema, booleanSchema, objectSchema({}, [], true))),
        ),
      },
      required: ['value'],
    },
    outputSchema: toolResultSchema(canonicalJsonSchema, { dataOptional: true }),
    execute,
    ...overrides,
  };
}

function makeEmitCollector(runId = 'run-1') {
  const events: StampedStreamEvent[] = [];
  const sink = ((event: StampedStreamEvent) => events.push(event)) as
    ((event: StampedStreamEvent) => void) & { batch(events: readonly StampedStreamEvent[]): void };
  sink.batch = (batch) => events.push(...batch);
  return { events, emit: makeStampedEmit(runId, () => 1, sink) };
}

describe('typed tool program', () => {
  it('executes call, map, validate, sort, take, and batch with stable operation IDs', async () => {
    const { host, dispatched } = fakeHost('run-a');
    const result = await executeToolProgram(
      {
        version: 1,
        steps: [
          { id: 'load', op: 'call', tool: 'data.echo', args: { value: input(['items']) } },
          { id: 'check', op: 'validate', value: step('load'), expect: { type: 'array', minItems: 2 } },
          { id: 'ordered', op: 'sort', source: step('check'), path: ['rank'], direction: 'asc' },
          { id: 'first', op: 'take', source: step('ordered'), count: 2 },
          {
            id: 'mapped',
            op: 'map',
            source: step('first'),
            maxItems: 4,
            concurrency: 2,
            tool: 'data.echo',
            args: { value: item() },
          },
          {
            id: 'names',
            op: 'batch',
            concurrency: 2,
            calls: [
              { tool: 'data.echo', args: { value: step('mapped', [0, 'name']) } },
              { tool: 'data.echo', args: { value: step('mapped', [1, 'name']) } },
            ],
          },
        ],
      },
      { items: [{ name: 'b', rank: 2 }, { name: 'a', rank: 1 }, { name: 'c', rank: 3 }] },
      host,
    );

    expect(result).toMatchObject({
      success: true,
      data: { stepCount: 6, callCount: 5, result: ['a', 'b'] },
    });
    expect(dispatched.flat().map((call) => call.operationId)).toEqual([
      'program:run-a:load:0',
      'program:run-a:mapped:0',
      'program:run-a:mapped:1',
      'program:run-a:names:0',
      'program:run-a:names:1',
    ]);
  });

  it('rejects nested programs, dynamic tools, unknown operations, and executable fields', () => {
    const base = (entry: Record<string, unknown>) => ({ version: 1, steps: [{ id: 'x', ...entry }] });
    expect(() => parseToolProgram(base({ op: 'call', tool: 'tool.program', args: {} }))).toThrow(/Nested/);
    expect(() => parseToolProgram(base({ op: 'call', tool: input(['tool']), args: {} }))).toThrow(/static canonical/);
    expect(() => parseToolProgram(base({ op: 'script', source: 'return 1' }))).toThrow(/unsupported/);
    expect(() => parseToolProgram(base({ op: 'call', tool: 'data.echo', args: {}, code: 'return 1' }))).toThrow(/unsupported field/);
  });

  it('accepts bounded AI-authored display metadata and trims it at the parser boundary', () => {
    expect(parseToolProgram({
      version: 1,
      displayName: '  Inspect assets  ',
      objective: '  Read authorized asset metadata.  ',
      steps: [{ id: 'read', op: 'call', tool: 'data.echo', args: {} }],
    })).toMatchObject({
      displayName: 'Inspect assets',
      objective: 'Read authorized asset metadata.',
    });
    expect(() => parseToolProgram({
      version: 1,
      displayName: 'x'.repeat(241),
      steps: [{ id: 'read', op: 'call', tool: 'data.echo', args: {} }],
    })).toThrow(/1 to 240 characters/);
    expect(() => parseToolProgram({
      version: 1,
      objective: 'x'.repeat(4_001),
      steps: [{ id: 'read', op: 'call', tool: 'data.echo', args: {} }],
    })).toThrow(/1 to 4000 characters/);
  });

  it('enforces AST, step, map, concurrency, and actual child-call limits before extra dispatch', async () => {
    expect(() => parseToolProgram({
      version: 1,
      steps: Array.from({ length: TOOL_PROGRAM_LIMITS.maxSteps + 1 }, (_, index) => ({
        id: `s${index}`,
        op: 'call',
        tool: 'data.echo',
        args: { value: literal(index) },
      })),
    })).toThrow(/1 to 32 steps/);
    expect(() => parseToolProgram({
      version: 1,
      steps: [{ id: 'x', op: 'call', tool: 'data.echo', args: { value: literal('界'.repeat(11_000)) } }],
    })).toThrow(/32768 UTF-8 bytes/);
    expect(() => parseToolProgram({
      version: 1,
      steps: [{ id: 'x', op: 'map', source: literal([]), maxItems: 65, concurrency: 1, tool: 'data.echo', args: {} }],
    })).toThrow(/maxItems/);
    expect(() => parseToolProgram({
      version: 1,
      steps: [{ id: 'x', op: 'map', source: literal([]), maxItems: 1, concurrency: 5, tool: 'data.echo', args: {} }],
    })).toThrow(/concurrency/);

    const { host, dispatched } = fakeHost();
    const calls = (count: number) => Array.from({ length: count }, (_, index) => ({
      tool: 'data.echo',
      args: { value: literal(index) },
    }));
    const result = await executeToolProgram(
      {
        version: 1,
        steps: [
          { id: 'first', op: 'batch', concurrency: 4, calls: calls(40) },
          { id: 'second', op: 'batch', concurrency: 4, calls: calls(25) },
        ],
      },
      {},
      host,
    );
    expect(result).toMatchObject({
      success: false,
      errorClass: 'validation',
      error: expect.stringContaining('completed 1 steps and 40 child calls'),
    });
    expect(result).not.toHaveProperty('data');
    expect(dispatched.flat()).toHaveLength(40);
  });

  it('does not dispatch another child after the parent pause/cancel boundary reports cancellation', async () => {
    const dispatch = vi.fn(async (calls: readonly ToolProgramChildCall[]) =>
      calls.map((call) => ({ operationId: call.operationId, success: true, value: call.args.value })),
    );
    let boundary = 0;
    const host: ToolProgramHost = {
      runId: 'run-cancel',
      beforeDispatch: async () => (++boundary === 1 ? 'ready' : 'cancelled'),
      dispatch,
    };
    await expect(executeToolProgram(
      {
        version: 1,
        steps: [
          { id: 'one', op: 'call', tool: 'data.echo', args: { value: literal(1) } },
          { id: 'two', op: 'call', tool: 'data.echo', args: { value: literal(2) } },
        ],
      },
      {},
      host,
    )).rejects.toThrow(/cancelled/);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('Tool Program canonical executor integration', () => {
  it('routes child execution through one host lifecycle while keeping the parent result aggregate-only', async () => {
    const execute = vi.fn(async (args: Record<string, unknown>) => ({
      success: true,
      data: args.value,
    }));
    const registry = new ToolRegistry();
    registry.register(createToolProgramTool());
    registry.register(makeTool('data.echo', execute));
    const resourceController = new RunResourceBudgetController({ maxToolCalls: 3 });
    const parent = makeEmitCollector('parent-run');
    const child = makeEmitCollector('child-run');
    const finalize = vi.fn();
    const beforeDispatch = vi.fn(async () => 'ready' as const);
    const lifecycleFactory = vi.fn(async () => ({
      runId: 'child-run',
      emit: child.emit,
      beforeDispatch,
      isCancelled: () => false,
      finalize,
    }));
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];

    await new ToolExecutor(registry, {
      runId: 'parent-run',
      permissionMode: 'danger',
      resourceController,
      toolProgramLifecycleFactory: lifecycleFactory,
    }).executeToolCalls(
      [{
        id: 'outer',
        name: 'tool.program',
        arguments: {
          program: {
            version: 1,
            displayName: 'Inspect assets',
            objective: 'Read two assets and return their normalized records.',
            steps: [
              { id: 'one', op: 'call', tool: 'data.echo', args: { value: literal({ n: 1 }) } },
              { id: 'two', op: 'call', tool: 'data.echo', args: { value: literal({ n: 2 }) } },
            ],
          },
        },
      }],
      parent.emit,
      messages,
      () => false,
      new Map(),
      new Map(),
    );

    expect(lifecycleFactory).toHaveBeenCalledWith({
      parentRunId: 'parent-run',
      displayName: 'Inspect assets',
      objective: 'Read two assets and return their normalized records.',
      resourceController,
    });
    expect(parent.events.filter((event) => event.kind === 'tool_call')).toEqual([
      expect.objectContaining({ toolCallId: 'outer', toolRef: { domain: 'tool', action: 'program' } }),
    ]);
    expect(child.events.filter((event) => event.kind === 'tool_call')).toEqual([
      expect.objectContaining({ toolCallId: 'program:child-run:one:0' }),
      expect.objectContaining({ toolCallId: 'program:child-run:two:0' }),
    ]);
    expect(child.events.filter((event) => event.kind === 'tool_result')).toHaveLength(2);
    expect(child.events.some((event) => event.kind === 'resource_state')).toBe(true);
    expect(messages.at(-1)?.content).toContain('"callCount":2');
    expect(beforeDispatch).toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith({ status: 'completed' });
  });

  it('finalizes the child with the typed blocker and shares the parent budget controller', async () => {
    const registry = new ToolRegistry();
    registry.register(createToolProgramTool());
    registry.register(makeTool('data.echo', vi.fn(async () => ({ success: true }))));
    const resourceController = new RunResourceBudgetController({ maxToolCalls: 1 });
    const parent = makeEmitCollector('parent-run');
    const child = makeEmitCollector('child-run');
    const finalize = vi.fn();
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];

    const result = await new ToolExecutor(registry, {
      runId: 'parent-run',
      permissionMode: 'danger',
      resourceController,
      toolProgramLifecycleFactory: async ({ resourceController: received }) => {
        expect(received).toBe(resourceController);
        return {
          runId: 'child-run',
          emit: child.emit,
          beforeDispatch: async () => 'ready',
          isCancelled: () => false,
          finalize,
        };
      },
    }).executeToolCalls(
      [{
        id: 'outer',
        name: 'tool.program',
        arguments: {
          program: {
            version: 1,
            steps: [{ id: 'one', op: 'call', tool: 'data.echo', args: { value: literal(1) } }],
          },
        },
      }],
      parent.emit,
      messages,
      () => false,
      new Map(),
      new Map(),
    );

    expect(result.blocked).toMatchObject({ kind: 'resource_budget', metric: 'tool_calls' });
    expect(finalize).toHaveBeenCalledWith({
      status: 'blocked',
      blocker: { kind: 'resource_budget', metric: 'tool_calls', reason: 'exhausted' },
    });
  });

  it('checks parent and child cooperative boundaries before dispatch and finalizes cancellation', async () => {
    const execute = vi.fn(async () => ({ success: true }));
    const registry = new ToolRegistry();
    registry.register(createToolProgramTool());
    registry.register(makeTool('data.echo', execute));
    const resourceController = new RunResourceBudgetController({});
    const parent = makeEmitCollector('parent-run');
    const child = makeEmitCollector('child-run');
    const parentBoundary = vi.fn(async () => undefined);
    const childBoundary = vi.fn(async () => 'cancelled' as const);
    const finalize = vi.fn();

    await new ToolExecutor(registry, {
      runId: 'parent-run',
      permissionMode: 'danger',
      resourceController,
      beforeProgramDispatch: parentBoundary,
      toolProgramLifecycleFactory: async () => ({
        runId: 'child-run',
        emit: child.emit,
        beforeDispatch: childBoundary,
        isCancelled: () => true,
        finalize,
      }),
    }).executeToolCalls(
      [{
        id: 'outer',
        name: 'tool.program',
        arguments: {
          program: {
            version: 1,
            steps: [{ id: 'read', op: 'call', tool: 'data.echo', args: { value: literal(1) } }],
          },
        },
      }],
      parent.emit,
      [],
      () => false,
      new Map(),
      new Map(),
    );

    expect(parentBoundary).toHaveBeenCalledOnce();
    expect(childBoundary).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith({ status: 'cancelled' });
  });

  it('uses the canonical executor, rejects unknown tools, and redacts the outer AST event', async () => {
    const registry = new ToolRegistry();
    registry.register(createToolProgramTool());
    const { events, emit } = makeEmitCollector();
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];
    await new ToolExecutor(registry, { runId: 'run-1', permissionMode: 'danger' }).executeToolCalls(
      [{
        id: 'outer',
        name: 'tool.program',
        arguments: {
          program: { version: 1, steps: [{ id: 'missing', op: 'call', tool: 'data.missing', args: {} }] },
        },
      }],
      emit,
      messages,
      () => false,
      new Map(),
      new Map(),
    );

    expect(messages.at(-1)?.content).toMatch(/Unknown tool/);
    expect(events.find((event) => event.kind === 'tool_call' && event.toolCallId === 'outer')).toMatchObject({ args: {} });
  });

  it('keeps TaskList and permission denials in the existing executor', async () => {
    const taskExecute = vi.fn(async () => ({ success: true, data: { id: 'generated' } }));
    const dangerExecute = vi.fn(async () => ({ success: true, data: { id: 'written' } }));
    const registry = new ToolRegistry();
    registry.register(createToolProgramTool());
    registry.register(makeTool('canvas.generation', taskExecute, {
      category: 'mutation',
      tier: 3,
      inputSchema: { type: 'object', properties: {}, required: [] },
    }));
    registry.register(makeTool('danger.write', dangerExecute, {
      category: 'mutation',
      tier: 3,
    }));

    const taskMessages: Array<{ role: string; content: string; toolCallId?: string }> = [];
    await new ToolExecutor(registry, {
      runId: 'run-task',
      permissionMode: 'danger',
      taskListPolicy: {
        taskListId: 'task-list-1',
        phase: 'production_plan_pending',
        gate: 'production_plan',
        rowVersion: 1,
      },
    }).executeToolCalls(
      [{
        id: 'outer-task',
        name: 'tool.program',
        arguments: { program: { version: 1, steps: [{ id: 'write', op: 'call', tool: 'canvas.generation', args: {} }] } },
      }],
      makeEmitCollector('run-task').emit,
      taskMessages,
      () => false,
      new Map(),
      new Map(),
    );
    expect(taskMessages.at(-1)?.content).toMatch(/Production Plan/i);
    expect(taskExecute).not.toHaveBeenCalled();

    const pending = new Map<string, (approved: boolean) => void>();
    const { emit } = makeEmitCollector('run-permission');
    const rejectingEmit = ((event: Parameters<typeof emit>[0]) => {
      emit(event);
      if (event.kind === 'tool_confirm_prompt') {
        queueMicrotask(() => pending.get(event.toolCallId)?.(false));
      }
    }) as typeof emit;
    rejectingEmit.batch = emit.batch;
    const permissionMessages: Array<{ role: string; content: string; toolCallId?: string }> = [];
    await new ToolExecutor(registry, { runId: 'run-permission', permissionMode: 'normal' }).executeToolCalls(
      [{
        id: 'outer-permission',
        name: 'tool.program',
        arguments: {
          program: {
            version: 1,
            steps: [{ id: 'write', op: 'call', tool: 'danger.write', args: { value: literal({}) } }],
          },
        },
      }],
      rejectingEmit,
      permissionMessages,
      () => false,
      pending,
      new Map(),
    );
    expect(permissionMessages.at(-1)?.content).toMatch(/skipped by user/i);
    expect(dangerExecute).not.toHaveBeenCalled();
  });

  it('charges child calls to the parent resource controller using stable operation IDs', async () => {
    const execute = vi.fn(async (args: Record<string, unknown>) => ({ success: true, data: args.value }));
    const registry = new ToolRegistry();
    registry.register(createToolProgramTool());
    registry.register(makeTool('data.echo', execute));
    const resourceController = new RunResourceBudgetController({ maxToolCalls: 3 });
    const { events, emit } = makeEmitCollector('run-budget');
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];
    const result = await new ToolExecutor(registry, {
      runId: 'run-budget',
      permissionMode: 'danger',
      resourceController,
    }).executeToolCalls(
      [{
        id: 'outer-budget',
        name: 'tool.program',
        arguments: {
          program: {
            version: 1,
            steps: [
              { id: 'one', op: 'call', tool: 'data.echo', args: { value: literal({ n: 1 }) } },
              { id: 'two', op: 'call', tool: 'data.echo', args: { value: literal({ n: 2 }) } },
              { id: 'three', op: 'call', tool: 'data.echo', args: { value: literal({ n: 3 }) } },
            ],
          },
        },
      }],
      emit,
      messages,
      () => false,
      new Map(),
      new Map(),
    );

    expect(result.blocked).toMatchObject({ kind: 'resource_budget', metric: 'tool_calls' });
    expect(execute).toHaveBeenCalledTimes(2);
    const operationIds = events.flatMap((event) =>
      event.kind === 'resource_state' &&
      (event.cause.kind === 'reserved' || event.cause.kind === 'settled')
        ? [event.cause.operationId]
        : [],
    );
    expect(operationIds).toContain('program:run-budget:one:0');
    expect(operationIds).toContain('program:run-budget:two:0');
    expect(operationIds).not.toContain('program:run-budget:three:0');
  });
});
