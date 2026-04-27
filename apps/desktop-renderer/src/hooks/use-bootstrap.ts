import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { setJobs } from '../store/slices/jobs.js';
import { restore as restoreSettings, setAvailableUpdate, setBootstrapped } from '../store/slices/settings.js';
import { addLog } from '../store/slices/logger.js';
import { enqueueToast } from '../store/slices/toast.js';
import { loadSessionsFromDB } from '../store/slices/commander.js';
import type { CommanderSession } from '../store/slices/commander.js';
import type { SettingsState } from '../store/slices/settings.js';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';

// Module-level singleton: survives React StrictMode double-mount.
let bootstrapRan = false;

/** Max sessions to load from SQLite on startup. */
const MAX_SESSIONS_TO_LOAD = 50;

/** @internal Reset for test isolation — do not use in production code. */
export function _resetBootstrapForTest() {
  bootstrapRan = false;
}

export function useBootstrap() {
  const dispatch = useDispatch();
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
          dispatch(enqueueToast({
            variant: 'info',
            title: t('settings.update.toastTitle'),
            message: t('settings.update.toastMessage').replace('{version}', version),
            durationMs: 8000,
          }));
        }
      }
    });

    const unsub = api.onReady(async () => {
      if (bootstrapRan) return;
      bootstrapRan = true;
      try {
        const [savedSettings, jobs] = await Promise.all([
          api.settings.load() as Promise<SettingsState | null>,
          api.job.list({}),
        ]);

        dispatch(restoreSettings(savedSettings ?? ({} as SettingsState)));
        dispatch(setJobs(jobs as Array<{ id: string; status: string }>));
        dispatch(setBootstrapped());

        // Load persisted Commander sessions from SQLite (fire-and-forget)
        api.session?.list(MAX_SESSIONS_TO_LOAD).then((rows) => {
          const sessions: CommanderSession[] = rows.map((r) => ({
            id: r.id,
            canvasId: (r as { canvasId?: string | null }).canvasId ?? null,
            title: r.title,
            messages: [], // Lazy-loaded when user clicks the session
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          }));
          if (sessions.length > 0) {
            dispatch(loadSessionsFromDB(sessions));
          }
        }).catch(() => {});
      } catch (err) {
        dispatch(
          addLog({
            level: 'error',
            category: 'startup',
            message: t('startup.bootstrapFailed'),
            detail: err instanceof Error ? err.stack ?? err.message : String(err),
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
      unsub();
    };
  }, [dispatch]);
}
