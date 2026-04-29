import { describe, expect, it } from 'vitest';
import { idlePhase, phaseFromEvent, isActivePhase, type RunPhase } from './run-phase.js';
import type { TimelineEvent } from '@lucid-fin/contracts';

function stampedEvent<K extends string>(
  body: Record<string, unknown> & { kind: K },
): TimelineEvent {
  return {
    runId: 'run-1',
    step: 0,
    seq: 0,
    emittedAt: 1_700_000_000_000,
    ...body,
  } as unknown as TimelineEvent;
}

describe('phaseFromEvent', () => {
  it('transitions idle → model_streaming on an assistant_text event', () => {
    const next = phaseFromEvent(
      idlePhase,
      stampedEvent({
        kind: 'assistant_text',
        content: 'hello',
        isDelta: true,
        step: 1,
        emittedAt: 100,
      }),
    );
    expect(next.kind).toBe('model_streaming');
    if (next.kind === 'model_streaming') {
      expect(next.step).toBe(1);
      expect(next.since).toBe(100);
      expect(next.lastTextDeltaAt).toBe(100);
    }
  });

  it('updates lastTextDeltaAt on subsequent assistant_text deltas without resetting since', () => {
    const first = phaseFromEvent(
      idlePhase,
      stampedEvent({
        kind: 'assistant_text',
        content: 'a',
        isDelta: true,
        step: 1,
        emittedAt: 100,
      }),
    );
    const second = phaseFromEvent(
      first,
      stampedEvent({
        kind: 'assistant_text',
        content: 'b',
        isDelta: true,
        step: 1,
        emittedAt: 250,
      }),
    );
    expect(second.kind).toBe('model_streaming');
    if (second.kind === 'model_streaming' && first.kind === 'model_streaming') {
      expect(second.since).toBe(first.since);
      expect(second.lastTextDeltaAt).toBe(250);
    }
  });

  it('enters tool_running on tool_call and returns to awaiting_model on tool_result', () => {
    const running = phaseFromEvent(
      idlePhase,
      stampedEvent({
        kind: 'tool_call',
        toolCallId: 't1',
        toolRef: { domain: 'canvas', action: 'createNode' },
        args: {},
        step: 2,
        emittedAt: 100,
      }),
    );
    expect(running.kind).toBe('tool_running');
    if (running.kind === 'tool_running') {
      expect(running.tools).toEqual(['t1']);
    }
    const done = phaseFromEvent(
      running,
      stampedEvent({
        kind: 'tool_result',
        toolCallId: 't1',
        result: { success: true },
        durationMs: 100,
        step: 2,
        emittedAt: 200,
      }),
    );
    expect(done.kind).toBe('awaiting_model');
  });

  it('keeps tool_running when multiple tool calls are in flight and only one resolves', () => {
    let p: RunPhase = idlePhase;
    p = phaseFromEvent(
      p,
      stampedEvent({
        kind: 'tool_call',
        toolCallId: 't1',
        toolRef: { domain: 'canvas', action: 'a' },
        args: {},
        step: 2,
        emittedAt: 10,
      }),
    );
    p = phaseFromEvent(
      p,
      stampedEvent({
        kind: 'tool_call',
        toolCallId: 't2',
        toolRef: { domain: 'canvas', action: 'b' },
        args: {},
        step: 2,
        emittedAt: 15,
      }),
    );
    p = phaseFromEvent(
      p,
      stampedEvent({
        kind: 'tool_result',
        toolCallId: 't1',
        result: {},
        durationMs: 10,
        step: 2,
        emittedAt: 20,
      }),
    );
    expect(p.kind).toBe('tool_running');
    if (p.kind === 'tool_running') {
      expect(p.tools).toEqual(['t2']);
    }
  });

  it('enters failed on run_end{status:failed} and done on run_end{status:completed}', () => {
    const failed = phaseFromEvent(idlePhase, stampedEvent({ kind: 'run_end', status: 'failed' }));
    expect(failed.kind).toBe('failed');

    const done = phaseFromEvent(idlePhase, stampedEvent({ kind: 'run_end', status: 'completed' }));
    expect(done.kind).toBe('done');
  });

  it('phase_note is a passthrough — phase is unchanged', () => {
    const p: RunPhase = { kind: 'awaiting_model', step: 1, since: 100 };
    const next = phaseFromEvent(
      p,
      stampedEvent({ kind: 'phase_note', note: 'compacted', params: {} }),
    );
    expect(next).toBe(p);
  });

  it('isActivePhase returns false for idle/done/failed and true otherwise', () => {
    expect(isActivePhase({ kind: 'idle' })).toBe(false);
    expect(isActivePhase({ kind: 'done' })).toBe(false);
    expect(isActivePhase({ kind: 'failed', error: '' })).toBe(false);
    expect(isActivePhase({ kind: 'awaiting_model', step: 0, since: 0 })).toBe(true);
    expect(
      isActivePhase({
        kind: 'model_streaming',
        step: 0,
        since: 0,
        lastTextDeltaAt: null,
      }),
    ).toBe(true);
  });
});
