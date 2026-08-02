import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  VisualAuditionDocumentContent,
  VisualDirectionCandidateProposal,
  VisualPreviewGrade,
} from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import {
  VISUAL_PREVIEW_RUBRIC_VERSION,
  WorkflowEngine,
  WorkflowRegistry,
} from '@lucid-fin/application';
import { CommanderImageGenerationError } from './commander-image-gen.js';
import { createStyleAuditionService } from './style-audition.service.js';

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
    const workflowEngine = new WorkflowEngine({
      db,
      registry: new WorkflowRegistry(),
      handlers: [],
      idFactory: () => `style-service-id-${++id}`,
      now: () => 1_000,
    });
    const created = workflowEngine.createProductionPlan({
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
    });
    const pending = workflowEngine.getPendingApprovalContext(created.workflowRunId);
    if (!pending) throw new Error('Expected production approval');
    const approved = workflowEngine.approvePendingGateFromUser({
      workflowRunId: created.workflowRunId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.run.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
    });
    if (!approved.ok) throw new Error(`Approval failed: ${approved.code}`);
    return { db, workflowEngine, workflowRunId: created.workflowRunId };
  }

  const request = (workflowRunId: string) => ({
    canvasId: 'canvas-1',
    workflowRunId,
    providerId: 'image-test',
    width: 1024,
    height: 576,
    candidates: candidates(),
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const db of indexes.splice(0)) db.close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('persists every graded real asset and refuses duplicate completed work', async () => {
    const { db, workflowEngine, workflowRunId } = setup();
    let generatedCount = 0;
    const generateImage = vi.fn(async (_prompt: string, options?: { seed?: number }) => {
      generatedCount += 1;
      const assetHash = `asset-${generatedCount}`;
      db.repos.assets.insert({ hash: assetHash, type: 'image', format: 'png' });
      return {
        assetHash,
        providerId: 'image-test',
        model: 'image-model-test',
        requestedSeed: options?.seed,
        reportedSeed: options?.seed,
        width: 1024,
        height: 576,
        estimatedCostUsd: 0.3,
        reportedActualCostUsd: 0.25,
      };
    });
    const gradeImage = vi.fn(async () => grade());
    const run = createStyleAuditionService({ workflowEngine, generateImage, gradeImage });

    await expect(run(request(workflowRunId))).resolves.toMatchObject({
      workflowRunId,
      status: 'complete',
      recommendedCandidateId: 'analog-horror',
      candidates: [
        { assetHash: 'asset-1', providerId: 'image-test', score: 85, seed: 101 },
        { assetHash: 'asset-2', providerId: 'image-test', score: 85, seed: 202 },
      ],
    });
    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(gradeImage).toHaveBeenCalledTimes(2);
    await expect(run(request(workflowRunId))).rejects.toThrow(/already complete/);
    expect(generateImage).toHaveBeenCalledTimes(2);
  });

  it('persists a fail-closed submission reservation before calling the provider', async () => {
    const { db, workflowEngine, workflowRunId } = setup();
    const generateImage = vi.fn(async (_prompt: string, options?: { seed?: number }) => {
      const reserved = workflowEngine.getLatestVisualAudition(workflowRunId)?.content as
        VisualAuditionDocumentContent | undefined;
      expect(reserved).toMatchObject({ status: 'ambiguous' });
      const candidateId = options?.seed === 101 ? 'analog-horror' : 'quiet-realism';
      expect(reserved?.candidates.find((candidate) => candidate.id === candidateId)).toMatchObject({
        status: 'ambiguous',
        attempts: [
          {
            attempt: 1,
            status: 'ambiguous',
            error: expect.stringMatching(/submission reserved/),
          },
        ],
      });
      const assetHash = `asset-${options?.seed}`;
      db.repos.assets.insert({ hash: assetHash, type: 'image', format: 'png' });
      return {
        assetHash,
        providerId: 'image-test',
        requestedSeed: options?.seed,
        width: 1024,
        height: 576,
        estimatedCostUsd: 0.2,
      };
    });
    const run = createStyleAuditionService({
      workflowEngine,
      generateImage,
      gradeImage: vi.fn(async () => grade()),
    });

    await expect(run(request(workflowRunId))).resolves.toMatchObject({ status: 'complete' });
    expect(generateImage).toHaveBeenCalledTimes(2);
  });

  it('persists an actual-cost overrun and blocks all further provider work', async () => {
    const { db, workflowEngine, workflowRunId } = setup();
    const generateImage = vi.fn(async (_prompt: string, options?: { seed?: number }) => {
      const assetHash = 'asset-over-budget';
      db.repos.assets.insert({ hash: assetHash, type: 'image', format: 'png' });
      return {
        assetHash,
        providerId: 'image-test',
        requestedSeed: options?.seed,
        width: 1024,
        height: 576,
        estimatedCostUsd: 0.3,
        reportedActualCostUsd: 2.5,
      };
    });
    const gradeImage = vi.fn(async () => grade());
    const run = createStyleAuditionService({ workflowEngine, generateImage, gradeImage });

    await expect(run(request(workflowRunId))).rejects.toThrow(/exceeds the approved budget/);
    expect(workflowEngine.getLatestVisualAudition(workflowRunId)?.content).toMatchObject({
      status: 'failed',
      budget: { reportedActualUsd: 2.5 },
      failure: { candidateId: 'analog-horror', ambiguous: false },
    });
    expect(gradeImage).not.toHaveBeenCalled();
    await expect(run(request(workflowRunId))).rejects.toThrow(/no further provider work/);
    expect(generateImage).toHaveBeenCalledTimes(1);
  });

  it('records an ambiguous submission and never resends it without an asset', async () => {
    const { workflowEngine, workflowRunId } = setup();
    const generateImage = vi.fn(async () => {
      throw new CommanderImageGenerationError('provider timed out after submission', {
        providerId: 'image-test',
        width: 1024,
        height: 576,
        estimatedCostUsd: 0.3,
        requestedSeed: 101,
      });
    });
    const run = createStyleAuditionService({
      workflowEngine,
      generateImage,
      gradeImage: vi.fn(async () => grade()),
    });

    await expect(run(request(workflowRunId))).rejects.toThrow(/timed out/);
    const content = workflowEngine.getLatestVisualAudition(workflowRunId)?.content;
    expect(content).toMatchObject({ status: 'ambiguous' });
    expect(content?.candidates.find((candidate) => candidate.id === 'analog-horror')).toMatchObject(
      {
        status: 'ambiguous',
        attempts: [{ status: 'ambiguous', estimatedCostUsd: 0.3 }],
      },
    );
    await expect(run(request(workflowRunId))).rejects.toThrow(/cannot be retried safely/);
    expect(generateImage).toHaveBeenCalledTimes(1);
  });

  it('retries only vision grading when the generated asset is already durable', async () => {
    const { db, workflowEngine, workflowRunId } = setup();
    let generatedCount = 0;
    const generateImage = vi.fn(async (_prompt: string, options?: { seed?: number }) => {
      generatedCount += 1;
      const assetHash = `asset-${generatedCount}`;
      db.repos.assets.insert({ hash: assetHash, type: 'image', format: 'png' });
      return {
        assetHash,
        providerId: 'image-test',
        requestedSeed: options?.seed,
        width: 1024,
        height: 576,
        estimatedCostUsd: 0.2,
      };
    });
    const gradeImage = vi
      .fn()
      .mockRejectedValueOnce(new Error('vision unavailable'))
      .mockResolvedValue(grade());
    const run = createStyleAuditionService({ workflowEngine, generateImage, gradeImage });

    await expect(run(request(workflowRunId))).rejects.toThrow(/Vision grading failed/);
    await expect(run(request(workflowRunId))).resolves.toMatchObject({ status: 'complete' });
    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(gradeImage).toHaveBeenCalledTimes(3);
  });
});
