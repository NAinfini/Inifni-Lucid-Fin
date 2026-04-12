import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook for range/slider inputs that should only dispatch to Redux on commit (pointerUp),
 * not on every frame during drag.
 *
 * Returns `[localValue, onChange, onPointerUp]` where:
 * - `localValue` is the value to bind to the input (updates on every drag frame — local state only)
 * - `onChange` handles input events (local state update, no dispatch)
 * - `onPointerUp` fires the commit callback with the final value
 *
 * When `externalValue` changes from outside (e.g. undo/redo), local state syncs to it.
 */
export function useSliderCommit(
  externalValue: number,
  onCommit: (value: number) => void,
): [number, (e: React.ChangeEvent<HTMLInputElement>) => void, () => void] {
  const [local, setLocal] = useState(externalValue);
  const localRef = useRef(local);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // Sync from external → local when external changes (undo/redo, programmatic update)
  const prevExternalRef = useRef(externalValue);
  useEffect(() => {
    if (externalValue !== prevExternalRef.current) {
      prevExternalRef.current = externalValue;
      setLocal(externalValue);
      localRef.current = externalValue;
    }
  }, [externalValue]);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setLocal(v);
    localRef.current = v;
  }, []);

  const onPointerUp = useCallback(() => {
    onCommitRef.current(localRef.current);
  }, []);

  return [local, onChange, onPointerUp];
}
