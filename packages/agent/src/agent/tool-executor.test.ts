import { describe, expect, it, vi } from 'vitest';
import {
  needsConfirmation,
  resolveEffectiveToolTier,
  ToolExecutor,
  validateArgs,
} from './tool-executor.js';
import {
  NO_TOOL_RESOURCE,
  ToolRegistry as CanonicalToolRegistry,
  toolResultSchema,
  type ToolDefinition,
} from './tool-registry.js';
import {
  arraySchema,
  canonicalJsonSchema,
  enumSchema,
  objectSchema,
  stringSchema,
} from './tools/tool-runtime-schemas.js';
import { makeStampedEmit, type StampedStreamEvent } from './stream-emit.js';
import { RunResourceBudgetController } from './run-resource-budget.js';
import { createSubagentTools, type SubagentToolHost } from './subagent-tools.js';

class ToolRegistry extends CanonicalToolRegistry {
  override register(tool: ToolDefinition): void {
    const candidate = tool as ToolDefinition & {
      parameters?: ToolDefinition['inputSchema'];
    };
    candidate.inputSchema ??= candidate.parameters ?? { type: 'object', properties: {} };
    candidate.outputSchema ??= toolResultSchema(canonicalJsonSchema, { dataOptional: true });
    super.register(candidate);
  }
}

function makeEmitCollector(initialSeq = 10) {
  const events: StampedStreamEvent[] = [];
  const sink = ((event: StampedStreamEvent) => events.push(event)) as
    ((event: StampedStreamEvent) => void) & {
      batch(events: readonly StampedStreamEvent[]): void;
    };
  sink.batch = (batch) => events.push(...batch);
  return {
    events,
    emit: makeStampedEmit('run-test', () => 2, sink, initialSeq),
  };
}

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
    ['taskList.manage', { action: 'control', controlAction: 'cancel' }, 2, 4],
    ['taskList.manage', { action: 'control', controlAction: 'pause' }, 2, 2],
    ['taskList.manage', { action: 'control', controlAction: 'resume' }, 2, 2],
    ['taskList.manage', { action: 'control', controlAction: 'retry' }, 2, 2],
    ['canvas.generation', { action: 'prepare' }, 2, 2],
    ['canvas.generation', { action: 'submit' }, 2, 3],
    ['canvas.generation', { action: 'status' }, 2, 1],
    ['canvas.generation', { action: 'estimate' }, 2, 1],
    ['canvas.generation', { action: 'cancel' }, 2, 2],
    ['canvas.generation', { action: 'retryEvaluation' }, 2, 2],
    ['preset.manage', { action: 'delete' }, 2, 3],
    ['preset.manage', { action: 'reset' }, 2, 3],
    ['shotTemplate.manage', { action: 'delete' }, 2, 3],
    ['preset.manage', { action: 'update' }, 2, 2],
  ] as const)('%s %o resolves declared tier %i to %i', (toolName, args, declared, expected) => {
    expect(resolveEffectiveToolTier(toolName, args, declared)).toBe(expected);
  });
});

describe('ToolRegistry.register tier guard', () => {
  function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
    return {
      name: 'test.dummy',
      description: 'test',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      inputSchema: { type: 'object', properties: {}, required: [] },
      outputSchema: toolResultSchema(canonicalJsonSchema, { dataOptional: true }),
      execute: async () => ({ success: true }),
      ...overrides,
    };
  }

  it('accepts a tool with a valid tier', () => {
    const registry = new ToolRegistry();
    expect(() => registry.register(makeTool({ tier: 3 }))).not.toThrow();
    expect(registry.get('test.dummy')).toBeDefined();
  });

  it('throws when tier is missing (undefined via as-cast escape)', () => {
    const registry = new ToolRegistry();
    const broken = { ...makeTool(), tier: undefined } as unknown as ToolDefinition;
    expect(() => registry.register(broken)).toThrow(/tier/);
  });

  it('throws when tier is out of range', () => {
    const registry = new ToolRegistry();
    const broken = { ...makeTool(), tier: 5 } as unknown as ToolDefinition;
    expect(() => registry.register(broken)).toThrow(/tier/);
  });

  it('throws when tier is a non-integer sneaked in', () => {
    const registry = new ToolRegistry();
    const broken = { ...makeTool(), tier: 'high' } as unknown as ToolDefinition;
    expect(() => registry.register(broken)).toThrow(/tier/);
  });
});

