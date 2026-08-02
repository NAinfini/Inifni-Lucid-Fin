import { describe, expect, it, vi } from 'vitest';
import { needsConfirmation, ToolExecutor, validateArgs } from './tool-executor.js';
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
});
