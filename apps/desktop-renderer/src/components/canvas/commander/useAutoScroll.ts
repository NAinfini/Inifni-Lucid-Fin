import { useEffect, useRef } from 'react';

interface UseAutoScrollOptions {
  /** Whether the panel is currently open/visible. */
  open: boolean;
  /**
   * Values whose reference-change triggers a scroll-to-bottom attempt.
   * Passed directly into the useEffect dependency array.
   */
  deps: readonly unknown[];
}

/**
 * Manages auto-scrolling for a vertically-scrollable container.
 *
 * Tracks whether the user has manually scrolled up (> 80 px from bottom).
 * When they haven't, each change in `deps` scrolls to the bottom.
 *
 * Returns the ref to attach to the scroll container and a mutable ref
 * indicating whether the user has scrolled up.
 */
export function useAutoScroll({ open, deps }: UseAutoScrollOptions) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUpRef = useRef(false);

  // Track whether user has manually scrolled up
  useEffect(() => {
    const target = scrollRef.current;
    if (!target) return;
    const handleScroll = () => {
      const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
      userScrolledUpRef.current = distanceFromBottom > 80;
    };
    target.addEventListener('scroll', handleScroll, { passive: true });
    return () => target.removeEventListener('scroll', handleScroll);
  }, []);

  // Only auto-scroll if user is near the bottom
  useEffect(() => {
    if (!open) return;
    const target = scrollRef.current;
    if (!target) return;
    if (!userScrolledUpRef.current) {
      target.scrollTop = target.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...deps]);

  return { scrollRef, userScrolledUpRef };
}
