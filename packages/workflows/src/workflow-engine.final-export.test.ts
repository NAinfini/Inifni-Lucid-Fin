import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  Canvas,
  ProductionMediaGenerationSpec,
  VisualAuditionDocumentContent,
  VisualDirectionCandidateProposal,
  VisualPreviewGrade,
} from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import { WorkflowEngine, VISUAL_PREVIEW_RUBRIC_VERSION } from './workflow-engine.js';
import { WorkflowRegistry } from './workflow-registry.js';

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function plan() {
  return {
    title: 'Signal',
    logline: 'Tomorrow calls tonight.',
    synopsis: 'A radio operator tries to prevent a disaster.',
    genre: 'science fiction',
    tone: 'tense',
    targetAudience: 'adult',
    format: { targetDurationSeconds: 12, aspectRatio: '16:9' },
    story: { acts: [{ name: 'Act 1', purpose: 'Discover', scenes: [{ title: 'Call' }] }] },
    assumptions: [],
    budget: {
      maxTotalCostUsd: 20,
      styleAuditionCostUsd: 2,
      maxAttemptsPerShot: 2,
      maxRegenerations: 4,
    },
    visualDirections: ['analog horror', 'restrained realism'],
  };
}

function constitution(style: string) {
  return {
    medium: 'cinematic digital image',
    era: 'late 1970s',
    rendering: style,
    linework: 'natural photographic edges',
    palette: 'oxidized amber, deep teal, charcoal',
    lighting: 'single tungsten practical with cold moon fill',
    texture: 'fine 35mm grain and worn painted metal',
    mood: 'isolated and foreboding',
    cameraGrammar: 'patient locked frames',
    lensGrammar: '32mm wides and 65mm closeups',
    compositionGrammar: 'negative space and foreground layers',
    motionGrammar: 'subtle human motion',
    characterAnchors: [],
    locationAnchors: ['remote radio room'],
    negativeConstraints: ['no neon cyberpunk'],
  };
}

function candidates(): VisualDirectionCandidateProposal[] {
  return [
    {
      id: 'analog-horror',
      name: 'Analog Dread',
      summary: 'Tactile cosmic dread.',
      prompt: 'A remote 1970s radio room at midnight.',
      seed: 101,
      constitution: constitution('restrained photochemical realism'),
    },
    {
      id: 'quiet-realism',
      name: 'Quiet Realism',
      summary: 'Naturalistic tension.',
      prompt: 'A remote radio room at midnight, naturalistic realism.',
      seed: 202,
      constitution: constitution('naturalistic realism'),
    },
  ];
}

function grade(): VisualPreviewGrade {
  return {
    rubricVersion: VISUAL_PREVIEW_RUBRIC_VERSION,
    promptAdherence: 88,
    styleClarity: 88,
    storyFit: 88,
    lighting: 88,
    composition: 88,
    continuityPotential: 88,
    total: 88,
    verdict: 'pass',
    strengths: ['Clear hierarchy'],
    risks: ['Identity is not yet locked'],
    evidence: 'The frame matches the requested radio room and low-key lighting.',
    visionProviderId: 'vision-test',
    visionModel: 'vision-model-test',
  };
}

