import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  WorkflowDecision,
  WorkflowRun,
  WorkflowRunId,
  WorkflowStageRun,
  WorkflowTaskRun,
} from '@lucid-fin/contracts';
import { SqliteIndex } from '../sqlite-index.js';

function run(): WorkflowRun {
  return {
    id: 'run-decision',
    workflowType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status: 'ready',
    summary: 'Style exploration',
    progress: 20,
    completedStages: 1,
    totalStages: 6,
    completedTasks: 1,
    totalTasks: 6,
    currentStageId: 'stage-style',
    currentTaskId: 'task-style',
    input: {},
    output: {},
    metadata: {},
    createdAt: 100,
    updatedAt: 100,
    rowVersion: 7,
    engineVersion: 'persistent-hybrid-v1',
    definitionVersion: 2,
  };
}

function stage(): WorkflowStageRun {
  return {
    id: 'stage-style',
    workflowRunId: 'run-decision',
    stageId: 'style-exploration',
    name: 'Style exploration',
    status: 'ready',
    order: 1,
    progress: 0,
    completedTasks: 0,
    totalTasks: 1,
    metadata: {},
    updatedAt: 100,
  };
}

function task(): WorkflowTaskRun {
  return {
    id: 'task-style',
    workflowRunId: 'run-decision',
    stageRunId: 'stage-style',
    taskId: 'style-audition',
    name: 'Style audition',
    kind: 'adapter_generation',
    status: 'ready',
    dependencyIds: [],
    attempts: 0,
    maxRetries: 0,
    input: { executionMode: 'external' },
    output: {},
    progress: 0,
    updatedAt: 100,
  };
}

function decision(questionId = 'question-1'): WorkflowDecision {
  return {
    id: 'decision-1',
    workflowRunId: 'run-decision',
    taskRunId: 'task-style',
    canvasId: 'canvas-1',
    questionId,
    decisionKey: 'style.horror.subgenre',
    subjectRevision: 2,
    question: 'Which horror direction should guide the previews?',
    options: [
      { id: 'opt-0', label: 'Gothic' },
      { id: 'opt-1', label: 'Analog', description: 'Degraded broadcast unease' },
    ],
    allowFreeText: false,
    status: 'pending',
    rowVersion: 0,
    createdAt: 200,
    updatedAt: 200,
  };
}

