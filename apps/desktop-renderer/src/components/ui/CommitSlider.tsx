import { memo, useCallback, useEffect, useRef, useState } from 'react';

/**
 * A range input that only calls `onCommit` when the user finishes dragging (pointerUp),
 * not on every frame. Provides responsive visual feedback via local state during drag.
 *
 * Drop-in replacement for `<input type="range" onChange={...} />` — same props API.
 * When `value` changes from outside (undo/redo), local state syncs automatically.
 */
export const CommitSlider = memo(function CommitSlider({
  value,
  onCommit,
  className,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & {
  value: number;
  onCommit: (value: number) => void;
}) {
  const [local, setLocal] = useState(value);
  const localRef = useRef(value);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // Sync from external → local when external value changes (undo/redo)
  const prevExtRef = useRef(value);
  useEffect(() => {
    if (value !== prevExtRef.current) {
      prevExtRef.current = value;
      setLocal(value);
      localRef.current = value;
    }
  }, [value]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setLocal(v);
    localRef.current = v;
  }, []);

  const handlePointerUp = useCallback(() => {
    onCommitRef.current(localRef.current);
  }, []);

  return (
    <input
      type="range"
      value={local}
      onChange={handleChange}
      onPointerUp={handlePointerUp}
      className={className}
      {...rest}
    />
  );
});
