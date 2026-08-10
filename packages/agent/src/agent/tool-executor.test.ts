import { describe, expect, it, vi } from 'vitest';
import {
  needsConfirmation,
  resolveEffectiveToolTier,
  ToolExecutor,
  validateArgs,
} from './tool-executor.js';
import { AgentToolRegistry, type AgentTool } from './tool-registry.js';

/**
 * Pins down the permission-confirmation matrix. Sixteen cases:
 * four tiers × four modes. These are the only contract the UI / IPC /
 * user-facing confirm prompts rely on — drifting this table without
 * updating the in-repo docstring is a silent UX regression.
 */
describe('needsConfirmation matrix', () => {
  const cases: Array<{ tier: 1 | 2 | 3 | 4; mode: string; expect: boolean }> = [
    // danger — nothing asks
    { tier: 1, mode: 'danger', expect: false },
    { tier: 2, mode: 'danger', expect: false },
    { tier: 3, mode: 'danger', expect: false },
    { tier: 4, mode: 'danger', expect: false },
    // auto — only tier 4 asks (expensive/irreversible)
    { tier: 1, mode: 'auto', expect: false },
    { tier: 2, mode: 'auto', expect: false },
    { tier: 3, mode: 'auto', expect: false },
    { tier: 4, mode: 'auto', expect: true },
    // normal — tiers 3 and 4 ask
    { tier: 1, mode: 'normal', expect: false },
    { tier: 2, mode: 'normal', expect: false },
    { tier: 3, mode: 'normal', expect: true },
    { tier: 4, mode: 'normal', expect: true },
    // strict — every tier asks
    { tier: 1, mode: 'strict', expect: true },
    { tier: 2, mode: 'strict', expect: true },
    { tier: 3, mode: 'strict', expect: true },
    { tier: 4, mode: 'strict', expect: true },
  ];

  for (const c of cases) {
    it(`tier ${c.tier} × ${c.mode} → ${c.expect ? 'ASK' : 'skip'}`, () => {
      expect(needsConfirmation(c.tier, c.mode)).toBe(c.expect);
    });
  }
});

describe('resolveEffectiveToolTier', () => {
  it.each([
    ['workflow.manage', { action: 'control', controlAction: 'cancel' }, 2, 4],
    ['workflow.manage', { action: 'control', controlAction: 'pause' }, 2, 2],
    ['workflow.manage', { action: 'control', controlAction: 'resume' }, 2, 2],
    ['workflow.manage', { action: 'control', controlAction: 'retry' }, 2, 2],
    ['canvas.generation', { action: 'start' }, 2, 3],
    ['canvas.generation', { action: 'refine' }, 2, 3],
    ['canvas.generation', { action: 'estimate' }, 2, 1],
    ['canvas.generation', { action: 'cancel' }, 2, 2],
    ['preset.manage', { action: 'delete' }, 2, 3],
    ['preset.manage', { action: 'reset' }, 2, 3],
    ['shotTemplate.manage', { action: 'delete' }, 2, 3],
    ['preset.manage', { action: 'update' }, 2, 2],
  ] as const)('%s %o resolves declared tier %i to %i', (toolName, args, declared, expected) => {
    expect(resolveEffectiveToolTier(toolName, args, declared)).toBe(expected);
  });
});

describe('AgentToolRegistry.register tier guard', () => {
  function makeTool(overrides: Partial<AgentTool> = {}): AgentTool {
    return {
      name: 'test.dummy',
      description: 'test',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => ({ success: true }),
      ...overrides,
    };
  }

  it('accepts a tool with a valid tier', () => {
    const registry = new AgentToolRegistry();
    expect(() => registry.register(makeTool({ tier: 3 }))).not.toThrow();
    expect(registry.get('test.dummy')).toBeDefined();
  });

  it('throws when tier is missing (undefined via as-cast escape)', () => {
    const registry = new AgentToolRegistry();
    const broken = { ...makeTool(), tier: undefined } as unknown as AgentTool;
    expect(() => registry.register(broken)).toThrow(/tier/);
  });

  it('throws when tier is out of range', () => {
    const registry = new AgentToolRegistry();
    const broken = { ...makeTool(), tier: 5 } as unknown as AgentTool;
    expect(() => registry.register(broken)).toThrow(/tier/);
  });

  it('throws when tier is a non-integer sneaked in', () => {
    const registry = new AgentToolRegistry();
    const broken = { ...makeTool(), tier: 'high' } as unknown as AgentTool;
    expect(() => registry.register(broken)).toThrow(/tier/);
  });
});

