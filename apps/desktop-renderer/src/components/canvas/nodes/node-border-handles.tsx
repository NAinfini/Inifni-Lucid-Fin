import type { CSSProperties } from 'react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '../../../lib/utils.js';

type BorderSide = 'top' | 'right' | 'bottom' | 'left';
type HandlePosition = typeof Position.Top | typeof Position.Right | typeof Position.Bottom | typeof Position.Left;

/** 3 anchors per side: 25%, 50%, 75% */
export const BORDER_HANDLE_OFFSETS = [25, 50, 75] as const;

const BORDER_SIDES: BorderSide[] = ['top', 'right', 'bottom', 'left'];

const HANDLE_CLASS =
  'lucid-anchor !h-2 !w-2 !rounded-full !border-0 pointer-events-auto transition-all duration-150';

export interface BorderHandleDescriptor {
  id: string;
  side: BorderSide;
  offsetPercent: number;
  position: HandlePosition;
  style: CSSProperties;
}

function descriptorStyle(side: BorderSide, offsetPercent: number): CSSProperties {
  switch (side) {
    case 'top':
      return { left: `${offsetPercent}%`, top: 0, transform: 'translate(-50%, -50%)' };
    case 'right':
      return { right: 0, top: `${offsetPercent}%`, transform: 'translate(50%, -50%)' };
    case 'bottom':
      return { left: `${offsetPercent}%`, bottom: 0, transform: 'translate(-50%, 50%)' };
    case 'left':
      return { left: 0, top: `${offsetPercent}%`, transform: 'translate(-50%, -50%)' };
  }
}

function sideToPosition(side: BorderSide): HandlePosition {
  switch (side) {
    case 'top':
      return Position.Top;
    case 'right':
      return Position.Right;
    case 'bottom':
      return Position.Bottom;
    case 'left':
      return Position.Left;
  }
}

export function createBorderHandleDescriptors(
  offsets: readonly number[] = BORDER_HANDLE_OFFSETS,
): BorderHandleDescriptor[] {
  return BORDER_SIDES.flatMap((side) =>
    offsets.map((offsetPercent) => ({
      id: `${side}-${offsetPercent}`,
      side,
      offsetPercent,
      position: sideToPosition(side),
      style: descriptorStyle(side, offsetPercent),
    })),
  );
}

interface NodeBorderHandlesProps {
  colorClassName: string;
  handleType?: 'source' | 'target';
}

export function NodeBorderHandles({
  colorClassName,
  handleType = 'source',
}: NodeBorderHandlesProps) {
  return createBorderHandleDescriptors().map((descriptor) => (
    <Handle
      key={descriptor.id}
      id={descriptor.id}
      type={handleType}
      position={descriptor.position}
      className={cn(HANDLE_CLASS, colorClassName)}
      style={descriptor.style}
    />
  ));
}
