import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWorkflowHandlers } from './workflow.handlers.js';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

describe('registerWorkflowHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new Map();
  });

  it('logs workflow lifecycle control requests with structured workflow context', async () => {
    const workflowEngine = {
      list: vi.fn(() => [{ id: 'wf-1', status: 'ready' }]),
      get: vi.fn((id: string) => (id === 'wf-1' ? { id: 'wf-1', status: 'ready' } : undefined)),
      getStages: vi.fn(() => [{ id: 'stage-1' }]),
      getTasks: vi.fn(() => [{ id: 'task-1' }]),
      start: vi.fn(() => 'wf-1'),
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      retryTask: vi.fn(async () => undefined),
      retryStage: vi.fn(async () => undefined),
      retryWorkflow: vi.fn(async () => undefined),
      pump: vi.fn(async () => 0),
      getPendingApprovalContext: vi.fn(() => undefined),
      approvePendingGateFromUser: vi.fn(),
      requestChangesPendingGateFromUser: vi.fn(),
      rejectPendingGateFromUser: vi.fn(),
      listPendingDecisions: vi.fn(() => []),
    };

    registerWorkflowHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      workflowEngine as never,
    );

    const start = handlers.get('workflow:start');
    const get = handlers.get('workflow:get');
    const getStages = handlers.get('workflow:getStages');
    const getTasks = handlers.get('workflow:getTasks');
    const pause = handlers.get('workflow:pause');
    const resume = handlers.get('workflow:resume');
    const cancel = handlers.get('workflow:cancel');

    await expect(
      start?.(
        {},
        {
          workflowType: 'storyboard.generate',
          entityType: 'scene',
          entityId: 'scene-1',
          triggerSource: 'user',
        },
      ),
    ).resolves.toEqual({ workflowRunId: 'wf-1' });

    await expect(get?.({}, { id: 'wf-1' })).resolves.toEqual({ id: 'wf-1', status: 'ready' });
    await expect(getStages?.({}, { workflowRunId: 'wf-1' })).resolves.toEqual([{ id: 'stage-1' }]);
    await expect(getTasks?.({}, { workflowRunId: 'wf-1' })).resolves.toEqual([{ id: 'task-1' }]);
    await pause?.({}, { id: 'wf-1' });
    await resume?.({}, { id: 'wf-1' });
    await cancel?.({}, { id: 'wf-1' });

    expect(logger.info).toHaveBeenCalledWith(
      'Workflow start requested',
      expect.objectContaining({
        category: 'workflow',
        workflowType: 'storyboard.generate',
        entityType: 'scene',
        entityId: 'scene-1',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Workflow started',
      expect.objectContaining({
        category: 'workflow',
        workflowRunId: 'wf-1',
        workflowType: 'storyboard.generate',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Workflow pause requested',
      expect.objectContaining({
        category: 'workflow',
        workflowRunId: 'wf-1',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Workflow resume requested',
      expect.objectContaining({
        category: 'workflow',
        workflowRunId: 'wf-1',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Workflow cancel requested',
      expect.objectContaining({
        category: 'workflow',
        workflowRunId: 'wf-1',
      }),
    );
  });

  it('logs a structured error when workflow:get misses', async () => {
    const engine = {
      list: vi.fn(),
      get: vi.fn(() => undefined),
      getStages: vi.fn(),
      getTasks: vi.fn(),
      start: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      retryTask: vi.fn(),
      retryStage: vi.fn(),
      retryWorkflow: vi.fn(),
      pump: vi.fn(async () => 0),
      getPendingApprovalContext: vi.fn(() => undefined),
      getVisualAuditionContext: vi.fn(() => undefined),
      getFinalExportContext: vi.fn(() => undefined),
      approvePendingGateFromUser: vi.fn(),
      requestChangesPendingGateFromUser: vi.fn(() => ({
        ok: false,
        code: 'stale_revision',
      })),
      rejectPendingGateFromUser: vi.fn(() => ({ ok: false, code: 'stale_revision' })),
      listPendingDecisions: vi.fn(() => []),
    };
    registerWorkflowHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      engine as never,
    );

    const get = handlers.get('workflow:get');
    await expect(get?.({}, { id: 'missing-run' })).rejects.toThrow(
      'Workflow "missing-run" not found',
    );

    expect(logger.error).toHaveBeenCalledWith(
      'Workflow not found',
      expect.objectContaining({
        category: 'workflow',
        workflowRunId: 'missing-run',
      }),
    );

    await expect(
      handlers.get('workflow:getPendingApproval')?.({}, { workflowRunId: 'missing-run' }),
    ).resolves.toBeNull();
    await expect(
      handlers.get('workflow:getVisualAuditions')?.({}, { workflowRunId: 'missing-run' }),
    ).resolves.toBeNull();
    await expect(
      handlers.get('workflow:getFinalExport')?.({}, { workflowRunId: 'missing-run' }),
    ).resolves.toBeNull();

    const staleRevision = {
      workflowRunId: 'missing-run',
      gateKey: 'production_plan',
      expectedRowVersion: 4,
      expectedSubjectRevision: 2,
      expectedSubjectHash: 'a'.repeat(64),
      reason: 'Update the plan.',
    };
    await expect(
      handlers.get('workflow:requestChanges')?.({}, staleRevision),
    ).resolves.toMatchObject({ ok: false });
    await expect(handlers.get('workflow:rejectGate')?.({}, staleRevision)).resolves.toMatchObject({
      ok: false,
    });
    expect(engine.pump).not.toHaveBeenCalled();
  });

  it('exposes the exact pending revision and derives the approval actor in the main process', async () => {
    const requestCommanderContinuation = vi.fn();
    const pending = {
      run: { id: 'wf-plan-1', rowVersion: 4, currentGate: 'production_plan' },
      approval: {
        id: 'approval-1',
        gateKey: 'production_plan',
        subjectRevision: 2,
        subjectHash: 'a'.repeat(64),
      },
      document: { id: 'doc-2', revision: 2, contentHash: 'a'.repeat(64), content: {} },
    };
    const engine = {
      list: vi.fn(),
      get: vi.fn(),
      getStages: vi.fn(),
      getTasks: vi.fn(),
      start: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      retryTask: vi.fn(),
      retryStage: vi.fn(),
      retryWorkflow: vi.fn(),
      pump: vi.fn(async () => 0),
      waitForAutoPump: vi.fn(async () => undefined),
      getPendingApprovalContext: vi.fn(() => pending),
      getVisualAuditionContext: vi.fn(() => ({
        run: { id: 'wf-plan-1', rowVersion: 3 },
        document: { revision: 7, contentHash: 'b'.repeat(64) },
      })),
      getFinalExportContext: vi.fn(() => ({
        run: { id: 'wf-plan-1', rowVersion: 5 },
        manifest: { revision: 1, contentHash: 'c'.repeat(64) },
        approval: { gateKey: 'final_export', status: 'pending' },
      })),
      selectVisualConstitutionCandidateFromUser: vi.fn(() => ({
        context: pending,
        created: true,
      })),
      approvePendingGateFromUser: vi.fn(() => ({
        ok: true,
        code: 'approved',
        run: { id: 'wf-plan-1' },
      })),
      requestChangesPendingGateFromUser: vi.fn(() => ({
        ok: true,
        code: 'revision_requested',
      })),
      rejectPendingGateFromUser: vi.fn(() => ({
        ok: true,
        code: 'revision_requested',
      })),
      listPendingDecisions: vi.fn(() => [
        { id: 'decision-1', workflowRunId: 'wf-plan-1', status: 'pending' },
      ]),
    };
    registerWorkflowHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      engine as never,
      { requestCommanderContinuation },
    );

    await expect(
      handlers.get('workflow:getPendingApproval')?.({}, { workflowRunId: 'wf-plan-1' }),
    ).resolves.toBe(pending);
    await expect(
      handlers.get('workflow:getVisualAuditions')?.({}, { workflowRunId: 'wf-plan-1' }),
    ).resolves.toMatchObject({ document: { revision: 7 } });
    await expect(
      handlers.get('workflow:getFinalExport')?.({}, { workflowRunId: 'wf-plan-1' }),
    ).resolves.toMatchObject({
      manifest: { revision: 1, contentHash: 'c'.repeat(64) },
      approval: { gateKey: 'final_export', status: 'pending' },
    });

    const selection = {
      workflowRunId: 'wf-plan-1',
      candidateId: 'analog-horror',
      expectedRowVersion: 3,
      expectedAuditionRevision: 7,
      expectedAuditionHash: 'b'.repeat(64),
      actor: 'assistant',
    };
    await expect(
      handlers.get('workflow:selectVisualCandidate')?.({}, selection),
    ).resolves.toMatchObject({ created: true });
    expect(engine.selectVisualConstitutionCandidateFromUser).toHaveBeenCalledWith({
      workflowRunId: 'wf-plan-1',
      candidateId: 'analog-horror',
      expectedRowVersion: 3,
      expectedAuditionRevision: 7,
      expectedAuditionHash: 'b'.repeat(64),
    });

    const request = {
      workflowRunId: 'wf-plan-1',
      gateKey: 'production_plan',
      expectedRowVersion: 4,
      expectedSubjectRevision: 2,
      expectedSubjectHash: 'a'.repeat(64),
      actor: 'assistant',
      resumeTokenHash: 'renderer-must-not-control-this',
    };
    await expect(handlers.get('workflow:approveGate')?.({}, request)).resolves.toEqual({
      ok: true,
      code: 'approved',
      run: { id: 'wf-plan-1' },
    });
    expect(engine.approvePendingGateFromUser).toHaveBeenCalledWith({
      workflowRunId: 'wf-plan-1',
      gateKey: 'production_plan',
      expectedRowVersion: 4,
      expectedSubjectRevision: 2,
      expectedSubjectHash: 'a'.repeat(64),
    });
    expect(engine.waitForAutoPump).toHaveBeenCalledOnce();
    expect(requestCommanderContinuation).toHaveBeenCalledWith(
      'wf-plan-1',
      'gate-approved:production_plan',
    );

    const revisionRequest = {
      workflowRunId: 'wf-plan-1',
      gateKey: 'production_plan',
      expectedRowVersion: 4,
      expectedSubjectRevision: 2,
      expectedSubjectHash: 'a'.repeat(64),
      reason: 'Make the second act clearer.',
      actor: 'assistant',
    };
    await expect(
      handlers.get('workflow:requestChanges')?.({}, revisionRequest),
    ).resolves.toMatchObject({ ok: true, code: 'revision_requested' });
    expect(engine.requestChangesPendingGateFromUser).toHaveBeenCalledWith({
      workflowRunId: 'wf-plan-1',
      gateKey: 'production_plan',
      expectedRowVersion: 4,
      expectedSubjectRevision: 2,
      expectedSubjectHash: 'a'.repeat(64),
      reason: 'Make the second act clearer.',
    });

    await expect(handlers.get('workflow:rejectGate')?.({}, revisionRequest)).resolves.toMatchObject(
      { ok: true, code: 'revision_requested' },
    );
    expect(engine.rejectPendingGateFromUser).toHaveBeenCalledWith({
      workflowRunId: 'wf-plan-1',
      gateKey: 'production_plan',
      expectedRowVersion: 4,
      expectedSubjectRevision: 2,
      expectedSubjectHash: 'a'.repeat(64),
      reason: 'Make the second act clearer.',
    });
    expect(engine.pump).toHaveBeenNthCalledWith(1, 'wf-plan-1');
    expect(engine.pump).toHaveBeenNthCalledWith(2, 'wf-plan-1');
    expect(requestCommanderContinuation).toHaveBeenNthCalledWith(
      2,
      'wf-plan-1',
      'gate-changes-requested:production_plan',
    );
    expect(requestCommanderContinuation).toHaveBeenNthCalledWith(
      3,
      'wf-plan-1',
      'gate-rejected:production_plan',
    );

    await expect(
      handlers.get('workflow:listPendingDecisions')?.(
        {},
        { workflowRunId: 'wf-plan-1', canvasId: 'canvas-1' },
      ),
    ).resolves.toEqual([{ id: 'decision-1', workflowRunId: 'wf-plan-1', status: 'pending' }]);
    expect(engine.listPendingDecisions).toHaveBeenCalledWith({
      workflowRunId: 'wf-plan-1',
      canvasId: 'canvas-1',
    });
  });
});
