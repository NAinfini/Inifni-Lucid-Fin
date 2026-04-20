// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useElapsed } from './useElapsed.js';

describe('useElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(new Date('2026-04-19T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 when since is null', () => {
    const { result } = renderHook(() => useElapsed(null));
    expect(result.current).toBe(0);
  });

  it('ticks from the reference timestamp as interval fires', () => {
    const since = Date.now();
    const { result } = renderHook(() => useElapsed(since));
    expect(result.current).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(1000);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current).toBe(5000);
  });

  it('cleans up its interval on unmount', () => {
    const since = Date.now();
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const { unmount } = renderHook(() => useElapsed(since));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
