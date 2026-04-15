import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowTools, type WorkflowToolDeps } from './workflow-tools.js';
import { WORKFLOW_GUIDES } from './workflow-guides.js';

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
      'workflow.control',
      'workflow.expandIdea',
    ]);
    expect(tools.every((tool) => tool.context?.includes('canvas'))).toBe(true);
  });

  it('delegates pause/resume/cancel/retry and validates ids', async () => {
    const deps = createDeps();
    const tools = createWorkflowTools(deps);

    await expect(getTool(tools, 'workflow.control').execute({ id: 'wf-1', action: 'pause' })).resolves.toEqual({
      success: true,
      data: { id: 'wf-1', action: 'pause' },
    });
    await expect(getTool(tools, 'workflow.control').execute({ id: 'wf-2', action: 'resume' })).resolves.toEqual({
      success: true,
      data: { id: 'wf-2', action: 'resume' },
    });
    await expect(getTool(tools, 'workflow.control').execute({ id: 'wf-3', action: 'cancel' })).resolves.toEqual({
      success: true,
      data: { id: 'wf-3', action: 'cancel' },
    });
    await expect(getTool(tools, 'workflow.control').execute({ id: 'wf-4', action: 'retry' })).resolves.toEqual({
      success: true,
      data: { id: 'wf-4', action: 'retry' },
    });

    await expect(getTool(tools, 'workflow.control').execute({ id: ' ', action: 'pause' })).resolves.toEqual({
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

    await expect(createWorkflowTools(deps).find((tool) => tool.name === 'workflow.control')?.execute({ id: 'wf-1', action: 'cancel' }))
      .resolves.toEqual({
        success: false,
        error: 'cancel failed',
      });
  });
});

describe('WORKFLOW_GUIDES', () => {
  it('exports 9 workflow prompt guides with required fields', () => {
    expect(WORKFLOW_GUIDES.length).toBe(9);
    for (const guide of WORKFLOW_GUIDES) {
      expect(guide.id).toBeTruthy();
      expect(guide.name).toBeTruthy();
      expect(guide.content).toBeTruthy();
      expect(guide.id).toMatch(/^workflow-/);
    }
  });

  it('includes key workflow guides', () => {
    const ids = WORKFLOW_GUIDES.map((g) => g.id);
    expect(ids).toContain('workflow-style-transfer');
    expect(ids).toContain('workflow-shot-list');
    expect(ids).toContain('workflow-batch-reprompt');
    expect(ids).toContain('workflow-continuity-check');
    expect(ids).toContain('workflow-storyboard-export');
    expect(ids).toContain('workflow-image-analyze');
    expect(ids).toContain('workflow-video-clone');
    expect(ids).toContain('workflow-lip-sync');
    expect(ids).toContain('workflow-emotion-voice');
  });
});
