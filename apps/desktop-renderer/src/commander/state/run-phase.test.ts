import { describe, expect, it } from 'vitest';
import { idlePhase, phaseFromEvent, isActivePhase, type RunPhase } from './run-phase.js';
import type { CommanderStreamEvent } from '../transport/CommanderTransport.js';

function stampedEvent<K extends string>(body: Record<string, unknown> & { kind: K }): CommanderStreamEvent {
  return {
    runId: 'run-1',
    step: 0,
    emittedAt: 1_700_000_000_000,
    ...body,
  } as unknown as CommanderStreamEvent;
}

describe('phaseFromEvent', () => {
  it('transitions idle → model_streaming on a chunk event', () => {
    const next = phaseFromEvent(
      idlePhase,
      stampedEvent({ kind: 'chunk', content: 'hello', step: 1, emittedAt: 100 }),
    );
    expect(next.kind).toBe('model_streaming');
    if (next.kind === 'model_streaming') {
      expect(next.step).toBe(1);
      expect(next.since).toBe(100);
      expect(next.lastTextDeltaAt).toBe(100);
    }
  });

  it('updates lastTextDeltaAt on subsequent chunks without resetting since', () => {
    const first = phaseFromEvent(
      idlePhase,
      stampedEvent({ kind: 'chunk', content: 'a', step: 1, emittedAt: 100 }),
    );
    const second = phaseFromEvent(
      first,
      stampedEvent({ kind: 'chunk', content: 'b', step: 1, emittedAt: 250 }),
    );
    expect(second.kind).toBe('model_streaming');
    if (second.kind === 'model_streaming' && first.kind === 'model_streaming') {
      expect(second.since).toBe(first.since);
      expect(second.lastTextDeltaAt).toBe(250);
    }
  });

  it('enters tool_running on tool_call_started and returns to awaiting_model on tool_result', () => {
    const running = phaseFromEvent(
      idlePhase,
      stampedEvent({
        kind: 'tool_call_started',
        toolName: 'canvas.createNode',
        toolCallId: 't1',
        startedAt: 100,
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
        toolName: 'canvas.createNode',
        toolCallId: 't1',
        result: { success: true },
        startedAt: 100,
        completedAt: 200,
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
        kind: 'tool_call_started',
        toolName: 'a',
        toolCallId: 't1',
        startedAt: 10,
        step: 2,
        emittedAt: 10,
      }),
    );
    p = phaseFromEvent(
      p,
      stampedEvent({
        kind: 'tool_call_started',
        toolName: 'b',
        toolCallId: 't2',
        startedAt: 15,
        step: 2,
        emittedAt: 15,
      }),
    );
    p = phaseFromEvent(
      p,
      stampedEvent({
        kind: 'tool_result',
        toolName: 'a',
        toolCallId: 't1',
        result: {},
        startedAt: 10,
        completedAt: 20,
        step: 2,
        emittedAt: 20,
      }),
    );
    expect(p.kind).toBe('tool_running');
    if (p.kind === 'tool_running') {
      expect(p.tools).toEqual(['t2']);
    }
  });

  it('enters failed on error events and done on done events', () => {
    const failed = phaseFromEvent(
      idlePhase,
      stampedEvent({ kind: 'error', error: 'network down' }),
    );
    expect(failed.kind).toBe('failed');

    const done = phaseFromEvent(
      idlePhase,
      stampedEvent({ kind: 'done', content: '' }),
    );
    expect(done.kind).toBe('done');
  });

  it('context_usage is a passthrough — phase is unchanged', () => {
    const p: RunPhase = { kind: 'awaiting_model', step: 1, since: 100 };
    const next = phaseFromEvent(
      p,
      stampedEvent({
        kind: 'context_usage',
        estimatedTokensUsed: 1,
        contextWindowTokens: 2,
        messageCount: 3,
        systemPromptChars: 4,
        toolSchemaChars: 5,
        messageChars: 6,
        cacheChars: 7,
        cacheEntryCount: 8,
        utilizationRatio: 0.1,
      }),
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
