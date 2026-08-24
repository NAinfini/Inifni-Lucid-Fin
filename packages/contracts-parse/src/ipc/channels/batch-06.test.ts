import { describe, expect, it } from 'vitest';
import {
  taskListChannels,
  taskListCancelMediaChannel,
  taskListGetVisualAuditionsChannel,
  taskListListPendingDecisionsChannel,
  taskListRejectGateChannel,
  taskListRetryMediaChannel,
  taskListRetryMediaEvaluationChannel,
  taskListRequestVisualAuditionChangesChannel,
  taskListRequestChangesChannel,
  taskListSelectVisualCandidateChannel,
  taskListStartMediaChannel,
} from './batch-06.js';

describe('Task List IPC channels', () => {
  it('registers only the renderer-visible Task List surface', () => {
    const names = taskListChannels.map((channel) => channel.channel);
    expect(names).toContain('taskList:getVisualAuditions');
    expect(names).toContain('taskList:selectVisualCandidate');
    expect(names).toContain('taskList:requestVisualAuditionChanges');
    expect(names.some((name) => name.startsWith('workflow:'))).toBe(false);
    expect(names).not.toContain('taskList:start');
    expect(names).not.toContain('taskList:retryTask');

    expect(
      taskListGetVisualAuditionsChannel.schemas.request.parse({ taskListId: 'task-list-1' }),
    ).toEqual({ taskListId: 'task-list-1' });
  });

  it('requires a Commander session for media task creation and mutation', () => {
    const start = { canvasId: 'canvas-1', nodeId: 'node-1', commanderSessionId: 'session-1' };
    expect(taskListStartMediaChannel.schemas.request.parse(start)).toEqual(start);
    expect(taskListCancelMediaChannel.schemas.request.parse(start)).toEqual(start);
    expect(
      taskListRetryMediaChannel.schemas.request.parse({
        ...start,
        providerId: 'provider-1',
      }),
    ).toEqual({ ...start, providerId: 'provider-1' });
    expect(
      taskListRetryMediaEvaluationChannel.schemas.request.parse({
        taskListId: 'task-list-1',
        commanderSessionId: 'session-1',
      }),
    ).toEqual({ taskListId: 'task-list-1', commanderSessionId: 'session-1' });
    expect(() => taskListStartMediaChannel.schemas.request.parse({ canvasId: 'canvas-1', nodeId: 'node-1' })).toThrow();
    expect(() => taskListCancelMediaChannel.schemas.request.parse({ canvasId: 'canvas-1', nodeId: 'node-1' })).toThrow();
    expect(() => taskListRetryMediaEvaluationChannel.schemas.request.parse({ taskListId: 'task-list-1' })).toThrow();
  });

  it('registers strict plan revision and durable decision queries', () => {
    const revision = {
      taskListId: 'task-list-1',
      gateKey: 'visual_constitution' as const,
      expectedRowVersion: 8,
      expectedSubjectRevision: 3,
      expectedSubjectHash: 'b'.repeat(64),
      reason: 'Keep the character silhouette consistent.',
    };
    expect(taskListRequestChangesChannel.schemas.request.parse(revision)).toEqual(revision);
    expect(taskListRejectGateChannel.schemas.request.parse(revision)).toEqual(revision);
    expect(() =>
      taskListRequestChangesChannel.schemas.request.parse({ ...revision, reason: '   ' }),
    ).toThrow();
    expect(() =>
      taskListRejectGateChannel.schemas.request.parse({ ...revision, actor: 'assistant' }),
    ).toThrow();

    expect(
      taskListListPendingDecisionsChannel.schemas.request.parse({ canvasId: 'canvas-1' }),
    ).toEqual({ canvasId: 'canvas-1' });
    expect(() => taskListListPendingDecisionsChannel.schemas.request.parse({})).toThrow();
  });

  it('accepts only exact visual audition CAS fields from the renderer', () => {
    const request = {
      taskListId: 'task-list-1',
      candidateId: 'analog-horror',
      expectedRowVersion: 3,
      expectedAuditionRevision: 7,
      expectedAuditionHash: 'a'.repeat(64),
    };
    expect(taskListSelectVisualCandidateChannel.schemas.request.parse(request)).toEqual(request);
    expect(() =>
      taskListSelectVisualCandidateChannel.schemas.request.parse({
        ...request,
        actor: 'assistant',
      }),
    ).toThrow();
    expect(() =>
      taskListSelectVisualCandidateChannel.schemas.request.parse({
        ...request,
        expectedRowVersion: -1,
      }),
    ).toThrow();
    expect(() =>
      taskListSelectVisualCandidateChannel.schemas.request.parse({
        ...request,
        expectedAuditionHash: 'not-a-sha256',
      }),
    ).toThrow();
  });

  it('accepts only a reasoned CAS request for replacement visual candidates', () => {
    const request = {
      taskListId: 'task-list-1',
      expectedRowVersion: 3,
      expectedAuditionRevision: 7,
      expectedAuditionHash: 'a'.repeat(64),
      reason: 'Use less stylized lighting and stronger character continuity.',
    };
    expect(taskListRequestVisualAuditionChangesChannel.schemas.request.parse(request)).toEqual(
      request,
    );
    expect(() =>
      taskListRequestVisualAuditionChangesChannel.schemas.request.parse({
        ...request,
        reason: '   ',
      }),
    ).toThrow();
    expect(() =>
      taskListRequestVisualAuditionChangesChannel.schemas.request.parse({
        ...request,
        expectedAuditionHash: 'not-a-sha256',
      }),
    ).toThrow();
    expect(() =>
      taskListRequestVisualAuditionChangesChannel.schemas.request.parse({
        ...request,
        actor: 'assistant',
      }),
    ).toThrow();
  });
});