describe('validateArgs', () => {
  const tool: AgentTool = {
    name: 'canvas.createNodes',
    description: 'test',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Canvas ID' },
        type: { type: 'string', description: 'Node type' },
        title: { type: 'string', description: 'Node title' },
      },
      required: ['canvasId', 'type', 'title'],
    },
    execute: async () => ({ success: true }),
  };

  it('passes when all required fields are present', () => {
    const errors = validateArgs(tool, { canvasId: 'c-1', type: 'text', title: 'T' });
    expect(errors).toEqual([]);
  });

  it('fails when a required field is missing', () => {
    const errors = validateArgs(tool, { type: 'text', title: 'T' });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('canvasId');
  });

  it('passes when auto-injected canvasId is merged before validation', () => {
    const contextArgs = { canvasId: 'c-1' };
    const llmArgs = { type: 'text', title: 'T' };
    const merged = { ...contextArgs, ...llmArgs };
    const errors = validateArgs(tool, merged);
    expect(errors).toEqual([]);
  });

  it('context-injected canvasId overrides LLM-provided value', () => {
    const llmArgs = { canvasId: 'wrong-id', type: 'text', title: 'T' };
    const contextArgs = { canvasId: 'correct-id' };
    const merged = { ...llmArgs, ...contextArgs };
    const errors = validateArgs(tool, merged);
    expect(errors).toEqual([]);
    expect(merged.canvasId).toBe('correct-id');
  });

  it('detects wrong types', () => {
    const errors = validateArgs(tool, { canvasId: 'c-1', type: 123, title: 'T' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ field: 'type', expected: 'string' });
  });
});

