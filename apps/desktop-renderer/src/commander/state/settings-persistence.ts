/**
 * `commander/state/settings-persistence.ts` — Phase E split-1.
 *
 * localStorage persistence for Commander's user-tunable settings
 * (permissionMode, maxSteps, temperature, ...). Separated from session
 * persistence so each concern has a single-reason-to-change module.
 */

import { COMMANDER_SETTINGS_KEY } from './constants.js';
import type { CommanderState, PersistedSettings } from './types.js';

export function loadPersistedSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(COMMANDER_SETTINGS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as PersistedSettings;
  } catch {
    return {};
  }
}

function persistSettings(settings: PersistedSettings): void {
  try {
    localStorage.setItem(COMMANDER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* localStorage unavailable */
  }
}

export function persistSettingsFromState(state: CommanderState): void {
  persistSettings({
    permissionMode: state.permissionMode,
    maxSteps: state.maxSteps,
    temperature: state.temperature,
    maxTokens: state.maxTokens,
    llmRetries: state.llmRetries,
    maxSessions: state.maxSessions,
    maxMessagesPerSession: state.maxMessagesPerSession,
    undoStackDepth: state.undoStackDepth,
    maxLogEntries: state.maxLogEntries,
    autoSaveDelayMs: state.autoSaveDelayMs,
    undoGroupWindowMs: state.undoGroupWindowMs,
    clipboardWatchIntervalMs: state.clipboardWatchIntervalMs,
    clipboardMinLength: state.clipboardMinLength,
    generationConcurrency: state.generationConcurrency,
  });
}