describe('WorkflowEngine final export gate', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  function open(dbPath: string): SqliteIndex {
    const db = new SqliteIndex(dbPath);
    indexes.push(db);
    return db;
  }

  function engine(db: SqliteIndex): WorkflowEngine {
    let id = 0;
    return new WorkflowEngine({
      db,
      registry: new WorkflowRegistry(),
      handlers: [],
      idFactory: () => `final-id-${++id}`,
      now: () => 20_000,
    });
  }

  function canvas(videoHashes: string[]): Canvas {
    const now = 1_000;
    return {
      id: 'canvas-1',
      name: 'Signal',
      nodes: videoHashes.map((assetHash, index) => ({
        id: `shot-${index + 1}`,
        type: 'video' as const,
        position: { x: index * 300, y: 0 },
        title: `Shot ${index + 1}`,
        bypassed: false,
        locked: false,
        data: {
          status: 'done' as const,
          assetHash,
          variants: [assetHash],
          selectedVariantIndex: 0,
          duration: 6,
        },
        createdAt: now,
        updatedAt: now,
      })),
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  async function approvePlanAndVisual(target: WorkflowEngine, db: SqliteIndex): Promise<string> {
    const shotCount = Math.max(1, db.repos.canvases.get('canvas-1' as never)?.nodes.length ?? 1);
    const productionPlan = {
      ...plan(),
      story: {
        acts: [
          {
            name: 'Act 1',
            purpose: 'Discover',
            scenes: Array.from({ length: shotCount }, (_, index) => ({
              title: `Call ${index + 1}`,
              summary: `Planned shot ${index + 1}`,
            })),
          },
        ],
      },
    };
    const created = target.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A signal arrives from tomorrow.',
      plan: productionPlan,
    });
    const planPending = target.getPendingApprovalContext(created.workflowRunId)!;
    expect(
      target.approvePendingGateFromUser({
        workflowRunId: created.workflowRunId,
        gateKey: 'production_plan',
        expectedRowVersion: planPending.run.rowVersion ?? -1,
        expectedSubjectRevision: planPending.approval.subjectRevision,
        expectedSubjectHash: planPending.approval.subjectHash,
      }),
    ).toMatchObject({ ok: true });

    const started = target.beginVisualAudition({
      canvasId: 'canvas-1',
      workflowRunId: created.workflowRunId,
      providerId: 'image-test',
      width: 1024,
      height: 576,
      candidates: candidates(),
    });
    const previewHashes = [hash('preview-a'), hash('preview-b')];
    for (const assetHash of previewHashes) {
      db.repos.assets.insert({ hash: assetHash, type: 'image', format: 'png' });
    }
    const audition = structuredClone(started.document.content) as VisualAuditionDocumentContent;
    audition.status = 'complete';
    audition.recommendedCandidateId = 'analog-horror';
    audition.candidates = audition.candidates.map((candidate, index) => ({
      ...candidate,
      status: 'completed' as const,
      selectedAttempt: 1,
      attempts: [
        {
          attempt: 1,
          status: 'completed' as const,
          prompt: candidate.prompt,
          promptHash: hash(candidate.prompt),
          providerId: 'image-test',
          model: 'image-model-test',
          requestedSeed: candidate.seed,
          reportedSeed: candidate.seed,
          width: 1024,
          height: 576,
          estimatedCostUsd: 0.5,
          reportedActualCostUsd: 0.5,
          assetHash: previewHashes[index],
          grade: grade(),
          startedAt: 21_000 + index,
          completedAt: 22_000 + index,
        },
      ],
    }));
    audition.budget.estimatedCommittedUsd = 1;
    audition.budget.reportedActualUsd = 1;
    audition.budget.hasUnreportedActualCosts = false;
    const completed = target.saveVisualAuditionSnapshot({
      workflowRunId: created.workflowRunId,
      expectedRevision: started.document.revision,
      content: audition,
    });
    const selected = target.selectVisualConstitutionCandidateFromUser({
      workflowRunId: created.workflowRunId,
      candidateId: 'analog-horror',
      expectedRowVersion: target.get(created.workflowRunId)?.rowVersion ?? -1,
      expectedAuditionRevision: completed.revision,
      expectedAuditionHash: completed.contentHash,
    });
    expect(
      target.approvePendingGateFromUser({
        workflowRunId: created.workflowRunId,
        gateKey: 'visual_constitution',
        expectedRowVersion: selected.context.run.rowVersion ?? -1,
        expectedSubjectRevision: selected.context.approval.subjectRevision,
        expectedSubjectHash: selected.context.approval.subjectHash,
      }),
    ).toMatchObject({ ok: true });
    await target.waitForAutoPump();
    while (true) {
      const run = target.get(created.workflowRunId);
      const stage = target
        .getStages(created.workflowRunId)
        .find((candidate) => candidate.id === run?.currentStageId);
      if (stage?.stageId !== 'preproduction') break;
      const task = target
        .getTasks(created.workflowRunId)
        .find((candidate) => candidate.id === run?.currentTaskId);
      if (!run || !task) throw new Error('Pre-production current task is missing');
      await target.completeCreativeTask({
        canvasId: 'canvas-1',
        workflowRunId: created.workflowRunId,
        taskRunId: task.id,
        expectedRowVersion: run.rowVersion ?? -1,
        summary: `Completed ${task.taskId}`,
      });
    }
    return created.workflowRunId;
  }

  async function seedAcceptedMedia(
    target: WorkflowEngine,
    db: SqliteIndex,
    workflowRunId: string,
    entries: Array<{ nodeId: string; assetHash: string }>,
  ): Promise<void> {
    const repo = db.repos.workflows;
    const productionPlan = repo.getLatestDocument(workflowRunId as never, 'production-plan')!;
    const visualConstitution = repo.getLatestDocument(
      workflowRunId as never,
      'visual-constitution',
    )!;
    const counts = new Map<string, number>();
    for (const [index, entry] of entries.entries()) {
      const run = repo.getRun(workflowRunId as never)!;
      const task = target
        .getTasks(workflowRunId)
        .find((candidate) => candidate.id === run.currentTaskId);
      if (!task || task.input.workflowTaskRole !== 'production_media') {
        throw new Error(`No current production-media task for ${entry.nodeId}`);
      }
      const number = (counts.get(entry.nodeId) ?? 0) + 1;
      counts.set(entry.nodeId, number);
      const generationSpec: ProductionMediaGenerationSpec = {
        specVersion: 1,
        workflowRunId,
        canvasId: 'canvas-1',
        nodeId: entry.nodeId,
        nodeUpdatedAt: 1_000,
        workflowTask: {
          taskRunId: task.id,
          taskId: task.taskId,
          role: 'production_media',
          ...(typeof (task.input.shot as { id?: unknown } | undefined)?.id === 'string'
            ? { shotId: (task.input.shot as { id: string }).id }
            : {}),
        },
        mediaType: 'video',
        generationType: 'video',
        mode: 'text-to-video',
        productionPlan: {
          revision: productionPlan.revision,
          contentHash: productionPlan.contentHash,
        },
        visualConstitution: {
          revision: visualConstitution.revision,
          contentHash: visualConstitution.contentHash,
        },
        providerId: 'video-test',
        prompt: `shot ${entry.nodeId}`,
        referenceAssetHashes: [],
        request: { width: 1920, height: 1080, duration: 6, fps: 24, seed: index + 1 },
        limits: {
          maxAttemptsPerShot: 2,
          maxRegenerations: 4,
          maxTotalCostUsd: 20,
          styleAuditionCommittedCostUsd: 1,
        },
        createdAt: 30_000 + index,
      };
      const id = `accepted-${entry.nodeId}-${number}`;
      const reserved = repo.reserveMediaAttempt({
        expectedRunRowVersion: run.rowVersion ?? -1,
        attempt: {
          id,
          workflowRunId,
          canvasId: 'canvas-1',
          nodeId: entry.nodeId,
          attempt: number,
          idempotencyKey: hash(`idempotency-${id}`),
          specHash: hash(`spec-${id}`),
          generationSpec,
          mediaType: 'video',
          status: 'reserved',
          rowVersion: 0,
          providerId: 'video-test',
          prompt: generationSpec.prompt,
          promptHash: hash(generationSpec.prompt),
          seed: index + 1,
          estimatedCostUsd: 0,
          reportedActualCostUsd: 0,
          createdAt: 30_000 + index,
          updatedAt: 30_000 + index,
        },
      }).attempt;
      const submitted = repo.transitionMediaAttempt({
        id,
        expectedRowVersion: reserved.rowVersion,
        expectedStatuses: ['reserved'],
        status: 'submitted',
        submittedAt: 31_000 + index,
        updatedAt: 31_000 + index,
      });
      const ready = repo.transitionMediaAttempt({
        id,
        expectedRowVersion: submitted.rowVersion,
        expectedStatuses: ['submitted'],
        status: 'asset_ready',
        assetHash: entry.assetHash,
        reportedActualCostUsd: 0,
        assetReadyAt: 32_000 + index,
        updatedAt: 32_000 + index,
      });
      repo.recordMediaEvaluation({
        expectedAttemptRowVersion: ready.rowVersion,
        expectedAttemptStatuses: ['asset_ready'],
        resultingAttemptStatus: 'accepted',
        evaluatedAt: 33_000 + index,
        evaluation: {
          id: `evaluation-${id}`,
          attemptId: id,
          workflowRunId,
          canvasId: 'canvas-1',
          nodeId: entry.nodeId,
          assetHash: entry.assetHash,
          mediaType: 'video',
          rubricVersion: 'production-media-rubric-v1',
          evaluatorProviderId: 'vision-test',
          scores: {
            identity: 90,
            style: 90,
            scriptAlignment: 90,
            continuity: 90,
            composition: 90,
            lighting: 90,
            motion: 90,
            technical: 90,
            safety: 100,
          },
          total: 90,
          verdict: 'pass',
          strengths: ['Accepted'],
          risks: [],
          evidence: ['Visible evidence passed'],
          metadata: {},
          frameEvidence: [],
          createdAt: 33_000 + index,
        },
      });
      const nextEntry = entries[index + 1];
      if (!nextEntry || nextEntry.nodeId !== entry.nodeId) {
        await target.completeProductionMediaTask({
          canvasId: 'canvas-1',
          workflowRunId,
          taskRunId: task.id,
          expectedRowVersion: run.rowVersion ?? -1,
          nodeId: entry.nodeId,
          attemptId: id,
        });
      }
    }
    const assemblyRun = target.get(workflowRunId);
    const assemblyTask = target
      .getTasks(workflowRunId)
      .find((task) => task.id === assemblyRun?.currentTaskId);
    if (!assemblyRun || assemblyTask?.input.workflowTaskRole !== 'assembly') {
      throw new Error('Assembly task was not made ready after accepted media');
    }
    await target.completeCreativeTask({
      canvasId: 'canvas-1',
      workflowRunId,
      taskRunId: assemblyTask.id,
      expectedRowVersion: assemblyRun.rowVersion ?? -1,
      summary: 'Assembled accepted shots in story order.',
    });
  }

  afterEach(() => {
    for (const db of indexes.splice(0)) {
      try {
        db.close();
      } catch {
        // Restart tests may already have closed it.
      }
    }
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('binds exact selected CAS assets and output settings to the third approval gate', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-final-gate-'));
    roots.push(root);
    const dbPath = path.join(root, 'project.db');
    const db = open(dbPath);
    const firstHash = hash('video-a');
    const secondHash = hash('video-b');
    db.repos.assets.insert({
      hash: firstHash,
      type: 'video',
      format: 'mp4',
      duration: 6,
      width: 1280,
      height: 720,
    });
    db.repos.assets.insert({
      hash: secondHash,
      type: 'video',
      format: 'mp4',
      duration: 6,
      width: 720,
      height: 1280,
    });
    db.repos.canvases.upsert(canvas([firstHash, secondHash]));
    const target = engine(db);
    const workflowRunId = await approvePlanAndVisual(target, db);
    await seedAcceptedMedia(target, db, workflowRunId, [
      { nodeId: 'shot-1', assetHash: firstHash },
      { nodeId: 'shot-2', assetHash: secondHash },
    ]);

    const prepared = target.prepareFinalExportManifest({
      workflowRunId,
      canvasId: 'canvas-1',
      expectedRowVersion: target.get(workflowRunId)?.rowVersion ?? -1,
      output: {
        codec: 'h265',
        quality: 'high',
        width: 3840,
        height: 2160,
        fps: 30,
      },
    });

    expect(prepared).toMatchObject({
      created: true,
      context: {
        run: { currentGate: 'final_export', status: 'awaiting_approval' },
        approval: { gateKey: 'final_export', subjectRevision: 1 },
        manifest: {
          logicalKey: 'final-export',
          content: {
            manifestVersion: 2,
            canvasId: 'canvas-1',
            output: {
              container: 'mp4',
              codec: 'h265',
              quality: 'high',
              width: 3840,
              height: 2160,
              fps: 30,
              fitMode: 'contain',
              backgroundColor: '#000000',
            },
            segments: [
              {
                order: 0,
                nodeId: 'shot-1',
                assetHash: firstHash,
                durationSeconds: 6,
                sourceWidth: 1280,
                sourceHeight: 720,
              },
              {
                order: 1,
                nodeId: 'shot-2',
                assetHash: secondHash,
                durationSeconds: 6,
                sourceWidth: 720,
                sourceHeight: 1280,
              },
            ],
            resolutionRisks: [
              { code: 'upscale', nodeId: 'shot-1' },
              { code: 'aspect_padding', nodeId: 'shot-2' },
              { code: 'upscale', nodeId: 'shot-2' },
            ],
            estimatedDurationSeconds: 12,
            audioTracks: [],
            subtitleTracks: [],
          },
        },
      },
    });
    expect(
      target.prepareFinalExportManifest({
        workflowRunId,
        canvasId: 'canvas-1',
        expectedRowVersion: prepared.context.run.rowVersion ?? -1,
        output: {
          codec: 'h265',
          quality: 'high',
          width: 3840,
          height: 2160,
          fps: 30,
        },
      }),
    ).toMatchObject({ created: false, context: { manifest: { revision: 1 } } });

    const finalStage = target
      .getStages(workflowRunId)
      .find((stage) => stage.stageId === 'final-export');
    expect(
      target.approvePendingGateFromUser({
        workflowRunId,
        gateKey: 'final_export',
        expectedRowVersion: prepared.context.run.rowVersion ?? -1,
        expectedSubjectRevision: prepared.context.approval.subjectRevision,
        expectedSubjectHash: prepared.context.approval.subjectHash,
      }),
    ).toMatchObject({
      ok: true,
      run: { currentStageId: finalStage?.id, currentGate: undefined },
    });

    const approved = target.requireApprovedFinalExportManifest(workflowRunId, 'canvas-1');
    expect(approved.contentHash).toBe(prepared.context.manifest.contentHash);

    db.close();
    const reopened = open(dbPath);
    const restored = engine(reopened).getFinalExportContext(workflowRunId);
    expect(restored).toMatchObject({
      manifest: { contentHash: prepared.context.manifest.contentHash },
      approval: { status: 'approved', subjectHash: prepared.context.manifest.contentHash },
    });
  });

  it('does not open Final Export before the planned media task is graded', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-final-ungraded-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const assetHash = hash('ungraded-video');
    db.repos.assets.insert({
      hash: assetHash,
      type: 'video',
      format: 'mp4',
      duration: 6,
      width: 1920,
      height: 1080,
    });
    db.repos.canvases.upsert(canvas([assetHash]));
    const target = engine(db);
    const workflowRunId = await approvePlanAndVisual(target, db);

    expect(() =>
      target.prepareFinalExportManifest({
        workflowRunId,
        canvasId: 'canvas-1',
        expectedRowVersion: target.get(workflowRunId)?.rowVersion ?? -1,
        output: { codec: 'h264', quality: 'standard', width: 1920, height: 1080, fps: 24 },
      }),
    ).toThrow(/cannot prepare Final Export/i);
    expect(target.getPendingApprovalContext(workflowRunId)).toBeUndefined();
  });

  it('reopens the same Final Export gate only for a genuinely revised manifest', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-final-request-changes-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const assetHash = hash('request-changes-video');
    db.repos.assets.insert({
      hash: assetHash,
      type: 'video',
      format: 'mp4',
      duration: 6,
      width: 1920,
      height: 1080,
    });
    db.repos.canvases.upsert(canvas([assetHash]));
    const target = engine(db);
    const workflowRunId = await approvePlanAndVisual(target, db);
    await seedAcceptedMedia(target, db, workflowRunId, [{ nodeId: 'shot-1', assetHash }]);

    const originalOutput = {
      codec: 'h264' as const,
      quality: 'standard' as const,
      width: 1920,
      height: 1080,
      fps: 24,
    };
    const first = target.prepareFinalExportManifest({
      workflowRunId,
      canvasId: 'canvas-1',
      expectedRowVersion: target.get(workflowRunId)?.rowVersion ?? -1,
      output: originalOutput,
    });
    const requested = target.requestChangesPendingGateFromUser({
      workflowRunId,
      gateKey: 'final_export',
      expectedRowVersion: first.context.run.rowVersion ?? -1,
      expectedSubjectRevision: first.context.approval.subjectRevision,
      expectedSubjectHash: first.context.approval.subjectHash,
      reason: 'Use a higher-quality delivery profile.',
    });
    expect(requested).toMatchObject({
      ok: true,
      code: 'revision_requested',
      previousApproval: { status: 'rejected', subjectRevision: 1 },
      producerTask: { taskId: 'final-export', status: 'ready' },
    });
    if (!requested.ok) throw new Error('Expected Final Export revision request');

    expect(() =>
      target.prepareFinalExportManifest({
        workflowRunId,
        canvasId: 'canvas-1',
        expectedRowVersion: requested.run.rowVersion ?? -1,
        output: originalOutput,
      }),
    ).toThrow(/must differ from the rejected revision/i);

    const revised = target.prepareFinalExportManifest({
      workflowRunId,
      canvasId: 'canvas-1',
      expectedRowVersion: requested.run.rowVersion ?? -1,
      output: { ...originalOutput, quality: 'high' },
    });
    expect(revised).toMatchObject({
      created: true,
      context: {
        run: { currentGate: 'final_export', status: 'awaiting_approval' },
        manifest: { revision: 2, content: { output: { quality: 'high' } } },
        approval: { gateKey: 'final_export', subjectRevision: 2, status: 'pending' },
      },
    });
    expect(
      target.approvePendingGateFromUser({
        workflowRunId,
        gateKey: 'final_export',
        expectedRowVersion: revised.context.run.rowVersion ?? -1,
        expectedSubjectRevision: revised.context.approval.subjectRevision,
        expectedSubjectHash: revised.context.approval.subjectHash,
      }),
    ).toMatchObject({ ok: true, code: 'approved', approval: { status: 'approved' } });
    expect(target.getPendingApprovalContext(workflowRunId)).toBeUndefined();
  });

  it('requires a new manifest revision and approval when the selected media changes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-final-revision-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const firstHash = hash('video-a');
    const replacementHash = hash('video-c');
    for (const assetHash of [firstHash, replacementHash]) {
      db.repos.assets.insert({
        hash: assetHash,
        type: 'video',
        format: 'mp4',
        duration: 6,
        width: 1920,
        height: 1080,
      });
    }
    db.repos.canvases.upsert(canvas([firstHash]));
    const target = engine(db);
    const workflowRunId = await approvePlanAndVisual(target, db);
    await seedAcceptedMedia(target, db, workflowRunId, [
      { nodeId: 'shot-1', assetHash: firstHash },
      { nodeId: 'shot-1', assetHash: replacementHash },
    ]);
    const first = target.prepareFinalExportManifest({
      workflowRunId,
      canvasId: 'canvas-1',
      expectedRowVersion: target.get(workflowRunId)?.rowVersion ?? -1,
      output: { codec: 'h264', quality: 'standard', width: 1920, height: 1080, fps: 24 },
    });
    expect(
      target.approvePendingGateFromUser({
        workflowRunId,
        gateKey: 'final_export',
        expectedRowVersion: first.context.run.rowVersion ?? -1,
        expectedSubjectRevision: first.context.approval.subjectRevision,
        expectedSubjectHash: first.context.approval.subjectHash,
      }),
    ).toMatchObject({ ok: true });

    db.repos.canvases.upsert(canvas([replacementHash]));
    expect(() => target.requireApprovedFinalExportManifest(workflowRunId, 'canvas-1')).toThrow(
      /canvas media no longer matches/i,
    );

    const revised = target.prepareFinalExportManifest({
      workflowRunId,
      canvasId: 'canvas-1',
      expectedRowVersion: target.get(workflowRunId)?.rowVersion ?? -1,
      output: { codec: 'h264', quality: 'standard', width: 1920, height: 1080, fps: 24 },
    });
    expect(revised).toMatchObject({
      created: true,
      context: {
        run: { currentGate: 'final_export' },
        manifest: {
          revision: 2,
          content: { segments: [{ assetHash: replacementHash }] },
        },
        approval: { status: 'pending', subjectRevision: 2 },
      },
    });
    expect(() => target.requireApprovedFinalExportManifest(workflowRunId, 'canvas-1')).toThrow(
      /awaiting final_export approval|exact final_export approval is required/i,
    );
  });
});
