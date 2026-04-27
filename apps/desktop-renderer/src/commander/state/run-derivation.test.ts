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
  args: Record<string, unknown>,
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
    args,
  });
}

function toolResult(
  seq: number,
  step: number,
  toolCallId: string,
  result: unknown,
  at = 3000 + seq,
): TimelineEvent {
  return ev({
    kind: 'tool_result',
    runId: RUN,
    step,
    seq,
    emittedAt: at,
    toolCallId,
    result,
    durationMs: 10,
  });
}

function runStart(at = 500): TimelineEvent {
  return ev({ kind: 'run_start', runId: RUN, step: 0, seq: 0, emittedAt: at, intent: 'test' });
}

function runEnd(status: 'completed' | 'failed' | 'cancelled' | 'max_steps', at = 9000, seq = 99): TimelineEvent {
  return ev({ kind: 'run_end', runId: RUN, step: 0, seq, emittedAt: at, status });
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
});

describe('deriveActiveRunView', () => {
  it('coalesces contiguous assistant_text events into one text segment', () => {
    const events = [runStart(), textDelta(1, 1, 'hello '), textDelta(2, 1, 'world')];
    const view = deriveActiveRunView(events, [], []);
    expect(view.streamContent).toBe('hello world');
    const textSegs = view.segments.filter((s) => s.kind === 'text');
    expect(textSegs).toHaveLength(1);
    expect(textSegs[0]).toMatchObject({ kind: 'text', content: 'hello world' });
  });

  it('upserts tool_call args and attaches tool_result', () => {
    const events = [
      runStart(),
      toolCall(1, 1, 'tc-1', { draft: true }),
      toolCall(2, 1, 'tc-1', { draft: false, id: 'node-42' }),
      toolResult(3, 1, 'tc-1', { success: true }),
    ];
    const view = deriveActiveRunView(events, [], []);
    expect(view.toolCalls).toHaveLength(1);
    expect(view.toolCalls[0]).toMatchObject({
      id: 'tc-1',
      arguments: { draft: false, id: 'node-42' },
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
        args: {},
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
        args: {},
      },
    ];
    const view = deriveActiveRunView(events, ['tc-2'], []);
    expect(view.pendingConfirmation).toBeNull();
  });
});

describe('buildFinalizedAssistantMessage', () => {
  it('returns null for an empty run', () => {
    const msg = buildFinalizedAssistantMessage(RUN, 'completed', [runStart(), runEnd('completed')], [], []);
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
      toolResult(2, 1, 'tc-done', { success: true }),
      toolCall(3, 1, 'tc-pending', { y: 2 }),
      // tc-pending only has a synthetic orphan-cleanup result after cancel.
      {
        ...toolResult(4, 1, 'tc-pending', { skipped: true }),
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
    const events = [
      runStart(),
      textDelta(1, 1, 'ok'),
      runEnd('completed'),
    ];
    const msg = buildFinalizedAssistantMessage(RUN, 'completed', events, [], []);
    expect(msg?.runMeta?.cancelled).toBeUndefined();
  });

  it('maps max_steps → status=failed', () => {
    const events = [runStart(), textDelta(1, 1, 'too long'), runEnd('max_steps')];
    const msg = buildFinalizedAssistantMessage(RUN, 'max_steps', events, [], []);
    expect(msg?.runMeta?.status).toBe('failed');
  });

  it('includes segments and toolCalls on the finalized message', () => {
    const events = [
      runStart(),
      textDelta(1, 1, 'plan. '),
      toolCall(2, 1, 'tc-1', { x: 1 }),
      toolResult(3, 1, 'tc-1', { success: true }),
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
