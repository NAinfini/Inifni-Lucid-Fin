/**
 * `commander/state/run-phase.ts` — Phase 3 live-progress architecture.
 *
 * Replaces the boolean `streaming` flag with a precise state machine
 * describing what the agent is doing right now. Drives the LiveActivityBar,
 * honest elapsed timers, and cursor gating.
 *
 * The transition function `phaseFromEvent` is a pure reducer: `(prev, event) → next`.
 * Every stream event kind is handled explicitly. The `default` branch of the
 * switch is `assertNever(event)` so adding a new event kind on the wire
 * surfaces as a compile error here — you cannot forget to route it through
 * the phase machine.
 */

import type { CommanderStreamEvent } from '../transport/CommanderTransport.js';
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

/**
 * Pure transition function for RunPhase. Takes the previous phase + the
 * next stream event and produces the next phase. Does NOT mutate inputs.
 */
export function phaseFromEvent(prev: RunPhase, event: CommanderStreamEvent): RunPhase {
  switch (event.kind) {
    case 'chunk': {
      // Model is mid-stream — either we were already streaming and update
      // `lastTextDeltaAt`, or we transition from awaiting/tool_running back
      // into streaming on this step.
      const step = event.step;
      const now = event.emittedAt;
      if (prev.kind === 'model_streaming' && prev.step === step) {
        return { ...prev, lastTextDeltaAt: now };
      }
      return { kind: 'model_streaming', step, since: now, lastTextDeltaAt: now };
    }
    case 'thinking_delta':
      // Thinking deltas live in the `model_streaming` phase too — the model
      // is producing output, even if reasoning rather than final text.
      if (prev.kind === 'model_streaming' && prev.step === event.step) {
        return prev;
      }
      return {
        kind: 'model_streaming',
        step: event.step,
        since: event.emittedAt,
        lastTextDeltaAt: null,
      };
    case 'tool_call_started': {
      const tools =
        prev.kind === 'tool_running' && prev.step === event.step
          ? prev.tools.includes(event.toolCallId)
            ? prev.tools
            : [...prev.tools, event.toolCallId]
          : [event.toolCallId];
      const since = prev.kind === 'tool_running' && prev.step === event.step ? prev.since : event.emittedAt;
      return { kind: 'tool_running', step: event.step, tools, since };
    }
    case 'tool_call_args_delta':
    case 'tool_call_args_complete':
      // Args streaming is a pure data channel — the phase stays in whatever
      // tool_running / model_streaming state the pair started from.
      return prev;
    case 'tool_result': {
      if (prev.kind !== 'tool_running') {
        // Out-of-order result — the orchestrator is about to ship the next
        // chunk/tool. Don't invent state; fall back to awaiting_model on the
        // same step so the UI doesn't flicker to idle.
        return { kind: 'awaiting_model', step: event.step, since: event.emittedAt };
      }
      const remaining = prev.tools.filter((id) => id !== event.toolCallId);
      if (remaining.length === 0) {
        return { kind: 'awaiting_model', step: event.step, since: event.emittedAt };
      }
      return { ...prev, tools: remaining };
    }
    case 'tool_confirm':
      return {
        kind: 'awaiting_confirmation',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        since: event.emittedAt,
      };
    case 'tool_question':
      return {
        kind: 'awaiting_question',
        toolCallId: event.toolCallId,
        question: event.question,
        since: event.emittedAt,
      };
    case 'context_usage':
      // Ephemeral metrics — does not drive the phase machine. The reducer
      // stores `backendContextUsage` separately, so we pass through.
      return prev;
    case 'phase_note':
      // Informational status-line segments (llm_retry, compacted,
      // process_prompt_loaded). They annotate the run but don't change
      // which phase we're in — the retry's NEXT `chunk` / `tool_call_started`
      // moves the machine forward.
      return prev;
    case 'done':
      return { kind: 'done' };
    case 'error':
      return { kind: 'failed', error: event.error };
    default:
      return assertNever(event, 'phaseFromEvent');
  }
}

/**
 * Whether the Commander is currently in an active run (sending / awaiting /
 * streaming / running tools / awaiting input). Everything except idle /
 * done / failed counts as "streaming" for the purposes of UI gating.
 */
export function isActivePhase(phase: RunPhase): boolean {
  return phase.kind !== 'idle' && phase.kind !== 'done' && phase.kind !== 'failed';
}
