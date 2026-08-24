import { useEffect, useRef } from 'react';
import { useDispatch, useStore } from 'react-redux';
import {
  restore as restoreSettings,
  setAvailableUpdate,
  setBootstrapped,
  setInitializationError,
} from '../store/slices/settings.js';
import { addLog } from '../store/slices/logger.js';
import { enqueueToast } from '../store/slices/toast.js';
import { loadSessionsFromDB } from '../store/slices/commander.js';
import type { CommanderSession } from '../store/slices/commander.js';
import { createCommanderSessionRuntime } from '../commander/state/helpers.js';
import type { SettingsState } from '../store/slices/settings.js';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';
import type { RootState } from '../store/index.js';

// Module-level singleton: survives React StrictMode double-mount.
let bootstrapRan = false;
let settingsRestored = false;

/** Max sessions to load from SQLite on startup. */
const MAX_SESSIONS_TO_LOAD = 50;

/** @internal Reset for test isolation — do not use in production code. */
export function _resetBootstrapForTest() {
  bootstrapRan = false;
  settingsRestored = false;
}

export function useBootstrap() {
  const dispatch = useDispatch();
  const reduxStore = useStore<RootState>();
  const toastedVersion = useRef<string | null>(null);

  useEffect(() => {
    if (bootstrapRan) return;
    const api = getAPI();
    if (!api) return;

    const unsubscribeUpdater = api.updater.onProgress((status) => {
      const version = status.info?.version;
      if (status.state === 'available' && version) {
        dispatch(setAvailableUpdate(version));
        if (toastedVersion.current !== version) {
          toastedVersion.current = version;
          dispatch(
            enqueueToast({
              variant: 'info',
              title: t('settings.update.toastTitle'),
              message: t('settings.update.toastMessage').replace('{version}', version),
              durationMs: 8000,
            }),
          );
        }
      }
    });

    const unsubscribeInitError = api.onInitError?.((error) => {
      const detail = typeof error === 'string' ? error : String(error);
      dispatch(setInitializationError(detail));
      dispatch(
        addLog({
          level: 'error',
          category: 'startup',
          message: t('startup.initializationFailed'),
          detail,
        }),
      );
      dispatch(
        enqueueToast({
          variant: 'error',
          title: t('startup.initializationFailed'),
          message: t('startup.initializationFailedHint'),
          durationMs: 0,
        }),
      );
    }) ?? (() => undefined);

    const unsub = api.onReady(async () => {
      if (bootstrapRan) return;
      bootstrapRan = true;
      dispatch(setInitializationError(null));
      try {
        const savedSettings = (await api.settings.load()) as SettingsState | null;

        if (!settingsRestored) {
          dispatch(restoreSettings(savedSettings ?? ({} as SettingsState)));
          settingsRestored = true;
        }
        dispatch(setBootstrapped());

        // Load persisted Commander sessions from SQLite (fire-and-forget)
        api.session
          ?.list(MAX_SESSIONS_TO_LOAD)
          .then(async (rows) => {
            const localSessions = reduxStore.getState().commander.sessions;
            const rowsById = new Map(rows.map((row) => [row.id, row]));
            const repairs = localSessions.filter((session) => {
              const row = rowsById.get(session.id);
              return (
                session.messages.length === session.messageCount &&
                session.messages.length > 0 &&
                (!row ||
                  (session.updatedAt > row.updatedAt && session.messageCount >= row.messageCount))
              );
            });
            await Promise.all(
              repairs.map((session) => {
                const row = rowsById.get(session.id);
                return api.session.upsert({
                  id: session.id,
                  defaultCanvasId: row ? row.defaultCanvasId : session.defaultCanvasId,
                  title: session.title,
                  messages: JSON.stringify(session.messages),
                  createdAt: session.createdAt,
                  updatedAt: session.updatedAt,
                });
              }),
            );

            const sessions: CommanderSession[] = rows.map((row) => {
              const local = localSessions.find((session) => session.id === row.id);
              const localIsNewer =
                local &&
                local.updatedAt >= row.updatedAt &&
                local.messages.length === local.messageCount &&
                local.messageCount >= row.messageCount;
              return {
                id: row.id,
                defaultCanvasId: row.defaultCanvasId,
                title: localIsNewer ? local.title : row.title,
                messages: [],
                messageCount: row.messageCount,
                runtime: createCommanderSessionRuntime(),
                createdAt: row.createdAt,
                updatedAt: localIsNewer ? local.updatedAt : row.updatedAt,
              };
            });
            if (sessions.length > 0) {
              dispatch(loadSessionsFromDB(sessions));
            }
          })
          .catch((err) => {
            console.warn('[bootstrap] session load failed:', err);
          });
      } catch (err) {
        dispatch(
          addLog({
            level: 'error',
            category: 'startup',
            message: t('startup.bootstrapFailed'),
            detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
          }),
        );
        dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.bootstrapFailed'),
            message: err instanceof Error ? err.message : String(err),
          }),
        );
        bootstrapRan = false;
      }
    });

    return () => {
      unsubscribeUpdater();
      unsubscribeInitError();
      unsub();
    };
  }, [dispatch, reduxStore]);
}
