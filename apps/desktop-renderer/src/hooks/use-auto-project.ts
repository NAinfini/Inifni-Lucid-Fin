import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../store/index.js';
import { setProject } from '../store/slices/project.js';
import { restore as restoreSettings } from '../store/slices/settings.js';
import { enqueueToast } from '../store/slices/toast.js';
import type { SettingsState } from '../store/slices/settings.js';
import { getAPI } from '../utils/api.js';

export function useAutoProject() {
  const dispatch = useDispatch();
  const loaded = useSelector((s: RootState) => s.project.loaded);
  const ran = useRef(false);
  const toastedVersion = useRef<string | null>(null);

  useEffect(() => {
    if (loaded || ran.current) return;
    const api = getAPI();
    if (!api) return;

    const unsubscribeUpdater = api.updater.onProgress((status) => {
      const version = status.info?.version;
      if (status.state !== 'available' || !version || toastedVersion.current === version) return;
      toastedVersion.current = version;
      dispatch(enqueueToast({
        variant: 'info',
        title: 'New version available',
        message: `Version ${version} is available. Go to Settings to update.`,
        durationMs: 8000,
      }));
    });

    const unsub = api.onReady(async () => {
      if (ran.current) return;
      ran.current = true;
      try {
        // Restore app-level settings
        const savedSettings = await api.settings.load() as SettingsState | null;
        if (savedSettings) {
          dispatch(restoreSettings(savedSettings));
        }

        const list = await api.project.list();
        if (list.length > 0) {
          const recent = list.sort((a, b) => b.updatedAt - a.updatedAt)[0];
          const manifest = await api.project.open(recent.path);
          dispatch(setProject({ ...manifest, path: recent.path }));
        } else {
          const manifest = await api.project.create({ title: 'My Project' });
          const refreshed = await api.project.list();
          const entry = refreshed.find((p) => p.id === manifest.id);
          dispatch(setProject({ ...manifest, path: entry?.path ?? '' }));
        }
      } catch (err) {
        console.error('[useAutoProject] failed:', err);
        ran.current = false;
      }
    });

    return () => {
      unsubscribeUpdater();
      unsub();
    };
  }, [dispatch, loaded]);
}
