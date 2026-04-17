/**
 * `features/ipc/push-gateway.ts` — Phase F-split-1.
 *
 * The single place in the main process that publishes to a renderer push
 * channel. Today, 30+ handlers call `getWindow()?.webContents.send(...)`
 * directly with raw string channel names; that's:
 *
 *   1. **Type-unsafe** — a typo in the channel name or payload shape only
 *      fails when the renderer listener silently misses the event.
 *   2. **Untraceable** — the window / webContents reference leaks into
 *      handler code, making it hard to swap in a multi-window or
 *      headless gateway later.
 *   3. **Unvalidated** — the payload is never parsed against the push
 *      channel's declared zod schema, so renderer-side parse failures are
 *      the only signal of a payload drift.
 *
 * The gateway fixes all three:
 *
 *   - Callers pass a `PushChannelDef` (from `@lucid-fin/contracts-parse`)
 *     plus a payload. The channel name comes from the def; typos can't
 *     happen.
 *   - The gateway owns the `BrowserWindow` reference (injected via
 *     `getWindow`), so handlers stop reaching for `getWindow()`.
 *   - The payload is `parseStrict`'d against the declared zod schema
 *     before send; invalid payloads throw loudly in main instead of
 *     silently in the renderer.
 *
 * Out of scope in Phase F-split-1: actually migrating the ~31 existing
 * `webContents.send` sites. That's a per-file mechanical pass in later
 * Phase F sub-PRs; introducing the primitive first lets those migrations
 * be reviewed one at a time.
 */

import type { BrowserWindow } from 'electron';
import type { PushChannelDef } from '@lucid-fin/contracts-parse';
import { parseStrict } from '@lucid-fin/contracts-parse';

export interface RendererPushGateway {
  /**
   * Publish a single payload on the given push channel. Silently no-ops
   * when no window is currently available (the main process can reach
   * here during teardown or before the first window opens). Logs via the
   * injected logger when present.
   */
  emit<C extends string, P>(channel: PushChannelDef<C, P>, payload: P): void;
}

export interface RendererPushGatewayDeps {
  getWindow: () => BrowserWindow | null;
  /** Optional structured logger; falls back to `console.warn` when absent. */
  logger?: { warn: (msg: string, detail?: unknown) => void };
}

export function createRendererPushGateway(deps: RendererPushGatewayDeps): RendererPushGateway {
  const warn = (msg: string, detail?: unknown) => {
    if (deps.logger) deps.logger.warn(msg, detail);
    else console.warn(`[push-gateway] ${msg}`, detail ?? '');
  };

  return {
    emit(channel, payload) {
      // Validate first — a malformed payload is a main-process bug,
      // surfacing it here beats shipping a garbage event.
      const parsed = parseStrict(channel.schemas.payload, payload, {
        name: `push:${channel.channel}`,
      });

      const win = deps.getWindow();
      if (!win) {
        // No window yet / already closed. This happens during boot and
        // teardown; surface at warn rather than throw so features don't
        // need to branch on window-present themselves.
        warn(`no BrowserWindow available for push`, { channel: channel.channel });
        return;
      }

      // A destroyed window still surfaces via getWindow() briefly during
      // teardown; guarding here prevents `webContents is destroyed` noise.
      if (win.isDestroyed()) {
        warn(`window is destroyed — dropping push`, { channel: channel.channel });
        return;
      }

      win.webContents.send(channel.channel, parsed);
    },
  };
}
