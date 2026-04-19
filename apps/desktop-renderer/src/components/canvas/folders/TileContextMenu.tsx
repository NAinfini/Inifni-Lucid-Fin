import React, { useEffect, useRef } from 'react';
import { cn } from '../../../lib/utils.js';

export interface TileContextMenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export interface TileContextMenuProps {
  x: number;
  y: number;
  items: TileContextMenuItem[];
  onClose: () => void;
}

/**
 * Small floating context menu rendered at a viewport-fixed position.
 * Closes on outside-click, Escape, scroll, or after any item selection.
 * Consumers track open/closed state + the click coordinates themselves.
 */
export function TileContextMenu({ x, y, items, onClose }: TileContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left: x, top: y }}
      className="z-50 min-w-[140px] overflow-hidden rounded-md border border-border/60 bg-popover text-[11px] shadow-lg"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <button
          key={i}
          type="button"
          disabled={it.disabled}
          onClick={() => { if (it.disabled) return; it.onSelect(); onClose(); }}
          className={cn(
            'block w-full px-3 py-1.5 text-left hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed',
            it.destructive && 'text-destructive hover:bg-destructive/10',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
