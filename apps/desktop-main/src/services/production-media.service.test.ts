import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type {
  ProductionMediaFeedbackReservationRequest,
  WorkflowEngine,
} from '@lucid-fin/application';
import type {
  AIProviderAdapter,
  Canvas,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  LLMAdapter,
  WorkflowApproval,
  WorkflowDocument,
  WorkflowRun,
  WorkflowRunId,
  WorkflowStageRun,
  WorkflowTaskRun,
} from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import type { CAS, Keychain } from '@lucid-fin/storage';
import type { CanvasStore } from '../ipc/handlers/canvas.handlers.js';
import type { VisualAnalyzer } from './visual-analyzer.service.js';
import {
  createProductionMediaService,
  type ProductionMediaGradeRequest,
} from './production-media.service.js';

const PLAN_HASH = 'a'.repeat(64);
const VISUAL_HASH = 'b'.repeat(64);

function plan(): WorkflowDocument {
  return {
    id: 'plan-doc',
    workflowRunId: 'run-media',
    logicalKey: 'production-plan',
    documentType: 'production_plan',
    revision: 1,
    schemaVersion: 1,
    content: {
      title: 'Signal',
      synopsis: 'A radio operator receives tomorrow.',
      tone: 'tense',
      budget: {
        maxTotalCostUsd: 10,
        styleAuditionCostUsd: 1,
        maxAttemptsPerShot: 2,
        maxRegenerations: 3,
      },
    },
    contentHash: PLAN_HASH,
    status: 'active',
    createdAt: 100,
    updatedAt: 100,
  };
}

function visual(): WorkflowDocument {
  return {
    id: 'visual-doc',
    workflowRunId: 'run-media',
    logicalKey: 'visual-constitution',
    documentType: 'visual_constitution',
    revision: 1,
    schemaVersion: 1,
    content: {
      locked: {
        medium: 'cinematic digital image',
        era: 'late 1970s',
        rendering: 'photochemical realism',
        linework: 'natural edges',
        palette: 'amber, teal, charcoal',
        lighting: 'tungsten practical with cold fill',
        texture: 'fine 35mm grain',
        mood: 'isolated and foreboding',
        cameraGrammar: 'controlled frames',
        lensGrammar: '32mm wides',
        compositionGrammar: 'negative space',
        motionGrammar: 'stable camera',
        characterAnchors: ['same narrow face and red scarf'],
        locationAnchors: ['remote radio room'],
        negativeConstraints: ['no neon cyberpunk'],
      },
    },
    contentHash: VISUAL_HASH,
    status: 'active',
    createdAt: 110,
    updatedAt: 110,
  };
}

function run(mediaType: 'image' | 'video'): WorkflowRun {
  return {
    id: 'run-media',
    workflowType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status: 'ready',
    summary: 'Ready for media generation',
    progress: 50,
    completedStages: 0,
    totalStages: 0,
    completedTasks: 0,
    totalTasks: 0,
    currentStageId: 'stage-production-plan',
    input: { mediaType },
    output: {},
    metadata: {},
    createdAt: 90,
    updatedAt: 90,
    rowVersion: 0,
    engineVersion: 'persistent-hybrid-v1',
    definitionVersion: 1,
  };
}

function stage(id: string, stageId: string, order: number): WorkflowStageRun {
  return {
    id,
    workflowRunId: 'run-media',
    stageId,
    name: stageId,
    status: order === 0 ? 'ready' : 'blocked',
    order,
    progress: 0,
    completedTasks: 0,
    totalTasks: 0,
    metadata: { dependsOnStageIds: [] },
    updatedAt: 100,
  };
}

function mediaTask(): WorkflowTaskRun {
  return {
    id: 'task-media-1',
    workflowRunId: 'run-media',
    stageRunId: 'stage-media-generation',
    taskId: 'media-shot-001',
    name: 'Generate shot 001',
    kind: 'adapter_generation',
    status: 'ready',
    dependencyIds: [],
    attempts: 0,
    maxRetries: 0,
    input: {
      executionMode: 'external',
      workflowTaskRole: 'production_media',
      shot: { id: '001', title: 'Operator hears the warning' },
    },
    output: {},
    progress: 0,
    updatedAt: 100,
  };
}

function approval(
  id: string,
  gateKey: WorkflowApproval['gateKey'],
  document: WorkflowDocument,
): WorkflowApproval {
  return {
    id,
    workflowRunId: 'run-media',
    gateKey,
    subjectLogicalKey: document.logicalKey,
    subjectRevision: document.revision,
    subjectHash: document.contentHash,
    manifestHash: document.contentHash,
    resumeTokenHash: `${id}-token`,
    status: 'pending',
    createdAt: 120,
    updatedAt: 120,
  };
}

