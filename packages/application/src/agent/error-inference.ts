/**
 * Error-inference helpers.
 *
 * Shared between the orchestrator and the tool-executor: map a free-text
 * error message to the structured `CommanderErrorCode` enum, and coerce
 * any phase-note string into the strict `PhaseNoteCode` union.
 */

import type { CommanderErrorCode, PhaseNoteCode } from '@lucid-fin/contracts';

export function coercePhaseNoteCode(raw: string): PhaseNoteCode {
  switch (raw) {
    case 'llm_retry':
    case 'compacted':
    case 'prompt_loaded':
    case 'tool_skipped_dedup':
    case 'max_steps_warning':
    case 'intent_reclassified':
      return raw;
    case 'process_prompt_loaded':
      return 'prompt_loaded';
    default:
      return 'compacted';
  }
}

export function inferErrorCodeFromMessage(message: string): CommanderErrorCode {
  const lower = message.toLowerCase();
  if (lower.includes('cancel')) return 'RUN_CANCELLED';
  if (lower.includes('rate limit') || lower.includes('stall')) return 'LLM_TRANSIENT';
  if (lower.includes('max steps')) return 'RUN_MAX_STEPS';
  if (lower.includes('validation') || lower.includes('invalid argument')) return 'TOOL_VALIDATION';
  if (lower.includes('not found')) return 'TOOL_NOT_FOUND';
  if (lower.includes('permission') || lower.includes('declined')) return 'TOOL_PERMISSION';
  return 'TOOL_RUNTIME';
}