describe('validateArgs', () => {
  const tool = {
    name: 'canvas.createNodes',
    description: 'test',
    process: 'test',
    category: 'mutation',
    contextReplay: 'status_only',
    resource: NO_TOOL_RESOURCE,
    tier: 2,
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'Canvas ID' },
        type: { type: 'string', description: 'Node type' },
        title: { type: 'string', description: 'Node title' },
        options: {
          type: 'object',
          description: 'Nested options',
          properties: {
            mode: { type: 'string', description: 'Mode', enum: ['fast', 'quality'] },
            weights: {
              type: 'array',
              description: 'Finite weights',
              items: { type: 'number', description: 'Weight' },
            },
          },
          required: ['mode', 'weights'],
        },
      },
      required: ['canvasId', 'type', 'title'],
    },
    outputSchema: toolResultSchema(canonicalJsonSchema, { dataOptional: true }),
    execute: async () => ({ success: true }),
  } as unknown as ToolDefinition;

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

  it('preserves an explicit canvasId when default context is available', () => {
    const llmArgs = { canvasId: 'explicit-id', type: 'text', title: 'T' };
    const contextArgs = { canvasId: 'default-id' };
    const merged = { ...contextArgs, ...llmArgs };
    const errors = validateArgs(tool, merged);
    expect(errors).toEqual([]);
    expect(merged.canvasId).toBe('explicit-id');
  });

  it('detects wrong types', () => {
    const errors = validateArgs(tool, { canvasId: 'c-1', type: 123, title: 'T' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ field: 'type', expected: 'string' });
  });

  it.each([
    ['unknown root field', { canvasId: 'c-1', type: 'text', title: 'T', extra: true }],
    [
      'unknown nested field',
      {
        canvasId: 'c-1',
        type: 'text',
        title: 'T',
        options: { mode: 'fast', weights: [1], extra: true },
      },
    ],
    [
      'invalid nested enum',
      {
        canvasId: 'c-1',
        type: 'text',
        title: 'T',
        options: { mode: 'slow', weights: [1] },
      },
    ],
    [
      'non-finite array number',
      {
        canvasId: 'c-1',
        type: 'text',
        title: 'T',
        options: { mode: 'fast', weights: [Number.NaN] },
      },
    ],
  ])('recursively rejects %s', (_label, args) => {
    expect(validateArgs(tool, args).length).toBeGreaterThan(0);
  });

  it('returns validation facts without prescribing the model recovery action', async () => {
    const registry = new ToolRegistry();
    registry.register(tool);

    const result = await new ToolExecutor(registry).executeSingle(
      {
        id: 'invalid-create',
        name: tool.name,
        arguments: { type: 'text', title: 'T' },
      },
      () => {},
    );
    const payload = JSON.parse(result.resultContent) as Record<string, unknown>;

    expect(payload).toMatchObject({ success: false });
    expect(payload).not.toHaveProperty('_recovery');
    expect(payload.error).toContain('canvasId');
    expect(payload.error).not.toMatch(/retry|do not|call again|different approach/i);
  });
});

