import React from 'react';
import { Virtuoso, type VirtuosoProps } from 'react-virtuoso';

export interface VirtualListProps<T> {
  data: T[];
  itemContent: (index: number, item: T) => React.ReactNode;
  className?: string;
  overscan?: number;
  style?: React.CSSProperties;
}

/**
 * Thin wrapper around react-virtuoso's Virtuoso component.
 * Provides sensible defaults for Lucid Fin's dark theme.
 */
export function VirtualList<T>({
  data,
  itemContent,
  className,
  overscan = 200,
  style,
}: VirtualListProps<T>) {
  return (
    <Virtuoso
      data={data}
      overscan={overscan}
      itemContent={itemContent}
      className={className}
      style={style}
    />
  );
}
