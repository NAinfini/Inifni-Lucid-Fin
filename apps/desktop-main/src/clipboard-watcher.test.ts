import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readTextMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  clipboard: {
    readText: readTextMock,
  },
}));

import {
  setClipboardWatcherEnabled,
  startClipboardWatcher,
  stopClipboardWatcher,
} from './clipboard-watcher.js';

function createWindow(isFocused = false) {
  return {
    isFocused: vi.fn(() => isFocused),
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
  vi.clearAllTimers();
  readTextMock.mockReset();
  setClipboardWatcherEnabled(true);
});

afterEach(() => {
  stopClipboardWatcher();
  setClipboardWatcherEnabled(true);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('clipboard watcher', () => {
  it('emits clipboard:ai-detected when unfocused clipboard text changes to a long value', async () => {
    const longText = 'A'.repeat(120);
    readTextMock.mockReturnValueOnce('existing').mockReturnValueOnce(longText);
    const win = createWindow(false);

    startClipboardWatcher(win as never);
    await vi.advanceTimersByTimeAsync(1500);

    expect(win.webContents.send).toHaveBeenCalledWith('clipboard:ai-detected', {
      text: longText,
    });

    stopClipboardWatcher();
  });

  it('does not read or emit when the window is focused', async () => {
    readTextMock.mockReturnValueOnce('existing').mockReturnValueOnce('B'.repeat(120));
    const win = createWindow(true);

    startClipboardWatcher(win as never);
    await vi.advanceTimersByTimeAsync(1500);

    expect(readTextMock).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).not.toHaveBeenCalled();

    stopClipboardWatcher();
  });

  it('ignores short clips and respects the enabled toggle', async () => {
    const shortText = 'short';
    const longText = 'C'.repeat(120);
    readTextMock
      .mockReturnValueOnce('existing')
      .mockReturnValueOnce(shortText)
      .mockReturnValueOnce(longText);
    const win = createWindow(false);

    startClipboardWatcher(win as never);

    await vi.advanceTimersByTimeAsync(1500);
    expect(win.webContents.send).not.toHaveBeenCalled();

    setClipboardWatcherEnabled(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(win.webContents.send).not.toHaveBeenCalled();

    setClipboardWatcherEnabled(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(win.webContents.send).toHaveBeenCalledWith('clipboard:ai-detected', {
      text: longText,
    });

    stopClipboardWatcher();
  });

  it('stops polling after stopClipboardWatcher is called', async () => {
    readTextMock.mockReturnValueOnce('existing').mockReturnValueOnce('D'.repeat(120));
    const win = createWindow(false);

    startClipboardWatcher(win as never);
    stopClipboardWatcher();
    await vi.advanceTimersByTimeAsync(3000);

    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});
