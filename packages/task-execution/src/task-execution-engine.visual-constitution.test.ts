import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  VisualAuditionDocumentContent,
  VisualDirectionCandidateProposal,
  VisualPreviewGrade,
} from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import { TaskExecutionEngine, VISUAL_PREVIEW_RUBRIC_VERSION } from './task-execution-engine.js';
import { TaskListRegistry } from './task-list-registry.js';

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
    format: { targetDurationSeconds: 60, aspectRatio: '16:9' },
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

function commanderContinuation() {
  return {
    version: 1 as const,
    sessionId: 'session-1',
    provider: {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6-sol',
      protocol: 'openai-responses',
      authStyle: 'bearer',
    },
    permissionMode: 'normal' as const,
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
    cameraGrammar: 'patient locked frames with rare controlled push-ins',
    lensGrammar: '32mm environmental wides and 65mm emotional closeups',
    compositionGrammar: 'negative space and obstructed foreground layers',
    motionGrammar: 'subtle human motion, no floating camera',
    characterAnchors: [],
    locationAnchors: ['remote radio room', 'antenna field'],
    negativeConstraints: ['no glossy sci-fi interfaces', 'no neon cyberpunk'],
  };
}

function candidates(): VisualDirectionCandidateProposal[] {
  return [
    {
      id: 'analog-horror',
      name: 'Analog Dread',
      summary: 'Tactile cosmic dread in an aging station.',
      prompt: 'A remote 1970s radio room at midnight, analog cosmic dread.',
      seed: 101,
      constitution: constitution('restrained photochemical realism'),
    },
    {
      id: 'quiet-realism',
      name: 'Quiet Realism',
      summary: 'Naturalistic near-future tension.',
      prompt: 'A remote radio room at midnight, restrained near-future realism.',
      seed: 202,
      constitution: constitution('naturalistic near-future realism'),
    },
  ];
}

function grade(total: number): VisualPreviewGrade {
  return {
    rubricVersion: VISUAL_PREVIEW_RUBRIC_VERSION,
    promptAdherence: total,
    styleClarity: total,
    storyFit: total,
    lighting: total,
    composition: total,
    continuityPotential: total,
    total,
    verdict: total >= 70 ? 'pass' : 'human_review',
    strengths: ['Clear lighting hierarchy'],
    risks: ['Faces are not yet identity locked'],
    evidence: 'The preview preserves the radio-room setting and the intended low-key contrast.',
    visionProviderId: 'vision-test',
    visionModel: 'vision-model-test',
  };
}

