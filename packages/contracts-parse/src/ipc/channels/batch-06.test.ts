import { describe, expect, it } from 'vitest';
import {
  workflowChannels,
  workflowGetVisualAuditionsChannel,
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
