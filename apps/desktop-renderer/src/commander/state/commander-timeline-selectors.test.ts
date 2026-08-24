import type { TimelineEvent } from '@lucid-fin/contracts';
import { describe, expect, it } from 'vitest';
import type { RootState } from '../../store/index.js';
import { commanderTimelineSlice } from './commander-timeline-slice.js';
import {
  selectActiveRunChecklistSnapshot,
  selectCurrentRunEvents,
  selectLatestRunCapabilityCatalog,
} from './commander-timeline-selectors.js';

const SESSION_ID = 'session-1';

function stateWithTimeline(timeline: ReturnType<typeof commanderTimelineSlice.reducer>): RootState {
  return {
    commander: { activeSessionId: SESSION_ID } as RootState['commander'],
    commanderTimeline: timeline,
  } as RootState;
}

describe('commander timeline selectors', () => {
  it('keeps the current-run event reference stable for unchanged state', () => {
    const initial = commanderTimelineSlice.reducer(undefined, { type: '@@INIT' });
    expect(selectCurrentRunEvents(stateWithTimeline(initial))).toBe(
      selectCurrentRunEvents(stateWithTimeline(initial)),
    );

    const event: TimelineEvent = {
      kind: 'run_start',
      workType: 'agent',
      runId: 'run-1',
      step: 0,
      seq: 0,
      emittedAt: 1,
      intent: 'Create a preview',
      resourceBudget: {},
    };
    const active = commanderTimelineSlice.reducer(
      initial,
      commanderTimelineSlice.actions.appendEvent({ sessionId: SESSION_ID, event }),
    );
    const state = stateWithTimeline(active);

    expect(selectCurrentRunEvents(state)).toBe(selectCurrentRunEvents(state));
    expect(selectCurrentRunEvents(state)).toEqual([event]);
  });

  it('projects the latest runChecklist.manage snapshot from tool results', () => {
    const events: TimelineEvent[] = [
      {
        kind: 'run_start',
        workType: 'agent',
        runId: 'run-1',
        step: 0,
        seq: 0,
        emittedAt: 1,
        intent: 'Create a preview',
        resourceBudget: {},
      },
      {
        kind: 'tool_call',
        runId: 'run-1',
        step: 1,
        seq: 1,
        emittedAt: 2,
        toolCallId: 'checklist-call',
        toolRef: { domain: 'runChecklist', action: 'manage' },
        status: 'started',
        summary: 'Update run checklist',
      },
      {
        kind: 'tool_result',
        runId: 'run-1',
        step: 1,
        seq: 2,
        emittedAt: 3,
        toolCallId: 'checklist-call',
        status: 'succeeded',
        artifacts: [
          {
            kind: 'checklist',
            id: 'checklist-1',
            items: [
              { id: 'item-1', label: 'Plan', status: 'done' },
              { id: 'item-2', label: 'Generate', status: 'in_progress' },
            ],
          },
        ],
        durationMs: 2,
      },
    ];

    const timeline = events.reduce(
      (state, event) =>
        commanderTimelineSlice.reducer(
          state,
          commanderTimelineSlice.actions.appendEvent({ sessionId: SESSION_ID, event }),
        ),
      commanderTimelineSlice.reducer(undefined, { type: '@@INIT' }),
    );

    expect(selectActiveRunChecklistSnapshot(stateWithTimeline(timeline))).toEqual({
      checklistId: 'checklist-1',
      items: [
        { id: 'item-1', label: 'Plan', status: 'done' },
        { id: 'item-2', label: 'Generate', status: 'in_progress' },
      ],
    });
  });

  it('keeps the latest frozen capability catalog visible after the run ends', () => {
    const events: TimelineEvent[] = [
      {
        kind: 'run_start',
        workType: 'agent',
        runId: 'run-1',
        step: 0,
        seq: 0,
        emittedAt: 1,
        intent: 'Inspect the Canvas',
        resourceBudget: {},
      },
      {
        kind: 'catalog_frozen',
        runId: 'run-1',
        step: 0,
        seq: 1,
        emittedAt: 2,
        catalogHash: 'a'.repeat(64),
        tools: [
          {
            name: 'canvas.get',
            description: 'Read a Canvas',
            tier: 1,
            tags: ['read'],
            contexts: ['canvas'],
            inputSchemaHash: 'b'.repeat(64),
          },
        ],
      },
      {
        kind: 'run_end',
        runId: 'run-1',
        step: 1,
        seq: 2,
        emittedAt: 3,
        status: 'completed',
      },
    ];
    const timeline = events.reduce(
      (state, event) =>
        commanderTimelineSlice.reducer(
          state,
          commanderTimelineSlice.actions.appendEvent({ sessionId: SESSION_ID, event }),
        ),
      commanderTimelineSlice.reducer(undefined, { type: '@@INIT' }),
    );

    expect(selectLatestRunCapabilityCatalog(stateWithTimeline(timeline))).toMatchObject({
      runId: 'run-1',
      tools: [{ name: 'canvas.get' }],
    });
  });
});
