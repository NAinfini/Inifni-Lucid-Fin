/**
 * `commander/state/constants.ts` — Phase E split-1.
 *
 * localStorage keys + budget constants + initial-value defaults for the
 * commander slice. Extracted as-is from the original slice; no behavior
 * change.
 */

export const COMMANDER_PROVIDER_KEY = 'lucid-commander-provider-v1';
export const COMMANDER_SESSIONS_KEY = 'lucid-commander-sessions-v1';
export const COMMANDER_SETTINGS_KEY = 'lucid-commander-settings-v1';
export const MAX_SESSIONS = 50;
/** Max messages kept per session in localStorage to avoid hitting the 5 MB quota. */
export const MAX_MESSAGES_PER_SESSION = 200;
/** Approx byte budget for the serialised session blob (4 MB leaves headroom). */
export const MAX_STORAGE_BYTES = 4 * 1024 * 1024;

export const DEFAULT_MAX_STEPS = 50;
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_MAX_TOKENS = 200000;
export const DEFAULT_LLM_RETRIES = 2;
export const DEFAULT_MAX_SESSIONS = 50;
export const DEFAULT_MAX_MESSAGES_PER_SESSION = 200;
export const DEFAULT_UNDO_STACK_DEPTH = 100;
export const DEFAULT_MAX_LOG_ENTRIES = 500;
export const DEFAULT_AUTO_SAVE_DELAY_MS = 500;
export const DEFAULT_UNDO_GROUP_WINDOW_MS = 300;
export const DEFAULT_CLIPBOARD_WATCH_INTERVAL_MS = 1500;
export const DEFAULT_CLIPBOARD_MIN_LENGTH = 100;
export const DEFAULT_GENERATION_CONCURRENCY = 1;