describe('task-list gate enforcement', () => {
  it('injects only host-bound fields declared by the tool input contract', async () => {
    const execute = vi.fn(async (args: Record<string, unknown>) => ({
      success: true as const,
      data: args,
    }));
    const registry = new ToolRegistry();
    registry.register({
      name: 'task.visual',
      description: 'Prepare visual auditions',
      process: 'test',
      category: 'mutation',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 2,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['status'] },
          taskListId: { type: 'string' },
        },
        required: ['action', 'taskListId'],
      },
      execute,
    });
    const executor = new ToolExecutor(registry, {
      taskListPolicy: {
        taskListId: 'task-list-1',
        phase: 'style_exploration',
        rowVersion: 4,
        currentTaskId: 'task-style',
      },
    });

    const result = await executor.executeSingle(
      { id: 'visual-status', name: 'task.visual', arguments: { action: 'status' } },
      () => {},
    );

    expect(result.success).toBe(true);
    expect(execute).toHaveBeenCalledWith({ action: 'status', taskListId: 'task-list-1' });
  });

  it('hard-denies a forged generation call before the registered tool executes', async () => {
    const execute = vi.fn(async () => ({ success: true }));
    const registry = new ToolRegistry();
    registry.register({
      name: 'canvas.generation',
      description: 'Generate media',
      process: 'test',
      category: 'mutation',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 3,
      parameters: { type: 'object', properties: {}, required: [] },
      execute,
    });
    const executor = new ToolExecutor(registry, {
      taskListPolicy: {
        taskListId: 'task-list-1',
        phase: 'production_plan_pending',
        gate: 'production_plan',
        rowVersion: 1,
      },
    });

    const result = await executor.executeSingle(
      { id: 'forged-call', name: 'canvas.generation', arguments: {} },
      () => {},
    );

    expect(result.success).toBe(false);
    expect(result.resultContent).toMatch(/Production Plan/i);
    expect(execute).not.toHaveBeenCalled();
  });

  it('persists task-list-bound AskUser calls and reuses an already answered decision', async () => {
    const previewAssetHash = 'a'.repeat(64);
    const registry = new ToolRegistry();
    registry.register({
      name: 'commander.askUser',
      description: 'Ask the user',
      process: 'meta',
      category: 'meta',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: {
        type: 'object',
        properties: {
          decisionKey: { type: 'string' },
          question: { type: 'string' },
          allowFreeText: { type: 'boolean' },
          options: {
            type: 'array',
            items: { type: 'object', properties: {}, additionalProperties: true },
          },
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
      taskListPolicy: {
        taskListId: 'task-list-1',
        phase: 'style_exploration',
        rowVersion: 4,
        currentTaskId: 'task-style',
        subjectRevision: 2,
      },
      onTaskDecision: persist,
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
            options: [
              { label: 'Gothic', previewAssetHash },
              { label: 'Analog', description: 'Broadcast unease' },
            ],
          },
        },
      ],
      (event) => events.push(event as unknown as Record<string, unknown>),
      messages,
      () => false,
      new Map(),
      new Map(),
    );

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        taskListId: 'task-list-1',
        decisionKey: 'style.horror.subgenre',
        questionId: 'call-1',
        options: [
          { id: 'opt-0', label: 'Gothic', previewAssetHash },
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

  it('keeps non-task-list AskUser behavior transient and unchanged', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'commander.askUser',
      description: 'Ask the user',
      process: 'meta',
      category: 'meta',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          allowFreeText: { type: 'boolean' },
          options: {
            type: 'array',
            items: { type: 'object', properties: {}, additionalProperties: true },
          },
        },
        required: ['question', 'options'],
      },
      execute: vi.fn(async () => ({ success: true })),
    });
    const persist = vi.fn();
    const executor = new ToolExecutor(registry, { onTaskDecision: persist });
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
    const registry = new ToolRegistry();
    registry.register({
      name: 'commander.askUser',
      description: 'Ask the user',
      process: 'meta',
      category: 'meta',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          allowFreeText: { type: 'boolean' },
          options: {
            type: 'array',
            items: { type: 'object', properties: {}, additionalProperties: true },
          },
        },
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

  it('allows free-text AskUser prompts without options or an upper option limit', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'commander.askUser',
      description: 'Ask the user',
      process: 'meta',
      category: 'meta',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          allowFreeText: { type: 'boolean' },
          options: {
            type: 'array',
            items: { type: 'object', properties: {}, additionalProperties: true },
          },
        },
        required: ['question', 'options'],
      },
      execute: vi.fn(async () => ({ success: true })),
    });
    const pending = new Map<string, (answer: string) => void>();
    const events: Array<Record<string, unknown>> = [];
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];

    const execution = new ToolExecutor(registry).executeToolCalls(
      [
        { id: 'open-question', name: 'commander.askUser', arguments: { question: 'Tell me more', options: [] } },
        {
          id: 'many-options',
          name: 'commander.askUser',
          arguments: {
            question: 'Choose',
            options: Array.from({ length: 7 }, (_, index) => ({ label: `Option ${index + 1}` })),
            allowFreeText: false,
          },
        },
      ],
      (event) => events.push(event as unknown as Record<string, unknown>),
      messages,
      () => false,
      new Map(),
      pending,
    );

    await vi.waitFor(() => expect(pending.has('open-question')).toBe(true));
    pending.get('open-question')?.('Make it quieter');
    await vi.waitFor(() => expect(pending.has('many-options')).toBe(true));
    pending.get('many-options')?.('Option 7');
    await execution;

    expect(messages).toEqual([
      expect.objectContaining({ toolCallId: 'open-question', content: expect.stringContaining('Make it quieter') }),
      expect.objectContaining({ toolCallId: 'many-options', content: expect.stringContaining('Option 7') }),
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: 'question_prompt',
        questionId: 'open-question',
        options: undefined,
        allowFreeText: true,
      }),
    );
  });

  it('rejects closed optionless and malformed AskUser options without waiting for an answer', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'commander.askUser',
      description: 'Ask the user',
      process: 'meta',
      category: 'meta',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          allowFreeText: { type: 'boolean' },
          options: {
            type: 'array',
            items: { type: 'object', properties: {}, additionalProperties: true },
          },
        },
        required: ['question', 'options'],
      },
      execute: vi.fn(async () => ({ success: true })),
    });
    const pending = new Map<string, (answer: string) => void>();
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];

    await new ToolExecutor(registry).executeToolCalls(
      [
        {
          id: 'closed-empty-question',
          name: 'commander.askUser',
          arguments: { question: 'Choose', options: [], allowFreeText: false },
        },
        {
          id: 'duplicate-labels',
          name: 'commander.askUser',
          arguments: { question: 'Choose', options: [{ label: 'Same' }, { label: 'Same' }] },
        },
        {
          id: 'invalid-preview',
          name: 'commander.askUser',
          arguments: { question: 'Choose', options: [{ label: 'One', previewAssetHash: 'not-a-hash' }] },
        },
      ],
      () => {},
      messages,
      () => false,
      new Map(),
      pending,
    );

    expect(pending.size).toBe(0);
    expect(messages).toEqual([
      expect.objectContaining({
        toolCallId: 'closed-empty-question',
        content: expect.stringContaining('empty option lists require allowFreeText=true'),
      }),
      expect.objectContaining({
        toolCallId: 'duplicate-labels',
        content: expect.stringContaining('non-empty options with unique labels'),
      }),
      expect.objectContaining({
        toolCallId: 'invalid-preview',
        content: expect.stringContaining('previewAssetHash must be a SHA-256'),
      }),
    ]);
    for (const message of messages) {
      expect(JSON.parse(message.content)).not.toHaveProperty('_recovery');
    }
  });
});