function makeCanvas(mediaType: 'image' | 'video'): Canvas {
  return {
    id: 'canvas-1',
    name: 'Signal',
    nodes: [
      {
        id: 'shot-1',
        type: mediaType,
        title: 'Operator hears the warning',
        position: { x: 0, y: 0 },
        data: {
          status: 'empty',
          prompt: 'The operator turns toward a glowing radio dial.',
          variants: [],
          selectedVariantIndex: 0,
          providerId: `${mediaType}-provider`,
          ...(mediaType === 'video' ? { duration: 6, fps: 24 } : {}),
        },
        bypassed: false,
        locked: false,
        createdAt: 80,
        updatedAt: 80,
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 80,
    updatedAt: 80,
  };
}

function highGrade(): string {
  return JSON.stringify({
    scores: {
      identity: 92,
      style: 90,
      scriptAlignment: 91,
      continuity: 90,
      composition: 88,
      lighting: 90,
      motion: 89,
      technical: 92,
      safety: 100,
    },
    strengths: ['The red scarf and radio room are visible'],
    risks: [],
    evidence: ['The subject wears the same red scarf beside the amber radio dial'],
  });
}

function repairGrade(): string {
  return JSON.stringify({
    scores: {
      identity: 52,
      style: 72,
      scriptAlignment: 70,
      continuity: 58,
      composition: 72,
      lighting: 75,
      motion: 70,
      technical: 80,
      safety: 100,
    },
    strengths: ['The radio room is visible'],
    risks: ['The face and scarf drift from the locked character anchor'],
    evidence: ['The scarf is blue instead of red'],
    repairDelta: {
      version: 1,
      reason: 'Restore character identity',
      promptAdditions: ['same narrow face and red scarf'],
      negativeAdditions: ['blue scarf', 'different face'],
      preserve: ['tungsten radio-room lighting'],
      seedStrategy: 'increment',
    },
  });
}

class FakeCas {
  private counter = 0;
  private readonly paths = new Map<string, string>();

  async importAsset(filePath: string, type: 'image' | 'video' | 'audio') {
    const hash = `${type}-asset-${++this.counter}`;
    this.paths.set(hash, filePath);
    return {
      ref: { hash, type, format: type === 'video' ? 'mp4' : 'png', path: filePath },
      meta: {
        hash,
        type,
        format: type === 'video' ? 'mp4' : 'png',
        originalName: path.basename(filePath),
        fileSize: fs.statSync(filePath).size,
        tags: [],
        createdAt: 100,
      },
    };
  }

  getAssetPath(hash: string): string {
    return this.paths.get(hash) ?? '';
  }
}

function makeAdapter(
  mediaType: 'image' | 'video',
  outputPath: string,
  generate?: (request: GenerationRequest) => Promise<GenerationResult>,
  estimatedCost = 0.25,
): AIProviderAdapter {
  return {
    id: `${mediaType}-provider`,
    name: `${mediaType} provider`,
    type: mediaType,
    capabilities: [mediaType === 'image' ? 'text-to-image' : 'text-to-video'],
    maxConcurrent: 1,
    configure: vi.fn(),
    validate: vi.fn(async () => true),
    generate:
      generate ??
      vi.fn(async () => ({
        assetHash: '',
        assetPath: outputPath,
        provider: `${mediaType}-provider`,
        cost: 0.2,
        metadata: { model: `${mediaType}-model`, jobId: 'provider-job-1' },
      })),
    estimateCost: vi.fn((): CostEstimate => ({
      provider: `${mediaType}-provider`,
      estimatedCost,
      currency: 'USD',
      unit: 'generation',
    })),
    checkStatus: vi.fn(async () => 'completed'),
    cancel: vi.fn(async () => undefined),
  };
}

describe('ProductionMediaService', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  function setup(
    mediaType: 'image' | 'video',
    gradeAssets:
      | ((request: ProductionMediaGradeRequest) => Promise<{
          text: string;
          providerId: string;
          model?: string;
        }>)
      | undefined,
    options: {
      generate?: (request: GenerationRequest) => Promise<GenerationResult>;
      estimatedCost?: number;
      probeMedia?: () => Promise<{
        durationSeconds: number;
        width: number;
        height: number;
        fps: number;
        videoCodec: string;
        hasAudio: boolean;
      }>;
      detectScenes?: () => Promise<Array<{ time: number; score: number }>>;
      extractFrameAtTime?: (
        videoPath: string,
        timestampSeconds: number,
        outputPath: string,
      ) => Promise<void>;
      visualAnalyzer?: VisualAnalyzer;
    } = {},
  ) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-production-media-'));
    roots.push(root);
    const db = new SqliteIndex(path.join(root, 'project.db'));
    indexes.push(db);
    const repo = db.repos.workflows;
    const productionPlan = plan();
    const visualConstitution = visual();
    repo.insertRun(run(mediaType));
    repo.insertStageRun(stage('stage-production-plan', 'production-plan', 0));
    repo.insertStageRun(stage('stage-style-exploration', 'style-exploration', 1));
    repo.insertStageRun(stage('stage-media-generation', 'media-generation', 2));
    const productionTask = mediaTask();
    repo.insertTaskRun(productionTask);
    repo.createDocument(productionPlan);
    repo.createPendingApproval(approval('plan-approval', 'production_plan', productionPlan));
    let current = repo.getRun('run-media' as WorkflowRunId)!;
    const planApproval = repo.approveGate({
      workflowRunId: 'run-media' as WorkflowRunId,
      gateKey: 'production_plan',
      expectedRowVersion: current.rowVersion ?? -1,
      expectedSubjectRevision: 1,
      expectedSubjectHash: PLAN_HASH,
      resumeTokenHash: 'plan-approval-token',
      eventId: 'plan-event',
      actor: 'user',
      approvedAt: 130,
      nextStageId: 'stage-style-exploration',
    });
    if (!planApproval.ok) throw new Error(planApproval.code);
    repo.createDocument(visualConstitution);
    repo.createPendingApproval(
      approval('visual-approval', 'visual_constitution', visualConstitution),
    );
    current = repo.getRun('run-media' as WorkflowRunId)!;
    const visualApproval = repo.approveGate({
      workflowRunId: 'run-media' as WorkflowRunId,
      gateKey: 'visual_constitution',
      expectedRowVersion: current.rowVersion ?? -1,
      expectedSubjectRevision: 1,
      expectedSubjectHash: VISUAL_HASH,
      resumeTokenHash: 'visual-approval-token',
      eventId: 'visual-event',
      actor: 'user',
      approvedAt: 140,
      nextStageId: 'stage-media-generation',
      nextTaskId: productionTask.id,
    });
    if (!visualApproval.ok) throw new Error(visualApproval.code);
    current = repo.getRun('run-media' as WorkflowRunId)!;

    const canvas = makeCanvas(mediaType);
    const canvasStore: CanvasStore = {
      get: (id) => (id === canvas.id ? canvas : undefined),
      save: vi.fn(),
      delete: vi.fn(),
      list: () => [],
      listFull: () => [canvas],
    };
    const outputPath = path.join(root, mediaType === 'video' ? 'generated.mp4' : 'generated.png');
    fs.writeFileSync(outputPath, Buffer.from('generated-media'));
    const adapter = makeAdapter(mediaType, outputPath, options.generate, options.estimatedCost);
    const adapterRegistry = new AdapterRegistry();
    adapterRegistry.register(adapter);
    const cas = new FakeCas();
    let id = 0;
    let now = 1_000;
    const workflowEngine = {
      requireProductionMediaContext: vi.fn(() => ({
        run: repo.getRun('run-media' as WorkflowRunId)!,
        task: productionTask,
        productionPlan,
        visualConstitution,
      })),
      requireProductionMediaFeedbackContext: vi.fn(() => ({
        run: repo.getRun('run-media' as WorkflowRunId)!,
        task: repo.getTaskRun(productionTask.id as never) ?? productionTask,
        productionPlan,
        visualConstitution,
      })),
      getTasks: vi.fn(() => [repo.getTaskRun(productionTask.id as never) ?? productionTask]),
      reserveProductionMediaFeedbackAttemptForRevision: vi.fn(
        (input: ProductionMediaFeedbackReservationRequest) => {
          const reopenedAt = ++now;
          const result = repo.reserveMediaFeedbackAttempt({
            workflowRunId: input.workflowRunId,
            canvasId: input.canvasId,
            taskRunId: input.taskRunId,
            attemptId: input.attemptId,
            basePromptHash: input.basePromptHash,
            expectedRunRowVersion: input.expectedRowVersion,
            feedback: input.feedback,
            attempt: input.attempt,
            reopenedAt,
            event: {
              workflowRunId: input.workflowRunId,
              eventId: `feedback-event-${reopenedAt}`,
              actor: 'user',
              payload: {},
              timestamp: reopenedAt,
            },
          });
          return { run: result.run, task: result.task, attempt: result.attempt };
        },
      ),
      getLatestVisualAudition: vi.fn(() => undefined),
    } as unknown as WorkflowEngine;
    const service = createProductionMediaService({
      db,
      cas: cas as unknown as CAS,
      keychain: { getKey: vi.fn(async () => 'test-key') } as unknown as Keychain,
      visualAnalyzer:
        options.visualAnalyzer ??
        ({
          analyzeImageAsset: vi.fn(),
          analyzeImageAssets: vi.fn(),
        } as unknown as VisualAnalyzer),
      adapterRegistry,
      canvasStore,
      workflowEngine,
      ...(gradeAssets ? { gradeAssets } : {}),
      probeMedia:
        options.probeMedia ??
        (async () => ({
          durationSeconds: mediaType === 'video' ? 5 : 0,
          width: mediaType === 'video' ? 1280 : 1024,
          height: mediaType === 'video' ? 720 : 1024,
          fps: 24,
          videoCodec: mediaType === 'video' ? 'h264' : 'png',
          hasAudio: false,
        })),
      detectScenes: options.detectScenes ?? (async () => []),
      extractFrameAtTime: options.extractFrameAtTime,
      now: () => ++now,
      idFactory: () => `media-service-id-${++id}`,
    });
    return { db, repo, current, task: productionTask, canvas, canvasStore, adapter, cas, service };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const db of indexes.splice(0)) db.close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('grades production media with the Commander-selected visual LLM', async () => {
    const activeLLM = {
      id: 'gemini-oauth',
      name: 'Gemini',
      capabilities: ['text-generation', 'image-understanding'],
    } as unknown as LLMAdapter;
    const visualAnalyzer = {
      analyzeImageAsset: vi.fn(),
      analyzeImageAssets: vi.fn(async () => ({
        text: highGrade(),
        providerId: activeLLM.id,
        model: 'gemini-3.6-flash',
      })),
    } as unknown as VisualAnalyzer;
    const setupResult = setup('image', undefined, { visualAnalyzer });

    await expect(
      setupResult.service.produce(
        {
          workflowRunId: 'run-media',
          canvasId: 'canvas-1',
          taskRunId: 'task-media-1',
          nodeId: 'shot-1',
          expectedRowVersion: setupResult.current.rowVersion ?? -1,
        },
        { preferredLLMAdapter: activeLLM },
      ),
    ).resolves.toMatchObject({ status: 'accepted' });
    expect(visualAnalyzer.analyzeImageAssets).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ preferredLLMAdapter: activeLLM }),
    );
  });

  it('persists the reservation before calling the provider and selects only a passing image', async () => {
    const dbRef: { current?: SqliteIndex } = {};
    const generate = vi.fn(async (request: GenerationRequest) => {
      const activeDb = dbRef.current;
      if (!activeDb) throw new Error('Test database was not initialized before generation');
      const row = activeDb.rawDb
        .prepare('SELECT status FROM workflow_media_attempts LIMIT 1')
        .get() as { status: string };
      expect(row.status).toBe('submitted');
      expect(request.prompt).toMatch(/^VISUAL STYLE AUTHORITY/);
      expect(request.prompt).toContain('Character anchors: same narrow face and red scarf');
      expect(request.prompt).toContain('The operator turns toward a glowing radio dial.');
      expect(request.prompt).toMatch(/APPROVED VISUAL CONSTITUTION REMAINS AUTHORITATIVE[^]*$/);
      expect(request.negativePrompt).toContain('no neon cyberpunk');
      return {
        assetHash: '',
        assetPath: path.join(roots[0], 'generated.png'),
        provider: 'image-provider',
        cost: 0.2,
        metadata: { model: 'image-model' },
      };
    });
    const grade = vi.fn(async () => ({
      text: highGrade(),
      providerId: 'vision-provider',
      model: 'vision-model',
    }));
    const setupResult = setup('image', grade, { generate });
    dbRef.current = setupResult.db;

    const result = await setupResult.service.produce({
      workflowRunId: 'run-media',
      canvasId: 'canvas-1',
      taskRunId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: setupResult.current.rowVersion ?? -1,
    });

    expect(result).toMatchObject({ status: 'accepted', evaluation: { verdict: 'pass' } });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(grade).toHaveBeenCalledTimes(1);
    expect(setupResult.canvas.nodes[0].data).toMatchObject({
      status: 'done',
      assetHash: 'image-asset-1',
      variants: ['image-asset-1'],
    });
    expect(setupResult.db.repos.assets.findByHash('image-asset-1' as never)).toMatchObject({
      generationMetadata: {
        visualStyle: {
          source: 'visual-constitution',
          policyHash: VISUAL_HASH,
          workflowRunId: 'run-media',
          revision: 1,
          contentHash: VISUAL_HASH,
        },
      },
    });
    expect(setupResult.repo.listMediaAttempts('run-media' as WorkflowRunId)).toHaveLength(1);
  });

  it('persists a Repair Delta and accepts a second immutable attempt', async () => {
    const grade = vi
      .fn()
      .mockResolvedValueOnce({ text: repairGrade(), providerId: 'vision-provider' })
      .mockResolvedValueOnce({ text: highGrade(), providerId: 'vision-provider' });
    const { service, current, adapter, repo } = setup('image', grade);

    const result = await service.produce({
      workflowRunId: 'run-media',
      canvasId: 'canvas-1',
      taskRunId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    });

    expect(result.status).toBe('accepted');
    expect(adapter.generate).toHaveBeenCalledTimes(2);
    const attempts = repo.listMediaAttempts('run-media' as WorkflowRunId);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ status: 'repair_required', assetHash: 'image-asset-1' });
    expect(attempts[1]).toMatchObject({
      status: 'accepted',
      repairDelta: { reason: 'Restore character identity', seedStrategy: 'increment' },
    });
    expect(attempts[1].prompt).toContain('REPAIR DELTA');
    expect(attempts[1].prompt.startsWith(attempts[0].prompt)).toBe(true);
  });

  it('applies Commander quality feedback to the exact latest provider prompt and re-grades it', async () => {
    const grade = vi.fn(async () => ({ text: highGrade(), providerId: 'vision-provider' }));
    const { service, current, adapter, repo, db } = setup('video', grade, {
      probeMedia: async () => ({
        durationSeconds: 6,
        width: 1920,
        height: 1080,
        fps: 24,
        videoCodec: 'h264',
        hasAudio: false,
      }),
      extractFrameAtTime: async (_videoPath, _timestamp, outputPath) => {
        fs.writeFileSync(outputPath, Buffer.from('frame'));
      },
    });
    const input = {
      workflowRunId: 'run-media',
      canvasId: 'canvas-1',
      taskRunId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    };
    const first = await service.produce(input);
    expect(first).toMatchObject({ status: 'accepted', attempt: { attempt: 1 } });
    const firstAttempt = first.attempt!;
    db.rawDb
      .prepare(
        "UPDATE workflow_stage_runs SET status = 'completed', progress = 100, completed_at = 140 WHERE id IN ('stage-production-plan', 'stage-style-exploration')",
      )
      .run();
    const beforeCompletion = repo.getRun('run-media' as WorkflowRunId)!;
    repo.completeExternalTask({
      workflowRunId: 'run-media',
      taskRunId: 'task-media-1',
      expectedRunRowVersion: beforeCompletion.rowVersion ?? -1,
      output: { attemptId: firstAttempt.id },
      completedAt: 2_000,
      event: {
        workflowRunId: 'run-media',
        eventId: 'completed-before-successful-feedback',
        actor: 'assistant',
        payload: {},
        timestamp: 2_000,
      },
    });
    const completedRun = repo.getRun('run-media' as WorkflowRunId)!;

    const refined = await service.refine({
      workflowRunId: input.workflowRunId,
      canvasId: input.canvasId,
      nodeId: input.nodeId,
      expectedRowVersion: completedRun.rowVersion ?? -1,
      targetAttemptId: firstAttempt.id,
      basePromptHash: firstAttempt.promptHash,
      feedback: 'Keep the framing and character; make the camera motion less shaky.',
    });

    expect(refined).toMatchObject({
      status: 'accepted',
      attempt: {
        attempt: 2,
        repairDelta: {
          source: 'user_feedback',
          parentAttemptId: firstAttempt.id,
          basePromptHash: firstAttempt.promptHash,
          userFeedback: 'Keep the framing and character; make the camera motion less shaky.',
          seedStrategy: 'keep',
        },
      },
      steps: [
        { id: 'load_existing_prompt', status: 'completed' },
        { id: 'apply_feedback_delta', status: 'completed' },
        { id: 'persist_generation_spec', status: 'completed' },
        { id: 'generate', status: 'completed' },
        { id: 'grade', status: 'completed' },
      ],
    });
    const attempts = repo.listMediaAttempts('run-media' as WorkflowRunId);
    expect(attempts).toHaveLength(2);
    expect(attempts[1].prompt.startsWith(firstAttempt.prompt)).toBe(true);
    expect(attempts[1].prompt).toContain(
      'USER QUALITY FEEDBACK (additive): Keep the framing and character; make the camera motion less shaky.',
    );
    expect(attempts[1].generationSpec.providerId).toBe(firstAttempt.generationSpec.providerId);
    expect(attempts[1].generationSpec.referenceAssetHashes).toEqual(
      firstAttempt.generationSpec.referenceAssetHashes,
    );
    expect(repo.listEvents('run-media' as WorkflowRunId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            type: 'workflow.media.feedback_requested',
            attemptId: firstAttempt.id,
            basePromptHash: firstAttempt.promptHash,
          }),
        }),
      ]),
    );
    expect(adapter.generate).toHaveBeenCalledTimes(2);
    expect(grade).toHaveBeenCalledTimes(2);
  });

  it('does not reopen or record orphan feedback when a completed-task refinement is budget blocked', async () => {
    const grade = vi.fn(async () => ({ text: highGrade(), providerId: 'vision-provider' }));
    const { service, current, adapter, repo, db } = setup('image', grade);
    const first = await service.produce({
      workflowRunId: 'run-media',
      canvasId: 'canvas-1',
      taskRunId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    });
    db.rawDb
      .prepare(
        "UPDATE workflow_stage_runs SET status = 'completed', progress = 100, completed_at = 140 WHERE id IN ('stage-production-plan', 'stage-style-exploration')",
      )
      .run();
    const beforeCompletion = repo.getRun('run-media' as WorkflowRunId)!;
    repo.completeExternalTask({
      workflowRunId: 'run-media',
      taskRunId: 'task-media-1',
      expectedRunRowVersion: beforeCompletion.rowVersion ?? -1,
      output: { attemptId: first.attempt!.id },
      completedAt: 2_000,
      event: {
        workflowRunId: 'run-media',
        eventId: 'completed-before-feedback',
        actor: 'assistant',
        payload: {},
        timestamp: 2_000,
      },
    });
    const completedRun = repo.getRun('run-media' as WorkflowRunId)!;
    const eventCount = repo.listEvents('run-media' as WorkflowRunId).length;
    vi.mocked(adapter.estimateCost).mockReturnValue({
      provider: 'image-provider',
      estimatedCost: 11,
      currency: 'USD',
      unit: 'generation',
    });

    const result = await service.refine({
      workflowRunId: 'run-media',
      canvasId: 'canvas-1',
      nodeId: 'shot-1',
      expectedRowVersion: completedRun.rowVersion ?? -1,
      targetAttemptId: first.attempt!.id,
      basePromptHash: first.attempt!.promptHash,
      feedback: 'Keep everything else; make the eyes brighter.',
    });

    expect(result).toMatchObject({
      status: 'budget_blocked',
      message: expect.stringMatching(/feedback was not applied/i),
      steps: [
        { id: 'load_existing_prompt', status: 'completed' },
        { id: 'apply_feedback_delta', status: 'failed' },
        { id: 'persist_generation_spec', status: 'failed' },
        { id: 'generate', status: 'pending' },
        { id: 'grade', status: 'pending' },
      ],
    });
    expect(repo.getTaskRun('task-media-1' as never)).toMatchObject({ status: 'completed' });
    expect(repo.listMediaAttempts('run-media' as WorkflowRunId)).toHaveLength(1);
    expect(repo.listEvents('run-media' as WorkflowRunId)).toHaveLength(eventCount);
    expect(adapter.generate).toHaveBeenCalledTimes(1);
  });

  it('rejects stale Commander prompt lineage before reserving or calling the provider', async () => {
    const grade = vi.fn(async () => ({ text: highGrade(), providerId: 'vision-provider' }));
    const { service, current, adapter, repo } = setup('image', grade);
    const first = await service.produce({
      workflowRunId: 'run-media',
      canvasId: 'canvas-1',
      taskRunId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    });

    await expect(
      service.refine({
        workflowRunId: 'run-media',
        canvasId: 'canvas-1',
        nodeId: 'shot-1',
        expectedRowVersion: current.rowVersion ?? -1,
        targetAttemptId: first.attempt!.id,
        basePromptHash: 'f'.repeat(64),
        feedback: 'Brighter eyes.',
      }),
    ).rejects.toThrow(/prompt hash changed/i);
    expect(adapter.generate).toHaveBeenCalledTimes(1);
    expect(repo.listMediaAttempts('run-media' as WorkflowRunId)).toHaveLength(1);
  });

  it('retries only evaluation after a vision failure', async () => {
    const grade = vi
      .fn()
      .mockRejectedValueOnce(new Error('vision unavailable'))
      .mockResolvedValueOnce({ text: highGrade(), providerId: 'vision-provider' });
    const { service, current, adapter, repo } = setup('image', grade);
    const input = {
      workflowRunId: 'run-media',
      canvasId: 'canvas-1',
      taskRunId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    };

    await expect(service.produce(input)).resolves.toMatchObject({
      status: 'evaluation_pending',
      nextAction: 'retry_evaluation',
      attempt: { status: 'asset_ready' },
    });
    await expect(service.produce(input)).resolves.toMatchObject({ status: 'accepted' });
    expect(adapter.generate).toHaveBeenCalledTimes(1);
    expect(grade).toHaveBeenCalledTimes(2);
    expect(repo.listMediaAttempts('run-media' as WorkflowRunId)).toHaveLength(1);
  });

  it('marks an uncertain provider outcome ambiguous and never retries it blindly', async () => {
    const generate = vi.fn(async () => {
      throw new Error('connection dropped after upload');
    });
    const grade = vi.fn();
    const { service, current, repo } = setup('image', grade, { generate });
    const input = {
      workflowRunId: 'run-media',
      canvasId: 'canvas-1',
      taskRunId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    };

    await expect(service.produce(input)).resolves.toMatchObject({
      status: 'ambiguous',
      nextAction: 'ask_user',
      attempt: { status: 'ambiguous' },
    });
    await expect(service.produce(input)).resolves.toMatchObject({ status: 'ambiguous' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(grade).not.toHaveBeenCalled();
    expect(repo.listMediaAttempts('run-media' as WorkflowRunId)).toHaveLength(1);
  });

  it('grades video from references, ffprobe metadata, and five ordered temporal anchors', async () => {
    const grade = vi.fn(async () => ({
      text: highGrade(),
      providerId: 'vision-provider',
      model: 'vision-video',
    }));
    const extract = vi.fn(async (_videoPath: string, _timestamp: number, outputPath: string) => {
      fs.writeFileSync(outputPath, Buffer.from('frame'));
    });
    const { service, current } = setup('video', grade, {
      probeMedia: async () => ({
        durationSeconds: 6,
        width: 1920,
        height: 1080,
        fps: 24,
        videoCodec: 'h264',
        hasAudio: true,
      }),
      extractFrameAtTime: extract,
    });

    await expect(
      service.produce({
        workflowRunId: 'run-media',
        canvasId: 'canvas-1',
        taskRunId: 'task-media-1',
        nodeId: 'shot-1',
        expectedRowVersion: current.rowVersion ?? -1,
      }),
    ).resolves.toMatchObject({
      status: 'accepted',
      evaluation: { mediaType: 'video', frameEvidence: expect.any(Array) },
    });
    expect(extract.mock.calls.map((call) => call[1])).toEqual([0.1, 1.5, 3, 4.5, 5.9]);
    expect(grade).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: 'video',
        assetHashes: [
          'image-asset-2',
          'image-asset-3',
          'image-asset-4',
          'image-asset-5',
          'image-asset-6',
        ],
        frameEvidence: [
          { timestampSeconds: 0.1, assetHash: 'image-asset-2' },
          { timestampSeconds: 1.5, assetHash: 'image-asset-3' },
          { timestampSeconds: 3, assetHash: 'image-asset-4' },
          { timestampSeconds: 4.5, assetHash: 'image-asset-5' },
          { timestampSeconds: 5.9, assetHash: 'image-asset-6' },
        ],
      }),
      {},
    );
  });

  it('attaches ordered, role-labelled references to the vision grading request', async () => {
    const grade = vi.fn(async () => ({ text: highGrade(), providerId: 'vision-provider' }));
    const { service, current, adapter, canvas, db, cas, repo } = setup('image', grade);
    const referencePath = path.join(roots[0], 'character-reference.png');
    fs.writeFileSync(referencePath, Buffer.from('reference-image'));
    const imported = await cas.importAsset(referencePath, 'image');
    db.repos.assets.insert({ ...imported.meta, provider: 'user-reference' });
    db.repos.entities.upsertCharacter({
      id: 'character-1',
      name: 'Mara',
      role: 'protagonist',
      description: 'Radio operator',
      appearance: 'narrow face and red scarf',
      personality: 'watchful',
      costumes: [],
      tags: [],
      referenceImages: [{ slot: 'front', assetHash: imported.ref.hash, isStandard: true }],
      loadouts: [],
      defaultLoadoutId: '',
    } as never);
    Object.assign(canvas.nodes[0].data, {
      characterRefs: [{ characterId: 'character-1', loadoutId: '' }],
    });
    adapter.capabilities.push('image-to-image');
    Object.assign(adapter, {
      conditioningCapabilities: {
        referenceImages: { maxImages: 4, preservesOrder: true },
      },
    });

    await expect(
      service.produce({
        workflowRunId: 'run-media',
        canvasId: 'canvas-1',
        taskRunId: 'task-media-1',
        nodeId: 'shot-1',
        expectedRowVersion: current.rowVersion ?? -1,
      }),
    ).resolves.toMatchObject({ status: 'accepted' });

    const attempt = repo.listMediaAttempts('run-media' as WorkflowRunId)[0];
    expect(attempt.generationSpec.referenceEvidence).toEqual([
      {
        order: 0,
        assetHash: imported.ref.hash,
        roles: [{ role: 'character', entityId: 'character-1' }],
      },
    ]);
    expect(grade).toHaveBeenCalledWith(
      expect.objectContaining({
        assetHashes: [imported.ref.hash, 'image-asset-2'],
        metadata: expect.objectContaining({
          visionImageOrder: [
            {
              index: 0,
              kind: 'reference',
              assetHash: imported.ref.hash,
              roles: [{ role: 'character', entityId: 'character-1' }],
            },
            { index: 1, kind: 'generated_output', assetHash: 'image-asset-2' },
          ],
        }),
      }),
      {},
    );
  });

  it('adds the strongest bounded scene cuts to temporal grading evidence', async () => {
    const grade = vi.fn(async () => ({ text: highGrade(), providerId: 'vision-provider' }));
    const extract = vi.fn(async (_videoPath: string, _timestamp: number, outputPath: string) => {
      fs.writeFileSync(outputPath, Buffer.from('frame'));
    });
    const { service, current } = setup('video', grade, {
      probeMedia: async () => ({
        durationSeconds: 8,
        width: 1920,
        height: 1080,
        fps: 24,
        videoCodec: 'h264',
        hasAudio: false,
      }),
      detectScenes: async () => [
        { time: 1.1, score: 0.92 },
        { time: 6.6, score: 0.81 },
        { time: 3.2, score: 0.75 },
        { time: 4.2, score: 0.2 },
      ],
      extractFrameAtTime: extract,
    });

    await service.produce({
      workflowRunId: 'run-media',
      canvasId: 'canvas-1',
      taskRunId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    });

    expect(extract.mock.calls.map((call) => call[1])).toEqual([0.1, 1.1, 2, 3.2, 4, 6, 6.6, 7.9]);
    expect(grade).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          sampledTimestampsSeconds: [0.1, 1.1, 2, 3.2, 4, 6, 6.6, 7.9],
        }),
      }),
      {},
    );
  });

  it('blocks projected cost before reservation or provider work', async () => {
    const grade = vi.fn();
    const { service, current, adapter, db } = setup('image', grade, { estimatedCost: 11 });

    await expect(
      service.produce({
        workflowRunId: 'run-media',
        canvasId: 'canvas-1',
        taskRunId: 'task-media-1',
        nodeId: 'shot-1',
        expectedRowVersion: current.rowVersion ?? -1,
      }),
    ).resolves.toMatchObject({ status: 'budget_blocked', nextAction: 'ask_user' });
    expect(adapter.generate).not.toHaveBeenCalled();
    expect(db.rawDb.prepare('SELECT COUNT(*) AS count FROM workflow_media_attempts').get()).toEqual(
      { count: 0 },
    );
  });

  it('preserves and routes an artifact to human review when reported cost exceeds the bound', async () => {
    const generate = vi.fn(async () => ({
      assetHash: '',
      assetPath: path.join(roots[0], 'generated.png'),
      provider: 'image-provider',
      cost: 11,
      metadata: { model: 'image-model' },
    }));
    const grade = vi.fn(async () => ({ text: highGrade(), providerId: 'vision-provider' }));
    const { service, current, canvas, repo } = setup('image', grade, { generate });

    await expect(
      service.produce({
        workflowRunId: 'run-media',
        canvasId: 'canvas-1',
        taskRunId: 'task-media-1',
        nodeId: 'shot-1',
        expectedRowVersion: current.rowVersion ?? -1,
      }),
    ).resolves.toMatchObject({
      status: 'human_review',
      nextAction: 'ask_user',
      evaluation: {
        verdict: 'human_review',
        risks: expect.arrayContaining([expect.stringMatching(/cost exceeded/i)]),
      },
    });
    expect((canvas.nodes[0].data as { assetHash?: string }).assetHash).toBeUndefined();
    expect(repo.getMediaCostSummary('run-media' as WorkflowRunId).committedCostUsd).toBe(11);
  });
});
