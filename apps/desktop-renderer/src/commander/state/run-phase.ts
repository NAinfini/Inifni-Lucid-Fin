/**
 * `commander/state/run-phase.ts` — v2 cutover.
 *
 * State machine describing what the agent is doing right now. Drives the
 * LiveActivityBar, honest elapsed timers, and cursor gating.
 *
 * `phaseFromEvent` is a pure reducer: `(prev, event) → next`. Every
 * `TimelineEvent.kind` is handled explicitly. The `default` branch is
 * `assertNever(event)` so adding a new event kind surfaces as a compile
 * error.
 */

import type { TimelineEvent } from '@lucid-fin/contracts';
import { assertNever } from '../../utils/assert-never.js';

export type ToolCallId = string;

export type RunPhase =
  | { kind: 'idle' }
  | { kind: 'awaiting_model'; step: number; since: number }
  | {
      kind: 'model_streaming';
      step: number;
      since: number;
      lastTextDeltaAt: number | null;
    }
  | { kind: 'tool_running'; step: number; tools: ToolCallId[]; since: number }
  | {
      kind: 'awaiting_confirmation';
      toolCallId: ToolCallId;
      toolName: string;
      since: number;
    }
  | {
      kind: 'awaiting_question';
      toolCallId: ToolCallId;
      question: string;
      since: number;
    }
  | { kind: 'compacting'; since: number }
  | { kind: 'failed'; error: string }
  | { kind: 'done' };

export const idlePhase: RunPhase = { kind: 'idle' };

export function phaseFromEvent(prev: RunPhase, event: TimelineEvent): RunPhase {
  switch (event.kind) {
    case 'run_start':
      return { kind: 'awaiting_model', step: event.step, since: event.emittedAt };
    case 'assistant_text': {
      const step = event.step;
      const now = event.emittedAt;
      if (prev.kind === 'model_streaming' && prev.step === step) {
        return event.isDelta ? { ...prev, lastTextDeltaAt: now } : prev;
      }
      return { kind: 'model_streaming', step, since: now, lastTextDeltaAt: now };
    }
    case 'thinking': {
      if (prev.kind === 'model_streaming' && prev.step === event.step) return prev;
      return {
        kind: 'model_streaming',
        step: event.step,
        since: event.emittedAt,
        lastTextDeltaAt: null,
      };
    }
    case 'tool_call': {
      const tools =
        prev.kind === 'tool_running' && prev.step === event.step
          ? prev.tools.includes(event.toolCallId)
            ? prev.tools
            : [...prev.tools, event.toolCallId]
          : [event.toolCallId];
      const since =
        prev.kind === 'tool_running' && prev.step === event.step ? prev.since : event.emittedAt;
      return { kind: 'tool_running', step: event.step, tools, since };
    }
    case 'tool_result': {
      if (prev.kind !== 'tool_running') {
        return { kind: 'awaiting_model', step: event.step, since: event.emittedAt };
      }
      const remaining = prev.tools.filter((id) => id !== event.toolCallId);
      if (remaining.length === 0) {
        return { kind: 'awaiting_model', step: event.step, since: event.emittedAt };
      }
      return { ...prev, tools: remaining };
    }
    case 'tool_confirm_prompt':
      return {
        kind: 'awaiting_confirmation',
        toolCallId: event.toolCallId,
        toolName: `${event.toolRef.domain}.${event.toolRef.action}`,
        since: event.emittedAt,
      };
    case 'question_prompt':
      return {
        kind: 'awaiting_question',
        toolCallId: event.questionId,
        question: event.prompt,
        since: event.emittedAt,
      };
    case 'user_message':
    case 'user_confirmation':
    case 'user_answer':
      // User-side events don't transition the agent's phase; the next
      // agent-side event (run_end, tool_call, assistant_text) will.
      return prev;
    case 'phase_note':
      return prev;
    case 'run_end':
      return event.status === 'failed' ? { kind: 'failed', error: 'run_failed' } : { kind: 'done' };
    case 'cancelled':
      return { kind: 'done' };
    default:
      return assertNever(event, 'phaseFromEvent');
  }
}

export function isActivePhase(phase: RunPhase): boolean {
  return phase.kind !== 'idle' && phase.kind !== 'done' && phase.kind !== 'failed';
}
