import type { StampedStreamEvent } from '@lucid-fin/application';
import type { SessionResult } from './run-single.js';

export interface InvariantViolation {
  invariant: string;
  description: string;
  severity: 'error' | 'warning';
  evidence?: Record<string, unknown>;
}

type AnyRecord = Record<string, unknown>;

function asRecord(event: unknown): AnyRecord {
  return event as AnyRecord;
}

function eventKind(event: unknown): string {
  return String(asRecord(event).kind ?? '');
}

function eventStep(event: unknown): number | null {
  const step = asRecord(event).step;
  return typeof step === 'number' ? step : null;
}

function eventTs(event: unknown): number | null {
  const rec = asRecord(event);
  if (typeof rec.emittedAt === 'number') return rec.emittedAt;
  if (typeof rec.t === 'number') return rec.t;
  return null;
}

function getToolCallIdFromQuestion(event: unknown): string | null {
  const rec = asRecord(event);
  const kind = eventKind(event);
  if (kind === 'tool_question' && typeof rec.toolCallId === 'string') return rec.toolCallId;
  if (kind === 'question_prompt' && typeof rec.questionId === 'string') return rec.questionId;
  return null;
}

function getToolCallIdFromAnswer(event: unknown): string | null {
  const rec = asRecord(event);
  const kind = eventKind(event);
  if (kind === 'harness_answered' && typeof rec.toolCallId === 'string') return rec.toolCallId;
  if (kind === 'user_answer' && typeof rec.questionId === 'string') return rec.questionId;
  return null;
}

function getToolCallIdFromResult(event: unknown): string | null {
  const rec = asRecord(event);
  return typeof rec.toolCallId === 'string' ? rec.toolCallId : null;
}

function getToolCallIdFromStart(event: unknown): string | null {
  const rec = asRecord(event);
  const kind = eventKind(event);
  if (kind === 'tool_call_started' && typeof rec.toolCallId === 'string') return rec.toolCallId;
  if (kind === 'tool_call_started' && typeof rec.id === 'string') return rec.id;
  if (kind === 'tool_call' && typeof rec.toolCallId === 'string') return rec.toolCallId;
  return null;
}

function getToolCallIdFromConfirm(event: unknown): string | null {
  const rec = asRecord(event);
  const kind = eventKind(event);
  if (kind === 'tool_confirm' && typeof rec.toolCallId === 'string') return rec.toolCallId;
  if (kind === 'tool_confirm_prompt' && typeof rec.toolCallId === 'string') return rec.toolCallId;
  return null;
}

function isTerminalEvent(event: unknown): boolean {
  const kind = eventKind(event);
  return kind === 'run_end' || kind === 'cancelled';
}

function isToolResultEvent(event: unknown): boolean {
  return eventKind(event) === 'tool_result';
}

function isToolStartEvent(event: unknown): boolean {
  const kind = eventKind(event);
  return kind === 'tool_call_started' || kind === 'tool_call';
}

function isToolQuestionEvent(event: unknown): boolean {
  const kind = eventKind(event);
  return kind === 'tool_question' || kind === 'question_prompt';
}

function checkAskUserAnsweredButNoToolResult(events: readonly unknown[]): InvariantViolation[] {
  const asked = new Map<string, unknown>();
  const answered = new Map<string, unknown>();
  const results = new Set<string>();

  for (const event of events) {
    if (isToolQuestionEvent(event)) {
      const id = getToolCallIdFromQuestion(event);
      if (id) asked.set(id, event);
      continue;
    }
    if (isToolResultEvent(event)) {
      const id = getToolCallIdFromResult(event);
      if (id) results.add(id);
      continue;
    }
    const answerId = getToolCallIdFromAnswer(event);
    if (answerId) answered.set(answerId, event);
  }

  const violations: InvariantViolation[] = [];
  for (const [toolCallId, answerEvent] of answered) {
    if (!asked.has(toolCallId)) continue;
    if (results.has(toolCallId)) continue;
    violations.push({
      invariant: 'askUser_answered_but_no_tool_result',
      description:
        'askUser question was answered by harness/user but no matching tool_result was emitted.',
      severity: 'error',
      evidence: {
        toolCallId,
        answerEvent,
        questionEvent: asked.get(toolCallId),
      },
    });
  }
  return violations;
}

