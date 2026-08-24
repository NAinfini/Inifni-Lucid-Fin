import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductionMediaTaskAttempt } from '@lucid-fin/contracts';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import type { VisualAnalyzer } from './visual-analyzer.service.js';
import {
  MEDIA_EVALUATION_PROFILE_BY_SCOPE,
  MediaEvaluationService,
  type MediaEvaluationGradeRequest,
} from './media-evaluation.service.js';

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
    strengths: ['The approved subject is visible.'],
    risks: [],
    evidence: ['The supplied output visibly follows the approved direction.'],
  });
}

function makeAttempt(
  scope: ProductionMediaTaskAttempt['scope'] = 'production',
  mediaType: ProductionMediaTaskAttempt['mediaType'] = 'image',
  referenceEvidence: unknown[] = [],
): ProductionMediaTaskAttempt {
  return {
    kind: 'production_media',
    id: 'attempt-1',
    taskListId: 'task-list-1',
    taskId: 'task-1',
    canvasId: 'canvas-1',
    nodeId: 'node-1',
    attempt: 1,
    idempotencyKey: 'idempotency-1',
    specHash: 'spec-hash-1',
    scope,
    mediaType,
    status: 'asset_ready',
    rowVersion: 4,
    providerId: 'media-provider',
    promptAssemblyId: 'assembly-1',
    submissionPurpose: 'initial',
    model: 'media-model',
    prompt: 'Approved provider prompt',
    promptHash: 'a'.repeat(64),
    estimatedCostUsd: 0.25,
    assetHash: 'output-asset',
    createdAt: 1,
    updatedAt: 1,
    generationSpec: {
      scope,
      referenceEvidence,
    } as ProductionMediaTaskAttempt['generationSpec'],
  };
}

function setup(options: {
  attempt?: ProductionMediaTaskAttempt;
  artifactHash?: string | undefined;
  grade?: (request: MediaEvaluationGradeRequest) => Promise<{ text: string; providerId: string }>;
  findAsset?: (hash: string) => { type: 'image' | 'video'; format: string } | undefined;
  getAssetPath?: (hash: string) => string;
  importAsset?: CAS['importAsset'];
  probeMedia?: () => Promise<{
    durationSeconds: number;
    width: number;
    height: number;
    fps: number;
    videoCodec: string;
    hasAudio: boolean;
  }>;
  detectScenes?: () => Promise<Array<{ time: number; score: number }>>;
  extractFrameAtTime?: (videoPath: string, timestampSeconds: number, outputPath: string) => Promise<void>;
} = {}) {
  let currentAttempt = options.attempt ?? makeAttempt();
  let now = 100;
  const transitions = vi.fn((input: Record<string, unknown>) => {
    currentAttempt = {
      ...currentAttempt,
      status: input.status as ProductionMediaTaskAttempt['status'],
      rowVersion: currentAttempt.rowVersion + 1,
      ...(input.error === undefined ? {} : { error: input.error as string }),
    };
    return currentAttempt;
  });
  const recordTaskEvaluation = vi.fn((input: Record<string, unknown>) => {
    const evaluation = input.evaluation as Record<string, unknown>;
    currentAttempt = {
      ...currentAttempt,
      status: input.resultingAttemptStatus as ProductionMediaTaskAttempt['status'],
      rowVersion: currentAttempt.rowVersion + 1,
    };
    return { evaluation, attempt: currentAttempt, created: true };
  });
  const grade = vi.fn(
    options.grade ?? (async () => ({ text: highGrade(), providerId: 'vision-provider' })),
  );
  const assets = {
    findByHash: vi.fn(options.findAsset ?? (() => undefined)),
    insert: vi.fn(),
  };
  const db = {
    repos: {
      assets,
      taskLists: {
        getArtifactByAttempt: vi.fn(() =>
          options.artifactHash === undefined
            ? { id: 'media-output-1', assetHash: currentAttempt.assetHash }
            : { id: 'media-output-1', assetHash: options.artifactHash },
        ),
        transitionProductionMediaAttempt: transitions,
        recordTaskEvaluation,
      },
    },
  } as unknown as SqliteIndex;
  const cas = {
    getAssetPath: vi.fn(options.getAssetPath ?? (() => '')),
    importAsset:
      options.importAsset ??
      vi.fn(async () => {
        throw new Error('Video evidence import was not configured for this test');
      }),
  } as unknown as CAS;
  const service = new MediaEvaluationService({
    db,
    cas,
    visualAnalyzer: {
      analyzeImageAsset: vi.fn(),
      analyzeImageAssets: vi.fn(),
    } as unknown as VisualAnalyzer,
    gradeAssets: grade,
    probeMedia:
      options.probeMedia ??
      (async () => ({
        durationSeconds: 6,
        width: 1920,
        height: 1080,
        fps: 24,
        videoCodec: 'h264',
        hasAudio: false,
      })),
    detectScenes: options.detectScenes ?? (async () => []),
    extractFrameAtTime: options.extractFrameAtTime,
    now: () => ++now,
    idFactory: () => 'evaluation-1',
  });
  return { service, attempt: currentAttempt, grade, assets, transitions, recordTaskEvaluation };
}

