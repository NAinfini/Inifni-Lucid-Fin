/**
 * Commander structured error codes — Phase A.
 *
 * Replaces free-text English error strings that were concatenated in
 * backend and crossed the IPC boundary (W3 in parent PRD). Every error
 * the renderer can surface is now a `{ code, params }` pair; i18n keys
 * keyed on `code` render the user-visible string. Never format error
 * messages in backend after Phase B.
 *
 * Consumers:
 *   - Orchestrator / tool-executor emit `CommanderError` in
 *     `ToolResultEvent.error` and `PhaseNoteEvent.params` (Phase B).
 *   - Renderer renders via `t('commander.errorCode.' + code, params)`
 *     (Phase H).
 *   - CI drift lint enforces every code has i18n coverage in both
 *     locales (Phase H).
 */

export type CommanderErrorCode =
  | 'LLM_TRANSIENT'
  | 'LLM_FATAL'
  | 'TOOL_VALIDATION'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_PERMISSION'
  | 'TOOL_RUNTIME'
  | 'STREAM_STALLED'
  | 'RUN_CANCELLED'
  | 'RUN_MAX_STEPS'
  | 'CONTRACT_UNSATISFIED'
  | 'RUN_ENDED_BEFORE_RESULT';

/**
 * `params` values are limited to JSON-primitive types so the whole error
 * can be serialized over IPC and stored in persistence without special
 * handling. Renderer i18n templates interpolate these by name.
 */
export interface CommanderError {
  code: CommanderErrorCode;
  params: Record<string, string | number | boolean | null>;
}

/**
 * All codes as a tuple for iteration (e.g. drift-lint coverage check).
 * Kept in sync with the union above by design: adding a code to the
 * union without adding it here is a compile error inside `_drift`
 * below.
 */
export const COMMANDER_ERROR_CODES = [
  'LLM_TRANSIENT',
  'LLM_FATAL',
  'TOOL_VALIDATION',
  'TOOL_NOT_FOUND',
  'TOOL_PERMISSION',
  'TOOL_RUNTIME',
  'STREAM_STALLED',
  'RUN_CANCELLED',
  'RUN_MAX_STEPS',
  'CONTRACT_UNSATISFIED',
  'RUN_ENDED_BEFORE_RESULT',
] as const satisfies readonly CommanderErrorCode[];

// Compile-time drift guard: forces `COMMANDER_ERROR_CODES` to cover the
// full union. If a code is added to the union but not to the array (or
// vice versa) this line fails to compile.
type _DriftCheck = Exclude<CommanderErrorCode, (typeof COMMANDER_ERROR_CODES)[number]>;
const _drift: _DriftCheck extends never ? true : false = true;
void _drift;
