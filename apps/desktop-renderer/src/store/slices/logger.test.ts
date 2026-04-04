import { afterEach, describe, expect, it, vi } from 'vitest';
import { addLog, clearLogs, loggerSlice } from './logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loggerSlice', () => {
  it('adds log entries with generated id and timestamp', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1712345678901);

    const state = loggerSlice.reducer(
      undefined,
      addLog({
        level: 'info',
        category: 'generation',
        message: 'Done: Hero shot',
      }),
    );

    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        timestamp: 1712345678901,
        level: 'info',
        category: 'generation',
        message: 'Done: Hero shot',
      }),
    );
  });

  it('keeps only the latest 500 entries', () => {
    let state = loggerSlice.reducer(undefined, { type: 'init' });

    for (let index = 0; index < 501; index += 1) {
      state = loggerSlice.reducer(
        state,
        addLog({
          level: 'debug',
          category: 'test',
          message: `Entry ${index}`,
        }),
      );
    }

    expect(state.entries).toHaveLength(500);
    expect(state.entries[0]?.message).toBe('Entry 1');
    expect(state.entries.at(-1)?.message).toBe('Entry 500');
  });

  it('clears all log entries', () => {
    const populated = loggerSlice.reducer(
      undefined,
      addLog({
        level: 'error',
        category: 'commander',
        message: 'Session failed',
      }),
    );

    const cleared = loggerSlice.reducer(populated, clearLogs());
    expect(cleared.entries).toEqual([]);
  });
});
