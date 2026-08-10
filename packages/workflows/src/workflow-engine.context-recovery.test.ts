import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteIndex } from '@lucid-fin/storage';
import { WorkflowEngine } from './workflow-engine.js';
import { WorkflowRegistry } from './workflow-registry.js';

function makePlan(): Record<string, unknown> {
  return {
    title: 'Context Recovery Test',
    logline: 'A durable workflow survives context pressure.',
    synopsis: 'The production remains authoritative while Commander context is rebuilt.',
    genre: 'science fiction',
    tone: 'measured',
    targetAudience: 'general',
    format: { targetDurationSeconds: 30, aspectRatio: '16:9' },
    story: {
      acts: [
        {
          name: 'Act 1',
          purpose: 'Establish the recovery boundary.',
          scenes: [
            {
              title: 'Checkpoint',
              summary: 'The workflow pauses safely.',
              storyBeat: 'setup',
              dialogueIntent: 'Clarity',
            },
          ],
        },
      ],
    },
    assumptions: [],
    budget: {
      maxTotalCostUsd: 10,
      styleAuditionCostUsd: 1,
      maxAttemptsPerShot: 2,
      maxRegenerations: 2,
    },
    visualDirections: ['restrained realism'],
  };
}

describe('WorkflowEngine context recovery state', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  afterEach(() => {
    for (const db of indexes.splice(0)) {
      try {
        db.close();
      } catch {
        // A test may close the database to prove restart durability.
      }
    }
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function open(dbPath: string): SqliteIndex {
    const db = new SqliteIndex(dbPath);
    indexes.push(db);
    return db;
  }

  function createEngine(db: SqliteIndex): WorkflowEngine {
    let id = 0;
    let now = 1_000;
    return new WorkflowEngine({
      db,
      registry: new WorkflowRegistry(),
      handlers: [],
      idFactory: () => `context-recovery-id-${++id}`,
      now: () => ++now,
    });
  }

  it('persists failures, pauses on the third, and restores the pre-pause gate state on recovery', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-context-recovery-'));
    roots.push(root);
    const dbPath = path.join(root, 'project.db');
    const first = open(dbPath);
    const firstEngine = createEngine(first);
    const created = await firstEngine.createProductionPlan({
      canvasId: 'canvas-context-1',
      idea: 'A workflow that must survive context recovery.',
      plan: makePlan(),
    });

    expect(
      await firstEngine.reportContextRecovery({
        workflowRunId: created.workflowRunId,
        outcome: 'failed',
        reason: 'compaction_failed',
      }),
    ).toMatchObject({ state: 'recovering', consecutiveFailures: 1, changed: true });
    expect(
      await firstEngine.reportContextRecovery({
        workflowRunId: created.workflowRunId,
        outcome: 'failed',
        reason: 'compaction_failed',
      }),
    ).toMatchObject({ state: 'recovering', consecutiveFailures: 2, changed: true });
    expect(firstEngine.get(created.workflowRunId)).toMatchObject({
      status: 'awaiting_approval',
      currentGate: 'production_plan',
      metadata: {
        contextRecovery: {
          state: 'recovering',
          consecutiveFailures: 2,
        },
      },
    });

    expect(
      await firstEngine.reportContextRecovery({
        workflowRunId: created.workflowRunId,
        outcome: 'failed',
        reason: 'compaction_failed',
      }),
    ).toMatchObject({ state: 'recovery_required', consecutiveFailures: 3, changed: true });
    expect(firstEngine.get(created.workflowRunId)).toMatchObject({
      status: 'paused',
      currentGate: 'production_plan',
      metadata: {
        contextRecovery: {
          state: 'recovery_required',
          consecutiveFailures: 3,
          previousRunStatus: 'awaiting_approval',
        },
      },
    });
    first.close();

    const reopened = open(dbPath);
    const recoveredEngine = createEngine(reopened);
    expect(recoveredEngine.get(created.workflowRunId)).toMatchObject({
      status: 'paused',
      metadata: { contextRecovery: { state: 'recovery_required', consecutiveFailures: 3 } },
    });

    expect(
      await recoveredEngine.reportContextRecovery({
        workflowRunId: created.workflowRunId,
        outcome: 'recovered',
        reason: 'persistent_context_reloaded',
      }),
    ).toMatchObject({ state: 'active', consecutiveFailures: 0, changed: true });
    expect(recoveredEngine.get(created.workflowRunId)).toMatchObject({
      status: 'awaiting_approval',
      currentGate: 'production_plan',
      metadata: {
        contextRecovery: {
          state: 'recovered',
          consecutiveFailures: 0,
        },
      },
    });
  });

  it('forces an immediate durable pause for the 92 percent hard stop', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-context-hard-stop-'));
    roots.push(root);
    const db = open(path.join(root, 'project.db'));
    const engine = createEngine(db);
    const created = await engine.createProductionPlan({
      canvasId: 'canvas-context-2',
      idea: 'A workflow at its verified context ceiling.',
      plan: makePlan(),
    });

    const result = await engine.reportContextRecovery({
      workflowRunId: created.workflowRunId,
      outcome: 'failed',
      reason: 'hard_stop',
      forcePause: true,
    });

    expect(result).toMatchObject({
      state: 'recovery_required',
      consecutiveFailures: 1,
      changed: true,
    });
    expect(engine.get(created.workflowRunId)).toMatchObject({
      status: 'paused',
      metadata: {
        contextRecovery: {
          state: 'recovery_required',
          reason: 'hard_stop',
          consecutiveFailures: 1,
        },
      },
    });
  });
});