describe('workflow gate enforcement', () => {
  it('hard-denies a forged generation call before the registered tool executes', async () => {
    const execute = vi.fn(async () => ({ success: true }));
    const registry = new AgentToolRegistry();
    registry.register({
      name: 'canvas.generation',
      description: 'Generate media',
      tier: 3,
      parameters: { type: 'object', properties: {}, required: [] },
      execute,
    });
    const executor = new ToolExecutor(registry, {
      workflowPolicy: {
        workflowRunId: 'workflow-1',
        phase: 'production_plan_pending',
        gate: 'production_plan',
        rowVersion: 1,
      },
    });

    const result = await executor.executeSingle(
      { id: 'forged-call', name: 'canvas.generation', arguments: {} },
      new Set(['canvas.generation']),
      new Set(),
      () => {},
    );

    expect(result.success).toBe(false);
    expect(result.resultContent).toMatch(/Production Plan/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('persists workflow-bound AskUser calls and reuses an already answered decision', async () => {
    const registry = new AgentToolRegistry();
    registry.register({
      name: 'commander.askUser',
      description: 'Ask the user',
      tier: 1,
      parameters: {
        type: 'object',
        properties: {
          decisionKey: { type: 'string' },
          question: { type: 'string' },
          options: { type: 'array' },
        },
        required: ['question', 'options'],
      },
      execute: vi.fn(async () => ({ success: true })),
    });
    const persist = vi.fn(async () => ({
      questionId: 'durable-question-1',
      status: 'answered' as const,
      answer: 'Analog',
      selectedOptionId: 'opt-1',
    }));
    const executor = new ToolExecutor(registry, {
      workflowPolicy: {
        workflowRunId: 'workflow-1',
        phase: 'style_exploration',
        rowVersion: 4,
        currentTaskRunId: 'task-style',
        subjectRevision: 2,
      },
      onWorkflowAskUser: persist,
    });
    const events: Array<Record<string, unknown>> = [];
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];

    await executor.executeToolCalls(
      [
        {
          id: 'call-1',
          name: 'commander.askUser',
          arguments: {
            decisionKey: 'style.horror.subgenre',
            question: 'Which direction?',
            options: [{ label: 'Gothic' }, { label: 'Analog', description: 'Broadcast unease' }],
          },
        },
      ],
      new Set(['commander.askUser']),
      new Set(),
      (event) => events.push(event as unknown as Record<string, unknown>),
      messages,
      () => false,
      new Map(),
      new Map(),
    );

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'workflow-1',
        decisionKey: 'style.horror.subgenre',
        questionId: 'call-1',
        options: [
          { id: 'opt-0', label: 'Gothic' },
          { id: 'opt-1', label: 'Analog', description: 'Broadcast unease' },
        ],
        allowFreeText: true,
      }),
    );
    expect(events.some((event) => event.kind === 'question_prompt')).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'user_answer',
        questionId: 'durable-question-1',
        answer: 'Analog',
        selectedOptionId: 'opt-1',
      }),
    );
    expect(messages).toEqual([
      {
        role: 'tool',
        content: JSON.stringify({ success: true, data: { answer: 'Analog' } }),
        toolCallId: 'call-1',
      },
    ]);
  });

  it('keeps non-workflow AskUser behavior transient and unchanged', async () => {
    const registry = new AgentToolRegistry();
    registry.register({
      name: 'commander.askUser',
      description: 'Ask the user',
      tier: 1,
      parameters: {
        type: 'object',
        properties: { question: { type: 'string' }, options: { type: 'array' } },
        required: ['question', 'options'],
      },
      execute: vi.fn(async () => ({ success: true })),
    });
    const persist = vi.fn();
    const executor = new ToolExecutor(registry, { onWorkflowAskUser: persist });
    const pending = new Map<string, (answer: string) => void>();
    const events: Array<Record<string, unknown>> = [];
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];
    const execution = executor.executeToolCalls(
      [
        {
          id: 'transient-call',
          name: 'commander.askUser',
          arguments: { question: 'Continue?', options: [{ label: 'Yes' }, { label: 'No' }] },
        },
      ],
      new Set(['commander.askUser']),
      new Set(),
      (event) => events.push(event as unknown as Record<string, unknown>),
      messages,
      () => false,
      new Map(),
      pending,
    );
    await vi.waitFor(() => expect(pending.has('transient-call')).toBe(true));
    pending.get('transient-call')?.('Yes');
    await execution;

    expect(persist).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'question_prompt',
        questionId: 'transient-call',
        allowFreeText: true,
      }),
    );
  });

  it('keeps a closed transient AskUser prompt pending until a listed option is answered', async () => {
    const registry = new AgentToolRegistry();
    registry.register({
      name: 'commander.askUser',
      description: 'Ask the user',
      tier: 1,
      parameters: {
        type: 'object',
        properties: { question: { type: 'string' }, options: { type: 'array' } },
        required: ['question', 'options'],
      },
      execute: vi.fn(async () => ({ success: true })),
    });
    const pending = new Map<string, (answer: string) => void>();
    const events: Array<Record<string, unknown>> = [];
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];
    let settled = false;
    const execution = new ToolExecutor(registry)
      .executeToolCalls(
        [
          {
            id: 'closed-question',
            name: 'commander.askUser',
            arguments: {
              question: 'Continue?',
              options: [{ label: 'Yes' }, { label: 'No' }],
              allowFreeText: false,
            },
          },
        ],
        new Set(['commander.askUser']),
        new Set(),
        (event) => events.push(event as unknown as Record<string, unknown>),
        messages,
        () => false,
        new Map(),
        pending,
      )
      .then(() => {
        settled = true;
      });

    await vi.waitFor(() => expect(pending.has('closed-question')).toBe(true));
    const invalidResolver = pending.get('closed-question')!;
    pending.delete('closed-question');
    invalidResolver('Something else');

    await vi.waitFor(() => expect(pending.has('closed-question')).toBe(true));
    expect(settled).toBe(false);
    expect(events.some((event) => event.kind === 'user_answer')).toBe(false);

    const validResolver = pending.get('closed-question')!;
    pending.delete('closed-question');
    validResolver('Yes');
    await execution;

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'user_answer',
        questionId: 'closed-question',
        answer: 'Yes',
        selectedOptionId: 'opt-0',
      }),
    );
  });

  it('rejects malformed AskUser option counts without waiting for an answer', async () => {
    const registry = new AgentToolRegistry();
    registry.register({
      name: 'commander.askUser',
      description: 'Ask the user',
      tier: 1,
      parameters: {
        type: 'object',
        properties: { question: { type: 'string' }, options: { type: 'array' } },
        required: ['question', 'options'],
      },
      execute: vi.fn(async () => ({ success: true })),
    });
    const pending = new Map<string, (answer: string) => void>();
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];

    await new ToolExecutor(registry).executeToolCalls(
      [
        {
          id: 'bad-question',
          name: 'commander.askUser',
          arguments: { question: 'Choose', options: [] },
        },
      ],
      new Set(['commander.askUser']),
      new Set(),
      () => {},
      messages,
      () => false,
      new Map(),
      pending,
    );

    expect(pending.has('bad-question')).toBe(false);
    expect(messages).toEqual([
      expect.objectContaining({
        toolCallId: 'bad-question',
        content: expect.stringContaining('between 2 and 6 non-empty options'),
      }),
    ]);
  });
});

