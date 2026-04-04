import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce, throttle, getVisibleRange } from './performance.js';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays execution', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resets timer on subsequent calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes arguments to the original function', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced('a', 'b');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('a', 'b');
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes immediately on first call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('suppresses calls within the interval', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled();
    throttled();
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires trailing call after interval', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    throttled();
    throttled(); // queued as trailing
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('getVisibleRange', () => {
  it('returns correct range for basic case', () => {
    // 100 items, scrolled 500px, viewport 300px, item 50px, overscan 3
    const range = getVisibleRange(100, 500, 300, 50, 3);
    expect(range.start).toBe(7); // floor(500/50) - 3 = 7
    expect(range.end).toBe(19); // 7 + ceil(300/50) + 6 = 19
  });

  it('clamps start to 0', () => {
    const range = getVisibleRange(100, 0, 300, 50, 3);
    expect(range.start).toBe(0);
  });

  it('clamps end to totalItems - 1', () => {
    const range = getVisibleRange(10, 0, 1000, 50, 3);
    expect(range.end).toBe(9);
  });

  it('returns {0, 0} for empty list', () => {
    const range = getVisibleRange(0, 0, 300, 50);
    expect(range).toEqual({ start: 0, end: 0 });
  });

  it('handles single item', () => {
    const range = getVisibleRange(1, 0, 300, 50);
    expect(range.start).toBe(0);
    expect(range.end).toBe(0);
  });

  it('uses default overscan of 3', () => {
    const range = getVisibleRange(100, 500, 300, 50);
    expect(range.start).toBe(7);
  });
});
