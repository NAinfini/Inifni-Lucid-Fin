/**
 * `utils/flush-on-quit.ts`
 *
 * Listens for the `app:flush-before-quit` signal from the main process and
 * flushes all pending debounced saves (canvas + settings) before replying
 * with `app:flush-complete`. This eliminates the data-loss window between
 * the last edit and app shutdown.
 *
 * Must be called once at app startup (from main.tsx or App.tsx) after the
 * preload bridge is available.
 */

import { flushPendingPersistence } from '../store/middleware/persist.js';

let registered = false;

/**
 * Register the flush-before-quit listener. Idempotent -- safe to call
 * multiple times (e.g. React StrictMode double-mount).
 */
export function registerFlushOnQuit(): void {
  if (registered) return;

  const api = typeof window !== 'undefined' ? window.lucidAPI : undefined;
  if (!api) return;

  // Subscribe to the main-process push signal
  const unsub = api.onFlushBeforeQuit(() => {
    void flushPendingPersistence()
      .then(() => {
        console.info('[flush-on-quit] Pending canvas and settings saves completed');
      })
      .catch((error: unknown) => {
        console.error('[flush-on-quit] Failed to flush pending saves', error);
      })
      .finally(() => {
        api.sendFlushComplete();
      });
  });

  // We never unsubscribe -- this lives for the lifetime of the app.
  // Capture unsub to suppress "unused" lint if needed.
  void unsub;
  registered = true;
}
