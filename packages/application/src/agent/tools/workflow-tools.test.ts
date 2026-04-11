import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUtilityWorkflowTools, createWorkflowTools, type WorkflowToolDeps } from './workflow-tools.js';

function createDeps(): WorkflowToolDeps {
  return {
    pauseWorkflow: vi.fn(async () => undefined),
    resumeWorkflow: vi.fn(async () => undefined),
    cancelWorkflow: vi.fn(async () => undefined),
    retryWorkflow: vi.fn(async () => undefined),
  };
}

function getTool<T extends { name: string }>(tools: T[], name: string) {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createWorkflowTools', () => {
  it('defines workflow controls plus expandIdea', () => {
    const deps = createDeps();
    const tools = createWorkflowTools(deps);

    expect(tools.map((tool) => tool.name)).toEqual([
      'workflow.pause',
      'workflow.resume',
      'workflow.cancel',
      'workflow.retry',
      'workflow.expandIdea',
    ]);
    expect(tools.every((tool) => tool.context?.includes('canvas'))).toBe(true);
  });

  it('delegates pause/resume/cancel/retry and validates ids', async () => {
    const deps = createDeps();
    const tools = createWorkflowTools(deps);

    await expect(getTool(tools, 'workflow.pause').execute({ id: 'wf-1' })).resolves.toEqual({
      success: true,
      data: { id: 'wf-1' },
    });
    await expect(getTool(tools, 'workflow.resume').execute({ id: 'wf-2' })).resolves.toEqual({
      success: true,
      data: { id: 'wf-2' },
    });
    await expect(getTool(tools, 'workflow.cancel').execute({ id: 'wf-3' })).resolves.toEqual({
      success: true,
      data: { id: 'wf-3' },
    });
    await expect(getTool(tools, 'workflow.retry').execute({ id: 'wf-4' })).resolves.toEqual({
      success: true,
      data: { id: 'wf-4' },
    });

    await expect(getTool(tools, 'workflow.pause').execute({ id: ' ' })).resolves.toEqual({
      success: false,
      error: 'id is required',
    });
  });

  it('builds expandIdea instructions with defaults and explicit overrides', async () => {
    const tools = createWorkflowTools(createDeps());

    await expect(getTool(tools, 'workflow.expandIdea').execute({
      prompt: 'time-traveling samurai',
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        instructions: expect.stringContaining('time-traveling samurai'),
        outlineFormat: expect.objectContaining({
          genre: 'cinematic',
          acts: [
            { name: 'Act 1', scenes: [{ title: '<scene title>', summary: '<2-3 sentence summary>' }] },
            { name: 'Act 2', scenes: [{ title: '<scene title>', summary: '<2-3 sentence summary>' }] },
            { name: 'Act 3', scenes: [{ title: '<scene title>', summary: '<2-3 sentence summary>' }] },
          ],
        }),
      }),
    });

    await expect(getTool(tools, 'workflow.expandIdea').execute({
      prompt: 'time-traveling samurai',
      genre: 'anime',
      actCount: 2.2,
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        instructions: expect.stringContaining('anime story with 2 acts'),
        outlineFormat: expect.objectContaining({
          genre: 'anime',
          acts: [
            { name: 'Act 1', scenes: [{ title: '<scene title>', summary: '<2-3 sentence summary>' }] },
            { name: 'Act 2', scenes: [{ title: '<scene title>', summary: '<2-3 sentence summary>' }] },
          ],
        }),
      }),
    });
  });

  it('wraps dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.cancelWorkflow).mockRejectedValueOnce(new Error('cancel failed'));

    await expect(createWorkflowTools(deps).find((tool) => tool.name === 'workflow.cancel')?.execute({ id: 'wf-1' }))
      .resolves.toEqual({
        success: false,
        error: 'cancel failed',
      });
  });
});

describe('createUtilityWorkflowTools', () => {
  it('returns structured workflow guidance tools', async () => {
    const tools = createUtilityWorkflowTools();

    await expect(getTool(tools, 'workflow.styleTransfer').execute({
      canvasId: 'canvas-1',
      referenceNodeId: 'node-1',
      targetNodeIds: ['node-2', 'node-3'],
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        instructions: expect.stringContaining('node-1'),
      }),
    });

    await expect(getTool(tools, 'workflow.shotList').execute({
      canvasId: 'canvas-1',
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        instructions: expect.stringContaining('canvas.searchNodes'),
        shotSchema: expect.objectContaining({ shotType: 'ECU|CU|MS|LS|ELS' }),
      }),
    });

    await expect(getTool(tools, 'workflow.batchRePrompt').execute({
      canvasId: 'canvas-1',
      nodeIds: ['node-1'],
      styleTarget: 'neo-noir',
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        instructions: expect.stringContaining('neo-noir'),
      }),
    });

    await expect(getTool(tools, 'workflow.continuityCheck').execute({
      canvasId: 'canvas-1',
      nodeIds: ['node-1'],
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        severityLevels: {
          critical: 'must fix',
          major: 'should fix',
          minor: 'flag only',
        },
      }),
    });

    await expect(getTool(tools, 'workflow.storyboardExport').execute({
      canvasId: 'canvas-1',
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        instructions: expect.stringContaining('canvas.searchNodes(canvasId="canvas-1", type="image")'),
      }),
    });

    await expect(getTool(tools, 'workflow.imageAnalyze').execute({
      canvasId: 'canvas-1',
      nodeId: 'node-1',
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        extractionSchema: expect.objectContaining({
          characters: [expect.objectContaining({ name: '' })],
        }),
      }),
    });
  });
});
