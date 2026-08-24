import { describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_WIRE_METHODS_V1,
  type Run,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import type {
  MessageSendAcceptanceSeed,
  TargetCommandContext,
  TargetDataAccess,
} from '@lucid-fin/target-storage';
import { createTargetWireUseCaseHandlers } from './handlers.js';

const context: TargetCommandContext = {
  actor: 'user',
  causation: { kind: 'direct_ui', actionId: 'action.handlers.1' },
  correlationId: 'correlation.handlers.1',
};

const seed = { tag: 'seed' } as unknown as MessageSendAcceptanceSeed;

function success<Method extends WireSuccessV1['method']>(
  method: Method,
  requestId: string,
  result: Extract<WireSuccessV1, { method: Method }>['result'],
): Extract<WireSuccessV1, { method: Method }> {
  return { wireVersion: 1, kind: 'success', requestId, method, result } as Extract<
    WireSuccessV1,
    { method: Method }
  >;
}

function fixture() {
  const order: string[] = [];
  const run = {
    id: 'run.handlers.1',
    status: 'accepted',
    publicEventHead: null,
  } as unknown as Run;
  const projectList = vi.fn((request: Extract<WireRequestV1, { method: 'project.list' }>) =>
    success('project.list', request.requestId, { items: [], nextCursor: null }),
  );
  const recordResultDecision = vi.fn(() => ({ kind: 'record' }));
  const undoChoice = vi.fn(() => ({ kind: 'undo' }));
  const sendMessage = vi.fn(() => {
    order.push('persist-message');
    return { result: { acceptedRun: run } };
  });
  const sendFollowup = vi.fn(() => {
    order.push('persist-followup');
    return { kind: 'followup' };
  });
  const control = vi.fn(() => ({ kind: 'control' }));
  const cancel = vi.fn(() => ({ kind: 'cancel' }));
  const getRun = vi.fn(() => {
    order.push('read-run');
    return { result: run };
  });
  const data = {
    canvas: {},
    conversations: { projectList, sendMessage },
    delivery: {},
    globalMedia: {},
    operations: { cancel },
    production: {},
    projectMedia: {},
    projects: { list: projectList },
    overview: { get: vi.fn() },
    runs: { control, get: getRun, sendFollowup },
    userChoices: { recordResultDecision, undoChoice },
  } as unknown as TargetDataAccess;
  const acceptanceSeedFor = vi.fn(async () => {
    order.push('seed');
    return seed;
  });
  const notifyDurableRunWork = vi.fn(() => order.push('notify'));
  const publishPersistedRunHead = vi.fn(() => order.push('publish'));
  const handlers = createTargetWireUseCaseHandlers({
    data,
    interaction: { answer: vi.fn(() => ({ kind: 'interaction' })) } as never,
    confirmation: { respond: vi.fn(() => ({ kind: 'confirmation' })) } as never,
    acceptanceSeedFor,
    pickExportDestination: vi.fn() as never,
    pickMedia: vi.fn() as never,
    notifyDurableRunWork,
    publishPersistedRunHead,
  });
  return {
    acceptanceSeedFor,
    handlers,
    notifyDurableRunWork,
    order,
    projectList,
    publishPersistedRunHead,
    recordResultDecision,
    sendFollowup,
    sendMessage,
    undoChoice,
  };
}

describe('target Wire use-case handlers', () => {
  it('defines exactly one logical handler per canonical method', () => {
    const { handlers } = fixture();
    expect(Object.keys(handlers)).toEqual(Object.keys(PUBLIC_WIRE_METHODS_V1));
    expect(Object.isFrozen(handlers)).toBe(true);
  });

  it('delegates a read-only Project request without a runtime wake-up', async () => {
    const { handlers, projectList, notifyDurableRunWork } = fixture();
    const request = {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.handlers.project-list.1',
      method: 'project.list',
      input: { cursor: null, limit: 20 },
    } as const;

    expect(await Promise.resolve(handlers['project.list'](request, context))).toEqual(
      success('project.list', request.requestId, { items: [], nextCursor: null }),
    );
    expect(projectList).toHaveBeenCalledWith(request);
    expect(notifyDurableRunWork).not.toHaveBeenCalled();
  });

  it('routes decision.record undo separately from result decisions', async () => {
    const { handlers, recordResultDecision, undoChoice } = fixture();
    const undoRequest = {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.handlers.undo.1',
      method: 'decision.record',
      input: { action: 'undo', choiceId: 'choice.handlers.1' },
    } as unknown as Extract<WireRequestV1, { method: 'decision.record' }>;
    await handlers['decision.record'](undoRequest, context);
    expect(undoChoice).toHaveBeenCalledWith(undoRequest, context);
    expect(recordResultDecision).not.toHaveBeenCalled();
  });

  it('persists accepted root and follow-up messages before waking runtime work', async () => {
    const { handlers, acceptanceSeedFor, order, sendFollowup, sendMessage } = fixture();
    const rootRequest = {
      method: 'message.send',
      requestId: 'request.handlers.message.1',
    } as unknown as Extract<WireRequestV1, { method: 'message.send' }>;
    await handlers['message.send'](rootRequest, context);
    expect(order).toEqual(['seed', 'persist-message', 'publish', 'notify']);
    expect(sendMessage).toHaveBeenCalledWith(rootRequest, context, seed);

    order.length = 0;
    const followupRequest = {
      method: 'run.sendFollowup',
      requestId: 'request.handlers.followup.1',
      input: { runId: 'run.handlers.1' },
    } as unknown as Extract<WireRequestV1, { method: 'run.sendFollowup' }>;
    await handlers['run.sendFollowup'](followupRequest, context);
    expect(order).toEqual(['seed', 'persist-followup', 'read-run', 'publish', 'notify']);
    expect(sendFollowup).toHaveBeenCalledWith(followupRequest, context, seed);
    expect(acceptanceSeedFor).toHaveBeenCalledTimes(2);
  });
});
