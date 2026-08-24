import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@lucid-fin/contracts';

import {
  buildFinalizedAssistantMessage,
  deriveActiveRunView,
  mapTerminalKindToStatus,
} from './run-derivation.js';

const RUN = 'run-1';

function ev<T extends TimelineEvent>(e: T): T {
  return e;
}

function textDelta(seq: number, step: number, content: string, at = 1000 + seq): TimelineEvent {
  return ev({
    kind: 'assistant_text',
    runId: RUN,
    step,
    seq,
    emittedAt: at,
    content,
    isDelta: true,
  });
}

function toolCall(
  seq: number,
  step: number,
  toolCallId: string,
  details: Record<string, string | number | boolean | null>,
  at = 2000 + seq,
): TimelineEvent {
  return ev({
    kind: 'tool_call',
    runId: RUN,
    step,
    seq,
    emittedAt: at,
    toolCallId,
    toolRef: { domain: 'canvas', action: 'addNode' },
    status: 'started',
    summary: 'Add a Canvas node',
    details,
  });
}

function toolResult(
  seq: number,
  step: number,
  toolCallId: string,
  artifactId: string,
  at = 3000 + seq,
): TimelineEvent {
  return ev({
    kind: 'tool_result',
    runId: RUN,
    step,
    seq,
    emittedAt: at,
    toolCallId,
    status: 'succeeded',
    artifacts: [{ kind: 'canvas_node', id: artifactId }],
    durationMs: 10,
  });
}

function runStart(at = 500): TimelineEvent {
  return ev({
    kind: 'run_start',
    workType: 'agent',
    runId: RUN,
    step: 0,
    seq: 0,
    emittedAt: at,
    intent: 'test',
    resourceBudget: {},
  });
}

function runEnd(
  status: 'completed' | 'failed' | 'cancelled' | 'max_steps' | 'blocked',
  at = 9000,
  seq = 99,
): TimelineEvent {
  return status === 'blocked'
    ? ev({
        kind: 'run_end',
        runId: RUN,
        step: 0,
        seq,
        emittedAt: at,
        status,
        blocker: { kind: 'resource_budget', metric: 'cost', reason: 'unavailable' },
      })
    : ev({ kind: 'run_end', runId: RUN, step: 0, seq, emittedAt: at, status });
}

function cancelled(partialContent: string | undefined, at = 8500, seq = 98): TimelineEvent {
  return ev({
    kind: 'cancelled',
    runId: RUN,
    step: 0,
    seq,
    emittedAt: at,
    reason: 'user',
    completedToolCalls: 0,
    pendingToolCalls: 0,
    partialContent,
  });
}

describe('mapTerminalKindToStatus', () => {
  it('maps completed → completed with no errorText', () => {
    expect(mapTerminalKindToStatus('completed')).toEqual({ status: 'completed' });
  });

  it('maps failed → failed with no errorText', () => {
    expect(mapTerminalKindToStatus('failed')).toEqual({ status: 'failed' });
  });

  it('maps cancelled → failed with partial content as errorText', () => {
    expect(mapTerminalKindToStatus('cancelled', 'hi')).toEqual({
      status: 'failed',
      errorText: 'hi',
    });
  });

  it('maps cancelled → failed with default text when no partial content', () => {
    expect(mapTerminalKindToStatus('cancelled')).toEqual({
      status: 'failed',
      errorText: 'Run cancelled',
    });
  });

  it('maps max_steps → failed with "Reached max steps" errorText', () => {
    expect(mapTerminalKindToStatus('max_steps')).toEqual({
      status: 'failed',
      errorText: 'Reached max steps',
    });
  });

  it('maps blocked → blocked without inventing an error message', () => {
    expect(mapTerminalKindToStatus('blocked')).toEqual({ status: 'blocked' });
  });
});

