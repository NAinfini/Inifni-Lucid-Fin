import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Local state buffer for text inputs that dispatch to Redux.
 *
 * Returns `[localValue, setLocalValue]` where:
 * - `localValue` is immediately updated on every keystroke (responsive UI)
 * - The `onCommit` callback is debounced — only fires after `delay` ms of inactivity
 * - When `externalValue` changes from outside (e.g. Redux reset), local state syncs to it
 */
export function useDebouncedDispatch(
  externalValue: string,
  onCommit: (value: string) => void,
  delay = 200,
): [string, (value: string) => void] {
  const [local, setLocal] = useState(externalValue);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // Sync from external → local when external changes (e.g. clear button, programmatic reset)
  const prevExternalRef = useRef(externalValue);
  useEffect(() => {
    if (externalValue !== prevExternalRef.current) {
      prevExternalRef.current = externalValue;
      setLocal(externalValue);
    }
  }, [externalValue]);

  const setValue = useCallback(
    (value: string) => {
      setLocal(value);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onCommitRef.current(value), delay);
    },
    [delay],
  );

  // Cleanup on unmount
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return [local, setValue];
}