describe('ToolExecutor scheduling and confirmation', () => {
  it('preserves an explicit cross-Canvas read without adding confirmation', async () => {
    const execute = vi.fn(async () => ({ success: true }));
    const registry = new ToolRegistry();
    registry.register({
      name: 'canvas.getInfo',
      description: 'Read a Canvas',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: {
        type: 'object',
        properties: { canvasId: { type: 'string' } },
        required: ['canvasId'],
      },
      execute,
    });
    const pending = new Map<string, (approved: boolean) => void>();

    await new ToolExecutor(registry, {
      canvasId: 'canvas-default',
      permissionMode: 'auto',
    }).executeToolCalls(
      [{ id: 'read-other', name: 'canvas.getInfo', arguments: { canvasId: 'canvas-other' } }],
      () => {},
      [],
      () => false,
      pending,
      new Map(),
    );

    expect(pending.size).toBe(0);
    expect(execute).toHaveBeenCalledWith({ canvasId: 'canvas-other' });
  });

  it.each(['danger', 'auto'] as const)(
    'requires per-call confirmation for cross-Canvas mutations in %s mode',
    async (permissionMode) => {
      const execute = vi.fn(async () => ({ success: true }));
      const registry = new ToolRegistry();
      registry.register({
        name: 'canvas.updateNodes',
        description: 'Update Canvas nodes',
        process: 'test',
        category: 'mutation',
        contextReplay: 'status_only',
        resource: NO_TOOL_RESOURCE,
        tier: 2,
        parameters: {
          type: 'object',
          properties: { canvasId: { type: 'string' } },
          required: ['canvasId'],
        },
        execute,
      });
      const pending = new Map<string, (approved: boolean) => void>();
      const events: Array<Record<string, unknown>> = [];
      const execution = new ToolExecutor(registry, {
        canvasId: 'canvas-default',
        permissionMode,
      }).executeToolCalls(
        [
          {
            id: 'write-other-a',
            name: 'canvas.updateNodes',
            arguments: { canvasId: 'canvas-other-a' },
          },
          {
            id: 'write-other-b',
            name: 'canvas.updateNodes',
            arguments: { canvasId: 'canvas-other-b' },
          },
        ],
        (event) => events.push(event as Record<string, unknown>),
        [],
        () => false,
        pending,
        new Map(),
      );

      await vi.waitFor(() => expect(pending.has('write-other-a')).toBe(true));
      expect(execute).not.toHaveBeenCalled();
      expect(events).toContainEqual(
        expect.objectContaining({
          kind: 'tool_confirm_prompt',
          toolCallId: 'write-other-a',
          args: { canvasId: 'canvas-other-a' },
        }),
      );
      pending.get('write-other-a')?.(true);

      await vi.waitFor(() => expect(pending.has('write-other-b')).toBe(true));
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith({ canvasId: 'canvas-other-a' });
      pending.get('write-other-b')?.(false);
      await execution;

      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it('requires confirmation for any Canvas mutation when the chat has no default Canvas', async () => {
    const execute = vi.fn(async () => ({ success: true }));
    const registry = new ToolRegistry();
    registry.register({
      name: 'canvas.updateNodes',
      description: 'Update Canvas nodes',
      process: 'test',
      category: 'mutation',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 2,
      parameters: {
        type: 'object',
        properties: { canvasId: { type: 'string' } },
        required: ['canvasId'],
      },
      execute,
    });
    const pending = new Map<string, (approved: boolean) => void>();
    const execution = new ToolExecutor(registry, {
      permissionMode: 'danger',
    }).executeToolCalls(
      [{ id: 'write-from-unassigned', name: 'canvas.updateNodes', arguments: { canvasId: 'c-1' } }],
      () => {},
      [],
      () => false,
      pending,
      new Map(),
    );

    await vi.waitFor(() => expect(pending.has('write-from-unassigned')).toBe(true));
    expect(execute).not.toHaveBeenCalled();
    pending.get('write-from-unassigned')?.(true);
    await execution;
    expect(execute).toHaveBeenCalledWith({ canvasId: 'c-1' });
  });

  it('keeps default-Canvas mutation behavior and fills an omitted canvasId', async () => {
    const execute = vi.fn(async () => ({ success: true }));
    const registry = new ToolRegistry();
    registry.register({
      name: 'canvas.updateNodes',
      description: 'Update Canvas nodes',
      process: 'test',
      category: 'mutation',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 2,
      parameters: {
        type: 'object',
        properties: { canvasId: { type: 'string' } },
        required: ['canvasId'],
      },
      execute,
    });
    const pending = new Map<string, (approved: boolean) => void>();

    await new ToolExecutor(registry, {
      canvasId: 'canvas-default',
      permissionMode: 'auto',
    }).executeToolCalls(
      [
        {
          id: 'write-default-explicit',
          name: 'canvas.updateNodes',
          arguments: { canvasId: 'canvas-default' },
        },
        { id: 'write-default-implicit', name: 'canvas.updateNodes', arguments: {} },
      ],
      () => {},
      [],
      () => false,
      pending,
      new Map(),
    );

    expect(pending.size).toBe(0);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, { canvasId: 'canvas-default' });
    expect(execute).toHaveBeenNthCalledWith(2, { canvasId: 'canvas-default' });
  });

  it('treats tool.get as a registry query without changing tool execution state', async () => {
    const registry = new ToolRegistry();
    const executionOrder: string[] = [];
    const target = vi.fn(async () => {
      executionOrder.push('target');
      return { success: true };
    });
    registry.register({
      name: 'tool.get',
      description: 'Load tool schema',
      process: 'meta',
      category: 'meta',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      inputSchema: objectSchema({ names: arraySchema(stringSchema) }),
      outputSchema: toolResultSchema(objectSchema({
        tools: arraySchema(objectSchema({ name: stringSchema }, ['name'])),
      })),
      execute: vi.fn(async () => {
        executionOrder.push('tool.get');
        return { success: true, data: { tools: [{ name: 'asset.import' }] } };
      }),
    });
    registry.register({
      name: 'asset.import',
      description: 'Import an asset',
      process: 'test',
      category: 'mutation',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 2,
      inputSchema: objectSchema({}, []),
      outputSchema: toolResultSchema(undefined, { dataOptional: true }),
      execute: target,
    });
    const messages: Array<{ role: string; content: string; toolCallId?: string }> = [];

    await new ToolExecutor(registry).executeToolCalls(
      [
        { id: 'target', name: 'asset.import', arguments: {} },
        { id: 'discover', name: 'tool.get', arguments: { names: ['asset.import'] } },
      ],
      () => {},
      messages,
      () => false,
      new Map(),
      new Map(),
    );

    expect(executionOrder).toEqual(['target', 'tool.get']);
    expect(target).toHaveBeenCalledOnce();
  });

  it('parallelizes pure reads but serializes mutations', async () => {
    const registry = new ToolRegistry();
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
        process: 'test',
        category: 'query',
        contextReplay: 'status_only',
        resource: NO_TOOL_RESOURCE,
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
      process: 'test',
      category: 'mutation',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 2,
      inputSchema: objectSchema({}, []),
      outputSchema: toolResultSchema(undefined, { dataOptional: true }),
      execute: mutation,
    });
    const executor = new ToolExecutor(registry);
    const execution = executor.executeToolCalls(
      [
        { id: 'read-1', name: 'entity.list', arguments: {} },
        { id: 'read-2', name: 'canvas.getInfo', arguments: {} },
        { id: 'write', name: 'canvas.updateNodes', arguments: {} },
      ],
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
    const registry = new ToolRegistry();
    let releaseMutation: (() => void) | undefined;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const mutationStarted = vi.fn();
    const read = vi.fn(async () => ({ success: true }));
    registry.register({
      name: 'canvas.updateNodes',
      description: 'Update canvas nodes',
      process: 'test',
      category: 'mutation',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
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
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute: read,
    });

    const execution = new ToolExecutor(registry).executeToolCalls(
      [
        { id: 'write', name: 'canvas.updateNodes', arguments: {} },
        { id: 'read', name: 'canvas.getInfo', arguments: {} },
      ],
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
    const registry = new ToolRegistry();
    registry.register({
      name: 'canvas.generation',
      description: 'Generate media',
      process: 'test',
      category: 'mutation',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 2,
      inputSchema: objectSchema({ action: enumSchema(['submit']) }),
      outputSchema: toolResultSchema(undefined, { dataOptional: true }),
      execute: vi.fn(async () => ({ success: true })),
    });
    const pending = new Map<string, (approved: boolean) => void>();
    const events: Array<Record<string, unknown>> = [];
    const execution = new ToolExecutor(registry).executeToolCalls(
      [{ id: 'generate', name: 'canvas.generation', arguments: { action: 'submit' } }],
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

describe('ToolExecutor resource budget', () => {
  function registerMeteredTool(
    registry: ToolRegistry,
    name: string,
    execute: ToolDefinition['execute'],
  ): void {
    registry.register({
      name,
      description: name,
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: {
        kind: 'metered',
        quote: () => ({
          tokens: { knowledge: 'unknown' },
          toolCalls: 0,
          costUsd: { knowledge: 'unknown' },
        }),
      },
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute,
    });
  }

  it('charges raw duplicate and invalid calls against the atomic quota', async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ success: true }));
    registry.register({
      name: 'canvas.getInfo',
      description: 'Read canvas',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: {
        type: 'object',
        properties: { canvasId: { type: 'string', description: 'Canvas ID' } },
        required: ['canvasId'],
      },
      execute,
    });
    const controller = new RunResourceBudgetController({ maxToolCalls: 2 });

    const result = await new ToolExecutor(registry, {
      currentStep: 2,
      resourceController: controller,
    }).executeToolCalls(
      [
        { id: 'invalid', name: 'canvas.getInfo', arguments: {} },
        { id: 'duplicate', name: 'canvas.getInfo', arguments: {} },
      ],
      makeEmitCollector().emit,
      [],
      () => false,
      new Map(),
      new Map(),
    );

    expect(result.blocked).toBeUndefined();
    expect(result.dupMap.get('duplicate')).toBe('invalid');
    expect(controller.getUsage().toolCalls).toBe(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it('blocks an over-limit batch atomically before public tool events or execution', async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ success: true }));
    registry.register({
      name: 'canvas.getInfo',
      description: 'Read canvas',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute,
    });
    const { events, emit } = makeEmitCollector();
    const result = await new ToolExecutor(registry, {
      currentStep: 2,
      resourceController: new RunResourceBudgetController({ maxToolCalls: 1 }),
    }).executeToolCalls(
      [
        { id: 'one', name: 'canvas.getInfo', arguments: {} },
        { id: 'two', name: 'canvas.getInfo', arguments: { detail: true } },
      ],
      emit,
      [],
      () => false,
      new Map(),
      new Map(),
    );

    expect(result.blocked).toEqual({ kind: 'resource_budget', metric: 'tool_calls', reason: 'exhausted' });
    expect(execute).not.toHaveBeenCalled();
    expect(events.some((event) => event.kind === 'tool_call' || event.kind === 'tool_result')).toBe(false);
  });

  it('blocks an unknown provider quote under a cost cap without a tool event', async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ success: true }));
    registerMeteredTool(registry, 'canvas.getInfo', execute);
    const { events, emit } = makeEmitCollector();
    const result = await new ToolExecutor(registry, {
      currentStep: 2,
      resourceController: new RunResourceBudgetController({ maxCostUsd: 1 }),
    }).executeToolCalls(
      [{ id: 'metered', name: 'canvas.getInfo', arguments: {} }],
      emit,
      [],
      () => false,
      new Map(),
      new Map(),
    );

    expect(result.blocked).toEqual({ kind: 'resource_budget', metric: 'cost', reason: 'unavailable' });
    expect(execute).not.toHaveBeenCalled();
    expect(events.some((event) => event.kind === 'tool_call' || event.kind === 'tool_result')).toBe(false);
  });

  it('allows an unknown provider quote when no matching cap is configured', async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ success: true }));
    registerMeteredTool(registry, 'canvas.getInfo', execute);
    const controller = new RunResourceBudgetController({});

    const result = await new ToolExecutor(registry, {
      currentStep: 2,
      resourceController: controller,
    }).executeToolCalls(
      [{ id: 'metered', name: 'canvas.getInfo', arguments: {} }],
      makeEmitCollector().emit,
      [],
      () => false,
      new Map(),
      new Map(),
    );

    expect(result.blocked).toBeUndefined();
    expect(execute).toHaveBeenCalledOnce();
    expect(controller.getUsage().tokens).toEqual({ knowledge: 'unknown' });
    expect(controller.getUsage().costUsd).toEqual({ knowledge: 'unknown' });
  });

  it('reserves a metered operation before emitting its tool_call', async () => {
    const registry = new ToolRegistry();
    registerMeteredTool(registry, 'canvas.getInfo', async () => ({ success: true }));
    const { events, emit } = makeEmitCollector();

    await new ToolExecutor(registry, {
      currentStep: 2,
      resourceController: new RunResourceBudgetController({}),
    }).executeToolCalls(
      [{ id: 'metered', name: 'canvas.getInfo', arguments: {} }],
      emit,
      [],
      () => false,
      new Map(),
      new Map(),
    );

    const reservation = events.findIndex(
      (event) =>
        event.kind === 'resource_state' &&
        event.cause.kind === 'reserved' &&
        event.cause.operationId === 'tool:2:0:metered',
    );
    const call = events.findIndex((event) => event.kind === 'tool_call');
    expect(reservation).toBeGreaterThanOrEqual(0);
    expect(reservation).toBeLessThan(call);
  });

  it('reserves every parallel read before either read starts', async () => {
    const registry = new ToolRegistry();
    const { events, emit } = makeEmitCollector();
    const observedReservations: number[] = [];
    const execute = async () => {
      observedReservations.push(
        events.filter(
          (event) =>
            event.kind === 'resource_state' &&
            event.cause.kind === 'reserved' &&
            event.cause.source === 'tool' &&
            event.cause.operationId !== 'tool:2:quota',
        ).length,
      );
      return { success: true };
    };
    registerMeteredTool(registry, 'canvas.getInfo', execute);
    registerMeteredTool(registry, 'entity.list', execute);

    await new ToolExecutor(registry, {
      currentStep: 2,
      resourceController: new RunResourceBudgetController({}),
    }).executeToolCalls(
      [
        { id: 'read-a', name: 'canvas.getInfo', arguments: {} },
        { id: 'read-b', name: 'entity.list', arguments: {} },
      ],
      emit,
      [],
      () => false,
      new Map(),
      new Map(),
    );

    expect(observedReservations).toEqual([2, 2]);
  });

  it('settles a replayed operation idempotently', async () => {
    const registry = new ToolRegistry();
    const execute = vi.fn(async () => ({ success: true }));
    registry.register({
      name: 'canvas.getInfo',
      description: 'Read canvas',
      process: 'test',
      category: 'query',
      contextReplay: 'status_only',
      resource: {
        kind: 'metered',
        quote: () => ({
          tokens: { knowledge: 'estimated', value: 3, upperBound: true },
          toolCalls: 0,
          costUsd: { knowledge: 'estimated', value: 0.25, upperBound: true },
        }),
      },
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      execute,
    });
    const controller = new RunResourceBudgetController({});
    const executor = new ToolExecutor(registry, { currentStep: 2, resourceController: controller });
    const first = makeEmitCollector();
    const second = makeEmitCollector();

    await executor.executeSingle({ id: 'same', name: 'canvas.getInfo', arguments: {} }, first.emit);
    await executor.executeSingle({ id: 'same', name: 'canvas.getInfo', arguments: {} }, second.emit);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(controller.getUsage()).toMatchObject({
      tokens: { knowledge: 'estimated', value: 3 },
      costUsd: { knowledge: 'estimated', value: 0.25 },
    });
  });
});

