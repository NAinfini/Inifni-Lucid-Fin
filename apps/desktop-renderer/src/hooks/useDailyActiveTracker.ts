import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { updateDailyActive } from '../store/slices/settings.js';

const TICK_INTERVAL_MS = 60_000; // 1 minute

/**
 * Tracks daily active usage by incrementing a per-date minute counter every 60s
 * while the app is in the foreground. Pauses when the window is hidden.
 */
export function useDailyActiveTracker(): void {
  const dispatch = useDispatch();
  const visibleRef = useRef(!document.hidden);

  useEffect(() => {
    const handleVisibility = () => {
      visibleRef.current = !document.hidden;
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const interval = setInterval(() => {
      if (!visibleRef.current) return;
      const date = new Date().toISOString().slice(0, 10);
      dispatch(updateDailyActive({ date, minutes: 1 }));
    }, TICK_INTERVAL_MS);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
    };
  }, [dispatch]);
}
