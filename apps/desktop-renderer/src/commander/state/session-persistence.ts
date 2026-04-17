/**
 * `commander/state/session-persistence.ts` — Phase E split-1.
 *
 * localStorage persistence for Commander sessions + provider id. Extracted
 * from the original slice so reducers stay focused on state transitions.
 *
 * All functions are fault-tolerant: localStorage may be unavailable
 * (privacy mode), the blob may be malformed, or quota may be exceeded.
 * On failure we fall back to safe defaults — the user's in-memory state is
 * never corrupted by a broken persist.
 */

import {
  COMMANDER_PROVIDER_KEY,
  COMMANDER_SESSIONS_KEY,
  MAX_MESSAGES_PER_SESSION,
  MAX_SESSIONS,
  MAX_STORAGE_BYTES,
} from './constants.js';
import { deriveSessionTitle, hasUserMessage } from './helpers.js';
import type { CommanderSession, CommanderState } from './types.js';

export function loadPersistedProviderId(): string | null {
  try {
    return localStorage.getItem(COMMANDER_PROVIDER_KEY);
  } catch {
    return null;
  }
}

export function writePersistedProviderId(providerId: string | null): void {
  try {
    if (providerId) {
      localStorage.setItem(COMMANDER_PROVIDER_KEY, providerId);
    } else {
      localStorage.removeItem(COMMANDER_PROVIDER_KEY);
    }
  } catch {
    /* localStorage unavailable */
  }
}

export function loadPersistedSessions(): CommanderSession[] {
  try {
    const raw = localStorage.getItem(COMMANDER_SESSIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CommanderSession[];
  } catch {
    return [];
  }
}

function trimSessionForStorage(session: CommanderSession): CommanderSession {
  if (session.messages.length <= MAX_MESSAGES_PER_SESSION) return session;
  return {
    ...session,
    messages: session.messages.slice(-MAX_MESSAGES_PER_SESSION),
  };
}

export function persistSessions(sessions: CommanderSession[]): void {
  const trimmed = sessions.slice(0, MAX_SESSIONS).map(trimSessionForStorage);
  try {
    const json = JSON.stringify(trimmed);
    if (json.length > MAX_STORAGE_BYTES) {
      // Drop oldest sessions until we fit
      let shrunk = trimmed;
      while (shrunk.length > 1 && JSON.stringify(shrunk).length > MAX_STORAGE_BYTES) {
        shrunk = shrunk.slice(0, -1);
      }
      localStorage.setItem(COMMANDER_SESSIONS_KEY, JSON.stringify(shrunk));
      return;
    }
    localStorage.setItem(COMMANDER_SESSIONS_KEY, json);
  } catch {
    // QuotaExceededError — evict oldest half and retry once
    try {
      const halved = trimmed.slice(0, Math.max(1, Math.floor(trimmed.length / 2)));
      localStorage.setItem(COMMANDER_SESSIONS_KEY, JSON.stringify(halved));
    } catch {
      // Completely full — clear sessions to prevent data loss elsewhere
      try {
        localStorage.removeItem(COMMANDER_SESSIONS_KEY);
      } catch {
        /* noop */
      }
    }
  }
}

/**
 * Persist the current in-memory session into `state.sessions` AND to
 * localStorage. Mutates `state` — exclusively called from within reducers.
 */
export function persistCurrentSession(state: CommanderState): void {
  if (!hasUserMessage(state.messages)) {
    return;
  }

  if (!state.activeSessionId) {
    state.activeSessionId = crypto.randomUUID();
  }

  const now = Date.now();
  const existing = state.sessions.findIndex((session) => session.id === state.activeSessionId);
  const session: CommanderSession = {
    id: state.activeSessionId,
    canvasId: state.activeCanvasId,
    title: deriveSessionTitle(state.messages),
    messages: state.messages,
    createdAt: existing >= 0 ? state.sessions[existing].createdAt : now,
    updatedAt: now,
  };

  if (existing >= 0) {
    state.sessions[existing] = session;
  } else {
    state.sessions.unshift(session);
  }

  if (state.sessions.length > MAX_SESSIONS) {
    state.sessions = state.sessions.slice(0, MAX_SESSIONS);
  }

  persistSessions(state.sessions);
}
