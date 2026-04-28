import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils.js';

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

  const min = Number(rest.min ?? 0);
  const max = Number(rest.max ?? 100);
  const pct = max > min ? ((local - min) / (max - min)) * 100 : 0;

  return (
    <input
      type="range"
      value={local}
      onChange={handleChange}
      onPointerUp={handlePointerUp}
      className={cn(
        'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary outline-none',
        '[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-primary/50 [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:transition-colors',
        '[&::-webkit-slider-thumb]:hover:border-primary',
        '[&:focus-visible]:ring-1 [&:focus-visible]:ring-ring',
        className,
      )}
      style={{
        background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${pct}%, hsl(var(--secondary)) ${pct}%, hsl(var(--secondary)) 100%)`,
      }}
      {...rest}
    />
  );
});
