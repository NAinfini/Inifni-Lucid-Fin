import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type {
  ProductionMediaFeedbackReservationRequest,
  TaskExecutionEngine,
} from '@lucid-fin/application';
import type {
  AIProviderAdapter,
  Canvas,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  LLMAdapter,
  PromptAssemblyOutputV1,
  PromptAssemblyRecord,
  PlanApproval,
  PlanDocument,
  TaskList,
  TaskListId,
  Task,
} from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import type { CAS, Keychain } from '@lucid-fin/storage';
import type { CanvasStore } from '../ipc/handlers/canvas.handlers.js';
import type { VisualAnalyzer } from './visual-analyzer.service.js';
import {
  createProductionMediaService,
  type ProductionMediaGradeRequest,
} from './production-media.service.js';
import { createPromptAssemblyService } from './prompt-assembly.service.js';

const PLAN_HASH = 'a'.repeat(64);
const VISUAL_HASH = 'b'.repeat(64);

function plan(): PlanDocument {
  return {
    id: 'plan-doc',
    taskListId: 'task-list-media',
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

function visual(): PlanDocument {
  return {
    id: 'visual-doc',
    taskListId: 'task-list-media',
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

function taskList(mediaType: 'image' | 'video'): TaskList {
  return {
    id: 'task-list-media',
    taskListType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status: 'ready',
    summary: 'Ready for media generation',
    progress: 50,
    completedPhases: 0,
    totalPhases: 0,
    completedTasks: 0,
    totalTasks: 0,
    currentPhaseKey: 'media-generation',
    currentTaskId: 'task-media-1',
    input: { mediaType },
    output: {},
    metadata: {},
    createdAt: 90,
    updatedAt: 90,
    rowVersion: 0,
    engineVersion: 'persistent-hybrid-v2',
    definitionVersion: 1,
  };
}

function mediaTask(): Task {
  return {
    id: 'task-media-1',
    taskListId: 'task-list-media',
    phaseKey: 'media-generation',
    phaseName: 'Media generation',
    phaseOrder: 0,
    taskKey: 'media-shot-001',
    name: 'Generate shot 001',
    kind: 'adapter_generation',
    status: 'ready',
    dependencyIds: [],
    attempts: 0,
    maxRetries: 0,
    input: {
      executionMode: 'external',
      taskRole: 'production_media',
      shot: { id: '001', title: 'Operator hears the warning' },
    },
    output: {},
    progress: 0,
    updatedAt: 100,
  };
}

function approval(
  id: string,
  gateKey: PlanApproval['gateKey'],
  document: PlanDocument,
): PlanApproval {
  return {
    id,
    taskListId: 'task-list-media',
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
    const repo = db.repos.taskLists;
    const productionPlan = plan();
    const visualConstitution = visual();
    repo.insertTaskList(taskList(mediaType));
    const productionTask = mediaTask();
    repo.insertTask(productionTask);
    repo.createDocument(productionPlan);
    repo.createPendingApproval(approval('plan-approval', 'production_plan', productionPlan));
    db.rawDb
      .prepare(
        "UPDATE plan_approvals SET status = 'approved', decided_at = 130, updated_at = 130 WHERE id = 'plan-approval'",
      )
      .run();
    db.rawDb
      .prepare(
        "UPDATE task_lists SET current_gate = NULL, status = 'ready' WHERE id = 'task-list-media'",
      )
      .run();
    repo.createDocument(visualConstitution);
    repo.createPendingApproval(
      approval('visual-approval', 'visual_constitution', visualConstitution),
    );
    db.rawDb
      .prepare(
        "UPDATE plan_approvals SET status = 'approved', decided_at = 140, updated_at = 140 WHERE id = 'visual-approval'",
      )
      .run();
    db.rawDb
      .prepare(
        "UPDATE task_lists SET current_gate = NULL, status = 'ready' WHERE id = 'task-list-media'",
      )
      .run();
    const current = repo.getTaskList('task-list-media' as TaskListId)!;

    const canvas = makeCanvas(mediaType);
    const canvasStore: CanvasStore = {
      get: (id) => (id === canvas.id ? canvas : undefined),
      save: vi.fn(),
      archive: vi.fn(),
      restore: vi.fn(),
      deletePermanent: vi.fn(),
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
    const taskExecutionEngine = {
      get: vi.fn(() => repo.getTaskList('task-list-media' as TaskListId)),
      requireProductionMediaContext: vi.fn(() => ({
        taskList: repo.getTaskList('task-list-media' as TaskListId)!,
        task: productionTask,
        productionPlan,
        visualConstitution,
      })),
      requireProductionMediaFeedbackContext: vi.fn(() => ({
        taskList: repo.getTaskList('task-list-media' as TaskListId)!,
        task: repo.getTask(productionTask.id as never) ?? productionTask,
        productionPlan,
        visualConstitution,
      })),
      getTasks: vi.fn(() => [repo.getTask(productionTask.id as never) ?? productionTask]),
      reserveMediaFeedbackAttemptForRevision: vi.fn(
        (input: ProductionMediaFeedbackReservationRequest) => {
          const reopenedAt = ++now;
          const result = repo.reserveMediaFeedbackAttempt({
            taskListId: input.taskListId,
            canvasId: input.canvasId,
            taskId: input.taskId,
            attemptId: input.attemptId,
            basePromptHash: input.basePromptHash,
            expectedTaskListRowVersion: input.expectedRowVersion,
            feedback: input.feedback,
            attempt: input.attempt,
            reopenedAt,
            event: {
              taskListId: input.taskListId,
              eventId: `feedback-event-${reopenedAt}`,
              actor: 'user',
              payload: {},
              timestamp: reopenedAt,
            },
          });
          return { taskList: result.taskList, task: result.task, attempt: result.attempt };
        },
      ),
      getLatestVisualAudition: vi.fn(() => undefined),
    } as unknown as TaskExecutionEngine;
    const promptAssemblyService = createPromptAssemblyService({ db });
    const promptAssembler = {
      id: 'test-commander',
      name: 'Test Commander',
      capabilities: ['text-generation'],
    } as unknown as LLMAdapter;
    const rawService = createProductionMediaService({
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
      presetCatalog: {
        list: () => [],
      },
      taskExecutionEngine,
      promptAssemblyService,
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
    const assemblyOutputs: PromptAssemblyOutputV1[] = [];
    const assemble = (record: PromptAssemblyRecord): PromptAssemblyOutputV1 => {
      const parentPrompt = record.input.sources.find(
        (source) => source.kind === 'parent-prompt',
      )?.content;
      const feedback = record.input.sources.find(
        (source) => source.kind === 'user-feedback' || source.kind === 'repair-delta',
      )?.content;
      const output: PromptAssemblyOutputV1 = {
        version: 1,
        assemblyId: record.id,
        inputHash: record.inputHash,
        finalPrompt: [
          parentPrompt ?? 'Commander final provider prompt',
          feedback ? `Commander revision: ${feedback}` : 'Approved Task List sources reconciled',
        ].join('\n'),
        negativePrompt: 'Commander final negative prompt',
        sourceDecisions: record.input.sources.map((source) => ({
          sourceId: source.sourceId,
          sourceHash: source.sourceHash,
          disposition: 'applied',
        })),
        summary: 'Test Commander reconciled every persisted source.',
        warnings: [],
      };
      assemblyOutputs.push(output);
      return output;
    };
    const withAssembler = (options?: { preferredLLMAdapter?: LLMAdapter }) => ({
      ...options,
      preferredLLMAdapter: options?.preferredLLMAdapter ?? promptAssembler,
    });
    const service = {
      async produce(
        input: Parameters<typeof rawService.produce>[0],
        options?: Parameters<typeof rawService.produce>[1],
      ) {
        let result = await rawService.produce(input, withAssembler(options));
        while (result.status === 'awaiting_prompt_assembly') {
          const record = result.promptAssembly!;
          result = await rawService.produce(
            {
              ...input,
              promptAssemblyId: record.id,
              promptAssemblyOutput: assemble(record),
            },
            withAssembler(options),
          );
        }
        return result;
      },
      async refine(
        input: Parameters<typeof rawService.refine>[0],
        options?: Parameters<typeof rawService.refine>[1],
      ) {
        let result = await rawService.refine(input, withAssembler(options));
        while (result.status === 'awaiting_prompt_assembly') {
          const record = result.promptAssembly!;
          result = await rawService.refine(
            {
              ...input,
              promptAssemblyId: record.id,
              promptAssemblyOutput: assemble(record),
            },
            withAssembler(options),
          );
        }
        return result;
      },
      recoverInterruptedAttempts: () => rawService.recoverInterruptedAttempts(),
    };
    return {
      db,
      repo,
      current,
      task: productionTask,
      canvas,
      canvasStore,
      adapter,
      cas,
      service,
      rawService,
      promptAssembler,
      promptAssemblyService,
      assemblyOutputs,
      assemble,
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const db of indexes.splice(0)) db.close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('persists approved Task List sources before accepting the Commander final prompt', async () => {
    const grade = vi.fn(async () => ({ text: highGrade(), providerId: 'vision-provider' }));
    const { rawService, current, adapter, promptAssembler, assemble } = setup('image', grade);
    const input = {
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      taskId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    };

    const prepared = await rawService.produce(input, {
      preferredLLMAdapter: promptAssembler,
    });
    expect(prepared).toMatchObject({
      status: 'awaiting_prompt_assembly',
      nextAction: 'assemble_prompt',
      promptAssembly: {
        status: 'prepared',
        taskListId: 'task-list-media',
        taskId: 'task-media-1',
      },
    });
    expect(adapter.generate).not.toHaveBeenCalled();
    expect(prepared.promptAssembly!.input.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'production-plan', required: true }),
        expect.objectContaining({ kind: 'visual-constitution', required: true }),
      ]),
    );

    const output = assemble(prepared.promptAssembly!);
    const completed = await rawService.produce(
      {
        ...input,
        promptAssemblyId: prepared.promptAssembly!.id,
        promptAssemblyOutput: output,
      },
      { preferredLLMAdapter: promptAssembler },
    );
    expect(completed).toMatchObject({
      status: 'accepted',
      attempt: {
        promptAssemblyId: prepared.promptAssembly!.id,
        generationSpec: { promptAssemblyId: prepared.promptAssembly!.id },
      },
    });
    expect(adapter.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: output.finalPrompt,
        negativePrompt: output.negativePrompt,
      }),
    );
  });

  it('grades production media with the Commander-selected visual LLM', async () => {
    const activeLLM = {
      id: 'chatgpt-oauth',
      name: 'ChatGPT',
      capabilities: ['text-generation', 'image-understanding'],
    } as unknown as LLMAdapter;
    const visualAnalyzer = {
      analyzeImageAsset: vi.fn(),
      analyzeImageAssets: vi.fn(async () => ({
        text: highGrade(),
        providerId: activeLLM.id,
        model: 'gpt-5.6-sol',
      })),
    } as unknown as VisualAnalyzer;
    const setupResult = setup('image', undefined, { visualAnalyzer });

    await expect(
      setupResult.service.produce(
        {
          taskListId: 'task-list-media',
          canvasId: 'canvas-1',
          taskId: 'task-media-1',
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
      const row = activeDb.rawDb.prepare('SELECT status FROM task_attempts LIMIT 1').get() as {
        status: string;
      };
      expect(row.status).toBe('submitting');
      expect(request.prompt).toBe(
        'Commander final provider prompt\nApproved Task List sources reconciled',
      );
      expect(request.negativePrompt).toBe('Commander final negative prompt');
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
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      taskId: 'task-media-1',
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
        promptAssemblyId: expect.any(String),
        visualStyle: {
          source: 'visual-constitution',
          policyHash: VISUAL_HASH,
          taskListId: 'task-list-media',
          contentHash: VISUAL_HASH,
        },
      },
    });
    expect(
      setupResult.repo.listProductionMediaAttempts('task-list-media' as TaskListId),
    ).toHaveLength(1);
  });

  it('defers visual grading outside the active Commander tool loop without repeating generation', async () => {
    const grade = vi.fn(async () => ({
      text: highGrade(),
      providerId: 'vision-provider',
      model: 'vision-model',
    }));
    const { service, rawService, current, adapter, repo } = setup('image', grade);
    const input = {
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      taskId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    };

    await expect(service.produce(input, { deferEvaluation: true })).resolves.toMatchObject({
      status: 'evaluation_pending',
      attempt: { status: 'asset_ready' },
    });
    expect(adapter.generate).toHaveBeenCalledTimes(1);
    expect(grade).not.toHaveBeenCalled();

    await expect(
      rawService.evaluatePending('task-list-media', 'canvas-1'),
    ).resolves.toMatchObject({ status: 'accepted' });
    expect(adapter.generate).toHaveBeenCalledTimes(1);
    expect(grade).toHaveBeenCalledTimes(1);
    expect(repo.listProductionMediaAttempts('task-list-media' as TaskListId)).toHaveLength(1);
  });

  it('persists a Repair Delta and accepts a second immutable attempt', async () => {
    const grade = vi
      .fn()
      .mockResolvedValueOnce({ text: repairGrade(), providerId: 'vision-provider' })
      .mockResolvedValueOnce({ text: highGrade(), providerId: 'vision-provider' });
    const { service, current, adapter, repo, promptAssemblyService } = setup('image', grade);

    const result = await service.produce({
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      taskId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    });

    expect(result.status).toBe('accepted');
    expect(adapter.generate).toHaveBeenCalledTimes(2);
    const attempts = repo.listProductionMediaAttempts('task-list-media' as TaskListId);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ status: 'repair_required', assetHash: 'image-asset-1' });
    expect(attempts[1]).toMatchObject({
      status: 'accepted',
      repairDelta: { reason: 'Restore character identity', seedStrategy: 'increment' },
    });
    expect(attempts[1].prompt).toContain('Restore character identity');
    expect(attempts[1].prompt.startsWith(attempts[0].prompt)).toBe(true);
    const assemblies = promptAssemblyService.listByNode('canvas-1', 'shot-1');
    expect(assemblies).toHaveLength(2);
    expect(assemblies[0].input.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'parent-prompt', required: true }),
        expect.objectContaining({ kind: 'repair-delta', required: true }),
      ]),
    );
    expect(attempts[1]).toMatchObject({
      promptAssemblyId: assemblies[0].id,
      prompt: assemblies[0].output!.finalPrompt,
      negativePrompt: assemblies[0].output!.negativePrompt,
    });
  });

  it('applies Commander quality feedback to the exact latest provider prompt and re-grades it', async () => {
    const grade = vi.fn(async () => ({ text: highGrade(), providerId: 'vision-provider' }));
    const { service, current, adapter, repo, promptAssemblyService } = setup('video', grade, {
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
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      taskId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    };
    const first = await service.produce(input);
    expect(first).toMatchObject({ status: 'accepted', attempt: { attempt: 1 } });
    const firstAttempt = first.attempt!;
    const beforeCompletion = repo.getTaskList('task-list-media' as TaskListId)!;
    repo.completeExternalTask({
      taskListId: 'task-list-media',
      taskId: 'task-media-1',
      expectedTaskListRowVersion: beforeCompletion.rowVersion ?? -1,
      output: { attemptId: firstAttempt.id },
      completedAt: 2_000,
      event: {
        taskListId: 'task-list-media',
        eventId: 'completed-before-successful-feedback',
        actor: 'assistant',
        payload: {},
        timestamp: 2_000,
      },
    });
    const completedTaskList = repo.getTaskList('task-list-media' as TaskListId)!;

    const refined = await service.refine({
      taskListId: input.taskListId,
      canvasId: input.canvasId,
      nodeId: input.nodeId,
      expectedRowVersion: completedTaskList.rowVersion ?? -1,
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
    const attempts = repo.listProductionMediaAttempts('task-list-media' as TaskListId);
    expect(attempts).toHaveLength(2);
    expect(attempts[1].prompt.startsWith(firstAttempt.prompt)).toBe(true);
    expect(attempts[1].prompt).toContain(
      'Commander revision: Keep the framing and character; make the camera motion less shaky.',
    );
    expect(attempts[1].generationSpec.providerId).toBe(firstAttempt.generationSpec.providerId);
    expect(attempts[1].generationSpec.referenceAssetHashes).toEqual(
      firstAttempt.generationSpec.referenceAssetHashes,
    );
    const assemblies = promptAssemblyService.listByNode('canvas-1', 'shot-1');
    expect(assemblies[0].input.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'parent-prompt',
          required: true,
          content: firstAttempt.prompt,
        }),
        expect.objectContaining({
          kind: 'user-feedback',
          required: true,
          content: 'Keep the framing and character; make the camera motion less shaky.',
        }),
      ]),
    );
    expect(repo.listEvents('task-list-media' as TaskListId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            type: 'task_list.media.feedback_requested',
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
    const { service, current, adapter, repo } = setup('image', grade);
    const first = await service.produce({
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      taskId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    });
    const beforeCompletion = repo.getTaskList('task-list-media' as TaskListId)!;
    repo.completeExternalTask({
      taskListId: 'task-list-media',
      taskId: 'task-media-1',
      expectedTaskListRowVersion: beforeCompletion.rowVersion ?? -1,
      output: { attemptId: first.attempt!.id },
      completedAt: 2_000,
      event: {
        taskListId: 'task-list-media',
        eventId: 'completed-before-feedback',
        actor: 'assistant',
        payload: {},
        timestamp: 2_000,
      },
    });
    const completedTaskList = repo.getTaskList('task-list-media' as TaskListId)!;
    const eventCount = repo.listEvents('task-list-media' as TaskListId).length;
    vi.mocked(adapter.estimateCost).mockReturnValue({
      provider: 'image-provider',
      estimatedCost: 11,
      currency: 'USD',
      unit: 'generation',
    });

    const result = await service.refine({
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      nodeId: 'shot-1',
      expectedRowVersion: completedTaskList.rowVersion ?? -1,
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
    expect(repo.getTask('task-media-1' as never)).toMatchObject({ status: 'completed' });
    expect(repo.listProductionMediaAttempts('task-list-media' as TaskListId)).toHaveLength(1);
    expect(repo.listEvents('task-list-media' as TaskListId)).toHaveLength(eventCount);
    expect(adapter.generate).toHaveBeenCalledTimes(1);
  });

  it('rejects stale Commander prompt lineage before reserving or calling the provider', async () => {
    const grade = vi.fn(async () => ({ text: highGrade(), providerId: 'vision-provider' }));
    const { service, current, adapter, repo } = setup('image', grade);
    const first = await service.produce({
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      taskId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    });

    await expect(
      service.refine({
        taskListId: 'task-list-media',
        canvasId: 'canvas-1',
        nodeId: 'shot-1',
        expectedRowVersion: current.rowVersion ?? -1,
        targetAttemptId: first.attempt!.id,
        basePromptHash: 'f'.repeat(64),
        feedback: 'Brighter eyes.',
      }),
    ).rejects.toThrow(/prompt hash changed/i);
    expect(adapter.generate).toHaveBeenCalledTimes(1);
    expect(repo.listProductionMediaAttempts('task-list-media' as TaskListId)).toHaveLength(1);
  });

  it('rejects a refinement assembly when the user feedback changed after preparation', async () => {
    const grade = vi.fn(async () => ({ text: highGrade(), providerId: 'vision-provider' }));
    const { service, rawService, current, promptAssembler, assemble, repo } = setup('image', grade);
    const first = await service.produce({
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      taskId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    });
    const base = {
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
      targetAttemptId: first.attempt!.id,
      basePromptHash: first.attempt!.promptHash,
    };
    const prepared = await rawService.refine(
      { ...base, feedback: 'Make the eyes brighter.' },
      { preferredLLMAdapter: promptAssembler },
    );
    expect(prepared.status).toBe('awaiting_prompt_assembly');

    await expect(
      rawService.refine(
        {
          ...base,
          feedback: 'Replace the whole character.',
          promptAssemblyId: prepared.promptAssembly!.id,
          promptAssemblyOutput: assemble(prepared.promptAssembly!),
        },
        { preferredLLMAdapter: promptAssembler },
      ),
    ).rejects.toThrow(/different user feedback/i);
    expect(repo.listProductionMediaAttempts('task-list-media' as TaskListId)).toHaveLength(1);
  });

  it('retries only evaluation after a vision failure', async () => {
    const grade = vi
      .fn()
      .mockRejectedValueOnce(new Error('vision unavailable'))
      .mockResolvedValueOnce({ text: highGrade(), providerId: 'vision-provider' });
    const { service, current, adapter, repo } = setup('image', grade);
    const input = {
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      taskId: 'task-media-1',
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
    expect(repo.listProductionMediaAttempts('task-list-media' as TaskListId)).toHaveLength(1);
  });

  it('replays a reserved attempt from its exact stored spec without creating a new assembly', async () => {
    const grade = vi.fn(async () => ({ text: highGrade(), providerId: 'vision-provider' }));
    const { service, rawService, current, promptAssembler, promptAssemblyService, adapter, db } =
      setup('image', grade);
    const input = {
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      taskId: 'task-media-1',
      nodeId: 'shot-1',
      expectedRowVersion: current.rowVersion ?? -1,
    };
    const first = await service.produce(input);
    const storedPrompt = first.attempt!.prompt;
    const storedAssemblyId = first.attempt!.promptAssemblyId!;
    const assemblyCount = promptAssemblyService.listByNode('canvas-1', 'shot-1').length;
    db.rawDb.prepare('DELETE FROM task_evaluations WHERE attempt_id = ?').run(first.attempt!.id);
    db.rawDb.prepare('DELETE FROM task_artifacts WHERE attempt_id = ?').run(first.attempt!.id);
    db.rawDb
      .prepare(
        `UPDATE prompt_assemblies
         SET status = 'assembled', submitted_at = NULL, row_version = row_version + 1
         WHERE id = ?`,
      )
      .run(storedAssemblyId);
    db.rawDb
      .prepare(
        `UPDATE task_attempts
         SET status = 'reserved', row_version = row_version + 1,
             asset_hash = NULL, provider_job_id = NULL, provider_receipt = NULL,
             reported_actual_cost_usd = NULL, error_text = NULL,
             submitted_at = NULL, asset_ready_at = NULL, evaluated_at = NULL,
             completed_at = NULL
         WHERE id = ?`,
      )
      .run(first.attempt!.id);

    const recovered = await rawService.produce(input, {
      preferredLLMAdapter: promptAssembler,
    });
    expect(recovered).toMatchObject({
      status: 'accepted',
      attempt: { promptAssemblyId: storedAssemblyId, prompt: storedPrompt },
    });
    expect(promptAssemblyService.listByNode('canvas-1', 'shot-1')).toHaveLength(assemblyCount);
    expect(adapter.generate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(adapter.generate).mock.calls[1]![0]).toMatchObject({
      prompt: storedPrompt,
    });
  });

  it('marks an uncertain provider outcome ambiguous and never retries it blindly', async () => {
    const generate = vi.fn(async () => {
      throw new Error('connection dropped after upload');
    });
    const grade = vi.fn();
    const { service, current, repo } = setup('image', grade, { generate });
    const input = {
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      taskId: 'task-media-1',
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
    expect(repo.listProductionMediaAttempts('task-list-media' as TaskListId)).toHaveLength(1);
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
        taskListId: 'task-list-media',
        canvasId: 'canvas-1',
        taskId: 'task-media-1',
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
      expect.objectContaining({
        preferredLLMAdapter: expect.objectContaining({ id: 'test-commander' }),
      }),
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
        taskListId: 'task-list-media',
        canvasId: 'canvas-1',
        taskId: 'task-media-1',
        nodeId: 'shot-1',
        expectedRowVersion: current.rowVersion ?? -1,
      }),
    ).resolves.toMatchObject({ status: 'accepted' });

    const attempt = repo.listProductionMediaAttempts('task-list-media' as TaskListId)[0];
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
      expect.objectContaining({
        preferredLLMAdapter: expect.objectContaining({ id: 'test-commander' }),
      }),
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
      taskListId: 'task-list-media',
      canvasId: 'canvas-1',
      taskId: 'task-media-1',
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
      expect.objectContaining({
        preferredLLMAdapter: expect.objectContaining({ id: 'test-commander' }),
      }),
    );
  });

  it('blocks projected cost before reservation or provider work', async () => {
    const grade = vi.fn();
    const { service, current, adapter, db } = setup('image', grade, { estimatedCost: 11 });

    await expect(
      service.produce({
        taskListId: 'task-list-media',
        canvasId: 'canvas-1',
        taskId: 'task-media-1',
        nodeId: 'shot-1',
        expectedRowVersion: current.rowVersion ?? -1,
      }),
    ).resolves.toMatchObject({ status: 'budget_blocked', nextAction: 'ask_user' });
    expect(adapter.generate).not.toHaveBeenCalled();
    expect(db.rawDb.prepare('SELECT COUNT(*) AS count FROM task_attempts').get()).toEqual({
      count: 0,
    });
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
        taskListId: 'task-list-media',
        canvasId: 'canvas-1',
        taskId: 'task-media-1',
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
    expect(repo.getTaskCostSummary('task-list-media' as TaskListId).committedCostUsd).toBe(11);
  });
});
