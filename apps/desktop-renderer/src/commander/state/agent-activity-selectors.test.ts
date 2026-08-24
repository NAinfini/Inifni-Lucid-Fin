import type { TimelineEvent } from '@lucid-fin/contracts';
import { describe, expect, it } from 'vitest';

import type { RootState } from '../../store/index.js';
import { commanderTimelineSlice } from './commander-timeline-slice.js';
import {
  selectAgentActivityTreeForSession,
  selectSessionAgentActivitySummary,
} from './commander-timeline-selectors.js';

const SESSION_ID = 'session-activity';

function stateWith(events: readonly TimelineEvent[]): RootState {
  const timeline = events.reduce(
    (state, event) =>
      commanderTimelineSlice.reducer(
        state,
        commanderTimelineSlice.actions.appendEvent({ sessionId: SESSION_ID, event }),
      ),
    commanderTimelineSlice.reducer(undefined, { type: '@@INIT' }),
  );

  return {
    commander: { activeSessionId: SESSION_ID } as RootState['commander'],
    commanderTimeline: timeline,
  } as RootState;
}

describe('agent activity selectors', () => {
  it('projects a stable public run tree without inferring AI labels from intent text', () => {
    const events: TimelineEvent[] = [
      {
        kind: 'run_start',
        runId: 'root-run',
        step: 0,
        seq: 0,
        emittedAt: 100,
        intent: 'This user request must never become a generated run label',
        resourceBudget: {},
        workType: 'agent',
        displayName: 'Production planner',
        objective: 'Build an executable production plan',
      },
      {
        kind: 'tool_call',
        runId: 'root-run',
        step: 1,
        seq: 1,
        emittedAt: 110,
        toolCallId: 'plan-checklist',
        toolRef: { domain: 'runChecklist', action: 'manage' },
        status: 'started',
        summary: 'Update the public plan',
      },
      {
        kind: 'tool_result',
        runId: 'root-run',
        step: 1,
        seq: 2,
        emittedAt: 120,
        toolCallId: 'plan-checklist',
        status: 'succeeded',
        durationMs: 10,
        artifacts: [
          {
            kind: 'checklist',
            id: 'plan',
            items: [
              { id: 'collect', label: 'Collect scene facts', status: 'done' },
              { id: 'specify', label: 'Specify shots', status: 'in_progress' },
            ],
          },
        ],
      },
      {
        kind: 'public_progress',
        runId: 'root-run',
        step: 2,
        seq: 3,
        emittedAt: 125,
        operationId: 'shots',
        status: 'running',
        summary: 'Specify shots 004–008',
      },
      {
        kind: 'run_start',
        runId: 'continuity-run',
        step: 0,
        seq: 0,
        emittedAt: 130,
        intent: 'A child intent must not replace its supplied public label',
        resourceBudget: {},
        workType: 'subagent',
        parentRunId: 'root-run',
        displayName: 'Continuity review',
        objective: 'Check character and prop continuity',
      },
      {
        kind: 'question_prompt',
        runId: 'continuity-run',
        step: 1,
        seq: 1,
        emittedAt: 135,
        questionId: 'continuity-choice',
        prompt: 'Which reference should be authoritative?',
        allowFreeText: true,
      },
      {
        kind: 'run_start',
        runId: 'program-run',
        step: 0,
        seq: 0,
        emittedAt: 140,
        intent: 'program intent',
        resourceBudget: {},
        workType: 'tool_program',
        parentRunId: 'root-run',
        displayName: 'Asset consistency batch',
      },
    ];

    const tree = selectAgentActivityTreeForSession(stateWith(events), SESSION_ID);

    expect(tree).toMatchObject({
      rootRunId: 'root-run',
      orderedRunIds: ['root-run', 'continuity-run', 'program-run'],
      hasActiveDescendant: true,
    });
    expect(tree?.nodesById['root-run']).toMatchObject({
      displayName: 'Production planner',
      objective: 'Build an executable production plan',
      status: 'running',
      childRunIds: ['continuity-run', 'program-run'],
      publicPlan: [
        { id: 'collect', title: 'Collect scene facts', status: 'completed' },
        { id: 'specify', title: 'Specify shots', status: 'running' },
      ],
      currentStep: { id: 'shots', title: 'Specify shots 004–008' },
    });
    expect(tree?.nodesById['continuity-run']).toMatchObject({
      workType: 'subagent',
      status: 'waiting_user',
    });
    expect(tree?.nodesById['program-run']).toMatchObject({
      workType: 'tool_program',
      status: 'running',
    });
    expect(tree?.nodesById['root-run']?.displayName).not.toContain('user request');
  });

  it('uses the same activity summary for an active descendant and clears it at terminal state', () => {
    const base: TimelineEvent[] = [
      {
        kind: 'run_start',
        runId: 'root-run',
        step: 0,
        seq: 0,
        emittedAt: 100,
        intent: 'root',
        resourceBudget: {},
        workType: 'agent',
        displayName: 'Root agent',
      },
      {
        kind: 'run_start',
        runId: 'child-run',
        step: 0,
        seq: 0,
        emittedAt: 110,
        intent: 'child',
        resourceBudget: {},
        workType: 'subagent',
        parentRunId: 'root-run',
        displayName: 'Child agent',
      },
    ];
    const activeState = stateWith(base);

    expect(selectSessionAgentActivitySummary(activeState, SESSION_ID)).toMatchObject({
      activeCount: 2,
      highestPriorityStatus: 'running',
      hasActiveDescendant: true,
    });

    const terminalState = stateWith([
      ...base,
      {
        kind: 'run_end',
        runId: 'child-run',
        step: 1,
        seq: 1,
        emittedAt: 120,
        status: 'completed',
      },
      {
        kind: 'run_end',
        runId: 'root-run',
        step: 1,
        seq: 1,
        emittedAt: 130,
        status: 'completed',
      },
    ]);

    expect(selectSessionAgentActivitySummary(terminalState, SESSION_ID)).toMatchObject({
      activeCount: 0,
      hasActiveDescendant: false,
    });
  });
});
