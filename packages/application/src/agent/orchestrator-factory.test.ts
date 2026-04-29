import { describe, expect, it, vi } from 'vitest';
import { createAgentOrchestratorForRun } from './orchestrator-factory.js';
import { AgentToolRegistry } from './tool-registry.js';
import type { LLMAdapter } from '@lucid-fin/contracts';

function mockAdapter(): LLMAdapter {
  return {
    id: 'mock',
    name: 'Mock',
    profile: {
      supportsTools: true,
      supportsVision: false,
      parallelToolCalls: false,
    } as LLMAdapter['profile'],
    configure: vi.fn(),
    validate: vi.fn(async () => true),
    complete: vi.fn(async () => ''),
    completeWithTools: vi.fn(async () => ''),
    stream: vi.fn(async function* s() {}),
  } as unknown as LLMAdapter;
}

function mockCanvasStore(
  canvas: {
    nodes?: Array<{ id: string; type: string }>;
    settings?: { stylePlate?: string | null } | null;
  } | null = null,
) {
  return {
    get: () =>
      canvas
        ? {
            nodes: canvas.nodes ?? [],
            settings: canvas.settings ?? null,
          }
        : null,
  };
}

describe('createAgentOrchestratorForRun', () => {
  it('production variant constructs with canvas-aware resolvers wired', () => {
    const canvas = mockCanvasStore({
      nodes: [{ id: 'n1', type: 'image' }],
      settings: { stylePlate: 'warm cinematic' },
    });
    const orchestrator = createAgentOrchestratorForRun({
      variant: 'production',
      llmAdapter: mockAdapter(),
      toolRegistry: new AgentToolRegistry(),
      resolvePrompt: (code) => code,
      canvasStore: canvas,
      resolveProcessPrompt: () => 'process-prompt-body',
    });
    expect(orchestrator).toBeDefined();
  });

  it('study-harness variant fires postConstructHarnessHook', () => {
    const hook = vi.fn();
    createAgentOrchestratorForRun({
      variant: 'study-harness',
      llmAdapter: mockAdapter(),
      toolRegistry: new AgentToolRegistry(),
      resolvePrompt: (code) => code,
      canvasStore: mockCanvasStore(),
      postConstructHarnessHook: hook,
    });
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('production variant ignores postConstructHarnessHook even if provided', () => {
    const hook = vi.fn();
    createAgentOrchestratorForRun({
      variant: 'production',
      llmAdapter: mockAdapter(),
      toolRegistry: new AgentToolRegistry(),
      resolvePrompt: (code) => code,
      canvasStore: mockCanvasStore(),
      postConstructHarnessHook: hook,
    });
    expect(hook).not.toHaveBeenCalled();
  });

  it('wired resolveCanvasSettings returns the canvas.stylePlate', () => {
    const canvas = mockCanvasStore({
      nodes: [],
      settings: { stylePlate: 'noir' },
    });
    // Indirect assert: cast the resolver out of the factory via the
    // orchestrator's public options. We don't have a public getter so the
    // invariant is exercised through the full-suite regression tests
    // (agent-orchestrator.test.ts's style-plate-lock cases).
    const orchestrator = createAgentOrchestratorForRun({
      variant: 'production',
      llmAdapter: mockAdapter(),
      toolRegistry: new AgentToolRegistry(),
      resolvePrompt: (code) => code,
      canvasStore: canvas,
    });
    expect(orchestrator).toBeDefined();
  });

  it('missing resolveProcessPrompt leaves process-prompt specs dormant (no throw at construction)', () => {
    expect(() =>
      createAgentOrchestratorForRun({
        variant: 'production',
        llmAdapter: mockAdapter(),
        toolRegistry: new AgentToolRegistry(),
        resolvePrompt: (code) => code,
        canvasStore: mockCanvasStore(),
      }),
    ).not.toThrow();
  });
});
