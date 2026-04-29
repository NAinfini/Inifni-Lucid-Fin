/**
 * Clipboard watcher — Phase F-split-2.
 *
 * Polls the system clipboard while the window is unfocused and notifies
 * the renderer when substantial new text appears (long enough to look
 * like an AI response the user just copied out of a browser tab).
 *
 * Push path migrated onto `RendererPushGateway` so the payload is parsed
 * against the declared zod schema (`clipboardAiDetectedChannel`) before
 * being sent — a payload drift becomes a loud main-process throw instead
 * of a silent renderer-side parse failure.
 */
import { clipboard, type BrowserWindow } from 'electron';
import { clipboardAiDetectedChannel } from '@lucid-fin/contracts-parse';
import {
  createRendererPushGateway,
  type RendererPushGateway,
} from './features/ipc/push-gateway.js';

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastClipboardText = '';
let enabled = true;

export function startClipboardWatcher(win: BrowserWindow, pushGateway?: RendererPushGateway): void {
  // Default-construct a local gateway bound to `win` when one isn't supplied
  // (e.g. tests, callers predating the Phase F split).
  const gateway = pushGateway ?? createRendererPushGateway({ getWindow: () => win });

  lastClipboardText = clipboard.readText() || '';

  intervalId = setInterval(() => {
    if (!enabled) return;
    // Only watch when app is NOT focused (user is in browser copying AI output)
    if (win.isFocused()) return;

    const current = clipboard.readText() || '';
    if (current === lastClipboardText) return;
    // Ignore short clips — only detect substantial AI responses
    if (current.length < 100) {
      lastClipboardText = current;
      return;
    }

    lastClipboardText = current;
    gateway.emit(clipboardAiDetectedChannel, { text: current });
  }, 1500);
}

export function stopClipboardWatcher(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function setClipboardWatcherEnabled(value: boolean): void {
  enabled = value;
}
