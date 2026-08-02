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

describe('WorkflowEngine visual constitution gate', () => {
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
      idFactory: () => `visual-id-${++id}`,
      now: () => 10_000,
    });
  }

  function approvedPlan(target: WorkflowEngine) {
    const created = target.createProductionPlan({
      canvasId: 'canvas-1',
      idea: 'A signal arrives from tomorrow.',
      plan: plan(),
    });
    const pending = target.getPendingApprovalContext(created.workflowRunId);
    if (!pending) throw new Error('Expected production approval');
    const approved = target.approvePendingGateFromUser({
      workflowRunId: created.workflowRunId,
      gateKey: 'production_plan',
      expectedRowVersion: pending.run.rowVersion ?? -1,
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
    });

    expect(() =>
      target.beginVisualAudition({
        canvasId: 'canvas-1',
        workflowRunId: created.workflowRunId,
        providerId: 'image-test',
        width: 1024,
        height: 576,
        candidates: candidates(),
      }),
    ).toThrow(/awaiting production_plan approval/);
    expect(target.getLatestVisualAudition(created.workflowRunId)).toBeUndefined();
  });

  it('resumes only the identical candidate request and rejects a conflicting set', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-visual-resume-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const target = engine(db);
    const created = approvedPlan(target);
    const request = {
      canvasId: 'canvas-1',
      workflowRunId: created.workflowRunId,
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

  it('persists graded previews, atomically opens the user-selected gate, and restores it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-visual-gate-'));
    roots.push(root);
    const dbPath = path.join(root, 'project.db');
    const db = open(dbPath);
    const target = engine(db);
    const created = approvedPlan(target);
    const started = target.beginVisualAudition({
      canvasId: 'canvas-1',
      workflowRunId: created.workflowRunId,
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
      workflowRunId: created.workflowRunId,
      expectedRevision: started.document.revision,
      content,
    });
    const rowVersion = target.get(created.workflowRunId)?.rowVersion ?? -1;
    const selected = target.selectVisualConstitutionCandidateFromUser({
      workflowRunId: created.workflowRunId,
      candidateId: 'quiet-realism',
      expectedRowVersion: rowVersion,
      expectedAuditionRevision: completed.revision,
      expectedAuditionHash: completed.contentHash,
    });

    expect(selected).toMatchObject({
      created: true,
      context: {
        run: { status: 'awaiting_approval', currentGate: 'visual_constitution' },
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
      db.repos.workflows.listEvents(created.workflowRunId as never).map((event) => event.seq),
    ).toEqual([1, 2, 3, 4]);
    db.close();

    const reopened = open(dbPath);
    const restored = engine(reopened);
    const pending = restored.getPendingApprovalContext(created.workflowRunId);
    expect(pending).toMatchObject({
      approval: {
        gateKey: 'visual_constitution',
        subjectHash: selected.context.document.contentHash,
      },
      document: { content: { selectedCandidateId: 'quiet-realism' } },
    });
    if (!pending) throw new Error('Expected restored visual approval');
    expect(
      restored.approvePendingGateFromUser({
        workflowRunId: created.workflowRunId,
        gateKey: 'visual_constitution',
        expectedRowVersion: pending.run.rowVersion ?? -1,
        expectedSubjectRevision: pending.approval.subjectRevision,
        expectedSubjectHash: pending.approval.subjectHash,
      }),
    ).toMatchObject({
      ok: true,
      run: { status: 'ready', currentStageId: 'media-generation', currentGate: undefined },
    });
  });
});
