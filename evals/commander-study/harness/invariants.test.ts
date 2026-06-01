import { describe, expect, it } from 'vitest';
import type { StampedStreamEvent } from '@lucid-fin/application';
import type { SessionResult } from './run-single.js';
import { checkInvariants } from './invariants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseResult(overrides?: Partial<SessionResult>): SessionResult {
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
    finalCanvas: null,
    qualityReport: { composite: 0, grade: 'F' as const, dimensions: [], flags: [] },
    logFile: 'x.ndjson',
    ms: 1,
    ...overrides,
  };
}

function e(event: Record<string, unknown>): StampedStreamEvent {
  return event as unknown as StampedStreamEvent;
}

function runEnd(step = 1, emittedAt = 1000): StampedStreamEvent {
  return e({ kind: 'run_end', status: 'completed', step, emittedAt });
}

// ---------------------------------------------------------------------------
// Baseline: clean sessions
// ---------------------------------------------------------------------------

describe('checkInvariants', () => {
  describe('clean sessions', () => {
    it('returns no violations for an empty event stream', () => {
      const violations = checkInvariants(makeBaseResult(), []);
      expect(violations).toHaveLength(0);
    });

    it('returns no violations for a trivially valid session', () => {
      const events = [
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
        e({ kind: 'harness_answered', toolCallId: 'tc-1', answer: 'Option A', step: 1, emittedAt: 4 }),
        e({ kind: 'tool_result', toolCallId: 'tc-1', step: 1, emittedAt: 5, result: { success: true } }),
        runEnd(1, 6),
      ];
      expect(checkInvariants(makeBaseResult(), events)).toHaveLength(0);
    });

    it('returns no violations for a multi-step session with multiple tools', () => {
      const events = [
        e({ kind: 'run_start', step: 0, emittedAt: 1 }),
        e({ kind: 'tool_call', toolCallId: 'tc-1', step: 1, emittedAt: 10 }),
        e({ kind: 'tool_result', toolCallId: 'tc-1', step: 1, emittedAt: 20, result: { success: true } }),
        e({ kind: 'tool_call', toolCallId: 'tc-2', step: 2, emittedAt: 30 }),
        e({ kind: 'tool_result', toolCallId: 'tc-2', step: 2, emittedAt: 40, result: { success: true } }),
        e({ kind: 'tool_call', toolCallId: 'tc-3', step: 3, emittedAt: 50 }),
        e({ kind: 'tool_result', toolCallId: 'tc-3', step: 3, emittedAt: 60, result: { success: true } }),
        runEnd(3, 70),
      ];
      expect(checkInvariants(makeBaseResult(), events)).toHaveLength(0);
    });

    it('handles a session that aborted before any tool calls', () => {
      const events = [
        e({ kind: 'run_start', step: 0, emittedAt: 1 }),
        e({ kind: 'run_end', status: 'aborted', step: 0, emittedAt: 2 }),
      ];
      expect(checkInvariants(makeBaseResult({ outcome: 'aborted' }), events)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // duplicate_tool_call_id_without_result
  // ---------------------------------------------------------------------------

  describe('duplicate_tool_call_id_without_result', () => {
    it('flags when tool_call reuses id across different steps', () => {
      const events = [
        e({ kind: 'tool_call', toolCallId: 'tc-1', step: 1, emittedAt: 1 }),
        e({ kind: 'tool_call', toolCallId: 'tc-1', step: 2, emittedAt: 2 }),
        e({ kind: 'tool_result', toolCallId: 'tc-1', step: 2, emittedAt: 3, result: { success: true } }),
        runEnd(2, 4),
      ];
      const dupes = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'duplicate_tool_call_id_without_result',
      );
      expect(dupes).toHaveLength(1);
      expect(dupes[0].severity).toBe('error');
    });

    it('allows same-step tool_call update (args refinement)', () => {
      const events = [
        e({ kind: 'tool_call', toolCallId: 'tc-1', step: 3, emittedAt: 1 }),
        e({ kind: 'tool_call', toolCallId: 'tc-1', step: 3, emittedAt: 2 }),
        e({ kind: 'tool_result', toolCallId: 'tc-1', step: 3, emittedAt: 3, result: { success: true } }),
        runEnd(3, 4),
      ];
      const dupes = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'duplicate_tool_call_id_without_result',
      );
      expect(dupes).toHaveLength(0);
    });

    it('flags tool_call_started reuse across steps', () => {
      const events = [
        e({ kind: 'tool_call_started', toolCallId: 'dup-id', step: 1, emittedAt: 1 }),
        e({ kind: 'tool_call_started', toolCallId: 'dup-id', step: 2, emittedAt: 2 }),
        runEnd(2, 10),
      ];
      const dupes = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'duplicate_tool_call_id_without_result',
      );
      expect(dupes).toHaveLength(1);
    });

    it('clears after a tool_result resets the pending state', () => {
      const events = [
        e({ kind: 'tool_call', toolCallId: 'tc-1', step: 1, emittedAt: 1 }),
        e({ kind: 'tool_result', toolCallId: 'tc-1', step: 1, emittedAt: 2, result: { success: true } }),
        e({ kind: 'tool_call', toolCallId: 'tc-1', step: 2, emittedAt: 3 }),
        e({ kind: 'tool_result', toolCallId: 'tc-1', step: 2, emittedAt: 4, result: { success: true } }),
        runEnd(2, 5),
      ];
      const dupes = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'duplicate_tool_call_id_without_result',
      );
      expect(dupes).toHaveLength(0);
    });

    it('flags multiple distinct duplicate IDs independently', () => {
      const events = [
        e({ kind: 'tool_call', toolCallId: 'a', step: 1, emittedAt: 1 }),
        e({ kind: 'tool_call', toolCallId: 'b', step: 1, emittedAt: 2 }),
        e({ kind: 'tool_call', toolCallId: 'a', step: 2, emittedAt: 3 }),
        e({ kind: 'tool_call', toolCallId: 'b', step: 2, emittedAt: 4 }),
        runEnd(2, 5),
      ];
      const dupes = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'duplicate_tool_call_id_without_result',
      );
      expect(dupes).toHaveLength(2);
    });

    it('does not flag tool_call_started with different ids', () => {
      const events = [
        e({ kind: 'tool_call_started', toolCallId: 'a', step: 1, emittedAt: 1 }),
        e({ kind: 'tool_call_started', toolCallId: 'b', step: 1, emittedAt: 2 }),
        e({ kind: 'tool_result', toolCallId: 'a', step: 1, emittedAt: 3, result: { success: true } }),
        e({ kind: 'tool_result', toolCallId: 'b', step: 1, emittedAt: 4, result: { success: true } }),
        runEnd(1, 5),
      ];
      const dupes = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'duplicate_tool_call_id_without_result',
      );
      expect(dupes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // orphan_tool_call
  // ---------------------------------------------------------------------------

  describe('orphan_tool_call', () => {
    it('detects tool_call_started that never completes', () => {
      const events = [
        e({ kind: 'tool_call_started', toolCallId: 'orphan-1', step: 1, emittedAt: 1 }),
        e({ kind: 'tool_call_started', toolCallId: 'normal-1', step: 1, emittedAt: 2 }),
        e({ kind: 'tool_result', toolCallId: 'normal-1', step: 1, emittedAt: 3, result: { success: true } }),
        runEnd(1, 4),
      ];
      const orphans = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'orphan_tool_call',
      );
      expect(orphans).toHaveLength(1);
      expect(orphans[0].evidence).toHaveProperty('toolCallId', 'orphan-1');
    });

    it('detects tool_call (v2) that never completes', () => {
      const events = [
        e({ kind: 'tool_call', toolCallId: 'orphan-v2', step: 1, emittedAt: 1 }),
        runEnd(1, 2),
      ];
      const orphans = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'orphan_tool_call',
      );
      expect(orphans).toHaveLength(1);
      expect(orphans[0].evidence).toHaveProperty('toolCallId', 'orphan-v2');
    });

    it('does not flag when question_prompt closes the call', () => {
      const events = [
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
        runEnd(1, 3),
      ];
      const orphans = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'orphan_tool_call',
      );
      expect(orphans).toHaveLength(0);
    });

    it('does not flag when tool_question closes the call', () => {
      const events = [
        e({ kind: 'tool_call_started', toolCallId: 'q-2', step: 1, emittedAt: 1 }),
        e({
          kind: 'tool_question',
          toolCallId: 'q-2',
          prompt: 'Pick',
          options: [{ id: 'a', label: 'A' }],
          step: 1,
          emittedAt: 2,
        }),
        runEnd(1, 3),
      ];
      const orphans = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'orphan_tool_call',
      );
      expect(orphans).toHaveLength(0);
    });

    it('does not flag when tool_confirm closes the call', () => {
      const events = [
        e({ kind: 'tool_call_started', toolCallId: 'c-1', step: 1, emittedAt: 1 }),
        e({ kind: 'tool_confirm', toolCallId: 'c-1', step: 1, emittedAt: 2 }),
        runEnd(1, 3),
      ];
      const orphans = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'orphan_tool_call',
      );
      expect(orphans).toHaveLength(0);
    });

    it('does not flag when tool_confirm_prompt closes the call', () => {
      const events = [
        e({ kind: 'tool_call_started', toolCallId: 'c-2', step: 1, emittedAt: 1 }),
        e({ kind: 'tool_confirm_prompt', toolCallId: 'c-2', step: 1, emittedAt: 2 }),
        runEnd(1, 3),
      ];
      const orphans = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'orphan_tool_call',
      );
      expect(orphans).toHaveLength(0);
    });

    it('detects multiple orphans in the same session', () => {
      const events = [
        e({ kind: 'tool_call_started', toolCallId: 'a', step: 1, emittedAt: 1 }),
        e({ kind: 'tool_call_started', toolCallId: 'b', step: 2, emittedAt: 2 }),
        e({ kind: 'tool_call_started', toolCallId: 'c', step: 3, emittedAt: 3 }),
        runEnd(3, 4),
      ];
      const orphans = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'orphan_tool_call',
      );
      expect(orphans).toHaveLength(3);
      const ids = orphans.map((o) => o.evidence?.toolCallId);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
      expect(ids).toContain('c');
    });

    it('does not double-register the same id on second start event', () => {
      const events = [
        e({ kind: 'tool_call_started', toolCallId: 'x', step: 1, emittedAt: 1 }),
        e({ kind: 'tool_call_started', toolCallId: 'x', step: 1, emittedAt: 2 }),
        runEnd(1, 3),
      ];
      const orphans = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'orphan_tool_call',
      );
      expect(orphans).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // askUser_answered_but_no_tool_result
  // ---------------------------------------------------------------------------

  describe('askUser_answered_but_no_tool_result', () => {
    it('flags when question answered but tool_result never arrives', () => {
      const events = [
        e({
          kind: 'question_prompt',
          questionId: 'ask-1',
          prompt: 'Pick one',
          options: [{ id: 'a', label: 'A' }],
          allowFreeText: false,
          step: 1,
          emittedAt: 1,
        }),
        e({ kind: 'harness_answered', toolCallId: 'ask-1', answer: 'A', step: 1, emittedAt: 2 }),
        runEnd(1, 3),
      ];
      const violations = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'askUser_answered_but_no_tool_result',
      );
      expect(violations).toHaveLength(1);
      expect(violations[0].evidence).toHaveProperty('toolCallId', 'ask-1');
    });

    it('does not flag when tool_result follows the answer', () => {
      const events = [
        e({
          kind: 'question_prompt',
          questionId: 'ask-1',
          prompt: 'Pick one',
          options: [{ id: 'a', label: 'A' }],
          allowFreeText: false,
          step: 1,
          emittedAt: 1,
        }),
        e({ kind: 'harness_answered', toolCallId: 'ask-1', answer: 'A', step: 1, emittedAt: 2 }),
        e({ kind: 'tool_result', toolCallId: 'ask-1', step: 1, emittedAt: 3, result: { success: true } }),
        runEnd(1, 4),
      ];
      const violations = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'askUser_answered_but_no_tool_result',
      );
      expect(violations).toHaveLength(0);
    });

    it('does not flag when answer has no matching question', () => {
      const events = [
        e({ kind: 'harness_answered', toolCallId: 'unmatched', answer: 'A', step: 1, emittedAt: 1 }),
        runEnd(1, 2),
      ];
      const violations = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'askUser_answered_but_no_tool_result',
      );
      expect(violations).toHaveLength(0);
    });

    it('handles tool_question + user_answer event format', () => {
      const events = [
        e({
          kind: 'tool_question',
          toolCallId: 'tq-1',
          prompt: 'Pick one',
          options: [{ id: 'a', label: 'A' }],
          step: 1,
          emittedAt: 1,
        }),
        e({ kind: 'user_answer', questionId: 'tq-1', answer: 'A', step: 1, emittedAt: 2 }),
        runEnd(1, 3),
      ];
      const violations = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'askUser_answered_but_no_tool_result',
      );
      expect(violations).toHaveLength(1);
    });

    it('flags multiple unanswered questions independently', () => {
      const events = [
        e({ kind: 'question_prompt', questionId: 'q1', prompt: 'A?', options: [{ id: '1', label: 'A' }], allowFreeText: false, step: 1, emittedAt: 1 }),
        e({ kind: 'harness_answered', toolCallId: 'q1', answer: 'A', step: 1, emittedAt: 2 }),
        e({ kind: 'question_prompt', questionId: 'q2', prompt: 'B?', options: [{ id: '2', label: 'B' }], allowFreeText: false, step: 2, emittedAt: 3 }),
        e({ kind: 'harness_answered', toolCallId: 'q2', answer: 'B', step: 2, emittedAt: 4 }),
        runEnd(2, 5),
      ];
      const violations = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'askUser_answered_but_no_tool_result',
      );
      expect(violations).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // askUser_empty_options
  // ---------------------------------------------------------------------------

  describe('askUser_empty_options', () => {
    it('flags question_prompt with empty options array and no freetext', () => {
      const events = [
        e({
          kind: 'question_prompt',
          questionId: 'q-1',
          prompt: 'Pick',
          options: [],
          allowFreeText: false,
          step: 1,
          emittedAt: 1,
        }),
        e({ kind: 'tool_result', toolCallId: 'q-1', step: 1, emittedAt: 2, result: { success: true } }),
        runEnd(1, 3),
      ];
      const empty = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'askUser_empty_options',
      );
      expect(empty).toHaveLength(1);
    });

    it('flags tool_question with empty options array', () => {
      const events = [
        e({
          kind: 'tool_question',
          toolCallId: 'q-1',
          prompt: 'Pick',
          options: [],
          step: 1,
          emittedAt: 1,
        }),
        e({ kind: 'tool_result', toolCallId: 'q-1', step: 1, emittedAt: 2, result: { success: true } }),
        runEnd(1, 3),
      ];
      const empty = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'askUser_empty_options',
      );
      expect(empty).toHaveLength(1);
    });

    it('flags when all option labels are blank', () => {
      const events = [
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
        e({ kind: 'tool_result', toolCallId: 'q-1', step: 1, emittedAt: 2, result: { success: true } }),
        runEnd(1, 3),
      ];
      const empty = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'askUser_empty_options',
      );
      expect(empty).toHaveLength(1);
    });

    it('does not flag question_prompt with allowFreeText=true even when options empty', () => {
      const events = [
        e({
          kind: 'question_prompt',
          questionId: 'q-1',
          prompt: 'Type freely',
          options: [],
          allowFreeText: true,
          step: 1,
          emittedAt: 1,
        }),
        runEnd(1, 2),
      ];
      const empty = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'askUser_empty_options',
      );
      expect(empty).toHaveLength(0);
    });

    it('does not flag when at least one option has a non-blank label', () => {
      const events = [
        e({
          kind: 'tool_question',
          toolCallId: 'q-1',
          prompt: 'Pick',
          options: [
            { id: 'a', label: '' },
            { id: 'b', label: 'Valid' },
          ],
          step: 1,
          emittedAt: 1,
        }),
        e({ kind: 'tool_result', toolCallId: 'q-1', step: 1, emittedAt: 2, result: { success: true } }),
        runEnd(1, 3),
      ];
      const empty = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'askUser_empty_options',
      );
      expect(empty).toHaveLength(0);
    });

    it('flags multiple question events with empty options', () => {
      const events = [
        e({ kind: 'tool_question', toolCallId: 'q-1', prompt: 'A?', options: [], step: 1, emittedAt: 1 }),
        e({ kind: 'tool_result', toolCallId: 'q-1', step: 1, emittedAt: 2, result: { success: true } }),
        e({ kind: 'tool_question', toolCallId: 'q-2', prompt: 'B?', options: [], step: 2, emittedAt: 3 }),
        e({ kind: 'tool_result', toolCallId: 'q-2', step: 2, emittedAt: 4, result: { success: true } }),
        runEnd(2, 5),
      ];
      const empty = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'askUser_empty_options',
      );
      expect(empty).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // process_prompt_duplicate_activation
  // ---------------------------------------------------------------------------

  describe('process_prompt_duplicate_activation', () => {
    it('detects same process prompt key fired twice', () => {
      const events = [
        e({
          kind: 'evidence_appended',
          evidence: { kind: 'guide_activated', key: 'style-plate-lock' },
          emittedAt: 1,
        }),
        e({
          kind: 'evidence_appended',
          evidence: { kind: 'guide_activated', key: 'style-plate-lock' },
          emittedAt: 2,
        }),
        runEnd(1, 3),
      ];
      const dupes = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'process_prompt_duplicate_activation',
      );
      expect(dupes).toHaveLength(1);
      expect(dupes[0].evidence).toHaveProperty('key', 'style-plate-lock');
      expect(dupes[0].evidence).toHaveProperty('count', 2);
    });

    it('does not flag when each key fires only once', () => {
      const events = [
        e({
          kind: 'evidence_appended',
          evidence: { kind: 'guide_activated', key: 'style-plate-lock' },
          emittedAt: 1,
        }),
        e({
          kind: 'evidence_appended',
          evidence: { kind: 'guide_activated', key: 'entity-management' },
          emittedAt: 2,
        }),
        runEnd(1, 3),
      ];
      const dupes = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'process_prompt_duplicate_activation',
      );
      expect(dupes).toHaveLength(0);
    });

    it('ignores evidence_appended events with non-process_prompt kinds', () => {
      const events = [
        e({
          kind: 'evidence_appended',
          evidence: { kind: 'ask_user_answered', key: 'style-plate-lock' },
          emittedAt: 1,
        }),
        e({
          kind: 'evidence_appended',
          evidence: { kind: 'ask_user_answered', key: 'style-plate-lock' },
          emittedAt: 2,
        }),
        runEnd(1, 3),
      ];
      const dupes = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'process_prompt_duplicate_activation',
      );
      expect(dupes).toHaveLength(0);
    });

    it('flags each duplicated key separately', () => {
      const events = [
        e({ kind: 'evidence_appended', evidence: { kind: 'guide_activated', key: 'a' }, emittedAt: 1 }),
        e({ kind: 'evidence_appended', evidence: { kind: 'guide_activated', key: 'b' }, emittedAt: 2 }),
        e({ kind: 'evidence_appended', evidence: { kind: 'guide_activated', key: 'a' }, emittedAt: 3 }),
        e({ kind: 'evidence_appended', evidence: { kind: 'guide_activated', key: 'b' }, emittedAt: 4 }),
        e({ kind: 'evidence_appended', evidence: { kind: 'guide_activated', key: 'a' }, emittedAt: 5 }),
        runEnd(1, 6),
      ];
      const dupes = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'process_prompt_duplicate_activation',
      );
      expect(dupes).toHaveLength(2);
      const keys = dupes.map((d) => d.evidence?.key);
      expect(keys).toContain('a');
      expect(keys).toContain('b');
      const aViolation = dupes.find((d) => d.evidence?.key === 'a');
      expect(aViolation?.evidence).toHaveProperty('count', 3);
    });
  });

  // ---------------------------------------------------------------------------
  // exit_contract_blocked_waiting_user_after_answer
  // ---------------------------------------------------------------------------

  describe('exit_contract_blocked_waiting_user_after_answer', () => {
    it('flags when exit is blocked_waiting_user but answer evidence exists', () => {
      const result = makeBaseResult({
        exitDecision: { outcome: 'blocked_waiting_user' },
        evidenceLedger: [{ kind: 'ask_user_answered', at: 5, answer: 'yes' }],
      });
      const events = [runEnd(1, 10)];
      const blocked = checkInvariants(result, events).filter(
        (v) => v.invariant === 'exit_contract_blocked_waiting_user_after_answer',
      );
      expect(blocked).toHaveLength(1);
    });

    it('does not flag when no answer evidence exists', () => {
      const result = makeBaseResult({
        exitDecision: { outcome: 'blocked_waiting_user' },
        evidenceLedger: [],
      });
      const events = [runEnd(1, 10)];
      const blocked = checkInvariants(result, events).filter(
        (v) => v.invariant === 'exit_contract_blocked_waiting_user_after_answer',
      );
      expect(blocked).toHaveLength(0);
    });

    it('does not flag when exit outcome is satisfied', () => {
      const result = makeBaseResult({
        exitDecision: { outcome: 'satisfied' },
        evidenceLedger: [{ kind: 'ask_user_answered', at: 5, answer: 'yes' }],
      });
      const events = [runEnd(1, 10)];
      const blocked = checkInvariants(result, events).filter(
        (v) => v.invariant === 'exit_contract_blocked_waiting_user_after_answer',
      );
      expect(blocked).toHaveLength(0);
    });

    it('does not flag when exit outcome is unsatisfied', () => {
      const result = makeBaseResult({
        exitDecision: { outcome: 'unsatisfied' },
        evidenceLedger: [{ kind: 'ask_user_answered', at: 5, answer: 'yes' }],
      });
      const events = [runEnd(1, 10)];
      const blocked = checkInvariants(result, events).filter(
        (v) => v.invariant === 'exit_contract_blocked_waiting_user_after_answer',
      );
      expect(blocked).toHaveLength(0);
    });

    it('does not flag when answer timestamp is after run_end', () => {
      const result = makeBaseResult({
        exitDecision: { outcome: 'blocked_waiting_user' },
        evidenceLedger: [{ kind: 'ask_user_answered', at: 100, answer: 'yes' }],
      });
      const events = [runEnd(1, 10)];
      const blocked = checkInvariants(result, events).filter(
        (v) => v.invariant === 'exit_contract_blocked_waiting_user_after_answer',
      );
      expect(blocked).toHaveLength(0);
    });

    it('does not flag when exitDecision is null', () => {
      const result = makeBaseResult({
        exitDecision: null,
        evidenceLedger: [{ kind: 'ask_user_answered', at: 5, answer: 'yes' }],
      });
      const events = [runEnd(1, 10)];
      const blocked = checkInvariants(result, events).filter(
        (v) => v.invariant === 'exit_contract_blocked_waiting_user_after_answer',
      );
      expect(blocked).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // stalled_model_streaming
  // ---------------------------------------------------------------------------

  describe('stalled_model_streaming', () => {
    it('detects streaming active for >90s without progress', () => {
      const events = [
        e({ kind: 'model_streaming', active: true, emittedAt: 1000 }),
        e({ kind: 'model_streaming', active: true, emittedAt: 95_000 }),
        e({ kind: 'model_streaming', active: false, emittedAt: 96_000 }),
        runEnd(1, 97_000),
      ];
      const stalls = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'stalled_model_streaming',
      );
      expect(stalls).toHaveLength(1);
      expect(stalls[0].severity).toBe('warning');
    });

    it('does not flag when tool progress occurs within 90s', () => {
      const events = [
        e({ kind: 'model_streaming', active: true, emittedAt: 1000 }),
        e({ kind: 'tool_call_started', toolCallId: 'x', step: 1, emittedAt: 50_000 }),
        e({ kind: 'model_streaming', active: true, emittedAt: 95_000 }),
        e({ kind: 'model_streaming', active: false, emittedAt: 96_000 }),
        runEnd(1, 97_000),
      ];
      const stalls = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'stalled_model_streaming',
      );
      expect(stalls).toHaveLength(0);
    });

    it('does not flag when tool_result progress resets the timer', () => {
      const events = [
        e({ kind: 'model_streaming', active: true, emittedAt: 1000 }),
        e({ kind: 'tool_result', toolCallId: 'x', step: 1, emittedAt: 80_000, result: { success: true } }),
        e({ kind: 'model_streaming', active: true, emittedAt: 95_000 }),
        e({ kind: 'model_streaming', active: false, emittedAt: 96_000 }),
        runEnd(1, 97_000),
      ];
      const stalls = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'stalled_model_streaming',
      );
      expect(stalls).toHaveLength(0);
    });

    it('does not flag streaming under 90s', () => {
      const events = [
        e({ kind: 'model_streaming', active: true, emittedAt: 1000 }),
        e({ kind: 'model_streaming', active: false, emittedAt: 89_000 }),
        runEnd(1, 90_000),
      ];
      const stalls = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'stalled_model_streaming',
      );
      expect(stalls).toHaveLength(0);
    });

    it('does not flag exactly 90s (boundary check)', () => {
      const events = [
        e({ kind: 'model_streaming', active: true, emittedAt: 1000 }),
        e({ kind: 'model_streaming', active: true, emittedAt: 91_000 }),
        e({ kind: 'model_streaming', active: false, emittedAt: 92_000 }),
        runEnd(1, 93_000),
      ];
      const stalls = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'stalled_model_streaming',
      );
      expect(stalls).toHaveLength(0);
    });

    it('resets tracking when streaming becomes inactive then active again', () => {
      const events = [
        e({ kind: 'model_streaming', active: true, emittedAt: 1000 }),
        e({ kind: 'model_streaming', active: false, emittedAt: 50_000 }),
        e({ kind: 'model_streaming', active: true, emittedAt: 60_000 }),
        e({ kind: 'model_streaming', active: true, emittedAt: 80_000 }),
        e({ kind: 'model_streaming', active: false, emittedAt: 81_000 }),
        runEnd(1, 82_000),
      ];
      const stalls = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'stalled_model_streaming',
      );
      expect(stalls).toHaveLength(0);
    });

    it('only warns once per streaming segment', () => {
      const events = [
        e({ kind: 'model_streaming', active: true, emittedAt: 1000 }),
        e({ kind: 'model_streaming', active: true, emittedAt: 100_000 }),
        e({ kind: 'model_streaming', active: true, emittedAt: 200_000 }),
        e({ kind: 'model_streaming', active: false, emittedAt: 201_000 }),
        runEnd(1, 202_000),
      ];
      const stalls = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'stalled_model_streaming',
      );
      expect(stalls).toHaveLength(1);
    });

    it('handles phase/state-based model_streaming events', () => {
      const events = [
        e({ kind: 'model_streaming', phase: 'start', emittedAt: 1000 }),
        e({ kind: 'model_streaming', phase: 'active', emittedAt: 95_000 }),
        e({ kind: 'model_streaming', phase: 'stop', emittedAt: 96_000 }),
        runEnd(1, 97_000),
      ];
      const stalls = checkInvariants(makeBaseResult(), events).filter(
        (v) => v.invariant === 'stalled_model_streaming',
      );
      expect(stalls).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Combined / integration
  // ---------------------------------------------------------------------------

  describe('combined violations', () => {
    it('flags all expected invariants on a synthesized bad session', () => {
      const result = makeBaseResult({
        exitDecision: { outcome: 'blocked_waiting_user' },
        evidenceLedger: [{ kind: 'ask_user_answered', at: 5, answer: 'yes' }],
      });
      const events = [
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
        e({
          kind: 'evidence_appended',
          evidence: { kind: 'guide_activated', key: 'dup-pp' },
          emittedAt: 5,
        }),
        e({
          kind: 'evidence_appended',
          evidence: { kind: 'guide_activated', key: 'dup-pp' },
          emittedAt: 6,
        }),
        runEnd(4, 10),
      ];

      const ids = new Set(checkInvariants(result, events).map((v) => v.invariant));
      expect(ids.has('duplicate_tool_call_id_without_result')).toBe(true);
      expect(ids.has('askUser_answered_but_no_tool_result')).toBe(true);
      expect(ids.has('askUser_empty_options')).toBe(true);
      expect(ids.has('exit_contract_blocked_waiting_user_after_answer')).toBe(true);
      expect(ids.has('process_prompt_duplicate_activation')).toBe(true);
    });

    it('returns violations with correct severity classification', () => {
      const events = [
        e({ kind: 'tool_call_started', toolCallId: 'orphan', step: 1, emittedAt: 1 }),
        e({ kind: 'model_streaming', active: true, emittedAt: 2000 }),
        e({ kind: 'model_streaming', active: true, emittedAt: 100_000 }),
        e({ kind: 'model_streaming', active: false, emittedAt: 101_000 }),
        runEnd(1, 102_000),
      ];
      const violations = checkInvariants(makeBaseResult(), events);
      const orphan = violations.find((v) => v.invariant === 'orphan_tool_call');
      const stall = violations.find((v) => v.invariant === 'stalled_model_streaming');
      expect(orphan?.severity).toBe('error');
      expect(stall?.severity).toBe('warning');
    });
  });
});
