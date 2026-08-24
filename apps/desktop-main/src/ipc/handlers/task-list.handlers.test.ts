import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTaskListHandlers } from './task-list.handlers.js';

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../logger.js', () => ({ default: logger }));

describe('registerTaskListHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new Map();
  });

  function register(engine: Record<string, unknown>, request = vi.fn()) {
    const normalizedEngine = {
      ...engine,
      listSummaries: engine.listSummaries ?? engine.list,
      getSummary: engine.getSummary ?? engine.get,
    };
    registerTaskListHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      normalizedEngine as never,
      { requestCommanderContinuation: request },
    );
    return request;
  }

  it('registers only the canonical renderer-visible Task List surface', async () => {
    const engine = {
      list: vi.fn(() => [{ id: 'task-list-1' }]),
      get: vi.fn(() => ({ id: 'task-list-1' })),
      getTasks: vi.fn(() => [{ id: 'task-1' }]),
      getPendingApprovalContext: vi.fn(() => undefined),
      getVisualAuditionContext: vi.fn(() => undefined),
      getDeliveryContext: vi.fn(() => undefined),
      selectVisualConstitutionCandidateFromUser: vi.fn(),
      requestVisualAuditionChangesFromUser: vi.fn(),
      approvePendingGateFromUser: vi.fn(),
      requestChangesPendingGateFromUser: vi.fn(),
      rejectPendingGateFromUser: vi.fn(),
      listPendingDecisions: vi.fn(() => []),
    };
    register(engine);

    expect([...handlers.keys()].sort()).toEqual(
      [
        'taskList:list',
        'taskList:get',
        'taskList:getTasks',
        'taskList:startMedia',
        'taskList:cancelMedia',
        'taskList:retryMediaEvaluation',
        'taskList:retryMedia',
        'promptAssembly:get',
        'taskList:getPendingApproval',
        'taskList:getVisualAuditions',
        'taskList:getDelivery',
        'taskList:selectVisualCandidate',
        'taskList:requestVisualAuditionChanges',
        'taskList:approveGate',
        'taskList:requestChanges',
        'taskList:rejectGate',
        'taskList:listPendingDecisions',
      ].sort(),
    );
    await expect(
      handlers.get('taskList:getTasks')?.({}, { taskListId: 'task-list-1' }),
    ).resolves.toEqual([{ id: 'task-1' }]);
  });

  it('fails loudly when a Task List is missing', async () => {
    register({
      list: vi.fn(),
      get: vi.fn(() => undefined),
      getTasks: vi.fn(),
      getPendingApprovalContext: vi.fn(() => undefined),
      getVisualAuditionContext: vi.fn(() => undefined),
      getDeliveryContext: vi.fn(() => undefined),
      selectVisualConstitutionCandidateFromUser: vi.fn(),
      requestVisualAuditionChangesFromUser: vi.fn(),
      approvePendingGateFromUser: vi.fn(),
      requestChangesPendingGateFromUser: vi.fn(),
      rejectPendingGateFromUser: vi.fn(),
      listPendingDecisions: vi.fn(),
    });

    await expect(handlers.get('taskList:get')?.({}, { id: 'missing' })).rejects.toThrow(
      'Task list "missing" not found',
    );
    expect(logger.error).toHaveBeenCalledWith('Task list not found', {
      category: 'task-list',
      taskListId: 'missing',
    });
  });

  it('continues Commander after a successful human gate action', async () => {
    const taskList = { id: 'task-list-1' };
    const engine = {
      list: vi.fn(),
      get: vi.fn(),
      getTasks: vi.fn(),
      getPendingApprovalContext: vi.fn(),
      getVisualAuditionContext: vi.fn(),
      getDeliveryContext: vi.fn(),
      selectVisualConstitutionCandidateFromUser: vi.fn(),
      requestVisualAuditionChangesFromUser: vi.fn(),
      approvePendingGateFromUser: vi.fn(() => ({ ok: true, code: 'approved', taskList })),
      waitForAutoPump: vi.fn(async () => undefined),
      requestChangesPendingGateFromUser: vi.fn(),
      rejectPendingGateFromUser: vi.fn(),
      listPendingDecisions: vi.fn(),
    };
    const request = register(engine);

    await handlers.get('taskList:approveGate')?.(
      {},
      {
        taskListId: taskList.id,
        gateKey: 'production_plan',
        expectedRowVersion: 3,
        expectedSubjectRevision: 1,
        expectedSubjectHash: 'a'.repeat(64),
      },
    );

    expect(engine.waitForAutoPump).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(taskList.id, 'gate-approved:production_plan');
  });

  it('continues Commander after recording a CAS-protected visual audition replacement', async () => {
    const taskList = { id: 'task-list-1', rowVersion: 8 };
    const requestVisualAuditionChangesFromUser = vi.fn(() => ({ taskList }));
    const engine = {
      list: vi.fn(),
      get: vi.fn(),
      getTasks: vi.fn(),
      getPendingApprovalContext: vi.fn(),
      getVisualAuditionContext: vi.fn(),
      getDeliveryContext: vi.fn(),
      selectVisualConstitutionCandidateFromUser: vi.fn(),
      requestVisualAuditionChangesFromUser,
      approvePendingGateFromUser: vi.fn(),
      requestChangesPendingGateFromUser: vi.fn(),
      rejectPendingGateFromUser: vi.fn(),
      listPendingDecisions: vi.fn(),
    };
    const request = register(engine);
    const input = {
      taskListId: taskList.id,
      expectedRowVersion: 7,
      expectedAuditionRevision: 4,
      expectedAuditionHash: 'a'.repeat(64),
      reason: 'Generate a calmer, warmer candidate set.',
    };

    await handlers.get('taskList:requestVisualAuditionChanges')?.({}, input);

    expect(requestVisualAuditionChangesFromUser).toHaveBeenCalledWith(input);
    expect(request).toHaveBeenCalledWith(taskList.id, 'visual-audition-changes-requested');
  });
});
