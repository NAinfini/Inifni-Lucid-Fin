import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowTools, type WorkflowToolDeps } from './workflow-tools.js';

function createDeps(): WorkflowToolDeps {
  return {
    pauseWorkflow: vi.fn(async () => undefined),
    resumeWorkflow: vi.fn(async () => undefined),
    cancelWorkflow: vi.fn(async () => undefined),
    retryWorkflow: vi.fn(async () => undefined),
    createProductionPlan: vi.fn(async () => ({
      workflowRunId: 'wf-plan-1',
      gate: 'production_plan' as const,
      status: 'awaiting_approval' as const,
      revision: 1,
      contentHash: 'plan-hash-1',
    })),
    createVisualAuditions: vi.fn(async (input) => ({
      workflowRunId: input.workflowRunId,
      status: 'complete' as const,
      revision: 4,
      contentHash: 'visual-hash-1',
      recommendedCandidateId: 'analog-horror',
      candidates: input.candidates.map((candidate, index) => ({
        id: candidate.id,
        name: candidate.name,
        assetHash: `asset-${index + 1}`,
        score: 88 - index,
        providerId: input.providerId,
        model: 'image-model',
        seed: candidate.seed,
        estimatedCostUsd: 0.5,
      })),
    })),
    produceMedia: vi.fn(async (input) => ({
      ...input,
      status: 'accepted',
      message: 'passed',
    })),
    prepareFinalExport: vi.fn(
      async () =>
        ({
          created: true,
          context: { manifest: { revision: 2, contentHash: 'a'.repeat(64) } },
        }) as never,
    ),
  };
}

function productionPlan() {
  return {
    title: 'The Last Signal',
    logline: "A radio operator hears tomorrow's final transmission.",
    synopsis: 'A remote operator races to change a disaster encoded in a future broadcast.',
    genre: 'science-fiction thriller',
    tone: 'tense and intimate',
    targetAudience: 'adult genre audience',
    format: { targetDurationSeconds: 90, aspectRatio: '16:9' },
    story: {
      acts: [
        {
          name: 'Act 1',
          purpose: 'Establish the signal and its stakes.',
          scenes: [
            {
              title: 'The Broadcast',
              summary: 'Mara hears a warning in her own voice.',
              storyBeat: 'inciting incident',
              dialogueIntent: 'Disbelief gives way to fear.',
            },
          ],
        },
      ],
    },
    assumptions: ['Single primary location', 'Two speaking characters'],
    budget: {
      maxTotalCostUsd: 25,
      styleAuditionCostUsd: 3,
      maxAttemptsPerShot: 3,
      maxRegenerations: 8,
    },
    visualDirections: ['analog cosmic horror', 'restrained near-future realism'],
  };
}