describe('ToolExecutor subagent operation identity', () => {
  it('uses the canonical step and ordinal identity instead of the provider tool-call id', async () => {
    const registry = new ToolRegistry();
    for (const definition of createSubagentTools()) registry.register(definition);
    const spawn = vi.fn(async () => ({
      success: true,
      data: { runId: 'child-1', status: 'running', completed: false },
    }));
    const host: SubagentToolHost = {
      spawn,
      wait: vi.fn(),
      result: vi.fn(),
    };
    const executor = new ToolExecutor(registry, { currentStep: 1, subagents: host });
    const args = {
      displayName: 'Audit',
      objective: 'Audit continuity',
      instructions: 'Inspect the current public context.',
    };

    await executor.executeSingle({ id: 'reused', name: 'agent.spawn', arguments: args }, makeEmitCollector().emit);
    await executor.executeSingle({ id: 'reused', name: 'agent.spawn', arguments: args }, makeEmitCollector().emit);
    executor.opts.currentStep = 2;
    await executor.executeSingle({ id: 'reused', name: 'agent.spawn', arguments: args }, makeEmitCollector().emit);

    expect(spawn.mock.calls.map(([, operationId]) => operationId)).toEqual([
      'tool:1:0:reused',
      'tool:1:0:reused',
      'tool:2:0:reused',
    ]);
  });
});

