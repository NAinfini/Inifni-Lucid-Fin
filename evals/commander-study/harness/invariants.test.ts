import { describe, expect, it } from 'vitest';
import type { StampedStreamEvent } from '@lucid-fin/application';
import type { SessionResult } from './run-single.js';
import { checkInvariants } from './invariants.js';

function makeBaseResult(): SessionResult {
  return {
    personaIndex: 0,
    personaSlug: 'test',
    archetype: 'story',
    providerName: 'Codex Plus',
    outcome: 'completed',
    steps: 1,
    toolCalls: [],
    toolCallCounts: {},
    mockCallCounts: {},
    askUserCount: 0,
    askUserAnswersConsumed: 0,
    askUserFallbacksUsed: 0,
    promptTokensEstimated: 10,
    finalNodeCount: 1,
    finalEdgeCount: 0,
    stylePlateLocked: true,
    promptGuidesLoadedViaGuideGet: [],
    processPromptsInjected: [],
    preflightDecisions: [],
    evidenceLedger: [],
    exitDecision: { outcome: 'satisfied' },
    contractSatisfied: true,
    exitOutcome: 'satisfied',
    blocker: null,
    logFile: 'x.ndjson',
    ms: 1,
  };
}

function e(event: Record<string, unknown>): StampedStreamEvent {
  return event as unknown as StampedStreamEvent;
}