function visualCandidates() {
  const grammar = {
    medium: 'cinematic digital image',
    era: 'late 1970s',
    rendering: 'restrained photochemical realism',
    linework: 'natural photographic edges',
    palette: 'amber, teal, charcoal',
    lighting: 'tungsten practical with cold fill',
    texture: 'fine 35mm grain',
    mood: 'isolated and foreboding',
    cameraGrammar: 'locked frames and controlled push-ins',
    lensGrammar: '32mm wides and 65mm closeups',
    compositionGrammar: 'negative space and foreground layers',
    motionGrammar: 'subtle human motion, stable camera',
    characterAnchors: [],
    locationAnchors: ['remote radio room'],
    negativeConstraints: ['no neon cyberpunk'],
  };
  return [
    {
      id: 'analog-horror',
      name: 'Analog Horror',
      summary: 'Tactile dread.',
      prompt: 'A remote radio room at midnight, analog dread.',
      seed: 101,
      constitution: grammar,
    },
    {
      id: 'quiet-realism',
      name: 'Quiet Realism',
      summary: 'Naturalistic tension.',
      prompt: 'A remote radio room at midnight, quiet realism.',
      seed: 202,
      constitution: { ...grammar, rendering: 'naturalistic near-future realism' },
    },
  ];
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
  it('defines workflow controls plus persistent production-plan creation', () => {
    const deps = createDeps();
    const tools = createWorkflowTools(deps);

    expect(tools.map((tool) => tool.name)).toEqual([
      'workflow.manage',
      'workflow.visual',
      'workflow.media',
      'workflow.finalExport',
    ]);
    expect(tools.every((tool) => tool.context?.includes('canvas'))).toBe(true);
  });

  it('delegates pause/resume/cancel/retry and validates ids', async () => {
    const deps = createDeps();
    const tools = createWorkflowTools(deps);

    await expect(
      getTool(tools, 'workflow.manage').execute({
        action: 'control',
        id: 'wf-1',
        controlAction: 'pause',
      }),
    ).resolves.toEqual({
      success: true,
      data: { id: 'wf-1', action: 'pause' },
    });
    await expect(
      getTool(tools, 'workflow.manage').execute({
        action: 'control',
        id: 'wf-2',
        controlAction: 'resume',
      }),
    ).resolves.toEqual({
      success: true,
      data: { id: 'wf-2', action: 'resume' },
    });
    await expect(
      getTool(tools, 'workflow.manage').execute({
        action: 'control',
        id: 'wf-3',
        controlAction: 'cancel',
      }),
    ).resolves.toEqual({
      success: true,
      data: { id: 'wf-3', action: 'cancel' },
    });
    await expect(
      getTool(tools, 'workflow.manage').execute({
        action: 'control',
        id: 'wf-4',
        controlAction: 'retry',
      }),
    ).resolves.toEqual({
      success: true,
      data: { id: 'wf-4', action: 'retry' },
    });

    await expect(
      getTool(tools, 'workflow.manage').execute({
        action: 'control',
        id: ' ',
        controlAction: 'pause',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'id is required',
      errorClass: 'validation',
    });
  });

  it('persists the AI-expanded production plan and returns the approval gate', async () => {
    const deps = createDeps();
    const tools = createWorkflowTools(deps);
    const plan = productionPlan();

    await expect(
      getTool(tools, 'workflow.manage').execute({
        action: 'createProductionPlan',
        canvasId: 'canvas-1',
        idea: 'A radio operator hears a transmission from tomorrow.',
        plan,
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        workflowRunId: 'wf-plan-1',
        gate: 'production_plan',
        status: 'awaiting_approval',
        revision: 1,
        contentHash: 'plan-hash-1',
      },
    });

    expect(deps.createProductionPlan).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      idea: 'A radio operator hears a transmission from tomorrow.',
      plan,
    });
  });

  it('wraps dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.cancelWorkflow).mockRejectedValueOnce(new Error('cancel failed'));

    await expect(
      createWorkflowTools(deps)
        .find((tool) => tool.name === 'workflow.manage')
        ?.execute({ action: 'control', id: 'wf-1', controlAction: 'cancel' }),
    ).resolves.toEqual({
      success: false,
      error: 'cancel failed',
    });
  });

  it('returns a teaching validation error when production-plan fields are missing', async () => {
    const tools = createWorkflowTools(createDeps());
    const result = await getTool(tools, 'workflow.manage').execute({
      action: 'createProductionPlan',
    });
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain('workflow.manage');
      expect(result.error).toContain('createProductionPlan');
      expect(result.error).toContain('"idea"');
      expect(result.error).toContain('is required');
      expect(result.error).toContain('You called it with:');
      expect(result.error).toMatch(/Correct call:.*idea/);
      expect(result.errorClass).toBe('validation');
    }
  });

  it('rejects an incomplete plan before calling persistence', async () => {
    const deps = createDeps();
    const tools = createWorkflowTools(deps);
    const result = await getTool(tools, 'workflow.manage').execute({
      action: 'createProductionPlan',
      canvasId: 'canvas-1',
      idea: 'A noir mystery.',
      plan: { title: 'Missing everything else' },
    });
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain('plan.logline');
      expect(result.errorClass).toBe('validation');
    }
    expect(deps.createProductionPlan).not.toHaveBeenCalled();
  });

  it('submits only a complete 2-4 candidate visual audition request', async () => {
    const deps = createDeps();
    const candidates = visualCandidates();
    await expect(
      getTool(createWorkflowTools(deps), 'workflow.visual').execute({
        canvasId: 'canvas-1',
        workflowRunId: 'wf-plan-1',
        providerId: 'openai-image',
        width: 1024,
        height: 576,
        candidates,
      }),
    ).resolves.toMatchObject({
      success: true,
      data: {
        workflowRunId: 'wf-plan-1',
        status: 'complete',
        revision: 4,
        recommendedCandidateId: 'analog-horror',
      },
    });
    expect(deps.createVisualAuditions).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      workflowRunId: 'wf-plan-1',
      providerId: 'openai-image',
      width: 1024,
      height: 576,
      candidates,
    });
  });

  it('rejects a visual audition with fewer than two candidates', async () => {
    const deps = createDeps();
    const result = await getTool(createWorkflowTools(deps), 'workflow.visual').execute({
      canvasId: 'canvas-1',
      workflowRunId: 'wf-plan-1',
      providerId: 'openai-image',
      candidates: visualCandidates().slice(0, 1),
    });
    expect(result).toMatchObject({ success: false, errorClass: 'validation' });
    expect(deps.createVisualAuditions).not.toHaveBeenCalled();
  });

  it('prepares the third approval gate without accepting clips or output paths', async () => {
    const deps = createDeps();
    await expect(
      getTool(createWorkflowTools(deps), 'workflow.finalExport').execute({
        canvasId: 'canvas-1',
        workflowRunId: 'wf-plan-1',
        expectedRowVersion: 7,
        codec: 'h265',
        quality: 'high',
        width: 3840,
        height: 2160,
        fps: 30,
      }),
    ).resolves.toMatchObject({ success: true, data: { created: true } });
    expect(deps.prepareFinalExport).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      workflowRunId: 'wf-plan-1',
      expectedRowVersion: 7,
      output: { codec: 'h265', quality: 'high', width: 3840, height: 2160, fps: 30 },
    });
  });

  it('delegates persistent generation without accepting model-authored prompts', async () => {
    const deps = createDeps();
    await expect(
      getTool(createWorkflowTools(deps), 'workflow.media').execute({
        canvasId: 'canvas-1',
        workflowRunId: 'wf-plan-1',
        nodeId: 'shot-3',
        expectedRowVersion: 7,
        prompt: 'must be ignored by the schema and never forwarded',
      }),
    ).resolves.toMatchObject({ success: true, data: { status: 'accepted' } });
    expect(deps.produceMedia).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      workflowRunId: 'wf-plan-1',
      nodeId: 'shot-3',
      expectedRowVersion: 7,
    });
  });
});
