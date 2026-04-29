/**
 * Performance utilities for the renderer.
 * Lazy loading, virtual scrolling helpers, memory monitoring, and startup optimization.
 */
import { lazy, type ComponentType } from 'react';

/** Lazy-load a page component with a minimum delay to avoid flash */
export function lazyPage<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(factory);
}

/** Debounce a function */
export function debounce<A extends unknown[], R>(
  fn: (...args: A) => R,
  ms: number,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Throttle a function to at most once per `ms` */
export function throttle<A extends unknown[], R>(
  fn: (...args: A) => R,
  ms: number,
): (...args: A) => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  };
}

/** Request idle callback polyfill */
export const requestIdleCallback: (cb: () => void) => number =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback
    : (cb: () => void) => setTimeout(cb, 1) as unknown as number;

/** Memory usage monitor — returns MB used (renderer process) */
export function getMemoryUsageMB(): number {
  if (typeof performance !== 'undefined' && 'memory' in performance) {
    const mem = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
    return Math.round(mem.usedJSHeapSize / (1024 * 1024));
  }
  return 0;
}

/** Batch DOM reads/writes to avoid layout thrashing */
export function batchRAF(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/**
 * Virtual range calculator for timeline/list virtualization.
 * Given total items, viewport size, and item size, returns visible range.
 */
export function getVisibleRange(
  totalItems: number,
  scrollOffset: number,
  viewportSize: number,
  itemSize: number,
  overscan = 3,
): { start: number; end: number } {
  if (totalItems === 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor(scrollOffset / itemSize) - overscan);
  const visibleCount = Math.ceil(viewportSize / itemSize);
  const end = Math.min(totalItems - 1, start + visibleCount + overscan * 2);
  return { start, end };
}
