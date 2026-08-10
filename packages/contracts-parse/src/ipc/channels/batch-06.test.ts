import { describe, expect, it } from 'vitest';
import {
  workflowChannels,
  workflowGetVisualAuditionsChannel,
  workflowListPendingDecisionsChannel,
  workflowRejectGateChannel,
  workflowRequestChangesChannel,
  workflowSelectVisualCandidateChannel,
} from './batch-06.js';

describe('workflow visual IPC channels', () => {
  it('registers the audition query and strict host selection channels', () => {
    expect(workflowChannels.map((channel) => channel.channel)).toContain(
      'workflow:getVisualAuditions',
    );
    expect(workflowChannels.map((channel) => channel.channel)).toContain(
      'workflow:selectVisualCandidate',
    );
    expect(
      workflowGetVisualAuditionsChannel.schemas.request.parse({ workflowRunId: 'workflow-1' }),
    ).toEqual({ workflowRunId: 'workflow-1' });
  });

  it('registers strict gate-revision and durable decision query channels', () => {
    const channels = workflowChannels.map((channel) => channel.channel);
    expect(channels).toContain('workflow:requestChanges');
    expect(channels).toContain('workflow:rejectGate');
    expect(channels).toContain('workflow:listPendingDecisions');

    const revision = {
      workflowRunId: 'workflow-1',
      gateKey: 'visual_constitution' as const,
      expectedRowVersion: 8,
      expectedSubjectRevision: 3,
      expectedSubjectHash: 'b'.repeat(64),
      reason: 'Keep the character silhouette consistent.',
    };
    expect(workflowRequestChangesChannel.schemas.request.parse(revision)).toEqual(revision);
    expect(workflowRejectGateChannel.schemas.request.parse(revision)).toEqual(revision);
    expect(() =>
      workflowRequestChangesChannel.schemas.request.parse({ ...revision, reason: '   ' }),
    ).toThrow();
    expect(() =>
      workflowRejectGateChannel.schemas.request.parse({ ...revision, actor: 'assistant' }),
    ).toThrow();

    expect(
      workflowListPendingDecisionsChannel.schemas.request.parse({ canvasId: 'canvas-1' }),
    ).toEqual({ canvasId: 'canvas-1' });
    expect(() => workflowListPendingDecisionsChannel.schemas.request.parse({})).toThrow();
  });

  it('accepts only the exact visual audition CAS fields from the renderer', () => {
    const request = {
      workflowRunId: 'workflow-1',
      candidateId: 'analog-horror',
      expectedRowVersion: 3,
      expectedAuditionRevision: 7,
      expectedAuditionHash: 'a'.repeat(64),
    };
    expect(workflowSelectVisualCandidateChannel.schemas.request.parse(request)).toEqual(request);
    expect(() =>
      workflowSelectVisualCandidateChannel.schemas.request.parse({
        ...request,
        actor: 'assistant',
      }),
    ).toThrow();
    expect(() =>
      workflowSelectVisualCandidateChannel.schemas.request.parse({
        ...request,
        expectedRowVersion: -1,
      }),
    ).toThrow();
    expect(() =>
      workflowSelectVisualCandidateChannel.schemas.request.parse({
        ...request,
        expectedAuditionHash: 'not-a-sha256',
      }),
    ).toThrow();
  });
});
