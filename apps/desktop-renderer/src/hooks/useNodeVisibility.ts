import { useEffect, useRef, useState } from 'react';

/**
 * Returns whether the given ref element is currently visible in the viewport.
 * Uses IntersectionObserver for hardware-accelerated visibility detection.
 * Nodes off-screen can skip heavy media initialization (video decode, waveform).
 */
export function useNodeVisibility<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>;
  isVisible: boolean;
} {
  const ref = useRef<T | null>(null);
  // Default to visible when IntersectionObserver is unavailable (e.g. test environments)
  const [isVisible, setIsVisible] = useState(typeof IntersectionObserver === 'undefined');

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setIsVisible(entry.isIntersecting);
      },
      { rootMargin: '100px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
}