describe('deriveActiveRunView', () => {
  it('keeps only the latest cumulative resource state', () => {
    const first: TimelineEvent = {
      kind: 'resource_state',
      schemaVersion: 1,
      cause: { kind: 'initialized' },
      usage: {
        tokens: { knowledge: 'known', value: 0 },
        toolCalls: 0,
        wallTimeMs: 0,
        costUsd: { knowledge: 'known', value: 0 },
      },
      remaining: {
        tokens: { state: 'known', value: 100 },
        toolCalls: { state: 'unlimited' },
        wallTimeMs: { state: 'unlimited' },
        costUsd: { state: 'unknown' },
      },
      clock: { state: 'active', activeMs: 0, changedAt: 1 },
      runId: RUN,
      step: 0,
      seq: 1,
      emittedAt: 1,
    };
    const settled: TimelineEvent = {
      ...first,
      cause: { kind: 'settled', operationId: 'model:1:attempt:0', source: 'model' },
      usage: { ...first.usage, tokens: { knowledge: 'known', value: 25 }, toolCalls: 2 },
      remaining: { ...first.remaining, tokens: { state: 'known', value: 75 } },
      seq: 2,
      emittedAt: 2,
    };

    const view = deriveActiveRunView([runStart(), first, settled], [], []);
    expect(view.segments.filter((segment) => segment.kind === 'resource_state')).toEqual([
      expect.objectContaining({ usage: expect.objectContaining({ toolCalls: 2 }) }),
    ]);
  });
  it('coalesces contiguous assistant_text events into one text segment', () => {
    const events = [runStart(), textDelta(1, 1, 'hello '), textDelta(2, 1, 'world')];
    const view = deriveActiveRunView(events, [], []);
    expect(view.streamContent).toBe('hello world');
    const textSegs = view.segments.filter((s) => s.kind === 'text');
    expect(textSegs).toHaveLength(1);
    expect(textSegs[0]).toMatchObject({ kind: 'text', content: 'hello world' });
  });

  it('projects only the successful retry attempt while retaining completed tools', () => {
    const events: TimelineEvent[] = [
      runStart(),
      textDelta(1, 1, 'abandoned text'),
      {
        kind: 'public_progress',
        runId: RUN,
        step: 1,
        seq: 2,
        emittedAt: 1002,
        operationId: 'model:1',
        status: 'running',
      },
      toolCall(3, 1, 'completed-tool', { keep: true }),
      toolResult(4, 1, 'completed-tool', 'node-kept'),
      toolCall(5, 1, 'abandoned-tool', { discard: true }),
      {
        kind: 'phase_note',
        runId: RUN,
        step: 1,
        seq: 6,
        emittedAt: 1006,
        note: 'llm_retry',
        params: { attempt: 2 },
      },
      textDelta(7, 1, 'partial retry text'),
      {
        kind: 'assistant_text',
        runId: RUN,
        step: 1,
        seq: 8,
        emittedAt: 1008,
        content: 'successful retry',
        isDelta: false,
      },
      {
        kind: 'public_progress',
        runId: RUN,
        step: 1,
        seq: 9,
        emittedAt: 1009,
        operationId: 'model:1-retry',
        status: 'running',
        summary: 'Checking the revised request',
      },
      runEnd('completed', 1100, 11),
    ];

    const view = deriveActiveRunView(events, [], []);
    const finalized = buildFinalizedAssistantMessage(RUN, 'completed', events, [], []);

    expect(view.streamContent).toBe('successful retry');
    expect(view.segments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'phase_note', note: 'llm_retry' }),
        expect.objectContaining({ kind: 'text', content: 'successful retry' }),
        expect.objectContaining({
          kind: 'progress',
          summary: 'Checking the revised request',
        }),
      ]),
    );
    expect(view.segments).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'text', content: expect.stringContaining('abandoned') }),
        expect.objectContaining({
          kind: 'progress',
          operationId: 'model:1',
        }),
      ]),
    );
    expect(view.toolCalls.map((call) => call.id)).toEqual(['completed-tool']);
    expect(finalized?.content).toBe('successful retry');
  });

  it('upserts public tool metadata and attaches public artifacts', () => {
    const events = [
      runStart(),
      toolCall(1, 1, 'tc-1', { draft: true }),
      toolCall(2, 1, 'tc-1', { draft: false, id: 'node-42' }),
      toolResult(3, 1, 'tc-1', 'node-42'),
    ];
    const view = deriveActiveRunView(events, [], []);
    expect(view.toolCalls).toHaveLength(1);
    expect(view.toolCalls[0]).toMatchObject({
      id: 'tc-1',
      details: { draft: false, id: 'node-42' },
      artifacts: [{ kind: 'canvas_node', id: 'node-42' }],
      status: 'done',
    });
  });

  it('emits a step_marker when the step changes', () => {
    const events = [runStart(), textDelta(1, 1, 'a'), textDelta(2, 2, 'b')];
    const view = deriveActiveRunView(events, [], []);
    const stepMarkers = view.segments.filter((s) => s.kind === 'step_marker');
    expect(stepMarkers).toHaveLength(2);
  });

  it('surfaces a pendingConfirmation when tool_confirm_prompt not locally resolved', () => {
    const events: TimelineEvent[] = [
      runStart(),
      {
        kind: 'tool_confirm_prompt',
        runId: RUN,
        step: 1,
        seq: 1,
        emittedAt: 1500,
        toolCallId: 'tc-2',
        toolRef: { domain: 'canvas', action: 'deleteNode' },
        tier: 1,
        status: 'awaiting_confirmation',
        summary: 'Delete the selected node',
      },
    ];
    const view = deriveActiveRunView(events, [], []);
    expect(view.pendingConfirmation).toMatchObject({ toolCallId: 'tc-2', tier: 1 });
  });

  it('treats locally-resolved confirmations as closed', () => {
    const events: TimelineEvent[] = [
      runStart(),
      {
        kind: 'tool_confirm_prompt',
        runId: RUN,
        step: 1,
        seq: 1,
        emittedAt: 1500,
        toolCallId: 'tc-2',
        toolRef: { domain: 'canvas', action: 'deleteNode' },
        tier: 1,
        status: 'awaiting_confirmation',
      },
    ];
    const view = deriveActiveRunView(events, ['tc-2'], []);
    expect(view.pendingConfirmation).toBeNull();
  });

  it('preserves question option descriptions and the free-text policy', () => {
    const events: TimelineEvent[] = [
      runStart(),
      {
        kind: 'question_prompt',
        runId: RUN,
        step: 1,
        seq: 1,
        emittedAt: 1500,
        questionId: 'question-1',
        prompt: 'Choose a visual direction',
        options: [{ id: 'opt-0', label: 'Gothic', description: 'Candlelit stone and deep shadow' }],
        allowFreeText: false,
      },
    ];

    const view = deriveActiveRunView(events, [], []);

    expect(view.pendingQuestion).toEqual({
      toolCallId: 'question-1',
      question: 'Choose a visual direction',
      options: [{ label: 'Gothic', description: 'Candlelit stone and deep shadow' }],
      allowFreeText: false,
    });
  });
});