describe('checkInvariants', () => {
  it('returns no violations for a trivially valid session', () => {
    const result = makeBaseResult();
    const events: StampedStreamEvent[] = [
      e({ kind: 'run_start', step: 0, emittedAt: 1 }),
      e({ kind: 'tool_call', toolCallId: 'tc-1', step: 1, emittedAt: 2 }),
      e({
        kind: 'question_prompt',
        questionId: 'tc-1',
        prompt: 'Pick one',
        options: [{ id: 'a', label: 'Option A' }],
        allowFreeText: false,
        step: 1,
        emittedAt: 3,
      }),
      e({
        kind: 'harness_answered',
        toolCallId: 'tc-1',
        answer: 'Option A',
        step: 1,
        emittedAt: 4,
      }),
      e({
        kind: 'tool_result',
        toolCallId: 'tc-1',
        step: 1,
        emittedAt: 5,
        result: { success: true },
      }),
      e({ kind: 'run_end', status: 'completed', step: 1, emittedAt: 6 }),
    ];
    const violations = checkInvariants(result, events);
    expect(violations).toHaveLength(0);
  });

  it('flags expected invariant ids on a synthesized bad session', () => {
    const result = makeBaseResult();
    result.exitDecision = { outcome: 'blocked_waiting_user' };
    result.evidenceLedger = [{ kind: 'ask_user_answered', at: 5, answer: 'yes' }];

    const events: StampedStreamEvent[] = [
      e({ kind: 'tool_call_started', toolCallId: 'dup-id', step: 1, emittedAt: 1 }),
      e({ kind: 'tool_call_started', toolCallId: 'dup-id', step: 2, emittedAt: 2 }),
      e({
        kind: 'question_prompt',
        questionId: 'ask-1',
        prompt: 'Pick one',
        options: [],
        allowFreeText: false,
        step: 3,
        emittedAt: 3,
      }),
      e({ kind: 'harness_answered', toolCallId: 'ask-1', answer: 'x', step: 3, emittedAt: 4 }),
      e({ kind: 'run_end', status: 'completed', step: 4, emittedAt: 10 }),
    ];

    const ids = new Set(checkInvariants(result, events).map((v) => v.invariant));
    expect(ids.has('duplicate_tool_call_id_without_result')).toBe(true);
    expect(ids.has('askUser_answered_but_no_tool_result')).toBe(true);
    expect(ids.has('askUser_empty_options')).toBe(true);
    expect(ids.has('exit_contract_blocked_waiting_user_after_answer')).toBe(true);
  });

  it('detects orphan_tool_call when tool starts but never completes', () => {
    const result = makeBaseResult();
    const events: StampedStreamEvent[] = [
      e({ kind: 'tool_call_started', toolCallId: 'orphan-1', step: 1, emittedAt: 1 }),
      e({ kind: 'tool_call_started', toolCallId: 'normal-1', step: 1, emittedAt: 2 }),
      e({
        kind: 'tool_result',
        toolCallId: 'normal-1',
        step: 1,
        emittedAt: 3,
        result: { success: true },
      }),
      e({ kind: 'run_end', status: 'completed', step: 1, emittedAt: 4 }),
    ];
    const violations = checkInvariants(result, events);
    const orphans = violations.filter((v) => v.invariant === 'orphan_tool_call');
    expect(orphans).toHaveLength(1);
    expect(orphans[0].evidence).toHaveProperty('toolCallId', 'orphan-1');
  });

  it('does not flag orphan_tool_call when tool_question closes the call', () => {
    const result = makeBaseResult();
    const events: StampedStreamEvent[] = [
      e({ kind: 'tool_call_started', toolCallId: 'q-1', step: 1, emittedAt: 1 }),
      e({
        kind: 'question_prompt',
        questionId: 'q-1',
        prompt: 'Pick',
        options: [{ id: 'a', label: 'A' }],
        allowFreeText: false,
        step: 1,
        emittedAt: 2,
      }),
      e({ kind: 'run_end', status: 'completed', step: 1, emittedAt: 3 }),
    ];
    const orphans = checkInvariants(result, events).filter(
      (v) => v.invariant === 'orphan_tool_call',
    );
    expect(orphans).toHaveLength(0);
  });

  it('does not flag orphan_tool_call when tool_confirm closes the call', () => {
    const result = makeBaseResult();
    const events: StampedStreamEvent[] = [
      e({ kind: 'tool_call_started', toolCallId: 'c-1', step: 1, emittedAt: 1 }),
      e({ kind: 'tool_confirm', toolCallId: 'c-1', step: 1, emittedAt: 2 }),
      e({ kind: 'run_end', status: 'completed', step: 1, emittedAt: 3 }),
    ];
    const orphans = checkInvariants(result, events).filter(
      (v) => v.invariant === 'orphan_tool_call',
    );
    expect(orphans).toHaveLength(0);
  });

  it('detects stalled_model_streaming when active for >90s without progress', () => {
    const result = makeBaseResult();
    const events: StampedStreamEvent[] = [
      e({ kind: 'model_streaming', active: true, emittedAt: 1000 }),
      e({ kind: 'model_streaming', active: true, emittedAt: 95_000 }),
      e({ kind: 'model_streaming', active: false, emittedAt: 96_000 }),
      e({ kind: 'run_end', status: 'completed', step: 1, emittedAt: 97_000 }),
    ];
    const stalls = checkInvariants(result, events).filter(
      (v) => v.invariant === 'stalled_model_streaming',
    );
    expect(stalls).toHaveLength(1);
    expect(stalls[0].severity).toBe('warning');
  });

  it('does not flag stalled_model_streaming when tool progress occurs within 90s', () => {
    const result = makeBaseResult();
    const events: StampedStreamEvent[] = [
      e({ kind: 'model_streaming', active: true, emittedAt: 1000 }),
      e({ kind: 'tool_call_started', toolCallId: 'x', step: 1, emittedAt: 50_000 }),
      e({ kind: 'model_streaming', active: true, emittedAt: 95_000 }),
      e({ kind: 'model_streaming', active: false, emittedAt: 96_000 }),
      e({ kind: 'run_end', status: 'completed', step: 1, emittedAt: 97_000 }),
    ];
    const stalls = checkInvariants(result, events).filter(
      (v) => v.invariant === 'stalled_model_streaming',
    );
    expect(stalls).toHaveLength(0);
  });

  it('detects process_prompt_duplicate_activation from evidence_appended events', () => {
    const result = makeBaseResult();
    const events: StampedStreamEvent[] = [
      e({
        kind: 'evidence_appended',
        evidence: { kind: 'process_prompt_activated', key: 'style-plate-lock' },
        emittedAt: 1,
      }),
      e({
        kind: 'evidence_appended',
        evidence: { kind: 'process_prompt_activated', key: 'style-plate-lock' },
        emittedAt: 2,
      }),
      e({ kind: 'run_end', status: 'completed', step: 1, emittedAt: 3 }),
    ];
    const dupes = checkInvariants(result, events).filter(
      (v) => v.invariant === 'process_prompt_duplicate_activation',
    );
    expect(dupes).toHaveLength(1);
    expect(dupes[0].evidence).toHaveProperty('key', 'style-plate-lock');
    expect(dupes[0].evidence).toHaveProperty('count', 2);
  });

  it('does not flag process_prompt_duplicate when key fires only once', () => {
    const result = makeBaseResult();
    const events: StampedStreamEvent[] = [
      e({
        kind: 'evidence_appended',
        evidence: { kind: 'process_prompt_activated', key: 'style-plate-lock' },
        emittedAt: 1,
      }),
      e({
        kind: 'evidence_appended',
        evidence: { kind: 'process_prompt_activated', key: 'character-management' },
        emittedAt: 2,
      }),
      e({ kind: 'run_end', status: 'completed', step: 1, emittedAt: 3 }),
    ];
    const dupes = checkInvariants(result, events).filter(
      (v) => v.invariant === 'process_prompt_duplicate_activation',
    );
    expect(dupes).toHaveLength(0);
  });

  it('allows same-step tool_call update without flagging duplicate_tool_call_id', () => {
    const result = makeBaseResult();
    const events: StampedStreamEvent[] = [
      e({ kind: 'tool_call', toolCallId: 'tc-1', step: 3, emittedAt: 1 }),
      e({ kind: 'tool_call', toolCallId: 'tc-1', step: 3, emittedAt: 2 }),
      e({
        kind: 'tool_result',
        toolCallId: 'tc-1',
        step: 3,
        emittedAt: 3,
        result: { success: true },
      }),
      e({ kind: 'run_end', status: 'completed', step: 3, emittedAt: 4 }),
    ];
    const dupes = checkInvariants(result, events).filter(
      (v) => v.invariant === 'duplicate_tool_call_id_without_result',
    );
    expect(dupes).toHaveLength(0);
  });

  it('flags duplicate_tool_call_id when tool_call reuses id across different steps', () => {
    const result = makeBaseResult();
    const events: StampedStreamEvent[] = [
      e({ kind: 'tool_call', toolCallId: 'tc-1', step: 1, emittedAt: 1 }),
      e({ kind: 'tool_call', toolCallId: 'tc-1', step: 2, emittedAt: 2 }),
      e({
        kind: 'tool_result',
        toolCallId: 'tc-1',
        step: 2,
        emittedAt: 3,
        result: { success: true },
      }),
      e({ kind: 'run_end', status: 'completed', step: 2, emittedAt: 4 }),
    ];
    const dupes = checkInvariants(result, events).filter(
      (v) => v.invariant === 'duplicate_tool_call_id_without_result',
    );
    expect(dupes).toHaveLength(1);
  });

  it('does not flag exit_contract_blocked when no answer evidence exists', () => {
    const result = makeBaseResult();
    result.exitDecision = { outcome: 'blocked_waiting_user' };
    result.evidenceLedger = [];
    const events: StampedStreamEvent[] = [
      e({ kind: 'run_end', status: 'completed', step: 1, emittedAt: 10 }),
    ];
    const blocked = checkInvariants(result, events).filter(
      (v) => v.invariant === 'exit_contract_blocked_waiting_user_after_answer',
    );
    expect(blocked).toHaveLength(0);
  });

  it('does not flag exit_contract_blocked when exit outcome is not blocked_waiting_user', () => {
    const result = makeBaseResult();
    result.exitDecision = { outcome: 'satisfied' };
    result.evidenceLedger = [{ kind: 'ask_user_answered', at: 5, answer: 'yes' }];
    const events: StampedStreamEvent[] = [
      e({ kind: 'run_end', status: 'completed', step: 1, emittedAt: 10 }),
    ];
    const blocked = checkInvariants(result, events).filter(
      (v) => v.invariant === 'exit_contract_blocked_waiting_user_after_answer',
    );
    expect(blocked).toHaveLength(0);
  });

  it('detects askUser_empty_options on tool_question with empty options', () => {
    const result = makeBaseResult();
    const events: StampedStreamEvent[] = [
      e({
        kind: 'tool_question',
        toolCallId: 'q-1',
        prompt: 'Pick',
        options: [],
        step: 1,
        emittedAt: 1,
      }),
      e({
        kind: 'tool_result',
        toolCallId: 'q-1',
        step: 1,
        emittedAt: 2,
        result: { success: true },
      }),
      e({ kind: 'run_end', status: 'completed', step: 1, emittedAt: 3 }),
    ];
    const empty = checkInvariants(result, events).filter(
      (v) => v.invariant === 'askUser_empty_options',
    );
    expect(empty).toHaveLength(1);
  });

  it('detects askUser_empty_options when all option labels are blank', () => {
    const result = makeBaseResult();
    const events: StampedStreamEvent[] = [
      e({
        kind: 'tool_question',
        toolCallId: 'q-1',
        prompt: 'Pick',
        options: [
          { id: 'a', label: '' },
          { id: 'b', label: '  ' },
        ],
        step: 1,
        emittedAt: 1,
      }),
      e({
        kind: 'tool_result',
        toolCallId: 'q-1',
        step: 1,
        emittedAt: 2,
        result: { success: true },
      }),
      e({ kind: 'run_end', status: 'completed', step: 1, emittedAt: 3 }),
    ];
    const empty = checkInvariants(result, events).filter(
      (v) => v.invariant === 'askUser_empty_options',
    );
    expect(empty).toHaveLength(1);
  });
});