describe('persistent workflow AskUser decisions', () => {
  const roots: string[] = [];
  const indexes: SqliteIndex[] = [];

  function openIndex(dbPath: string): SqliteIndex {
    const index = new SqliteIndex(dbPath);
    indexes.push(index);
    return index;
  }

  afterEach(() => {
    for (const index of indexes.splice(0)) {
      try {
        index.close();
      } catch {
        // A test may close the connection to simulate restart.
      }
    }
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('reserves idempotently, survives restart, and answers by the durable question id', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-decision-'));
    roots.push(root);
    const dbPath = path.join(root, 'project.db');
    const first = openIndex(dbPath);
    const repo = first.repos.workflows;
    repo.insertRun(run());
    repo.insertStageRun(stage());
    repo.insertTaskRun(task());

    const reserved = repo.reserveDecision({
      decision: decision(),
      expectedRunRowVersion: 7,
      event: {
        workflowRunId: 'run-decision',
        eventId: 'event-requested',
        actor: 'assistant',
        correlationId: 'corr-1',
        payload: { type: 'workflow.decision.requested' },
        timestamp: 200,
      },
    });
    expect(reserved).toMatchObject({
      created: true,
      decision: { id: 'decision-1', status: 'pending', questionId: 'question-1' },
      run: { status: 'blocked', rowVersion: 8 },
      task: { status: 'blocked', currentStep: 'awaiting_user_decision' },
      event: { seq: 1, eventId: 'event-requested' },
    });

    const repeated = repo.reserveDecision({
      decision: { ...decision('question-retried'), id: 'decision-retried' },
      expectedRunRowVersion: 7,
      event: {
        workflowRunId: 'run-decision',
        eventId: 'event-must-not-exist',
        actor: 'assistant',
        payload: { type: 'workflow.decision.requested' },
        timestamp: 201,
      },
    });
    expect(repeated).toMatchObject({
      created: false,
      decision: { id: 'decision-1', questionId: 'question-1' },
    });
    expect(repo.listEvents('run-decision' as WorkflowRunId)).toHaveLength(1);
    first.close();

    const reopened = openIndex(dbPath);
    const recovered = reopened.repos.workflows.listPendingDecisions({ canvasId: 'canvas-1' });
    expect(recovered).toEqual([
      expect.objectContaining({
        decisionKey: 'style.horror.subgenre',
        subjectRevision: 2,
        questionId: 'question-1',
        status: 'pending',
      }),
    ]);

    const answered = reopened.repos.workflows.answerDecision({
      canvasId: 'canvas-1',
      questionId: 'question-1',
      answer: 'Analog',
      selectedOptionId: 'opt-1',
      status: 'recovery_required',
      answeredAt: 300,
      event: {
        workflowRunId: 'run-decision',
        eventId: 'event-answered',
        actor: 'user',
        correlationId: 'corr-2',
        payload: { type: 'workflow.decision.answered' },
        timestamp: 300,
      },
    });
    expect(answered).toMatchObject({
      answered: true,
      decision: {
        status: 'recovery_required',
        answer: 'Analog',
        selectedOptionId: 'opt-1',
        rowVersion: 1,
      },
      run: { status: 'blocked', rowVersion: 9 },
      task: { status: 'blocked', currentStep: 'recovery_required' },
      event: { seq: 2, eventId: 'event-answered' },
    });
    expect(reopened.repos.workflows.listPendingDecisions({ canvasId: 'canvas-1' })).toEqual([
      expect.objectContaining({ id: 'decision-1', status: 'recovery_required', answer: 'Analog' }),
    ]);

    const sameAnswer = reopened.repos.workflows.answerDecision({
      canvasId: 'canvas-1',
      questionId: 'question-1',
      answer: 'Analog',
      selectedOptionId: 'opt-1',
      status: 'recovery_required',
      answeredAt: 301,
      event: {
        workflowRunId: 'run-decision',
        eventId: 'event-repeat',
        actor: 'user',
        payload: { type: 'workflow.decision.answered' },
        timestamp: 301,
      },
    });
    expect(sameAnswer).toMatchObject({ answered: false });
    expect(sameAnswer).not.toHaveProperty('event');
    expect(reopened.repos.workflows.listEvents('run-decision' as WorkflowRunId)).toHaveLength(2);

    const resumed = reopened.repos.workflows.answerDecision({
      canvasId: 'canvas-1',
      questionId: 'question-1',
      answer: 'Analog',
      status: 'answered',
      answeredAt: 302,
      event: {
        workflowRunId: 'run-decision',
        eventId: 'event-recovered',
        actor: 'assistant',
        payload: { type: 'workflow.decision.recovered' },
        timestamp: 302,
      },
    });
    expect(resumed).toMatchObject({
      answered: true,
      decision: { status: 'answered', answer: 'Analog' },
      run: { status: 'ready', rowVersion: 10 },
      task: { status: 'ready', currentStep: 'user_decision_answered' },
    });
    expect(reopened.repos.workflows.listPendingDecisions({ canvasId: 'canvas-1' })).toEqual([]);
  });

  it('rejects reuse of the same decision key and subject revision with different content', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-decision-conflict-'));
    roots.push(root);
    const index = openIndex(path.join(root, 'project.db'));
    const repo = index.repos.workflows;
    repo.insertRun(run());
    repo.insertStageRun(stage());
    repo.insertTaskRun(task());
    const event = {
      workflowRunId: 'run-decision',
      eventId: 'event-1',
      actor: 'assistant',
      payload: { type: 'workflow.decision.requested' },
      timestamp: 200,
    };
    repo.reserveDecision({ decision: decision(), expectedRunRowVersion: 7, event });

    expect(() =>
      repo.reserveDecision({
        decision: {
          ...decision('question-2'),
          id: 'decision-2',
          question: 'A different question?',
        },
        expectedRunRowVersion: 8,
        event: { ...event, eventId: 'event-2', timestamp: 201 },
      }),
    ).toThrow(/idempotency/i);
  });

  it('makes the bound task ready when an active Commander can consume the answer', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-decision-active-'));
    roots.push(root);
    const index = openIndex(path.join(root, 'project.db'));
    const repo = index.repos.workflows;
    repo.insertRun(run());
    repo.insertStageRun(stage());
    repo.insertTaskRun(task());
    repo.reserveDecision({
      decision: decision(),
      expectedRunRowVersion: 7,
      event: {
        workflowRunId: 'run-decision',
        eventId: 'event-requested',
        actor: 'assistant',
        payload: {},
        timestamp: 200,
      },
    });

    const answered = repo.answerDecision({
      canvasId: 'canvas-1',
      questionId: 'question-1',
      answer: 'Gothic',
      status: 'answered',
      answeredAt: 300,
      event: {
        workflowRunId: 'run-decision',
        eventId: 'event-answered',
        actor: 'user',
        payload: {},
        timestamp: 300,
      },
    });

    expect(answered).toMatchObject({
      answered: true,
      decision: { status: 'answered', answer: 'Gothic' },
      run: { status: 'ready', rowVersion: 9 },
      task: { status: 'ready', currentStep: 'user_decision_answered' },
    });
    expect(repo.listPendingDecisions({ canvasId: 'canvas-1' })).toEqual([]);
  });

  it('rejects a custom answer when the durable decision is closed-choice', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-decision-closed-'));
    roots.push(root);
    const index = openIndex(path.join(root, 'project.db'));
    const repo = index.repos.workflows;
    repo.insertRun(run());
    repo.insertStageRun(stage());
    repo.insertTaskRun(task());
    repo.reserveDecision({
      decision: decision(),
      expectedRunRowVersion: 7,
      event: {
        workflowRunId: 'run-decision',
        eventId: 'event-requested',
        actor: 'assistant',
        payload: {},
        timestamp: 200,
      },
    });

    expect(() =>
      repo.answerDecision({
        canvasId: 'canvas-1',
        questionId: 'question-1',
        answer: 'Something else',
        status: 'answered',
        answeredAt: 300,
        event: {
          workflowRunId: 'run-decision',
          eventId: 'event-answered',
          actor: 'user',
          payload: {},
          timestamp: 300,
        },
      }),
    ).toThrow(/listed options/i);
    expect(repo.listPendingDecisions({ canvasId: 'canvas-1' })).toHaveLength(1);
  });

  it('rejects a mismatched answer even when a valid closed-choice option id is supplied', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-decision-mismatch-'));
    roots.push(root);
    const index = openIndex(path.join(root, 'project.db'));
    const repo = index.repos.workflows;
    repo.insertRun(run());
    repo.insertStageRun(stage());
    repo.insertTaskRun(task());
    repo.reserveDecision({
      decision: decision(),
      expectedRunRowVersion: 7,
      event: {
        workflowRunId: 'run-decision',
        eventId: 'event-requested',
        actor: 'assistant',
        payload: {},
        timestamp: 200,
      },
    });

    expect(() =>
      repo.answerDecision({
        canvasId: 'canvas-1',
        questionId: 'question-1',
        answer: 'Something else',
        selectedOptionId: 'opt-1',
        status: 'answered',
        answeredAt: 300,
        event: {
          workflowRunId: 'run-decision',
          eventId: 'event-answered',
          actor: 'user',
          payload: {},
          timestamp: 300,
        },
      }),
    ).toThrow(/listed options/i);
    expect(repo.listPendingDecisions({ canvasId: 'canvas-1' })).toHaveLength(1);
  });

  it('accepts a custom answer when free text was explicitly persisted', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-decision-open-'));
    roots.push(root);
    const index = openIndex(path.join(root, 'project.db'));
    const repo = index.repos.workflows;
    repo.insertRun(run());
    repo.insertStageRun(stage());
    repo.insertTaskRun(task());
    repo.reserveDecision({
      decision: { ...decision(), allowFreeText: true },
      expectedRunRowVersion: 7,
      event: {
        workflowRunId: 'run-decision',
        eventId: 'event-requested',
        actor: 'assistant',
        payload: {},
        timestamp: 200,
      },
    });

    const answered = repo.answerDecision({
      canvasId: 'canvas-1',
      questionId: 'question-1',
      answer: 'Neon nightmare',
      status: 'answered',
      answeredAt: 300,
      event: {
        workflowRunId: 'run-decision',
        eventId: 'event-answered',
        actor: 'user',
        payload: {},
        timestamp: 300,
      },
    });

    expect(answered).toMatchObject({
      answered: true,
      decision: { answer: 'Neon nightmare', selectedOptionId: undefined },
    });
  });
});
