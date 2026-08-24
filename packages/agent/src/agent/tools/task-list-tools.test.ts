import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTaskListTools, type TaskListToolDeps } from './task-list-tools.js';

function createDeps(): TaskListToolDeps {
  return {
    pauseTaskList: vi.fn(async () => undefined),
    resumeTaskList: vi.fn(async () => undefined),
    cancelTaskList: vi.fn(async () => undefined),
    retryTaskList: vi.fn(async () => undefined),
    decidePendingGate: vi.fn(async (decision) => ({ decision })),
    prepareAudioTask: vi.fn(async () => ({}) as never),
    getAudioTask: vi.fn(async () => ({}) as never),
    submitAudioPrompt: vi.fn(async () => ({}) as never),
    createProductionPlan: vi.fn(async () => ({
      taskListId: 'task-list-plan-1',
      gate: 'production_plan' as const,
      status: 'awaiting_approval' as const,
      revision: 1,
      contentHash: 'plan-hash-1',
    })),
    createVisualAuditions: vi.fn(async (input) => {
      if (input.action !== 'prepare') throw new Error('Unexpected visual action in test');
      return {
        taskListId: input.taskListId,
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
      };
    }),
    produceMedia: vi.fn(async (input) => ({
      ...input,
      status: 'accepted',
      message: 'passed',
    })),
    refineMedia: vi.fn(async (input) => ({
      ...input,
      status: 'accepted',
      message: 'refined and passed',
    })),
    prepareDelivery: vi.fn(
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

function promptAssemblyOutput(assemblyId: string) {
  return {
    version: 1,
    assemblyId,
    inputHash: 'a'.repeat(64),
    finalPrompt: 'Exact Commander final provider prompt',
    negativePrompt: 'Exact Commander negative prompt',
    sourceDecisions: [
      {
        sourceId: 'node-prompt',
        sourceHash: 'b'.repeat(64),
        disposition: 'applied',
      },
    ],
    summary: 'Reconciled the approved prompt sources.',
    warnings: [],
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

describe('createTaskListTools', () => {
  it('defines task-list controls plus persistent production-plan creation', () => {
    const deps = createDeps();
    const tools = createTaskListTools(deps);

    expect(tools.map((tool) => tool.name)).toEqual([
      'taskList.manage',
      'task.visual',
      'task.media',
      'task.mediaFeedback',
      'task.audio',
      'task.delivery',
    ]);
    expect(tools.every((tool) => tool.contexts?.includes('canvas'))).toBe(true);
  });

  it('delegates pause/resume/cancel/retry and validates ids', async () => {
    const deps = createDeps();
    const tools = createTaskListTools(deps);

    await expect(
      getTool(tools, 'taskList.manage').execute({
        action: 'control',
        id: 'task-list-1',
        controlAction: 'pause',
      }),
    ).resolves.toEqual({
      success: true,
      data: { id: 'task-list-1', action: 'pause' },
    });
    await expect(
      getTool(tools, 'taskList.manage').execute({
        action: 'control',
        id: 'task-list-2',
        controlAction: 'resume',
      }),
    ).resolves.toEqual({
      success: true,
      data: { id: 'task-list-2', action: 'resume' },
    });
    await expect(
      getTool(tools, 'taskList.manage').execute({
        action: 'control',
        id: 'task-list-3',
        controlAction: 'cancel',
      }),
    ).resolves.toEqual({
      success: true,
      data: { id: 'task-list-3', action: 'cancel' },
    });
    await expect(
      getTool(tools, 'taskList.manage').execute({
        action: 'control',
        id: 'task-list-4',
        controlAction: 'retry',
      }),
    ).resolves.toEqual({
      success: true,
      data: { id: 'task-list-4', action: 'retry' },
    });

    await expect(
      getTool(tools, 'taskList.manage').execute({
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
    const tools = createTaskListTools(deps);
    const plan = productionPlan();

    await expect(
      getTool(tools, 'taskList.manage').execute({
        action: 'createProductionPlan',
        canvasId: 'canvas-1',
        idea: 'A radio operator hears a transmission from tomorrow.',
        plan,
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        taskListId: 'task-list-plan-1',
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

  it('passes optional AI-authored task names through as display-only plan data', async () => {
    const deps = createDeps();
    const plan = {
      ...productionPlan(),
      taskNames: {
        'production-plan': '梳理星际遗迹故事方案',
        'shot-spec-001': '定义遗迹入口的首个镜头',
      },
    };

    await getTool(createTaskListTools(deps), 'taskList.manage').execute({
      action: 'createProductionPlan',
      canvasId: 'canvas-1',
      idea: '探索一座星际遗迹。',
      plan,
    });

    expect(deps.createProductionPlan).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      idea: '探索一座星际遗迹。',
      plan,
    });
  });

  it('rejects unsafe task-name bounds without rewriting the plan', async () => {
    const deps = createDeps();
    const result = await getTool(createTaskListTools(deps), 'taskList.manage').execute({
      action: 'createProductionPlan',
      canvasId: 'canvas-1',
      idea: 'A bounded plan.',
      plan: { ...productionPlan(), taskNames: { task: 'x'.repeat(121) } },
    });

    expect(result).toMatchObject({ success: false, errorClass: 'validation' });
    expect(deps.createProductionPlan).not.toHaveBeenCalled();
  });

  it.each(['approve', 'request_changes'] as const)(
    'delegates a structured %s pending-gate decision without accepting a reason from the model',
    async (decision) => {
      const deps = createDeps();

      await expect(
        getTool(createTaskListTools(deps), 'taskList.manage').execute({
          action: 'decidePendingGate',
          canvasId: 'canvas-1',
          decision,
          reason: 'model-authored text must be ignored',
          taskListId: 'model-forged-task-list',
          expectedRowVersion: 999,
        }),
      ).resolves.toEqual({ success: true, data: { decision } });

      expect(deps.decidePendingGate).toHaveBeenCalledWith(decision);
    },
  );

  it('wraps dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.cancelTaskList).mockRejectedValueOnce(new Error('cancel failed'));

    await expect(
      createTaskListTools(deps)
        .find((tool) => tool.name === 'taskList.manage')
        ?.execute({ action: 'control', id: 'task-list-1', controlAction: 'cancel' }),
    ).resolves.toEqual({
      success: false,
      error: 'cancel failed',
    });
  });

  it('returns a teaching validation error when production-plan fields are missing', async () => {
    const tools = createTaskListTools(createDeps());
    const result = await getTool(tools, 'taskList.manage').execute({
      action: 'createProductionPlan',
    });
    expect(result.success).toBe(false);
    if (result.success === false) {
      expect(result.error).toContain('taskList.manage');
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
    const tools = createTaskListTools(deps);
    const result = await getTool(tools, 'taskList.manage').execute({
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

  it('allows the model to choose a single non-empty visual direction', async () => {
    const deps = createDeps();
    const result = await getTool(createTaskListTools(deps), 'taskList.manage').execute({
      action: 'createProductionPlan',
      canvasId: 'canvas-1',
      idea: 'A noir mystery.',
      plan: { ...productionPlan(), visualDirections: ['only one direction'] },
    });

    expect(result).toMatchObject({ success: true });
    expect(deps.createProductionPlan).toHaveBeenCalledOnce();
  });

  it('rejects only an excessive number of visual directions', async () => {
    const deps = createDeps();
    const result = await getTool(createTaskListTools(deps), 'taskList.manage').execute({
      action: 'createProductionPlan',
      canvasId: 'canvas-1',
      idea: 'A noir mystery.',
      plan: {
        ...productionPlan(),
        visualDirections: Array.from({ length: 21 }, (_, index) => `direction-${index}`),
      },
    });

    expect(result).toMatchObject({ success: false, errorClass: 'validation' });
    if (result.success === false) {
      expect(result.error).toContain('between 1 and 20');
    }
    expect(deps.createProductionPlan).not.toHaveBeenCalled();
  });

  it('submits a complete structured visual audition request', async () => {
    const deps = createDeps();
    const candidates = visualCandidates();
    await expect(
      getTool(createTaskListTools(deps), 'task.visual').execute({
        action: 'prepare',
        canvasId: 'canvas-1',
        taskListId: 'task-list-plan-1',
        providerId: 'openai-image',
        width: 1024,
        height: 576,
        candidates,
      }),
    ).resolves.toMatchObject({
      success: true,
      data: {
        taskListId: 'task-list-plan-1',
        status: 'complete',
        revision: 4,
        recommendedCandidateId: 'analog-horror',
      },
    });
    expect(deps.createVisualAuditions).toHaveBeenCalledWith({
      action: 'prepare',
      canvasId: 'canvas-1',
      taskListId: 'task-list-plan-1',
      providerId: 'openai-image',
      width: 1024,
      height: 576,
      candidates,
    });
  });

  it('allows the model to choose one complete visual-audition candidate', async () => {
    const deps = createDeps();
    const result = await getTool(createTaskListTools(deps), 'task.visual').execute({
      action: 'prepare',
      canvasId: 'canvas-1',
      taskListId: 'task-list-plan-1',
      providerId: 'openai-image',
      candidates: visualCandidates().slice(0, 1),
    });
    expect(result).toMatchObject({ success: true });
    expect(deps.createVisualAuditions).toHaveBeenCalledOnce();
  });

  it('prepares the third approval gate from only the persisted ordered delivery', async () => {
    const deps = createDeps();
    await expect(
      getTool(createTaskListTools(deps), 'task.delivery').execute({
        canvasId: 'canvas-1',
        taskListId: 'task-list-plan-1',
        expectedRowVersion: 7,
        packageBaseName: 'The Last Signal',
      }),
    ).resolves.toMatchObject({ success: true, data: { created: true } });
    expect(deps.prepareDelivery).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      taskListId: 'task-list-plan-1',
      expectedRowVersion: 7,
      packageBaseName: 'The Last Signal',
    });
  });

  it('delegates both phases and forwards only the structured Prompt Assembly output', async () => {
    const deps = createDeps();
    await expect(
      getTool(createTaskListTools(deps), 'task.media').execute({
        canvasId: 'canvas-1',
        taskListId: 'task-list-plan-1',
        taskId: 'task-shot-3',
        nodeId: 'shot-3',
        expectedRowVersion: 7,
        prompt: 'must be ignored by the schema and never forwarded',
      }),
    ).resolves.toMatchObject({ success: true, data: { status: 'accepted' } });
    expect(deps.produceMedia).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      taskListId: 'task-list-plan-1',
      taskId: 'task-shot-3',
      nodeId: 'shot-3',
      expectedRowVersion: 7,
    });

    const promptAssemblyId = 'assembly-shot-3-v1';
    const assemblyOutput = promptAssemblyOutput(promptAssemblyId);
    await expect(
      getTool(createTaskListTools(deps), 'task.media').execute({
        canvasId: 'canvas-1',
        taskListId: 'task-list-plan-1',
        taskId: 'task-shot-3',
        nodeId: 'shot-3',
        expectedRowVersion: 7,
        promptAssemblyId,
        promptAssemblyOutput: assemblyOutput,
      }),
    ).resolves.toMatchObject({ success: true });
    expect(deps.produceMedia).toHaveBeenLastCalledWith({
      canvasId: 'canvas-1',
      taskListId: 'task-list-plan-1',
      taskId: 'task-shot-3',
      nodeId: 'shot-3',
      expectedRowVersion: 7,
      promptAssemblyId,
      promptAssemblyOutput: assemblyOutput,
    });
  });

  it('rejects a mismatched Prompt Assembly identity at the task-list tool boundary', async () => {
    const deps = createDeps();
    const result = await getTool(createTaskListTools(deps), 'task.media').execute({
      canvasId: 'canvas-1',
      taskListId: 'task-list-plan-1',
      taskId: 'task-shot-3',
      nodeId: 'shot-3',
      expectedRowVersion: 7,
      promptAssemblyId: 'assembly-a',
      promptAssemblyOutput: promptAssemblyOutput('assembly-b'),
    });
    expect(result).toMatchObject({ success: false, errorClass: 'validation' });
    expect(deps.produceMedia).not.toHaveBeenCalled();
  });

  it('forwards only an exact attempt identity and additive user feedback for media refinement', async () => {
    const deps = createDeps();
    const basePromptHash = 'c'.repeat(64);

    await expect(
      getTool(createTaskListTools(deps), 'task.mediaFeedback').execute({
        canvasId: 'canvas-1',
        taskListId: 'task-list-plan-1',
        nodeId: 'shot-3',
        expectedRowVersion: 8,
        targetAttemptId: 'attempt-shot-3-v1',
        basePromptHash,
        feedback: 'Keep everything else; make the motion less shaky.',
        prompt: 'a forged full replacement prompt',
      }),
    ).resolves.toMatchObject({ success: true, data: { status: 'accepted' } });
    expect(deps.refineMedia).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      taskListId: 'task-list-plan-1',
      nodeId: 'shot-3',
      expectedRowVersion: 8,
      targetAttemptId: 'attempt-shot-3-v1',
      basePromptHash,
      feedback: 'Keep everything else; make the motion less shaky.',
    });
  });

  it('rejects stale-looking media feedback identities before host execution', async () => {
    const deps = createDeps();

    await expect(
      getTool(createTaskListTools(deps), 'task.mediaFeedback').execute({
        canvasId: 'canvas-1',
        taskListId: 'task-list-plan-1',
        nodeId: 'shot-3',
        expectedRowVersion: 8,
        targetAttemptId: 'attempt-shot-3-v1',
        basePromptHash: 'not-a-hash',
        feedback: 'Less shaky.',
      }),
    ).resolves.toMatchObject({ success: false, errorClass: 'validation' });
    expect(deps.refineMedia).not.toHaveBeenCalled();
  });

  it('creates audio through Commander and submits only the explicit Prompt Assembly output', async () => {
    const deps = createDeps();
    const prepareAudioTask = vi.fn(async () => ({ id: 'audio-list-1' }) as never);
    const submitAudioPrompt = vi.fn(async () => ({ id: 'audio-list-1' }) as never);
    deps.prepareAudioTask = prepareAudioTask;
    deps.submitAudioPrompt = submitAudioPrompt;
    const tool = getTool(createTaskListTools(deps), 'task.audio');

    await expect(
      tool.execute({
        action: 'prepare',
        subtype: 'music',
        prompt: 'A restrained nocturnal piano cue',
        providerId: 'suno',
        duration: 20,
      }),
    ).resolves.toMatchObject({ success: true, data: { id: 'audio-list-1' } });
    expect(prepareAudioTask).toHaveBeenCalledWith({
      subtype: 'music',
      prompt: 'A restrained nocturnal piano cue',
      providerId: 'suno',
      duration: 20,
    });

    const output = promptAssemblyOutput('assembly-audio-1');
    await expect(
      tool.execute({
        action: 'submit',
        taskListId: 'audio-list-1',
        promptAssemblyId: 'assembly-audio-1',
        promptAssemblyOutput: output,
      }),
    ).resolves.toMatchObject({ success: true, data: { id: 'audio-list-1' } });
    expect(submitAudioPrompt).toHaveBeenCalledWith({
      taskListId: 'audio-list-1',
      promptAssemblyId: 'assembly-audio-1',
      promptAssemblyOutput: output,
    });
  });
});