function checkDuplicateToolCallIdWithoutResult(events: readonly unknown[]): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const pending = new Map<string, { event: unknown; step: number | null; sourceKind: string }>();

  for (const event of events) {
    if (isToolResultEvent(event)) {
      const id = getToolCallIdFromResult(event);
      if (id) pending.delete(id);
      continue;
    }
    if (!isToolStartEvent(event)) continue;

    const id = getToolCallIdFromStart(event);
    if (!id) continue;
    const kind = eventKind(event);
    const step = eventStep(event);
    const prev = pending.get(id);
    if (!prev) {
      pending.set(id, { event, step, sourceKind: kind });
      continue;
    }

    // v2 stream emits `tool_call` twice for one logical call (start + args complete).
    // If both are same step and same kind, treat the second as args update, not duplicate.
    const sameStepUpdate =
      kind === 'tool_call' &&
      prev.sourceKind === 'tool_call' &&
      prev.step !== null &&
      step !== null &&
      prev.step === step;
    if (sameStepUpdate) continue;

    violations.push({
      invariant: 'duplicate_tool_call_id_without_result',
      description: 'A tool call id was started again before its previous call emitted tool_result.',
      severity: 'error',
      evidence: {
        toolCallId: id,
        previousStart: prev.event,
        duplicateStart: event,
      },
    });
    pending.set(id, { event, step, sourceKind: kind });
  }

  return violations;
}

function checkOrphanToolCalls(events: readonly unknown[]): InvariantViolation[] {
  const openCalls = new Map<string, unknown>();

  for (const event of events) {
    if (isToolStartEvent(event)) {
      const id = getToolCallIdFromStart(event);
      if (id && !openCalls.has(id)) openCalls.set(id, event);
      continue;
    }

    if (isToolResultEvent(event) || isToolQuestionEvent(event)) {
      const id = isToolQuestionEvent(event)
        ? getToolCallIdFromQuestion(event)
        : getToolCallIdFromResult(event);
      if (id) openCalls.delete(id);
      continue;
    }

    const confirmId = getToolCallIdFromConfirm(event);
    if (confirmId) {
      openCalls.delete(confirmId);
      continue;
    }

    if (isTerminalEvent(event)) {
      break;
    }
  }

  const violations: InvariantViolation[] = [];
  for (const [toolCallId, startedEvent] of openCalls) {
    violations.push({
      invariant: 'orphan_tool_call',
      description:
        'A tool call started but did not emit tool_result/tool_question/tool_confirm before run end.',
      severity: 'error',
      evidence: { toolCallId, startedEvent },
    });
  }
  return violations;
}

function checkAskUserEmptyOptions(events: readonly unknown[]): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  for (const event of events) {
    if (!isToolQuestionEvent(event)) continue;
    const rec = asRecord(event);
    const kind = eventKind(event);
    const optionsRaw = rec.options;
    const options = Array.isArray(optionsRaw) ? optionsRaw : [];
    const labels = options
      .map((o) => (typeof asRecord(o).label === 'string' ? String(asRecord(o).label) : ''))
      .map((s) => s.trim());
    const allBlank = labels.length > 0 && labels.every((s) => s.length === 0);
    const missingOrEmpty = options.length === 0;
    const disallowFreeText = kind !== 'question_prompt' || rec.allowFreeText === false;
    if (!disallowFreeText) continue;
    if (!missingOrEmpty && !allBlank) continue;
    violations.push({
      invariant: 'askUser_empty_options',
      description: 'askUser prompt was emitted with empty or invalid options.',
      severity: 'error',
      evidence: {
        toolCallId: getToolCallIdFromQuestion(event),
        event,
      },
    });
  }
  return violations;
}