describe('ToolExecutor scheduling and confirmation', () => {
  it('runs tool.get before same-turn calls and activates discovered tools immediately', async () => {
    const registry = new AgentToolRegistry();
    const executionOrder: string[] = [];
    const target = vi.fn(async () => {
      executionOrder.push('target');
      return { success: true };
    });
    registry.register({
      name: 'tool.get',
      description: 'Load tool schema',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => {
        executionOrder.push('tool.get');
        return { success: true, data: { tools: [{ name: 'series.addEpisode' }] } };
      }),
    });
    registry.register({
      name: 'series.addEpisode',
      description: 'Create an episode',
      tier: 2,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: target,
    });
    const active = new Set(['tool.get']);
    const discovered = new Set<string>();
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];

    await new ToolExecutor(registry).executeToolCalls(
      [
        { id: 'target', name: 'series.addEpisode', arguments: {} },
        { id: 'discover', name: 'tool.get', arguments: { names: ['series.addEpisode'] } },
      ],
      active,
      discovered,
      () => {},
      messages,
      () => false,
      new Map(),
      new Map(),
    );

    expect(executionOrder).toEqual(['tool.get', 'target']);
    expect(target).toHaveBeenCalledOnce();
    expect(active.has('series.addEpisode')).toBe(true);
    expect(discovered.has('series.addEpisode')).toBe(true);
  });

  it('parallelizes pure reads but serializes mutations', async () => {
    const registry = new AgentToolRegistry();
    const startedReads: string[] = [];
    let releaseReads: (() => void) | undefined;
    const readsReady = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const mutation = vi.fn(async () => ({ success: true }));
    for (const name of ['entity.list', 'canvas.getInfo']) {
      registry.register({
        name,
        description: name,
        tier: 1,
        parameters: { type: 'object', properties: {}, required: [] },
        execute: async () => {
          startedReads.push(name);
          await readsReady;
          return { success: true };
        },
      });
    }
    registry.register({
      name: 'canvas.updateNodes',
      description: 'Update canvas nodes',
      tier: 2,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: mutation,
    });
    const executor = new ToolExecutor(registry);
    const execution = executor.executeToolCalls(
      [
        { id: 'read-1', name: 'entity.list', arguments: {} },
        { id: 'read-2', name: 'canvas.getInfo', arguments: {} },
        { id: 'write', name: 'canvas.updateNodes', arguments: {} },
      ],
      new Set(['entity.list', 'canvas.getInfo', 'canvas.updateNodes']),
      new Set(),
      () => {},
      [],
      () => false,
      new Map(),
      new Map(),
    );

    await vi.waitFor(() => expect(startedReads).toHaveLength(2));
    expect(mutation).not.toHaveBeenCalled();
    releaseReads?.();
    await execution;

    expect(mutation).toHaveBeenCalledOnce();
  });

  it('does not merge a read into the preceding serial mutation', async () => {
    const registry = new AgentToolRegistry();
    let releaseMutation: (() => void) | undefined;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const mutationStarted = vi.fn();
    const read = vi.fn(async () => ({ success: true }));
    registry.register({
      name: 'canvas.updateNodes',
      description: 'Update canvas nodes',
      tier: 2,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: async () => {
        mutationStarted();
        await mutationGate;
        return { success: true };
      },
    });
    registry.register({
      name: 'canvas.getInfo',
      description: 'Read canvas',
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: read,
    });

    const execution = new ToolExecutor(registry).executeToolCalls(
      [
        { id: 'write', name: 'canvas.updateNodes', arguments: {} },
        { id: 'read', name: 'canvas.getInfo', arguments: {} },
      ],
      new Set(['canvas.updateNodes', 'canvas.getInfo']),
      new Set(),
      () => {},
      [],
      () => false,
      new Map(),
      new Map(),
    );

    await vi.waitFor(() => expect(mutationStarted).toHaveBeenCalledOnce());
    expect(read).not.toHaveBeenCalled();
    releaseMutation?.();
    await execution;
    expect(read).toHaveBeenCalledOnce();
  });

  it('uses the effective tier in confirmation events', async () => {
    const registry = new AgentToolRegistry();
    registry.register({
      name: 'canvas.generation',
      description: 'Generate media',
      tier: 2,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn(async () => ({ success: true })),
    });
    const pending = new Map<string, (approved: boolean) => void>();
    const events: Array<Record<string, unknown>> = [];
    const execution = new ToolExecutor(registry).executeToolCalls(
      [{ id: 'generate', name: 'canvas.generation', arguments: { action: 'start' } }],
      new Set(['canvas.generation']),
      new Set(),
      (event) => events.push(event as Record<string, unknown>),
      [],
      () => false,
      pending,
      new Map(),
    );

    await vi.waitFor(() => expect(pending.has('generate')).toBe(true));
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'tool_confirm_prompt', toolCallId: 'generate', tier: 3 }),
    );
    pending.get('generate')?.(true);
    await execution;
  });
});