describe('ToolExecutor public outcome emission', () => {
  it('blocks invalid tool output before public projection and emits the canonical error code', async () => {
    const projector = vi.fn(() => ({ summary: 'must not run' }));
    const registry = new CanonicalToolRegistry();
    registry.register({
      name: 'canvas.invalidOutput',
      description: 'Invalid output fixture',
      process: 'test',
      category: 'query',
      contextReplay: 'public_facts',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      inputSchema: { type: 'object', properties: {} },
      outputSchema: toolResultSchema(
        objectSchema({ status: enumSchema(['ready']) }),
      ),
      projectPublicResult: projector,
      execute: vi.fn(async () => ({ success: true, data: { status: 'invalid' } })),
    });
    const { events, emit } = makeEmitCollector();

    const result = await new ToolExecutor(registry).executeSingle(
      { id: 'invalid-output', name: 'canvas.invalidOutput', arguments: {} },
      emit,
    );

    expect(result.success).toBe(false);
    expect(result.resultContent).toContain('invalid canonical result');
    expect(projector).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'tool_result',
      toolCallId: 'invalid-output',
      status: 'failed',
      errorCode: 'INVALID_TOOL_OUTPUT',
    }));
    expect(events.some((event) => event.kind === 'context_fact')).toBe(false);
  });

  it('projects the actual result once with merged host arguments and emits no raw result', async () => {
    const secret = 'SECRET_TOOL_RESULT_SENTINEL';
    const actualResult = { success: true, data: { secret } };
    const projector = vi.fn((_result, args: Record<string, unknown>) => ({
      summary: 'Canvas inspected',
      context: {
        completeness: 'complete' as const,
        facts: [{
          kind: 'authority_ref' as const,
          authority: 'canvas' as const,
          relation: 'read' as const,
          id: String(args.canvasId),
        }],
      },
    }));
    const registry = new ToolRegistry();
    registry.register({
      name: 'canvas.inspect',
      description: 'Inspect canvas',
      process: 'test',
      category: 'query',
      contextReplay: 'authority_reread',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: {
        type: 'object',
        properties: { canvasId: { type: 'string', description: 'Canvas ID' } },
        required: ['canvasId'],
      },
      projectPublicResult: projector,
      execute: vi.fn(async () => actualResult),
    });
    const { events, emit } = makeEmitCollector();

    await new ToolExecutor(registry, { canvasId: 'canvas-host' }).executeSingle(
      { id: 'call-1', name: 'canvas.inspect', arguments: {} },
      emit,
    );

    expect(projector).toHaveBeenCalledOnce();
    expect(projector).toHaveBeenCalledWith(actualResult, { canvasId: 'canvas-host' });
    expect(events.filter((event) => event.kind === 'tool_call')).toEqual([
      expect.objectContaining({ args: { canvasId: 'canvas-host' } }),
    ]);
    const result = events.find((event) => event.kind === 'tool_result');
    const fact = events.find((event) => event.kind === 'context_fact');
    expect(result).toMatchObject({
      status: 'succeeded',
      projection: { summary: 'Canvas inspected' },
    });
    expect(fact).toMatchObject({
      seq: (result?.seq ?? -1) + 1,
      source: { kind: 'tool_result', toolCallId: 'call-1', toolResultSeq: result?.seq },
      completeness: 'complete',
      facts: [expect.objectContaining({ authority: 'canvas', id: 'canvas-host' })],
    });
    const publicEvents = events.map((event) =>
      'event' in event && event.event && typeof event.event === 'object'
        ? event.event
        : event,
    );
    expect(JSON.stringify(publicEvents)).not.toContain(secret);
  });

  it('emits fail-closed unavailable context only for successful replayable outcomes', async () => {
    const makeRegistry = (success: boolean) => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'canvas.inspect',
        description: 'Inspect canvas',
        process: 'test',
        category: 'query',
        contextReplay: 'authority_reread',
        resource: NO_TOOL_RESOURCE,
        tier: 1,
        parameters: { type: 'object', properties: {}, required: [] },
        projectPublicResult: () => ({}),
        execute: vi.fn(async () => success
          ? { success: true, data: 'private' }
          : { success: false, error: 'private failure' }),
      });
      return registry;
    };
    const succeeded = makeEmitCollector();
    await new ToolExecutor(makeRegistry(true)).executeSingle(
      { id: 'success', name: 'canvas.inspect', arguments: {} },
      succeeded.emit,
    );
    expect(succeeded.events).toContainEqual(expect.objectContaining({
      kind: 'context_fact',
      completeness: 'unavailable',
      facts: [],
    }));

    const failed = makeEmitCollector();
    await new ToolExecutor(makeRegistry(false)).executeSingle(
      { id: 'failure', name: 'canvas.inspect', arguments: {} },
      failed.emit,
    );
    expect(failed.events).toContainEqual(expect.objectContaining({
      kind: 'tool_result',
      status: 'failed',
    }));
    expect(failed.events.some((event) => event.kind === 'context_fact')).toBe(false);
  });

  it('reuses the winner projection for dedup mirrors without projecting twice', async () => {
    const projector = vi.fn(() => ({
      context: {
        completeness: 'complete' as const,
        facts: [{
          kind: 'authority_ref' as const,
          authority: 'canvas' as const,
          relation: 'read' as const,
          id: 'canvas-1',
        }],
      },
    }));
    const registry = new ToolRegistry();
    registry.register({
      name: 'canvas.inspect',
      description: 'Inspect canvas',
      process: 'test',
      category: 'query',
      contextReplay: 'authority_reread',
      resource: NO_TOOL_RESOURCE,
      tier: 1,
      parameters: { type: 'object', properties: {}, required: [] },
      projectPublicResult: projector,
      execute: vi.fn(async () => ({ success: true, data: 'private' })),
    });
    const { events, emit } = makeEmitCollector();

    await new ToolExecutor(registry).executeToolCalls(
      [
        { id: 'winner', name: 'canvas.inspect', arguments: {} },
        { id: 'duplicate', name: 'canvas.inspect', arguments: {} },
      ],
      emit,
      [],
      () => false,
      new Map(),
      new Map(),
    );

    expect(projector).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.kind === 'tool_call')).toHaveLength(2);
    const results = events.filter((event) => event.kind === 'tool_result');
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(events).toContainEqual(expect.objectContaining({
        kind: 'context_fact',
        source: {
          kind: 'tool_result',
          toolCallId: result.toolCallId,
          toolResultSeq: result.seq,
        },
      }));
    }
  });
});
