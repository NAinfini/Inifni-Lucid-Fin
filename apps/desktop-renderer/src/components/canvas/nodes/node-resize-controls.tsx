import { NodeResizeControl } from '@xyflow/react';

const CORNER_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

interface NodeResizeControlsProps {
  isVisible: boolean;
  minWidth: number;
  minHeight: number;
  className: string;
}

export function NodeResizeControls({
  isVisible,
  minWidth,
  minHeight,
  className,
}: NodeResizeControlsProps) {
  if (!isVisible) return null;

  return (
    <>
      {CORNER_POSITIONS.map((position) => (
        <NodeResizeControl
          key={position}
          position={position}
          minWidth={minWidth}
          minHeight={minHeight}
          keepAspectRatio={false}
          className={className}
        />
      ))}
    </>
  );
}