describe('MediaEvaluationService', () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('maps every scope to its durable profile and records the exact attempt prompt hash', async () => {
    expect(MEDIA_EVALUATION_PROFILE_BY_SCOPE).toEqual({
      canvas: 'canvas_media.v1',
      style_audition: 'style_audition.v1',
      production: 'production_media.v1',
    });
    const { service, attempt, recordTaskEvaluation } = setup({ attempt: makeAttempt('style_audition') });
    const validateAuthority = vi.fn(() => true);
    const validateNodeRevision = vi.fn(() => true);

    const result = await service.evaluate({
      attempt,
      productionPlan: { title: 'Signal' },
      visualConstitution: { locked: true },
      rubricVersion: 'shared-rubric-v1',
      validateAuthority,
      validateNodeRevision,
    });

    expect(result).toMatchObject({
      status: 'recorded',
      evaluation: {
        profile: 'style_audition.v1',
        sourcePromptHash: attempt.promptHash,
        artifactId: 'media-output-1',
      },
    });
    expect(validateAuthority).toHaveBeenCalledWith(attempt);
    expect(validateNodeRevision).toHaveBeenCalledWith(attempt);
    expect(recordTaskEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluation: expect.objectContaining({
          profile: 'style_audition.v1',
          sourcePromptHash: attempt.promptHash,
        }),
      }),
    );
  });

  it('fails closed when the output artifact is not exactly bound to the generated asset', async () => {
    const { service, attempt, grade, transitions, recordTaskEvaluation } = setup({
      artifactHash: 'different-asset',
    });

    await expect(
      service.evaluate({
        attempt,
        productionPlan: {},
        visualConstitution: {},
        rubricVersion: 'shared-rubric-v1',
      }),
    ).resolves.toMatchObject({
      status: 'human_review',
      message: expect.stringMatching(/not bound to this attempt/i),
    });
    expect(grade).not.toHaveBeenCalled();
    expect(recordTaskEvaluation).not.toHaveBeenCalled();
    expect(transitions).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatuses: ['asset_ready'],
        status: 'human_review',
      }),
    );
  });

  it('fails closed when a node revision validator rejects the attempt', async () => {
    const { service, attempt, grade, transitions } = setup();

    await expect(
      service.evaluate({
        attempt,
        productionPlan: {},
        visualConstitution: {},
        rubricVersion: 'shared-rubric-v1',
        validateNodeRevision: () => false,
      }),
    ).resolves.toMatchObject({
      status: 'human_review',
      message: expect.stringMatching(/node changed after reservation/i),
    });
    expect(grade).not.toHaveBeenCalled();
    expect(transitions).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'human_review' }),
    );
  });

  it('returns an evaluating attempt to asset_ready when evidence collection or grading fails', async () => {
    const { service, attempt, transitions, recordTaskEvaluation } = setup({
      grade: async () => {
        throw new Error('vision unavailable');
      },
    });

    await expect(
      service.evaluate({
        attempt,
        productionPlan: {},
        visualConstitution: {},
        rubricVersion: 'shared-rubric-v1',
      }),
    ).resolves.toMatchObject({
      status: 'evaluation_pending',
      attempt: { status: 'asset_ready' },
      message: 'Evaluation pending: vision unavailable',
    });
    expect(recordTaskEvaluation).not.toHaveBeenCalled();
    expect(transitions.mock.calls.map(([input]) => input.status)).toEqual([
      'evaluating',
      'asset_ready',
    ]);
    expect(transitions.mock.calls[1]?.[0]).toMatchObject({ expectedStatuses: ['evaluating'] });
  });

  it('collects bounded video evidence from temporal anchors and selected scene cuts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-media-evaluation-'));
    roots.push(root);
    const videoPath = path.join(root, 'output.mp4');
    fs.writeFileSync(videoPath, Buffer.from('video'));
    let frame = 0;
    const request: { current?: MediaEvaluationGradeRequest } = {};
    const { service, attempt, assets } = setup({
      attempt: makeAttempt('production', 'video'),
      findAsset: (hash) => (hash === 'output-asset' ? { type: 'video', format: 'mp4' } : undefined),
      getAssetPath: () => videoPath,
      importAsset: vi.fn(async (filePath: string) => ({
        ref: { hash: `frame-${++frame}`, type: 'image', format: 'png', path: filePath },
        meta: {
          hash: `frame-${frame}`,
          type: 'image',
          format: 'png',
          originalName: path.basename(filePath),
          fileSize: fs.statSync(filePath).size,
          tags: [],
          createdAt: 1,
        },
      })) as unknown as CAS['importAsset'],
      detectScenes: async () => [
        { time: 1.1, score: 0.92 },
        { time: 6.6, score: 0.81 },
        { time: 3.2, score: 0.75 },
      ],
      extractFrameAtTime: async (_videoPath, _timestamp, outputPath) => {
        fs.writeFileSync(outputPath, Buffer.from('frame'));
      },
      grade: async (gradeRequest) => {
        request.current = gradeRequest;
        return { text: highGrade(), providerId: 'vision-provider' };
      },
      probeMedia: async () => ({
        durationSeconds: 8,
        width: 1920,
        height: 1080,
        fps: 24,
        videoCodec: 'h264',
        hasAudio: false,
      }),
    });

    await expect(
      service.evaluate({
        attempt,
        productionPlan: {},
        visualConstitution: {},
        rubricVersion: 'shared-rubric-v1',
      }),
    ).resolves.toMatchObject({
      status: 'recorded',
      evaluation: {
        frameEvidence: [
          { timestampSeconds: 0.1, assetHash: 'frame-1' },
          { timestampSeconds: 1.1, assetHash: 'frame-2' },
          { timestampSeconds: 2, assetHash: 'frame-3' },
          { timestampSeconds: 3.2, assetHash: 'frame-4' },
          { timestampSeconds: 4, assetHash: 'frame-5' },
          { timestampSeconds: 6, assetHash: 'frame-6' },
          { timestampSeconds: 6.6, assetHash: 'frame-7' },
          { timestampSeconds: 7.9, assetHash: 'frame-8' },
        ],
      },
    });
    expect(request.current).toMatchObject({
      assetHashes: ['frame-1', 'frame-2', 'frame-3', 'frame-4', 'frame-5', 'frame-6', 'frame-7', 'frame-8'],
      metadata: { sampledTimestampsSeconds: [0.1, 1.1, 2, 3.2, 4, 6, 6.6, 7.9] },
    });
    expect(assets.insert).toHaveBeenCalledTimes(8);
  });
});