describe('TaskExecutionEngine visual constitution gate', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  function open(dbPath: string): SqliteIndex {
    const db = new SqliteIndex(dbPath);
    indexes.push(db);
    return db;
  }

  function engine(db: SqliteIndex, now = 10_000): TaskExecutionEngine {
    let id = 0;
    return new TaskExecutionEngine({
      db,
      registry: new TaskListRegistry(),
      handlers: [],
      idFactory: () => `visual-id-${++id}`,
      now: () => now,
    });
  }

  function approvedPlan(target: TaskExecutionEngine) {
    const created = target.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A signal arrives from tomorrow.',
      plan: plan(),
      commanderContinuation: commanderContinuation(),
    });
    const pending = target.getPendingApprovalContext(created.taskListId);
    if (!pending) throw new Error('Expected production approval');
    const approved = target.approvePendingGateFromUser({
      taskListId: created.taskListId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.taskList.rowVersion ?? -1,
      expectedSubjectRevision: pending.approval.subjectRevision,
      expectedSubjectHash: pending.approval.subjectHash,
    });
    if (!approved.ok) throw new Error(`Plan approval failed: ${approved.code}`);
    return created;
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

  it('requires the exact Production Plan approval before creating provider work', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-visual-plan-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const target = engine(db);
    const created = target.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A signal arrives from tomorrow.',
      plan: plan(),
      commanderContinuation: commanderContinuation(),
    });

    expect(() =>
      target.beginVisualAudition({
        canvasId: 'canvas-1',
        taskListId: created.taskListId,
        providerId: 'image-test',
        width: 1024,
        height: 576,
        candidates: candidates(),
      }),
    ).toThrow(/awaiting production_plan approval/);
    expect(target.getLatestVisualAudition(created.taskListId)).toBeUndefined();
  });

  it('allows a single valid visual candidate while still rejecting an empty set', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-visual-candidate-count-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const target = engine(db);
    const created = approvedPlan(target);

    expect(
      target.beginVisualAudition({
        canvasId: 'canvas-1',
        taskListId: created.taskListId,
        providerId: 'image-test',
        width: 1024,
        height: 576,
        candidates: candidates().slice(0, 1),
      }),
    ).toMatchObject({ document: { content: { candidates: [expect.objectContaining({ id: 'analog-horror' })] } } });

    const emptyDb = open(path.join(root, 'empty-project.db'));
    const emptyTarget = engine(emptyDb);
    const emptyCreated = approvedPlan(emptyTarget);
    expect(() =>
      emptyTarget.beginVisualAudition({
        canvasId: 'canvas-1',
        taskListId: emptyCreated.taskListId,
        providerId: 'image-test',
        width: 1024,
        height: 576,
        candidates: [],
      }),
    ).toThrow('requires at least one candidate');
  });

  it('resumes only the identical candidate request and rejects a conflicting set', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-visual-resume-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const target = engine(db);
    const created = approvedPlan(target);
    const request = {
      canvasId: 'canvas-1',
      taskListId: created.taskListId,
      providerId: 'image-test',
      width: 1024,
      height: 576,
      candidates: candidates(),
    };

    expect(target.beginVisualAudition(request)).toMatchObject({
      resumed: false,
      document: { revision: 1, logicalKey: 'visual-auditions' },
    });
    expect(target.beginVisualAudition(request)).toMatchObject({
      resumed: true,
      document: { revision: 1 },
    });
    expect(() =>
      target.beginVisualAudition({
        ...request,
        candidates: candidates().map((candidate, index) =>
          index === 0 ? { ...candidate, prompt: `${candidate.prompt} changed` } : candidate,
        ),
      }),
    ).toThrow(/different visual audition already exists/);
  });

  it('CAS-protects replacement requests before a Visual Constitution is locked', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-visual-replace-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const target = engine(db);
    const created = approvedPlan(target);
    const originalCandidates = candidates();
    const started = target.beginVisualAudition({
      canvasId: 'canvas-1',
      taskListId: created.taskListId,
      providerId: 'image-test',
      width: 1024,
      height: 576,
      candidates: originalCandidates,
    });
    for (const assetHash of ['replace-analog', 'replace-realism']) {
      db.repos.assets.insert({ hash: assetHash, type: 'image', format: 'png' });
    }

    const content = structuredClone(started.document.content) as VisualAuditionDocumentContent;
    content.status = 'complete';
    content.recommendedCandidateId = originalCandidates[0]?.id;
    content.candidates = content.candidates.map((candidate, index) => {
      const assetHash = index === 0 ? 'replace-analog' : 'replace-realism';
      return {
        ...candidate,
        status: 'completed' as const,
        selectedAttempt: 1,
        attempts: [
          {
            attempt: 1,
            status: 'completed' as const,
            promptAssemblyId: `replace-assembly-${index + 1}`,
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
            assetHash,
            grade: grade(88),
            startedAt: 11_000 + index,
            completedAt: 12_000 + index,
          },
        ],
      };
    });
    content.budget.estimatedCommittedUsd = 1;
    content.budget.reportedActualUsd = 1;
    content.budget.hasUnreportedActualCosts = false;
    const completed = target.saveVisualAuditionSnapshot({
      taskListId: created.taskListId,
      expectedRevision: started.document.revision,
      content,
    });
    const before = target.get(created.taskListId);
    if (!before) throw new Error('Expected ready style-exploration Task List');

    const result = target.requestVisualAuditionChangesFromUser({
      taskListId: created.taskListId,
      expectedRowVersion: before.rowVersion ?? -1,
      expectedAuditionRevision: completed.revision,
      expectedAuditionHash: completed.contentHash,
      reason: 'Use warmer practical light and a calmer composition.',
    });

    expect(result.taskList).toMatchObject({
      rowVersion: (before.rowVersion ?? 0) + 1,
      currentPhaseKey: 'style-exploration',
      currentGate: undefined,
      metadata: {
        visualAuditionRevisionRequest: {
          action: 'request_changes',
          reason: 'Use warmer practical light and a calmer composition.',
          previousRevision: completed.revision,
          previousHash: completed.contentHash,
        },
      },
    });
    expect(target.getTasks(created.taskListId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskKey: 'style-audition',
          status: 'ready',
          currentStep: 'revision_requested',
          input: expect.objectContaining({
            revisionRequest: expect.objectContaining({
              reason: 'Use warmer practical light and a calmer composition.',
              previousRevision: completed.revision,
              previousHash: completed.contentHash,
            }),
          }),
        }),
      ]),
    );
    expect(() =>
      target.requestVisualAuditionChangesFromUser({
        taskListId: created.taskListId,
        expectedRowVersion: before.rowVersion ?? -1,
        expectedAuditionRevision: completed.revision,
        expectedAuditionHash: completed.contentHash,
        reason: 'This stale request must not replace the first one.',
      }),
    ).toThrow(/row version changed/);

    expect(
      target.beginVisualAudition({
        canvasId: 'canvas-1',
        taskListId: created.taskListId,
        providerId: 'image-test',
        width: 1024,
        height: 576,
        candidates: originalCandidates.map((candidate) => ({
          ...candidate,
          prompt: `${candidate.prompt} Warm practical light; calmer composition.`,
        })),
      }),
    ).toMatchObject({ resumed: false, document: { revision: completed.revision + 1 } });
  });

  it('requires changed auditions before reopening a rejected Visual Constitution gate', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-visual-revision-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const target = engine(db);
    const created = approvedPlan(target);

    const completeCandidateSet = (
      proposals: VisualDirectionCandidateProposal[],
      assetPrefix: string,
    ) => {
      const started = target.beginVisualAudition({
        canvasId: 'canvas-1',
        taskListId: created.taskListId,
        providerId: 'image-test',
        width: 1024,
        height: 576,
        candidates: proposals,
      });
      const assetHashes = proposals.map((_, index) => `${assetPrefix}-${index + 1}`);
      for (const assetHash of assetHashes) {
        db.repos.assets.insert({ hash: assetHash, type: 'image', format: 'png' });
      }
      const content = structuredClone(started.document.content) as VisualAuditionDocumentContent;
      content.status = 'complete';
      content.recommendedCandidateId = proposals[0]?.id;
      content.candidates = content.candidates.map((candidate, index) => ({
        ...candidate,
        status: 'completed' as const,
        selectedAttempt: 1,
        attempts: [
          {
            attempt: 1,
            status: 'completed' as const,
            promptAssemblyId: `${assetPrefix}-assembly-${index + 1}`,
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
            assetHash: assetHashes[index]!,
            grade: grade(88),
            startedAt: 11_000 + index,
            completedAt: 12_000 + index,
          },
        ],
      }));
      content.budget.estimatedCommittedUsd = 1;
      content.budget.reportedActualUsd = 1;
      content.budget.hasUnreportedActualCosts = false;
      const completed = target.saveVisualAuditionSnapshot({
        taskListId: created.taskListId,
        expectedRevision: started.document.revision,
        content,
      });
      return target.selectVisualConstitutionCandidateFromUser({
        taskListId: created.taskListId,
        candidateId: proposals[0]!.id,
        expectedRowVersion: target.get(created.taskListId)?.rowVersion ?? -1,
        expectedAuditionRevision: completed.revision,
        expectedAuditionHash: completed.contentHash,
      });
    };

    const originalCandidates = candidates();
    const first = completeCandidateSet(originalCandidates, 'visual-revision-1');
    const requested = target.requestChangesPendingGateFromUser({
      taskListId: created.taskListId,
      gateKey: 'visual_constitution',
      expectedRowVersion: first.context.taskList.rowVersion ?? -1,
      expectedSubjectRevision: first.context.approval.subjectRevision,
      expectedSubjectHash: first.context.approval.subjectHash,
      reason: 'Use warmer practical lighting and less teal.',
    });
    expect(requested).toMatchObject({
      ok: true,
      code: 'revision_requested',
      previousApproval: { status: 'rejected', subjectRevision: 1 },
      producerTask: { taskKey: 'style-audition', status: 'ready' },
    });

    expect(() =>
      target.beginVisualAudition({
        canvasId: 'canvas-1',
        taskListId: created.taskListId,
        providerId: 'image-test',
        width: 1024,
        height: 576,
        candidates: originalCandidates,
      }),
    ).toThrow(/must differ from the rejected candidate set/i);

    const revisedCandidates = originalCandidates.map((candidate) => ({
      ...candidate,
      prompt: `${candidate.prompt} Warm tungsten practicals dominate; teal is restrained.`,
      constitution: {
        ...candidate.constitution,
        palette: 'warm amber, charcoal, restrained deep teal',
      },
    }));
    const revised = completeCandidateSet(revisedCandidates, 'visual-revision-2');
    expect(revised).toMatchObject({
      created: true,
      context: {
        taskList: { currentGate: 'visual_constitution', status: 'awaiting_approval' },
        document: { revision: 2 },
        approval: { gateKey: 'visual_constitution', subjectRevision: 2, status: 'pending' },
      },
    });
    expect(
      target.approvePendingGateFromUser({
        taskListId: created.taskListId,
        gateKey: 'visual_constitution',
        expectedRowVersion: revised.context.taskList.rowVersion ?? -1,
        expectedSubjectRevision: revised.context.approval.subjectRevision,
        expectedSubjectHash: revised.context.approval.subjectHash,
      }),
    ).toMatchObject({ ok: true, code: 'approved', approval: { status: 'approved' } });
    expect(target.getPendingApprovalContext(created.taskListId)).toBeUndefined();
  });

  it('persists previews, opens the selected gate, and advances durable pre-production tasks', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-visual-gate-'));
    roots.push(root);
    const dbPath = path.join(root, 'project.db');
    const db = open(dbPath);
    const target = engine(db);
    const created = approvedPlan(target);
    const started = target.beginVisualAudition({
      canvasId: 'canvas-1',
      taskListId: created.taskListId,
      providerId: 'image-test',
      width: 1024,
      height: 576,
      candidates: candidates(),
    });
    for (const assetHash of ['asset-analog', 'asset-realism']) {
      db.repos.assets.insert({ hash: assetHash, type: 'image', format: 'png' });
    }

    const content = structuredClone(started.document.content) as VisualAuditionDocumentContent;
    content.status = 'complete';
    content.recommendedCandidateId = 'analog-horror';
    content.candidates = content.candidates.map((candidate, index) => {
      const assetHash = index === 0 ? 'asset-analog' : 'asset-realism';
      const attempt = {
        attempt: 1,
        status: 'completed' as const,
        promptAssemblyId: `visual-gate-assembly-${index + 1}`,
        prompt: candidate.prompt,
        promptHash: hash(candidate.prompt),
        providerId: 'image-test',
        model: 'image-model-test',
        requestedSeed: candidate.seed,
        reportedSeed: candidate.seed,
        width: 1024,
        height: 576,
        estimatedCostUsd: 0.5,
        ...(index === 0 ? { reportedActualCostUsd: 0.4 } : {}),
        assetHash,
        grade: grade(index === 0 ? 88 : 79),
        startedAt: 11_000 + index,
        completedAt: 12_000 + index,
      };
      return {
        ...candidate,
        status: 'completed' as const,
        attempts: [attempt],
        selectedAttempt: 1,
      };
    });
    content.budget.estimatedCommittedUsd = 1;
    content.budget.reportedActualUsd = 0.4;
    content.budget.hasUnreportedActualCosts = true;
    const completed = target.saveVisualAuditionSnapshot({
      taskListId: created.taskListId,
      expectedRevision: started.document.revision,
      content,
    });
    const rowVersion = target.get(created.taskListId)?.rowVersion ?? -1;
    const selected = target.selectVisualConstitutionCandidateFromUser({
      taskListId: created.taskListId,
      candidateId: 'quiet-realism',
      expectedRowVersion: rowVersion,
      expectedAuditionRevision: completed.revision,
      expectedAuditionHash: completed.contentHash,
    });

    expect(selected).toMatchObject({
      created: true,
      context: {
        taskList: { status: 'awaiting_approval', currentGate: 'visual_constitution' },
        approval: { gateKey: 'visual_constitution', subjectRevision: 1 },
        document: {
          logicalKey: 'visual-constitution',
          content: {
            selectedCandidateId: 'quiet-realism',
            selectedBy: 'user',
            selectedPreview: { assetHash: 'asset-realism' },
          },
        },
      },
    });
    expect(
      db.repos.taskLists.listEvents(created.taskListId as never).map((event) => event.seq),
    ).toEqual([1, 2, 3, 4]);
    db.close();

    const reopened = open(dbPath);
    const restored = engine(reopened, 40_001);
    const pending = restored.getPendingApprovalContext(created.taskListId);
    expect(pending).toMatchObject({
      approval: {
        gateKey: 'visual_constitution',
        subjectHash: selected.context.document.contentHash,
      },
      document: { content: { selectedCandidateId: 'quiet-realism' } },
    });
    if (!pending) throw new Error('Expected restored visual approval');
    const scriptTask = restored
      .getTasks(created.taskListId)
      .find((task) => task.taskKey === 'script');
    expect(
      restored.approvePendingGateFromUser({
        taskListId: created.taskListId,
        gateKey: 'visual_constitution',
        expectedRowVersion: pending.taskList.rowVersion ?? -1,
        expectedSubjectRevision: pending.approval.subjectRevision,
        expectedSubjectHash: pending.approval.subjectHash,
      }),
    ).toMatchObject({
      ok: true,
      taskList: {
        status: 'ready',
        currentPhaseKey: 'preproduction',
        currentTaskId: scriptTask?.id,
        currentGate: undefined,
      },
    });
    expect(restored.get(created.taskListId)?.currentPhaseKey).toBe('preproduction');

    await restored.waitForAutoPump();
    for (const taskId of ['script', 'entities', 'references', 'shot-spec-001']) {
      const taskList = restored.get(created.taskListId);
      const task = restored
        .getTasks(created.taskListId)
        .find((candidate) => candidate.id === taskList?.currentTaskId);
      expect(task).toMatchObject({ taskKey: taskId, status: 'ready' });
      if (!taskList || !task) throw new Error(`Expected current task ${taskId}`);
      const completedTask = await restored.completeCreativeTask({
        canvasId: 'canvas-1',
        taskListId: created.taskListId,
        taskId: task.id,
        expectedRowVersion: taskList.rowVersion ?? -1,
        summary: `Persisted ${taskId} output.`,
        evidence: [`evidence:${taskId}`],
        ...(taskId === 'shot-spec-001' ? { data: { shotId: '001' } } : {}),
      });
      expect(completedTask.task).toMatchObject({
        taskKey: taskId,
        status: 'completed',
        progress: 100,
      });
    }
    const mediaRun = restored.get(created.taskListId);
    const currentMediaTask = restored
      .getTasks(created.taskListId)
      .find((task) => task.id === mediaRun?.currentTaskId);
    expect(mediaRun?.currentPhaseKey).toBe('media-generation');
    expect(currentMediaTask).toMatchObject({
      taskKey: 'media-shot-001',
      status: 'ready',
      input: { taskRole: 'production_media' },
    });
  });
});
