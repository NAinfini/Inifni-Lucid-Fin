import type { Middleware } from '@reduxjs/toolkit';

import { t } from '../../i18n.js';
import type { CommanderSession } from '../../commander/state/types.js';
import { sanitizeCommanderMessages } from '../../commander/state/session-persistence.js';
import { getAPI } from '../../utils/api.js';
import { withRetry } from '../../utils/ipc-retry.js';
import {
  addSystemNotice,
  addUserMessage,
  appendFinalizedAssistantMessage,
  clearHistory,
  finishStreaming,
  newSession,
  renameSession,
  streamError,
  upsertFinalizedAssistantMessage,
} from '../slices/commander.js';
import { addLog } from '../slices/logger.js';
import { enqueueToast } from '../slices/toast.js';

type CommanderRoot = { commander: { sessions: CommanderSession[] } };
type SessionSnapshot = Pick<
  CommanderSession,
  'id' | 'defaultCanvasId' | 'title' | 'createdAt' | 'updatedAt'
> & { messages: string };

const PERSISTED_SESSION_ACTIONS = new Set<string>([
  newSession.type,
  addUserMessage.type,
  appendFinalizedAssistantMessage.type,
  upsertFinalizedAssistantMessage.type,
  finishStreaming.type,
  streamError.type,
  clearHistory.type,
  renameSession.type,
  addSystemNotice.type,
]);

const pendingSnapshots = new Map<string, SessionSnapshot>();
const inFlightSaves = new Map<string, Promise<void>>();

function sessionIdFromAction(action: { type: string; payload?: unknown }): string | null {
  if (typeof action.payload === 'string') return action.payload;
  if (!action.payload || typeof action.payload !== 'object') return null;
  const payload = action.payload as { id?: unknown; sessionId?: unknown };
  if (typeof payload.sessionId === 'string') return payload.sessionId;
  return typeof payload.id === 'string' ? payload.id : null;
}

function snapshotSession(session: CommanderSession): SessionSnapshot {
  return {
    id: session.id,
    defaultCanvasId: session.defaultCanvasId,
    title: session.title,
    messages: JSON.stringify(sanitizeCommanderMessages(session.messages)),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function reportFailure(store: Parameters<Middleware>[0], error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  store.dispatch(
    addLog({
      level: 'error',
      category: 'persistence',
      message: 'Commander session save failed',
      detail,
    }),
  );
  store.dispatch(
    enqueueToast({
      variant: 'error',
      title: t('persistence.saveFailed'),
      message: detail,
    }),
  );
}

function drainSession(sessionId: string, store: Parameters<Middleware>[0]): Promise<void> {
  const running = inFlightSaves.get(sessionId);
  if (running) return running;

  const promise = (async () => {
    while (pendingSnapshots.has(sessionId)) {
      const snapshot = pendingSnapshots.get(sessionId);
      pendingSnapshots.delete(sessionId);
      if (!snapshot) continue;
      const sessionApi = getAPI()?.session;
      if (!sessionApi?.upsert) throw new Error('Session persistence API is unavailable');
      await withRetry(() => sessionApi.upsert(snapshot));
    }
  })()
    .catch((error) => reportFailure(store, error))
    .finally(() => {
      inFlightSaves.delete(sessionId);
      if (pendingSnapshots.has(sessionId)) void drainSession(sessionId, store);
    });

  inFlightSaves.set(sessionId, promise);
  return promise;
}

export async function flushPendingCommanderSessionSaves(): Promise<void> {
  while (inFlightSaves.size > 0) await Promise.all([...inFlightSaves.values()]);
}

export const commanderSessionPersistenceMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action);
  if (typeof action !== 'object' || action === null || !('type' in action)) return result;

  const typed = action as { type: string; payload?: unknown };
  if (!PERSISTED_SESSION_ACTIONS.has(typed.type) || !getAPI()?.session?.upsert) return result;
  const sessionId = sessionIdFromAction(typed);
  if (!sessionId) return result;
  const session = (store.getState() as CommanderRoot).commander.sessions.find(
    (candidate) => candidate.id === sessionId,
  );
  if (!session || session.messages.length !== session.messageCount) return result;

  pendingSnapshots.set(sessionId, snapshotSession(session));
  void drainSession(sessionId, store);
  return result;
};
