import { describe, expect, it, vi } from 'vitest';
import { createAgentOrchestratorForRun } from './orchestrator-factory.js';
import { ToolRegistry } from './tool-registry.js';
import type { LLMAdapter } from '@lucid-fin/contracts';
import { createRunChecklistTools } from './tools/run-checklist-tools.js';

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

describe('createAgentOrchestratorForRun', () => {
  it('production variant constructs', () => {
    const orchestrator = createAgentOrchestratorForRun({
      variant: 'production',
      llmAdapter: mockAdapter(),
      toolRegistry: new ToolRegistry(),
      resolvePrompt: (code) => code,
    });
    expect(orchestrator).toBeDefined();
  });

  it('study-harness variant fires postConstructHarnessHook', () => {
    const hook = vi.fn();
    createAgentOrchestratorForRun({
      variant: 'study-harness',
      llmAdapter: mockAdapter(),
      toolRegistry: new ToolRegistry(),
      resolvePrompt: (code) => code,
      postConstructHarnessHook: hook,
    });
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('production variant ignores postConstructHarnessHook even if provided', () => {
    const hook = vi.fn();
    createAgentOrchestratorForRun({
      variant: 'production',
      llmAdapter: mockAdapter(),
      toolRegistry: new ToolRegistry(),
      resolvePrompt: (code) => code,
      postConstructHarnessHook: hook,
    });
    expect(hook).not.toHaveBeenCalled();
  });

  it('binds the registered runChecklist.manage definition to the run-local store', async () => {
    const registry = new ToolRegistry();
    registry.register(createRunChecklistTools()[0]);
    createAgentOrchestratorForRun({
      variant: 'production',
      llmAdapter: mockAdapter(),
      toolRegistry: registry,
      resolvePrompt: (code) => code,
    });

    const result = await registry.execute('runChecklist.manage', {
      action: 'set',
      items: [{ label: 'One' }, { label: 'Two' }],
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        runChecklist: {
          checklistId: expect.any(String),
          items: [
            expect.objectContaining({ label: 'One', status: 'in_progress' }),
            expect.objectContaining({ label: 'Two', status: 'pending' }),
          ],
        },
      },
    });
  });

});
