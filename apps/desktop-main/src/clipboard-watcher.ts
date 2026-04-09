import { clipboard, type BrowserWindow } from 'electron';

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastClipboardText = '';
let enabled = true;

export function startClipboardWatcher(win: BrowserWindow): void {
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
    win.webContents.send('clipboard:ai-detected', { text: current });
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
