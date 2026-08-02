import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type { WorkflowEngine } from '@lucid-fin/application';
import type {
  AIProviderAdapter,
  Canvas,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  WorkflowApproval,
  WorkflowDocument,
  WorkflowRun,
  WorkflowRunId,
} from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import type { CAS, Keychain } from '@lucid-fin/storage';
import type { CanvasStore } from '../ipc/handlers/canvas.handlers.js';
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
    currentStageId: 'production-plan',
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
    gradeAssets: (request: ProductionMediaGradeRequest) => Promise<{
      text: string;
      providerId: string;
      model?: string;
    }>,
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
      extractFrameAtTime?: (
        videoPath: string,
        timestampSeconds: number,
        outputPath: string,
      ) => Promise<void>;
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
      nextStageId: 'style-exploration',
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
      nextStageId: 'media-generation',
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
        productionPlan,
        visualConstitution,
      })),
      getLatestVisualAudition: vi.fn(() => undefined),
    } as unknown as WorkflowEngine;
    const service = createProductionMediaService({
      db,
      cas: cas as unknown as CAS,
      keychain: { getKey: vi.fn(async () => 'test-key') } as unknown as Keychain,
      adapterRegistry,
      canvasStore,
      workflowEngine,
      gradeAssets,
      probeMedia: options.probeMedia,
      extractFrameAtTime: options.extractFrameAtTime,
      now: () => ++now,
      idFactory: () => `media-service-id-${++id}`,
    });
    return { db, repo, current, canvas, canvasStore, adapter, service };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const db of indexes.splice(0)) db.close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('persists the reservation before calling the provider and selects only a passing image', async () => {
    const dbRef: { current?: SqliteIndex } = {};
    const generate = vi.fn(async () => {
      const activeDb = dbRef.current;
      if (!activeDb) throw new Error('Test database was not initialized before generation');
      const row = activeDb.rawDb
        .prepare('SELECT status FROM workflow_media_attempts LIMIT 1')
        .get() as { status: string };
      expect(row.status).toBe('submitted');
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

  it('grades video from ffprobe metadata and ordered beginning/middle/end frames', async () => {
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
        nodeId: 'shot-1',
        expectedRowVersion: current.rowVersion ?? -1,
      }),
    ).resolves.toMatchObject({
      status: 'accepted',
      evaluation: { mediaType: 'video', frameEvidence: expect.any(Array) },
    });
    expect(extract.mock.calls.map((call) => call[1])).toEqual([0.1, 3, 5.9]);
    expect(grade).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: 'video',
        assetHashes: ['image-asset-2', 'image-asset-3', 'image-asset-4'],
        frameEvidence: [
          { timestampSeconds: 0.1, assetHash: 'image-asset-2' },
          { timestampSeconds: 3, assetHash: 'image-asset-3' },
          { timestampSeconds: 5.9, assetHash: 'image-asset-4' },
        ],
      }),
    );
  });

  it('blocks projected cost before reservation or provider work', async () => {
    const grade = vi.fn();
    const { service, current, adapter, db } = setup('image', grade, { estimatedCost: 11 });

    await expect(
      service.produce({
        workflowRunId: 'run-media',
        canvasId: 'canvas-1',
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
