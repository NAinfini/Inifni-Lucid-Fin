import { describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_WIRE_METHODS_V1,
  type Chat,
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
  const chat = {
    id: 'chat.handlers.1',
    revision: 1,
    messageCount: 1,
    messageHeadSequence: 1,
  } as unknown as Chat;
  const projectList = vi.fn((request: Extract<WireRequestV1, { method: 'project.list' }>) =>
    success('project.list', request.requestId, { items: [], nextCursor: null }),
  );
  const recordResultDecision = vi.fn(() => ({ kind: 'record' }));
  const undoChoice = vi.fn(() => ({ kind: 'undo' }));
  const sendMessage = vi.fn(() => {
    order.push('persist-message');
    return { result: { chat, acceptedRun: run } };
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
  const historyQuery = vi.fn(() => ({ items: [], nextCursor: null }));
  const projectCapabilitiesGet = vi.fn(() => ({
    projectId: 'project.handlers.1',
    providers: [],
    skills: [],
  }));
  const pluginQuery = vi.fn((request: Extract<WireRequestV1, { method: 'plugin.query' }>) =>
    success('plugin.query', request.requestId, { packages: [] }),
  );
  const pluginApply = vi.fn(() => ({ kind: 'plugin-apply' }));
  const mediaPreviewIssue = vi.fn(() => ({
    url: 'lucid-target-media://preview/cap_handlers_preview_1234567890',
    expiresAt: '2026-08-25T12:00:00.000Z',
    kind: 'image' as const,
    mimeType: 'image/png',
  }));
  const resultsQuery = vi.fn(() => ({ items: [], nextCursor: null }));
  const data = {
    canvas: {},
    conversations: { projectList, sendMessage },
    delivery: {},
    globalMedia: {},
    history: { query: historyQuery },
    operations: { cancel },
    plugins: { apply: pluginApply, query: pluginQuery },
    production: {},
    projectCapabilities: { get: projectCapabilitiesGet },
    projectMedia: {},
    projects: { list: projectList },
    results: { query: resultsQuery },
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
    mediaPreview: { issue: mediaPreviewIssue } as never,
    notifyDurableRunWork,
    publishPersistedRunHead,
  });
  return {
    acceptanceSeedFor,
    chat,
    handlers,
    historyQuery,
    mediaPreviewIssue,
    notifyDurableRunWork,
    order,
    pluginApply,
    pluginQuery,
    projectCapabilitiesGet,
    projectList,
    publishPersistedRunHead,
    recordResultDecision,
    resultsQuery,
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

  it('delegates project-scoped Result and History reads without a runtime wake-up', async () => {
    const { handlers, historyQuery, notifyDurableRunWork, resultsQuery } = fixture();
    const resultRequest = {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.handlers.result-query.1',
      method: 'result.query',
      input: {
        projectId: 'project.handlers.1',
        query: {
          resultIds: [],
          requestIds: [],
          targetRefs: [],
          include: [],
          page: { cursor: null, limit: 20 },
        },
      },
    } as const;
    const historyRequest = {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.handlers.history-query.1',
      method: 'history.query',
      input: {
        projectId: 'project.handlers.1',
        order: 'reverse_chronological',
        query: {
          sources: [],
          eventTypes: [],
          subjects: [],
          actors: [],
          time: { from: null, to: null },
          page: { cursor: null, limit: 20 },
        },
      },
    } as const;

    expect(handlers['result.query'](resultRequest, context)).toEqual(
      success('result.query', resultRequest.requestId, { items: [], nextCursor: null }),
    );
    expect(handlers['history.query'](historyRequest, context)).toEqual(
      success('history.query', historyRequest.requestId, { items: [], nextCursor: null }),
    );
    expect(resultsQuery).toHaveBeenCalledWith(
      resultRequest.input.projectId,
      resultRequest.input.query,
    );
    expect(historyQuery).toHaveBeenCalledWith(
      historyRequest.input.projectId,
      historyRequest.input.query,
      historyRequest.input.order,
    );
    expect(notifyDurableRunWork).not.toHaveBeenCalled();
  });

  it('issues media previews through the session capability gateway without a runtime wake-up', () => {
    const { handlers, mediaPreviewIssue, notifyDurableRunWork } = fixture();
    const request = {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.handlers.media-preview.1',
      method: 'media.preview.issue',
      input: {
        projectId: 'project.handlers.1',
        source: {
          kind: 'project_media_ref',
          ref: {
            authority: 'project_media_ref',
            id: 'media.handlers.1',
            revision: 0,
            contentHash: 'a'.repeat(64),
          },
        },
      },
    } as const;

    expect(handlers['media.preview.issue'](request, context)).toEqual(
      success('media.preview.issue', request.requestId, {
        url: 'lucid-target-media://preview/cap_handlers_preview_1234567890',
        expiresAt: '2026-08-25T12:00:00.000Z',
        kind: 'image',
        mimeType: 'image/png',
      }),
    );
    expect(mediaPreviewIssue).toHaveBeenCalledWith(request.input);
    expect(notifyDurableRunWork).not.toHaveBeenCalled();
  });

  it('delegates the project capability catalog without a runtime wake-up', async () => {
    const { handlers, notifyDurableRunWork, projectCapabilitiesGet } = fixture();
    const request = {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.handlers.project-capabilities.1',
      method: 'project.capabilities.get',
      input: { projectId: 'project.handlers.1' },
    } as const;

    expect(await Promise.resolve(handlers['project.capabilities.get'](request, context))).toEqual(
      success('project.capabilities.get', request.requestId, {
        projectId: 'project.handlers.1',
        providers: [],
        skills: [],
      }),
    );
    expect(projectCapabilitiesGet).toHaveBeenCalledWith(request.input.projectId);
    expect(notifyDurableRunWork).not.toHaveBeenCalled();
  });

  it('delegates trusted Plugin package reads and mutations without waking active Runs', async () => {
    const { handlers, notifyDurableRunWork, pluginApply, pluginQuery } = fixture();
    const queryRequest = {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.handlers.plugin-query.1',
      method: 'plugin.query',
      input: {},
    } as const;
    const applyRequest = {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.handlers.plugin-install.1',
      method: 'plugin.apply',
      input: {
        action: 'install',
        packageId: 'plugin.storyboard',
        version: '1.0.0',
        manifestHash: 'a'.repeat(64),
        expectedInstallationRevision: null,
      },
    } as const;

    expect(handlers['plugin.query'](queryRequest, context)).toEqual(
      success('plugin.query', queryRequest.requestId, { packages: [] }),
    );
    expect(handlers['plugin.apply'](applyRequest, context)).toEqual({ kind: 'plugin-apply' });
    expect(pluginQuery).toHaveBeenCalledWith(queryRequest);
    expect(pluginApply).toHaveBeenCalledWith(applyRequest, context);
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
    const { handlers, acceptanceSeedFor, chat, order, sendFollowup, sendMessage } = fixture();
    const rootRequest = {
      method: 'message.send',
      requestId: 'request.handlers.message.1',
    } as unknown as Extract<WireRequestV1, { method: 'message.send' }>;
    const rootResponse = await handlers['message.send'](rootRequest, context);
    expect(order).toEqual(['seed', 'persist-message', 'publish', 'notify']);
    expect(sendMessage).toHaveBeenCalledWith(rootRequest, context, seed);
    expect(rootResponse).toMatchObject({ result: { chat } });

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
