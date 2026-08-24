import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AIProviderAdapter,
  GenerationRequest,
  LLMAdapter,
  PromptAssemblyOutputV1,
  PromptAssemblyRecord,
  ProductionMediaTaskAttempt,
  VisualAuditionDocumentContent,
  VisualDirectionCandidateProposal,
  VisualPreviewGrade,
} from '@lucid-fin/contracts';
import { AdapterRegistry } from '@lucid-fin/adapters-ai';
import { SqliteIndex } from '@lucid-fin/storage';
import {
  VISUAL_PREVIEW_RUBRIC_VERSION,
  TaskExecutionEngine,
  TaskListRegistry,
} from '@lucid-fin/application';
import {
  createStyleAuditionEvaluationContinuation,
  createStyleAuditionService,
  createVisualPreviewGrader,
} from './style-audition.service.js';
import { createPromptAssemblyService } from '../../services/prompt-assembly.service.js';

function grammar(rendering: string) {
  return {
    medium: 'cinematic digital image',
    era: 'late 1970s',
    rendering,
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
}

function candidates(): VisualDirectionCandidateProposal[] {
  return [
    {
      id: 'analog-horror',
      name: 'Analog Horror',
      summary: 'Tactile dread.',
      prompt: 'A remote radio room at midnight, analog dread.',
      seed: 101,
      constitution: grammar('photochemical realism'),
    },
    {
      id: 'quiet-realism',
      name: 'Quiet Realism',
      summary: 'Naturalistic tension.',
      prompt: 'A remote radio room at midnight, quiet realism.',
      seed: 202,
      constitution: grammar('near-future realism'),
    },
  ];
}

function grade(total = 85): VisualPreviewGrade {
  return {
    rubricVersion: VISUAL_PREVIEW_RUBRIC_VERSION,
    promptAdherence: total,
    styleClarity: total,
    storyFit: total,
    lighting: total,
    composition: total,
    continuityPotential: total,
    total,
    verdict: 'pass',
    strengths: ['Visible lighting hierarchy'],
    risks: ['Identity is not locked yet'],
    evidence: 'The image visibly preserves the radio room and low-key tungsten lighting.',
    visionProviderId: 'vision-test',
    visionModel: 'vision-model-test',
  };
}

describe('style audition service', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-style-service-'));
    roots.push(root);
    const db = new SqliteIndex(path.join(root, 'project.db'));
    indexes.push(db);
    let id = 0;
    const taskExecutionEngine = new TaskExecutionEngine({
      db,
      registry: new TaskListRegistry(),
      handlers: [],
      idFactory: () => `style-service-id-${++id}`,
      now: () => 1_000,
    });
    const created = taskExecutionEngine.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A radio receives tomorrow.',
      plan: {
        title: 'Signal',
        logline: 'Tomorrow calls tonight.',
        synopsis: 'A radio operator tries to prevent a disaster.',
        genre: 'science fiction',
        tone: 'tense',
        targetAudience: 'adult',
        format: { targetDurationSeconds: 60, aspectRatio: '16:9' },
        story: { acts: [{ name: 'Act 1', scenes: [{ title: 'Call' }] }] },
        assumptions: [],
        budget: {
          maxTotalCostUsd: 20,
          styleAuditionCostUsd: 2,
          maxAttemptsPerShot: 2,
          maxRegenerations: 4,
        },
        visualDirections: ['analog horror', 'quiet realism'],
      },
      commanderContinuation: {
        version: 1,
        sessionId: 'session-1',
        provider: {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.6-sol',
          protocol: 'openai-responses',
          authStyle: 'bearer',
        },
        permissionMode: 'normal',
      },
    });
    const pending = taskExecutionEngine.getPendingApprovalContext(created.taskListId);
    if (!pending) throw new Error('Expected production approval');
    const approved = taskExecutionEngine.approvePendingGateFromUser({
      taskListId: created.taskListId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.taskList.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
    });
    if (!approved.ok) throw new Error(`Approval failed: ${approved.code}`);
    const adapterRegistry = new AdapterRegistry();
    const adapter: AIProviderAdapter = {
      id: 'image-test',
      name: 'Image Test',
      type: 'image',
      capabilities: ['text-to-image'],
      maxConcurrent: 1,
      configure: () => undefined,
      validate: async () => true,
      generate: async (_request: GenerationRequest) => {
        throw new Error('Style service tests inject the guarded image submitter');
      },
      estimateCost: () => ({
        provider: 'image-test',
        estimatedCost: 0.2,
        currency: 'USD',
        unit: 'image',
      }),
      checkStatus: async () => 'completed',
      cancel: async () => undefined,
      getPromptLimits: () => ({ maxPromptChars: 4_000, negativePrompt: 'supported' }),
    };
    adapterRegistry.register(adapter);
    return {
      db,
      taskExecutionEngine,
      taskListId: created.taskListId,
      adapterRegistry,
      adapter,
      promptAssemblyService: createPromptAssemblyService({ db }),
    };
  }

  const request = (taskListId: string) => ({
    action: 'prepare' as const,
    canvasId: 'canvas-1',
    taskListId,
    providerId: 'image-test',
    width: 1024,
    height: 576,
    candidates: candidates(),
  });

  function output(
    record: PromptAssemblyRecord,
    finalPrompt = '  exact Commander prompt\nwith preserved spacing  ',
    negativePrompt = '  exact negative prompt  ',
  ): PromptAssemblyOutputV1 {
    return {
      version: 1,
      assemblyId: record.id,
      inputHash: record.inputHash,
      finalPrompt,
      negativePrompt,
      sourceDecisions: record.input.sources.map((source) => ({
        sourceId: source.sourceId,
        sourceHash: source.sourceHash,
        disposition: 'applied' as const,
      })),
      summary: 'Reconciled every durable source.',
      warnings: [],
    };
  }

  function createService(
    setupResult: ReturnType<typeof setup>,
    providerGenerate: (
      request: GenerationRequest,
      attempt: ProductionMediaTaskAttempt,
    ) => Promise<{
      [key: string]: unknown;
      assetHash: string;
      model?: string;
      reportedActualCostUsd?: number;
    }> = vi.fn(async () => {
      throw new Error('Unexpected provider call');
    }),
  ) {
    const settled = new Map<string, ProductionMediaTaskAttempt>();
    const advance = vi.fn(async (attemptId: string): Promise<ProductionMediaTaskAttempt> => {
      const replay = settled.get(attemptId);
      if (replay) return replay;
      const attempt = setupResult.db.repos.taskLists.getProductionMediaAttempt(attemptId);
      if (!attempt) throw new Error(`Missing reserved attempt: ${attemptId}`);
      const assembly = setupResult.promptAssemblyService.get(attempt.promptAssemblyId);
      if (assembly?.status === 'assembled') {
        setupResult.promptAssemblyService.markSubmitted(assembly.id);
      }
      let result: ProductionMediaTaskAttempt;
      try {
        const generated = await providerGenerate(attempt.generationSpec.request, attempt);
        result = {
          ...attempt,
          status: 'asset_ready',
          assetHash: generated.assetHash,
          ...(generated.model ? { model: generated.model } : {}),
          ...(generated.reportedActualCostUsd !== undefined
            ? { reportedActualCostUsd: generated.reportedActualCostUsd }
            : {}),
          assetReadyAt: 2_000,
          updatedAt: 2_000,
        };
      } catch (error) {
        result = {
          ...attempt,
          status: 'ambiguous',
          error: error instanceof Error ? error.message : String(error),
          completedAt: 2_000,
          updatedAt: 2_000,
        };
      }
      settled.set(attemptId, result);
      return result;
    });
    return createStyleAuditionService({
      taskExecutionEngine: setupResult.taskExecutionEngine,
      promptAssemblyService: setupResult.promptAssemblyService,
      adapterRegistry: setupResult.adapterRegistry,
      db: setupResult.db,
      mediaGenerationService: { advance },
      resolveProcessPrompt: () => 'Persistent Task List creative guidance.',
      commanderAuthor: { providerId: 'chatgpt-oauth', model: 'codex' },
    });
  }

  function createEvaluator(
    setupResult: ReturnType<typeof setup>,
    gradeImage: ReturnType<typeof vi.fn>,
  ) {
    return createStyleAuditionEvaluationContinuation({
      taskExecutionEngine: setupResult.taskExecutionEngine,
      promptAssemblyService: setupResult.promptAssemblyService,
      adapterRegistry: setupResult.adapterRegistry,
      resolveProcessPrompt: () => 'Persistent Task List creative guidance.',
      gradeImage,
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const db of indexes.splice(0)) db.close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('grades visual auditions with the Commander-selected visual LLM', async () => {
    const activeLLM = {
      id: 'chatgpt-oauth',
      name: 'ChatGPT',
      capabilities: ['text-generation', 'image-understanding'],
    } as unknown as LLMAdapter;
    const visualAnalyzer = {
      analyzeImageAsset: vi.fn(async () => ({
        text: JSON.stringify({
          promptAdherence: 90,
          styleClarity: 88,
          storyFit: 86,
          lighting: 84,
          composition: 82,
          continuityPotential: 80,
          strengths: ['Visible hierarchy'],
          risks: [],
          repairPrompt: '',
          evidence: 'The radio room is visibly lit by one tungsten practical.',
        }),
        providerId: activeLLM.id,
        model: 'codex',
      })),
      analyzeImageAssets: vi.fn(),
    };
    const grader = createVisualPreviewGrader({ visualAnalyzer, preferredLLMAdapter: activeLLM });

    await expect(
      grader({
        assetHash: 'preview-asset',
        candidate: candidates()[0],
        productionPlan: { title: 'Signal', genre: 'science fiction' },
      }),
    ).resolves.toMatchObject({ visionProviderId: 'chatgpt-oauth', visionModel: 'codex' });
    expect(visualAnalyzer.analyzeImageAsset).toHaveBeenCalledWith(
      'preview-asset',
      expect.objectContaining({ preferredLLMAdapter: activeLLM }),
    );
  });

  it('prepares every required source without provider or grader calls and reuses the same ID', async () => {
    const env = setup();
    const generateImage = vi.fn();
    const run = createService(env, generateImage);

    const first = await run(request(env.taskListId));
    expect(first).toMatchObject({
      status: 'awaiting_prompt_assembly',
      candidateId: 'analog-horror',
      nextAction: 'assemble_prompt',
    });
    if (first.status !== 'awaiting_prompt_assembly') throw new Error('Expected assembly');
    expect(first.promptAssembly.input.sources.map((source) => source.sourceId)).toEqual([
      'approved-production-plan',
      'candidate-summary',
      'candidate-preview-prompt',
      'candidate-visual-constitution',
      'candidate-negative-constraints',
      'task-list-guide',
    ]);
    expect(first.promptAssembly.input.sources.every((source) => source.required)).toBe(true);
    expect(first.promptAssembly.input.hostConstraints).toMatchObject({
      seed: 101,
      resolution: { width: 1024, height: 576 },
      budget: { approvedStyleAuditionCostUsd: 2 },
      retry: { maxAttemptsPerCandidate: 2, maxRegenerations: 4, attemptsUsed: 0 },
    });
    expect(first.promptAssembly.nodeUpdatedAt).toBe(first.revision);

    const repeated = await run(request(env.taskListId));
    expect(repeated).toMatchObject({
      status: 'awaiting_prompt_assembly',
      promptAssembly: { id: first.promptAssembly.id },
    });
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('persists an exact reservation before submitting and defers nested vision evaluation', async () => {
    const env = setup();
    const generateImage = vi.fn(
      async (providerRequest: GenerationRequest, mediaAttempt: ProductionMediaTaskAttempt) => {
      const assembly = env.promptAssemblyService.get(mediaAttempt.promptAssemblyId);
      expect(assembly).toMatchObject({
        status: 'submitted',
        output: {
          finalPrompt: '  exact Commander prompt\nwith preserved spacing  ',
          negativePrompt: '  exact negative prompt  ',
        },
      });
      const reserved = env.taskExecutionEngine.getLatestVisualAudition(env.taskListId)
        ?.content as VisualAuditionDocumentContent;
      expect(reserved.status).toBe('ambiguous');
      expect(
        reserved.candidates.find((candidate) => candidate.id === 'analog-horror'),
      ).toMatchObject({
        status: 'ambiguous',
        attempts: [
          {
            promptAssemblyId: mediaAttempt.promptAssemblyId,
            prompt: '  exact Commander prompt\nwith preserved spacing  ',
            negativePrompt: '  exact negative prompt  ',
            status: 'ambiguous',
          },
        ],
      });
      env.db.repos.assets.insert({ hash: 'asset-101', type: 'image', format: 'png' });
      return {
        assetHash: 'asset-101',
        providerId: 'image-test',
        requestedSeed: 101,
        reportedSeed: 101,
        width: 1024,
        height: 576,
        estimatedCostUsd: 0.2,
      };
      },
    );
    const run = createService(env, generateImage);
    const prepared = await run(request(env.taskListId));
    if (prepared.status !== 'awaiting_prompt_assembly') throw new Error('Expected assembly');

    const result = await run({
      action: 'submit',
      canvasId: 'canvas-1',
      taskListId: env.taskListId,
      promptAssemblyId: prepared.promptAssembly.id,
      promptAssemblyOutput: output(prepared.promptAssembly),
    });

    expect(result).toMatchObject({
      status: 'evaluation_pending',
      candidateId: 'analog-horror',
      promptAssemblyId: prepared.promptAssembly.id,
      assetHash: 'asset-101',
      nextAction: 'retry_evaluation',
    });
    expect(generateImage).toHaveBeenCalledWith(
      {
        type: 'image',
        providerId: 'image-test',
        prompt: '  exact Commander prompt\nwith preserved spacing  ',
        negativePrompt: '  exact negative prompt  ',
        width: 1024,
        height: 576,
        seed: 101,
      },
      expect.objectContaining({
        scope: 'style_audition',
        nodeId: 'style-audition:analog-horror',
        promptAssemblyId: prepared.promptAssembly.id,
        generationSpec: expect.objectContaining({
          specVersion: 3,
          authority: expect.objectContaining({
            kind: 'task-list-production-plan',
            candidateId: 'analog-horror',
          }),
        }),
      }),
    );
    const audition = env.taskExecutionEngine.getLatestVisualAudition(env.taskListId)?.content;
    expect(audition?.status).toBe('evaluation_pending');
    expect(
      audition?.candidates.find((candidate) => candidate.id === 'analog-horror'),
    ).toMatchObject({
      status: 'evaluation_pending',
      attempts: [
        {
          status: 'evaluation_pending',
          assetHash: 'asset-101',
          promptAssemblyId: prepared.promptAssembly.id,
        },
      ],
    });
  });

  it('never repeats a submitted provider reservation', async () => {
    const env = setup();
    const generateImage = vi.fn(async () => {
      env.db.repos.assets.insert({ hash: 'asset-once', type: 'image', format: 'png' });
      return {
        assetHash: 'asset-once',
        providerId: 'image-test',
        requestedSeed: 101,
        width: 1024,
        height: 576,
        estimatedCostUsd: 0.2,
      };
    });
    const run = createService(env, generateImage);
    const prepared = await run(request(env.taskListId));
    if (prepared.status !== 'awaiting_prompt_assembly') throw new Error('Expected assembly');
    const submit = {
      action: 'submit' as const,
      canvasId: 'canvas-1',
      taskListId: env.taskListId,
      promptAssemblyId: prepared.promptAssembly.id,
      promptAssemblyOutput: output(prepared.promptAssembly),
    };

    await expect(run(submit)).resolves.toMatchObject({ status: 'evaluation_pending' });
    await expect(run(submit)).resolves.toMatchObject({ status: 'evaluation_pending' });
    expect(generateImage).toHaveBeenCalledTimes(1);
  });

  it('leaves a not-yet-prepared style task for Commander without invoking the grader', async () => {
    const env = setup();
    const gradeImage = vi.fn(async () => grade());
    const evaluate = createEvaluator(env, gradeImage);

    await expect(evaluate(env.taskListId, 'canvas-1')).resolves.toBe('idle');
    expect(gradeImage).not.toHaveBeenCalled();
  });

  it('grades a durable pending preview out of band and advances exactly once', async () => {
    const env = setup();
    const generateImage = vi.fn(async () => {
      env.db.repos.assets.insert({ hash: 'asset-async-grade', type: 'image', format: 'png' });
      return {
        assetHash: 'asset-async-grade',
        providerId: 'image-test',
        requestedSeed: 101,
        width: 1024,
        height: 576,
        estimatedCostUsd: 0.2,
      };
    });
    const run = createService(env, generateImage);
    const prepared = await run(request(env.taskListId));
    if (prepared.status !== 'awaiting_prompt_assembly') throw new Error('Expected assembly');
    await run({
      action: 'submit',
      canvasId: 'canvas-1',
      taskListId: env.taskListId,
      promptAssemblyId: prepared.promptAssembly.id,
      promptAssemblyOutput: output(prepared.promptAssembly),
    });
    const gradeImage = vi.fn(async () => grade());
    const evaluate = createEvaluator(env, gradeImage);

    await expect(evaluate(env.taskListId, 'canvas-1')).resolves.toBe('commander_required');
    const latest = env.taskExecutionEngine.getLatestVisualAudition(env.taskListId)?.content as
      VisualAuditionDocumentContent | undefined;
    expect(latest?.candidates[0]).toMatchObject({
      status: 'completed',
      selectedAttempt: 1,
      attempts: [{ status: 'completed', grade: { total: 85 } }],
    });
    expect(latest?.candidates[1]).toMatchObject({
      status: 'awaiting_prompt_assembly',
      pendingPromptAssemblyId: expect.any(String),
    });

    await expect(evaluate(env.taskListId, 'canvas-1')).resolves.toBe('commander_required');
    expect(gradeImage).toHaveBeenCalledTimes(1);
    expect(generateImage).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed grade recoverable and resumes from the same provider attempt', async () => {
    const env = setup();
    const generateImage = vi.fn(async () => {
      env.db.repos.assets.insert({ hash: 'asset-grade-retry', type: 'image', format: 'png' });
      return {
        assetHash: 'asset-grade-retry',
        providerId: 'image-test',
        requestedSeed: 101,
        width: 1024,
        height: 576,
        estimatedCostUsd: 0.2,
      };
    });
    const run = createService(env, generateImage);
    const prepared = await run(request(env.taskListId));
    if (prepared.status !== 'awaiting_prompt_assembly') throw new Error('Expected assembly');
    await run({
      action: 'submit',
      canvasId: 'canvas-1',
      taskListId: env.taskListId,
      promptAssemblyId: prepared.promptAssembly.id,
      promptAssemblyOutput: output(prepared.promptAssembly),
    });
    const gradeImage = vi
      .fn()
      .mockRejectedValueOnce(new Error('vision provider unavailable'))
      .mockResolvedValueOnce(grade());
    const evaluate = createEvaluator(env, gradeImage);

    await expect(evaluate(env.taskListId, 'canvas-1')).rejects.toThrow(
      /vision provider unavailable/,
    );
    const pending = env.taskExecutionEngine.getLatestVisualAudition(env.taskListId)?.content as
      VisualAuditionDocumentContent | undefined;
    expect(pending?.status).toBe('evaluation_pending');
    expect(pending?.candidates[0]?.attempts[0]).toMatchObject({
      status: 'evaluation_pending',
      assetHash: 'asset-grade-retry',
      error: expect.stringContaining('vision provider unavailable'),
    });
    await expect(evaluate(env.taskListId, 'canvas-1')).resolves.toBe('commander_required');
    expect(gradeImage).toHaveBeenCalledTimes(2);
    expect(generateImage).toHaveBeenCalledTimes(1);
  });

  it('prepares a parent-linked repair assembly from the exact prompt, asset, and grade evidence', async () => {
    const env = setup();
    const generateImage = vi.fn(async () => {
      env.db.repos.assets.insert({ hash: 'asset-repair', type: 'image', format: 'png' });
      return {
        assetHash: 'asset-repair',
        providerId: 'image-test',
        requestedSeed: 101,
        width: 1024,
        height: 576,
        estimatedCostUsd: 0.2,
      };
    });
    const run = createService(env, generateImage);
    const prepared = await run(request(env.taskListId));
    if (prepared.status !== 'awaiting_prompt_assembly') throw new Error('Expected assembly');
    await run({
      action: 'submit',
      canvasId: 'canvas-1',
      taskListId: env.taskListId,
      promptAssemblyId: prepared.promptAssembly.id,
      promptAssemblyOutput: output(
        prepared.promptAssembly,
        'exact parent prompt',
        'parent negative',
      ),
    });
    const evaluate = createEvaluator(
      env,
      vi.fn(async () => ({
        ...grade(60),
        verdict: 'repair' as const,
        repairPrompt: 'Reduce the cyan spill while preserving the radio operator.',
        evidence: 'Cyan spill is visibly flattening the tungsten key.',
      })),
    );
    await expect(evaluate(env.taskListId, 'canvas-1')).resolves.toBe('commander_required');

    const repair = await run({
      action: 'status',
      canvasId: 'canvas-1',
      taskListId: env.taskListId,
    });
    expect(repair).toMatchObject({
      status: 'awaiting_prompt_assembly',
      candidateId: 'analog-horror',
      promptAssembly: {
        parentAssemblyId: prepared.promptAssembly.id,
        sourceAssetHash: 'asset-repair',
        purpose: 'evaluation_repair',
      },
    });
    if (repair.status !== 'awaiting_prompt_assembly') throw new Error('Expected repair assembly');
    expect(
      repair.promptAssembly.input.sources.find(
        (source) => source.sourceId === 'parent-final-prompt',
      ),
    ).toMatchObject({ content: 'exact parent prompt', required: true });
    expect(
      repair.promptAssembly.input.sources.find(
        (source) => source.sourceId === 'vision-repair-delta',
      ),
    ).toMatchObject({
      required: true,
      content: expect.stringContaining('Cyan spill is visibly flattening'),
    });
    expect(repair.promptAssembly.input.conditioningManifest).toEqual([
      { assetHash: 'asset-repair', roles: [{ role: 'generic_reference' }] },
    ]);
    expect(generateImage).toHaveBeenCalledTimes(1);
  });

  it('fails closed on an ambiguous provider outcome and never resends it', async () => {
    const env = setup();
    const generateImage = vi.fn(async () => {
      throw new Error('provider timed out after submission');
    });
    const run = createService(env, generateImage);
    const prepared = await run(request(env.taskListId));
    if (prepared.status !== 'awaiting_prompt_assembly') throw new Error('Expected assembly');
    const submit = {
      action: 'submit' as const,
      canvasId: 'canvas-1',
      taskListId: env.taskListId,
      promptAssemblyId: prepared.promptAssembly.id,
      promptAssemblyOutput: output(prepared.promptAssembly),
    };

    await expect(run(submit)).rejects.toThrow(/timed out/);
    await expect(run(submit)).rejects.toThrow(/durable provider reservation/);
    expect(generateImage).toHaveBeenCalledTimes(1);
  });
});