describe('workflow gate confirmation handoff', () => {
  function renderRegistry(execute = vi.fn(async () => ({ success: true }))) {
    const registry = new AgentToolRegistry();
    registry.register({
      name: 'render.start',
      description: 'Render the exact approved manifest',
      tier: 4,
      parameters: {
        type: 'object',
        properties: { workflowRunId: { type: 'string' } },
        required: ['workflowRunId'],
      },
      execute,
    });
    return { registry, execute };
  }

  it.each(['normal', 'auto'] as const)(
    'uses the exact final-export approval in %s mode and injects the host run id',
    async (permissionMode) => {
      const { registry, execute } = renderRegistry();
      const pending = new Map<string, (approved: boolean) => void>();

      await new ToolExecutor(registry, {
        permissionMode,
        workflowPolicy: {
          workflowRunId: 'workflow-approved',
          phase: 'final_export_approved',
          rowVersion: 8,
          subjectRevision: 3,
        },
      }).executeToolCalls(
        [
          {
            id: 'render',
            name: 'render.start',
            arguments: { workflowRunId: 'workflow-forged' },
          },
        ],
        new Set(['render.start']),
        new Set(),
        () => {},
        [],
        () => false,
        pending,
        new Map(),
      );

      expect(pending.size).toBe(0);
      expect(execute).toHaveBeenCalledWith({ workflowRunId: 'workflow-approved' });
    },
  );

  it('keeps strict mode confirmation after final-export approval', async () => {
    const { registry, execute } = renderRegistry();
    const pending = new Map<string, (approved: boolean) => void>();
    const execution = new ToolExecutor(registry, {
      permissionMode: 'strict',
      workflowPolicy: {
        workflowRunId: 'workflow-approved',
        phase: 'final_export_approved',
      },
    }).executeToolCalls(
      [{ id: 'render', name: 'render.start', arguments: {} }],
      new Set(['render.start']),
      new Set(),
      () => {},
      [],
      () => false,
      pending,
      new Map(),
    );

    await vi.waitFor(() => expect(pending.has('render')).toBe(true));
    expect(execute).not.toHaveBeenCalled();
    pending.get('render')?.(true);
    await execution;
    expect(execute).toHaveBeenCalledOnce();
  });

  it('fails a wrong-phase render without creating an unusable confirmation', async () => {
    const { registry, execute } = renderRegistry();
    const pending = new Map<string, (approved: boolean) => void>();
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];

    await new ToolExecutor(registry, {
      permissionMode: 'normal',
      workflowPolicy: {
        workflowRunId: 'workflow-pending',
        phase: 'final_export_pending',
      },
    }).executeToolCalls(
      [{ id: 'render', name: 'render.start', arguments: {} }],
      new Set(['render.start']),
      new Set(),
      () => {},
      messages,
      () => false,
      pending,
      new Map(),
    );

    expect(pending.size).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    expect(messages[0]?.content).toMatch(/final export revision is awaiting user approval/i);
  });

  it('still confirms an unbound tier-4 render in normal mode', async () => {
    const { registry } = renderRegistry();
    const pending = new Map<string, (approved: boolean) => void>();
    const execution = new ToolExecutor(registry, { permissionMode: 'normal' }).executeToolCalls(
      [{ id: 'render', name: 'render.start', arguments: { workflowRunId: 'workflow-1' } }],
      new Set(['render.start']),
      new Set(),
      () => {},
      [],
      () => false,
      pending,
      new Map(),
    );

    await vi.waitFor(() => expect(pending.has('render')).toBe(true));
    pending.get('render')?.(false);
    await execution;
  });
});