describe('buildFinalizedAssistantMessage', () => {
  it('returns null for an empty run', () => {
    const msg = buildFinalizedAssistantMessage(
      RUN,
      'completed',
      [runStart(), runEnd('completed')],
      [],
      [],
    );
    expect(msg).toBeNull();
  });

  it('produces a deterministic id "assistant-run-<runId>"', () => {
    const events = [runStart(), textDelta(1, 1, 'ok'), runEnd('completed')];
    const msg = buildFinalizedAssistantMessage(RUN, 'completed', events, [], []);
    expect(msg?.id).toBe('assistant-run-' + RUN);
  });

  it('maps completed → runMeta.status=completed, no errorText in summary', () => {
    const events = [runStart(), textDelta(1, 1, 'done'), runEnd('completed')];
    const msg = buildFinalizedAssistantMessage(RUN, 'completed', events, [], []);
    expect(msg?.runMeta?.status).toBe('completed');
    expect(msg?.runMeta?.summary.excerpt).toBe('done');
  });

  it('maps failed → status=failed', () => {
    const events = [runStart(), textDelta(1, 1, 'err'), runEnd('failed')];
    const msg = buildFinalizedAssistantMessage(RUN, 'failed', events, [], []);
    expect(msg?.runMeta?.status).toBe('failed');
  });

  it('maps cancelled → status=failed with partialContent as errorText', () => {
    const events = [
      runStart(),
      textDelta(1, 1, 'partial'),
      cancelled('stopped mid-turn'),
      runEnd('cancelled'),
    ];
    const msg = buildFinalizedAssistantMessage(RUN, 'cancelled', events, [], []);
    expect(msg?.runMeta?.status).toBe('failed');
    // When content is present, excerpt comes from content, not errorText.
    expect(msg?.runMeta?.summary.excerpt).toBe('partial');
  });

  it('populates runMeta.cancelled on cancel with accurate completed/pending counts', () => {
    const events = [
      runStart(),
      toolCall(1, 1, 'tc-done', { x: 1 }),
      toolResult(2, 1, 'tc-done', 'node-done'),
      toolCall(3, 1, 'tc-pending', { y: 2 }),
      // tc-pending only has a synthetic orphan-cleanup result after cancel.
      {
        ...toolResult(4, 1, 'tc-pending', 'node-pending'),
        status: 'skipped',
        synthetic: true,
      } as TimelineEvent,
      cancelled('halfway', 5000, 10),
      runEnd('cancelled', 5100, 11),
    ];
    const msg = buildFinalizedAssistantMessage(RUN, 'cancelled', events, [], []);
    expect(msg?.runMeta?.cancelled).toBeDefined();
    expect(msg?.runMeta?.cancelled?.reason).toBe('user');
    expect(msg?.runMeta?.cancelled?.partialContent).toBe('halfway');
    expect(msg?.runMeta?.cancelled?.completedToolCalls).toBe(1);
    expect(msg?.runMeta?.cancelled?.pendingToolCalls).toBe(1);
  });

  it('leaves runMeta.cancelled undefined on a normal completed run', () => {
    const events = [runStart(), textDelta(1, 1, 'ok'), runEnd('completed')];
    const msg = buildFinalizedAssistantMessage(RUN, 'completed', events, [], []);
    expect(msg?.runMeta?.cancelled).toBeUndefined();
  });

  it('maps max_steps → status=failed', () => {
    const events = [runStart(), textDelta(1, 1, 'too long'), runEnd('max_steps')];
    const msg = buildFinalizedAssistantMessage(RUN, 'max_steps', events, [], []);
    expect(msg?.runMeta?.status).toBe('failed');
  });

  it('persists a typed blocker when a resource boundary stops the run', () => {
    const events = [runStart(), runEnd('blocked')];
    const msg = buildFinalizedAssistantMessage(RUN, 'blocked', events, [], []);

    expect(msg?.runMeta).toMatchObject({
      status: 'blocked',
      blocker: { kind: 'resource_budget', metric: 'cost', reason: 'unavailable' },
    });
  });

  it('includes segments and toolCalls on the finalized message', () => {
    const events = [
      runStart(),
      textDelta(1, 1, 'plan. '),
      toolCall(2, 1, 'tc-1', { x: 1 }),
      toolResult(3, 1, 'tc-1', 'node-1'),
      textDelta(4, 1, 'done.'),
      runEnd('completed'),
    ];
    const msg = buildFinalizedAssistantMessage(RUN, 'completed', events, [], []);
    expect(msg?.segments?.length).toBeGreaterThan(0);
    expect(msg?.toolCalls?.length).toBe(1);
    expect(msg?.toolCalls?.[0]).toMatchObject({ id: 'tc-1', status: 'done' });
  });

  it('includes exitDecision when run_end carries one', () => {
    const events: TimelineEvent[] = [
      runStart(),
      textDelta(1, 1, 'blocked'),
      {
        kind: 'run_end',
        runId: RUN,
        step: 0,
        seq: 99,
        emittedAt: 9000,
        status: 'completed',
        exitDecision: {
          outcome: 'blocked_waiting_user',
          contractId: 'c-1',
          blocker: 'needs_info',
        },
      },
    ];
    const msg = buildFinalizedAssistantMessage(RUN, 'completed', events, [], []);
    expect(msg?.runMeta?.exitDecision).toEqual({
      outcome: 'blocked_waiting_user',
      contractId: 'c-1',
      blockerKind: 'needs_info',
    });
  });

  it('uses the terminal event emittedAt as completedAt', () => {
    const events = [runStart(), textDelta(1, 1, 'x'), runEnd('completed', 7777)];
    const msg = buildFinalizedAssistantMessage(RUN, 'completed', events, [], []);
    expect(msg?.runMeta?.completedAt).toBe(7777);
    expect(msg?.timestamp).toBe(7777);
  });

  it('produces a failed message with errorText when only cancelled partial content is present', () => {
    const events = [runStart(), cancelled('partial only'), runEnd('cancelled')];
    const msg = buildFinalizedAssistantMessage(RUN, 'cancelled', events, [], []);
    expect(msg?.runMeta?.status).toBe('failed');
    expect(msg?.runMeta?.summary.excerpt).toBe('partial only');
  });
});
