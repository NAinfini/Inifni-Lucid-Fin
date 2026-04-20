/**
 * `hooks/useElapsed.ts` — Phase 3 live-progress architecture.
 *
 * Returns the number of milliseconds since a reference timestamp, ticking
 * once per second. Passing `since === null` freezes the value at 0 — used
 * when the RunPhase is idle/done/failed and no elapsed display is needed.
 *
 * Each caller owns its own interval; unmounts clean up. No global timer,
 * no subscriptions to share — the elapsed value is cheap to recompute and
 * the 1 Hz cadence is plenty for a human-readable timer.
 */

import { useEffect, useState } from 'react';

export function useElapsed(since: number | null): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  if (since === null) return 0;
  return Math.max(0, now - since);
}