function checkProcessPromptDuplicateActivation(
  _result: SessionResult,
  events: readonly unknown[],
): InvariantViolation[] {
  // Single authoritative source: raw `evidence_appended` events from the
  // stream. The previous implementation triple-counted by also scanning
  // result.processPromptsInjected and result.evidenceLedger, which are
  // both derived from the same events in run-single.ts.
  const counts = new Map<string, number>();
  for (const event of events) {
    if (eventKind(event) !== 'evidence_appended') continue;
    const evidence = asRecord(event).evidence;
    const evidenceRec = asRecord(evidence);
    if (evidenceRec.kind !== 'process_prompt_activated') continue;
    const key = typeof evidenceRec.key === 'string' ? evidenceRec.key : null;
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const violations: InvariantViolation[] = [];
  for (const [key, n] of counts) {
    if (n <= 1) continue;
    violations.push({
      invariant: 'process_prompt_duplicate_activation',
      description: 'The same process prompt key activated more than once in a session.',
      severity: 'error',
      evidence: { key, count: n },
    });
  }
  return violations;
}

function checkBlockedWaitingUserAfterAnswer(
  result: SessionResult,
  events: readonly unknown[],
): InvariantViolation[] {
  if (result.exitDecision?.outcome !== 'blocked_waiting_user') return [];
  const answeredAts = (result.evidenceLedger ?? [])
    .filter((row) => row.kind === 'ask_user_answered' && typeof row.at === 'number')
    .map((row) => Number(row.at));
  if (answeredAts.length === 0) return [];
  const terminalTs = events
    .filter((event) => isTerminalEvent(event))
    .map((event) => eventTs(event))
    .filter((ts): ts is number => typeof ts === 'number')
    .sort((a, b) => b - a)[0];
  const runEndAt = terminalTs ?? Number.POSITIVE_INFINITY;
  const hasPreRunEndAnswer = answeredAts.some((at) => at < runEndAt);
  if (!hasPreRunEndAnswer) return [];

  return [
    {
      invariant: 'exit_contract_blocked_waiting_user_after_answer',
      description:
        'Exit decision is blocked_waiting_user even though ask_user_answered evidence existed before run end.',
      severity: 'error',
      evidence: {
        runEndAt,
        answeredAts,
        exitDecision: result.exitDecision,
      },
    },
  ];
}

function checkStalledModelStreaming(events: readonly unknown[]): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  let activeSince: number | null = null;
  let lastProgressAt: number | null = null;
  let segmentWarned = false;

  const markActive = (ts: number | null) => {
    if (ts === null) return;
    if (activeSince === null) {
      activeSince = ts;
      lastProgressAt = ts;
      segmentWarned = false;
    }
  };
  const markInactive = () => {
    activeSince = null;
    lastProgressAt = null;
    segmentWarned = false;
  };

  for (const event of events) {
    const kind = eventKind(event);
    const ts = eventTs(event);
    if (kind === 'model_streaming') {
      const rec = asRecord(event);
      const state =
        (typeof rec.phase === 'string' ? rec.phase : '') ||
        (typeof rec.state === 'string' ? rec.state : '') ||
        (typeof rec.status === 'string' ? rec.status : '');
      if (rec.active === true || ['start', 'started', 'active', 'begin', 'enter'].includes(state)) {
        markActive(ts);
      } else if (
        rec.active === false ||
        ['stop', 'stopped', 'inactive', 'end', 'done', 'exit'].includes(state)
      ) {
        markInactive();
      }
    }

    if (activeSince !== null && (isToolStartEvent(event) || isToolResultEvent(event))) {
      if (ts !== null) lastProgressAt = ts;
    }

    if (
      activeSince !== null &&
      ts !== null &&
      lastProgressAt !== null &&
      !segmentWarned &&
      ts - lastProgressAt > 90_000
    ) {
      segmentWarned = true;
      violations.push({
        invariant: 'stalled_model_streaming',
        description:
          'Model streaming stayed active for more than 90s without tool_call/tool_result progress.',
        severity: 'warning',
        evidence: {
          activeSince,
          lastProgressAt,
          observedAt: ts,
        },
      });
    }

    if (isTerminalEvent(event)) {
      markInactive();
    }
  }

  return violations;
}

export function checkInvariants(
  result: SessionResult,
  events: StampedStreamEvent[],
): InvariantViolation[] {
  const normalizedEvents = events as unknown[];
  return [
    ...checkAskUserAnsweredButNoToolResult(normalizedEvents),
    ...checkDuplicateToolCallIdWithoutResult(normalizedEvents),
    ...checkOrphanToolCalls(normalizedEvents),
    ...checkAskUserEmptyOptions(normalizedEvents),
    ...checkProcessPromptDuplicateActivation(result, normalizedEvents),
    ...checkBlockedWaitingUserAfterAnswer(result, normalizedEvents),
    ...checkStalledModelStreaming(normalizedEvents),
  ];
}
